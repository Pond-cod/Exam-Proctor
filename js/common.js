/**
 * Common Engine for Exam Proctor Studio Sub-sites
 * Handles Role Management, Global Room Storage, Navigation, and Cloud Sync
 * Version: v5.2
 */

let allRooms = [];
let currentRole = localStorage.getItem("examProctorRole") || USER_ROLES.USER;

/* ==========================================================================
   1. Role System Management (Admin VS User/Teacher)
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

  // ซ่อน/แสดงองค์ประกอบเฉพาะ Admin
  document.querySelectorAll(".admin-only-btn, .admin-only-field").forEach((el) => {
    el.style.display = isAdmin ? "" : "none";
  });

  // ถ้าหน้านั้นมีฟังก์ชัน renderRoomHistory ให้เรียกเพื่ออัปเดตปุ่มจัดการตามสิทธิ์
  if (typeof renderRoomHistory === "function") {
    renderRoomHistory();
  }
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
        currentRole = USER_ROLES.USER;
        localStorage.setItem("examProctorRole", currentRole);
        applyRoleUI();
        showAlert("ออกจากสิทธิ์ผู้ดูแลระบบ (Admin) เรียบร้อยแล้ว", {
          type: "info",
          title: "สลับสิทธิ์สำเร็จ",
          confirmText: "ตกลง"
        });
      } else {
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
   2. Mobile Drawer Navigation
   ========================================================================== */

function setupMobileNavigation() {
  const hamburgerBtn = document.getElementById("navHamburgerBtn");
  const navLinksMenu = document.getElementById("navLinksMenu");
  if (!hamburgerBtn || !navLinksMenu) return;

  hamburgerBtn.addEventListener("click", () => {
    const isOpen = navLinksMenu.classList.toggle("open");
    hamburgerBtn.classList.toggle("active", isOpen);
    hamburgerBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });

  navLinksMenu.querySelectorAll(".nav-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      navLinksMenu.classList.remove("open");
      hamburgerBtn.classList.remove("active");
      hamburgerBtn.setAttribute("aria-expanded", "false");
    });
  });
}

/* ==========================================================================
   3. Global Room Storage & Cloud Synchronization
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

async function fetchCloudRooms(callback) {
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

      cloudRooms.forEach((r) => {
        if (r.roomId) map.set(r.roomId, r);
      });
      localRooms.forEach((r) => {
        if (r.roomId && !map.has(r.roomId)) {
          map.set(r.roomId, r);
        }
      });

      allRooms = Array.from(map.values());
      setStoredRooms(allRooms);

      if (typeof callback === "function") {
        callback(allRooms);
      }
    }
  } catch (err) {
    console.warn("fetchCloudRooms error:", err);
  }
}

// Global modal dismiss on ESC key
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    document.querySelectorAll(".modal-overlay.active, .custom-dialog-overlay.active").forEach((m) => {
      m.classList.remove("active");
    });
  }
});
