/**
 * Exam Creator Engine (for create.html)
 * Version: v5.2
 */

function populateCreatorDropdowns() {
  const catSel = document.getElementById("examCategorySelect");
  const gradeSel = document.getElementById("examGradeSelect");

  if (catSel) {
    catSel.innerHTML = SUBJECT_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  }
  if (gradeSel) {
    gradeSel.innerHTML = GRADE_LEVELS.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  }
}

async function generateExamLink() {
  const title = (document.getElementById("examTitleInput") ? document.getElementById("examTitleInput").value : "").trim() || "แบบทดสอบออนไลน์";
  const rawFormUrl = (document.getElementById("examFormUrlInput") ? document.getElementById("examFormUrlInput").value : "").trim();
  const defaultWh = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  const webhookUrl = (document.getElementById("examWebhookInput") ? document.getElementById("examWebhookInput").value : "").trim() || defaultWh;
  const category = (document.getElementById("examCategorySelect") ? document.getElementById("examCategorySelect").value : "").trim() || "ทั่วไป (General)";
  const gradeLevel = (document.getElementById("examGradeSelect") ? document.getElementById("examGradeSelect").value : "").trim() || "ไม่ระบุ (All / Not Specified)";
  const status = (document.getElementById("examStatusSelect") ? document.getElementById("examStatusSelect").value : "OPEN") || "OPEN";
  
  // รหัสเข้าห้องสอบสำหรับนักเรียน 6 หลัก
  let entryCode = (document.getElementById("examEntryCodeInput").value || "").trim();
  if (!entryCode || !/^\d{6}$/.test(entryCode)) {
    entryCode = generateEntryCode();
    const entryInputEl = document.getElementById("examEntryCodeInput");
    if (entryInputEl) entryInputEl.value = entryCode;
  }

  // รหัสผ่านผู้คุมสอบ 6 หลัก
  let adminPasscode = (document.getElementById("examPasscodeInput").value || "").trim();
  if (!adminPasscode || !/^\d{6}$/.test(adminPasscode)) {
    adminPasscode = generateRandomPasscode();
    const passInputEl = document.getElementById("examPasscodeInput");
    if (passInputEl) passInputEl.value = adminPasscode;
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

  const generateBtn = document.getElementById("generateLinkBtn");
  const origBtnContent = generateBtn ? generateBtn.innerHTML : "";
  if (generateBtn) {
    generateBtn.disabled = true;
    generateBtn.classList.add("is-loading");
    generateBtn.innerHTML = `<span class="btn-spinner"></span> กำลังสร้างห้องสอบและบันทึกลงระบบ...`;
  }

  try {
    const cleanFormUrl = formatGoogleFormEmbedUrl(rawFormUrl);
    const roomId = "RM-" + Math.floor(100000 + Math.random() * 900000);

    const creatorUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
    const roomConfig = {
      roomId: roomId,
      title: title,
      category: category,
      gradeLevel: gradeLevel,
      formUrl: cleanFormUrl,
      status: status,
      entryCode: entryCode,
      adminPasscode: adminPasscode,
      webhookUrl: webhookUrl,
      creatorUsername: creatorUser ? (creatorUser.username || "") : "",
      creatorId: creatorUser ? (creatorUser.userId || "") : "",
      createdBy: creatorUser ? (creatorUser.displayName || creatorUser.username || "ครูผู้สอน") : "ครูผู้สอน",
      createdAt: new Date().toISOString()
    };

    const encodedData = encodeExamConfig(roomConfig);
    const examRelPath = window.location.pathname.includes("/admin/") ? "../exam.html" : "exam.html";
    const baseUrl = new URL(examRelPath, window.location.href);
    baseUrl.searchParams.set("data", encodedData);
    const fullExamUrl = baseUrl.toString();

    // แสดงผลลัพธ์
    const resultBox = document.getElementById("linkResultBox");
    const linkDisplay = document.getElementById("generatedLinkDisplay");
    const testOpenBtn = document.getElementById("testOpenLinkBtn");
    const entryCodeDisplay = document.getElementById("generatedEntryCodeDisplay");
    const copyEntryCodeBtn = document.getElementById("copyEntryCodeBtn");
    const passcodeDisplay = document.getElementById("generatedPasscodeDisplay");
    const copyPasscodeBtn = document.getElementById("copyPasscodeBtn");

    if (linkDisplay) linkDisplay.value = fullExamUrl;
    if (testOpenBtn) testOpenBtn.href = fullExamUrl;
    
    if (entryCodeDisplay) entryCodeDisplay.textContent = entryCode;
    if (copyEntryCodeBtn) {
      copyEntryCodeBtn.onclick = () => {
        navigator.clipboard.writeText(entryCode).then(() => {
          const orig = copyEntryCodeBtn.textContent;
          copyEntryCodeBtn.textContent = "คัดลอกรหัสแล้ว!";
          setTimeout(() => { copyEntryCodeBtn.textContent = orig; }, 2000);
        });
      };
    }

    if (passcodeDisplay) passcodeDisplay.textContent = adminPasscode;
    if (copyPasscodeBtn) {
      copyPasscodeBtn.onclick = () => {
        navigator.clipboard.writeText(adminPasscode).then(() => {
          const orig = copyPasscodeBtn.textContent;
          copyPasscodeBtn.textContent = "คัดลอกรหัสแล้ว!";
          setTimeout(() => { copyPasscodeBtn.textContent = orig; }, 2000);
        });
      };
    }

    const qrWrapper = document.getElementById("examQrContainer") || document.querySelector(".qr-image-wrapper");
    if (qrWrapper) {
      generateQrCode(qrWrapper, fullExamUrl, 220);
    }

    const zoomQrBtn = document.getElementById("zoomQrBtn");
    const projectorModal = document.getElementById("qrProjectorModal");
    if (zoomQrBtn) {
      zoomQrBtn.onclick = () => {
        const projectorContainer = document.getElementById("projectorQrContainer");
        const projectorTitle = document.getElementById("projectorExamTitle");
        const projectorEntry = document.getElementById("projectorEntryCodeDisplay");
        const projectorPasscode = document.getElementById("projectorPasscodeDisplay");

        if (projectorTitle) projectorTitle.textContent = title;
        if (projectorEntry) projectorEntry.textContent = entryCode;
        if (projectorPasscode) projectorPasscode.textContent = adminPasscode;
        if (projectorContainer) {
          generateQrCode(projectorContainer, fullExamUrl, 320);
        }
        if (projectorModal) {
          projectorModal.classList.add("active");
        }
      };
    }

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

    const closeProjectorBtn = document.getElementById("closeProjectorBtn");
    if (closeProjectorBtn && projectorModal) {
      closeProjectorBtn.onclick = () => projectorModal.classList.remove("active");
      projectorModal.onclick = (e) => {
        if (e.target === projectorModal) projectorModal.classList.remove("active");
      };
    }

    if (resultBox) {
      resultBox.classList.add("active");
      resultBox.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    // บันทึกลง Storage
    // ดึงชื่อผู้สร้างจากโปรไฟล์ที่เข้าสู่ระบบอยู่
    const authUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
    const creatorUsername = authUser ? (authUser.username || "") : "";
    const creatorId = authUser ? (authUser.userId || "") : "";
    const creatorName = authUser ? (authUser.displayName || authUser.username || "ครูผู้สอน") : "ครูผู้สอน";

    const newRoomRecord = {
      roomId: roomId,
      title: title,
      category: category,
      gradeLevel: gradeLevel,
      formUrl: cleanFormUrl,
      examUrl: fullExamUrl,
      entryCode: entryCode,
      adminPasscode: adminPasscode,
      status: status,
      creatorUsername: creatorUsername,
      creatorId: creatorId,
      createdBy: creatorName,
      createdAt: new Date().toLocaleString("th-TH")
    };
    history.unshift(newRoomRecord);
    setStoredRooms(history);
    syncRoomToCloud("createRoom", newRoomRecord);

    // สุ่มรหัสใหม่เตรียมไว้สำหรับห้องถัดไป
    setTimeout(() => {
      const eInput = document.getElementById("examEntryCodeInput");
      const pInput = document.getElementById("examPasscodeInput");
      if (eInput) eInput.value = generateEntryCode();
      if (pInput) pInput.value = generateRandomPasscode();
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

document.addEventListener("DOMContentLoaded", () => {
  if (typeof requireAuth === "function" && !requireAuth()) return;

  setupMobileNavigation();
  applyRoleUI();
  populateCreatorDropdowns();

  const webhookInput = document.getElementById("examWebhookInput");
  if (webhookInput && !webhookInput.value) {
    webhookInput.value = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  }

  const entryInput = document.getElementById("examEntryCodeInput");
  if (entryInput) entryInput.value = generateEntryCode();

  const passInput = document.getElementById("examPasscodeInput");
  if (passInput) passInput.value = generateRandomPasscode();

  const randomEntryBtn = document.getElementById("randomEntryCodeBtn");
  if (randomEntryBtn) {
    randomEntryBtn.addEventListener("click", () => {
      if (entryInput) {
        entryInput.value = generateEntryCode();
        entryInput.focus();
      }
    });
  }

  const randomPassBtn = document.getElementById("randomPasscodeBtn");
  if (randomPassBtn) {
    randomPassBtn.addEventListener("click", () => {
      if (passInput) {
        passInput.value = generateRandomPasscode();
        passInput.focus();
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
});
