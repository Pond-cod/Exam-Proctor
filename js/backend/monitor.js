/**
 * Real-time Live Proctor Monitor Engine (for monitor.html)
 * Version: v5.2
 */

let allLogs = [];
let recentLocalLiveEvents = [];
let previousViolationCount = 0;
let monitorInterval = null;
let currentMonitorTab = "live"; // "live" | "completed" | "table"
let currentFilter = "all"; // "all" | "alert" | "today"
let completedDateFilter = "all"; // "all" | "YYYY-MM-DD"
let studentsData = {};
let liveStudents = [];
let completedStudents = [];
let activeModalStudentId = null;
let sessionCutoffTime = parseInt(localStorage.getItem("examSessionCutoff") || "0", 10);
let adminLiveChannel = null;

// Audio Chime for Admin Monitor
function playAdminChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

function formatDisplayTime(timeStr, isoTimestamp) {
  if (isoTimestamp) {
    try {
      const d = new Date(isoTimestamp);
      if (!isNaN(d.getTime()) && d.getFullYear() > 2020) {
        return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      }
    } catch (_) {}
  }
  if (!timeStr) return "-";
  const s = String(timeStr);
  if (s.includes("1899-12-30T")) {
    try {
      const d = new Date(s);
      if (!isNaN(d.getTime())) {
        return d.toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
      }
    } catch (_) {}
  }
  return s;
}

function parseLogTimestampMs(item) {
  if (!item) return null;
  if (item.timestamp) {
    const t = new Date(item.timestamp).getTime();
    if (!isNaN(t) && t > 1000000000) return t;
  }
  if (item.date) {
    const parts = String(item.date).split(/[\/\-]/);
    if (parts.length === 3) {
      let d, m, y;
      if (parts[0].length === 4) {
        [y, m, d] = parts.map(Number);
      } else {
        [d, m, y] = parts.map(Number);
      }
      if (y > 2400) y -= 543;
      const timeParts = String(item.time || "0:0:0").split(":");
      const hours = parseInt(timeParts[0] || "0", 10);
      const mins = parseInt(timeParts[1] || "0", 10);
      const secs = parseInt(timeParts[2] || "0", 10);
      const dt = new Date(y, m - 1, d, hours, mins, secs);
      if (!isNaN(dt.getTime())) return dt.getTime();
    }
  }
  return null;
}

function isTestLogEntry(item) {
  if (!item) return false;
  const sId = String(item.studentId !== undefined && item.studentId !== null ? item.studentId : "").trim().toLowerCase();
  const text = String(item.violation || "").toLowerCase();
  return (
    sId.includes("test") ||
    sId.includes("ping") ||
    sId.includes("curl") ||
    sId.includes("ทดสอบ") ||
    sId === "ไม่ระบุชื่อ" ||
    sId === "ไม่ระบุรหัส" ||
    text.includes("test ping") ||
    text.includes("ทดสอบการเชื่อมต่อ")
  );
}

function setupLiveBroadcastListener() {
  try {
    if (typeof BroadcastChannel !== "undefined") {
      if (!adminLiveChannel) {
        adminLiveChannel = new BroadcastChannel("exam_proctor_bus");
        adminLiveChannel.onmessage = (event) => {
          if (event.data && event.data.type === "EXAM_EVENT" && event.data.payload) {
            handleIncomingLiveEvent(event.data.payload);
          }
        };
      }
    }
  } catch (err) {
    console.warn("BroadcastChannel failed:", err);
  }

  window.addEventListener("storage", (e) => {
    if (e.key === "exam_live_event" && e.newValue) {
      try {
        const payload = JSON.parse(e.newValue);
        handleIncomingLiveEvent(payload);
      } catch (_) {}
    }
  });
}

function handleIncomingLiveEvent(payload) {
  if (!payload || !payload.studentId) return;

  recentLocalLiveEvents.unshift(payload);
  if (recentLocalLiveEvents.length > 50) {
    recentLocalLiveEvents = recentLocalLiveEvents.slice(0, 50);
  }

  const sId = String(payload.studentId).trim();
  if (!studentsData[sId]) {
    studentsData[sId] = {
      studentId: sId,
      logs: [payload],
      violationCount: payload.violationCount || 0,
      isStarted: true,
      isSubmitted: payload.violation && payload.violation.includes("ส่งข้อสอบเรียบร้อย"),
      startTime: payload.time || payload.timestamp,
      submitTime: payload.violation && payload.violation.includes("ส่งข้อสอบเรียบร้อย") ? (payload.time || payload.timestamp) : null,
      lastEventTime: payload.time || "",
      lastEventIso: payload.timestamp || "",
      lastEventText: payload.violation || "",
      hasAlert: (payload.violationCount || 0) > 0,
      isTestPing: false,
      isOldDate: false,
      isBeforeCutoff: false
    };
  } else {
    const s = studentsData[sId];
    s.logs.push(payload);
    if (payload.violationCount !== undefined && payload.violationCount > s.violationCount) {
      s.violationCount = payload.violationCount;
    } else if (payload.violation && !payload.violation.includes("เริ่มเข้าทำข้อสอบ") && !payload.violation.includes("ส่งข้อสอบเรียบร้อย")) {
      s.violationCount++;
    }
    s.hasAlert = s.violationCount > 0;
    s.lastEventText = payload.violation || s.lastEventText;
    s.lastEventTime = payload.time || s.lastEventTime;
    s.lastEventIso = payload.timestamp || s.lastEventIso;
    if (payload.violation && payload.violation.includes("ส่งข้อสอบเรียบร้อย")) {
      s.isSubmitted = true;
      s.submitTime = payload.time || payload.timestamp;
    }
  }

  renderMonitorLogs();
  playAdminChime();

  const syncStatus = document.getElementById("syncStatusText");
  if (syncStatus) {
    syncStatus.textContent = `⚡ อัปเดตสด: ${sId} (${new Date().toLocaleTimeString("th-TH")})`;
  }
}

function updateMonitorRoomFilterDropdown() {
  const sel = document.getElementById("monitorRoomFilterSelect");
  if (!sel) return;

  const currentVal = sel.value || "all";
  let rooms = allRooms.length > 0 ? allRooms : getStoredRooms();
  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  if (currentUser && currentUser.role !== USER_ROLES.ADMIN) {
    if (typeof isRoomOwnedByUser === "function") {
      rooms = rooms.filter(r => isRoomOwnedByUser(r, currentUser));
    }
  }

  let html = `<option value="all">ทุกห้องสอบ (All Rooms)</option>`;
  rooms.forEach((r) => {
    html += `<option value="${escapeHtml(r.roomId)}">${escapeHtml(r.title)} (${escapeHtml(r.roomId)})</option>`;
  });
  sel.innerHTML = html;
  if (rooms.some(r => r.roomId === currentVal)) {
    sel.value = currentVal;
  } else {
    sel.value = "all";
  }
}

function fetchMonitorLogs() {
  const webhookUrl = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  const syncStatus = document.getElementById("syncStatusText");

  fetch(webhookUrl)
    .then((res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then((resData) => {
      let fetchedList = [];
      if (Array.isArray(resData)) {
        fetchedList = resData;
      } else if (resData && Array.isArray(resData.data)) {
        fetchedList = resData.data;
      } else if (resData && resData.status === "success" && Array.isArray(resData.logs)) {
        fetchedList = resData.logs;
      }

      const mergedMap = new Map();
      fetchedList.forEach((item) => {
        const key = `${item.studentId}_${item.violation}_${item.timestamp || item.time}`;
        mergedMap.set(key, item);
      });
      const recentThreshold = Date.now() - 45000;
      recentLocalLiveEvents.forEach((item) => {
        const key = `${item.studentId}_${item.violation}_${item.timestamp || item.time}`;
        if (!mergedMap.has(key)) {
          const itemMs = parseLogTimestampMs(item);
          if (!itemMs || itemMs >= recentThreshold) {
            mergedMap.set(key, item);
          }
        }
      });

      allLogs = Array.from(mergedMap.values());
      renderMonitorLogs();
      if (syncStatus) {
        syncStatus.textContent = `ซิงค์ล่าสุด: ${new Date().toLocaleTimeString("th-TH")}`;
      }
    })
    .catch((err) => {
      console.warn("Fetch monitor logs error:", err);
      if (syncStatus) syncStatus.textContent = `ขาดการเชื่อมต่อ Webhook`;
    });
}

function renderMonitorLogs() {
  const query = (document.getElementById("searchLogInput") ? document.getElementById("searchLogInput").value : "").trim().toLowerCase();
  const totalStudentsEl = document.getElementById("statTotalStudents");
  const activeStudentsEl = document.getElementById("statActiveStudents");
  const totalViolationsEl = document.getElementById("statTotalViolations");
  const totalSubmittedEl = document.getElementById("statTotalSubmitted");

  const countLiveBadge = document.getElementById("countLiveBadge");
  const countCompletedBadge = document.getElementById("countCompletedBadge");
  const completedHeaderCount = document.getElementById("completedHeaderCount");

  studentsData = {};
  let totalViolationsCount = 0;

  const sortedLogs = [...allLogs].sort((a, b) => {
    const tA = parseLogTimestampMs(a) || 0;
    const tB = parseLogTimestampMs(b) || 0;
    return tA - tB;
  });

  const nowMs = Date.now();
  const oneDayMs = 20 * 60 * 60 * 1000;
  const selectedRoomFilter = (document.getElementById("monitorRoomFilterSelect") ? document.getElementById("monitorRoomFilterSelect").value : "all") || "all";
  const targetRoom = allRooms.find(r => r.roomId === selectedRoomFilter);

  sortedLogs.forEach((item) => {
    if (selectedRoomFilter !== "all") {
      const itemRoomId = item.roomId || "";
      const itemTitle = item.roomTitle || item.formTitle || "";
      const matchesId = itemRoomId && itemRoomId === selectedRoomFilter;
      const matchesTitle = targetRoom && itemTitle && (itemTitle === targetRoom.title || itemTitle.includes(targetRoom.title));
      if (!matchesId && !matchesTitle) {
        return;
      }
    }

    const sId = String(item.studentId !== undefined && item.studentId !== null ? item.studentId : "ไม่ระบุรหัส").trim();
    const isTestEntry = isTestLogEntry(item);

    if (!studentsData[sId]) {
      studentsData[sId] = {
        studentId: sId,
        roomId: item.roomId || "",
        roomTitle: item.roomTitle || item.formTitle || "",
        logs: [],
        violationCount: 0,
        isStarted: false,
        isSubmitted: false,
        startTime: null,
        submitTime: null,
        lastEventTime: null,
        lastEventIso: null,
        lastEventText: "",
        hasAlert: false,
        isTestPing: isTestEntry,
        isOldDate: false,
        isBeforeCutoff: false
      };
    } else {
      if (item.roomId && !studentsData[sId].roomId) studentsData[sId].roomId = item.roomId;
      if ((item.roomTitle || item.formTitle) && !studentsData[sId].roomTitle) {
        studentsData[sId].roomTitle = item.roomTitle || item.formTitle;
      }
      if (isTestEntry) {
        studentsData[sId].isTestPing = true;
      }
    }

    const s = studentsData[sId];
    s.logs.push(item);

    const text = String(item.violation || "");
    const isStart = text.includes("เริ่มเข้าทำข้อสอบ");
    const isEnd = text.includes("ส่งข้อสอบเรียบร้อย");
    const itemTime = String(item.time || "");
    const itemIso = String(item.timestamp || "");

    if (isStart) {
      s.isStarted = true;
      s.isSubmitted = false;
      s.violationCount = 0;
      s.startTime = itemTime || itemIso;
    } else if (isEnd) {
      s.isSubmitted = true;
      s.submitTime = itemTime || itemIso;
    } else if (!s.isTestPing && !isTestEntry) {
      s.violationCount++;
      totalViolationsCount++;
    }

    if (item.violationCount && typeof item.violationCount === "number" && item.violationCount > s.violationCount) {
      const diff = item.violationCount - s.violationCount;
      s.violationCount = item.violationCount;
      totalViolationsCount += diff;
    }

    s.lastEventTime = itemTime;
    s.lastEventIso = itemIso;
    s.lastEventText = text;

    const logDateMs = parseLogTimestampMs(item);
    if (logDateMs !== null && !isNaN(logDateMs)) {
      if (nowMs - logDateMs > oneDayMs) s.isOldDate = true;
      if (sessionCutoffTime > 0 && logDateMs < sessionCutoffTime) s.isBeforeCutoff = true;
    }
  });

  const allList = Object.values(studentsData).filter(s => !s.isTestPing);
  allList.forEach((s) => {
    s.hasAlert = s.violationCount > 0;
  });

  liveStudents = allList.filter((s) => !s.isSubmitted && !s.isOldDate && !s.isBeforeCutoff);
  completedStudents = allList.filter((s) => s.isSubmitted || s.isOldDate || s.isBeforeCutoff);

  completedStudents.sort((a, b) => {
    const lastA = a.logs[a.logs.length - 1];
    const lastB = b.logs[b.logs.length - 1];
    const tA = parseLogTimestampMs(lastA) || 0;
    const tB = parseLogTimestampMs(lastB) || 0;
    return tB - tA;
  });

  const totalActive = liveStudents.length;
  const totalCompleted = completedStudents.length;
  const totalCombined = allList.length;

  if (totalStudentsEl) totalStudentsEl.textContent = `${totalCombined} คน`;
  if (activeStudentsEl) activeStudentsEl.textContent = `${totalActive} คน`;
  if (totalViolationsEl) totalViolationsEl.textContent = `${totalViolationsCount} ครั้ง`;
  if (totalSubmittedEl) totalSubmittedEl.textContent = `${totalCompleted} คน`;

  if (countLiveBadge) countLiveBadge.textContent = totalActive;
  if (countCompletedBadge) countCompletedBadge.textContent = totalCompleted;
  if (completedHeaderCount) completedHeaderCount.textContent = totalCompleted;

  const clearCutoffBtn = document.getElementById("clearCutoffBtn");
  if (clearCutoffBtn) {
    clearCutoffBtn.style.display = sessionCutoffTime > 0 ? "inline-flex" : "none";
  }

  updateFilterBadges();

  if (totalViolationsCount > previousViolationCount && previousViolationCount > 0) {
    playAdminChime();
  }
  previousViolationCount = totalViolationsCount;

  renderLiveScreensGrid(query);
  renderCompletedScreensGrid(query);
  renderTableLogs(query);

  if (activeModalStudentId && studentsData[activeModalStudentId]) {
    updateModalContent(studentsData[activeModalStudentId]);
  }
}

function updateFilterBadges() {
  const badgeAll = document.getElementById("badgeFilterAll");
  const badgeAlert = document.getElementById("badgeFilterAlert");
  const badgeToday = document.getElementById("badgeFilterToday");

  const activePool = currentMonitorTab === "live"
    ? liveStudents
    : (currentMonitorTab === "completed" ? completedStudents : Object.values(studentsData).filter(s => !s.isTestPing));

  if (badgeAll) badgeAll.textContent = activePool.length;
  if (badgeAlert) badgeAlert.textContent = activePool.filter(s => s.hasAlert).length;
  if (badgeToday) badgeToday.textContent = activePool.filter(s => !s.isOldDate).length;
}

function renderStudentCardHtml(s, isCompletedView) {
  let cardClass = "student-screen-card";
  let statusBadge = "";
  let statusText = "🟢 ปกติ";

  if (!s.isSubmitted && s.hasAlert) {
    cardClass += " has-alert";
    statusBadge = `
      <span class="badge badge-danger">
        <span class="radar-beacon" style="margin-right: 4px;"></span>
        เตือน ${s.violationCount} ครั้ง
      </span>
    `;
    statusText = "🚨 พบการแจ้งเตือน";
  } else if (s.isSubmitted) {
    cardClass += " is-submitted";
    statusBadge = `<span class="badge badge-success">ส่งข้อสอบแล้ว</span>`;
    statusText = "✅ ส่งข้อสอบแล้ว";
  } else {
    statusBadge = `<span class="badge badge-primary">กำลังสอบ</span>`;
  }

  const startTimeStr = formatDisplayTime(s.startTime);
  const lastTimeStr = formatDisplayTime(s.lastEventTime, s.lastEventIso);
  const datePrefix = isCompletedView && s.dateMeta && s.dateMeta.titleShort ? `📅 ${escapeHtml(s.dateMeta.titleShort)} • ` : "";

  return `
    <div class="${cardClass}" data-student-id="${escapeHtml(s.studentId)}">
      <div class="screen-card-header">
        <div class="screen-card-identity">
          <div class="screen-device-icon" style="font-size: 18px;">
            🎓
          </div>
          <div class="screen-station-text">
            <span class="screen-station-label">รหัสประจำตัวนักเรียน</span>
            <span class="screen-station-id">${escapeHtml(s.studentId)}</span>
            <div style="font-size: 11.5px; color: var(--text-muted); margin-top: 2px;">
              ${datePrefix}เริ่ม: ${startTimeStr}
            </div>
          </div>
        </div>
        ${statusBadge}
      </div>

      <div class="screen-display-mockup">
        <div class="screen-mockup-inner">
          <div class="screen-browser-bar">
            <span class="mock-dot" style="background:#ff5f56;"></span>
            <span class="mock-dot" style="background:#ffbd2e;"></span>
            <span class="mock-dot" style="background:#27c93f;"></span>
            <span class="mock-address">exam.html • โหมดเต็มจอ</span>
          </div>
          <div class="screen-content-area">
            ${s.isSubmitted ? `
              <div class="screen-status-center success">
                <div style="font-size: 26px;">📝</div>
                <div style="font-size: 13px; font-weight: 700; color: #059669; margin-top: 4px;">ส่งข้อสอบสำเร็จ</div>
                <div style="font-size: 11px; color: var(--text-muted);">${formatDisplayTime(s.submitTime)}</div>
                ${s.roomTitle ? `<div style="font-size: 11px; color: #047857; margin-top: 3px; font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 200px;" title="${escapeHtml(s.roomTitle)}">วิชา: ${escapeHtml(s.roomTitle)}</div>` : ""}
              </div>
            ` : (s.hasAlert ? `
              <div class="screen-status-center alert">
                <div style="font-size: 28px;">🚨</div>
                <div style="font-size: 12.5px; font-weight: 700; color: #dc2626; margin-top: 4px;">ตรวจพบการสลับจอ / หลุดเต็มจอ</div>
                <div style="font-size: 11px; color: #991b1b; max-width: 180px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${escapeHtml(s.lastEventText)}</div>
              </div>
            ` : `
              <div class="screen-status-center normal">
                <div class="radar-beacon" style="width: 14px; height: 14px; margin-bottom: 6px;"></div>
                <div style="font-size: 12.5px; font-weight: 600; color: #2563eb;">กำลังทำข้อสอบอย่างซื่อสัตย์</div>
                <div style="font-size: 11px; color: var(--text-muted);">โหมดคุมสอบเต็มหน้าจอ</div>
              </div>
            `)}
          </div>
        </div>
      </div>

      <div class="screen-card-footer">
        <div class="screen-last-event">
          <span style="font-size: 11px; color: var(--text-muted); display: block;">เหตุการณ์ล่าสุด (${lastTimeStr}):</span>
          <span style="font-size: 12px; font-weight: 500; color: var(--text-secondary); text-overflow: ellipsis; white-space: nowrap; overflow: hidden; display: block;">
            ${escapeHtml(s.lastEventText || statusText)}
          </span>
        </div>
        <button class="btn btn-secondary screen-view-detail-btn" data-student-id="${escapeHtml(s.studentId)}" style="min-height: 32px; padding: 4px 10px; font-size: 12px;">
          ประวัติ
        </button>
      </div>
    </div>
  `;
}

function renderLiveScreensGrid(query) {
  const container = document.getElementById("studentScreensGrid");
  if (!container) return;

  let filtered = liveStudents;
  if (query) {
    filtered = filtered.filter(s => s.studentId.toLowerCase().includes(query) || (s.lastEventText && s.lastEventText.toLowerCase().includes(query)));
  }
  if (currentFilter === "alert") {
    filtered = filtered.filter(s => s.hasAlert);
  } else if (currentFilter === "today") {
    filtered = filtered.filter(s => !s.isOldDate);
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="screens-empty-state">
        <div class="monitor-live-badge"><span class="live-dot"></span> ระบบคุมสอบสดพร้อมทำงาน</div>
        <h3 style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">ขณะนี้ยังไม่มีผู้เข้าทำข้อสอบ</h3>
        <p style="font-size: 13.5px; color: var(--text-secondary); max-width: 440px; margin: 0 auto; line-height: 1.6;">
          เมื่อนักเรียนเปิดลิงก์และเริ่มสอบ หน้าจอสดจะปรากฏขึ้นที่นี่โดยอัตโนมัติ
        </p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(s => renderStudentCardHtml(s, false)).join("");
  bindStudentCardClicks(container);
}

function getStudentDateMeta(s) {
  let ts = 0;
  // 1. หาจาก log การส่งข้อสอบ
  if (Array.isArray(s.logs)) {
    for (let i = s.logs.length - 1; i >= 0; i--) {
      const l = s.logs[i];
      const v = String(l.violation || "");
      if (v.includes("ส่งข้อสอบเรียบร้อย")) {
        const t = parseLogTimestampMs(l);
        if (t) { ts = t; break; }
      }
    }
    // 2. ถ้าไม่มี ให้ใช้ log ล่าสุด
    if (!ts && s.logs.length > 0) {
      ts = parseLogTimestampMs(s.logs[s.logs.length - 1]) || 0;
    }
    // 3. fallback log แรก
    if (!ts && s.logs.length > 0) {
      ts = parseLogTimestampMs(s.logs[0]) || 0;
    }
  }
  if (!ts) ts = Date.now();

  const d = new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const dateKey = `${y}-${m}-${day}`;

  const now = new Date();
  const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, "0")}-${String(yesterday.getDate()).padStart(2, "0")}`;

  let relativePrefix = "";
  if (dateKey === todayKey) relativePrefix = "วันนี้ • ";
  else if (dateKey === yesterdayKey) relativePrefix = "เมื่อวานนี้ • ";

  const thaiFull = d.toLocaleDateString("th-TH", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric"
  });

  const thaiShort = d.toLocaleDateString("th-TH", {
    year: "numeric",
    month: "short",
    day: "numeric"
  });

  return {
    ts,
    dateKey,
    relativePrefix,
    titleFull: `${relativePrefix}${thaiFull}`,
    titleShort: `${relativePrefix}${thaiShort}`
  };
}

function populateCompletedDateDropdown(dateGroupsMap) {
  const select = document.getElementById("completedDateFilterSelect");
  if (!select) return;

  const currentVal = completedDateFilter || "all";
  const allGroups = Array.from(dateGroupsMap.values()).sort((a, b) => b.ts - a.ts);

  let optionsHtml = `<option value="all">ทุกวันที่ (แสดงแยกตามวัน)</option>`;
  allGroups.forEach((grp) => {
    optionsHtml += `<option value="${escapeHtml(grp.dateKey)}">${escapeHtml(grp.titleShort)} (${grp.students.length} คน)</option>`;
  });

  select.innerHTML = optionsHtml;
  if (Array.from(select.options).some(opt => opt.value === currentVal)) {
    select.value = currentVal;
  } else {
    select.value = "all";
    completedDateFilter = "all";
  }
}

function renderCompletedScreensGrid(query) {
  const container = document.getElementById("completedScreensGrid");
  if (!container) return;

  let filtered = completedStudents;
  if (query) {
    filtered = filtered.filter(s => s.studentId.toLowerCase().includes(query) || (s.lastEventText && s.lastEventText.toLowerCase().includes(query)));
  }
  if (currentFilter === "alert") {
    filtered = filtered.filter(s => s.hasAlert);
  } else if (currentFilter === "today") {
    filtered = filtered.filter(s => !s.isOldDate);
  }

  // 1. จัดกลุ่มตามวันที่ (Group by Date)
  const dateGroupsMap = new Map();
  filtered.forEach((s) => {
    const meta = getStudentDateMeta(s);
    s.dateMeta = meta;

    if (!dateGroupsMap.has(meta.dateKey)) {
      dateGroupsMap.set(meta.dateKey, {
        dateKey: meta.dateKey,
        ts: meta.ts,
        titleFull: meta.titleFull,
        titleShort: meta.titleShort,
        students: [],
        totalViolations: 0
      });
    }
    const grp = dateGroupsMap.get(meta.dateKey);
    grp.students.push(s);
    grp.totalViolations += (s.violationCount || 0);
  });

  // อัปเดตตัวเลือกใน Date Filter Dropdown
  populateCompletedDateDropdown(dateGroupsMap);

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="screens-empty-state">
        <p style="font-size: 14px; color: var(--text-muted);">ยังไม่มีประวัติผู้สอบที่ส่งข้อสอบในเงื่อนไขนี้</p>
      </div>
    `;
    return;
  }

  // 2. กรองตาม completedDateFilter ถ้าเลือกเฉพาะวัน
  let sortedGroups = Array.from(dateGroupsMap.values()).sort((a, b) => b.ts - a.ts);
  if (completedDateFilter && completedDateFilter !== "all") {
    sortedGroups = sortedGroups.filter(g => g.dateKey === completedDateFilter);
  }

  if (sortedGroups.length === 0) {
    container.innerHTML = `
      <div class="screens-empty-state">
        <p style="font-size: 14px; color: var(--text-muted);">ไม่พบประวัติผู้สอบในวันที่เลือก</p>
      </div>
    `;
    return;
  }

  // 3. เรนเดอร์แยก Section แต่ละวัน
  container.innerHTML = sortedGroups.map((grp) => {
    return `
      <div class="completed-date-section" data-date-key="${escapeHtml(grp.dateKey)}">
        <div class="completed-date-header">
          <div class="completed-date-title-box">
            <span class="completed-date-icon">📅</span>
            <span class="completed-date-title">${escapeHtml(grp.titleFull)}</span>
            <span class="badge badge-neutral" style="font-weight: 700; font-size: 12px;">👥 ส่งแล้ว ${grp.students.length} คน</span>
            ${grp.totalViolations > 0 
              ? `<span class="badge badge-danger" style="font-size: 11.5px;">⚠️ แจ้งเตือนรวม ${grp.totalViolations} ครั้ง</span>` 
              : `<span class="badge badge-success" style="font-size: 11.5px;">✅ การสอบปกติ</span>`}
          </div>
          <div class="completed-date-actions">
            <span style="font-size: 12px; color: var(--text-muted);">
              ${grp.students[0] && grp.students[0].submitTime ? `ส่งล่าสุด: ${formatDisplayTime(grp.students[0].submitTime)}` : ""}
            </span>
          </div>
        </div>
        <div class="screens-grid">
          ${grp.students.map(s => renderStudentCardHtml(s, true)).join("")}
        </div>
      </div>
    `;
  }).join("");

  bindStudentCardClicks(container);
}

function renderTableLogs(query) {
  const tbody = document.getElementById("monitorTableBody");
  if (!tbody) return;

  let filtered = [...allLogs].reverse();
  if (query) {
    filtered = filtered.filter(item => {
      const sId = String(item.studentId || "").toLowerCase();
      const v = String(item.violation || "").toLowerCase();
      return sId.includes(query) || v.includes(query);
    });
  }

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 24px; color: var(--text-muted);">ไม่พบบันทึกเหตุการณ์</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.slice(0, 100).map((item) => {
    const isAlert = item.violation && !item.violation.includes("เริ่มเข้าทำข้อสอบ") && !item.violation.includes("ส่งข้อสอบเรียบร้อย");
    const isSuccess = item.violation && item.violation.includes("ส่งข้อสอบเรียบร้อย");

    let statusPill = `<span class="badge badge-neutral">เริ่มสอบ</span>`;
    if (isAlert) {
      statusPill = `<span class="badge badge-danger">แจ้งเตือน</span>`;
    } else if (isSuccess) {
      statusPill = `<span class="badge badge-success">ส่งข้อสอบ</span>`;
    }

    return `
      <tr>
        <td style="font-size: 12.5px; color: var(--text-muted);">${formatDisplayTime(item.time, item.timestamp)}</td>
        <td><strong style="color: var(--primary); font-family: monospace;">${escapeHtml(item.studentId || "-")}</strong></td>
        <td style="font-size: 13px;">${escapeHtml(item.violation || "-")}</td>
        <td>${statusPill}</td>
      </tr>
    `;
  }).join("");
}

function bindStudentCardClicks(container) {
  container.querySelectorAll(".student-screen-card").forEach((card) => {
    card.onclick = (e) => {
      if (e.target.closest("button")) return;
      const sId = card.getAttribute("data-student-id");
      if (sId && studentsData[sId]) openStudentDetail(studentsData[sId]);
    };
  });
  container.querySelectorAll(".screen-view-detail-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const sId = btn.getAttribute("data-student-id");
      if (sId && studentsData[sId]) openStudentDetail(studentsData[sId]);
    };
  });
}

function openStudentDetail(s) {
  activeModalStudentId = s.studentId;
  const modal = document.getElementById("studentDetailModal");
  if (!modal) return;
  updateModalContent(s);
  modal.classList.add("active");
}

function closeStudentDetail() {
  activeModalStudentId = null;
  const modal = document.getElementById("studentDetailModal");
  if (modal) modal.classList.remove("active");
}

function updateModalContent(s) {
  const titleEl = document.getElementById("modalStudentTitle");
  const subEl = document.getElementById("modalStudentSubtitle");
  const statusVal = document.getElementById("modalStatusVal");
  const violationVal = document.getElementById("modalViolationVal");
  const startTimeVal = document.getElementById("modalStartTimeVal");
  const lastTimeVal = document.getElementById("modalLastTimeVal");
  const timelineEl = document.getElementById("studentTimelineContainer");
  const countEl = document.getElementById("modalTimelineCount");

  if (titleEl) titleEl.textContent = `รหัสประจำตัว: ${s.studentId}`;
  if (subEl) subEl.textContent = `ประวัติพฤติกรรมและความซื่อสัตย์ในการสอบ (${s.logs.length} รายการ)`;

  if (statusVal) {
    statusVal.innerHTML = s.isSubmitted 
      ? `<span style="color:#059669; font-weight:700;">ส่งข้อสอบแล้ว</span>` 
      : (s.hasAlert ? `<span style="color:#dc2626; font-weight:700;">พบแจ้งเตือน</span>` : `<span style="color:#2563eb; font-weight:700;">กำลังสอบ</span>`);
  }
  if (violationVal) violationVal.textContent = `${s.violationCount} ครั้ง`;
  if (startTimeVal) startTimeVal.textContent = formatDisplayTime(s.startTime);
  if (lastTimeVal) lastTimeVal.textContent = formatDisplayTime(s.lastEventTime, s.lastEventIso);
  if (countEl) countEl.textContent = `${s.logs.length} รายการ`;

  if (timelineEl) {
    const reversed = [...s.logs].reverse();
    timelineEl.innerHTML = reversed.map((l, idx) => {
      const isStart = String(l.violation || "").includes("เริ่มเข้าทำข้อสอบ");
      const isEnd = String(l.violation || "").includes("ส่งข้อสอบเรียบร้อย");
      const isAlert = !isStart && !isEnd;

      let dotClass = "normal";
      let icon = "ℹ️";
      if (isAlert) {
        dotClass = "danger";
        icon = "🚨";
      } else if (isEnd) {
        dotClass = "success";
        icon = "📝";
      }

      return `
        <div class="timeline-item">
          <div class="timeline-dot ${dotClass}"></div>
          <div class="timeline-content">
            <div class="timeline-time">${formatDisplayTime(l.time, l.timestamp)}</div>
            <div class="timeline-text">${icon} ${escapeHtml(l.violation || "-")}</div>
          </div>
        </div>
      `;
    }).join("");
  }
}

function copyStudentHistory() {
  if (!activeModalStudentId || !studentsData[activeModalStudentId]) return;
  const s = studentsData[activeModalStudentId];
  let text = `=== ประวัติการสอบ: ${s.studentId} ===\n`;
  text += `สถานะ: ${s.isSubmitted ? "ส่งข้อสอบแล้ว" : "กำลังสอบ"}\n`;
  text += `จำนวนแจ้งเตือน: ${s.violationCount} ครั้ง\n`;
  text += `เวลาเริ่มสอบ: ${formatDisplayTime(s.startTime)}\n`;
  text += `ลำดับเหตุการณ์:\n`;
  s.logs.forEach((l, idx) => {
    text += `${idx + 1}. [${formatDisplayTime(l.time, l.timestamp)}] ${l.violation || "-"}\n`;
  });

  navigator.clipboard.writeText(text).then(() => {
    showAlert("คัดลอกประวัติเหตุการณ์ของผู้สอบเรียบร้อยแล้ว", { type: "success" });
  });
}

function switchToMonitorTab(tab) {
  currentMonitorTab = tab;
  const liveBtn = document.getElementById("toggleLiveViewBtn");
  const compBtn = document.getElementById("toggleCompletedViewBtn");
  const tableBtn = document.getElementById("toggleTableViewBtn");
  const liveContainer = document.getElementById("screensGridContainer");
  const compContainer = document.getElementById("completedGridContainer");
  const tableContainer = document.getElementById("tableViewContainer");

  if (liveBtn) liveBtn.classList.toggle("active", tab === "live");
  if (compBtn) compBtn.classList.toggle("active", tab === "completed");
  if (tableBtn) tableBtn.classList.toggle("active", tab === "table");

  if (liveContainer) liveContainer.style.display = tab === "live" ? "block" : "none";
  if (compContainer) compContainer.style.display = tab === "completed" ? "block" : "none";
  if (tableContainer) tableContainer.style.display = tab === "table" ? "block" : "none";

  updateFilterBadges();
}

function testWebhookPing() {
  const btn = document.getElementById("testWebhookBtn");
  if (btn) btn.disabled = true;

  showAlert("กำลังส่งข้อมูลทดสอบ Ping ไปยัง Google Apps Script...", { type: "info" });
  const webhookUrl = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  fetch(webhookUrl, {
    method: "POST",
    mode: "no-cors",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({
      studentId: "TestPing",
      violation: "ทดสอบการเชื่อมต่อ Webhook จากหน้าจอคุมสอบ",
      timestamp: new Date().toISOString()
    })
  }).then(() => {
    setTimeout(() => {
      fetchMonitorLogs();
      if (btn) btn.disabled = false;
      showAlert("ส่งข้อมูลทดสอบเรียบร้อยแล้ว กรุณาตรวจสอบใน Google Sheets หรือหน้าจอ", { type: "success" });
    }, 1200);
  }).catch(() => {
    if (btn) btn.disabled = false;
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof requireAuth === "function" && !requireAuth()) return;

  setupMobileNavigation();
  applyRoleUI();

  allRooms = getStoredRooms();
  updateMonitorRoomFilterDropdown();
  fetchCloudRooms(() => {
    updateMonitorRoomFilterDropdown();
  });

  const monitorRoomFilter = document.getElementById("monitorRoomFilterSelect");
  if (monitorRoomFilter) {
    monitorRoomFilter.addEventListener("change", renderMonitorLogs);
  }

  const searchLogInput = document.getElementById("searchLogInput");
  if (searchLogInput) {
    searchLogInput.addEventListener("input", renderMonitorLogs);
  }

  const refreshLogsBtn = document.getElementById("refreshLogsBtn");
  if (refreshLogsBtn) {
    refreshLogsBtn.addEventListener("click", () => {
      refreshLogsBtn.disabled = true;
      const origText = refreshLogsBtn.textContent;
      refreshLogsBtn.textContent = "กำลังซิงค์...";
      fetchMonitorLogs();
      setTimeout(() => {
        refreshLogsBtn.disabled = false;
        refreshLogsBtn.textContent = origText;
      }, 600);
    });
  }

  const toggleLiveBtn = document.getElementById("toggleLiveViewBtn");
  if (toggleLiveBtn) toggleLiveBtn.addEventListener("click", () => switchToMonitorTab("live"));

  const toggleCompletedBtn = document.getElementById("toggleCompletedViewBtn");
  if (toggleCompletedBtn) toggleCompletedBtn.addEventListener("click", () => switchToMonitorTab("completed"));

  const completedDateFilterSelect = document.getElementById("completedDateFilterSelect");
  if (completedDateFilterSelect) {
    completedDateFilterSelect.addEventListener("change", (e) => {
      completedDateFilter = e.target.value;
      const query = (document.getElementById("searchLogInput") ? document.getElementById("searchLogInput").value : "").trim().toLowerCase();
      renderCompletedScreensGrid(query);
    });
  }

  const toggleTableBtn = document.getElementById("toggleTableViewBtn");
  if (toggleTableBtn) toggleTableBtn.addEventListener("click", () => switchToMonitorTab("table"));

  const resetSessionBtn = document.getElementById("resetSessionBtn");
  if (resetSessionBtn) {
    resetSessionBtn.addEventListener("click", async () => {
      const confirmed = await showConfirm(
        "ต้องการเริ่มรอบการสอบใหม่หรือไม่?\n\nระบบจะย้ายหน้าจอผู้สอบชุดก่อนหน้าทั้งหมดไปยัง '📁 ประวัติผู้ส่งข้อสอบแล้ว' เพื่อให้หน้าจอคุมสอบสดว่างพร้อมรับนักเรียนรอบใหม่",
        {
          title: "✨ เริ่มรอบสอบใหม่ (Reset Live Monitor)",
          confirmText: "เริ่มรอบใหม่ทันที",
          cancelText: "ยกเลิก"
        }
      );
      if (confirmed) {
        sessionCutoffTime = Date.now();
        localStorage.setItem("examSessionCutoff", sessionCutoffTime.toString());
        renderMonitorLogs();
        switchToMonitorTab("live");
        showAlert("เริ่มรอบสอบใหม่เรียบร้อยแล้ว", { type: "success" });
      }
    });
  }

  const clearCutoffBtn = document.getElementById("clearCutoffBtn");
  if (clearCutoffBtn) {
    clearCutoffBtn.addEventListener("click", () => {
      sessionCutoffTime = 0;
      localStorage.removeItem("examSessionCutoff");
      renderMonitorLogs();
      showAlert("ล้างตัวตัดรอบเรียบร้อยแล้ว", { type: "success" });
    });
  }

  const filterPills = document.querySelectorAll(".filter-pill");
  filterPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      filterPills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      currentFilter = pill.getAttribute("data-filter") || "all";
      renderMonitorLogs();
    });
  });

  const closeDetailBtn = document.getElementById("closeDetailModalBtn");
  const modalDismissBtn = document.getElementById("modalDismissBtn");
  if (closeDetailBtn) closeDetailBtn.addEventListener("click", closeStudentDetail);
  if (modalDismissBtn) modalDismissBtn.addEventListener("click", closeStudentDetail);

  const modalCopyHistoryBtn = document.getElementById("modalCopyHistoryBtn");
  if (modalCopyHistoryBtn) modalCopyHistoryBtn.addEventListener("click", copyStudentHistory);

  const studentDetailModal = document.getElementById("studentDetailModal");
  if (studentDetailModal) {
    studentDetailModal.addEventListener("click", (e) => {
      if (e.target === studentDetailModal) closeStudentDetail();
    });
  }

  const testWebhookBtn = document.getElementById("testWebhookBtn");
  if (testWebhookBtn) testWebhookBtn.addEventListener("click", testWebhookPing);

  const openSheetBtn = document.getElementById("openSheetBtn");
  if (openSheetBtn) {
    openSheetBtn.addEventListener("click", () => window.open(DEFAULT_SHEET_URL, "_blank"));
  }

  setupLiveBroadcastListener();
  fetchMonitorLogs();
  if (!monitorInterval) {
    monitorInterval = setInterval(fetchMonitorLogs, 3000);
  }
});
