/**
 * Admin Studio & Monitor Engine for index.html (Web App)
 */

let allLogs = [];
let previousViolationCount = 0;
let monitorInterval = null;

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

// 1. Navigation Tab Switching
function setupTabNavigation() {
  const tabs = document.querySelectorAll(".nav-tab-btn");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const targetId = tab.getAttribute("data-target");
      document.querySelectorAll(".view-section").forEach((sec) => {
        sec.classList.remove("active");
      });
      const targetSec = document.getElementById(targetId);
      if (targetSec) targetSec.classList.add("active");

      // หากสลับมาหน้า Monitor ให้ดึงข้อมูลทันที
      if (targetId === "monitorSection") {
        fetchMonitorLogs();
        if (!monitorInterval) {
          monitorInterval = setInterval(fetchMonitorLogs, 3000);
        }
      } else {
        if (monitorInterval) {
          clearInterval(monitorInterval);
          monitorInterval = null;
        }
      }
    });
  });
}

// 2. Sub-site Link Generator — UX-01: Loading state, UX-02: showAlert, UX-05: client-side QR
async function generateExamLink() {
  const title = (document.getElementById("examTitleInput").value || "").trim() || "แบบทดสอบออนไลน์";
  const rawFormUrl = (document.getElementById("examFormUrlInput").value || "").trim();
  const webhookUrl = (document.getElementById("examWebhookInput").value || "").trim() || DEFAULT_WEBHOOK_URL;
  
  // รหัสผ่านผู้คุมสอบ: สุ่มตัวเลข 6 หลักเสมอ (หากเว้นว่างหรือไม่ครบ 6 หลัก ให้สุ่ม 6 หลักใหม่ทันที)
  let passcode = (document.getElementById("examPasscodeInput").value || "").trim();
  if (!passcode || !/^\d{6}$/.test(passcode)) {
    passcode = generateRandomPasscode();
    const passInputEl = document.getElementById("examPasscodeInput");
    if (passInputEl) passInputEl.value = passcode;
  }

  if (!rawFormUrl) {
    await showAlert("กรุณาระบุลิงก์ Google Forms ก่อนสร้างห้องสอบ", {
      type: "warning",
      title: "ข้อมูลไม่ครบถ้วน",
      confirmText: "เข้าใจแล้ว"
    });
    document.getElementById("examFormUrlInput").focus();
    return;
  }

  // UX-01: Loading State บนปุ่มสร้างลิงก์
  const generateBtn = document.getElementById("generateLinkBtn");
  const origBtnContent = generateBtn ? generateBtn.innerHTML : "";
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.classList.add("is-loading");
    generateBtn.innerHTML = `<span class="btn-spinner"></span> กำลังสร้างห้องสอบและสร้างรหัส QR...`;
  }

  try {
    const cleanFormUrl = formatGoogleFormEmbedUrl(rawFormUrl);

    const roomConfig = {
      title: title,
      formUrl: cleanFormUrl,
      webhookUrl: webhookUrl,
      adminPasscode: passcode,
      createdAt: new Date().toISOString()
    };

    // เข้ารหัส Base64
    const encodedData = encodeExamConfig(roomConfig);

    // สร้างลิงก์ห้องสอบ Sub-link
    const baseUrl = new URL("exam.html", window.location.href);
    baseUrl.searchParams.set("data", encodedData);
    const fullExamUrl = baseUrl.toString();

    // แสดงผลลัพธ์
    const resultBox = document.getElementById("linkResultBox");
    const linkDisplay = document.getElementById("generatedLinkDisplay");
    const testOpenBtn = document.getElementById("testOpenLinkBtn");
    const passcodeDisplay = document.getElementById("generatedPasscodeDisplay");
    const copyPasscodeBtn = document.getElementById("copyPasscodeBtn");

    linkDisplay.value = fullExamUrl;
    testOpenBtn.href = fullExamUrl;
    
    // แสดงรหัสผ่านผู้คุมสอบ 6 หลักในกล่องผลลัพธ์
    if (passcodeDisplay) {
      passcodeDisplay.textContent = passcode;
    }
    if (copyPasscodeBtn) {
      copyPasscodeBtn.onclick = () => {
        navigator.clipboard.writeText(passcode).then(() => {
          const orig = copyPasscodeBtn.textContent;
          copyPasscodeBtn.textContent = "คัดลอกรหัสแล้ว!";
          setTimeout(() => { copyPasscodeBtn.textContent = orig; }, 2000);
        });
      };
    }

    // UX-05: สร้าง QR Code แบบ Client-side คมชัด ขนาด 220px
    const qrWrapper = document.getElementById("examQrContainer") || document.querySelector(".qr-image-wrapper");
    if (qrWrapper) {
      generateQrCode(qrWrapper, fullExamUrl, 220);
    }

    // ปุ่มขยายเต็มจอสำหรับฉายโปรเจกเตอร์
    const zoomQrBtn = document.getElementById("zoomQrBtn");
    const projectorModal = document.getElementById("qrProjectorModal");
    if (zoomQrBtn) {
      zoomQrBtn.onclick = () => {
        const projectorContainer = document.getElementById("projectorQrContainer");
        const projectorTitle = document.getElementById("projectorExamTitle");
        const projectorPasscode = document.getElementById("projectorPasscodeDisplay");

        if (projectorTitle) projectorTitle.textContent = title;
        if (projectorPasscode) projectorPasscode.textContent = passcode;
        if (projectorContainer) {
          generateQrCode(projectorContainer, fullExamUrl, 320);
        }
        if (projectorModal) {
          projectorModal.classList.add("active");
        }
      };
    }

    // ปุ่มดาวน์โหลดรูปภาพ QR Code (.png)
    const downloadQrBtn = document.getElementById("downloadQrBtn");
    if (downloadQrBtn) {
      downloadQrBtn.onclick = () => {
        const canvas = qrWrapper ? qrWrapper.querySelector("canvas") : null;
        const img = qrWrapper ? qrWrapper.querySelector("img") : null;
        let dataUrl = "";
        if (canvas) {
          dataUrl = canvas.toDataURL("image/png");
        } else if (img && img.src) {
          dataUrl = img.src;
        }

        if (dataUrl) {
          const a = document.createElement("a");
          a.href = dataUrl;
          a.download = `Exam-QR-${title.replace(/[^a-zA-Z0-9ก-๙]/g, "_")}.png`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
        } else {
          showAlert("กำลังเตรียมรูปภาพ กรุณารอสักครู่แล้วลองอีกครั้ง", { type: "info" });
        }
      };
    }

    // ปุ่มปิด Modal โปรเจกเตอร์
    const closeProjectorBtn = document.getElementById("closeProjectorBtn");
    if (closeProjectorBtn && projectorModal) {
      closeProjectorBtn.onclick = () => projectorModal.classList.remove("active");
      projectorModal.onclick = (e) => {
        if (e.target === projectorModal) projectorModal.classList.remove("active");
      };
    }

    resultBox.classList.add("active");
    resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });

    // บันทึกประวัติลง LocalStorage
    saveRoomToHistory(roomConfig, fullExamUrl);

    // สุ่มรหัสผ่าน 6 หลักใหม่เตรียมไว้ในช่องกรอกสำหรับการสร้างห้องสอบใหม่ครั้งถัดไปเสมอ
    setTimeout(() => {
      const passInput = document.getElementById("examPasscodeInput");
      if (passInput) {
        passInput.value = generateRandomPasscode();
      }
    }, 1200);
  } finally {
    setTimeout(() => {
      if (generateBtn) {
        generateBtn.disabled = false;
        generateBtn.classList.remove("is-loading");
        generateBtn.innerHTML = origBtnContent;
      }
    }, 350);
  }
}

// บันทึกประวัติห้องสอบ
function saveRoomToHistory(roomConfig, fullUrl) {
  try {
    let history = JSON.parse(localStorage.getItem("examRoomsHistory") || "[]");
    history = history.filter((r) => r.fullUrl !== fullUrl);
    history.unshift({
      title: roomConfig.title,
      formUrl: roomConfig.formUrl,
      adminPasscode: roomConfig.adminPasscode,
      createdAt: new Date().toLocaleString("th-TH"),
      fullUrl: fullUrl
    });
    history = history.slice(0, 10);
    localStorage.setItem("examRoomsHistory", JSON.stringify(history));
    renderRoomHistory();
  } catch (e) {}
}

// แสดงรายการประวัติห้องสอบที่เคยสร้าง
function renderRoomHistory() {
  const container = document.getElementById("historyRoomsList");
  if (!container) return;

  try {
    const history = JSON.parse(localStorage.getItem("examRoomsHistory") || "[]");
    if (history.length === 0) {
      container.innerHTML = `<div style="color: var(--text-muted); font-size: 13px; padding: 12px 0;">ยังไม่มีประวัติการสร้างห้องสอบ</div>`;
      return;
    }

    // BUG-12: ใช้ data-url attribute แทน inline onclick เพื่อป้องกัน XSS
    container.innerHTML = history.map((room, idx) => `
      <div style="background: #ffffff; border: 1.5px solid var(--bg-card-border); border-radius: var(--radius-md); padding: 14px 18px; margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; box-shadow: var(--shadow-sm); flex-wrap: wrap;">
        <div style="overflow: hidden; min-width: 200px; flex: 1;">
          <strong style="display: block; font-size: 14.5px; color: var(--text-primary); text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${escapeHtml(room.title)}</strong>
          <div style="display: flex; align-items: center; gap: 8px; margin-top: 4px; flex-wrap: wrap;">
            <span style="font-size: 12px; color: var(--text-muted); font-weight: 500;">สร้างเมื่อ: ${escapeHtml(room.createdAt)}</span>
            ${room.adminPasscode ? `<span class="badge badge-primary" style="font-family: monospace; letter-spacing: 0.05em; font-size: 11.5px;">รหัสคุมสอบ: ${escapeHtml(room.adminPasscode)}</span>` : ""}
          </div>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary history-copy-btn" data-url="${escapeHtml(room.fullUrl)}" style="min-height: 38px; padding: 6px 14px; font-size: 13px;">คัดลอก</button>
          <a class="btn btn-primary" style="min-height: 38px; padding: 6px 14px; font-size: 13px;" href="${escapeHtml(room.fullUrl)}" target="_blank" rel="noopener noreferrer">เปิดดู</a>
        </div>
      </div>
    `).join("");

    // Event delegation แทน inline onclick (BUG-12 fix)
    container.querySelectorAll(".history-copy-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const url = btn.getAttribute("data-url");
        if (url) {
          navigator.clipboard.writeText(url).then(() => {
            const orig = btn.textContent;
            btn.textContent = "คัดลอกแล้ว";
            setTimeout(() => { btn.textContent = orig; }, 2000);
          });
        }
      });
    });
  } catch (e) {}
}

// เปลี่ยนจาก inline onclick เป็น global function คงสตาเดิมไว้เพื่อ compatibility แต่ใน renderRoomHistory ใช้ data-attribute แทน (BUG-12)
window.copySpecificUrl = function(url) {
  navigator.clipboard.writeText(url).then(() => {
    showAlert("คัดลอกลิงก์ห้องสอบเรียบร้อยแล้ว สามารถนำไปส่งให้นักเรียนได้ทันที", {
      type: "success",
      title: "คัดลอกสำเร็จ",
      confirmText: "ตกลง"
    });
  });
};

let currentMonitorTab = "live"; // "live" | "completed" | "table"
let currentFilter = "all"; // "all" | "alert" | "today"
let studentsData = {};
let liveStudents = [];
let completedStudents = [];
let activeModalStudentId = null;
let sessionCutoffTime = parseInt(localStorage.getItem("examSessionCutoff") || "0", 10);

// Escape HTML helper
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// แปลงและจัดรูปแบบเวลาให้อ่านง่าย สวยงาม และแก้ปัญหาปี 1899 จาก Google Sheets
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

// ดึงค่าเวลาในรูป Timestamp (ms) จาก log item อย่างแม่นยำ รองรับทั้ง ISO, date, time
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
  if (item.time && String(item.time).includes("/")) {
    const tStr = String(item.time).trim();
    const [dPart, timePart] = tStr.split(" ");
    if (dPart) {
      const parts = dPart.split("/");
      if (parts.length === 3) {
        let [d, m, y] = parts.map(Number);
        if (y > 2400) y -= 543;
        const timeParts = String(timePart || "0:0:0").split(":");
        const hours = parseInt(timeParts[0] || "0", 10);
        const mins = parseInt(timeParts[1] || "0", 10);
        const secs = parseInt(timeParts[2] || "0", 10);
        const dt = new Date(y, m - 1, d, hours, mins, secs);
        if (!isNaN(dt.getTime())) return dt.getTime();
      }
    }
  }
  return null;
}

// อัปเดตตัวเลข badge บน filter pills ให้สอดคล้องกับแท็บที่กำลังดู
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

let recentLocalLiveEvents = [];

let adminLiveChannel = null;

// รับสัญญาณ Real-time ตรงจากหน้าจอผู้สอบ (exam.html) ทันที 0ms ผ่าน BroadcastChannel & Storage Event
function setupLiveBroadcastListener() {
  try {
    if (typeof BroadcastChannel !== "undefined") {
      if (adminLiveChannel) {
        try { adminLiveChannel.close(); } catch (_) {}
      }
      adminLiveChannel = new BroadcastChannel("exam_proctor_bus");
      adminLiveChannel.onmessage = (event) => {
        if (event.data && event.data.type === "EXAM_EVENT" && event.data.payload) {
          handleIncomingLiveEvent(event.data.payload);
        }
      };
    }
  } catch (err) {
    console.warn("BroadcastChannel listener setup failed:", err);
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

// ตรวจสอบว่าเป็นข้อมูลทดสอบระบบ (Test Ping / Curl / NodeTest) หรือไม่
function isTestLogEntry(item) {
  if (!item) return false;
  const sId = String(item.studentId !== undefined && item.studentId !== null ? item.studentId : "").trim();
  const sIdLower = sId.toLowerCase();
  const text = String(item.violation || "").toLowerCase();
  return (
    sIdLower.includes("test") ||
    sIdLower.includes("ping") ||
    sIdLower.includes("curl") ||
    sId.includes("ทดสอบ") ||
    sId === "ไม่ระบุชื่อ" ||
    sId === "ไม่ระบุรหัส" ||
    sId.startsWith("{") ||
    sId.includes(":") ||
    text.includes("test ping") ||
    text.includes("test from node") ||
    text.includes("test violation") ||
    text.includes("ทดสอบการเชื่อมต่อ")
  );
}

function handleIncomingLiveEvent(payload) {
  if (!payload || !payload.studentId) return;
  if (isTestLogEntry(payload)) return;

  const exists = allLogs.some((l) => {
    if (String(l.studentId) !== String(payload.studentId)) return false;
    if (String(l.violation) !== String(payload.violation)) return false;
    if (l.timestamp && payload.timestamp && l.timestamp === payload.timestamp) return true;
    if (l.timestamp && payload.timestamp) {
      const diff = Math.abs(new Date(l.timestamp).getTime() - new Date(payload.timestamp).getTime());
      if (diff < 800) return true;
    }
    return false;
  });

  if (!exists) {
    allLogs.push(payload);
    recentLocalLiveEvents.push(payload);
    if (recentLocalLiveEvents.length > 50) recentLocalLiveEvents.shift();

    renderMonitorLogs();
    playAdminChime();

    const syncStatus = document.getElementById("syncStatusText");
    if (syncStatus) {
      syncStatus.textContent = `⚡ อัปเดตสด: ${payload.studentId} (${new Date().toLocaleTimeString("th-TH")})`;
    }
  }
}

// 3. Real-time Admin Monitor Logs Fetcher
function fetchMonitorLogs() {
  const webhookInput = document.getElementById("examWebhookInput");
  const webhookUrl = (webhookInput && webhookInput.value ? webhookInput.value : "").trim() || DEFAULT_WEBHOOK_URL;
  const syncStatus = document.getElementById("syncStatusText");

  if (!webhookUrl) return;

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

      // ผสานข้อมูลจาก Google Sheets เข้ากับ local live events ล่าสุด
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
      try {
        renderMonitorLogs();
        if (syncStatus) {
          syncStatus.textContent = `ซิงค์ล่าสุด: ${new Date().toLocaleTimeString("th-TH")}`;
        }
      } catch (renderErr) {
        console.error("Render error in monitor:", renderErr);
        if (syncStatus) {
          syncStatus.textContent = `ข้อมูล: ${allLogs.length} รายการ`;
        }
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

  const badgeAll = document.getElementById("badgeFilterAll");
  const badgeAlert = document.getElementById("badgeFilterAlert");
  const badgeToday = document.getElementById("badgeFilterToday");
  const countLiveBadge = document.getElementById("countLiveBadge");
  const countCompletedBadge = document.getElementById("countCompletedBadge");
  const completedHeaderCount = document.getElementById("completedHeaderCount");

  studentsData = {};
  let totalViolationsCount = 0;

  // เรียงลำดับ logs ตามเวลาจากเก่าไปใหม่ เพื่อประมวลผล Timeline และแยกแยะเซสชันการสอบ
  const sortedLogs = [...allLogs].sort((a, b) => {
    const tA = parseLogTimestampMs(a) || 0;
    const tB = parseLogTimestampMs(b) || 0;
    return tA - tB;
  });

  const nowMs = Date.now();
  const oneDayMs = 20 * 60 * 60 * 1000; // 20 ชั่วโมง สำหรับตรวจจับวันก่อนหน้า

  sortedLogs.forEach((item) => {
    const sId = String(item.studentId !== undefined && item.studentId !== null ? item.studentId : "ไม่ระบุรหัส").trim();
    const isTestEntry = isTestLogEntry(item);

    if (!studentsData[sId]) {
      studentsData[sId] = {
        studentId: sId,
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
    } else if (isTestEntry) {
      studentsData[sId].isTestPing = true;
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
      // พฤติกรรมละเมิดกฎ (ไม่นับ Test Ping / Test Entry)
      s.violationCount++;
      totalViolationsCount++;
    }

    s.lastEventTime = itemTime;
    s.lastEventIso = itemIso;
    s.lastEventText = text;

    // ตรวจสอบว่าเป็นประวัติของวันก่อนหน้า หรือเกิดก่อนการกดตัดรอบสอบใหม่หรือไม่
    const logDateMs = parseLogTimestampMs(item);
    if (logDateMs !== null && !isNaN(logDateMs)) {
      if (nowMs - logDateMs > oneDayMs) {
        s.isOldDate = true;
      }
      if (sessionCutoffTime > 0 && logDateMs < sessionCutoffTime) {
        s.isBeforeCutoff = true;
      }
    }
  });

  // คัดกรองนักเรียนจริง (ตัด Test Ping ออกจากสถิติผู้เข้าสอบ)
  const allList = Object.values(studentsData).filter(s => !s.isTestPing);
  allList.forEach((s) => {
    s.hasAlert = s.violationCount > 0;
  });

  // จอสด (Live) = ยังไม่ได้ส่งข้อสอบ และ ไม่ใช่ประวัติวันก่อนหน้า และ ไม่ใช่ประวัติก่อนตัดรอบ
  liveStudents = allList.filter((s) => !s.isSubmitted && !s.isOldDate && !s.isBeforeCutoff);

  // ประวัติย้อนหลัง (Completed) = ส่งข้อสอบแล้ว หรือเป็นประวัติของรอบก่อนหน้า/วันก่อนหน้า
  completedStudents = allList.filter((s) => s.isSubmitted || s.isOldDate || s.isBeforeCutoff);

  // เรียงประวัติย้อนหลัง: เอาคนที่ส่งล่าสุดขึ้นก่อน
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

  // เล่นเสียงเตือนเมื่อพบเหตุการณ์ผิดปกติใหม่
  if (totalViolationsCount > previousViolationCount && previousViolationCount > 0) {
    playAdminChime();
  }
  previousViolationCount = totalViolationsCount;

  // เรนเดอร์ทั้ง 3 ส่วน
  renderLiveScreensGrid(query);
  renderCompletedScreensGrid(query);
  renderTableLogs(query);

  // หากเปิด Modal ค้างไว้ ให้อัปเดตข้อมูลข้างในแบบ Real-time ด้วย
  if (activeModalStudentId && studentsData[activeModalStudentId]) {
    updateModalContent(studentsData[activeModalStudentId]);
  }
}

// เรนเดอร์การ์ดจำลองหน้าจอสด (HTML Generator)
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
    statusText = `⚠️ ผิดปกติ ${s.violationCount} ครั้ง`;
  } else if (s.isSubmitted && s.hasAlert) {
    cardClass += " has-alert-submitted";
    statusBadge = `
      <span class="badge badge-warning" style="background: #f59e0b; color: #ffffff; border-color: #d97706; font-weight: 700;">
        <span class="radar-beacon" style="margin-right: 4px; background: #ffffff;"></span>
        ส่งแล้ว (ผิด ${s.violationCount} ครั้ง)
      </span>
    `;
    statusText = `⚠️ ส่งแล้ว (ผิดกฎ ${s.violationCount} ครั้ง)`;
  } else if (s.isSubmitted) {
    cardClass += " is-submitted";
    statusBadge = `<span class="badge badge-success">ส่งข้อสอบแล้ว</span>`;
    statusText = `ส่งข้อสอบแล้ว (ปกติ)`;
  } else {
    cardClass += " is-active-normal";
    statusBadge = `<span class="badge badge-primary">กำลังสอบ</span>`;
    statusText = `กำลังทำข้อสอบ`;
  }

  const lastEventShort = s.lastEventText ? escapeHtml(s.lastEventText) : (isCompletedView ? "ส่งข้อสอบเรียบร้อยแล้ว" : "กำลังทำข้อสอบอย่างต่อเนื่อง");
  const updateTime = formatDisplayTime(isCompletedView ? (s.submitTime || s.lastEventTime) : s.lastEventTime, s.lastEventIso);

  return `
    <div class="${cardClass}" data-student-id="${escapeHtml(s.studentId)}">
      <!-- Card Header -->
      <div class="screen-card-header">
        <div class="screen-card-identity">
          <div class="screen-device-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
              <line x1="8" y1="21" x2="16" y2="21"></line>
              <line x1="12" y1="17" x2="12" y2="21"></line>
            </svg>
          </div>
          <div class="screen-station-text">
            <span class="screen-station-label">${isCompletedView ? "ผู้ส่งข้อสอบ" : "จอผู้สอบสด"}</span>
            <span class="screen-station-id">รหัส ${escapeHtml(s.studentId)}</span>
          </div>
        </div>
        <div>
          ${statusBadge}
        </div>
      </div>

      <!-- Screen Mockup Bezel (จำลองหน้าจอสด) -->
      <div class="screen-mockup-frame">
        <div class="screen-mockup-top">
          <div class="screen-window-dots"><span></span><span></span><span></span></div>
          <span class="screen-mockup-tag">${isCompletedView ? "Completed Exam" : "Live Screen"}</span>
        </div>
        <div class="screen-last-event">
          ${lastEventShort}
        </div>
        <div class="screen-mockup-bottom">
          <span>${isCompletedView ? "ส่งเมื่อ" : "ล่าสุด"}: ${updateTime}</span>
          <span>${statusText}</span>
        </div>
      </div>

      <!-- Card Footer -->
      <div class="screen-card-footer">
        <span style="font-size: 11.5px; color: var(--text-muted); font-weight: 600;">
          บันทึก ${s.logs.length} รายการ
        </span>
        <span class="screen-action-btn">
          ดูรายละเอียดจอ
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </span>
      </div>
    </div>
  `;
}

// ผูก Event คลิกเปิด Modal ให้กับทุกการ์ด
function bindScreenCardEvents(container) {
  if (!container) return;
  container.querySelectorAll(".student-screen-card").forEach((card) => {
    card.addEventListener("click", () => {
      const sid = card.getAttribute("data-student-id");
      if (sid) openStudentDetail(sid);
    });
  });
}

// 1. เรนเดอร์เฉพาะหน้าจอที่กำลังสอบสด (Live Screens Grid)
function renderLiveScreensGrid(query) {
  const gridContainer = document.getElementById("studentScreensGrid");
  if (!gridContainer) return;

  let filtered = liveStudents.filter((s) => {
    if (!query) return true;
    const matchId = String(s.studentId != null ? s.studentId : "").toLowerCase().includes(query);
    const matchLog = s.logs.some((l) => String(l.violation || "").toLowerCase().includes(query));
    return matchId || matchLog;
  });

  if (currentFilter === "alert") {
    filtered = filtered.filter((s) => s.hasAlert);
  } else if (currentFilter === "today") {
    filtered = filtered.filter((s) => !s.isOldDate);
  }

  if (filtered.length === 0) {
    let emptyTitle = "ขณะนี้ยังไม่มีผู้เข้าทำข้อสอบสด";
    let emptyDesc = "ระบบกำลังรอสัญญาณ เมื่อนักเรียนเปิดลิงก์และเริ่มสอบ หน้าจอสดจะปรากฏขึ้นที่นี่โดยอัตโนมัติ";
    if (query) {
      emptyTitle = `ไม่พบผู้สอบสดที่ตรงกับ "${escapeHtml(query)}"`;
      emptyDesc = "ลองค้นหาด้วยรหัสประจำตัวอื่น หรือกดดูในหมวด 'ประวัติผู้ส่งข้อสอบแล้ว'";
    } else if (currentFilter === "alert") {
      emptyTitle = "ยอดเยี่ยม! ไม่พบการแจ้งเตือนสด";
      emptyDesc = "ไม่มีผู้สอบสดคนใดที่ตรวจพบการผิดกฎในขณะนี้";
    }

    gridContainer.innerHTML = `
      <div class="screens-empty-state" style="grid-column: 1 / -1; padding: 48px 20px; background: #ffffff; border: 2px dashed #cbd5e1; border-radius: var(--radius-lg); text-align: center;">
        <div class="monitor-live-badge"><span class="live-dot"></span> ระบบคุมสอบสดพร้อมทำงาน</div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" style="width: 48px; height: 48px; color: var(--primary); margin: 0 auto 12px; display: block; opacity: 0.85;">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
          <line x1="8" y1="21" x2="16" y2="21"></line>
          <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
        <h3 style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">${emptyTitle}</h3>
        <p style="font-size: 13.5px; color: var(--text-secondary); max-width: 440px; margin: 0 auto 16px; line-height: 1.6;">${emptyDesc}</p>
        ${completedStudents.length > 0 ? `
          <button type="button" class="btn btn-secondary view-completed-shortcut-btn" style="min-height: 38px; padding: 6px 18px; font-size: 13px; margin: 0 auto; display: inline-flex;">
            📁 ดูประวัติผู้ที่ส่งข้อสอบแล้ว (${completedStudents.length} คน)
          </button>
        ` : ''}
      </div>
    `;

    const shortcutBtn = gridContainer.querySelector(".view-completed-shortcut-btn");
    if (shortcutBtn) {
      shortcutBtn.addEventListener("click", () => {
        switchToMonitorTab("completed");
      });
    }
    return;
  }

  // เรียงลำดับ: จอที่เตือนขึ้นก่อน
  filtered.sort((a, b) => {
    if (a.hasAlert && !b.hasAlert) return -1;
    if (!a.hasAlert && b.hasAlert) return 1;
    return b.logs.length - a.logs.length;
  });

  gridContainer.innerHTML = filtered.map((s) => renderStudentCardHtml(s, false)).join("");
  bindScreenCardEvents(gridContainer);
}

// 2. เรนเดอร์ประวัติผู้ที่ส่งข้อสอบแล้ว (Completed / History Archive Grid)
function renderCompletedScreensGrid(query) {
  const gridContainer = document.getElementById("completedScreensGrid");
  if (!gridContainer) return;

  let filtered = completedStudents.filter((s) => {
    if (!query) return true;
    const matchId = String(s.studentId != null ? s.studentId : "").toLowerCase().includes(query);
    const matchLog = s.logs.some((l) => String(l.violation || "").toLowerCase().includes(query));
    return matchId || matchLog;
  });

  if (currentFilter === "alert") {
    filtered = filtered.filter((s) => s.hasAlert);
  } else if (currentFilter === "today") {
    filtered = filtered.filter((s) => !s.isOldDate);
  }

  if (filtered.length === 0) {
    gridContainer.innerHTML = `
      <div class="screens-empty-state" style="grid-column: 1 / -1; padding: 40px 20px; background: #ffffff; border: 2px dashed #cbd5e1; border-radius: var(--radius-lg); text-align: center;">
        <h3 style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">ยังไม่มีผู้สอบที่ส่งข้อสอบในหมวดนี้</h3>
        <p style="font-size: 13px; color: var(--text-muted); margin: 0;">เมื่อนักเรียนกดส่งข้อสอบ การ์ดจะถูกจัดเก็บย้อนหลังที่นี่โดยอัตโนมัติ</p>
      </div>
    `;
    return;
  }

  gridContainer.innerHTML = filtered.map((s) => renderStudentCardHtml(s, true)).join("");
  bindScreenCardEvents(gridContainer);
}

// ฟังก์ชันสลับ 3 หมวดการแสดงผลของหน้าคุมสอบ
function switchToMonitorTab(tabName) {
  currentMonitorTab = tabName;
  const liveBtn = document.getElementById("toggleLiveViewBtn");
  const completedBtn = document.getElementById("toggleCompletedViewBtn");
  const tableBtn = document.getElementById("toggleTableViewBtn");

  const liveContainer = document.getElementById("screensGridContainer");
  const completedContainer = document.getElementById("completedGridContainer");
  const tableContainer = document.getElementById("tableViewContainer");

  [liveBtn, completedBtn, tableBtn].forEach((b) => {
    if (b) b.classList.remove("active");
  });
  if (liveContainer) liveContainer.style.display = "none";
  if (completedContainer) completedContainer.style.display = "none";
  if (tableContainer) tableContainer.style.display = "none";

  if (tabName === "live") {
    if (liveBtn) liveBtn.classList.add("active");
    if (liveContainer) liveContainer.style.display = "block";
  } else if (tabName === "completed") {
    if (completedBtn) completedBtn.classList.add("active");
    if (completedContainer) completedContainer.style.display = "block";
  } else if (tabName === "table") {
    if (tableBtn) tableBtn.classList.add("active");
    if (tableContainer) tableContainer.style.display = "block";
  }

  updateFilterBadges();
}

// เรนเดอร์มุมมองตารางประวัติ (Table View)
function renderTableLogs(query) {
  const tableBody = document.getElementById("monitorTableBody");
  if (!tableBody) return;

  let filtered = allLogs.filter((item) => {
    if (isTestLogEntry(item)) return false;
    if (!query) return true;
    const sIdStr = String(item.studentId != null ? item.studentId : "").toLowerCase();
    const textStr = String(item.violation || "").toLowerCase();
    const timeStr = String(item.time || item.timestamp || "").toLowerCase();
    return (
      sIdStr.includes(query) ||
      textStr.includes(query) ||
      timeStr.includes(query)
    );
  });

  if (currentFilter === "alert") {
    filtered = filtered.filter((item) => {
      const text = String(item.violation || "");
      const isStart = text.includes("เริ่มเข้าทำข้อสอบ");
      const isEnd = text.includes("ส่งข้อสอบเรียบร้อย");
      return !isStart && !isEnd;
    });
  } else if (currentFilter === "today") {
    const nowMs = Date.now();
    const oneDayMs = 20 * 60 * 60 * 1000;
    filtered = filtered.filter((item) => {
      const ms = parseLogTimestampMs(item);
      return ms ? (nowMs - ms <= oneDayMs) : true;
    });
  }

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 24px; color: var(--text-muted);">ยังไม่มีข้อมูลเหตุการณ์</td></tr>`;
    return;
  }

  const reversed = [...filtered].reverse();

  tableBody.innerHTML = reversed.map((item) => {
    const text = item.violation || "";
    const isStart = text.includes("เริ่มเข้าทำข้อสอบ");
    const isEnd = text.includes("ส่งข้อสอบเรียบร้อย");
    const isViolation = !isStart && !isEnd;
    const rowClass = (isStart || isEnd) ? "success-row" : "violation-row";
    const badge = isStart
      ? `<span class="badge badge-primary">เริ่มสอบ</span>`
      : (isEnd
        ? `<span class="badge badge-success">ส่งข้อสอบแล้ว</span>`
        : `<span class="badge badge-danger">แจ้งเตือน</span>`);

    return `
      <tr class="${rowClass}">
        <td>${escapeHtml(formatDisplayTime(item.time, item.timestamp))}</td>
        <td><strong>${escapeHtml(item.studentId || "ไม่ระบุ")}</strong></td>
        <td>${escapeHtml(text)}</td>
        <td>${badge}</td>
      </tr>
    `;
  }).join("");
}

// 4. Student Screen Detail Modal Functions (กดเข้าไปดูรายละเอียดของจอนั้นๆ)
window.openStudentDetail = function(studentId) {
  const student = studentsData[studentId];
  if (!student) return;

  activeModalStudentId = studentId;
  updateModalContent(student);

  const modal = document.getElementById("studentDetailModal");
  if (modal) {
    modal.classList.add("active");
  }
};

function updateModalContent(student) {
  const titleEl = document.getElementById("modalStudentTitle");
  const subtitleEl = document.getElementById("modalStudentSubtitle");
  const statusValEl = document.getElementById("modalStatusVal");
  const violationValEl = document.getElementById("modalViolationVal");
  const startTimeValEl = document.getElementById("modalStartTimeVal");
  const lastTimeValEl = document.getElementById("modalLastTimeVal");
  const timelineCountEl = document.getElementById("modalTimelineCount");
  const timelineContainer = document.getElementById("studentTimelineContainer");

  if (titleEl) titleEl.textContent = `รายละเอียดจอผู้สอบ: รหัส ${student.studentId}`;
  if (subtitleEl) subtitleEl.textContent = `เริ่มสอบ: ${formatDisplayTime(student.startTime, null)} • บันทึกทั้งหมด ${student.logs.length} รายการ`;

  if (statusValEl) {
    if (student.isSubmitted && student.violationCount > 0) {
      statusValEl.innerHTML = `<span class="badge badge-warning" style="background: #f59e0b; color: #ffffff; border-color: #d97706; font-weight: 700;">ส่งข้อสอบแล้ว (พบผิดปกติ ${student.violationCount} ครั้ง)</span>`;
    } else if (student.isSubmitted) {
      statusValEl.innerHTML = `<span class="badge badge-success">ส่งข้อสอบเรียบร้อย (ปกติ)</span>`;
    } else if (student.hasAlert) {
      statusValEl.innerHTML = `<span class="badge badge-danger">พบการแจ้งเตือน (${student.violationCount} ครั้ง)</span>`;
    } else {
      statusValEl.innerHTML = `<span class="badge badge-primary">กำลังสอบปกติ</span>`;
    }
  }

  if (violationValEl) {
    violationValEl.textContent = `${student.violationCount} ครั้ง`;
    violationValEl.style.color = student.violationCount > 0 ? "#dc2626" : "#059669";
  }

  if (startTimeValEl) startTimeValEl.textContent = formatDisplayTime(student.startTime, null);
  if (lastTimeValEl) lastTimeValEl.textContent = formatDisplayTime(student.lastEventTime, student.lastEventIso);
  if (timelineCountEl) timelineCountEl.textContent = `${student.logs.length} รายการ`;

  if (timelineContainer) {
    // เรียงจากเหตุการณ์ล่าสุดลงไปแรกสุด
    const reversedLogs = [...student.logs].reverse();

    timelineContainer.innerHTML = reversedLogs.map((log) => {
      const text = log.violation || "";
      const isStart = text.includes("เริ่มเข้าทำข้อสอบ");
      const isEnd = text.includes("ส่งข้อสอบเรียบร้อย");
      const isViolation = !isStart && !isEnd;

      let markerClass = "timeline-marker";
      let bubbleClass = "timeline-bubble";
      let typeBadge = "";

      if (isStart) {
        markerClass += " marker-success";
        typeBadge = `<span class="badge badge-primary" style="font-size: 11px;">เริ่มสอบ</span>`;
      } else if (isEnd) {
        markerClass += " marker-success";
        typeBadge = `<span class="badge badge-success" style="font-size: 11px;">ส่งข้อสอบ</span>`;
      } else {
        markerClass += " marker-alert";
        bubbleClass += " alert-bubble";
        typeBadge = `<span class="badge badge-danger" style="font-size: 11px;">แจ้งเตือนพฤติกรรม</span>`;
      }

      return `
        <div class="timeline-entry">
          <div class="${markerClass}">
            <div class="timeline-marker-dot"></div>
          </div>
          <div class="${bubbleClass}">
            <div class="timeline-meta">
              <span style="display: flex; align-items: center; gap: 4px;">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
                ${escapeHtml(formatDisplayTime(log.time, log.timestamp))}
              </span>
              ${typeBadge}
            </div>
            <div class="timeline-message">
              ${escapeHtml(text)}
            </div>
          </div>
        </div>
      `;
    }).join("");
  }
}

function closeStudentDetail() {
  activeModalStudentId = null;
  const modal = document.getElementById("studentDetailModal");
  if (modal) {
    modal.classList.remove("active");
  }
}

// คัดลอกประวัติเหตุการณ์ของนักเรียนคนนี้
function copyStudentHistory() {
  if (!activeModalStudentId || !studentsData[activeModalStudentId]) return;
  const s = studentsData[activeModalStudentId];

  let textReport = `=====================================\n`;
  textReport += `รายงานประวัติการสอบ: รหัสนักเรียน ${s.studentId}\n`;
  textReport += `สถานะ: ${s.isSubmitted ? "ส่งข้อสอบเรียบร้อย" : (s.violationCount > 0 ? "พบการแจ้งเตือน" : "กำลังสอบปกติ")}\n`;
  textReport += `การแจ้งเตือนพฤติกรรมทั้งหมด: ${s.violationCount} ครั้ง\n`;
  textReport += `เวลาเริ่มสอบ: ${s.startTime || "-"}\n`;
  textReport += `เวลาล่าสุด: ${s.lastEventTime || "-"}\n`;
  textReport += `=====================================\n\n`;
  textReport += `ลำดับเหตุการณ์ทั้งหมด:\n`;

  s.logs.forEach((item, idx) => {
    textReport += `${idx + 1}. [${item.time || item.timestamp || "-"}] ${item.violation || ""}\n`;
  });

  navigator.clipboard.writeText(textReport).then(() => {
    showAlert(`คัดลอกประวัติเหตุการณ์ของรหัส ${s.studentId} เรียบร้อยแล้ว`, {
      type: "success",
      title: "คัดลอกรายงานสำเร็จ",
      confirmText: "ตกลง"
    });
  });
}

// ทดสอบส่งสัญญาณ Webhook Ping — UX-01: Loading state, UX-02: showAlert
async function testWebhookPing() {
  const webhookUrl = (document.getElementById("examWebhookInput").value || "").trim() || DEFAULT_WEBHOOK_URL;
  const testBtn = document.getElementById("testWebhookBtn");

  if (testBtn) {
    testBtn.disabled = true;
    testBtn.classList.add("is-loading");
    testBtn.innerHTML = `<span class="btn-spinner"></span> กำลังทดสอบ...`;
  }

  const payload = {
    studentId: "ทดสอบระบบ (Test Ping)",
    violation: "ทดสอบการเชื่อมต่อ Webhook จาก Exam Proctor Studio",
    timestamp: new Date().toISOString(),
    time: new Date().toLocaleTimeString("th-TH"),
    date: new Date().toLocaleDateString("th-TH"),
    isSeverityHigh: false,
    formTitle: "ทดสอบการเชื่อมต่อ"
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    await showAlert(`ส่งข้อความทดสอบสำเร็จ (Status: ${res.status})\nสามารถตรวจดูผลใน Google Sheets ได้ทันที`, {
      type: "success",
      title: "เชื่อมต่อ Webhook สำเร็จ",
      confirmText: "ยอดเยี่ยม"
    });
    fetchMonitorLogs();
  } catch (err) {
    await showAlert(`เกิดข้อผิดพลาดในการเชื่อมต่อ:\n${err.message}`, {
      type: "danger",
      title: "เชื่อมต่อ Webhook ล้มเหลว",
      confirmText: "ปิด"
    });
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.classList.remove("is-loading");
      testBtn.textContent = "ทดสอบ Webhook";
    }
  }
}

// Mobile Hamburger Navigation
function setupMobileNavigation() {
  const hamburgerBtn = document.getElementById("navHamburgerBtn");
  const navLinksMenu = document.getElementById("navLinksMenu");
  if (!hamburgerBtn || !navLinksMenu) return;

  hamburgerBtn.addEventListener("click", () => {
    const isOpen = navLinksMenu.classList.toggle("open");
    hamburgerBtn.classList.toggle("active", isOpen);
    hamburgerBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  // ปิดเมนู Drawer อัตโนมัติเมื่อกดเลือกแท็บ
  navLinksMenu.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      navLinksMenu.classList.remove("open");
      hamburgerBtn.classList.remove("active");
      hamburgerBtn.setAttribute("aria-expanded", "false");
    });
  });
}

// DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  setupMobileNavigation();
  setupTabNavigation();
  renderRoomHistory();

  const webhookInput = document.getElementById("examWebhookInput");
  if (webhookInput && !webhookInput.value) {
    webhookInput.value = DEFAULT_WEBHOOK_URL;
  }
  const passInput = document.getElementById("examPasscodeInput");
  if (passInput) {
    // กำหนดให้เป็นตัวเลข 6 หลักแบบสุ่มเสมอเมื่อโหลดหน้า
    passInput.value = generateRandomPasscode();
  }

  // ปุ่มคลิกเพื่อสุ่มรหัสผ่าน 6 หลักใหม่
  const randomPassBtn = document.getElementById("randomPasscodeBtn");
  if (randomPassBtn) {
    randomPassBtn.addEventListener("click", () => {
      const pInput = document.getElementById("examPasscodeInput");
      if (pInput) {
        pInput.value = generateRandomPasscode();
        pInput.focus();
      }
    });
  }

  const generateBtn = document.getElementById("generateLinkBtn");
  if (generateBtn) {
    generateBtn.addEventListener("click", generateExamLink);
  }

  const copyBtn = document.getElementById("copyLinkBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const linkDisplay = document.getElementById("generatedLinkDisplay");
      if (linkDisplay && linkDisplay.value) {
        navigator.clipboard.writeText(linkDisplay.value).then(() => {
          const originalText = copyBtn.innerHTML;
          copyBtn.innerHTML = "คัดลอกแล้ว";
          setTimeout(() => { copyBtn.innerHTML = originalText; }, 2000);
        });
      }
    });
  }

  const testWebhookBtn = document.getElementById("testWebhookBtn");
  if (testWebhookBtn) {
    testWebhookBtn.addEventListener("click", testWebhookPing);
  }

  const openSheetBtn = document.getElementById("openSheetBtn");
  if (openSheetBtn) {
    openSheetBtn.addEventListener("click", () => {
      window.open(DEFAULT_SHEET_URL, "_blank");
    });
  }

  const searchLogInput = document.getElementById("searchLogInput");
  if (searchLogInput) {
    searchLogInput.addEventListener("input", () => {
      renderMonitorLogs();
    });
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

  // 1. ปุ่มสลับมุมมอง 3 หมวด (จอคุมสอบสด VS ประวัติผู้ส่งข้อสอบแล้ว VS ตารางบันทึกเหตุการณ์)
  const toggleLiveBtn = document.getElementById("toggleLiveViewBtn");
  if (toggleLiveBtn) {
    toggleLiveBtn.addEventListener("click", () => switchToMonitorTab("live"));
  }

  const toggleCompletedBtn = document.getElementById("toggleCompletedViewBtn");
  if (toggleCompletedBtn) {
    toggleCompletedBtn.addEventListener("click", () => switchToMonitorTab("completed"));
  }

  const toggleTableBtn = document.getElementById("toggleTableViewBtn");
  if (toggleTableBtn) {
    toggleTableBtn.addEventListener("click", () => switchToMonitorTab("table"));
  }

  // 1.1 ปุ่มเริ่มรอบสอบใหม่ (Reset Live Monitor)
  const resetSessionBtn = document.getElementById("resetSessionBtn");
  if (resetSessionBtn) {
    resetSessionBtn.addEventListener("click", async () => {
      const confirmed = await showConfirm(
        "ต้องการเริ่มรอบการสอบใหม่หรือไม่?\n\nระบบจะย้ายหน้าจอผู้สอบชุดก่อนหน้าทั้งหมดไปยัง '📁 ประวัติผู้ส่งข้อสอบแล้ว' เพื่อให้หน้าจอคุมสอบสดว่างพร้อมรับนักเรียนรอบใหม่\n\n(หมายเหตุ: ข้อมูลทั้งหมดยังคงบันทึกปลอดภัยใน Google Sheets และสามารถดูย้อนหลังได้ตลอดเวลา)",
        {
          title: "✨ เริ่มรอบสอบใหม่ (Reset Live Monitor)",
          confirmText: "เริ่มรอบใหม่ทันที",
          cancelText: "ยกเลิก",
          type: "primary"
        }
      );
      if (confirmed) {
        sessionCutoffTime = Date.now();
        localStorage.setItem("examSessionCutoff", sessionCutoffTime.toString());
        renderMonitorLogs();
        switchToMonitorTab("live");
        await showAlert("เริ่มรอบสอบใหม่เรียบร้อยแล้ว\nหน้าจอคุมสอบสดพร้อมรับนักเรียนรอบใหม่", {
          type: "success",
          title: "พร้อมสำหรับการสอบรอบใหม่",
          confirmText: "ตกลง"
        });
      }
    });
  }

  // 1.2 ปุ่มล้างตัวตัดรอบ (แสดงประวัติทั้งหมด)
  const clearCutoffBtn = document.getElementById("clearCutoffBtn");
  if (clearCutoffBtn) {
    clearCutoffBtn.addEventListener("click", async () => {
      sessionCutoffTime = 0;
      localStorage.removeItem("examSessionCutoff");
      renderMonitorLogs();
      await showAlert("ล้างตัวตัดรอบเรียบร้อยแล้ว\nแสดงข้อมูลผู้สอบทั้งหมดตามปกติ", {
        type: "success",
        title: "แสดงประวัติทั้งหมด",
        confirmText: "ตกลง"
      });
    });
  }

  // 2. ตัวกรองสถานะ Filter Pills
  const filterPills = document.querySelectorAll(".filter-pill");
  filterPills.forEach((pill) => {
    pill.addEventListener("click", () => {
      filterPills.forEach((p) => p.classList.remove("active"));
      pill.classList.add("active");
      currentFilter = pill.getAttribute("data-filter") || "all";
      renderMonitorLogs();
    });
  });

  // 3. Modal ควบคุม
  const closeDetailBtn = document.getElementById("closeDetailModalBtn");
  if (closeDetailBtn) {
    closeDetailBtn.addEventListener("click", closeStudentDetail);
  }

  const modalDismissBtn = document.getElementById("modalDismissBtn");
  if (modalDismissBtn) {
    modalDismissBtn.addEventListener("click", closeStudentDetail);
  }

  const modalCopyHistoryBtn = document.getElementById("modalCopyHistoryBtn");
  if (modalCopyHistoryBtn) {
    modalCopyHistoryBtn.addEventListener("click", copyStudentHistory);
  }

  const studentDetailModal = document.getElementById("studentDetailModal");
  if (studentDetailModal) {
    studentDetailModal.addEventListener("click", (e) => {
      if (e.target === studentDetailModal) {
        closeStudentDetail();
      }
    });
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeStudentDetail();
    }
  });

  // รับสัญญาณ Real-time จากหน้าจอผู้สอบ
  setupLiveBroadcastListener();

  // เริ่มต้นดึงข้อมูล Real-time Monitor ทันทีและ Polling ต่อเนื่องทุก 3 วินาที
  fetchMonitorLogs();
  if (!monitorInterval) {
    monitorInterval = setInterval(fetchMonitorLogs, 3000);
  }
});

