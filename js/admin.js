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
          monitorInterval = setInterval(fetchMonitorLogs, 5000);
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

    // UX-05: สร้าง QR Code แบบ Client-side
    const qrWrapper = document.getElementById("examQrContainer") || document.querySelector(".qr-image-wrapper");
    if (qrWrapper) {
      generateQrCode(qrWrapper, fullExamUrl, 160);
    } else {
      const qrImg = document.getElementById("examQrImage");
      if (qrImg) {
        qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(fullExamUrl)}`;
        qrImg.style.display = "block";
      }
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

let currentViewMode = "grid"; // "grid" | "table"
let currentFilter = "all"; // "all" | "alert" | "active" | "submitted"
let studentsData = {};
let activeModalStudentId = null;

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

      allLogs = fetchedList;
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
  const badgeActive = document.getElementById("badgeFilterActive");
  const badgeSubmitted = document.getElementById("badgeFilterSubmitted");

  // จัดกลุ่มข้อมูลตามรหัสนักเรียน (studentId)
  studentsData = {};
  let totalViolationsCount = 0;

  allLogs.forEach((item) => {
    const sId = String(item.studentId !== undefined && item.studentId !== null ? item.studentId : "ไม่ระบุรหัส").trim();
    if (!studentsData[sId]) {
      studentsData[sId] = {
        studentId: sId,
        logs: [],
        violationCount: 0,
        isStarted: false,
        isSubmitted: false,
        startTime: null,
        lastEventTime: null,
        lastEventText: "",
        hasAlert: false
      };
    }

    const s = studentsData[sId];
    s.logs.push(item);

    const text = String(item.violation || "");
    const isStart = text.includes("เริ่มเข้าทำข้อสอบ");
    const isEnd = text.includes("ส่งข้อสอบเรียบร้อย");
    const itemTime = String(item.time || item.timestamp || "");

    if (isStart) {
      s.isStarted = true;
      if (!s.startTime) s.startTime = itemTime;
    }

    if (isEnd) {
      s.isSubmitted = true;
    } else if (!isStart) {
      s.violationCount++;
      totalViolationsCount++;
    }

    s.lastEventTime = itemTime;
    s.lastEventText = text;
  });

  // ประมวลผลสถานะเตือน Alert สำหรับแต่ละจอ
  const studentList = Object.values(studentsData);
  studentList.forEach((s) => {
    // จอที่มีการแจ้งเตือน = มีพฤติกรรมผิดกฎ และยังไม่ได้ส่งข้อสอบเสร็จสมบูรณ์
    s.hasAlert = s.violationCount > 0 && !s.isSubmitted;
  });

  const totalStudents = studentList.length;
  const submittedStudents = studentList.filter((s) => s.isSubmitted).length;
  const activeStudents = studentList.filter((s) => !s.isSubmitted).length;
  const alertStudents = studentList.filter((s) => s.hasAlert).length;

  if (totalStudentsEl) totalStudentsEl.textContent = `${totalStudents} คน`;
  if (activeStudentsEl) activeStudentsEl.textContent = `${activeStudents} คน`;
  if (totalViolationsEl) totalViolationsEl.textContent = `${totalViolationsCount} ครั้ง`;
  if (totalSubmittedEl) totalSubmittedEl.textContent = `${submittedStudents} คน`;

  if (badgeAll) badgeAll.textContent = totalStudents;
  if (badgeAlert) badgeAlert.textContent = alertStudents;
  if (badgeActive) badgeActive.textContent = activeStudents;
  if (badgeSubmitted) badgeSubmitted.textContent = submittedStudents;

  // เล่นเสียงเตือนเมื่อพบเหตุการณ์ผิดปกติใหม่
  if (totalViolationsCount > previousViolationCount && previousViolationCount > 0) {
    playAdminChime();
  }
  previousViolationCount = totalViolationsCount;

  // เรนเดอร์ทั้ง 2 มุมมอง (Screens Grid และ Table)
  renderScreensGrid(query);
  renderTableLogs(query);

  // หากเปิด Modal ค้างไว้ ให้อัปเดตข้อมูลข้างในแบบ Real-time ด้วย
  if (activeModalStudentId && studentsData[activeModalStudentId]) {
    updateModalContent(studentsData[activeModalStudentId]);
  }
}

// เรนเดอร์มุมมองแยกดูของแต่ละจอ (Screens Grid)
function renderScreensGrid(query) {
  const gridContainer = document.getElementById("studentScreensGrid");
  if (!gridContainer) return;

  const allStudents = Object.values(studentsData);

  // กรองตามคำค้นหา
  let filtered = allStudents.filter((s) => {
    if (!query) return true;
    const matchId = String(s.studentId != null ? s.studentId : "").toLowerCase().includes(query);
    const matchLog = s.logs.some((l) => String(l.violation || "").toLowerCase().includes(query));
    return matchId || matchLog;
  });

  // กรองตามแท็บสถานะ
  if (currentFilter === "alert") {
    filtered = filtered.filter((s) => s.hasAlert);
  } else if (currentFilter === "active") {
    filtered = filtered.filter((s) => !s.isSubmitted);
  } else if (currentFilter === "submitted") {
    filtered = filtered.filter((s) => s.isSubmitted);
  }

  if (filtered.length === 0) {
    let emptyTitle = "ยังไม่มีข้อมูลจอภาพผู้สอบ";
    let emptyDesc = "ระบบกำลังรอสัญญาณจากเครื่องนักเรียน เมื่อนักเรียนเปิดลิงก์และเริ่มสอบ หน้าจอจะปรากฏขึ้นที่นี่โดยอัตโนมัติ";
    if (query) {
      emptyTitle = `ไม่พบข้อมูลที่ตรงกับ "${escapeHtml(query)}"`;
      emptyDesc = "ลองค้นหาด้วยรหัสประจำตัวอื่น หรือกดปุ่มรีเฟรชเพื่อดึงข้อมูลล่าสุด";
    } else if (currentFilter === "alert") {
      emptyTitle = "ยอดเยี่ยม! ไม่พบการแจ้งเตือนพฤติกรรม";
      emptyDesc = "ไม่มีเครื่องนักเรียนใดที่ตรวจพบการสลับแท็บ ย่อหน้าจอ หรือกดคีย์ลัดในขณะนี้";
    } else if (currentFilter === "submitted") {
      emptyTitle = "ยังไม่มีผู้สอบส่งข้อสอบ";
      emptyDesc = "เมื่อนักเรียนกดส่งแบบฟอร์ม Google Forms สถานะจะเปลี่ยนเป็นส่งข้อสอบแล้ว";
    }

    gridContainer.innerHTML = `
      <div class="screens-empty-state" style="padding: 44px 20px; background: #ffffff; border: 2px dashed #cbd5e1; border-radius: var(--radius-lg); text-align: center;">
        <div class="monitor-live-badge"><span class="live-dot"></span> ระบบคุมสอบสดพร้อมทำงาน</div>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" style="width: 48px; height: 48px; color: var(--primary); margin: 0 auto 12px; display: block; opacity: 0.85;">
          <rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect>
          <line x1="8" y1="21" x2="16" y2="21"></line>
          <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
        <h3 style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">${emptyTitle}</h3>
        <p style="font-size: 13.5px; color: var(--text-secondary); max-width: 420px; margin: 0 auto; line-height: 1.6;">${emptyDesc}</p>
      </div>
    `;
    return;
  }

  // เรียงลำดับ: จอที่กำลังสั่น/แจ้งเตือน (hasAlert) ขึ้นมาก่อน เพื่อให้ผู้คุมสอบมองเห็นทันที
  filtered.sort((a, b) => {
    if (a.hasAlert && !b.hasAlert) return -1;
    if (!a.hasAlert && b.hasAlert) return 1;
    return b.logs.length - a.logs.length;
  });

  gridContainer.innerHTML = filtered.map((s) => {
    let cardClass = "student-screen-card";
    let statusBadge = "";
    let statusText = "🟢 ปกติ";

    if (s.hasAlert) {
      cardClass += " has-alert";
      statusBadge = `
        <span class="badge badge-danger">
          <span class="radar-beacon" style="margin-right: 4px;"></span>
          เตือน ${s.violationCount} ครั้ง
        </span>
      `;
      statusText = `⚠️ ผิดปกติ ${s.violationCount} ครั้ง`;
    } else if (s.isSubmitted) {
      cardClass += " is-submitted";
      statusBadge = `<span class="badge badge-success">ส่งข้อสอบแล้ว</span>`;
      statusText = `ส่งข้อสอบแล้ว`;
    } else {
      cardClass += " is-active-normal";
      statusBadge = `<span class="badge badge-primary">กำลังสอบ</span>`;
      statusText = `กำลังทำข้อสอบ`;
    }

    const lastEventShort = s.lastEventText ? escapeHtml(s.lastEventText) : "กำลังทำข้อสอบอย่างต่อเนื่อง";
    const updateTime = s.lastEventTime || "-";

    // BUG-03: ใช้ data-student-id attribute แทน inline onclick เพื่อป้องกัน XSS
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
              <span class="screen-station-label">จอผู้สอบ</span>
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
            <span class="screen-mockup-tag">Exam Screen</span>
          </div>
          <div class="screen-last-event">
            ${lastEventShort}
          </div>
          <div class="screen-mockup-bottom">
            <span>ล่าสุด: ${updateTime}</span>
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
  }).join("");

  // BUG-03: เพิ่ม event delegation แทน inline onclick
  gridContainer.querySelectorAll(".student-screen-card").forEach((card) => {
    card.addEventListener("click", () => {
      const sid = card.getAttribute("data-student-id");
      if (sid) openStudentDetail(sid);
    });
  });
}

// เรนเดอร์มุมมองตารางประวัติ (Table View)
function renderTableLogs(query) {
  const tableBody = document.getElementById("monitorTableBody");
  if (!tableBody) return;

  const filtered = allLogs.filter((item) => {
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

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 24px; color: var(--text-muted);">ยังไม่มีข้อมูลเหตุการณ์</td></tr>`;
    return;
  }

  const reversed = [...filtered].reverse();

  tableBody.innerHTML = reversed.map((item) => {
    const text = item.violation || "";
    const isStart = text.includes("เริ่มเข้าทำข้อสอบ");
    const isEnd = text.includes("ส่งข้อสอบเรียบร้อย");
    const rowClass = (isStart || isEnd) ? "success-row" : "violation-row";
    const badge = (isStart || isEnd)
      ? `<span class="badge badge-success">${isStart ? "เริ่มสอบ" : "ส่งข้อสอบแล้ว"}</span>`
      : `<span class="badge badge-danger">แจ้งเตือน</span>`;

    return `
      <tr class="${rowClass}">
        <td>${escapeHtml(item.time || item.timestamp || "-")}</td>
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
  if (subtitleEl) subtitleEl.textContent = `เริ่มสอบ: ${student.startTime || "-"} • บันทึกทั้งหมด ${student.logs.length} รายการ`;

  if (statusValEl) {
    if (student.isSubmitted) {
      statusValEl.innerHTML = `<span class="badge badge-success">ส่งข้อสอบเรียบร้อย</span>`;
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

  if (startTimeValEl) startTimeValEl.textContent = student.startTime || "-";
  if (lastTimeValEl) lastTimeValEl.textContent = student.lastEventTime || "-";
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
        typeBadge = `<span class="badge badge-success" style="font-size: 11px;">เริ่มสอบ</span>`;
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
                ${escapeHtml(log.time || log.timestamp || "-")}
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
    refreshLogsBtn.addEventListener("click", fetchMonitorLogs);
  }

  // 1. ปุ่มสลับมุมมอง จอภาพ VS ตาราง
  const toggleGridBtn = document.getElementById("toggleGridViewBtn");
  const toggleTableBtn = document.getElementById("toggleTableViewBtn");
  const screensGridContainer = document.getElementById("screensGridContainer");
  const tableViewContainer = document.getElementById("tableViewContainer");

  if (toggleGridBtn && toggleTableBtn) {
    toggleGridBtn.addEventListener("click", () => {
      toggleGridBtn.classList.add("active");
      toggleTableBtn.classList.remove("active");
      currentViewMode = "grid";
      if (screensGridContainer) screensGridContainer.style.display = "block";
      if (tableViewContainer) tableViewContainer.style.display = "none";
    });

    toggleTableBtn.addEventListener("click", () => {
      toggleTableBtn.classList.add("active");
      toggleGridBtn.classList.remove("active");
      currentViewMode = "table";
      if (screensGridContainer) screensGridContainer.style.display = "none";
      if (tableViewContainer) tableViewContainer.style.display = "block";
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
});

