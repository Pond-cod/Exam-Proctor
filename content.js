let isProctoringActive = false;
let isExamCompleted = false;

// ฟังก์ชันตรวจสอบว่าหน้านี้เป็นหน้าส่งคำตอบสำเร็จแล้วหรือไม่
function isSubmissionCompletedPage() {
  const url = window.location.href.toLowerCase();
  const pageText = (document.body ? document.body.innerText : "").toLowerCase();
  return (
    url.includes("formresponse") ||
    pageText.includes("เราได้บันทึกคำตอบของคุณไว้แล้ว") ||
    pageText.includes("ส่งคำตอบอีก") ||
    pageText.includes("your response has been recorded") ||
    pageText.includes("submit another response")
  );
}

// ฟังก์ชันปลดล็อกระบบเมื่อส่งข้อสอบเสร็จสมบูรณ์
function handleExamSubmittedSuccessfully() {
  isProctoringActive = false;
  isExamCompleted = true;

  // ลบ/ซ่อนกล่องเตือนสีแดงทันที
  const warningToast = document.getElementById("exam-proctor-violation-toast");
  if (warningToast) {
    warningToast.style.display = "none";
    warningToast.remove();
  }
  if (window.violationToastTimeout) {
    clearTimeout(window.violationToastTimeout);
  }

  // ลบ CSS ป้องกันการ Copy
  const style = document.getElementById("exam-proctor-style");
  if (style) style.remove();

  // แสดง Banner สีเขียวแจ้งว่าส่งข้อสอบสำเร็จและปลดล็อกแล้ว
  showSubmissionSuccessBanner();

  // ส่งสัญญาณไปยัง background service worker
  chrome.runtime.sendMessage({ type: "EXAM_SUBMITTED" });
}

function initProctoring() {
  if (isExamCompleted || isSubmissionCompletedPage()) {
    handleExamSubmittedSuccessfully();
    return;
  }
  // ตั้ง flag ก่อน async callback เพื่อป้องกัน Race Condition (BUG-05)
  if (isProctoringActive) return;
  isProctoringActive = true;

  chrome.storage.local.get(["isExamActive", "studentId", "secretToken"], (data) => {
    if (!data.isExamActive || isExamCompleted || isSubmissionCompletedPage()) {
      isProctoringActive = false; // rollback flag ถ้าไม่ผ่านเงื่อนไข
      if (isSubmissionCompletedPage()) handleExamSubmittedSuccessfully();
      return;
    }

    // ลบแท่งเริ่มสอบ launcher banner หากมีอยู่
    const launcher = document.getElementById("exam-proctor-launcher");
    if (launcher) launcher.remove();

    const formTitle = document.title || "Google Forms";
    const studentId = data.studentId || "ผู้สอบ (เครื่องนี้)";
    const secretToken = data.secretToken || "EXAM_LOCK_999";

    console.log("[ExamProctor] ระบบคุมสอบเริ่มทำงานบนหน้า:", formTitle);

    // 1. ส่งสัญญาณว่าเข้าหน้าฟอร์มสำเร็จ
    setTimeout(() => {
      if (!window.hasReportedStart && isProctoringActive && !isExamCompleted) {
        window.hasReportedStart = true;
        chrome.runtime.sendMessage({
          type: "EXAM_STARTED",
          formTitle: formTitle,
          studentId: studentId
        });
      }
    }, 800);

    // 2. แบนเนอร์แจ้งเตือนสถานะการคุมสอบบนหน้าเว็บ Google Forms
    injectProctorBanner(studentId);

    // 3. ระบบปลดล็อกฟอร์มอัตโนมัติ (Auto-fill Secret Token & Auto-hide)
    handleAutoFillAndHideToken(studentId, secretToken);

    // สังเกตการเปลี่ยนแปลง DOM เพื่อดักกรณีฟอร์มโหลดช้าหรือเปลี่ยนหน้า Section
    const formObserver = new MutationObserver(() => {
      if (!isProctoringActive || isExamCompleted) return;
      handleAutoFillAndHideToken(studentId, secretToken);
    });
    formObserver.observe(document.body, { childList: true, subtree: true });

    // 4. ดักจับการสลับแท็บ / ย่อหน้าจอ (visibilitychange)
    document.addEventListener("visibilitychange", () => {
      if (!isProctoringActive || isExamCompleted || isSubmissionCompletedPage()) return;
      if (document.hidden) {
        triggerViolationWarning("สลับแท็บ หรือย่อหน้าจอเบราว์เซอร์");
        chrome.runtime.sendMessage({
          type: "VIOLATION",
          detail: `สลับแท็บ หรือย่อหน้าต่างข้อสอบ (ขณะทำฟอร์ม: ${formTitle})`
        });
      }
    });

    // 5. ดักจับการคลิกเมาส์ออกนอกหน้าจอ หรือสลับโปรแกรม (blur)
    window.addEventListener("blur", () => {
      if (!isProctoringActive || isExamCompleted || isSubmissionCompletedPage()) return;
      triggerViolationWarning("คลิกออกนอกหน้าจอ หรือสลับโปรแกรมอื่นทับ");
      chrome.runtime.sendMessage({
        type: "VIOLATION",
        detail: `คลิกออกนอกหน้าจอ หรือสลับโปรแกรม (ขณะทำฟอร์ม: ${formTitle})`
      });
    });

    // 6. ป้องกันคลิกขวา (Context Menu)
    document.addEventListener("contextmenu", (e) => {
      if (!isProctoringActive || isExamCompleted || isSubmissionCompletedPage()) return;
      e.preventDefault();
      triggerViolationWarning("พยายามคลิกขวา (ไม่อนุญาต)");
      chrome.runtime.sendMessage({
        type: "VIOLATION",
        detail: `พยายามคลิกขวาบนหน้าข้อสอบ (Inspect / Context Menu)`
      });
      return false;
    });

    // 7. บล็อกคีย์ลัดโกงข้อสอบ (F12, DevTools, Copy, Paste, Print, Save)
    document.addEventListener("keydown", (e) => {
      if (!isProctoringActive || isExamCompleted || isSubmissionCompletedPage()) return;
      const isCtrlOrCmd = e.ctrlKey || e.metaKey;
      const key = e.key ? e.key.toLowerCase() : "";

      // ป้องกัน F12
      if (e.key === "F12") {
        e.preventDefault();
        e.stopPropagation();
        triggerViolationWarning("พยายามเปิด Developer Tools (F12)");
        chrome.runtime.sendMessage({ type: "VIOLATION", detail: "กด F12 พยายามเปิด Developer Tools" });
        return false;
      }

      // ป้องกัน Ctrl+Shift+I / Ctrl+Shift+J / Ctrl+Shift+C (DevTools)
      if (isCtrlOrCmd && e.shiftKey && (key === "i" || key === "j" || key === "c")) {
        e.preventDefault();
        e.stopPropagation();
        triggerViolationWarning("พยายามเปิด DevTools");
        chrome.runtime.sendMessage({ type: "VIOLATION", detail: "กดคีย์ลัดเปิด Developer Tools" });
        return false;
      }

      // ป้องกัน Ctrl+U (View Source), Ctrl+P (Print), Ctrl+S (Save)
      if (isCtrlOrCmd && (key === "u" || key === "p" || key === "s")) {
        e.preventDefault();
        e.stopPropagation();
        triggerViolationWarning(`กดคีย์ลัดที่ไม่อนุญาต (Ctrl+${key.toUpperCase()})`);
        chrome.runtime.sendMessage({ type: "VIOLATION", detail: `กดคีย์ลัด Ctrl+${key.toUpperCase()}` });
        return false;
      }
    }, true);

    // 8. ห้ามเลือกข้อความ / ลากคลุมข้อความ (Anti-Copy CSS)
    injectAntiCopyCSS();

    // 9. ตรวจสอบการส่งข้อสอบสำเร็จ เพื่อสั่งปลดล็อกระบบอัตโนมัติ
    const checkSubmitObserver = new MutationObserver(() => {
      if (isSubmissionCompletedPage()) {
        handleExamSubmittedSuccessfully();
        checkSubmitObserver.disconnect();
        formObserver.disconnect();
      }
    });
    checkSubmitObserver.observe(document.body, { childList: true, subtree: true });
  });
}

// 1. ตรวจสอบสถานะเมื่อโหลดหน้าเว็บ
if (isSubmissionCompletedPage()) {
  handleExamSubmittedSuccessfully();
} else {
  chrome.storage.local.get(["isExamActive"], (data) => {
    if (data.isExamActive) {
      initProctoring();
    }
  });
}

// 2. ดักรับคำสั่งเริ่มสอบจาก Popup ในแท็บปัจจุบัน
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "ACTIVATE_PROCTORING") {
    if (!isSubmissionCompletedPage()) {
      initProctoring();
      sendResponse({ activated: true });
    } else {
      // BUG-04: ต้อง sendResponse ทุกกรณีเพื่อไม่ให้ channel hang
      sendResponse({ activated: false, reason: "submission_completed" });
    }
  }
  return true;
});

// 3. ตรวจจับการเปลี่ยนแปลงของ Storage (เมื่อกดเริ่มสอบหรือหยุดสอบ)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.isExamActive) {
    if (changes.isExamActive.newValue === true) {
      if (!isSubmissionCompletedPage()) {
        initProctoring();
      }
    } else {
      isProctoringActive = false;
      isExamCompleted = true;
      const toast = document.getElementById("exam-proctor-violation-toast");
      if (toast) toast.remove();
      const style = document.getElementById("exam-proctor-style");
      if (style) style.remove();
      const banner = document.getElementById("exam-proctor-banner");
      if (banner && !isSubmissionCompletedPage()) banner.remove();
      document.body.style.paddingTop = "0px";
    }
  }
});

// ฟังก์ชันค้นหาช่องกรอกรหัสลับและชื่อ กรอกค่า และซ่อนช่องรหัสลับ
function handleAutoFillAndHideToken(studentId, secretToken) {
  // หาบล็อกคำถามทั้งหมดใน Google Forms
  const questionBlocks = document.querySelectorAll('div[role="listitem"], .Qr7O8, .geS5n');

  questionBlocks.forEach((block) => {
    const textContent = (block.innerText || "").toLowerCase();
    const input = block.querySelector('input[type="text"], input[type="password"], textarea, input.whsOnd');

    // ตรวจสอบว่าเป็นช่องรหัสลับ (Secret Token) หรือไม่
    const isTokenQuestion =
      textContent.includes("รหัสลับ") ||
      textContent.includes("secret token") ||
      textContent.includes("secret") ||
      textContent.includes("token") ||
      textContent.includes("passcode") ||
      textContent.includes("รหัสผ่าน") ||
      (textContent.includes("รหัส") && !textContent.includes("รหัสประจำตัว") && !textContent.includes("รหัสนักเรียน") && !textContent.includes("รหัสบัตร"));

    if (isTokenQuestion && input) {
      if (input.value !== secretToken) {
        fillInputValue(input, secretToken);
        console.log("[ExamProctor] กรอก Secret Token อัตโนมัติแล้ว:", secretToken);
      }
      // ซ่อน Element คำถามนี้ เพื่อไม่ให้ผู้สอบมองเห็นรหัสลับ
      if (block.style.display !== "none") {
        block.style.display = "none";
      }
    }

    // ตรวจสอบว่าเป็นช่องรหัสนักเรียน / รหัสประจำตัว / เลขที่ผู้สอบ และยังว่างอยู่หรือไม่
    const isStudentIdQuestion =
      (textContent.includes("รหัสนักเรียน") ||
       textContent.includes("รหัสประจำตัว") ||
       textContent.includes("เลขประจำตัว") ||
       textContent.includes("เลขที่") ||
       textContent.includes("student id")) &&
      !isTokenQuestion;

    if (isStudentIdQuestion && input && studentId && !input.value) {
      fillInputValue(input, studentId);
      console.log("[ExamProctor] กรอกรหัสนักเรียนอัตโนมัติ:", studentId);
    }
  });

  // กรณีหาบล็อกไม่เจอ แต่มี input ให้ลองดู placeholder หรือ aria-label
  const allInputs = document.querySelectorAll('input[type="text"], input.whsOnd');
  allInputs.forEach((input) => {
    const aria = (input.getAttribute("aria-label") || "").toLowerCase();
    const isTokenAria = aria.includes("รหัสลับ") || aria.includes("secret") || aria.includes("token") || (aria.includes("รหัส") && !aria.includes("ประจำตัว") && !aria.includes("นักเรียน"));
    if (isTokenAria) {
      if (input.value !== secretToken) {
        fillInputValue(input, secretToken);
      }
      const parentBlock = input.closest('div[role="listitem"]') || input.closest('.Qr7O8');
      if (parentBlock) parentBlock.style.display = "none";
    }
  });
}

// ฟังก์ชันช่วยเซ็ตค่า input และกระตุ้น Event ให้ Google Forms รับรู้ค่า
function fillInputValue(inputEl, value) {
  inputEl.focus();
  inputEl.value = value;
  inputEl.setAttribute("value", value);

  // กระตุ้น Event ตามมาตรฐานเว็บฟอร์ม
  inputEl.dispatchEvent(new Event("input", { bubbles: true }));
  inputEl.dispatchEvent(new Event("change", { bubbles: true }));
  inputEl.dispatchEvent(new Event("blur", { bubbles: true }));
}

// แสดงแถบเตือนสถานะการคุมสอบด้านบน
function injectProctorBanner(studentId) {
  if (document.getElementById("exam-proctor-banner")) return;

  const banner = document.createElement("div");
  banner.id = "exam-proctor-banner";
  banner.innerHTML = `
    <div style="display:flex; align-items:center; justify-content:space-between; width:100%; max-width:900px; margin:0 auto;">
      <div style="display:flex; align-items:center; gap:8px;">
        <span style="display:inline-block; width:10px; height:10px; background:#34a853; border-radius:50%; animation: pulse 1.5s infinite;"></span>
        <strong>ระบบคุมสอบกำลังทำงาน (Exam Proctor Active)</strong>
        <span style="background:rgba(255,255,255,0.2); padding:2px 8px; border-radius:12px; font-size:12px;">รหัสนักเรียน: ${studentId || "กำลังสอบ"}</span>
      </div>
      <div style="font-size:13px; color:#ffdddd;">
        ห้ามสลับหน้าจอ ห้ามเปิดแท็บใหม่ หรือคลิกออกนอกหน้าข้อสอบ
      </div>
    </div>
  `;

  banner.setAttribute("style", `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    background: linear-gradient(90deg, #1a73e8, #d93025);
    color: white;
    font-family: 'TH Sarabun PSK', 'TH Sarabun New', 'Sarabun', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 16px;
    padding: 7px 16px;
    z-index: 9999999;
    box-shadow: 0 2px 8px rgba(0,0,0,0.2);
    box-sizing: border-box;
  `);

  document.body.prepend(banner);
  document.body.style.paddingTop = "38px";
}

// ฟังก์ชันส่งเสียงเตือนบี๊บเมื่อทำผิดกฎ
function playWarningBeep() {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "square";
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, ctx.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

// แสดงแจ้งเตือนฉุกเฉินเมื่อทำผิดกฎ (Violation Alert Overlay)
function triggerViolationWarning(msg) {
  if (!isProctoringActive || isExamCompleted || isSubmissionCompletedPage()) return;
  playWarningBeep();
  let warningToast = document.getElementById("exam-proctor-violation-toast");
  if (!warningToast) {
    warningToast = document.createElement("div");
    warningToast.id = "exam-proctor-violation-toast";
    warningToast.setAttribute("style", `
      position: fixed;
      bottom: 24px;
      right: 24px;
      background: #d93025;
      color: white;
      padding: 14px 20px;
      border-radius: 8px;
      box-shadow: 0 4px 16px rgba(217, 48, 37, 0.4);
      z-index: 10000000;
      font-family: 'TH Sarabun PSK', 'TH Sarabun New', 'Sarabun', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      font-weight: 500;
      display: flex;
      align-items: center;
      gap: 10px;
      transition: all 0.3s ease;
      animation: shake 0.5s ease-in-out;
    `);
    document.body.appendChild(warningToast);
  }

  warningToast.innerHTML = `
    <span style="background: rgba(0,0,0,0.25); padding: 4px 8px; border-radius: 4px; font-size: 13px; font-weight: 700;">แจ้งเตือน</span>
    <div>
      <div style="font-weight:bold;">ตรวจพบการกระทำผิดกฎ!</div>
      <div style="font-size:14px; opacity:0.9;">${msg} (รายงานไปยังผู้คุมสอบแล้ว)</div>
    </div>
  `;
  warningToast.style.display = "flex";

  clearTimeout(window.violationToastTimeout);
  window.violationToastTimeout = setTimeout(() => {
    if (warningToast) warningToast.style.display = "none";
  }, 4000);
}

// แสดง Banner ปลดล็อกเมื่อส่งคำตอบเรียบร้อย
function showSubmissionSuccessBanner() {
  let banner = document.getElementById("exam-proctor-banner");
  if (!banner) {
    banner = document.createElement("div");
    banner.id = "exam-proctor-banner";
    banner.setAttribute("style", `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      background: #1e8e3e;
      color: white;
      font-family: 'TH Sarabun PSK', 'TH Sarabun New', 'Sarabun', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      font-size: 16px;
      padding: 10px 16px;
      z-index: 9999999;
      box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      box-sizing: border-box;
    `);
    document.body.prepend(banner);
    document.body.style.paddingTop = "42px";
  } else {
    banner.style.background = "#1e8e3e";
  }

  banner.innerHTML = `
    <div style="text-align:center; width:100%; font-weight:bold; font-size:16px;">
      ส่งข้อสอบเรียบร้อยแล้ว ระบบปลดล็อกการคุมสอบ คุณสามารถปิดหน้าต่างนี้ได้ตามปกติ
    </div>
  `;
  banner.style.display = "block";
}

// ป้องกันการ Copy และการลากคลุมข้อความในฟอร์ม
function injectAntiCopyCSS() {
  const style = document.createElement("style");
  style.id = "exam-proctor-style";
  style.textContent = `
    body {
      -webkit-user-select: none !important;
      -moz-user-select: none !important;
      -ms-user-select: none !important;
      user-select: none !important;
    }
    input, textarea {
      -webkit-user-select: text !important;
      user-select: text !important;
    }
    @keyframes pulse {
      0% { opacity: 0.4; }
      50% { opacity: 1; }
      100% { opacity: 0.4; }
    }
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      20%, 60% { transform: translateX(-6px); }
      40%, 80% { transform: translateX(6px); }
    }
  `;
  document.head.appendChild(style);
}