/**
 * Proctor Engine for exam.html (Web App)
 */

let examConfig = {
  title: "แบบทดสอบออนไลน์",
  formUrl: "",
  webhookUrl: DEFAULT_WEBHOOK_URL
};

let studentId = "";
let isExamActive = false;
let isExamSubmitted = false;
let isEntryCodePreVerified = false;
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

// Send Webhook Alert to Neon Cloud API & Direct Local Real-time
function sendAlertToWebhook(violationText, isSeverityHigh = false) {
  if (!examConfig.webhookUrl) return;

  const now = new Date();
  const payload = {
    roomId: examConfig.roomId || "",
    roomTitle: examConfig.title,
    studentId: String(studentId || "ไม่ระบุรหัส").trim(),
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

    let dispatched = false;
    try {
      fetch(examConfig.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payloadStr,
        keepalive: true
      }).catch(() => {});
      dispatched = true;
    } catch (_) {}

    // Fallback ใช้ sendBeacon เฉพาะเมื่อ fetch ล้มเหลวเท่านั้น
    if (!dispatched) {
      try {
        if (navigator.sendBeacon) {
          navigator.sendBeacon(examConfig.webhookUrl, payloadStr);
        }
      } catch (_) {}
    }
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

  // 1. ส่งข้อมูล Real-Time ไปยังหน้าจอคุมสอบสด และฐานข้อมูล Cloud ทันที (สำคัญที่สุด ทำงานก่อนเสมอ)
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
  toast.innerHTML = `<span style="font-weight: 700; margin-right: 6px;">[แจ้งเตือน]</span> ${escapeHtml(msg)}`;
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

  // รองรับทั้งพารามิเตอร์แบบสั้น (f, p, t, w, e, r) และแบบยาว (form, pass, title, webhook, entry, room)
  if (!configData) {
    const rawForm = urlParams.get("f") || urlParams.get("form");
    if (rawForm) {
      configData = {
        roomId: urlParams.get("r") || urlParams.get("room") || "",
        title: urlParams.get("t") || urlParams.get("title") || "แบบทดสอบออนไลน์",
        formUrl: rawForm,
        webhookUrl: urlParams.get("w") || urlParams.get("webhook") || DEFAULT_WEBHOOK_URL,
        entryCode: urlParams.get("e") || urlParams.get("entry") || "",
        category: urlParams.get("c") || urlParams.get("cat") || "ทั่วไป",
        gradeLevel: urlParams.get("g") || urlParams.get("grade") || "ไม่ระบุ"
      };
    }
  }

  if (configData && configData.formUrl) {
    examConfig = {
      roomId: configData.roomId || "",
      title: configData.title || "แบบทดสอบออนไลน์",
      formUrl: formatGoogleFormEmbedUrl(configData.formUrl),
      webhookUrl: configData.webhookUrl || DEFAULT_WEBHOOK_URL,
      entryCode: configData.entryCode || "",
      category: configData.category || "ทั่วไป",
      gradeLevel: configData.gradeLevel || "ไม่ระบุ"
    };

    document.title = `${examConfig.title} - ระบบคุมสอบออนไลน์`;
    const titleEl = document.getElementById("portalExamTitle");
    if (titleEl) titleEl.textContent = examConfig.title;
    const headerTitleEl = document.getElementById("headerExamTitle");
    if (headerTitleEl) headerTitleEl.textContent = examConfig.title;

    // ตรวจสอบ Student ID ที่ส่งมาล่วงหน้าจาก Portal
    const sidParam = urlParams.get("sid") || urlParams.get("studentId");
    const studentInput = document.getElementById("studentIdInput");
    if (sidParam) {
      if (studentInput) {
        studentInput.value = sidParam;
        studentInput.readOnly = true;
        studentInput.style.backgroundColor = "var(--bg-subtle)";
      }
    } else if (studentInput) {
      setTimeout(() => studentInput.focus(), 150);
    }

    // ตรวจสอบ Entry Code ที่ส่งมาล่วงหน้าจาก Portal
    const entryParam = urlParams.get("entry") || urlParams.get("entryCode");
    if (examConfig.entryCode) {
      if (entryParam && String(entryParam).trim() === String(examConfig.entryCode).trim()) {
        isEntryCodePreVerified = true;
      } else {
        // แสดงช่องกรอก Entry Code ให้นักเรียนกรอกเอง
        const entryCodeGroup = document.getElementById("portalEntryCodeGroup");
        if (entryCodeGroup) entryCodeGroup.style.display = "block";
      }
    }
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

  // 3. ตรวจจับการเปิด Developer Tools (วัดความแตกต่างระหว่าง outer และ inner window dimension)
  const widthDiff = window.outerWidth - window.innerWidth;
  const heightDiff = window.outerHeight - window.innerHeight;
  if (widthDiff > 160 || heightDiff > 160) {
    logViolation("ตรวจพบการเปิดหน้าต่าง Developer Tools หรือแทรกแซงหน้าต่างข้อสอบ", true);
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

  // ตรวจสอบรหัสเข้าห้องสอบ (Entry Code) กรณีที่ห้องสอบกำหนดไว้ และยังไม่ได้ verify มาจาก Portal
  if (examConfig.entryCode && !isEntryCodePreVerified) {
    const entryInput = document.getElementById("examRoomEntryCodeInput");
    const enteredCode = (entryInput ? entryInput.value : "").trim();
    if (!enteredCode) {
      await showAlert("กรุณากรอกรหัสเข้าห้องสอบ 6 หลักที่ได้รับจากครูผู้สอน", {
        type: "warning",
        title: "กรุณาระบุรหัสเข้าห้องสอบ",
        confirmText: "ตกลง"
      });
      if (entryInput) entryInput.focus();
      return;
    }
    if (enteredCode !== String(examConfig.entryCode).trim()) {
      await showAlert("รหัสเข้าห้องสอบ 6 หลักไม่ถูกต้อง กรุณาตรวจสอบกับครูผู้คุมสอบ", {
        type: "danger",
        title: "รหัสเข้าสอบผิดพลาด",
        confirmText: "ลองใหม่"
      });
      if (entryInput) entryInput.focus();
      return;
    }
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

  // เริ่มต้นระบบ AI Smart Proctor ตรวจจับกล้องและเสียง
  initAIProctor();

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

  // 7. บล็อกการคัดลอก ลากวาง และคลุมข้อความ (Anti-Clipboard & Anti-Selection)
  ["copy", "cut", "paste", "selectstart", "dragstart"].forEach((evtName) => {
    document.addEventListener(evtName, (e) => {
      if (!isExamActive || isExamSubmitted) return;
      e.preventDefault();
      return false;
    }, true);
  });

  // 8. บล็อกคีย์ลัดโกงข้อสอบทุกรูปแบบ + PrintScreen Clipboard Scrubber
  const handleKeyPrevention = (e) => {
    if (!isExamActive || isExamSubmitted) return;
    const isCtrlOrCmd = e.ctrlKey || e.metaKey;
    const key = e.key ? e.key.toLowerCase() : "";

    // ป้องกัน F12 เปิด DevTools
    if (e.key === "F12") {
      e.preventDefault();
      logViolation("กด F12 พยายามเปิด Developer Tools", true);
      return false;
    }

    // ป้องกัน PrintScreen บันทึกภาพ พร้อมล้างคลิปบอร์ดทันที
    if (e.key === "PrintScreen" || e.code === "PrintScreen" || e.keyCode === 44) {
      e.preventDefault();
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText("");
        }
      } catch (_) {}
      logViolation("พยายามกดปุ่มบันทึกภาพหน้าจอ (PrintScreen)", true);
      return false;
    }

    // ป้องกัน DevTools ผ่าน Ctrl+Shift+I / J / C / S
    if (isCtrlOrCmd && e.shiftKey && (key === "i" || key === "j" || key === "c" || key === "s")) {
      e.preventDefault();
      logViolation("กดคีย์ลัดเปิด Developer Tools / บันทึกภาพ", true);
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
  };

  document.addEventListener("keydown", handleKeyPrevention, true);
  document.addEventListener("keyup", (e) => {
    if (!isExamActive || isExamSubmitted) return;
    if (e.key === "PrintScreen" || e.code === "PrintScreen" || e.keyCode === 44) {
      try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText("");
        }
      } catch (_) {}
    }
  }, true);
}

/* ==========================================================================
   AI Smart Proctor Engine (Client-Side Face & Audio Monitoring)
   Zero raw media uploaded — 100% On-Device Privacy Architecture
   ========================================================================== */

let aiMediaStream = null;
let aiAudioContext = null;
let aiAudioAnalyser = null;
let aiFaceInterval = null;
let aiAudioInterval = null;
let consecutiveAbsenceCount = 0;
let consecutiveVoiceCount = 0;
let nativeFaceDetector = null;

async function initAIProctor() {
  const checkbox = document.getElementById("enableAiProctorCheckbox");
  if (checkbox && !checkbox.checked) {
    console.log("AI Proctor disabled by user setting");
    return;
  }

  const widget = document.getElementById("aiProctorWidget");
  const videoEl = document.getElementById("aiProctorVideo");
  const canvasEl = document.getElementById("aiProctorCanvas");
  const indicatorEl = document.getElementById("aiFaceIndicator");
  const faceBadge = document.getElementById("aiFaceCountBadge");
  const statusEl = document.getElementById("aiProctorStatusText");
  const meterFill = document.getElementById("aiAudioMeterFill");

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    console.warn("MediaDevices API not supported on this device/browser");
    return;
  }

  try {
    aiMediaStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 320, height: 240, facingMode: "user" },
      audio: true
    });

    if (widget) {
      widget.style.display = "block";
      setupAiWidgetToggle();
      // บนหน้าจอมือถือ/แท็บเล็ต หรือจอเล็ก ให้ย่อกล้องอัตโนมัติหลังจากเปิด 3 วินาที เพื่อไม่ให้บังข้อสอบ
      if (window.innerWidth <= 768) {
        setTimeout(() => {
          if (widget && !widget.classList.contains("minimized")) {
            widget.classList.add("minimized");
            const toggleText = document.getElementById("toggleAiWidgetText");
            if (toggleText) toggleText.textContent = "แสดงกล้อง";
          }
        }, 3000);
      }
    }
    if (videoEl) {
      videoEl.srcObject = aiMediaStream;
      await videoEl.play().catch(() => {});
    }

    // 1. Setup Audio Volume Analyser
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        aiAudioContext = new AudioContextClass();
        const source = aiAudioContext.createMediaStreamSource(aiMediaStream);
        aiAudioAnalyser = aiAudioContext.createAnalyser();
        aiAudioAnalyser.fftSize = 256;
        source.connect(aiAudioAnalyser);

        const dataArray = new Uint8Array(aiAudioAnalyser.frequencyBinCount);

        aiAudioInterval = setInterval(() => {
          if (!isExamActive || isExamSubmitted) return;
          aiAudioAnalyser.getByteFrequencyData(dataArray);

          // Calculate RMS Volume
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            const normalized = dataArray[i] / 255;
            sum += normalized * normalized;
          }
          const rms = Math.sqrt(sum / dataArray.length);
          const percent = Math.min(100, Math.round(rms * 250));

          if (meterFill) {
            meterFill.style.width = `${percent}%`;
          }

          // Voice / Talking threshold check
          if (rms > 0.35) {
            consecutiveVoiceCount++;
            if (consecutiveVoiceCount >= 3) {
              logViolation("ตรวจพบเสียงพูดคุยหรือเสียงผิดปกติในบริเวณสอบ (Audio/Voice Detected)");
              consecutiveVoiceCount = 0;
            }
          } else {
            consecutiveVoiceCount = Math.max(0, consecutiveVoiceCount - 1);
          }
        }, 300);
      }
    } catch (audioErr) {
      console.warn("AI Audio Analyser init error:", audioErr);
    }

    // 2. Setup Native FaceDetector if available
    try {
      if ("FaceDetector" in window) {
        nativeFaceDetector = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 5 });
      }
    } catch (_) {}

    // 3. Face Detection Loop (Every 1100ms)
    aiFaceInterval = setInterval(async () => {
      if (!isExamActive || isExamSubmitted || !videoEl || videoEl.readyState < 2) return;

      let detectedFaces = 0;

      if (nativeFaceDetector) {
        try {
          const faces = await nativeFaceDetector.detect(videoEl);
          detectedFaces = faces ? faces.length : 0;
        } catch (_) {}
      } else if (canvasEl) {
        // Fallback: Fast Canvas Skin-tone & Contour Luminance Analysis
        try {
          const ctx = canvasEl.getContext("2d", { willReadFrequently: true });
          ctx.drawImage(videoEl, 0, 0, canvasEl.width, canvasEl.height);
          const imgData = ctx.getImageData(0, 0, canvasEl.width, canvasEl.height);
          const data = imgData.data;

          let skinPixelCount = 0;
          for (let i = 0; i < data.length; i += 16) {
            const r = data[i], g = data[i + 1], b = data[i + 2];
            if (r > 60 && g > 40 && b > 20 && r > g && r > b && (r - Math.min(g, b)) > 15) {
              skinPixelCount++;
            }
          }
          if (skinPixelCount > 60) {
            detectedFaces = 1;
          }
        } catch (_) {}
      }

      // Update UI Indicators
      if (detectedFaces === 0) {
        consecutiveAbsenceCount++;
        if (indicatorEl) indicatorEl.className = "ai-face-indicator alert";
        if (faceBadge) {
          faceBadge.className = "badge badge-danger";
          faceBadge.textContent = "ไม่พบใบหน้า";
        }
        if (statusEl) statusEl.textContent = "เตือน: ไม่พบผู้สอบ";

        if (consecutiveAbsenceCount >= 3) {
          logViolation("ไม่พบใบหน้าผู้เข้าสอบในกล้อง (Face Absence)", true);
          consecutiveAbsenceCount = 0;
        }
      } else if (detectedFaces > 1) {
        consecutiveAbsenceCount = 0;
        if (indicatorEl) indicatorEl.className = "ai-face-indicator alert";
        if (faceBadge) {
          faceBadge.className = "badge badge-danger";
          faceBadge.textContent = `${detectedFaces} คน!`;
        }
        if (statusEl) statusEl.textContent = "เตือน: พบบุคคลอื่น";

        logViolation(`ตรวจพบบุคคลอื่นในกล้อง (${detectedFaces} คน)`, true);
      } else {
        // Exactly 1 face (Normal)
        consecutiveAbsenceCount = 0;
        if (indicatorEl) indicatorEl.className = "ai-face-indicator";
        if (faceBadge) {
          faceBadge.className = "badge badge-success";
          faceBadge.textContent = "ปกติ (1 คน)";
        }
        if (statusEl) statusEl.textContent = "เฝ้าระวังปกติ";
      }
    }, 1100);

  } catch (camErr) {
    console.warn("AI Proctor camera/audio access denied or not available:", camErr.message);
    if (widget) widget.style.display = "none";
  }
}

function setupAiWidgetToggle() {
  const widget = document.getElementById("aiProctorWidget");
  const toggleBtn = document.getElementById("toggleAiWidgetBtn");
  const toggleText = document.getElementById("toggleAiWidgetText");
  const header = document.getElementById("aiProctorHeader");
  if (!widget) return;

  const toggle = (e) => {
    if (e) e.stopPropagation();
    const isMin = widget.classList.toggle("minimized");
    if (toggleText) {
      toggleText.textContent = isMin ? "แสดงกล้อง" : "ซ่อนกล้อง";
    }
  };

  if (toggleBtn) toggleBtn.onclick = toggle;
  if (header) {
    header.onclick = (e) => {
      if (widget.classList.contains("minimized") && e.target !== toggleBtn) {
        toggle(e);
      }
    };
  }
}

function stopAIProctor() {
  if (aiFaceInterval) {
    clearInterval(aiFaceInterval);
    aiFaceInterval = null;
  }
  if (aiAudioInterval) {
    clearInterval(aiAudioInterval);
    aiAudioInterval = null;
  }
  if (aiAudioContext && aiAudioContext.state !== "closed") {
    aiAudioContext.close().catch(() => {});
    aiAudioContext = null;
  }
  if (aiMediaStream) {
    aiMediaStream.getTracks().forEach((track) => {
      try {
        track.stop();
      } catch (_) {}
    });
    aiMediaStream = null;
  }
  const widget = document.getElementById("aiProctorWidget");
  if (widget) widget.style.display = "none";
}

function showCompletedScreen(reason = "ส่งข้อสอบสำเร็จ") {
  stopAIProctor();

  const portalView = document.getElementById("examPortalView");
  const activeView = document.getElementById("examActiveView");
  const completedView = document.getElementById("examCompletedView");
  const modal = document.getElementById("violationModal");

  if (portalView) portalView.style.display = "none";
  if (activeView) activeView.style.display = "none";
  if (modal) modal.classList.remove("active");

  const titleEl = document.getElementById("completedExamTitle");
  const sIdEl = document.getElementById("completedStudentId");
  const durEl = document.getElementById("completedDuration");
  const subTimeEl = document.getElementById("completedSubmitTime");
  const vCountEl = document.getElementById("completedViolationCount");

  if (titleEl) titleEl.textContent = examConfig.title || "แบบทดสอบออนไลน์";
  if (sIdEl) sIdEl.textContent = studentId || "-";
  
  const elapsedSecs = secondsElapsed || Math.floor((Date.now() - timerStartTime) / 1000);
  const hrs = Math.floor(elapsedSecs / 3600);
  const mins = Math.floor((elapsedSecs % 3600) / 60);
  const secs = elapsedSecs % 60;
  let durStr = "";
  if (hrs > 0) durStr += `${hrs} ชม. `;
  if (mins > 0 || hrs > 0) durStr += `${mins} นาที `;
  durStr += `${secs} วินาที`;
  if (durEl) durEl.textContent = durStr;

  if (subTimeEl) subTimeEl.textContent = new Date().toLocaleTimeString("th-TH");
  if (vCountEl) {
    if (violationCount > 0) {
      vCountEl.textContent = `เตือน ${violationCount} ครั้ง`;
      vCountEl.style.color = "#dc2626";
    } else {
      vCountEl.textContent = "0 ครั้ง (ไม่พบความผิดปกติ)";
      vCountEl.style.color = "#059669";
    }
  }

  if (completedView) {
    completedView.style.display = "flex";
  }
}

// Student Submit Confirmation — BUG-14 & BUG-02: แสดงหน้าจอสำเร็จแทนการ reload
async function handleStudentFinished() {
  const confirmed = await showConfirm(
    "คุณได้กดส่งคำตอบ (Submit) ใน Google Forms เรียบร้อยแล้วใช่หรือไม่?\n\nกดยืนยันเพื่อสิ้นสุดการสอบและปลดล็อกระบบ",
    {
      title: "ยืนยันการส่งข้อสอบ",
      confirmText: "ยืนยันส่งข้อสอบ",
      cancelText: "ยังทำไม่เสร็จ",
      confirmClass: "success",
      icon: ""
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

    try {
      sendAlertToWebhook("ผู้สอบส่งข้อสอบเรียบร้อยแล้ว (ปลดล็อกระบบ)");
    } catch (_) {}

    showCompletedScreen("ส่งข้อสอบสำเร็จ");
  }
}

// Admin Force Stop / Unlock with Passcode — Secure Server-Side Verification
async function handleAdminUnlock() {
  const pass = await showPrompt("กรุณากรอกรหัสผ่านผู้คุมสอบ (Admin Passcode) เพื่อปลดล็อก:", {
    title: "ปลดล็อกโดยผู้คุมสอบ",
    inputType: "password",
    inputPlaceholder: "กรอกรหัสผ่าน 6 หลัก เช่น 842109",
    confirmText: "ปลดล็อก",
    cancelText: "ยกเลิก",
    confirmClass: "primary",
    icon: ""
  });

  if (!pass) return;

  let isUnlockValid = false;
  const webhookUrl = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;

  // 1. ตรวจสอบรหัสผ่านกับ Server API (ปลอดภัย รหัสไม่หลุดในฝั่งนักเรียน)
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "verifyAdminUnlock",
        roomId: examConfig.roomId || "",
        passcode: pass
      })
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.status === "success" && data.valid) {
        isUnlockValid = true;
      }
    }
  } catch (err) {
    console.warn("verifyAdminUnlock API error:", err);
  }

  if (isUnlockValid) {
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

    showCompletedScreen("ปลดล็อกโดยผู้คุมสอบ");
  } else {
    await showAlert("รหัสผ่านผู้คุมสอบไม่ถูกต้อง กรุณาตรวจสอบกับผู้คุมสอบ", {
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

// รับคำสั่งสั่งจบการสอบระยะไกลจากผู้คุมสอบ (Remote Force Finish)
if (typeof BroadcastChannel !== "undefined") {
  try {
    const rxBus = new BroadcastChannel("exam_proctor_bus");
    rxBus.onmessage = (e) => {
      if (e.data && e.data.type === "FORCE_END_EXAM") {
        const targetStudent = String(e.data.studentId || "").trim();
        const currentStudent = String(studentId || "").trim();
        if (targetStudent && currentStudent && targetStudent === currentStudent) {
          handleRemoteForceEnd(e.data.reason || "ผู้คุมสอบสั่งจบการสอบ (ทำผิดกฎหรือหลุดการสอบ)");
        }
      }
    };
  } catch (_) {}
}

window.addEventListener("storage", (e) => {
  if (e.key === "exam_force_finish" && e.newValue) {
    try {
      const data = JSON.parse(e.newValue);
      const targetStudent = String(data.studentId || "").trim();
      const currentStudent = String(studentId || "").trim();
      if (targetStudent && currentStudent && targetStudent === currentStudent) {
        handleRemoteForceEnd(data.reason || "ผู้คุมสอบสั่งจบการสอบ (ทำผิดกฎหรือหลุดการสอบ)");
      }
    } catch (_) {}
  }
});

function handleRemoteForceEnd(reason = "ผู้คุมสอบสั่งจบการสอบ (ทำผิดกฎหรือหลุดการสอบ)") {
  if (isExamSubmitted) return;
  isExamSubmitted = true;
  isExamActive = false;
  if (timerInterval) clearInterval(timerInterval);
  if (integrityInterval) clearInterval(integrityInterval);
  if (document.fullscreenElement) {
    document.exitFullscreen().catch(() => {});
  }
  showCompletedScreen(reason);
}
