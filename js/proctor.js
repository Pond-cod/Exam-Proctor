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

// Audio Beep Warning
function playWarningBeep() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

// Send Webhook Alert to Google Apps Script / Google Sheets
async function sendAlertToWebhook(violationText, isSeverityHigh = false) {
  if (!examConfig.webhookUrl) return;

  const now = new Date();
  const payload = {
    studentId: studentId || "ไม่ระบุรหัส",
    violation: violationText,
    timestamp: now.toISOString(),
    time: now.toLocaleTimeString("th-TH"),
    date: now.toLocaleDateString("th-TH"),
    isSeverityHigh: isSeverityHigh,
    formTitle: examConfig.title
  };

  try {
    await fetch(examConfig.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.warn("Webhook post error:", err);
  }
}

// Debounce Violation Alerts
let lastAlertTime = 0;
function logViolation(detail, isSeverityHigh = false) {
  if (!isExamActive || isExamSubmitted) return;

  const now = Date.now();
  if (now - lastAlertTime < 2000) return;
  lastAlertTime = now;

  violationCount++;
  playWarningBeep();
  showToastAlert(`ตรวจพบเหตุการณ์: ${detail} (ครั้งที่ ${violationCount})`);
  sendAlertToWebhook(detail, isSeverityHigh);

  const vCountEl = document.getElementById("headerViolationCount");
  if (vCountEl) {
    vCountEl.textContent = `แจ้งเตือน: ${violationCount} ครั้ง`;
    vCountEl.style.display = "inline-flex";
  }
}

// Toast Alert
function showToastAlert(msg) {
  const toast = document.getElementById("toastAlert");
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add("active");
  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    toast.classList.remove("active");
  }, 4000);
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

  if (!configData) {
    const rawForm = urlParams.get("form");
    if (rawForm) {
      configData = {
        title: urlParams.get("title") || "แบบทดสอบออนไลน์",
        formUrl: rawForm,
        webhookUrl: urlParams.get("webhook") || DEFAULT_WEBHOOK_URL,
        adminPasscode: urlParams.get("pass") || DEFAULT_ADMIN_PASSCODE
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

  sendAlertToWebhook(`เริ่มเข้าทำข้อสอบ: ${examConfig.title}`);
}

// Fullscreen API Helper
function requestBrowserFullscreen() {
  const docEl = document.documentElement;
  if (docEl.requestFullscreen) {
    docEl.requestFullscreen().catch(() => {});
  } else if (docEl.webkitRequestFullscreen) {
    docEl.webkitRequestFullscreen();
  } else if (docEl.msRequestFullscreen) {
    docEl.msRequestFullscreen();
  }
}

// Anti-Cheat Listeners
function setupAntiCheatListeners() {
  // 1. ตรวจจับการหลุดจากโหมดเต็มจอ
  document.addEventListener("fullscreenchange", () => {
    if (!isExamActive || isExamSubmitted) return;
    const isFullscreen = !!document.fullscreenElement;
    const modal = document.getElementById("violationModal");
    if (!isFullscreen) {
      if (modal) modal.classList.add("active");
      logViolation("หลุดออกจากโหมดเต็มหน้าจอ (กด Esc หรือย่อหน้าต่าง)", true);
    } else {
      if (modal) modal.classList.remove("active");
    }
  });

  // 2. ดักจับการสลับแท็บ / ย่อหน้าจอ
  document.addEventListener("visibilitychange", () => {
    if (!isExamActive || isExamSubmitted) return;
    if (document.hidden) {
      logViolation("สลับแท็บ หรือย่อหน้าต่างข้อสอบ");
    }
  });

  // 3. ดักจับการคลิกออกนอกหน้าจอ / สลับโปรแกรม
  window.addEventListener("blur", () => {
    if (!isExamActive || isExamSubmitted) return;
    setTimeout(() => {
      if (!document.hasFocus() && isExamActive && !isExamSubmitted) {
        logViolation("คลิกออกนอกหน้าจอ หรือสลับโปรแกรมอื่นทับ");
      }
    }, 400);
  });

  // 4. บล็อกคลิกขวา
  document.addEventListener("contextmenu", (e) => {
    if (!isExamActive || isExamSubmitted) return;
    e.preventDefault();
    logViolation("พยายามคลิกขวา (Context Menu)");
    return false;
  });

  // 5. บล็อกคีย์ลัดโกงข้อสอบ
  document.addEventListener("keydown", (e) => {
    if (!isExamActive || isExamSubmitted) return;
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const key = e.key ? e.key.toLowerCase() : "";

    if (e.key === "F12") {
      e.preventDefault();
      logViolation("กด F12 พยายามเปิด Developer Tools");
      return false;
    }

    if (isCtrlOrCmd && e.shiftKey && (key === "i" || key === "j" || key === "c")) {
      e.preventDefault();
      logViolation("กดคีย์ลัดเปิด Developer Tools");
      return false;
    }

    if (isCtrlOrCmd && (key === "u" || key === "p" || key === "s" || key === "c")) {
      e.preventDefault();
      logViolation(`กดคีย์ลัดที่ไม่ได้รับอนุญาต (Ctrl+${key.toUpperCase()})`);
      return false;
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

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    // รอให้ webhook ส่งเสร็จก่อนค่อย reload (BUG-14)
    try {
      await sendAlertToWebhook("ผู้สอบส่งข้อสอบเรียบร้อยแล้ว (ปลดล็อกระบบ)");
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

    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }

    // BUG-14: await ก่อน reload
    try {
      await sendAlertToWebhook("ผู้คุมสอบกรอกรหัสผ่านเพื่อปลดล็อกการสอบ");
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
