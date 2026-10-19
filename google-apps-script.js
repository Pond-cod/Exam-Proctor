/**
 * ===================================================================
 * Google Apps Script: ระบบบริหารจัดการห้องสอบและคุมสอบออนไลน์ (v5.5)
 * Exam Proctor Studio Database & Webhook Engine
 * ===================================================================
 * 
 * ฐานข้อมูลแบบ 4 ตาราง (Relational Multi-Sheet):
 * 1. Users       : จัดเก็บบัญชีผู้ใช้งานระบบ (Admin / Teacher), รหัสผ่าน Passcode, สถานะ
 * 2. SystemConfig: จัดเก็บการตั้งค่าระบบกลาง, Master Admin Passcode, ข้อความประกาศ
 * 3. ExamRooms   : จัดเก็บข้อมูลห้องสอบ, สถานะเปิด/ปิด, หมวดหมู่, ระดับชั้น, รหัสเข้าสอบนักเรียน
 * 4. ExamLogs    : จัดเก็บบันทึกประวัติการสอบและการแจ้งเตือนเหตุการณ์ผิดปกติ (เชื่อมโยงด้วย room_id)
 */

const SHEET_ID = "1aDO0taJC_7itVhA4Ft0Pp01muyXPEcNhYtiqdwRvQGU";
const SHEET_USERS = "Users";
const SHEET_CONFIG = "SystemConfig";
const SHEET_ROOMS = "ExamRooms";
const SHEET_LOGS = "ExamLogs";

// ฟังก์ชันเปิด Spreadsheet ที่รองรับทั้งแบบ Bound Script และ Standalone Script
function getSpreadsheet() {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (err) {}
  return SpreadsheetApp.openById(SHEET_ID);
}

// Helper สร้างชีตและหัวตารางอัตโนมัติหากยังไม่มี
function getOrCreateSheet(ss, sheetName, headers, headerColor) {
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setBackground(headerColor || "#1a73e8")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/* ===================================================================
 * 1. Sheet Initializers & Schemas
 * =================================================================== */

// 1.1 ตาราง Users (สำหรับระบบจัดการผู้ใช้งาน Role Admin / Teacher)
function getUsersSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEET_USERS, [
    "user_id", "username", "display_name", "role", "passcode", 
    "status", "created_at", "updated_at", "last_login"
  ], "#7c3aed");

  // Auto-seed บัญชีเริ่มต้นถ้าชีตว่าง
  if (sheet.getLastRow() <= 1) {
    const nowIso = new Date().toISOString();
    sheet.appendRow([
      "USR-ADMIN", "admin", "ผู้ดูแลระบบหลัก (Super Admin)", "ADMIN", "999888", 
      "ACTIVE", nowIso, nowIso, ""
    ]);
    sheet.appendRow([
      "USR-TEACHER", "teacher", "ครูผู้สอน / ผู้คุมสอบ", "TEACHER", "111222", 
      "ACTIVE", nowIso, nowIso, ""
    ]);
  }
  return sheet;
}

// 1.2 ตาราง SystemConfig (โครงสร้างแนวนอนตรงกับ Google Sheets ของผู้ใช้)
function getConfigSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_CONFIG);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_CONFIG);
  }

  // ตรวจสอบหัวตาราง
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      "master_admin_passcode", "system_name", "portal_announcement", "teacher_passcode", "updated_at"
    ]);
    sheet.getRange(1, 1, 1, 5)
      .setBackground("#15803d")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    sheet.setFrozenRows(1);
  } else if (sheet.getLastColumn() < 5) {
    // เสริมหัวตาราง teacher_passcode และ updated_at หากมี 3 คอลัมน์เดิม
    const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    if (headers.length === 3) {
      sheet.getRange(1, 4).setValue("teacher_passcode");
      sheet.getRange(1, 5).setValue("updated_at");
      sheet.getRange(1, 4, 1, 2).setBackground("#15803d").setFontColor("#ffffff").setFontWeight("bold");
    }
  }

  // Auto-populate แถวที่ 2 หากยังว่างเปล่า (ตามภาพถ่ายหน้าจอของคุณครู)
  if (sheet.getLastRow() <= 1) {
    const nowIso = new Date().toISOString();
    sheet.appendRow([
      "999888", 
      "Exam Proctor Studio", 
      "ยินดีต้อนรับสู่นักเรียนทุกคน ขอให้ทำข้อสอบด้วยความตั้งใจและความซื่อสัตย์", 
      "111222", 
      nowIso
    ]);
  }

  return sheet;
}

// 1.3 ตาราง ExamRooms
function getRoomsSheet(ss) {
  return getOrCreateSheet(ss, SHEET_ROOMS, [
    "room_id", "title", "category", "grade_level", "form_url", 
    "exam_url", "entry_code", "admin_passcode", "status", 
    "created_by", "created_at", "updated_at"
  ], "#1a73e8");
}

// 1.4 ตาราง ExamLogs
function getLogsSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_LOGS);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_LOGS);
    sheet.appendRow([
      "log_id", "room_id", "room_title", "student_id", "event_type", 
      "violation_detail", "violation_count", "severity", "formatted_time", "iso_timestamp"
    ]);
    sheet.getRange(1, 1, 1, 10)
      .setBackground("#ea4335")
      .setFontColor("#ffffff")
      .setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ===================================================================
 * 2. GET Request Handlers (ดึงข้อมูล)
 * =================================================================== */
function doGet(e) {
  try {
    const ss = getSpreadsheet();
    const params = e && e.parameter ? e.parameter : {};
    const action = params.action || "getLogs";

    // 2.1 ดึงการตั้งค่าระบบ (SystemConfig)
    if (action === "getSystemConfig") {
      const configSheet = getConfigSheet(ss);
      const row2 = configSheet.getRange(2, 1, 1, Math.max(5, configSheet.getLastColumn())).getValues()[0];
      return createJsonResponse({
        status: "success",
        data: {
          masterAdminPasscode: String(row2[0] || "999888"),
          systemName: String(row2[1] || "Exam Proctor Studio"),
          portalAnnouncement: String(row2[2] || ""),
          teacherPasscode: String(row2[3] || "111222"),
          updatedAt: String(row2[4] || "")
        }
      });
    }

    // 2.2 ดึงรายชื่อผู้ใช้งานระบบ (Users) — เฉพาะ Admin
    if (action === "getAllUsers") {
      const usersSheet = getUsersSheet(ss);
      const lastRow = usersSheet.getLastRow();
      if (lastRow <= 1) return createJsonResponse({ status: "success", data: [] });

      const values = usersSheet.getRange(2, 1, lastRow - 1, 9).getValues();
      const users = values.map(r => ({
        userId: String(r[0]),
        username: String(r[1]),
        displayName: String(r[2]),
        role: String(r[3]),
        passcode: String(r[4]),
        status: String(r[5]),
        createdAt: String(r[6]),
        updatedAt: String(r[7]),
        lastLogin: String(r[8] || "")
      }));

      return createJsonResponse({ status: "success", data: users });
    }

    // 2.3 หน้ารวมข้อสอบ: ดึงเฉพาะห้องที่กำลังเปิดรับ (status === 'OPEN')
    if (action === "getActiveRooms") {
      const sheet = getRoomsSheet(ss);
      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) return createJsonResponse({ status: "success", data: [] });

      const values = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
      const activeRooms = values
        .filter(r => String(r[8]).toUpperCase() === "OPEN")
        .map(r => ({
          roomId: String(r[0]),
          title: String(r[1]),
          category: String(r[2]),
          gradeLevel: String(r[3]),
          formUrl: String(r[4]),
          examUrl: String(r[5]),
          entryCode: String(r[6]),
          status: String(r[8]),
          createdBy: String(r[9]),
          createdAt: String(r[10]),
          updatedAt: String(r[11])
        }));
      return createJsonResponse({ status: "success", data: activeRooms });
    }

    // 2.4 ดึงห้องสอบทั้งหมด (สำหรับ Admin/Teacher และประวัติห้องสอบ)
    if (action === "getAllRooms") {
      const sheet = getRoomsSheet(ss);
      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) return createJsonResponse({ status: "success", data: [] });

      const values = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
      const rooms = values.map(r => ({
        roomId: String(r[0]),
        title: String(r[1]),
        category: String(r[2]),
        gradeLevel: String(r[3]),
        formUrl: String(r[4]),
        examUrl: String(r[5]),
        entryCode: String(r[6]),
        adminPasscode: String(r[7]),
        status: String(r[8]),
        createdBy: String(r[9]),
        createdAt: String(r[10]),
        updatedAt: String(r[11])
      })).reverse();
      return createJsonResponse({ status: "success", data: rooms });
    }

    // 2.5 ตรวจสอบรหัสเข้าห้องสอบ (Verify Room Entry Code)
    if (action === "verifyRoomEntry") {
      const targetRoomId = String(params.roomId || "").trim();
      const targetEntryCode = String(params.entryCode || "").trim();
      const sheet = getRoomsSheet(ss);
      const lastRow = sheet.getLastRow();
      if (lastRow <= 1) return createJsonResponse({ status: "error", message: "ไม่พบห้องสอบในระบบ" });

      const values = sheet.getRange(2, 1, lastRow - 1, 12).getValues();
      const roomRow = values.find(r => String(r[0]).trim() === targetRoomId);
      if (!roomRow) {
        return createJsonResponse({ status: "error", message: "ไม่พบรหัสห้องสอบนี้" });
      }

      const isOpen = String(roomRow[8]).toUpperCase() === "OPEN";
      if (!isOpen) {
        return createJsonResponse({ status: "error", message: "ห้องสอบนี้ปิดรับการเข้าสอบแล้ว" });
      }

      const actualEntryCode = String(roomRow[6]).trim();
      if (actualEntryCode && actualEntryCode !== targetEntryCode) {
        return createJsonResponse({ status: "error", message: "รหัสเข้าห้องสอบไม่ถูกต้อง" });
      }

      return createJsonResponse({
        status: "success",
        valid: true,
        room: {
          roomId: String(roomRow[0]),
          title: String(roomRow[1]),
          formUrl: String(roomRow[4]),
          examUrl: String(roomRow[5]),
          adminPasscode: String(roomRow[7])
        }
      });
    }

    // 2.6 ดึงข้อมูล Logs สำหรับหน้าจอคุมสอบสด (Real-time Monitor)
    const logsSheet = getLogsSheet(ss);
    const lastRow = logsSheet.getLastRow();
    if (lastRow <= 1) return createJsonResponse({ status: "success", data: [] });

    const numCols = logsSheet.getLastColumn();
    const startRow = Math.max(2, lastRow - 199);
    const numRows = lastRow - startRow + 1;
    const values = logsSheet.getRange(startRow, 1, numRows, numCols).getValues();

    const logs = values.map((row) => {
      if (numCols >= 10) {
        return {
          logId: String(row[0] || ""),
          roomId: String(row[1] || ""),
          roomTitle: String(row[2] || ""),
          studentId: row[3],
          eventType: String(row[4] || ""),
          violation: String(row[5] || ""),
          violationCount: Number(row[6] || 0),
          severity: String(row[7] || ""),
          time: row[8] instanceof Date ? Utilities.formatDate(row[8], "GMT+7", "HH:mm:ss") : String(row[8] || ""),
          timestamp: row[9] instanceof Date ? row[9].toISOString() : String(row[9] || "")
        };
      }
      return {
        time: row[0] instanceof Date ? Utilities.formatDate(row[0], "GMT+7", "HH:mm:ss") : String(row[0] || ""),
        studentId: row[1],
        violation: row[2],
        severity: row[3],
        timestamp: row[4] instanceof Date ? row[4].toISOString() : String(row[4] || "")
      };
    }).sort((a, b) => {
      const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
      const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
      return tA - tB;
    });

    return createJsonResponse({ status: "success", data: logs });

  } catch (error) {
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}

/* ===================================================================
 * 3. POST Request Handlers (บันทึก / แก้ไข / ลบ / จัดการ)
 * =================================================================== */
function doPost(e) {
  let hasLock = false;
  const lock = LockService.getScriptLock();
  try {
    hasLock = lock.tryLock(8000);
  } catch (_) {}

  try {
    const ss = getSpreadsheet();
    let data = {};
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (err) {
        data = { violation: e.postData.contents };
      }
    }

    const action = data.action || "logEvent";

    // 3.1 ตรวจสอบสิทธิ์การเข้าสู่ระบบ (Staff Login Verification)
    if (action === "verifyLogin") {
      const usernameInput = String(data.username || "").trim().toLowerCase();
      const passcodeInput = String(data.passcode || "").trim();
      const requestedRole = String(data.role || "").toUpperCase();

      const usersSheet = getUsersSheet(ss);
      const lastRow = usersSheet.getLastRow();
      let authenticatedUser = null;

      if (lastRow > 1) {
        const rows = usersSheet.getRange(2, 1, lastRow - 1, 9).getValues();
        for (let i = 0; i < rows.length; i++) {
          const uId = String(rows[i][0]);
          const uName = String(rows[i][1]).trim().toLowerCase();
          const dName = String(rows[i][2]);
          const uRole = String(rows[i][3]).toUpperCase();
          const uPass = String(rows[i][4]).trim();
          const uStatus = String(rows[i][5]).toUpperCase();

          // ตรวจสอบทั้งกรณีใส่ Username+Passcode หรือเลือก Role+Passcode
          const matchUsername = usernameInput && uName === usernameInput && uPass === passcodeInput;
          const matchRoleOnly = !usernameInput && requestedRole && uRole === requestedRole && uPass === passcodeInput;

          if (matchUsername || matchRoleOnly) {
            if (uStatus !== "ACTIVE") {
              if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
              return createJsonResponse({ status: "error", message: "บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ" });
            }

            authenticatedUser = {
              userId: uId,
              username: rows[i][1],
              displayName: dName,
              role: uRole
            };

            // อัปเดตเวลาเข้าสู่ระบบล่าสุด (last_login)
            const rowIndex = i + 2;
            usersSheet.getRange(rowIndex, 9).setValue(new Date().toISOString());
            break;
          }
        }
      }

      // Fallback ตรวจสอบกับ SystemConfig
      if (!authenticatedUser) {
        const configSheet = getConfigSheet(ss);
        const cfg = configSheet.getRange(2, 1, 1, 5).getValues()[0];
        const masterPass = String(cfg[0] || "999888").trim();
        const teacherPass = String(cfg[3] || "111222").trim();

        if (passcodeInput === masterPass) {
          authenticatedUser = {
            userId: "USR-ADMIN",
            username: "admin",
            displayName: "ผู้ดูแลระบบหลัก (Master Admin)",
            role: "ADMIN"
          };
        } else if (passcodeInput === teacherPass && requestedRole !== "ADMIN") {
          authenticatedUser = {
            userId: "USR-TEACHER",
            username: "teacher",
            displayName: "ครูผู้สอน / ผู้คุมสอบ",
            role: "TEACHER"
          };
        }
      }

      if (hasLock) { try { lock.releaseLock(); } catch (_) {} }

      if (authenticatedUser) {
        return createJsonResponse({
          status: "success",
          message: "เข้าสู่ระบบสำเร็จ",
          user: authenticatedUser
        });
      } else {
        return createJsonResponse({
          status: "error",
          message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบใหม่อีกครั้ง"
        });
      }
    }

    // 3.2 เพิ่มผู้ใช้งานใหม่ (Create User - Role Admin)
    if (action === "createUser") {
      const usersSheet = getUsersSheet(ss);
      const username = String(data.username || "").trim().toLowerCase();
      const displayName = String(data.displayName || data.username || "ผู้ใช้งานใหม่").trim();
      const role = String(data.role || "TEACHER").toUpperCase();
      const passcode = String(data.passcode || Math.floor(100000 + Math.random() * 900000)).trim();
      const status = String(data.status || "ACTIVE").toUpperCase();

      if (!username || !passcode) {
        if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
        return createJsonResponse({ status: "error", message: "กรุณาระบุ Username และ Passcode ให้ครบถ้วน" });
      }

      // ตรวจสอบ Username ซ้ำ
      const lastRow = usersSheet.getLastRow();
      if (lastRow > 1) {
        const existingUsers = usersSheet.getRange(2, 2, lastRow - 1, 1).getValues().map(r => String(r[0]).toLowerCase());
        if (existingUsers.includes(username)) {
          if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
          return createJsonResponse({ status: "error", message: "Username นี้มีอยู่ในระบบแล้ว กรุณาใช้ชื่ออื่น" });
        }
      }

      const userId = "USR-" + Math.floor(100000 + Math.random() * 900000);
      const nowIso = new Date().toISOString();

      usersSheet.appendRow([
        userId, username, displayName, role, passcode, status, nowIso, nowIso, ""
      ]);

      if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
      return createJsonResponse({
        status: "success",
        message: "เพิ่มผู้ใช้งานใหม่เรียบร้อยแล้ว",
        data: { userId, username, displayName, role, passcode, status }
      });
    }

    // 3.3 แก้ไขผู้ใช้งาน (Update User - Role Admin)
    if (action === "updateUser") {
      const usersSheet = getUsersSheet(ss);
      const targetUserId = String(data.userId || "").trim();
      const lastRow = usersSheet.getLastRow();
      let found = false;

      if (lastRow > 1) {
        const ids = usersSheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < ids.length; i++) {
          if (String(ids[i][0]).trim() === targetUserId) {
            const rowIndex = i + 2;
            if (data.displayName) usersSheet.getRange(rowIndex, 3).setValue(String(data.displayName).trim());
            if (data.role) usersSheet.getRange(rowIndex, 4).setValue(String(data.role).toUpperCase());
            if (data.passcode) usersSheet.getRange(rowIndex, 5).setValue(String(data.passcode).trim());
            if (data.status) usersSheet.getRange(rowIndex, 6).setValue(String(data.status).toUpperCase());
            usersSheet.getRange(rowIndex, 8).setValue(new Date().toISOString());
            found = true;
            break;
          }
        }
      }

      if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
      if (found) {
        return createJsonResponse({ status: "success", message: "แก้ไขข้อมูลผู้ใช้งานเรียบร้อยแล้ว" });
      } else {
        return createJsonResponse({ status: "error", message: "ไม่พบผู้ใช้งานที่ต้องการแก้ไข" });
      }
    }

    // 3.4 ลบผู้ใช้งาน (Delete User - Role Admin)
    if (action === "deleteUser") {
      const usersSheet = getUsersSheet(ss);
      const targetUserId = String(data.userId || "").trim();
      const targetUsername = String(data.username || "").trim().toLowerCase();

      // ป้องกันไม่ให้ลบ Super Admin หลัก
      if (targetUserId === "USR-ADMIN" || targetUsername === "admin") {
        if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
        return createJsonResponse({ status: "error", message: "ไม่สามารถลบบัญชีผู้ดูแลระบบหลัก (Super Admin) ได้" });
      }

      const lastRow = usersSheet.getLastRow();
      let deleted = false;

      if (lastRow > 1) {
        const ids = usersSheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < ids.length; i++) {
          if (String(ids[i][0]).trim() === targetUserId) {
            usersSheet.deleteRow(i + 2);
            deleted = true;
            break;
          }
        }
      }

      if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
      if (deleted) {
        return createJsonResponse({ status: "success", message: "ลบผู้ใช้งานออกจากระบบเรียบร้อยแล้ว" });
      } else {
        return createJsonResponse({ status: "error", message: "ไม่พบผู้ใช้งานที่ต้องการลบ" });
      }
    }

    // 3.5 บันทึกการตั้งค่าระบบ (Update SystemConfig - Role Admin)
    if (action === "updateSystemConfig") {
      const configSheet = getConfigSheet(ss);
      if (data.masterAdminPasscode) configSheet.getRange(2, 1).setValue(String(data.masterAdminPasscode).trim());
      if (data.systemName) configSheet.getRange(2, 2).setValue(String(data.systemName).trim());
      if (data.portalAnnouncement !== undefined) configSheet.getRange(2, 3).setValue(String(data.portalAnnouncement).trim());
      if (data.teacherPasscode) configSheet.getRange(2, 4).setValue(String(data.teacherPasscode).trim());
      configSheet.getRange(2, 5).setValue(new Date().toISOString());

      if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
      return createJsonResponse({ status: "success", message: "บันทึกการตั้งค่าระบบเรียบร้อยแล้ว" });
    }

    // 3.6 บันทึกสร้างห้องสอบใหม่ (Create Room)
    if (action === "createRoom") {
      const roomsSheet = getRoomsSheet(ss);
      const roomId = data.roomId || ("RM-" + Math.floor(100000 + Math.random() * 900000));
      const title = data.title || "แบบทดสอบออนไลน์";
      const category = data.category || "ทั่วไป";
      const gradeLevel = data.gradeLevel || "ทั่วไป";
      const formUrl = data.formUrl || "";
      const examUrl = data.examUrl || "";
      const entryCode = String(data.entryCode || Math.floor(100000 + Math.random() * 900000));
      const adminPasscode = String(data.adminPasscode || Math.floor(100000 + Math.random() * 900000));
      const status = String(data.status || "OPEN").toUpperCase();
      const createdBy = data.createdBy || "User";
      const nowIso = new Date().toISOString();

      roomsSheet.appendRow([
        roomId, title, category, gradeLevel, formUrl,
        examUrl, entryCode, adminPasscode, status,
        createdBy, nowIso, nowIso
      ]);

      if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
      return createJsonResponse({
        status: "success",
        message: "สร้างห้องสอบใหม่เรียบร้อยแล้ว",
        data: { roomId, title, category, gradeLevel, entryCode, adminPasscode, status }
      });
    }

    // 3.7 สลับสถานะ เปิด/ปิด ห้องสอบ (Toggle Room Status)
    if (action === "toggleRoomStatus") {
      const roomsSheet = getRoomsSheet(ss);
      const targetRoomId = String(data.roomId || "").trim();
      const newStatus = String(data.status || "OPEN").toUpperCase();
      const lastRow = roomsSheet.getLastRow();

      if (lastRow > 1) {
        const ids = roomsSheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < ids.length; i++) {
          if (String(ids[i][0]).trim() === targetRoomId) {
            const rowIndex = i + 2;
            roomsSheet.getRange(rowIndex, 9).setValue(newStatus);
            roomsSheet.getRange(rowIndex, 12).setValue(new Date().toISOString());
            break;
          }
        }
      }

      if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
      return createJsonResponse({
        status: "success",
        message: "เปลี่ยนสถานะห้องสอบเป็น " + newStatus + " เรียบร้อยแล้ว",
        status: newStatus
      });
    }

    // 3.8 แก้ไขข้อมูลห้องสอบ (Update Room - Role Admin)
    if (action === "updateRoom") {
      const roomsSheet = getRoomsSheet(ss);
      const targetRoomId = String(data.roomId || "").trim();
      const lastRow = roomsSheet.getLastRow();

      if (lastRow > 1) {
        const ids = roomsSheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < ids.length; i++) {
          if (String(ids[i][0]).trim() === targetRoomId) {
            const rowIndex = i + 2;
            if (data.title) roomsSheet.getRange(rowIndex, 2).setValue(data.title);
            if (data.category) roomsSheet.getRange(rowIndex, 3).setValue(data.category);
            if (data.gradeLevel) roomsSheet.getRange(rowIndex, 4).setValue(data.gradeLevel);
            if (data.formUrl) roomsSheet.getRange(rowIndex, 5).setValue(data.formUrl);
            if (data.examUrl) roomsSheet.getRange(rowIndex, 6).setValue(data.examUrl);
            if (data.entryCode) roomsSheet.getRange(rowIndex, 7).setValue(String(data.entryCode));
            if (data.adminPasscode) roomsSheet.getRange(rowIndex, 8).setValue(String(data.adminPasscode));
            if (data.status) roomsSheet.getRange(rowIndex, 9).setValue(String(data.status).toUpperCase());
            roomsSheet.getRange(rowIndex, 12).setValue(new Date().toISOString());
            break;
          }
        }
      }

      if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
      return createJsonResponse({ status: "success", message: "แก้ไขข้อมูลห้องสอบเรียบร้อยแล้ว" });
    }

    // 3.9 ลบห้องสอบ (Delete Room - Role Admin)
    if (action === "deleteRoom") {
      const roomsSheet = getRoomsSheet(ss);
      const targetRoomId = String(data.roomId || "").trim();
      const lastRow = roomsSheet.getLastRow();

      if (lastRow > 1) {
        const ids = roomsSheet.getRange(2, 1, lastRow - 1, 1).getValues();
        for (let i = 0; i < ids.length; i++) {
          if (String(ids[i][0]).trim() === targetRoomId) {
            roomsSheet.deleteRow(i + 2);
            break;
          }
        }
      }

      if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
      return createJsonResponse({ status: "success", message: "ลบห้องสอบเรียบร้อยแล้ว" });
    }

    // 3.10 บันทึกเหตุการณ์การสอบ (Log Event)
    const logsSheet = getLogsSheet(ss);
    const numCols = logsSheet.getLastColumn();
    const timeFormatted = data.time || Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
    const studentId = data.studentId || "ไม่ระบุชื่อ";
    let violation = data.violation || "ไม่มีรายละเอียด";
    const vCount = Number(data.violationCount || 0);

    if (vCount > 1 && !violation.includes("ครั้งที่") && !violation.includes("เตือน")) {
      violation += " (เตือนสะสม " + vCount + " ครั้ง)";
    }

    const severity = data.isSeverityHigh ? "🚨 วิกฤต" : "⚠️ ทั่วไป";
    const timestamp = data.timestamp || new Date().toISOString();
    const roomId = data.roomId || "RM-GENERAL";
    const roomTitle = data.formTitle || data.roomTitle || "แบบทดสอบออนไลน์";
    const logId = "LOG-" + Date.now();
    let eventType = "VIOLATION";
    if (violation.includes("เริ่มเข้าทำข้อสอบ")) eventType = "START";
    if (violation.includes("ส่งข้อสอบเรียบร้อย")) eventType = "FINISH";

    if (numCols >= 10) {
      logsSheet.appendRow([
        logId, roomId, roomTitle, studentId, eventType,
        violation, vCount, severity, timeFormatted, timestamp
      ]);
    } else {
      logsSheet.appendRow([timeFormatted, studentId, violation, severity, timestamp]);
    }

    if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
    return createJsonResponse({ status: "success", message: "บันทึกข้อมูลเรียบร้อยแล้ว" });

  } catch (error) {
    if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}
