/**
 * Common Engine for Exam Proctor Studio Sub-sites
 * Handles Role Management, Global Room Storage, Navigation, and Cloud Sync
 * Version: v5.5
 */

let allRooms = [];
let allUsers = [];

/* ==========================================================================
   1. Role System Management & Navbar UI
   ========================================================================== */

function applyRoleUI() {
  const user = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const isAdmin = typeof isCurrentUserAdmin === "function" 
    ? isCurrentUserAdmin() 
    : (user ? String(user.role).toUpperCase() === "ADMIN" : String(localStorage.getItem("examProctorRole")).toUpperCase() === "ADMIN");
  const badge = document.getElementById("navRoleBadge");
  const userNameEl = document.getElementById("navUserNameDisplay");
  const logoutBtn = document.getElementById("logoutBtn");

  if (badge) {
    if (isAdmin) {
      badge.textContent = "ผู้ดูแลระบบ (Admin) 🛡️";
      badge.className = "role-badge role-badge-admin";
    } else {
      badge.textContent = "ครูผู้สอน / ผู้คุมสอบ 👨‍🏫";
      badge.className = "role-badge role-badge-user";
    }
  }

  if (userNameEl && user) {
    userNameEl.textContent = user.displayName || user.username || "เจ้าหน้าที่";
  }

  if (logoutBtn && typeof handleLogout === "function") {
    logoutBtn.onclick = handleLogout;
  }

  // ซ่อน/แสดงองค์ประกอบเฉพาะ Admin
  document.querySelectorAll(".admin-only-btn, .admin-only-field, .admin-only-nav-item").forEach((el) => {
    el.style.display = isAdmin ? "" : "none";
  });

  // ถ้าหน้านั้นมีฟังก์ชัน renderRoomHistory ให้เรียกเพื่ออัปเดตปุ่มจัดการตามสิทธิ์
  if (typeof renderRoomHistory === "function") {
    renderRoomHistory();
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
  const defaultWh = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  const webhookUrl = (webhookInput && webhookInput.value ? webhookInput.value : "").trim() || defaultWh;
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
  const defaultWh = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  const webhookUrl = (webhookInput && webhookInput.value ? webhookInput.value : "").trim() || defaultWh;
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

/* ==========================================================================
   4. User Storage & Cloud Synchronization (Users Management)
   ========================================================================== */

function getStoredUsers() {
  try {
    const defaultUsers = [
      {
        userId: "USR-ADMIN",
        username: "admin",
        displayName: "ผู้ดูแลระบบหลัก (Super Admin)",
        role: "ADMIN",
        passcode: "999888",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        userId: "USR-TEACHER",
        username: "teacher",
        displayName: "ครูผู้สอน / ผู้คุมสอบ",
        role: "TEACHER",
        passcode: "111222",
        status: "ACTIVE",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
    const raw = localStorage.getItem("examProctorUsersList");
    if (!raw) {
      localStorage.setItem("examProctorUsersList", JSON.stringify(defaultUsers));
      return defaultUsers;
    }
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

function setStoredUsers(users) {
  try {
    localStorage.setItem("examProctorUsersList", JSON.stringify(users));
  } catch (_) {}
}

function syncUserToCloud(action, userData) {
  const webhookUrl = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const payload = {
    action: action,
    ...userData
  };

  try {
    fetch(webhookUrl, {
      method: "POST",
      mode: "no-cors",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    }).catch((err) => console.warn("Cloud sync user failed:", err));
  } catch (_) {}
}

async function fetchCloudUsers(callback) {
  const webhookUrl = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  if (!webhookUrl) return;

  try {
    const url = new URL(webhookUrl);
    url.searchParams.set("action", "getAllUsers");
    const res = await fetch(url.toString());
    if (!res.ok) return;
    const json = await res.json();
    if (json && json.status === "success" && Array.isArray(json.data) && json.data.length > 0) {
      allUsers = json.data;
      setStoredUsers(allUsers);
      if (typeof callback === "function") {
        callback(allUsers);
      }
    }
  } catch (err) {
    console.warn("fetchCloudUsers error:", err);
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
