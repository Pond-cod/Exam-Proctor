/**
 * System Settings Engine (for settings.html)
 * Version: v5.5
 * Handles system configuration, announcement, and global passcodes (Admin Only)
 */

async function loadSystemSettings() {
  const nameInput = document.getElementById("settingSystemNameInput");
  const annInput = document.getElementById("settingAnnouncementInput");
  const adminPassInput = document.getElementById("settingAdminPasscodeInput");
  const teacherPassInput = document.getElementById("settingTeacherPasscodeInput");
  const webhookInput = document.getElementById("settingWebhookUrlInput");

  // โหลดค่าเริ่มต้นจาก Local / Config
  if (nameInput) nameInput.value = localStorage.getItem("examSystemName") || "Exam Proctor Studio";
  if (annInput) annInput.value = localStorage.getItem("examPortalAnnouncement") || "ยินดีต้อนรับสู่นักเรียนทุกคน ขอให้ทำข้อสอบด้วยความตั้งใจและความซื่อสัตย์";
  if (adminPassInput) adminPassInput.value = localStorage.getItem("examMasterPasscode") || MASTER_ADMIN_PASSCODE;
  if (teacherPassInput) teacherPassInput.value = localStorage.getItem("examTeacherPasscode") || DEFAULT_TEACHER_PASSCODE;
  if (webhookInput) webhookInput.value = localStorage.getItem("examCustomWebhookUrl") || DEFAULT_WEBHOOK_URL;

  // ดึงค่าจาก Cloud (SystemConfig)
  try {
    const webhookUrl = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
    const url = new URL(webhookUrl);
    url.searchParams.set("action", "getSystemConfig");
    const res = await fetch(url.toString());
    if (res.ok) {
      const json = await res.json();
      if (json && json.status === "success" && json.data) {
        const d = json.data;
        if (d.systemName && nameInput) nameInput.value = d.systemName;
        if (d.portalAnnouncement !== undefined && annInput) annInput.value = d.portalAnnouncement;
        if (d.masterAdminPasscode && adminPassInput) adminPassInput.value = d.masterAdminPasscode;
        if (d.teacherPasscode && teacherPassInput) teacherPassInput.value = d.teacherPasscode;

        // Cache local
        localStorage.setItem("examSystemName", d.systemName || "Exam Proctor Studio");
        localStorage.setItem("examPortalAnnouncement", d.portalAnnouncement || "");
        localStorage.setItem("examMasterPasscode", d.masterAdminPasscode || MASTER_ADMIN_PASSCODE);
        localStorage.setItem("examTeacherPasscode", d.teacherPasscode || DEFAULT_TEACHER_PASSCODE);
      }
    }
  } catch (err) {
    console.warn("Load cloud config failed, using local fallback:", err);
  }
}

async function handleSaveSettings() {
  const nameInput = document.getElementById("settingSystemNameInput");
  const annInput = document.getElementById("settingAnnouncementInput");
  const adminPassInput = document.getElementById("settingAdminPasscodeInput");
  const teacherPassInput = document.getElementById("settingTeacherPasscodeInput");
  const webhookInput = document.getElementById("settingWebhookUrlInput");
  const saveBtn = document.getElementById("saveSettingsBtn");

  const systemName = (nameInput ? nameInput.value : "").trim() || "Exam Proctor Studio";
  const portalAnnouncement = (annInput ? annInput.value : "").trim();
  const masterAdminPasscode = (adminPassInput ? adminPassInput.value : "").trim() || MASTER_ADMIN_PASSCODE;
  const teacherPasscode = (teacherPassInput ? teacherPassInput.value : "").trim() || DEFAULT_TEACHER_PASSCODE;
  const webhookUrl = (webhookInput ? webhookInput.value : "").trim() || DEFAULT_WEBHOOK_URL;

  if (masterAdminPasscode.length < 6) {
    showAlert("รหัส Master Admin Passcode ต้องมีความยาวอย่างน้อย 6 หลัก", { type: "warning" });
    if (adminPassInput) adminPassInput.focus();
    return;
  }

  const origBtnText = saveBtn ? saveBtn.innerHTML : "";
  if (saveBtn) {
    saveBtn.disabled = true;
    saveBtn.innerHTML = `<span class="btn-spinner"></span> กำลังบันทึกการตั้งค่า...`;
  }

  // Cache ใน localStorage
  localStorage.setItem("examSystemName", systemName);
  localStorage.setItem("examPortalAnnouncement", portalAnnouncement);
  localStorage.setItem("examMasterPasscode", masterAdminPasscode);
  localStorage.setItem("examTeacherPasscode", teacherPasscode);
  localStorage.setItem("examCustomWebhookUrl", webhookUrl);

  try {
    const payload = {
      action: "updateSystemConfig",
      systemName,
      portalAnnouncement,
      masterAdminPasscode,
      teacherPasscode
    };

    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showAlert("บันทึกการตั้งค่าระบบลงใน Google Sheets เรียบร้อยแล้ว", { type: "success" });
    } else {
      showAlert("บันทึกการตั้งค่าในเครื่องเรียบร้อยแล้ว (การเชื่อมต่อคลาวด์อาจล่าช้า)", { type: "info" });
    }
  } catch (err) {
    showAlert("บันทึกการตั้งค่าในเครื่องเรียบร้อยแล้ว (โหมดออฟไลน์)", { type: "info" });
  } finally {
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.innerHTML = origBtnText;
    }
  }
}

async function handleTestWebhook() {
  const webhookInput = document.getElementById("settingWebhookUrlInput");
  const testBtn = document.getElementById("testWebhookBtn");
  const statusEl = document.getElementById("webhookTestStatus");
  const webhookUrl = (webhookInput ? webhookInput.value : "").trim() || DEFAULT_WEBHOOK_URL;

  if (!webhookUrl) {
    showAlert("กรุณาระบุ Webhook URL ก่อนทดสอบ", { type: "warning" });
    return;
  }

  if (testBtn) {
    testBtn.disabled = true;
    testBtn.innerHTML = `<span class="btn-spinner"></span> กำลังทดสอบ...`;
  }
  if (statusEl) {
    statusEl.textContent = "กำลังส่งสัญญาณ Ping ไปยัง Google Apps Script...";
    statusEl.style.display = "block";
    statusEl.style.color = "var(--text-muted)";
  }

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({
        action: "logEvent",
        studentId: "TEST-PING",
        violation: "ทดสอบการเชื่อมต่อ Webhook จากหน้าตั้งค่าระบบ",
        isSeverityHigh: false,
        timestamp: new Date().toISOString()
      })
    });

    if (res.ok) {
      if (statusEl) {
        statusEl.innerHTML = "🟢 การเชื่อมต่อสมบูรณ์: Google Apps Script ตอบสนองปกติ";
        statusEl.style.color = "#059669";
      }
      showAlert("การเชื่อมต่อ Webhook สำเร็จ! ระบบสามารถบันทึกข้อมูลลง Google Sheets ได้ตามปกติ", { type: "success" });
    } else {
      if (statusEl) {
        statusEl.innerHTML = `⚠️ ได้รับสถานะ HTTP ${res.status}`;
        statusEl.style.color = "#d97706";
      }
    }
  } catch (err) {
    if (statusEl) {
      statusEl.innerHTML = "🔴 การเชื่อมต่อขัดข้อง: ไม่สามารถส่งข้อมูลไปยัง Webhook URL ได้";
      statusEl.style.color = "#dc2626";
    }
  } finally {
    if (testBtn) {
      testBtn.disabled = false;
      testBtn.innerHTML = "🔌 ทดสอบ Webhook";
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // บังคับสิทธิ์ Admin เท่านั้น (Auth Guard)
  if (typeof requireAuth === "function") {
    if (!requireAuth(USER_ROLES.ADMIN)) return;
  }

  setupMobileNavigation();
  applyRoleUI();
  loadSystemSettings();

  const saveBtn = document.getElementById("saveSettingsBtn");
  if (saveBtn) saveBtn.addEventListener("click", handleSaveSettings);

  const testBtn = document.getElementById("testWebhookBtn");
  if (testBtn) testBtn.addEventListener("click", handleTestWebhook);

  const openSheetBtn = document.getElementById("openSheetBtn");
  if (openSheetBtn) {
    openSheetBtn.addEventListener("click", () => window.open(DEFAULT_SHEET_URL, "_blank"));
  }
});
