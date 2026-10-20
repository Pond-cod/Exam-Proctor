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

async function syncRoomToCloud(action, roomData) {
  const webhookInput = document.getElementById("examWebhookInput");
  const defaultWh = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  const webhookUrl = (webhookInput && webhookInput.value ? webhookInput.value : "").trim() || defaultWh;
  if (!webhookUrl) return null;

  const payload = {
    action: action,
    ...roomData
  };

  const authHeaders = typeof getAuthHeaders === "function" ? getAuthHeaders() : {};

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      console.warn(`Cloud sync room '${action}' returned status ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.warn("Cloud sync room failed:", err);
    return null;
  }
}

async function fetchCloudRooms(callback, forceActiveOnly = false) {
  const webhookInput = document.getElementById("examWebhookInput");
  const defaultWh = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  const webhookUrl = (webhookInput && webhookInput.value ? webhookInput.value : "").trim() || defaultWh;
  if (!webhookUrl) return;

  const authHeaders = typeof getAuthHeaders === "function" ? getAuthHeaders() : {};
  const hasAuth = Object.keys(authHeaders).length > 0;
  // หากเป็นหน้าบ้านนักเรียน หรือยังไม่ได้ล็อกอิน ให้ใช้ getActiveRooms (Public 200 OK)
  // หากล็อกอินเป็นครู/แอดมินหลังบ้าน ให้ใช้ getAllRooms พร้อม Token สิทธิ์การจัดการ
  const action = (forceActiveOnly || !hasAuth) ? "getActiveRooms" : "getAllRooms";

  try {
    const url = new URL(webhookUrl);
    url.searchParams.set("action", action);
    const fetchFn = typeof fetchWithTimeout === "function" ? fetchWithTimeout : fetch;
    const res = await fetchFn(url.toString(), {
      headers: { ...authHeaders }
    }, 5000);
    if (!res || !res.ok) return;
    const json = await res.json();
    if (json && json.status === "success" && Array.isArray(json.data)) {
      const cloudRooms = json.data;
      const localRooms = getStoredRooms();
      const localMap = new Map();
      localRooms.forEach((lr) => {
        if (lr.roomId) localMap.set(lr.roomId, lr);
      });

      const map = new Map();

      cloudRooms.forEach((r) => {
        if (r.roomId) {
          const loc = localMap.get(r.roomId);
          if (loc) {
            r.creatorUsername = r.creatorUsername || loc.creatorUsername || "";
            r.creatorId = r.creatorId || loc.creatorId || "";
            r.createdBy = r.createdBy || loc.createdBy || "";
          }
          if (!r.creatorUsername && r.createdBy) {
            const m = String(r.createdBy).match(/\(@([a-zA-Z0-9_\-\.]+)\)/);
            if (m) r.creatorUsername = m[1];
          }
          map.set(r.roomId, r);
        }
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
    const raw = localStorage.getItem("examProctorUsersList");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

function setStoredUsers(users) {
  try {
    localStorage.setItem("examProctorUsersList", JSON.stringify(users));
  } catch (_) {}
}

async function syncUserToCloud(action, userData) {
  const webhookUrl = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  if (!webhookUrl) return null;

  const payload = {
    action: action,
    ...userData
  };

  const authHeaders = typeof getAuthHeaders === "function" ? getAuthHeaders() : {};

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders
      },
      body: JSON.stringify(payload)
    });
    return await res.json();
  } catch (err) {
    console.warn("Cloud sync user failed:", err);
    return null;
  }
}

async function fetchCloudUsers(callback) {
  const webhookUrl = typeof getEffectiveWebhookUrl === "function" ? getEffectiveWebhookUrl() : DEFAULT_WEBHOOK_URL;
  if (!webhookUrl) return;

  const authHeaders = typeof getAuthHeaders === "function" ? getAuthHeaders() : {};

  try {
    const url = new URL(webhookUrl);
    url.searchParams.set("action", "getAllUsers");
    const fetchFn = typeof fetchWithTimeout === "function" ? fetchWithTimeout : fetch;
    const res = await fetchFn(url.toString(), {
      headers: { ...authHeaders }
    }, 5000);
    if (!res || !res.ok) return;
    const json = await res.json();
    if (json && json.status === "success" && Array.isArray(json.data)) {
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

/* ==========================================================================
   4. Theme Management (Dark / Light Mode)
   ========================================================================== */

function getCurrentTheme() {
  return localStorage.getItem("examProctorTheme") || 
    (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
}

function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === "dark") {
    root.setAttribute("data-theme", "dark");
  } else {
    root.removeAttribute("data-theme");
  }
  localStorage.setItem("examProctorTheme", theme);

  // Update theme toggle buttons across the UI
  document.querySelectorAll(".theme-toggle-btn").forEach((btn) => {
    btn.innerHTML = theme === "dark" 
      ? '<span class="icon">☀️</span> <span class="theme-text">โหมดสว่าง</span>' 
      : '<span class="icon">🌙</span> <span class="theme-text">โหมดมืด</span>';
    btn.setAttribute("aria-label", theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode");
  });
}

function toggleTheme() {
  const current = getCurrentTheme();
  const next = current === "dark" ? "light" : "dark";
  applyTheme(next);
}

// Auto-initialize theme as early as possible
applyTheme(getCurrentTheme());

document.addEventListener("DOMContentLoaded", () => {
  // Bind all theme toggles
  document.querySelectorAll(".theme-toggle-btn").forEach((btn) => {
    btn.addEventListener("click", toggleTheme);
  });

  // Reset any leftover language key to ensure Thai only
  try {
    localStorage.removeItem("app_lang");
  } catch (_) {}

  // Register PWA Service Worker for offline capability & fast loading
  if ("serviceWorker" in navigator && window.location.protocol.startsWith("http")) {
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.debug("PWA ServiceWorker not registered:", err.message);
    });
  }
});

