/**
 * Admin Studio & Monitor Engine for index.html (Web App)
 * Exam Proctor Studio v5.2
 */

let allLogs = [];
let allRooms = [];
let currentRole = localStorage.getItem("examProctorRole") || USER_ROLES.USER;
let currentEntryRoom = null;
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

/* ==========================================================================
   0. Role System Management (Admin VS User/Teacher)
   ========================================================================== */

function applyRoleUI() {
  const badge = document.getElementById("navRoleBadge");
  const toggleBtn = document.getElementById("toggleRoleBtn");
  const isAdmin = currentRole === USER_ROLES.ADMIN;

  if (badge) {
    if (isAdmin) {
      badge.textContent = "ผู้ดูแลระบบ (Admin) 🛡️";
      badge.className = "role-badge role-badge-admin";
    } else {
      badge.textContent = "ครูผู้สอน / ผู้คุมสอบ";
      badge.className = "role-badge role-badge-user";
    }
  }

  if (toggleBtn) {
    toggleBtn.textContent = isAdmin ? "ออกจาก Admin 🚪" : "เข้าสู่ระบบ Admin 🔑";
    toggleBtn.title = isAdmin ? "คลิกเพื่อสลับกลับเป็นสิทธิ์ครูผู้สอน" : "คลิกเพื่อเข้าสู่ระบบ Admin ด้วยรหัสผ่าน";
  }

  // ควบคุมการแสดงผลของฟิลด์และปุ่มเฉพาะ Admin
  document.querySelectorAll(".admin-only-btn, .admin-only-field").forEach((el) => {
    el.style.display = isAdmin ? "" : "none";
  });

  // อัปเดตปุ่มจัดการในหน้าประวัติห้องสอบ
  renderRoomHistory();
}

function setupRoleAuth() {
  const toggleBtn = document.getElementById("toggleRoleBtn");
  const modal = document.getElementById("adminLoginModal");
  const closeBtn = document.getElementById("closeAdminLoginModalBtn");
  const cancelBtn = document.getElementById("cancelAdminLoginBtn");
  const confirmBtn = document.getElementById("confirmAdminLoginBtn");
  const passInput = document.getElementById("adminLoginPasscodeInput");
  const errBox = document.getElementById("adminLoginError");

  if (toggleBtn) {
    toggleBtn.addEventListener("click", () => {
      if (currentRole === USER_ROLES.ADMIN) {
        // ออกจากสิทธิ์ Admin กลับสู่ User ปกติ
        currentRole = USER_ROLES.USER;
        localStorage.setItem("examProctorRole", currentRole);
        applyRoleUI();
        showAlert("ออกจากสิทธิ์ผู้ดูแลระบบ (Admin) เรียบร้อยแล้ว", {
          type: "info",
          title: "สลับสิทธิ์สำเร็จ",
          confirmText: "ตกลง"
        });
      } else {
        // เปิด Modal กรอกรหัสผ่าน Admin
        if (passInput) passInput.value = "";
        if (errBox) errBox.style.display = "none";
        if (modal) modal.classList.add("active");
        setTimeout(() => { if (passInput) passInput.focus(); }, 100);
      }
    });
  }

  const closeModal = () => {
    if (modal) modal.classList.remove("active");
  };

  if (closeBtn) closeBtn.addEventListener("click", closeModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeModal);

  const doLogin = () => {
    const val = (passInput ? passInput.value : "").trim();
    if (val === MASTER_ADMIN_PASSCODE) {
      currentRole = USER_ROLES.ADMIN;
      localStorage.setItem("examProctorRole", currentRole);
      closeModal();
      applyRoleUI();
      showAlert("ยินดีต้อนรับสู่โหมดผู้ดูแลระบบ (Admin) คุณสามารถจัดการ ลบ แก้ไขห้องสอบ และตั้งค่าระบบได้", {
        type: "success",
        title: "เข้าสู่ระบบ Admin สำเร็จ",
        confirmText: "เข้าใช้งาน"
      });
    } else {
      if (errBox) errBox.style.display = "block";
      if (passInput) {
        passInput.select();
        passInput.focus();
      }
    }
  };

  if (confirmBtn) confirmBtn.addEventListener("click", doLogin);
  if (passInput) {
    passInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") doLogin();
      if (e.key === "Escape") closeModal();
    });
  }
}

/* ==========================================================================
   1. Populate Dropdowns (หมวดหมู่วิชา และ ระดับชั้น)
   ========================================================================== */

function populateDropdowns() {
  const categorySelects = [
    document.getElementById("examCategorySelect"),
    document.getElementById("editRoomCategorySelect")
  ];
  const categoryFilters = [
    document.getElementById("portalCategoryFilter"),
    document.getElementById("historyCategoryFilter")
  ];
  const gradeSelects = [
    document.getElementById("examGradeSelect"),
    document.getElementById("editRoomGradeSelect")
  ];
  const gradeFilter = document.getElementById("historyGradeFilter");

  categorySelects.forEach((sel) => {
    if (!sel) return;
    sel.innerHTML = SUBJECT_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  });

  categoryFilters.forEach((sel) => {
    if (!sel) return;
    sel.innerHTML = `<option value="all">ทุกกลุ่มสาระ / หมวดหมู่</option>` +
      SUBJECT_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  });

  gradeSelects.forEach((sel) => {
    if (!sel) return;
    sel.innerHTML = GRADE_LEVELS.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  });

  if (gradeFilter) {
    gradeFilter.innerHTML = `<option value="all">ทุกระดับชั้น</option>` +
      GRADE_LEVELS.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  }
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

      // หากสลับมาหน้า Portal ให้อัปเดตรายการห้องสอบ
      if (targetId === "portalSection") {
        renderPortalRooms();
      }

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

      // หากสลับมาหน้าประวัติ ให้เรนเดอร์ใหม่
      if (targetId === "historySection") {
        renderRoomHistory();
      }
    });
  });
}

/* ==========================================================================
   2. Sub-site Link Generator & Dual Passcodes
   ========================================================================== */

async function generateExamLink() {
  const title = (document.getElementById("examTitleInput").value || "").trim() || "แบบทดสอบออนไลน์";
  const rawFormUrl = (document.getElementById("examFormUrlInput").value || "").trim();
  const webhookUrl = (document.getElementById("examWebhookInput").value || "").trim() || DEFAULT_WEBHOOK_URL;
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

  // Loading State บนปุ่มสร้างลิงก์
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
      createdAt: new Date().toISOString()
    };

    // เข้ารหัส Base64
    const encodedData = encodeExamConfig(roomConfig);

    // สร้างลิงก์ห้องสอบ Sub-link (ส่งเฉพาะ data เพื่อความกระชับ)
    const baseUrl = new URL("exam.html", window.location.href);
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

    linkDisplay.value = fullExamUrl;
    testOpenBtn.href = fullExamUrl;
    
    // แสดงรหัสผ่าน 2 ระดับในกล่องผลลัพธ์
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

    // สร้าง QR Code แบบ Client-side คมชัด ขนาด 220px
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

    // บันทึกประวัติลง LocalStorage และส่งไปยัง Google Sheets
    saveRoomToHistory(roomConfig, fullExamUrl);

    // สุ่มรหัสใหม่ทั้งสองชุดเตรียมไว้สำหรับรอบถัดไป
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

/* ==========================================================================
   3. Room Storage & CRUD Engine (Relational Local + Cloud)
   ========================================================================== */

function getStoredRooms() {
  try {
    return JSON.parse(localStorage.getItem("examRoomsHistory") || "[]");
  } catch (_) {
    return [];
  }
}

function setStoredRooms(rooms) {
  try {
    localStorage.setItem("examRoomsHistory", JSON.stringify(rooms));
  } catch (_) {}
}

// บันทึกประวัติห้องสอบใหม่ลงทั้ง Local และ Google Sheets
function saveRoomToHistory(roomConfig, fullUrl) {
  try {
    let history = getStoredRooms();
    const newRoom = {
      roomId: roomConfig.roomId || ("RM-" + Math.floor(100000 + Math.random() * 900000)),
      title: roomConfig.title,
      category: roomConfig.category || "ทั่วไป (General)",
      gradeLevel: roomConfig.gradeLevel || "ไม่ระบุ (All / Not Specified)",
      formUrl: roomConfig.formUrl,
      examUrl: fullUrl,
      entryCode: roomConfig.entryCode || generateEntryCode(),
      adminPasscode: roomConfig.adminPasscode || generateRandomPasscode(),
      status: roomConfig.status || "OPEN",
      createdBy: currentRole === USER_ROLES.ADMIN ? "Admin" : "Teacher",
      createdAt: new Date().toLocaleString("th-TH")
    };

    history = history.filter((r) => r.roomId !== newRoom.roomId && r.examUrl !== fullUrl);
    history.unshift(newRoom);
    history = history.slice(0, 50); // เก็บ 50 รายการล่าสุด
    setStoredRooms(history);
    allRooms = history;

    // ส่งคำขอสร้างห้องสอบไปยัง Google Apps Script
    syncRoomToCloud("createRoom", newRoom);

    renderRoomHistory();
    renderPortalRooms();
    updateMonitorRoomFilterDropdown();
  } catch (e) {
    console.error("saveRoomToHistory error:", e);
  }
}

// ซิงค์การสร้าง/แก้ไข/ลบห้องสอบไปยัง Google Apps Script
function syncRoomToCloud(action, roomData) {
  const webhookInput = document.getElementById("examWebhookInput");
  const webhookUrl = (webhookInput && webhookInput.value ? webhookInput.value : "").trim() || DEFAULT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const payload = {
    action: action,
    ...roomData
  };

  try {
    fetch(webhookUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).catch((err) => console.warn("Cloud sync room failed:", err));
  } catch (_) {}
}

// ดึงรายการห้องสอบทั้งหมดจาก Google Sheets มาประสานกับข้อมูลในเครื่อง
async function fetchCloudRooms() {
  const webhookInput = document.getElementById("examWebhookInput");
  const webhookUrl = (webhookInput && webhookInput.value ? webhookInput.value : "").trim() || DEFAULT_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const url = new URL(webhookUrl);
    url.searchParams.set("action", "getAllRooms");
    const res = await fetch(url.toString());
    if (!res.ok) return;
    const json = await res.json();
    if (json && json.status === "success" && Array.isArray(json.data)) {
      const cloudRooms = json.data;
      const localRooms = getStoredRooms();
      const map = new Map();

      // เอาห้องจาก Cloud เป็นฐาน
      cloudRooms.forEach((r) => {
        if (r.roomId) map.set(r.roomId, r);
      });
      // ผสานห้องจาก Local ที่อาจยังซิงค์ไม่เสร็จ
      localRooms.forEach((r) => {
        if (r.roomId && !map.has(r.roomId)) {
          map.set(r.roomId, r);
        }
      });

      allRooms = Array.from(map.values());
      setStoredRooms(allRooms);
      renderRoomHistory();
      renderPortalRooms();
      updateMonitorRoomFilterDropdown();
    }
  } catch (err) {
    console.warn("fetchCloudRooms error:", err);
  }
}

// สลับสถานะเปิด/ปิดห้องสอบ (Toggle Open / Closed) — ทำได้ทั้ง Admin และ Teacher
async function toggleRoomStatus(roomId) {
  let rooms = getStoredRooms();
  const room = rooms.find(r => r.roomId === roomId);
  if (!room) return;

  const newStatus = room.status === "OPEN" ? "CLOSED" : "OPEN";
  room.status = newStatus;
  setStoredRooms(rooms);
  allRooms = rooms;

  syncRoomToCloud("toggleRoomStatus", { roomId, status: newStatus });

  renderRoomHistory();
  renderPortalRooms();

  const msg = newStatus === "OPEN" 
    ? `เปิดรับนักเรียนเข้าสอบวิชา "${room.title}" เรียบร้อยแล้ว` 
    : `ปิดห้องสอบวิชา "${room.title}" ชั่วคราวแล้ว`;
  showAlert(msg, { type: "info", confirmText: "ตกลง" });
}

// ลบห้องสอบ — เฉพาะ Role Admin เท่านั้น
async function deleteRoom(roomId) {
  if (currentRole !== USER_ROLES.ADMIN) {
    showAlert("คุณต้องมีสิทธิ์ผู้ดูแลระบบ (Admin) เท่านั้นจึงจะสามารถลบห้องสอบได้", {
      type: "warning",
      confirmText: "เข้าใจแล้ว"
    });
    return;
  }

  let rooms = getStoredRooms();
  const room = rooms.find(r => r.roomId === roomId);
  if (!room) return;

  const confirmed = await showConfirm(
    `คุณแน่ใจหรือไม่ว่าต้องการลบห้องสอบ "${room.title}" (รหัส: ${roomId})?\n\nการกระทำนี้จะนำห้องสอบออกจากระบบและหน้ารวมข้อสอบทันที`,
    {
      title: "ยืนยันการลบห้องสอบ",
      confirmText: "ลบห้องสอบ",
      cancelText: "ยกเลิก",
      confirmClass: "danger",
      icon: "🗑️"
    }
  );

  if (confirmed) {
    rooms = rooms.filter(r => r.roomId !== roomId);
    setStoredRooms(rooms);
    allRooms = rooms;

    syncRoomToCloud("deleteRoom", { roomId });

    renderRoomHistory();
    renderPortalRooms();
    updateMonitorRoomFilterDropdown();

    showAlert("ลบห้องสอบเรียบร้อยแล้ว", { type: "success", confirmText: "ตกลง" });
  }
}

// เปิด Modal แก้ไขข้อมูลห้องสอบ — เฉพาะ Role Admin
function openEditRoomModal(roomId) {
  if (currentRole !== USER_ROLES.ADMIN) {
    showAlert("คุณต้องมีสิทธิ์ผู้ดูแลระบบ (Admin) เท่านั้นจึงจะสามารถแก้ไขห้องสอบได้", {
      type: "warning",
      confirmText: "เข้าใจแล้ว"
    });
    return;
  }

  const room = allRooms.find(r => r.roomId === roomId) || getStoredRooms().find(r => r.roomId === roomId);
  if (!room) return;

  const modal = document.getElementById("editRoomModal");
  const subEl = document.getElementById("editRoomSubtitle");
  const idInput = document.getElementById("editRoomIdInput");
  const titleInput = document.getElementById("editRoomTitleInput");
  const catSel = document.getElementById("editRoomCategorySelect");
  const gradeSel = document.getElementById("editRoomGradeSelect");
  const formInput = document.getElementById("editRoomFormUrlInput");
  const statusSel = document.getElementById("editRoomStatusSelect");
  const entryInput = document.getElementById("editRoomEntryCodeInput");
  const passInput = document.getElementById("editRoomAdminPasscodeInput");

  if (subEl) subEl.textContent = `รหัสห้อง: ${room.roomId}`;
  if (idInput) idInput.value = room.roomId;
  if (titleInput) titleInput.value = room.title || "";
  if (catSel) catSel.value = room.category || "ทั่วไป (General)";
  if (gradeSel) gradeSel.value = room.gradeLevel || "ไม่ระบุ (All / Not Specified)";
  if (formInput) formInput.value = room.formUrl || "";
  if (statusSel) statusSel.value = room.status || "OPEN";
  if (entryInput) entryInput.value = room.entryCode || "";
  if (passInput) passInput.value = room.adminPasscode || "";

  if (modal) modal.classList.add("active");
}

// บันทึกการแก้ไขห้องสอบ
async function handleSaveEditRoom() {
  const roomId = (document.getElementById("editRoomIdInput").value || "").trim();
  const title = (document.getElementById("editRoomTitleInput").value || "").trim();
  const category = (document.getElementById("editRoomCategorySelect").value || "").trim();
  const gradeLevel = (document.getElementById("editRoomGradeSelect").value || "").trim();
  const formUrl = (document.getElementById("editRoomFormUrlInput").value || "").trim();
  const status = (document.getElementById("editRoomStatusSelect").value || "OPEN").trim();
  const entryCode = (document.getElementById("editRoomEntryCodeInput").value || "").trim();
  const adminPasscode = (document.getElementById("editRoomAdminPasscodeInput").value || "").trim();

  if (!title || !formUrl) {
    showAlert("กรุณากรอกชื่อวิชาและลิงก์ Google Forms ให้ครบถ้วน", { type: "warning" });
    return;
  }

  let rooms = getStoredRooms();
  const idx = rooms.findIndex(r => r.roomId === roomId);
  if (idx === -1) return;

  const cleanForm = formatGoogleFormEmbedUrl(formUrl);
  const updatedRoom = {
    ...rooms[idx],
    title,
    category,
    gradeLevel,
    formUrl: cleanForm,
    status,
    entryCode,
    adminPasscode,
    updatedAt: new Date().toLocaleString("th-TH")
  };

  // สร้างลิงก์ใหม่ด้วย config ที่อัปเดต
  const encoded = encodeExamConfig(updatedRoom);
  const baseUrl = new URL("exam.html", window.location.href);
  baseUrl.searchParams.set("data", encoded);
  updatedRoom.examUrl = baseUrl.toString();

  rooms[idx] = updatedRoom;
  setStoredRooms(rooms);
  allRooms = rooms;

  syncRoomToCloud("updateRoom", updatedRoom);

  const modal = document.getElementById("editRoomModal");
  if (modal) modal.classList.remove("active");

  renderRoomHistory();
  renderPortalRooms();
  updateMonitorRoomFilterDropdown();

  showAlert("บันทึกการแก้ไขข้อมูลห้องสอบเรียบร้อยแล้ว", { type: "success" });
}

/* ==========================================================================
   4. Render Room History & Management (แท็บ จัดการห้องสอบ)
   ========================================================================== */

function renderRoomHistory() {
  const container = document.getElementById("historyRoomsList");
  if (!container) return;

  const searchQuery = (document.getElementById("historySearchInput") ? document.getElementById("historySearchInput").value : "").trim().toLowerCase();
  const categoryFilter = (document.getElementById("historyCategoryFilter") ? document.getElementById("historyCategoryFilter").value : "all") || "all";
  const gradeFilter = (document.getElementById("historyGradeFilter") ? document.getElementById("historyGradeFilter").value : "all") || "all";
  const statusFilter = (document.getElementById("historyStatusFilter") ? document.getElementById("historyStatusFilter").value : "all") || "all";

  const rooms = allRooms.length > 0 ? allRooms : getStoredRooms();

  if (rooms.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 48px 16px; color: var(--text-muted);">
        <div style="font-size: 42px; margin-bottom: 10px;">📋</div>
        <h4 style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">ยังไม่มีข้อมูลห้องสอบ</h4>
        <p style="font-size: 13px;">สร้างห้องสอบแรกของคุณได้ที่แท็บ "➕ สร้างห้องสอบ"</p>
      </div>
    `;
    return;
  }

  const filtered = rooms.filter((r) => {
    if (searchQuery && !String(r.title || "").toLowerCase().includes(searchQuery) && !String(r.roomId || "").toLowerCase().includes(searchQuery)) {
      return false;
    }
    if (categoryFilter !== "all" && r.category !== categoryFilter) {
      return false;
    }
    if (gradeFilter !== "all" && r.gradeLevel !== gradeFilter) {
      return false;
    }
    if (statusFilter !== "all" && r.status !== statusFilter) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
        <p style="font-size: 14px;">ไม่พบห้องสอบที่ตรงกับเงื่อนไขการค้นหา</p>
      </div>
    `;
    return;
  }

  const isAdmin = currentRole === USER_ROLES.ADMIN;

  container.innerHTML = filtered.map((r) => {
    const isOpen = r.status === "OPEN";
    const statusBadge = isOpen
      ? `<span class="badge badge-success" style="font-weight: 700;">🟢 กำลังเปิดสอบ (OPEN)</span>`
      : `<span class="badge badge-neutral" style="font-weight: 700; color: #dc2626; background: #fef2f2; border: 1px solid #fecaca;">🔴 ปิดห้องสอบ (CLOSED)</span>`;

    return `
      <div class="room-mgmt-card" style="background: #ffffff; border: 1.5px solid var(--bg-card-border); border-radius: var(--radius-md); padding: 16px 20px; margin-bottom: 14px; box-shadow: var(--shadow-sm);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px; margin-bottom: 10px;">
          <div style="flex: 1; min-width: 240px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
              <strong style="font-size: 16px; color: var(--text-primary);">${escapeHtml(r.title)}</strong>
              ${statusBadge}
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 4px;">
              <span class="badge badge-neutral" style="font-size: 11.5px;">📁 ${escapeHtml(r.category || "ทั่วไป")}</span>
              <span class="badge badge-neutral" style="font-size: 11.5px;">🎓 ${escapeHtml(r.gradeLevel || "ไม่ระบุ")}</span>
              <span style="font-size: 12px; color: var(--text-muted);">รหัสห้อง: <code>${escapeHtml(r.roomId || "-")}</code></span>
            </div>
          </div>

          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <!-- สลับเปิด/ปิดสถานะสอบ (ทุกคนทำได้) -->
            <button 
              type="button" 
              class="btn ${isOpen ? "btn-secondary" : "btn-success"} btn-toggle-status" 
              data-room-id="${escapeHtml(r.roomId)}" 
              style="min-height: 36px; padding: 6px 12px; font-size: 12.5px;"
              title="${isOpen ? "คลิกเพื่อปิดห้องสอบชั่วคราว" : "คลิกเพื่อเปิดรับนักเรียนเข้าสอบ"}"
            >
              ${isOpen ? "⏸️ พักการสอบ" : "▶️ เปิดรับเข้าสอบ"}
            </button>

            <!-- คัดลอกลิงก์ -->
            <button 
              type="button" 
              class="btn btn-secondary btn-copy-room-link" 
              data-url="${escapeHtml(r.examUrl)}" 
              style="min-height: 36px; padding: 6px 12px; font-size: 12.5px;"
            >
              📋 คัดลอกลิงก์
            </button>

            <!-- แสดง QR Code -->
            <button 
              type="button" 
              class="btn btn-secondary btn-show-room-qr" 
              data-room-id="${escapeHtml(r.roomId)}" 
              style="min-height: 36px; padding: 6px 12px; font-size: 12.5px;"
            >
              🔍 QR Code
            </button>

            <!-- แก้ไข (เฉพาะ Admin) -->
            ${isAdmin ? `
              <button 
                type="button" 
                class="btn btn-secondary btn-edit-room" 
                data-room-id="${escapeHtml(r.roomId)}" 
                style="min-height: 36px; padding: 6px 12px; font-size: 12.5px;"
              >
                ✏️ แก้ไข
              </button>
              <button 
                type="button" 
                class="btn btn-danger btn-delete-room" 
                data-room-id="${escapeHtml(r.roomId)}" 
                style="min-height: 36px; padding: 6px 12px; font-size: 12.5px;"
              >
                🗑️ ลบ
              </button>
            ` : ""}
          </div>
        </div>

        <!-- แถบแสดงรหัส 2 รูปแบบ -->
        <div style="display: flex; gap: 12px; flex-wrap: wrap; background: var(--bg-subtle); padding: 8px 14px; border-radius: var(--radius-sm); align-items: center;">
          <div style="font-size: 12.5px;">
            <span style="color: #1e40af; font-weight: 700;">🎓 รหัสเข้าสอบนักเรียน:</span>
            <code style="font-size: 15px; font-weight: 800; color: #1d4ed8; letter-spacing: 0.1em; margin-left: 4px;">${escapeHtml(r.entryCode || "-")}</code>
          </div>
          <div style="font-size: 12.5px; border-left: 1.5px solid #cbd5e1; padding-left: 12px;">
            <span style="color: #991b1b; font-weight: 700;">🔒 รหัสคุมสอบ (Passcode):</span>
            <code style="font-size: 15px; font-weight: 800; color: #b91c1c; letter-spacing: 0.1em; margin-left: 4px;">${escapeHtml(r.adminPasscode || "-")}</code>
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-left: auto;">
            สร้างเมื่อ: ${escapeHtml(r.createdAt || "-")}
          </div>
        </div>
      </div>
    `;
  }).join("");

  // ผูก Event Listeners สำหรับปุ่มในการ์ดห้องสอบ
  container.querySelectorAll(".btn-copy-room-link").forEach((btn) => {
    btn.onclick = () => {
      const url = btn.getAttribute("data-url");
      if (url) {
        navigator.clipboard.writeText(url).then(() => {
          const orig = btn.textContent;
          btn.textContent = "คัดลอกแล้ว!";
          setTimeout(() => { btn.textContent = orig; }, 2000);
        });
      }
    };
  });

  container.querySelectorAll(".btn-show-room-qr").forEach((btn) => {
    btn.onclick = () => {
      const roomId = btn.getAttribute("data-room-id");
      const room = allRooms.find(r => r.roomId === roomId) || getStoredRooms().find(r => r.roomId === roomId);
      if (!room) return;

      const projectorModal = document.getElementById("qrProjectorModal");
      const projectorContainer = document.getElementById("projectorQrContainer");
      const projectorTitle = document.getElementById("projectorExamTitle");
      const projectorEntry = document.getElementById("projectorEntryCodeDisplay");
      const projectorPasscode = document.getElementById("projectorPasscodeDisplay");

      if (projectorTitle) projectorTitle.textContent = room.title;
      if (projectorEntry) projectorEntry.textContent = room.entryCode || "------";
      if (projectorPasscode) projectorPasscode.textContent = room.adminPasscode || "------";
      if (projectorContainer) {
        generateQrCode(projectorContainer, room.examUrl, 320);
      }
      if (projectorModal) projectorModal.classList.add("active");
    };
  });

  container.querySelectorAll(".btn-toggle-status").forEach((btn) => {
    btn.onclick = () => {
      const roomId = btn.getAttribute("data-room-id");
      if (roomId) toggleRoomStatus(roomId);
    };
  });

  container.querySelectorAll(".btn-edit-room").forEach((btn) => {
    btn.onclick = () => {
      const roomId = btn.getAttribute("data-room-id");
      if (roomId) openEditRoomModal(roomId);
    };
  });

  container.querySelectorAll(".btn-delete-room").forEach((btn) => {
    btn.onclick = () => {
      const roomId = btn.getAttribute("data-room-id");
      if (roomId) deleteRoom(roomId);
    };
  });
}

/* ==========================================================================
   5. Student Exam Portal (หน้ารวมแบบทดสอบออนไลน์ - สำหรับนักเรียน ไม่ต้อง Login)
   ========================================================================== */

function renderPortalRooms() {
  const container = document.getElementById("portalRoomsGrid");
  if (!container) return;

  const searchQuery = (document.getElementById("portalSearchInput") ? document.getElementById("portalSearchInput").value : "").trim().toLowerCase();
  const categoryFilter = (document.getElementById("portalCategoryFilter") ? document.getElementById("portalCategoryFilter").value : "all") || "all";

  const rooms = allRooms.length > 0 ? allRooms : getStoredRooms();
  // หน้ารวมข้อสอบแสดงเฉพาะห้องที่เปิดรับอยู่เท่านั้น (status === "OPEN")
  const activeRooms = rooms.filter(r => r.status === "OPEN");

  if (activeRooms.length === 0) {
    container.innerHTML = `
      <div class="portal-empty-state" style="grid-column: 1 / -1; padding: 48px 16px;">
        <div style="font-size: 48px; margin-bottom: 10px;">🏖️</div>
        <h3 style="font-size: 17px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">ขณะนี้ยังไม่มีห้องสอบที่เปิดรับ</h3>
        <p style="font-size: 13.5px; color: var(--text-muted); max-width: 400px; margin: 0 auto;">
          กรุณารอครูผู้สอนเปิดรับนักเรียนเข้าสอบ หรือสอบถามรหัสเข้าห้องสอบจากครูผู้คุมสอบ
        </p>
      </div>
    `;
    return;
  }

  const filtered = activeRooms.filter((r) => {
    if (searchQuery && !String(r.title || "").toLowerCase().includes(searchQuery) && !String(r.gradeLevel || "").toLowerCase().includes(searchQuery)) {
      return false;
    }
    if (categoryFilter !== "all" && r.category !== categoryFilter) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="portal-empty-state" style="grid-column: 1 / -1; padding: 36px 16px;">
        <p style="font-size: 14px; color: var(--text-muted);">ไม่พบห้องสอบที่ตรงกับคำค้นหาของคุณ</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((r) => `
    <div class="portal-room-card">
      <div class="portal-card-badges">
        <span class="badge badge-primary" style="font-size: 11px;">${escapeHtml(r.category || "ทั่วไป")}</span>
        <span class="badge badge-neutral" style="font-size: 11px;">${escapeHtml(r.gradeLevel || "ทุกระดับชั้น")}</span>
      </div>
      <h3 class="portal-card-title">${escapeHtml(r.title)}</h3>
      <div class="portal-card-meta">
        <span class="live-dot" style="width: 7px; height: 7px; background: #059669; border-radius: 50%; display: inline-block;"></span>
        <span>เปิดรับนักเรียนเข้าสอบ</span>
      </div>
      <button 
        type="button" 
        class="btn btn-primary btn-block portal-enter-btn" 
        data-room-id="${escapeHtml(r.roomId)}"
        style="margin-top: 14px; font-weight: 700;"
      >
        🚀 เข้าสู่ห้องสอบ
      </button>
    </div>
  `).join("");

  // ผูกปุ่มเข้าสู่ห้องสอบ
  container.querySelectorAll(".portal-enter-btn").forEach((btn) => {
    btn.onclick = () => {
      const roomId = btn.getAttribute("data-room-id");
      const room = activeRooms.find(r => r.roomId === roomId);
      if (room) openRoomEntryModal(room);
    };
  });
}

// เปิด Modal ให้นักเรียนกรอกรหัสนักเรียน + รหัสเข้าห้องสอบ 6 หลัก
function openRoomEntryModal(room) {
  currentEntryRoom = room;
  const modal = document.getElementById("roomEntryModal");
  const titleEl = document.getElementById("entryModalRoomTitle");
  const catEl = document.getElementById("entryModalRoomCategory");
  const errEl = document.getElementById("entryErrorMessage");
  const sidInput = document.getElementById("entryStudentIdInput");
  const passInput = document.getElementById("entryPasscodeInput");

  if (titleEl) titleEl.textContent = room.title;
  if (catEl) catEl.textContent = `${room.category || "ทั่วไป"} • ${room.gradeLevel || ""}`;
  if (errEl) errEl.style.display = "none";
  if (sidInput) {
    sidInput.value = "";
  }
  if (passInput) passInput.value = "";

  if (modal) modal.classList.add("active");
  setTimeout(() => { if (sidInput) sidInput.focus(); }, 100);
}

// ตรวจสอบข้อมูลและเริ่มสอบจาก Portal
function handleConfirmRoomEntry() {
  if (!currentEntryRoom) return;

  const sidInput = document.getElementById("entryStudentIdInput");
  const passInput = document.getElementById("entryPasscodeInput");
  const errEl = document.getElementById("entryErrorMessage");

  const studentId = (sidInput ? sidInput.value : "").trim();
  const enteredPass = (passInput ? passInput.value : "").trim();

  if (!studentId || !/^\d+$/.test(studentId)) {
    if (errEl) {
      errEl.textContent = "กรุณากรอกรหัสประจำตัวนักเรียนเป็นตัวเลขเท่านั้น";
      errEl.style.display = "block";
    }
    if (sidInput) sidInput.focus();
    return;
  }

  // ตรวจสอบรหัสเข้าห้องสอบ 6 หลัก
  const expectedPass = String(currentEntryRoom.entryCode || "").trim();
  if (expectedPass && enteredPass !== expectedPass) {
    if (errEl) {
      errEl.textContent = "รหัสเข้าห้องสอบ 6 หลักไม่ถูกต้อง กรุณาตรวจสอบกับครูผู้คุมสอบ";
      errEl.style.display = "block";
    }
    if (passInput) {
      passInput.select();
      passInput.focus();
    }
    return;
  }

  // ข้อมูลถูกต้อง -> ปิด Modal และเปิดหน้า exam.html พร้อมพารามิเตอร์
  const modal = document.getElementById("roomEntryModal");
  if (modal) modal.classList.remove("active");

  const encoded = encodeExamConfig(currentEntryRoom);
  const examUrl = new URL("exam.html", window.location.href);
  examUrl.searchParams.set("data", encoded);
  examUrl.searchParams.set("sid", studentId);
  examUrl.searchParams.set("entry", enteredPass);

  // เปิดหน้าสอบ
  window.open(examUrl.toString(), "_blank");
}

/* ==========================================================================
   6. Live Monitor Room Filtering Dropdown
   ========================================================================== */

function updateMonitorRoomFilterDropdown() {
  const sel = document.getElementById("monitorRoomFilterSelect");
  if (!sel) return;

  const currentVal = sel.value || "all";
  const rooms = allRooms.length > 0 ? allRooms : getStoredRooms();

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

// ลงทะเบียนทันทีที่โหลดสคริปต์
setupLiveBroadcastListener();

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

  const sId = String(payload.studentId).trim();

  // ป้องกันรายการซ้ำใน allLogs
  const exists = allLogs.some((l) => {
    if (String(l.studentId) !== sId) return false;
    if (String(l.violation) !== String(payload.violation)) return false;
    if (l.timestamp && payload.timestamp && l.timestamp === payload.timestamp) return true;
    if (l.timestamp && payload.timestamp) {
      const diff = Math.abs(new Date(l.timestamp).getTime() - new Date(payload.timestamp).getTime());
      if (diff < 500) return true;
    }
    return false;
  });

  if (!exists) {
    allLogs.push(payload);
  }

  recentLocalLiveEvents.push(payload);
  if (recentLocalLiveEvents.length > 50) recentLocalLiveEvents.shift();

  // อัปเดต studentsData ทันที (Instant 0ms UI update)
  if (!studentsData[sId]) {
    studentsData[sId] = {
      studentId: sId,
      logs: [payload],
      violationCount: payload.violationCount || 0,
      isStarted: true,
      isSubmitted: false,
      startTime: payload.time || payload.timestamp,
      submitTime: null,
      lastEventTime: payload.time,
      lastEventIso: payload.timestamp,
      lastEventText: payload.violation || "",
      hasAlert: (payload.violationCount || 0) > 0,
      isTestPing: false,
      isOldDate: false,
      isBeforeCutoff: false
    };
  } else {
    const s = studentsData[sId];
    if (payload.violationCount !== undefined && typeof payload.violationCount === "number" && payload.violationCount > s.violationCount) {
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
  const selectedRoomFilter = (document.getElementById("monitorRoomFilterSelect") ? document.getElementById("monitorRoomFilterSelect").value : "all") || "all";
  const targetRoom = allRooms.find(r => r.roomId === selectedRoomFilter);

  sortedLogs.forEach((item) => {
    if (selectedRoomFilter !== "all") {
      const itemRoomId = item.roomId || "";
      const itemTitle = item.roomTitle || item.formTitle || "";
      const matchesId = itemRoomId && itemRoomId === selectedRoomFilter;
      const matchesTitle = targetRoom && itemTitle && (itemTitle === targetRoom.title || itemTitle.includes(targetRoom.title));
      if (!matchesId && !matchesTitle) {
        return; // ข้าม log ที่ไม่ได้อยู่ในห้องสอบที่เลือก
      }
    }

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

    // หาก item มีระบุ violationCount ตัวเลขล่าสุดมาด้วย ให้อัปเดตเป็นค่าสูงสุด
    if (item.violationCount && typeof item.violationCount === "number" && item.violationCount > s.violationCount) {
      const diff = item.violationCount - s.violationCount;
      s.violationCount = item.violationCount;
      totalViolationsCount += diff;
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
  populateDropdowns();
  setupRoleAuth();
  applyRoleUI();

  // ดึงข้อมูลห้องสอบจากทั้ง Local และ Cloud
  allRooms = getStoredRooms();
  renderPortalRooms();
  renderRoomHistory();
  updateMonitorRoomFilterDropdown();
  fetchCloudRooms();

  const webhookInput = document.getElementById("examWebhookInput");
  if (webhookInput && !webhookInput.value) {
    webhookInput.value = DEFAULT_WEBHOOK_URL;
  }

  // กำหนดรหัส 6 หลักเริ่มต้นทั้งสองชุด
  const entryInput = document.getElementById("examEntryCodeInput");
  if (entryInput) {
    entryInput.value = generateEntryCode();
  }
  const passInput = document.getElementById("examPasscodeInput");
  if (passInput) {
    passInput.value = generateRandomPasscode();
  }

  // ปุ่มสุ่มรหัสเข้าสอบนักเรียนใหม่ 6 หลัก
  const randomEntryBtn = document.getElementById("randomEntryCodeBtn");
  if (randomEntryBtn) {
    randomEntryBtn.addEventListener("click", () => {
      if (entryInput) {
        entryInput.value = generateEntryCode();
        entryInput.focus();
      }
    });
  }

  // ปุ่มสุ่มรหัสผ่านผู้คุมสอบใหม่ 6 หลัก
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

  // --- Student Portal Events ---
  const portalRefreshBtn = document.getElementById("portalRefreshBtn");
  if (portalRefreshBtn) {
    portalRefreshBtn.addEventListener("click", () => {
      fetchCloudRooms();
      showAlert("รีเฟรชรายการห้องสอบเรียบร้อยแล้ว", { type: "info" });
    });
  }

  const portalSearchInput = document.getElementById("portalSearchInput");
  if (portalSearchInput) {
    portalSearchInput.addEventListener("input", renderPortalRooms);
  }

  const portalCategoryFilter = document.getElementById("portalCategoryFilter");
  if (portalCategoryFilter) {
    portalCategoryFilter.addEventListener("change", renderPortalRooms);
  }

  const confirmEntryBtn = document.getElementById("confirmEntryBtn");
  if (confirmEntryBtn) {
    confirmEntryBtn.addEventListener("click", handleConfirmRoomEntry);
  }

  const entryPassInput = document.getElementById("entryPasscodeInput");
  if (entryPassInput) {
    entryPassInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleConfirmRoomEntry();
    });
  }

  const closeEntryBtn = document.getElementById("closeEntryModalBtn");
  const cancelEntryBtn = document.getElementById("cancelEntryModalBtn");
  const roomEntryModal = document.getElementById("roomEntryModal");
  const closeEntryModal = () => {
    if (roomEntryModal) roomEntryModal.classList.remove("active");
  };
  if (closeEntryBtn) closeEntryBtn.addEventListener("click", closeEntryModal);
  if (cancelEntryBtn) cancelEntryBtn.addEventListener("click", closeEntryModal);

  // --- Room Management (History) Events ---
  const historyRefreshBtn = document.getElementById("historyRefreshBtn");
  if (historyRefreshBtn) {
    historyRefreshBtn.addEventListener("click", () => {
      fetchCloudRooms();
      showAlert("รีเฟรชข้อมูลห้องสอบทั้งหมดเรียบร้อยแล้ว", { type: "info" });
    });
  }

  const historySearchInput = document.getElementById("historySearchInput");
  if (historySearchInput) {
    historySearchInput.addEventListener("input", renderRoomHistory);
  }

  const historyCategoryFilter = document.getElementById("historyCategoryFilter");
  if (historyCategoryFilter) {
    historyCategoryFilter.addEventListener("change", renderRoomHistory);
  }

  const historyGradeFilter = document.getElementById("historyGradeFilter");
  if (historyGradeFilter) {
    historyGradeFilter.addEventListener("change", renderRoomHistory);
  }

  const historyStatusFilter = document.getElementById("historyStatusFilter");
  if (historyStatusFilter) {
    historyStatusFilter.addEventListener("change", renderRoomHistory);
  }

  const saveEditRoomBtn = document.getElementById("saveEditRoomBtn");
  if (saveEditRoomBtn) {
    saveEditRoomBtn.addEventListener("click", handleSaveEditRoom);
  }

  const editRoomModal = document.getElementById("editRoomModal");
  const closeEditModal = () => {
    if (editRoomModal) editRoomModal.classList.remove("active");
  };
  const closeEditBtn = document.getElementById("closeEditRoomModalBtn");
  const cancelEditBtn = document.getElementById("cancelEditRoomBtn");
  if (closeEditBtn) closeEditBtn.addEventListener("click", closeEditModal);
  if (cancelEditBtn) cancelEditBtn.addEventListener("click", closeEditModal);

  // --- Monitor Room Filter ---
  const monitorRoomFilter = document.getElementById("monitorRoomFilterSelect");
  if (monitorRoomFilter) {
    monitorRoomFilter.addEventListener("change", () => {
      renderMonitorLogs();
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
      fetchCloudRooms();
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
      closeEntryModal();
      closeEditModal();
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

