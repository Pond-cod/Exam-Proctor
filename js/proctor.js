/**
 * Proctor Engine for exam.html (Web App)
 */

let examConfig = {
  title: "แบบทดสอบออนไลน์",
  formUrl: "",
  webhookUrl: DEFAULT_WEBHOOK_URL,
  adminPasscode: DEFAULT_ADMIN_PASSCODE
};

let studentId = "";
let isExamActive = false;
let isExamSubmitted = false;
let violationCount = 0;
let timerInterval = null;
let timerStartTime = 0; // BUG-13: ใช้ Date.now() เป็น reference แทน counter
let secondsElapsed = 0;

let integrityInterval = null;
let pendingViolationsQueue = [];
let isSendingQueue = false;

// Audio Beep Warning (รองรับ Autoplay Policy และ resume AudioContext)
function playWarningBeep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(520, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.35, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.35);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.38);
  } catch (e) {
    console.warn("Audio warning beep error:", e);
  }
}

// HTML Escape helper
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

let proctorLiveChannel = null;
try {
  if (typeof BroadcastChannel !== "undefined") {
    proctorLiveChannel = new BroadcastChannel("exam_proctor_bus");
  }
} catch (_) {}

// ส่งสัญญาณ Real-time ตรงไปยัง Admin Monitor ทันที 0ms (Persistent Channel + Storage fallback)
function broadcastLocalEvent(payload) {
  try {
    if (!proctorLiveChannel && typeof BroadcastChannel !== "undefined") {
      proctorLiveChannel = new BroadcastChannel("exam_proctor_bus");
    }
    if (proctorLiveChannel) {
      proctorLiveChannel.postMessage({ type: "EXAM_EVENT", payload });
    }
  } catch (err) {
    console.warn("BroadcastChannel error:", err);
  }
  try {
    localStorage.setItem("exam_live_event", JSON.stringify({
      ...payload,
      _rand: Math.random(),
      _time: Date.now()
    }));
  } catch (_) {}
}

let lastCloudSendTime = 0;
let lastCloudViolationText = "";
let cloudSyncTimer = null;

// Send Webhook Alert to Google Apps Script / Google Sheets & Direct Local Real-time
function sendAlertToWebhook(violationText, isSeverityHigh = false) {
  if (!examConfig.webhookUrl) return;

  const now = new Date();
  const payload = {
    studentId: studentId || "ไม่ระบุรหัส",
    violation: violationText,
    violationCount: violationCount,
    timestamp: now.toISOString(),
    time: now.toLocaleTimeString("th-TH"),
    date: now.toLocaleDateString("th-TH"),
    isSeverityHigh: isSeverityHigh,
    formTitle: examConfig.title
  };

  // 1. ส่งสัญญาณตรงแบบ Instant Real-Time ทันที (0ms) สำหรับหน้าจอคุมสอบสด
  broadcastLocalEvent(payload);

  const payloadStr = JSON.stringify(payload);
  const isStartOrEnd = violationText.includes("เริ่มเข้าทำข้อสอบ") || violationText.includes("ส่งข้อสอบเรียบร้อย");
  const isNewViolation = violationText !== lastCloudViolationText;
  const nowMs = Date.now();

  const dispatchToCloud = () => {
    lastCloudSendTime = Date.now();
    lastCloudViolationText = violationText;

    try {
      fetch(examConfig.webhookUrl, {
        method: "POST",
        mode: "no-cors",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: payloadStr,
        keepalive: true
      }).catch(() => {});
    } catch (_) {}

    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon(examConfig.webhookUrl, payloadStr);
      }
    } catch (_) {}
  };

  // ถ้าเป็นเริ่มสอบ/ส่งข้อสอบ หรือเกิดการผิดกฎประเภทใหม่ หรือพ้นช่วงหน่วง 3 วินาทีแล้ว ให้ส่ง Cloud ทันที
  if (isStartOrEnd || isNewViolation || (nowMs - lastCloudSendTime >= 3000)) {
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    dispatchToCloud();
  } else {
    // ถ้าความถี่ติดกันเกินไป ให้ตั้ง Timer ส่งตามไปเสมอ (ป้องกันข้อมูลหล่น 100%)
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = setTimeout(() => {
      dispatchToCloud();
    }, 3100);
  }
}

// Debounce Violation Alerts & Trigger Modal Warning at Student Screen
let lastAlertTime = 0;
function logViolation(detail, isSeverityHigh = false) {
  if (!isExamActive || isExamSubmitted) return;

  const now = Date.now();
  if (now - lastAlertTime < 1400) return; // Debounce 1.4 วินาที
  lastAlertTime = now;

  violationCount++;

  // 1. ส่งข้อมูล Real-Time ไปยังหน้าจอคุมสอบสด และ Google Sheets ทันที (สำคัญที่สุด ทำงานก่อนเสมอ)
  try {
    sendAlertToWebhook(detail, isSeverityHigh);
  } catch (err) {
    console.error("sendAlertToWebhook error:", err);
  }

  // 2. เล่นเสียงเตือน
  try {
    playWarningBeep();
  } catch (_) {}

  // 3. อัปเดตและแสดง Modal แจ้งเตือนชัดเจนที่หน้าจอผู้สอบ
  try {
    const modal = document.getElementById("violationModal");
    if (modal) {
      const reasonEl = document.getElementById("violationReason");
      if (reasonEl) reasonEl.textContent = detail;
      const countBadge = document.getElementById("violationCountBadge");
      if (countBadge) countBadge.textContent = `เตือนครั้งที่ ${violationCount}`;
      modal.classList.add("active");
    }
  } catch (_) {}

  // 4. แสดง Toast ด่วน
  try {
    showToastAlert(`ตรวจพบเหตุการณ์: ${detail} (เตือนครั้งที่ ${violationCount})`);
  } catch (_) {}

  // 5. อัปเดตตัวเลขแจ้งเตือนบนแถบด้านบน
  try {
    const vCountEl = document.getElementById("headerViolationCount");
    if (vCountEl) {
      vCountEl.textContent = `แจ้งเตือน: ${violationCount} ครั้ง`;
      vCountEl.style.display = "inline-flex";
      vCountEl.classList.remove("pulse-highlight");
      void vCountEl.offsetWidth; // Trigger reflow
      vCountEl.classList.add("pulse-highlight");
    }
  } catch (_) {}
}

// Toast Alert
function showToastAlert(msg) {
  const toast = document.getElementById("toastAlert");
  if (!toast) return;
  toast.innerHTML = `<span style="font-size: 16px; margin-right: 6px;">⚠️</span> ${escapeHtml(msg)}`;
  toast.classList.add("active");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    toast.classList.remove("active");
  }, 4500);
}

// Format Timer — ใช้ Date.now() เป็น reference เพื่อความแม่นยำ (BUG-13)
function updateTimer() {
  const elapsed = Math.floor((Date.now() - timerStartTime) / 1000);
  secondsElapsed = elapsed;
  const hrs = Math.floor(elapsed / 3600);
  const mins = Math.floor((elapsed % 3600) / 60);
  const secs = elapsed % 60;
  const timerEl = document.getElementById("examTimer");
  if (timerEl) {
    timerEl.textContent = 
      (hrs > 0 ? String(hrs).padStart(2, "0") + ":" : "") +
      String(mins).padStart(2, "0") + ":" +
      String(secs).padStart(2, "0");
  }
}

// Initialize & Load Parameters from URL
function initExamFromUrl() {
  const urlParams = new URLSearchParams(window.location.search);
  const hash = window.location.hash ? window.location.hash.substring(1) : "";
  let configData = null;

  const encodedParam = urlParams.get("data") || (hash.startsWith("data=") ? hash.replace("data=", "") : "");
  if (encodedParam) {
    configData = decodeExamConfig(encodedParam);
  }

  // รองรับทั้งพารามิเตอร์แบบสั้น (f, p, t, w) และแบบยาว (form, pass, title, webhook)
  if (!configData) {
    const rawForm = urlParams.get("f") || urlParams.get("form");
    if (rawForm) {
      configData = {
        title: urlParams.get("t") || urlParams.get("title") || "แบบทดสอบออนไลน์",
        formUrl: rawForm,
        webhookUrl: urlParams.get("w") || urlParams.get("webhook") || DEFAULT_WEBHOOK_URL,
        adminPasscode: urlParams.get("p") || urlParams.get("pass") || DEFAULT_ADMIN_PASSCODE
      };
    }
  }

  if (configData && configData.formUrl) {
    examConfig = {
      title: configData.title || "แบบทดสอบออนไลน์",
      formUrl: formatGoogleFormEmbedUrl(configData.formUrl),
      webhookUrl: configData.webhookUrl || DEFAULT_WEBHOOK_URL,
      adminPasscode: configData.adminPasscode || DEFAULT_ADMIN_PASSCODE
    };

    document.title = `${examConfig.title} - ระบบคุมสอบออนไลน์`;
    const titleEl = document.getElementById("portalExamTitle");
    if (titleEl) titleEl.textContent = examConfig.title;
    const headerTitleEl = document.getElementById("headerExamTitle");
    if (headerTitleEl) headerTitleEl.textContent = examConfig.title;
  } else {
    const manualBox = document.getElementById("manualFormBox");
    if (manualBox) manualBox.style.display = "block";
  }
}

// ตรวจสอบว่าหน้าจอกำลังอยู่ในโหมด Fullscreen จริงหรือไม่ (รองรับทุก Vendor Prefixes)
function isBrowserFullscreen() {
  return !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );
}

// Fullscreen API Helper
function requestBrowserFullscreen() {
  const docEl = document.documentElement;
  try {
    if (docEl.requestFullscreen) {
      docEl.requestFullscreen().catch(() => {});
    } else if (docEl.webkitRequestFullscreen) {
      docEl.webkitRequestFullscreen();
    } else if (docEl.msRequestFullscreen) {
      docEl.msRequestFullscreen();
    }
  } catch (_) {}
}

// Heartbeat ตรวจสอบความซื่อสัตย์ของการสอบอย่างต่อเนื่อง (ทุกๆ 600ms)
function checkExamIntegrity() {
  if (!isExamActive || isExamSubmitted) return;

  const modal = document.getElementById("violationModal");
  const isFs = isBrowserFullscreen();

  // 1. ตรวจจับการหลุดโหมดเต็มจอ (เช่น กด Esc, ย่อหน้าจอ, หรือกดปุ่ม Restore Down ให้เป็นหน้าต่างย่อย)
  if (!isFs) {
    if (modal && !modal.classList.contains("active")) {
      modal.classList.add("active");
    }
    logViolation("หลุดออกจากโหมดเต็มหน้าจอ (กด Esc หรือย่อหน้าต่าง)", true);
  } else {
    if (modal && modal.classList.contains("active")) {
      modal.classList.remove("active");
    }
  }

  // 2. ตรวจจับการหลุด Focus จากเบราว์เซอร์ (คลิกออกนอกหน้าจอ, สลับโปรแกรม, หรือแบ่งหน้าจอ Split-Screen แบบในภาพ)
  // หมายเหตุ: เมื่อนักเรียนคลิกตอบคำถามใน iframe ในเบราว์เซอร์ Chromium document.hasFocus() จะเป็น true
  // แต่หากคลิกไปที่หน้าต่างอื่น หรือแบ่งหน้าจอครึ่งซ้าย-ขวาแล้วไปคลิกฝั่งตรงข้าม document.hasFocus() จะกลายเป็น false ทันที
  if (!document.hasFocus()) {
    logViolation("คลิกออกนอกหน้าจอ หรือสลับโปรแกรมอื่นทับ");
  }
}

// เริ่มระบบเฝ้าระวัง Heartbeat
function startIntegrityMonitor() {
  if (integrityInterval) clearInterval(integrityInterval);
  integrityInterval = setInterval(checkExamIntegrity, 600);
}

// Start Exam — UX-02: ใช้ showAlert แทน alert()
async function startExam() {
  const studentInput = document.getElementById("studentIdInput");
  const studentVal = (studentInput ? studentInput.value : "").trim();

  if (!studentVal) {
    await showAlert("กรุณากรอกรหัสประจำตัวนักเรียนก่อนเริ่มสอบ", {
      type: "warning",
      title: "ข้อมูลไม่ครบถ้วน",
      confirmText: "ตกลง"
    });
    if (studentInput) studentInput.focus();
    return;
  }
  if (!/^\d+$/.test(studentVal)) {
    await showAlert("รหัสประจำตัวนักเรียนต้องเป็นตัวเลขเท่านั้น (0-9)", {
      type: "warning",
      title: "รูปแบบรหัสไม่ถูกต้อง",
      confirmText: "แก้ไขข้อมูล"
    });
    if (studentInput) studentInput.focus();
    return;
  }

  if (!examConfig.formUrl) {
    const manualInput = document.getElementById("manualFormUrl");
    const manualVal = (manualInput ? manualInput.value : "").trim();
    if (!manualVal) {
      await showAlert("ยังไม่ได้ระบุลิงก์ข้อสอบ Google Forms", {
        type: "warning",
        title: "ไม่พบข้อสอบ",
        confirmText: "ตกลง"
      });
      if (manualInput) manualInput.focus();
      return;
    }
    examConfig.formUrl = formatGoogleFormEmbedUrl(manualVal);
  }

  studentId = studentVal;
  isExamActive = true;
  isExamSubmitted = false;

  const headerStudentEl = document.getElementById("headerStudentId");
  if (headerStudentEl) headerStudentEl.textContent = studentId;

  const iframe = document.getElementById("examIframe");
  if (iframe) {
    iframe.src = examConfig.formUrl;
  }

  document.getElementById("examPortalView").style.display = "none";
  const activeView = document.getElementById("examActiveView");
  activeView.classList.add("active");

  requestBrowserFullscreen();

  timerStartTime = Date.now(); // BUG-13: บันทึกเวลาเริ่ม
  secondsElapsed = 0;
  clearInterval(timerInterval);
  timerInterval = setInterval(updateTimer, 1000);

  // เริ่ม Heartbeat ตรวจสอบความถูกต้องของการสอบทันที
  startIntegrityMonitor();

  sendAlertToWebhook(`เริ่มเข้าทำข้อสอบ: ${examConfig.title}`);
}

// Anti-Cheat Event Listeners
function setupAntiCheatListeners() {
  // 1. ตรวจจับการเปลี่ยนแปลงโหมดเต็มจอ (ทุก Vendor Prefixes)
  const handleFullscreenEvent = () => {
    if (!isExamActive || isExamSubmitted) return;
    const isFullscreen = isBrowserFullscreen();
    const modal = document.getElementById("violationModal");
    if (!isFullscreen) {
      if (modal) modal.classList.add("active");
      logViolation("หลุดออกจากโหมดเต็มหน้าจอ (กด Esc หรือย่อหน้าต่าง)", true);
    } else {
      if (modal) modal.classList.remove("active");
    }
  };

  document.addEventListener("fullscreenchange", handleFullscreenEvent);
  document.addEventListener("webkitfullscreenchange", handleFullscreenEvent);
  document.addEventListener("mozfullscreenchange", handleFullscreenEvent);
  document.addEventListener("MSFullscreenChange", handleFullscreenEvent);

  // 2. ดักจับการสลับแท็บ / ย่อหน้าจอ
  document.addEventListener("visibilitychange", () => {
    if (!isExamActive || isExamSubmitted) return;
    if (document.hidden) {
      logViolation("สลับแท็บ หรือย่อหน้าต่างข้อสอบ", true);
    }
  });

  // 3. ดักจับการปรับขนาดหน้าต่าง หรือหลุดจาก Fullscreen
  window.addEventListener("resize", () => {
    if (!isExamActive || isExamSubmitted) return;
    if (!isBrowserFullscreen()) {
      const modal = document.getElementById("violationModal");
      if (modal) modal.classList.add("active");
      logViolation("ย่อหรือปรับขนาดหน้าต่างข้อสอบ", true);
    }
  });

  // 4. ดักจับการคลิกออกนอกหน้าจอ / สลับโปรแกรม
  window.addEventListener("blur", () => {
    if (!isExamActive || isExamSubmitted) return;
    setTimeout(() => {
      if (!document.hasFocus() && isExamActive && !isExamSubmitted) {
        logViolation("คลิกออกนอกหน้าจอ หรือสลับโปรแกรมอื่นทับ");
      }
    }, 250);
  });

  // 5. ป้องกันการปิดแท็บหรือรีเฟรชโดยไม่ตั้งใจ
  window.addEventListener("beforeunload", (e) => {
    if (isExamActive && !isExamSubmitted) {
      e.preventDefault();
      e.returnValue = "ระบบกำลังบันทึกการสอบ หากออกจากหน้านี้จะถือว่าสิ้นสุดการสอบ";
      return e.returnValue;
    }
  });

  // 6. บล็อกคลิกขวา
  document.addEventListener("contextmenu", (e) => {
    if (!isExamActive || isExamSubmitted) return;
    e.preventDefault();
    logViolation("พยายามคลิกขวา (Context Menu)");
    return false;
  }, true);

  // 7. บล็อกคีย์ลัดโกงข้อสอบทุกรูปแบบ
  document.addEventListener("keydown", (e) => {
    if (!isExamActive || isExamSubmitted) return;
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const key = e.key ? e.key.toLowerCase() : "";

    // ป้องกัน F12 เปิด DevTools
    if (e.key === "F12") {
      e.preventDefault();
      logViolation("กด F12 พยายามเปิด Developer Tools");
      return false;
    }

    // ป้องกัน PrintScreen บันทึกภาพ
    if (e.key === "PrintScreen") {
      e.preventDefault();
      logViolation("พยายามกดปุ่มบันทึกภาพหน้าจอ (PrintScreen)");
      return false;
    }

    // ป้องกัน DevTools ผ่าน Ctrl+Shift+I / J / C
    if (isCtrlOrCmd && e.shiftKey && (key === "i" || key === "j" || key === "c" || key === "s")) {
      e.preventDefault();
      logViolation("กดคีย์ลัดเปิด Developer Tools / บันทึกภาพ");
      return false;
    }

    // ป้องกันคีย์ลัดสลับแท็บ / เปิดหน้าต่างใหม่ / คัดลอก / วาง / ซอร์สโค้ด
    if (isCtrlOrCmd && ["u", "p", "s", "c", "v", "a", "x", "f", "h", "r", "w", "t", "n"].includes(key)) {
      e.preventDefault();
      logViolation(`กดคีย์ลัดที่ไม่ได้รับอนุญาต (Ctrl+${key.toUpperCase()})`);
      return false;
    }

    // ป้องกัน Alt+Tab หรือ Alt+F4
    if (e.altKey) {
      if (key === "tab" || key === "f4") {
        e.preventDefault();
        logViolation("พยายามกด Alt เพื่อสลับหรือปิดหน้าต่าง");
        return false;
      }
    }
  }, true);
}

// Student Submit Confirmation — BUG-14: await webhook ก่อน reload, UX-02: showConfirm & showAlert
async function handleStudentFinished() {
  const confirmed = await showConfirm(
    "คุณได้กดส่งคำตอบ (Submit) ใน Google Forms เรียบร้อยแล้วใช่หรือไม่?\n\nกดยืนยันเพื่อสิ้นสุดการสอบและปลดล็อกระบบ",
    {
      title: "ยืนยันการส่งข้อสอบ",
      confirmText: "ยืนยันส่งข้อสอบ",
      cancelText: "ยังทำไม่เสร็จ",
      confirmClass: "success",
      icon: "📝"
    }
  );

  if (confirmed) {
    isExamSubmitted = true;
    isExamActive = false;
    clearInterval(timerInterval);
    if (integrityInterval) clearInterval(integrityInterval);

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    // รอให้ webhook ส่งเสร็จก่อนค่อย reload
    try {
      sendAlertToWebhook("ผู้สอบส่งข้อสอบเรียบร้อยแล้ว (ปลดล็อกระบบ)");
    } catch (_) {}
    await showAlert("บันทึกการส่งข้อสอบเรียบร้อยแล้ว ขอบคุณครับ", {
      type: "success",
      title: "ส่งข้อสอบสำเร็จ",
      confirmText: "ตกลง"
    });
    window.location.reload();
  }
}

// Admin Force Stop / Unlock with Passcode — UX-02: showPrompt & showAlert
async function handleAdminUnlock() {
  const pass = await showPrompt("กรุณากรอกรหัสผ่านผู้คุมสอบ (Admin Passcode) เพื่อปลดล็อก:", {
    title: "ปลดล็อกโดยผู้คุมสอบ",
    inputType: "password",
    inputPlaceholder: "กรอกรหัสผ่าน 6 หลัก เช่น 842109",
    confirmText: "ปลดล็อก",
    cancelText: "ยกเลิก",
    confirmClass: "primary",
    icon: "🔒"
  });

  if (pass === examConfig.adminPasscode) {
    isExamSubmitted = true;
    isExamActive = false;
    clearInterval(timerInterval);
    if (integrityInterval) clearInterval(integrityInterval);

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    try {
      sendAlertToWebhook("ผู้คุมสอบกรอกรหัสผ่านเพื่อปลดล็อกการสอบ");
    } catch (_) {}
    await showAlert("ปลดล็อกระบบการสอบเรียบร้อยแล้ว", {
      type: "success",
      title: "ปลดล็อกสำเร็จ",
      confirmText: "ตกลง"
    });
    window.location.reload();
  } else if (pass !== null) {
    await showAlert("รหัสผ่านผู้คุมสอบไม่ถูกต้อง", {
      type: "danger",
      title: "รหัสผ่านผิดพลาด",
      confirmText: "ลองใหม่"
    });
  }
}

// DOM Ready Init
document.addEventListener("DOMContentLoaded", () => {
  initExamFromUrl();
  setupAntiCheatListeners();

  const startBtn = document.getElementById("startExamBtn");
  if (startBtn) {
    startBtn.addEventListener("click", startExam);
  }

  const studentInput = document.getElementById("studentIdInput");
  if (studentInput) {
    studentInput.addEventListener("input", () => {
      studentInput.value = studentInput.value.replace(/\D/g, "");
    });
    studentInput.addEventListener("keypress", (e) => {
      if (e.key === "Enter") startExam();
    });
  }

  const returnFsBtn = document.getElementById("returnFullscreenBtn");
  if (returnFsBtn) {
    returnFsBtn.addEventListener("click", () => {
      requestBrowserFullscreen();
      const modal = document.getElementById("violationModal");
      if (modal) modal.classList.remove("active");
      const iframe = document.getElementById("examIframe");
      if (iframe) iframe.focus();
      lastAlertTime = Date.now() + 1200; // ให้เวลา 1.2 วินาทีในการสลับกลับสู่จอเต็ม
    });
  }

  const finishBtn = document.getElementById("finishExamBtn");
  if (finishBtn) {
    finishBtn.addEventListener("click", handleStudentFinished);
  }

  const adminUnlockBtn = document.getElementById("adminUnlockBtn");
  if (adminUnlockBtn) {
    adminUnlockBtn.addEventListener("click", handleAdminUnlock);
  }
});
