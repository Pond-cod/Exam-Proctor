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
    localStorage.setItem("examProctorRole", USER_ROLES.TEACHER);
  } catch (_) {}
}

function isLoggedIn() {
  const user = getCurrentUser();
  return !!(user && user.userId && user.role);
}

function isCurrentUserAdmin() {
  const user = getCurrentUser();
  return !!(user && String(user.role).toUpperCase() === USER_ROLES.ADMIN);
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

  // 2. ต้องการสิทธิ์เฉพาะ (เช่น Admin) แต่ผู้ใช้ไม่มีสิทธิ์ที่กำหนด
  if (requiredRole && String(user.role).toUpperCase() !== String(requiredRole).toUpperCase()) {
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
 * ตรวจสอบชื่อผู้ใช้และรหัสผ่าน (Username + Password อย่างน้อย 8 ตัวอักษร)
 * @param {Object} credentials - { username, passcode }
 */
async function authenticateUser(credentials) {
  const username = String(credentials.username || "").trim().toLowerCase();
  const passcode = String(credentials.passcode || "").trim();

  // 1. ตรวจสอบข้อมูลเบื้องต้น
  if (!username) {
    return { success: false, message: "กรุณาระบุชื่อผู้ใช้ (Username)" };
  }
  if (!passcode) {
    return { success: false, message: "กรุณาระบุรหัสผ่าน (Password)" };
  }
  if (passcode.length < 8) {
    return { success: false, message: "รหัสผ่านต้องมีความยาวอย่างน้อย 8 ตัวอักษร/หลัก" };
  }

  const webhookUrl = typeof getEffectiveWebhookUrl === "function" 
    ? getEffectiveWebhookUrl() 
    : (localStorage.getItem("examCustomWebhookUrl") || DEFAULT_WEBHOOK_URL);

  // 2. พยายามตรวจสอบกับ Google Apps Script Webhook ก่อน
  if (webhookUrl) {
    try {
      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({
          action: "verifyLogin",
          username: username,
          passcode: passcode
        })
      });

      if (response.ok) {
        const result = await response.json();
        if (result && result.status === "success" && result.user) {
          const cloudUser = {
            ...result.user,
            role: String(result.user.role).toUpperCase() === "ADMIN" ? USER_ROLES.ADMIN : USER_ROLES.TEACHER
          };
          return { success: true, user: cloudUser };
        } else if (result && result.status === "error") {
          return { success: false, message: result.message || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
        }
      }
    } catch (netErr) {
      console.warn("Cloud auth POST failed, trying GET fallback:", netErr);
      try {
        const getUrl = new URL(webhookUrl);
        getUrl.searchParams.set("action", "verifyLogin");
        getUrl.searchParams.set("username", username);
        getUrl.searchParams.set("passcode", passcode);
        const getRes = await fetch(getUrl.toString());
        if (getRes.ok) {
          const getResult = await getRes.json();
          if (getResult && getResult.status === "success" && getResult.user) {
            const cloudUser = {
              ...getResult.user,
              role: String(getResult.user.role).toUpperCase() === "ADMIN" ? USER_ROLES.ADMIN : USER_ROLES.TEACHER
            };
            return { success: true, user: cloudUser };
          } else if (getResult && getResult.status === "error") {
            return { success: false, message: getResult.message || "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" };
          }
        }
      } catch (getErr) {
        console.warn("Cloud auth GET fallback offline, using local verification fallback:", getErr);
      }
    }
  }

  // 3. Fallback ตรวจสอบกับข้อมูลผู้ใช้งานในระบบ (Strict User Database)
  try {
    const users = typeof getStoredUsers === "function" 
      ? getStoredUsers() 
      : JSON.parse(localStorage.getItem("examProctorUsersList") || "[]");

    const matched = users.find(u => {
      const uMatch = u.username && u.username.toLowerCase() === username;
      const pMatch = String(u.passcode).trim() === passcode;
      return uMatch && pMatch;
    });

    if (matched) {
      if (String(matched.status).toUpperCase() === "INACTIVE") {
        return { success: false, message: "บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ" };
      }

      // อัปเดตเวลาเข้าสู่ระบบล่าสุด (Last Login)
      try {
        matched.lastLogin = new Date().toISOString();
        if (typeof setStoredUsers === "function") {
          setStoredUsers(users);
        } else {
          localStorage.setItem("examProctorUsersList", JSON.stringify(users));
        }
      } catch (_) {}

      return { 
        success: true, 
        user: {
          ...matched,
          role: String(matched.role).toUpperCase() === "ADMIN" ? USER_ROLES.ADMIN : USER_ROLES.TEACHER
        } 
      };
    }
  } catch (_) {}

  return {
    success: false,
    message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบใหม่อีกครั้ง"
  };
}

/**
 * ตรวจสอบว่าห้องสอบนี้ถูกสร้างโดยผู้ใช้งานที่ระบุ หรือผู้ใช้งานมีสิทธิ์เข้าถึงหรือไม่
 * Admin มีสิทธิ์เข้าถึงทุกห้องเสมอ ส่วน Teacher มีสิทธิ์เฉพาะห้องที่ตนเองสร้าง
 */
function isRoomOwnedByUser(room, user) {
  if (!user || !room) return false;
  if (user.role && String(user.role).toUpperCase() === USER_ROLES.ADMIN) return true;

  const curUser = String(user.username || "").trim().toLowerCase();
  const curName = String(user.displayName || "").trim().toLowerCase();
  const curId = String(user.userId || "").trim();

  // 1. ตรวจสอบ creatorUsername
  if (room.creatorUsername && String(room.creatorUsername).trim().toLowerCase() === curUser) {
    return true;
  }
  // 2. ตรวจสอบ creatorId
  if (room.creatorId && curId && String(room.creatorId).trim() === curId) {
    return true;
  }
  // 3. ตรวจสอบ createdBy
  if (room.createdBy) {
    const cb = String(room.createdBy).trim().toLowerCase();
    if (cb === curUser || cb === curName || cb.includes(curUser) || cb.includes(curName)) {
      return true;
    }
  }
  // 4. กรณีห้องเก่าที่ไม่มีผู้สร้างระบุชัดเจน หากเป็น teacher พื้นฐานให้เข้าถึงได้
  if (!room.creatorUsername && (!room.createdBy || room.createdBy === "User" || room.createdBy === "ครูผู้สอน") && curUser === "teacher") {
    return true;
  }
  return false;
}

