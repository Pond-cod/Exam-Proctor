/**
 * Authentication and Role Guard Engine for Exam Proctor Studio
 * Version: v5.5
 * Handles User Login, Session State, Role Verification, and Route Protection
 */

const AUTH_USER_KEY = "examProctorAuthUser";
const DEFAULT_TEACHER_PASSCODE = "111222";

function getCurrentUser() {
  try {
    const raw = sessionStorage.getItem(AUTH_USER_KEY) || localStorage.getItem(AUTH_USER_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function setCurrentUser(user, persist = true) {
  try {
    const data = JSON.stringify(user);
    sessionStorage.setItem(AUTH_USER_KEY, data);
    if (persist) {
      localStorage.setItem(AUTH_USER_KEY, data);
    }
    // ซิงก์ role เข้ากับ examProctorRole เดิม
    localStorage.setItem("examProctorRole", user.role);
  } catch (_) {}
}

function clearCurrentUser() {
  try {
    sessionStorage.removeItem(AUTH_USER_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
    localStorage.setItem("examProctorRole", USER_ROLES.USER);
  } catch (_) {}
}

function isLoggedIn() {
  const user = getCurrentUser();
  return !!(user && user.userId && user.role);
}

function isCurrentUserAdmin() {
  const user = getCurrentUser();
  return user && user.role === USER_ROLES.ADMIN;
}

/**
 * Route Guard: ป้องกันไม่ให้บุคคลภายนอกหรือผู้ที่ยังไม่ล็อกอินเข้าถึงหน้าหลังบ้าน
 * @param {string} requiredRole - "ADMIN" หรือ null สำหรับผู้ใช้ที่ล็อกอินแล้วทุกคน
 */
function requireAuth(requiredRole = null) {
  const user = getCurrentUser();

  // 1. ยังไม่ได้เข้าสู่ระบบ
  if (!user || !user.role) {
    const currentPage = encodeURIComponent(window.location.pathname.split("/").pop() || "rooms.html");
    window.location.replace(`login.html?redirect=${currentPage}`);
    return false;
  }

  // 2. ต้องการสิทธิ์ Admin เท่านั้นแต่ผู้ใช้เป็น Teacher
  if (requiredRole === USER_ROLES.ADMIN && user.role !== USER_ROLES.ADMIN) {
    showAlert("คุณไม่มีสิทธิ์เข้าถึงหน้านี้ (เฉพาะผู้ดูแลระบบ Admin เท่านั้น)", {
      type: "warning",
      confirmText: "กลับสู่หน้ารายการห้องสอบ"
    }).then(() => {
      window.location.replace("rooms.html");
    });
    return false;
  }

  return true;
}

/**
 * ออกจากระบบหลังบ้าน
 */
async function handleLogout() {
  const confirmed = await showConfirm("คุณต้องการออกจากระบบหลังบ้านใช่หรือไม่?", {
    title: "ยืนยันการออกจากระบบ 🚪",
    confirmText: "ออกจากระบบ",
    cancelText: "ยกเลิก"
  });

  if (confirmed) {
    clearCurrentUser();
    window.location.replace("index.html");
  }
}

/**
 * ตรวจสอบรหัสผ่านกับระบบคลาวด์และ Fallback ในตัว
 * @param {Object} credentials - { username, passcode, role }
 */
async function authenticateUser(credentials) {
  const { username, passcode, role } = credentials;
  const webhookUrl = DEFAULT_WEBHOOK_URL;

  // 1. พยายามตรวจสอบกับ Google Apps Script Webhook ก่อน
  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "verifyLogin",
          username: username || "",
          passcode: passcode || "",
          role: role || ""
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result && result.status === "success" && result.user) {
          return { success: true, user: result.user };
        } else if (result && result.status === "error") {
          return { success: false, message: result.message || "รหัสผ่านไม่ถูกต้อง" };
        }
      }
    } catch (netErr) {
      console.warn("Cloud auth check offline, using local verification fallback:", netErr);
    }
  }

  // 2. Fallback ตรวจสอบกับ Local Passcode มาตรฐาน
  const cleanPass = String(passcode || "").trim();
  const cleanUser = String(username || "").trim().toLowerCase();

  // ตรวจสอบสิทธิ์ Master Admin
  if (cleanPass === MASTER_ADMIN_PASSCODE || (cleanUser === "admin" && cleanPass === MASTER_ADMIN_PASSCODE)) {
    return {
      success: true,
      user: {
        userId: "USR-ADMIN",
        username: "admin",
        displayName: "ผู้ดูแลระบบหลัก (Master Admin)",
        role: USER_ROLES.ADMIN
      }
    };
  }

  // ตรวจสอบสิทธิ์ Teacher / ครูผู้สอน
  if (cleanPass === DEFAULT_TEACHER_PASSCODE || (cleanUser === "teacher" && cleanPass === DEFAULT_TEACHER_PASSCODE)) {
    return {
      success: true,
      user: {
        userId: "USR-TEACHER",
        username: "teacher",
        displayName: "ครูผู้สอน / ผู้คุมสอบ",
        role: USER_ROLES.USER
      }
    };
  }

  // ตรวจสอบกับผู้ใช้งานที่บันทึกไว้ใน localStorage
  try {
    const localUsers = JSON.parse(localStorage.getItem("examProctorUsersList") || "[]");
    const matched = localUsers.find(u => {
      const uMatch = cleanUser && u.username && u.username.toLowerCase() === cleanUser;
      const pMatch = String(u.passcode).trim() === cleanPass;
      return (uMatch && pMatch) || (!cleanUser && pMatch && u.role === role);
    });

    if (matched) {
      if (matched.status === "INACTIVE") {
        return { success: false, message: "บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ" };
      }
      return { success: true, user: matched };
    }
  } catch (_) {}

  return {
    success: false,
    message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบใหม่อีกครั้ง"
  };
}
