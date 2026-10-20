/**
 * Real-time Live Proctor Monitor Engine (for monitor.html)
 * Version: v5.2
 */

let allLogs = [];
let recentLocalLiveEvents = [];
let previousViolationCount = 0;
let monitorInterval = null;
let isFetchingMonitorLogs = false;
const MONITOR_POLL_INTERVAL_MS = 8000; // 8 วินาที ช่วยลดภาระ Google Apps Script ลง 80% ป้องกันระบบล่ม
let currentPrimaryMode = "live"; // "live" | "archive"
let currentMonitorTab = "live"; // "live" | "completed" | "table"
let currentFilter = "all"; // "all" | "alert" | "today"
let completedDateFilter = "all"; // "all" | "YYYY-MM-DD"
let selectedMonitorCategory = "live"; // "all" | "live" | "alert" | "completed"
let studentsData = {};
let liveStudents = [];
let completedStudents = [];
let activeModalStudentId = null;
let sessionCutoffTime = parseInt(localStorage.getItem("examSessionCutoff") || "0", 10);
let adminLiveChannel = null;
let soundAlertEnabled = localStorage.getItem("examMonitorSoundEnabled") !== "false";

let cachedAudioCtx = null;
function getAudioContext() {
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    if (!cachedAudioCtx) {
      cachedAudioCtx = new AudioContextClass();
    }
    if (cachedAudioCtx.state === "suspended") {
      cachedAudioCtx.resume().catch(() => {});
    }
    return cachedAudioCtx;
  } catch (_) {
    return null;
  }
}

function setupAudioUnlock() {
  const unlock = () => {
    try {
      const ctx = getAudioContext();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
    } catch (_) {}
    document.removeEventListener("click", unlock);
    document.removeEventListener("keydown", unlock);
  };
  document.addEventListener("click", unlock, { once: true });
  document.addEventListener("keydown", unlock, { once: true });
}

// Audio Chime for Admin Monitor
function playAdminChime() {
  if (!soundAlertEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
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

function updateSoundButtonUI() {
  const btn = document.getElementById("toggleSoundBtn");
  if (!btn) return;
  if (soundAlertEnabled) {
    btn.innerHTML = `🔔 เสียงเตือน: เปิด`;
    btn.classList.remove("muted");
    btn.title = "คลิกเพื่อปิดเสียงแจ้งเตือน";
  } else {
    btn.innerHTML = `🔕 เสียงเตือน: ปิด`;
    btn.classList.add("muted");
    btn.title = "คลิกเพื่อเปิดเสียงแจ้งเตือน";
  }
}

function toggleSoundAlert() {
  soundAlertEnabled = !soundAlertEnabled;
  localStorage.setItem("examMonitorSoundEnabled", soundAlertEnabled ? "true" : "false");
  updateSoundButtonUI();
  if (soundAlertEnabled) {
    playAdminChime();
    showAlert("เปิดเสียงแจ้งเตือนเหตุการณ์ผิดปกติแล้ว", { type: "info" });
  } else {
    showAlert("ปิดเสียงแจ้งเตือนเรียบร้อยแล้ว", { type: "neutral" });
  }
}

function getStudentElapsedDuration(s) {
  let startMs = null;
  if (s.startTime) {
    startMs = parseLogTimestampMs({ time: s.startTime }) || parseLogTimestampMs({ timestamp: s.startTime });
  }
  if (!startMs && s.logs && s.logs.length > 0) {
    startMs = parseLogTimestampMs(s.logs[0]);
  }
  if (!startMs) return s.isSubmitted ? "ส่งแล้ว" : "เพิ่งเริ่มสอบ";

  const endMs = s.isSubmitted 
    ? (parseLogTimestampMs({ time: s.submitTime }) || parseLogTimestampMs({ timestamp: s.submitTime }) || Date.now())
    : Date.now();

  const diffMins = Math.max(0, Math.floor((endMs - startMs) / 60000));
  if (diffMins < 1) return s.isSubmitted ? "ใช้เวลา < 1 นาที" : "เพิ่งเริ่ม (< 1 นาที)";
  if (diffMins < 60) return s.isSubmitted ? `ใช้เวลา ${diffMins} นาที` : `สอบมาแล้ว ${diffMins} นาที`;
  const hours = Math.floor(diffMins / 60);
  const remMins = diffMins % 60;
  return s.isSubmitted ? `ใช้เวลา ${hours} ชม. ${remMins} นาที` : `สอบมาแล้ว ${hours} ชม. ${remMins} นาที`;
}

function updateLiveIncidentTicker(alertInfo) {
  const ticker = document.getElementById("liveIncidentTicker");
  const badge = document.getElementById("tickerBadge");
  const msg = document.getElementById("tickerMessage");
  const timeEl = document.getElementById("tickerTime");
  if (!ticker || !badge || !msg || !timeEl) return;

  if (alertInfo && alertInfo.s && alertInfo.log) {
    ticker.className = "live-incident-ticker danger compact-ticker";
    badge.textContent = "🚨 แจ้งเตือนสลับหน้าจอสด!";
    const sId = alertInfo.s.studentId;
    const roomInfo = alertInfo.s.roomTitle ? ` (ห้อง: ${alertInfo.s.roomTitle})` : "";
    const eventText = alertInfo.log.violation || "หลุดจากโหมดเต็มจอ";
    const tStr = formatDisplayTime(alertInfo.log.time, alertInfo.log.timestamp);
    msg.innerHTML = `ตรวจพบความผิดปกติสด: <strong>รหัส ${escapeHtml(sId)}</strong> ${escapeHtml(eventText)}${escapeHtml(roomInfo)} (เตือนครั้งที่ ${alertInfo.s.violationCount}) • คลิกดูประวัติ`;
    timeEl.textContent = `เกิดเหตุเมื่อ: ${tStr}`;
    ticker.style.cursor = "pointer";
    ticker.onclick = () => openStudentDetail(alertInfo.s);
  } else {
    ticker.className = "live-incident-ticker normal compact-ticker";
    badge.textContent = "🟢 สถานะปกติ";
    const activeCount = liveStudents.length;
    msg.textContent = activeCount > 0 
      ? `ระบบกำลังติดตามผู้สอบสด ${activeCount} คนแบบเรียลไทม์ • ทุกคนกำลังทำข้อสอบอย่างซื่อสัตย์` 
      : "ระบบคุมสอบสดพร้อมทำงาน • ยังไม่มีผู้เข้าทำข้อสอบในขณะนี้";
    timeEl.textContent = `ซิงค์สด: ${new Date().toLocaleTimeString("th-TH")}`;
    ticker.style.cursor = "default";
    ticker.onclick = null;
  }
}

function updateArchiveSummaryTicker(completedList, violationsCount) {
  const ticker = document.getElementById("archiveIncidentTicker");
  const badge = document.getElementById("archiveTickerBadge");
  const msg = document.getElementById("archiveTickerMessage");
  const timeEl = document.getElementById("archiveTickerTime");
  if (!ticker || !badge || !msg || !timeEl) return;

  const total = completedList.length;
  const alertStudents = completedList.filter(s => s.hasAlert || s.violationCount > 0);
  const latestStudent = completedList[0];
  const latestTimeStr = latestStudent && latestStudent.submitTime ? formatDisplayTime(latestStudent.submitTime) : null;

  if (alertStudents.length > 0) {
    ticker.className = "live-incident-ticker archive-ticker has-alert compact-ticker";
    badge.textContent = "⚠️ พบบันทึกสลับจอ";
    msg.innerHTML = `คลังประวัติบันทึกการส่งข้อสอบ <strong>${total} คน</strong> • พบบันทึกสลับจอสะสม <strong>${violationsCount} ครั้ง</strong> (ใน ${alertStudents.length} คน) • ประวัติถูกเก็บอย่างปลอดภัย`;
  } else if (total > 0) {
    ticker.className = "live-incident-ticker archive-ticker normal compact-ticker";
    badge.textContent = "✅ ประวัติสมบูรณ์";
    msg.innerHTML = `คลังประวัติบันทึกการส่งข้อสอบ <strong>${total} คน</strong> เรียบร้อยแล้ว • ไม่พบการทำผิดกฎการสอบ • ตรวจสอบประวัติย้อนหลังได้`;
  } else {
    ticker.className = "live-incident-ticker archive-ticker normal compact-ticker";
    badge.textContent = "📁 คลังประวัติ";
    msg.textContent = "ยังไม่มีประวัติการส่งข้อสอบที่บันทึกไว้ในคลัง";
  }

  if (latestTimeStr) {
    timeEl.textContent = `ส่งล่าสุด: ${latestTimeStr}`;
  } else {
    timeEl.textContent = `อัปเดต: ${new Date().toLocaleTimeString("th-TH")}`;
  }
}

function updateIncidentTicker(alertInfo) {
  updateLiveIncidentTicker(alertInfo);
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

const ACKNOWLEDGED_ALERTS_KEY = "examAcknowledgedAlertsMap";

function getAcknowledgedAlertsMap() {
  try {
    const raw = sessionStorage.getItem(ACKNOWLEDGED_ALERTS_KEY) || localStorage.getItem(ACKNOWLEDGED_ALERTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function getAcknowledgedCount(studentId) {
  const map = getAcknowledgedAlertsMap();
  return typeof map[studentId] === "number" ? map[studentId] : 0;
}

function saveAcknowledgedAlert(studentId, count) {
  try {
    const map = getAcknowledgedAlertsMap();
    map[studentId] = count;
    sessionStorage.setItem(ACKNOWLEDGED_ALERTS_KEY, JSON.stringify(map));
    localStorage.setItem(ACKNOWLEDGED_ALERTS_KEY, JSON.stringify(map));
  } catch (_) {}
}

function acknowledgeStudentAlert(studentId) {
  if (!studentId || !studentsData[studentId]) return;
  const s = studentsData[studentId];
  saveAcknowledgedAlert(studentId, s.violationCount);
  if (typeof showAlert === "function") {
    showAlert(`ตรวจสอบรหัส ${studentId} เรียบร้อยแล้ว (สถานะกลับสู่ปกติ)`, { type: "success" });
  }
  renderMonitorLogs();
  if (activeModalStudentId === studentId) {
    updateModalContent(s);
  }
}

function getAccessibleRoomsForCurrentUser() {
  const all = allRooms.length > 0 ? allRooms : (typeof getStoredRooms === "function" ? getStoredRooms() : []);
  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  if (!currentUser || String(currentUser.role).toUpperCase() === USER_ROLES.ADMIN) {
    return all;
  }
  if (typeof isRoomOwnedByUser === "function") {
    return all.filter(r => isRoomOwnedByUser(r, currentUser));
  }
  return all;
}

function updateMonitorRoomFilterDropdown() {
  const sel = document.getElementById("monitorRoomFilterSelect");
  if (!sel) return;

  const currentVal = sel.value || "all";
  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const isAdmin = !currentUser || String(currentUser.role).toUpperCase() === USER_ROLES.ADMIN;
  const accessibleRooms = getAccessibleRoomsForCurrentUser();

  let html = `<option value="all">${isAdmin ? "ทุกห้องสอบ (All Rooms)" : "ทุกห้องสอบของฉัน (My Rooms)"}</option>`;
  accessibleRooms.forEach((r) => {
    html += `<option value="${escapeHtml(r.roomId)}">${escapeHtml(r.title)} (${escapeHtml(r.roomId)})</option>`;
  });
  sel.innerHTML = html;
  if (accessibleRooms.some(r => r.roomId === currentVal)) {
    sel.value = currentVal;
  } else {
    sel.value = "all";
  }
}

function fetchMonitorLogs() {
  if (isFetchingMonitorLogs) return;
  isFetchingMonitorLogs = true;

  const webhookUrl = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  const syncStatus = document.getElementById("syncStatusText");
  const fetchFn = typeof fetchWithTimeout === "function" ? fetchWithTimeout : fetch;

  // Delta Polling: ค้นหา Timestamp ล่าสุดที่มีอยู่ในแคชเพื่อดึงเฉพาะ Log ใหม่
  let latestIso = "";
  if (allLogs.length > 0) {
    for (const item of allLogs) {
      if (item.timestamp && (!latestIso || item.timestamp > latestIso)) {
        latestIso = item.timestamp;
      }
    }
  }

  let reqUrl = webhookUrl;
  try {
    const u = new URL(webhookUrl);
    u.searchParams.set("action", "getLogs");
    if (latestIso) {
      u.searchParams.set("since", latestIso);
    }
    reqUrl = u.toString();
  } catch (_) {}

  const authHeaders = typeof getAuthHeaders === "function" ? getAuthHeaders() : {};
  fetchFn(reqUrl, { headers: { ...authHeaders } }, 6000)
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
      // คง log เดิมไว้ในแคช
      allLogs.forEach((item) => {
        const key = item.logId || `${item.studentId}_${item.violation}_${item.timestamp || item.time}`;
        mergedMap.set(key, item);
      });
      // รวม log ใหม่ที่เพิ่งดึงมา
      fetchedList.forEach((item) => {
        const key = item.logId || `${item.studentId}_${item.violation}_${item.timestamp || item.time}`;
        mergedMap.set(key, item);
      });

      const recentThreshold = Date.now() - 45000;
      recentLocalLiveEvents.forEach((item) => {
        const key = item.logId || `${item.studentId}_${item.violation}_${item.timestamp || item.time}`;
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
    })
    .finally(() => {
      isFetchingMonitorLogs = false;
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

  // การแยกคลังประวัติตาม Role ผู้สร้างห้องสอบ (Requirement 4)
  const accessibleRooms = getAccessibleRoomsForCurrentUser();
  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const isAdmin = !currentUser || String(currentUser.role).toUpperCase() === USER_ROLES.ADMIN;
  const accessibleRoomIds = new Set(accessibleRooms.map(r => String(r.roomId).trim()));
  const accessibleRoomTitles = new Set(accessibleRooms.map(r => String(r.title).trim().toLowerCase()));

  // อัปเดต Scope Badge ในส่วนหัวของคลังประวัติ
  const archiveRoleBadge = document.getElementById("archiveRoleBadge");
  const archiveScopeLead = document.getElementById("archiveScopeLead");
  if (archiveRoleBadge) {
    archiveRoleBadge.textContent = isAdmin 
      ? "สิทธิ์: ผู้ดูแลระบบ (ทุกห้องสอบ)" 
      : `สิทธิ์: ครูผู้สอน (${currentUser ? currentUser.displayName || currentUser.username : "ห้องของฉัน"})`;
    archiveRoleBadge.className = isAdmin ? "badge badge-primary" : "badge badge-neutral";
  }
  if (archiveScopeLead) {
    archiveScopeLead.textContent = isAdmin
      ? "รวบรวมประวัตินักเรียนและบันทึกเหตุการณ์ทั้งหมดของทุกห้องสอบในระบบ"
      : `รวบรวมประวัตินักเรียนที่ส่งข้อสอบและบันทึกเหตุการณ์เฉพาะห้องสอบที่คุณสร้าง (${accessibleRooms.length} ห้อง)`;
  }

  // 1. กรองสิทธิ์ระดับ Role: หากไม่ใช่ Admin ให้ดึงเฉพาะ Log ที่เป็นห้องของครูท่านนี้
  let userScopedLogs = sortedLogs;
  if (!isAdmin) {
    userScopedLogs = sortedLogs.filter(item => {
      const itemRoomId = String(item.roomId || "").trim();
      const itemTitle = String(item.roomTitle || item.formTitle || "").trim().toLowerCase();
      if (itemRoomId && accessibleRoomIds.has(itemRoomId)) return true;
      if (itemTitle && accessibleRoomTitles.has(itemTitle)) return true;
      return accessibleRooms.some(r => {
        const t = String(r.title || "").trim().toLowerCase();
        return t && itemTitle && (itemTitle === t || itemTitle.includes(t));
      });
    });
  }

  // 2. กรองตามห้องที่เลือกใน Dropdown (หากเลือกห้องเฉพาะ)
  userScopedLogs.forEach((item) => {
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
        hasActiveAlert: false,
        isAcknowledged: false,
        acknowledgedCount: 0,
        unacknowledgedCount: 0,
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
  const ackMap = getAcknowledgedAlertsMap();
  let unacknowledgedStudentsCount = 0;

  allList.forEach((s) => {
    s.hasAlert = s.violationCount > 0;
    const ackCount = typeof ackMap[s.studentId] === "number" ? ackMap[s.studentId] : 0;
    s.acknowledgedCount = ackCount;
    // มีแจ้งเตือนสดยังไม่ได้รับการตรวจ หาก violationCount มากกว่าจำนวนที่ตรวจแล้ว (Requirement 2 & 3)
    s.hasActiveAlert = s.violationCount > ackCount;
    s.unacknowledgedCount = Math.max(0, s.violationCount - ackCount);
    s.isAcknowledged = !s.hasActiveAlert && s.violationCount > 0;

    if (s.hasActiveAlert) {
      unacknowledgedStudentsCount++;
    }
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

  // --- 1. สถิติและตัวชี้วัดสำหรับ 🔴 ศูนย์คุมสอบสด (Live Proctoring Center) ---
  // การ์ดและตัวชี้วัดในแท็บนี้ ต้องแสดงเฉพาะเหตุการณ์สดที่กำลังเกิดขึ้น ณ ขณะนี้เท่านั้น
  const totalActive = liveStudents.length;

  // ผู้ที่เพิ่งส่งในรอบสด: จะนับเฉพาะเมื่อมีรอบสดกำลังเปิดสอบอยู่ และมีการตัดรอบ sessionCutoffTime เท่านั้น
  let liveRecentSubmitted = [];
  if (totalActive > 0 && sessionCutoffTime > 0) {
    liveRecentSubmitted = completedStudents.filter(s => {
      const submitMs = s.submitTime ? parseLogTimestampMs({ time: s.submitTime, timestamp: s.submitTime }) : 0;
      return submitMs >= sessionCutoffTime;
    });
  }

  const totalLiveSession = totalActive + liveRecentSubmitted.length;
  // การแจ้งเตือนสลับจอสด: ต้องนับเฉพาะคนที่กำลังสอบสดอยู่ขณะนี้เท่านั้น (ไม่นำประวัติคนที่ส่งข้อสอบแล้วมาปน)
  const liveViolationsCount = liveStudents.reduce((sum, s) => sum + (s.violationCount || 0), 0);
  const unacknowledgedLiveCount = liveStudents.filter(s => s.hasActiveAlert).length;
  const activePercent = totalLiveSession > 0 ? Math.round((totalActive / totalLiveSession) * 100) : 0;
  const liveCompletedPercent = totalLiveSession > 0 ? Math.round((liveRecentSubmitted.length / totalLiveSession) * 100) : 0;

  if (totalStudentsEl) totalStudentsEl.textContent = `${totalLiveSession} คน`;
  if (activeStudentsEl) activeStudentsEl.textContent = `${totalActive} คน`;
  if (totalViolationsEl) totalViolationsEl.textContent = `${liveViolationsCount} ครั้ง`;
  if (totalSubmittedEl) totalSubmittedEl.textContent = `${liveRecentSubmitted.length} คน`;

  // Smart Metrics Hub: Live Progress bars & Sub-details
  const totalProgressFill = document.getElementById("statTotalProgressFill");
  const totalSubDetail = document.getElementById("statTotalSubDetail");
  if (totalProgressFill) totalProgressFill.style.width = totalLiveSession > 0 ? "100%" : "0%";
  if (totalSubDetail) totalSubDetail.textContent = `กำลังสอบ ${activePercent}% • ส่งแล้ว ${liveCompletedPercent}%`;

  const activeProgressFill = document.getElementById("statActiveProgressFill");
  const activeSubDetail = document.getElementById("statActiveSubDetail");
  if (activeProgressFill) activeProgressFill.style.width = `${activePercent}%`;
  if (activeSubDetail) activeSubDetail.textContent = totalActive > 0 ? `🟢 กำลังคุมสอบสด ${totalActive} คน (${activePercent}%)` : `🟢 รอผู้เข้าทำข้อสอบ`;

  const violationsProgressFill = document.getElementById("statViolationsProgressFill");
  const violationsSubDetail = document.getElementById("statViolationsSubDetail");
  const liveAlertStudentsCount = liveStudents.filter(s => s.hasAlert).length;
  const liveAlertPercent = totalLiveSession > 0 ? Math.round((liveAlertStudentsCount / totalLiveSession) * 100) : 0;
  if (violationsProgressFill) violationsProgressFill.style.width = `${liveAlertPercent}%`;
  if (violationsSubDetail) {
    if (unacknowledgedLiveCount > 0) {
      violationsSubDetail.innerHTML = `🚨 ยังไม่ได้ตรวจ ${unacknowledgedLiveCount} คน • เตือนสด ${liveViolationsCount} ครั้ง`;
    } else if (liveViolationsCount > 0) {
      violationsSubDetail.innerHTML = `🟢 ตรวจแล้วครบทุกเหตุการณ์`;
    } else {
      violationsSubDetail.textContent = `✅ ไม่พบการกระทำผิดสด`;
    }
  }

  const submittedProgressFill = document.getElementById("statSubmittedProgressFill");
  const submittedSubDetail = document.getElementById("statSubmittedSubDetail");
  if (submittedProgressFill) submittedProgressFill.style.width = `${liveCompletedPercent}%`;
  const latestLiveStudent = liveRecentSubmitted[0];
  const latestLiveTimeStr = latestLiveStudent && latestLiveStudent.submitTime ? formatDisplayTime(latestLiveStudent.submitTime) : "-";
  if (submittedSubDetail) submittedSubDetail.textContent = `ส่งล่าสุด: ${latestLiveTimeStr}`;

  // --- 2. สถิติและตัวชี้วัดสำหรับ 📁 คลังประวัติและรายงานย้อนหลัง (Exam Archives) ---
  const totalArchiveCount = completedStudents.length;
  const archiveViolationsCount = completedStudents.reduce((sum, s) => sum + (s.violationCount || 0), 0);
  const archiveAlertStudentsCount = completedStudents.filter(s => s.hasAlert || s.violationCount > 0).length;
  const archiveRoomsSet = new Set();
  completedStudents.forEach(s => {
    if (s.roomId) archiveRoomsSet.add(s.roomId);
    else if (s.roomTitle) archiveRoomsSet.add(s.roomTitle);
  });

  const statArchiveTotalEl = document.getElementById("statArchiveTotal");
  const statArchiveTotalSubDetail = document.getElementById("statArchiveTotalSubDetail");
  if (statArchiveTotalEl) statArchiveTotalEl.textContent = `${totalArchiveCount} คน`;
  if (statArchiveTotalSubDetail) statArchiveTotalSubDetail.textContent = totalArchiveCount > 0 ? "บันทึกประวัติครบถ้วนในคลัง" : "ยังไม่มีประวัติการส่ง";

  const statArchiveRoomsEl = document.getElementById("statArchiveRooms");
  const statArchiveRoomsSubDetail = document.getElementById("statArchiveRoomsSubDetail");
  const roomsCount = archiveRoomsSet.size > 0 ? archiveRoomsSet.size : accessibleRooms.length;
  if (statArchiveRoomsEl) statArchiveRoomsEl.textContent = `${roomsCount} ห้อง`;
  if (statArchiveRoomsSubDetail) statArchiveRoomsSubDetail.textContent = isAdmin ? "ทุกห้องสอบในระบบ" : `ห้องสอบที่คุณสร้าง (${accessibleRooms.length} ห้อง)`;

  const statArchiveViolationsEl = document.getElementById("statArchiveViolations");
  const statArchiveViolationsSubDetail = document.getElementById("statArchiveViolationsSubDetail");
  const statArchiveViolationsProgressFill = document.getElementById("statArchiveViolationsProgressFill");
  if (statArchiveViolationsEl) statArchiveViolationsEl.textContent = `${archiveViolationsCount} ครั้ง`;
  if (statArchiveViolationsSubDetail) {
    statArchiveViolationsSubDetail.textContent = archiveAlertStudentsCount > 0 ? `บันทึกใน ${archiveAlertStudentsCount} คน` : "ไม่พบประวัติผิดกฎ";
  }
  if (statArchiveViolationsProgressFill) {
    const archiveAlertPercent = totalArchiveCount > 0 ? Math.round((archiveAlertStudentsCount / totalArchiveCount) * 100) : 0;
    statArchiveViolationsProgressFill.style.width = `${archiveAlertPercent}%`;
  }

  const statArchiveLatestEl = document.getElementById("statArchiveLatest");
  const statArchiveLatestSubDetail = document.getElementById("statArchiveLatestSubDetail");
  const latestArchiveStudent = completedStudents[0];
  const latestArchiveSubTimeStr = latestArchiveStudent && latestArchiveStudent.submitTime ? formatDisplayTime(latestArchiveStudent.submitTime) : "-";
  if (statArchiveLatestEl) statArchiveLatestEl.textContent = latestArchiveSubTimeStr;
  if (statArchiveLatestSubDetail) {
    const meta = latestArchiveStudent ? getStudentDateMeta(latestArchiveStudent) : null;
    statArchiveLatestSubDetail.textContent = meta ? meta.titleShort : "ยังไม่มีข้อมูล";
  }

  // อัปเดตแถบประกาศคลังประวัติ
  updateArchiveSummaryTicker(completedStudents, archiveViolationsCount);

  // Primary Mode Badges
  const primaryLiveCountPill = document.getElementById("primaryLiveCountPill");
  const primaryArchiveCountPill = document.getElementById("primaryArchiveCountPill");
  if (primaryLiveCountPill) primaryLiveCountPill.textContent = totalActive;
  if (primaryArchiveCountPill) primaryArchiveCountPill.textContent = totalArchiveCount;

  if (countLiveBadge) countLiveBadge.textContent = totalActive;
  if (countCompletedBadge) countCompletedBadge.textContent = totalArchiveCount;
  if (completedHeaderCount) completedHeaderCount.textContent = totalArchiveCount;

  const clearCutoffBtn = document.getElementById("clearCutoffBtn");
  if (clearCutoffBtn) {
    clearCutoffBtn.style.display = sessionCutoffTime > 0 ? "inline-flex" : "none";
  }

  // ซิงค์สถานะ Active ของ Stat Cards สดทั้ง 4 ใบ
  const cardMap = {
    all: "statCardAll",
    live: "statCardActive",
    alert: "statCardViolations",
    completed: "statCardSubmitted"
  };
  Object.keys(cardMap).forEach(key => {
    const el = document.getElementById(cardMap[key]);
    if (el) {
      el.classList.toggle("active", key === selectedMonitorCategory && currentPrimaryMode === "live");
    }
  });

  // ซิงค์สถานะ Active ของ Stat Cards คลังประวัติ
  const archiveCardMap = {
    all: "statArchiveTotalCard",
    rooms: "statArchiveRoomsCard",
    alert: "statArchiveViolationsCard",
    latest: "statArchiveLatestCard"
  };
  Object.keys(archiveCardMap).forEach(key => {
    const el = document.getElementById(archiveCardMap[key]);
    if (el) {
      el.classList.toggle("active", key === selectedArchiveCategory && currentPrimaryMode === "archive");
    }
  });

  updateFilterBadges();

  // Find latest active unacknowledged incident among active live students for the Live Ticker
  let latestAlertStudent = null;
  let latestAlertTimeMs = 0;
  liveStudents.forEach(s => {
    if (s.hasActiveAlert && s.logs && s.logs.length > 0) {
      for (let i = s.logs.length - 1; i >= 0; i--) {
        const l = s.logs[i];
        const v = String(l.violation || "");
        if (!v.includes("เริ่มเข้าทำข้อสอบ") && !v.includes("ส่งข้อสอบเรียบร้อย")) {
          const t = parseLogTimestampMs(l) || 0;
          if (t > latestAlertTimeMs) {
            latestAlertTimeMs = t;
            latestAlertStudent = { s, log: l };
          }
          break;
        }
      }
    }
  });
  updateLiveIncidentTicker(latestAlertStudent);

  if (liveViolationsCount > previousViolationCount && previousViolationCount > 0) {
    playAdminChime();
  }
  previousViolationCount = liveViolationsCount;

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

  const allList = Object.values(studentsData).filter(s => !s.isTestPing);
  let activePool = allList;
  if (selectedMonitorCategory === "live") {
    activePool = liveStudents;
  } else if (selectedMonitorCategory === "alert") {
    activePool = allList.filter(s => s.hasAlert || s.violationCount > 0);
  } else if (selectedMonitorCategory === "completed") {
    activePool = completedStudents;
  }

  if (badgeAll) badgeAll.textContent = activePool.length;
  if (badgeAlert) badgeAlert.textContent = activePool.filter(s => s.hasAlert || s.violationCount > 0).length;
  if (badgeToday) badgeToday.textContent = activePool.filter(s => !s.isOldDate).length;
}

function renderStudentCardHtml(s, isCompletedView) {
  let cardClass = "student-screen-card";
  let statusBadge = "";
  let statusText = "🟢 ปกติ";

  if (s.isSubmitted) {
    cardClass += " is-submitted";
    if (s.hasActiveAlert) {
      cardClass += " has-alert";
      statusBadge = `
        <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap; justify-content: flex-end;">
          <span class="badge badge-danger" title="พบเหตุการณ์สลับหน้าจอ (ยังไม่ได้ตรวจ)">
            ⚠️ เตือน ${s.violationCount} ครั้ง
          </span>
          <span class="badge badge-success">ส่งข้อสอบแล้ว</span>
        </div>
      `;
      statusText = `⚠️ ส่งแล้ว (เตือน ${s.violationCount} ครั้ง)`;
    } else if (s.isAcknowledged) {
      cardClass += " is-acknowledged";
      statusBadge = `
        <div style="display: flex; gap: 4px; align-items: center; flex-wrap: wrap; justify-content: flex-end;">
          <span class="badge badge-acknowledged" title="ผู้คุมสอบตรวจรับทราบแล้ว">
            🟢 ตรวจแล้ว (${s.violationCount} ครั้ง)
          </span>
          <span class="badge badge-success">ส่งข้อสอบแล้ว</span>
        </div>
      `;
      statusText = `✅ ส่งแล้ว (ตรวจแล้ว ${s.violationCount} ครั้ง)`;
    } else {
      statusBadge = `<span class="badge badge-success">ส่งข้อสอบแล้ว</span>`;
      statusText = "✅ ส่งข้อสอบแล้ว";
    }
  } else if (s.hasActiveAlert) {
    cardClass += " has-alert";
    statusBadge = `
      <span class="badge badge-danger">
        <span class="radar-beacon" style="margin-right: 4px;"></span>
        เตือน ${s.violationCount} ครั้ง
      </span>
    `;
    statusText = "🚨 พบการแจ้งเตือนสลับจอ";
  } else if (s.isAcknowledged) {
    cardClass += " is-acknowledged";
    statusBadge = `
      <span class="badge badge-acknowledged">
        🟢 ตรวจแล้ว (${s.violationCount} ครั้ง)
      </span>
    `;
    statusText = "🟢 ปกติ (ตรวจแล้ว)";
  } else {
    statusBadge = `<span class="badge badge-primary">กำลังสอบ</span>`;
  }

  const startTimeStr = formatDisplayTime(s.startTime);
  const lastTimeStr = formatDisplayTime(s.lastEventTime, s.lastEventIso);
  const datePrefix = isCompletedView && s.dateMeta && s.dateMeta.titleShort ? `📅 ${escapeHtml(s.dateMeta.titleShort)} • ` : "";
  const durationText = getStudentElapsedDuration(s);

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
              ${datePrefix}⏱️ ${escapeHtml(durationText)} (เริ่ม: ${startTimeStr})
            </div>
            ${s.roomTitle ? `<div style="font-size: 11px; color: var(--primary); font-weight: 600; margin-top: 2px; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 170px;" title="${escapeHtml(s.roomTitle)}">📚 ${escapeHtml(s.roomTitle)}</div>` : ""}
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
              <div class="screen-status-center ${s.hasActiveAlert ? "alert" : (s.isAcknowledged ? "acknowledged" : "success")}">
                <div style="font-size: 26px;">${s.hasActiveAlert ? "⚠️" : "📝"}</div>
                <div style="font-size: 13px; font-weight: 700; color: ${s.hasActiveAlert ? "#b91c1c" : "#059669"}; margin-top: 4px;">
                  ${s.hasActiveAlert 
                    ? `ส่งแล้ว (เตือน ${s.violationCount} ครั้ง - ยังไม่ตรวจ)` 
                    : (s.isAcknowledged ? `ส่งข้อสอบแล้ว (ตรวจแล้ว ${s.violationCount} ครั้ง)` : "ส่งข้อสอบสำเร็จ")}
                </div>
                <div style="font-size: 11px; color: var(--text-muted);">ส่งเมื่อ: ${formatDisplayTime(s.submitTime)}</div>
                ${s.roomTitle ? `<div style="font-size: 11px; color: #047857; margin-top: 3px; font-weight: 600; text-overflow: ellipsis; overflow: hidden; white-space: nowrap; max-width: 200px;" title="${escapeHtml(s.roomTitle)}">วิชา: ${escapeHtml(s.roomTitle)}</div>` : ""}
              </div>
            ` : (s.hasActiveAlert ? `
              <div class="screen-status-center alert">
                <div style="font-size: 28px;">🚨</div>
                <div style="font-size: 12.5px; font-weight: 700; color: #dc2626; margin-top: 4px;">ตรวจพบการสลับจอ / หลุดเต็มจอ</div>
                <div style="font-size: 11px; color: #991b1b; max-width: 180px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${escapeHtml(s.lastEventText)}</div>
              </div>
            ` : (s.isAcknowledged ? `
              <div class="screen-status-center acknowledged">
                <div style="font-size: 26px;">🟢</div>
                <div style="font-size: 12.5px; font-weight: 600; color: #059669; margin-top: 4px;">สถานะปกติ (ตรวจสอบแล้ว)</div>
                <div style="font-size: 11px; color: var(--text-muted);">ตรวจแล้ว ${s.violationCount} ครั้ง • เฝ้าระวังต่อ</div>
              </div>
            ` : `
              <div class="screen-status-center normal">
                <div class="radar-beacon" style="width: 14px; height: 14px; margin-bottom: 6px;"></div>
                <div style="font-size: 12.5px; font-weight: 600; color: #2563eb;">กำลังทำข้อสอบอย่างซื่อสัตย์</div>
                <div style="font-size: 11px; color: var(--text-muted);">โหมดคุมสอบเต็มหน้าจอ</div>
              </div>
            `))}
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
        <div style="display: flex; gap: 6px; align-items: center;">
          ${s.hasActiveAlert ? `
            <button type="button" class="screen-ack-btn" data-student-id="${escapeHtml(s.studentId)}" title="คลิกเมื่อตรวจสอบแล้ว เพื่อรีเซ็ตสถานะกลับเป็นปกติ">
              ✅ ตรวจแล้ว
            </button>
          ` : ""}
          <button class="btn btn-secondary screen-view-detail-btn" data-student-id="${escapeHtml(s.studentId)}" style="min-height: 32px; padding: 4px 10px; font-size: 12px;">
            ประวัติ
          </button>
        </div>
      </div>
    </div>
  `;
}

function selectMonitorCategory(category) {
  selectedMonitorCategory = category;

  // หากอยู่ในหน้าคลังประวัติ ให้สลับกลับมาที่หน้าจอคุมสอบสดเพื่อแสดงการ์ดตามหมวดที่เลือก
  if (currentPrimaryMode !== "live") {
    currentPrimaryMode = "live";
    const liveBtn = document.getElementById("primaryModeLiveBtn");
    const archiveBtn = document.getElementById("primaryModeArchiveBtn");
    const liveZone = document.getElementById("liveProctorZone");
    const archiveZone = document.getElementById("archiveZone");

    if (liveBtn) liveBtn.classList.add("active");
    if (archiveBtn) archiveBtn.classList.remove("active");
    if (liveZone) liveZone.style.display = "block";
    if (archiveZone) archiveZone.style.display = "none";
  }

  // อัปเดตสถานะ Active ของ Stat Cards ทั้ง 4 ใบ
  const cardMap = {
    all: "statCardAll",
    live: "statCardActive",
    alert: "statCardViolations",
    completed: "statCardSubmitted"
  };

  Object.keys(cardMap).forEach(key => {
    const el = document.getElementById(cardMap[key]);
    if (el) {
      el.classList.toggle("active", key === category);
    }
  });

  const query = (document.getElementById("searchLogInput") ? document.getElementById("searchLogInput").value : "").trim().toLowerCase();
  renderSelectedCategoryGrid(query);
  updateFilterBadges();
}

let selectedArchiveCategory = "all";

function selectArchiveCategory(category) {
  selectedArchiveCategory = category;

  if (currentPrimaryMode !== "archive") {
    switchPrimaryMonitorMode("archive");
  }

  const archiveCardMap = {
    all: "statArchiveTotalCard",
    rooms: "statArchiveRoomsCard",
    alert: "statArchiveViolationsCard",
    latest: "statArchiveLatestCard"
  };

  Object.keys(archiveCardMap).forEach(key => {
    const el = document.getElementById(archiveCardMap[key]);
    if (el) {
      el.classList.toggle("active", key === category);
    }
  });

  const query = (document.getElementById("searchLogInput") ? document.getElementById("searchLogInput").value : "").trim().toLowerCase();
  renderCompletedScreensGrid(query);
  renderTableLogs(query);
}

function renderLiveScreensGrid(query) {
  renderSelectedCategoryGrid(query);
}

function renderSelectedCategoryGrid(query) {
  const container = document.getElementById("studentScreensGrid");
  const titleText = document.getElementById("monitorZoneTitleText");
  const iconEl = document.getElementById("monitorZoneIcon");
  const countBadge = document.getElementById("monitorCategoryCountBadge");
  if (!container) return;

  const liveAlertStudents = liveStudents.filter(s => s.hasAlert || s.violationCount > 0);
  const totalCombined = Object.values(studentsData).filter(s => !s.isTestPing).length;
  const totalAlert = Object.values(studentsData).filter(s => !s.isTestPing && (s.hasAlert || s.violationCount > 0)).length;
  const totalCompleted = completedStudents.length;

  let pool = [];
  let categoryTitle = "";
  let categoryIcon = "";
  let emptyTitle = "";
  let emptyDesc = "";

  switch (selectedMonitorCategory) {
    case "alert":
      pool = liveAlertStudents;
      categoryTitle = "ผู้สอบสดที่พบการแจ้งเตือนสลับจอ (Live Violations)";
      categoryIcon = "⚠️";
      emptyTitle = "✅ ไม่พบการแจ้งเตือนสด";
      emptyDesc = "ผู้เข้าสอบสดทุกคนอยู่ในโหมดเต็มหน้าจอและทำข้อสอบด้วยความซื่อสัตย์";
      break;

    case "completed":
      pool = liveRecentSubmitted;
      categoryTitle = "ผู้ที่ส่งข้อสอบแล้วในรอบสด (Submitted in Live Session)";
      categoryIcon = "🏆";
      emptyTitle = "ยังไม่มีผู้ส่งข้อสอบในรอบสด";
      emptyDesc = "ประวัติผู้ที่ส่งข้อสอบทั้งหมดจะถูกจัดเก็บไว้ใน '📁 คลังประวัติ & รายงานย้อนหลัง'";
      break;

    case "all":
    case "live":
    default:
      pool = liveStudents;
      categoryTitle = "จอภาพผู้สอบสด (Real-time Live Monitors)";
      categoryIcon = `<span class="live-pulse-dot" style="width: 8px; height: 8px;"></span>`;
      emptyTitle = "ขณะนี้ยังไม่มีผู้เข้าทำข้อสอบสด";
      emptyDesc = "เมื่อนักเรียนเปิดลิงก์และเริ่มสอบ หน้าจอสดจะปรากฏขึ้นที่นี่โดยอัตโนมัติ";
      break;
  }

  // อัปเดตส่วนหัวของจอคุมสอบสด
  if (titleText) titleText.textContent = categoryTitle;
  if (iconEl) {
    if (selectedMonitorCategory === "live" || selectedMonitorCategory === "all") {
      iconEl.className = "live-pulse-dot";
      iconEl.style.display = "inline-block";
      iconEl.textContent = "";
    } else {
      iconEl.className = "";
      iconEl.style.display = "inline";
      iconEl.textContent = categoryIcon;
    }
  }

  // ตัวกรองย่อยเพิ่มเติม (ค้นหา / พบแจ้งเตือน / เฉพาะวันนี้)
  let filtered = pool;
  if (query) {
    filtered = filtered.filter(s => 
      s.studentId.toLowerCase().includes(query) || 
      (s.lastEventText && s.lastEventText.toLowerCase().includes(query)) ||
      (s.roomTitle && s.roomTitle.toLowerCase().includes(query))
    );
  }

  if (currentFilter === "alert") {
    filtered = filtered.filter(s => s.hasAlert || s.violationCount > 0);
  } else if (currentFilter === "today") {
    filtered = filtered.filter(s => !s.isOldDate);
  }

  if (countBadge) {
    if (selectedMonitorCategory === "alert") {
      const totalViolationsInAlert = filtered.reduce((acc, s) => acc + (s.violationCount || 0), 0);
      countBadge.textContent = `${filtered.length} คน (${totalViolationsInAlert} ครั้ง)`;
    } else {
      countBadge.textContent = `${filtered.length} คน`;
    }
  }

  // กรณีไม่มีข้อมูล ให้แสดง Empty State พร้อมปุ่มคลิกไปคลังประวัติหากมีข้อมูลในระบบ
  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="screens-empty-state compact-empty-state">
        <div class="monitor-live-badge"><span class="live-dot"></span> หมวดที่เลือก: ${escapeHtml(categoryTitle.split(" (")[0])}</div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" style="width: 38px; height: 38px; color: var(--primary); margin: 0 auto 8px; display: block; opacity: 0.85;">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
          <line x1="8" y1="21" x2="16" y2="21"></line>
          <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
        <h3 style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">${escapeHtml(emptyTitle)}</h3>
        <p style="font-size: 12.5px; color: var(--text-secondary); max-width: 440px; margin: 0 auto 12px; line-height: 1.5;">
          ${escapeHtml(emptyDesc)}
        </p>
        ${totalCompleted > 0 && pool.length === 0 ? `
          <div style="display: flex; gap: 8px; justify-content: center; flex-wrap: wrap;">
            <button type="button" class="btn btn-sm btn-outline-primary" id="btnEmptyViewArchive" style="font-size: 12px; padding: 5px 14px; border-radius: 99px;">
              📁 ดูคลังประวัติผู้ส่งข้อสอบแล้ว (${totalCompleted} คน)
            </button>
            ${totalAlert > 0 ? `
              <button type="button" class="btn btn-sm btn-outline-danger" id="btnEmptyViewArchiveAlert" style="font-size: 12px; padding: 5px 14px; border-radius: 99px; color: #dc2626; border-color: #fecaca; background: #fff1f2;">
                ⚠️ ดูประวัติการแจ้งเตือน (${totalAlert} คน)
              </button>
            ` : ""}
          </div>
        ` : ""}
      </div>
    `;

    const btnArchive = document.getElementById("btnEmptyViewArchive");
    if (btnArchive) btnArchive.addEventListener("click", () => switchPrimaryMonitorMode("archive"));
    const btnArchiveAlert = document.getElementById("btnEmptyViewArchiveAlert");
    if (btnArchiveAlert) btnArchiveAlert.addEventListener("click", () => {
      switchPrimaryMonitorMode("archive");
      selectArchiveCategory("alert");
    });

    return;
  }

  container.innerHTML = filtered.map(s => renderStudentCardHtml(s, selectedMonitorCategory === "completed")).join("");
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
  if (selectedArchiveCategory === "alert" || currentFilter === "alert") {
    filtered = filtered.filter(s => s.hasAlert || s.violationCount > 0);
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

  const accessibleRooms = getAccessibleRoomsForCurrentUser();
  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const isAdmin = !currentUser || String(currentUser.role).toUpperCase() === USER_ROLES.ADMIN;
  const accessibleRoomIds = new Set(accessibleRooms.map(r => String(r.roomId).trim()));
  const accessibleRoomTitles = new Set(accessibleRooms.map(r => String(r.title).trim().toLowerCase()));

  let userLogs = [...allLogs];
  if (!isAdmin) {
    userLogs = userLogs.filter(item => {
      const itemRoomId = String(item.roomId || "").trim();
      const itemTitle = String(item.roomTitle || item.formTitle || "").trim().toLowerCase();
      if (itemRoomId && accessibleRoomIds.has(itemRoomId)) return true;
      if (itemTitle && accessibleRoomTitles.has(itemTitle)) return true;
      return accessibleRooms.some(r => {
        const t = String(r.title || "").trim().toLowerCase();
        return t && itemTitle && (itemTitle === t || itemTitle.includes(t));
      });
    });
  }

  let filtered = userLogs.reverse();
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
  container.querySelectorAll(".screen-ack-btn").forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const sId = btn.getAttribute("data-student-id");
      if (sId) {
        acknowledgeStudentAlert(sId);
      }
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
  const ackBtn = document.getElementById("modalAcknowledgeAlertBtn");

  if (titleEl) titleEl.textContent = `รหัสประจำตัว: ${s.studentId}`;
  if (subEl) subEl.textContent = `ประวัติพฤติกรรมและความซื่อสัตย์ในการสอบ (${s.logs.length} รายการ)`;

  if (statusVal) {
    if (s.isSubmitted) {
      statusVal.innerHTML = s.hasActiveAlert 
        ? `<span style="color:#dc2626; font-weight:700;">ส่งแล้ว (⚠️ เตือน ${s.violationCount} ครั้ง - ยังไม่ตรวจ)</span>` 
        : (s.isAcknowledged 
          ? `<span style="color:#059669; font-weight:700;">ส่งแล้ว (🟢 ตรวจแล้ว ${s.violationCount} ครั้ง)</span>` 
          : `<span style="color:#059669; font-weight:700;">ส่งข้อสอบแล้ว (ปกติ)</span>`);
    } else {
      statusVal.innerHTML = s.hasActiveAlert 
        ? `<span style="color:#dc2626; font-weight:700;">🚨 พบแจ้งเตือนสลับจอ (ยังไม่ตรวจ)</span>` 
        : (s.isAcknowledged 
          ? `<span style="color:#059669; font-weight:700;">🟢 สถานะปกติ (ตรวจแล้ว ${s.violationCount} ครั้ง)</span>` 
          : `<span style="color:#2563eb; font-weight:700;">🟢 กำลังสอบ (ปกติ)</span>`);
    }
  }
  if (violationVal) violationVal.textContent = `${s.violationCount} ครั้ง`;
  if (startTimeVal) startTimeVal.textContent = formatDisplayTime(s.startTime);
  if (lastTimeVal) lastTimeVal.textContent = formatDisplayTime(s.lastEventTime, s.lastEventIso);
  if (countEl) countEl.textContent = `${s.logs.length} รายการ`;

  if (ackBtn) {
    if (s.hasActiveAlert) {
      ackBtn.style.display = "inline-flex";
      ackBtn.disabled = false;
      ackBtn.innerHTML = `✅ ตรวจสอบแล้ว (กลับสู่สถานะปกติ)`;
      ackBtn.onclick = () => {
        acknowledgeStudentAlert(s.studentId);
      };
    } else if (s.isAcknowledged) {
      ackBtn.style.display = "inline-flex";
      ackBtn.disabled = true;
      ackBtn.innerHTML = `✓ ตรวจสอบแล้ว (${s.violationCount} ครั้ง)`;
      ackBtn.onclick = null;
    } else {
      ackBtn.style.display = "none";
      ackBtn.onclick = null;
    }
  }

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

function switchPrimaryMonitorMode(mode) {
  currentPrimaryMode = mode;
  const liveBtn = document.getElementById("primaryModeLiveBtn");
  const archiveBtn = document.getElementById("primaryModeArchiveBtn");
  const liveZone = document.getElementById("liveProctorZone");
  const archiveZone = document.getElementById("archiveZone");

  if (liveBtn) liveBtn.classList.toggle("active", mode === "live");
  if (archiveBtn) archiveBtn.classList.toggle("active", mode === "archive");
  if (liveZone) liveZone.style.display = mode === "live" ? "block" : "none";
  if (archiveZone) archiveZone.style.display = mode === "archive" ? "block" : "none";

  if (mode === "live") {
    currentMonitorTab = "live";
    const liveContainer = document.getElementById("screensGridContainer");
    if (liveContainer) liveContainer.style.display = "block";
    selectMonitorCategory(selectedMonitorCategory || "live");
  } else {
    // หากเข้าหน้าคลังประวัติ ให้ถอน active จากการ์ดฝั่งสด
    ["statCardAll", "statCardActive", "statCardViolations", "statCardSubmitted"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove("active");
    });
    if (currentMonitorTab === "live") {
      currentMonitorTab = "completed";
    }
    switchToMonitorTab(currentMonitorTab);
    selectArchiveCategory(selectedArchiveCategory || "all");
  }
  updateFilterBadges();
}

function switchToMonitorTab(tab) {
  currentMonitorTab = tab;
  if (tab === "live") {
    switchPrimaryMonitorMode("live");
    return;
  }

  if (currentPrimaryMode !== "archive") {
    currentPrimaryMode = "archive";
    const liveBtn = document.getElementById("primaryModeLiveBtn");
    const archiveBtn = document.getElementById("primaryModeArchiveBtn");
    const liveZone = document.getElementById("liveProctorZone");
    const archiveZone = document.getElementById("archiveZone");

    if (liveBtn) liveBtn.classList.remove("active");
    if (archiveBtn) archiveBtn.classList.add("active");
    if (liveZone) liveZone.style.display = "none";
    if (archiveZone) archiveZone.style.display = "block";
  }

  const compBtn = document.getElementById("toggleCompletedViewBtn");
  const tableBtn = document.getElementById("toggleTableViewBtn");
  const compContainer = document.getElementById("completedGridContainer");
  const tableContainer = document.getElementById("tableViewContainer");

  if (compBtn) compBtn.classList.toggle("active", tab === "completed");
  if (tableBtn) tableBtn.classList.toggle("active", tab === "table");

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

function exportLogsToCsv() {
  if (!allLogs || allLogs.length === 0) {
    showAlert("ยังไม่มีข้อมูลบันทึกเหตุการณ์สำหรับการส่งออก", { type: "info" });
    return;
  }

  const accessibleRooms = getAccessibleRoomsForCurrentUser();
  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const isAdmin = !currentUser || String(currentUser.role).toUpperCase() === USER_ROLES.ADMIN;
  const accessibleRoomIds = new Set(accessibleRooms.map(r => String(r.roomId).trim()));

  let exportList = [...allLogs];
  if (!isAdmin) {
    exportList = exportList.filter(l => l.roomId && accessibleRoomIds.has(String(l.roomId).trim()));
  }

  exportList.sort((a, b) => {
    const tA = parseLogTimestampMs(a) || 0;
    const tB = parseLogTimestampMs(b) || 0;
    return tA - tB;
  });

  const headers = ["ลำดับ", "วันเวลา", "รหัสนักเรียน", "รหัสห้องสอบ", "ชื่อห้องสอบ", "ประเภทเหตุการณ์", "รายละเอียดเหตุการณ์", "จำนวนเตือนสะสม", "ระดับความรุนแรง"];
  const rows = exportList.map((item, idx) => {
    const timeStr = formatDisplayTime(item.time, item.timestamp);
    const sId = item.studentId || "-";
    const rId = item.roomId || "-";
    const title = item.roomTitle || item.formTitle || "-";
    const eType = item.eventType || "VIOLATION";
    const detail = item.violation || "-";
    const vCount = item.violationCount || 0;
    const severity = item.severity || "⚠️ ทั่วไป";

    const escapeCsv = (val) => `"${String(val).replace(/"/g, '""')}"`;

    return [
      idx + 1,
      escapeCsv(timeStr),
      escapeCsv(sId),
      escapeCsv(rId),
      escapeCsv(title),
      escapeCsv(eType),
      escapeCsv(detail),
      vCount,
      escapeCsv(severity)
    ].join(",");
  });

  const csvContent = "\uFEFF" + [headers.join(","), ...rows].join("\r\n");
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const nowStr = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `Exam_Proctor_Logs_${nowStr}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showAlert(`ส่งออกข้อมูล ${exportList.length} รายการเป็นไฟล์ Excel CSV เรียบร้อยแล้ว`, { type: "success" });
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof requireAuth === "function" && !requireAuth()) return;

  setupMobileNavigation();
  setupAudioUnlock();
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

  // ตัวเลือกประเภทจาก Stat Cards ฝั่งสดทั้ง 4 ด้านบน (คลิกเพื่อแสดงตามประเภท)
  const statCardAll = document.getElementById("statCardAll");
  if (statCardAll) {
    statCardAll.addEventListener("click", () => selectMonitorCategory("all"));
    statCardAll.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") selectMonitorCategory("all"); });
  }

  const statCardActive = document.getElementById("statCardActive");
  if (statCardActive) {
    statCardActive.addEventListener("click", () => selectMonitorCategory("live"));
    statCardActive.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") selectMonitorCategory("live"); });
  }

  const statCardViolations = document.getElementById("statCardViolations");
  if (statCardViolations) {
    statCardViolations.addEventListener("click", () => selectMonitorCategory("alert"));
    statCardViolations.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") selectMonitorCategory("alert"); });
  }

  const statCardSubmitted = document.getElementById("statCardSubmitted");
  if (statCardSubmitted) {
    statCardSubmitted.addEventListener("click", () => selectMonitorCategory("completed"));
    statCardSubmitted.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") selectMonitorCategory("completed"); });
  }

  // ตัวเลือกประเภทจาก Stat Cards ฝั่งคลังประวัติ (คลิกเพื่อแสดงตามประเภท)
  const statArchiveTotalCard = document.getElementById("statArchiveTotalCard");
  if (statArchiveTotalCard) {
    statArchiveTotalCard.addEventListener("click", () => selectArchiveCategory("all"));
    statArchiveTotalCard.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") selectArchiveCategory("all"); });
  }

  const statArchiveRoomsCard = document.getElementById("statArchiveRoomsCard");
  if (statArchiveRoomsCard) {
    statArchiveRoomsCard.addEventListener("click", () => selectArchiveCategory("rooms"));
    statArchiveRoomsCard.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") selectArchiveCategory("rooms"); });
  }

  const statArchiveViolationsCard = document.getElementById("statArchiveViolationsCard");
  if (statArchiveViolationsCard) {
    statArchiveViolationsCard.addEventListener("click", () => selectArchiveCategory("alert"));
    statArchiveViolationsCard.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") selectArchiveCategory("alert"); });
  }

  const statArchiveLatestCard = document.getElementById("statArchiveLatestCard");
  if (statArchiveLatestCard) {
    statArchiveLatestCard.addEventListener("click", () => selectArchiveCategory("latest"));
    statArchiveLatestCard.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") selectArchiveCategory("latest"); });
  }

  // แถบ Filter Pills ใน Toolbar ย่อย
  const monitorFilterPills = document.querySelectorAll("#monitorFilterPills .filter-pill");
  monitorFilterPills.forEach(pill => {
    pill.addEventListener("click", () => {
      monitorFilterPills.forEach(p => p.classList.remove("active"));
      pill.classList.add("active");
      currentFilter = pill.getAttribute("data-filter") || "all";
      const query = (document.getElementById("searchLogInput") ? document.getElementById("searchLogInput").value : "").trim().toLowerCase();
      renderSelectedCategoryGrid(query);
    });
  });

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

  const primaryLiveBtn = document.getElementById("primaryModeLiveBtn");
  if (primaryLiveBtn) primaryLiveBtn.addEventListener("click", () => switchPrimaryMonitorMode("live"));

  const primaryArchiveBtn = document.getElementById("primaryModeArchiveBtn");
  if (primaryArchiveBtn) primaryArchiveBtn.addEventListener("click", () => switchPrimaryMonitorMode("archive"));

  const toggleSoundBtn = document.getElementById("toggleSoundBtn");
  if (toggleSoundBtn) toggleSoundBtn.addEventListener("click", toggleSoundAlert);
  updateSoundButtonUI();

  const toggleLiveBtn = document.getElementById("toggleLiveViewBtn");
  if (toggleLiveBtn) toggleLiveBtn.addEventListener("click", () => switchPrimaryMonitorMode("live"));

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
        try {
          sessionStorage.removeItem(ACKNOWLEDGED_ALERTS_KEY);
          localStorage.removeItem(ACKNOWLEDGED_ALERTS_KEY);
        } catch (_) {}
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

  const exportCsvBtn = document.getElementById("exportCsvBtn");
  if (exportCsvBtn) exportCsvBtn.addEventListener("click", exportLogsToCsv);

  const testWebhookBtn = document.getElementById("testWebhookBtn");
  if (testWebhookBtn) testWebhookBtn.addEventListener("click", testWebhookPing);

  const openSheetBtn = document.getElementById("openSheetBtn");
  if (openSheetBtn) {
    openSheetBtn.addEventListener("click", () => window.open(DEFAULT_SHEET_URL, "_blank"));
  }

  setupLiveBroadcastListener();
  fetchMonitorLogs();

  // Smart Adaptive Polling System:
  function startMonitorPolling() {
    stopMonitorPolling();
    monitorInterval = setInterval(fetchMonitorLogs, MONITOR_POLL_INTERVAL_MS);
  }

  function stopMonitorPolling() {
    if (monitorInterval) {
      clearInterval(monitorInterval);
      monitorInterval = null;
    }
  }

  // เริ่มต้น Polling อัตโนมัติ
  startMonitorPolling();

  // Tab Visibility API: เมื่อผู้ใช้ย่อหน้าจอหรือสลับไปแท็บอื่น ให้หยุด Polling ทันที
  // ช่วยลดภาระ Google Apps Script ลง 90% และประหยัดโควตาเซิร์ฟเวอร์
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      stopMonitorPolling();
    } else {
      fetchMonitorLogs();
      startMonitorPolling();
    }
  });
});
