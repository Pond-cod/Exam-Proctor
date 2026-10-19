/**
 * ===================================================================
 * Google Apps Script: ระบบบริหารจัดการห้องสอบและคุมสอบออนไลน์ (v5.0)
 * Exam Proctor Studio Database & Webhook Engine
 * ===================================================================
 * 
 * ฐานข้อมูลแบบ 3 ตาราง (Relational Multi-Sheet):
 * 1. ExamRooms   : จัดเก็บข้อมูลห้องสอบ, สถานะเปิด/ปิด, หมวดหมู่, ระดับชั้น, รหัสเข้าสอบนักเรียน, รหัสคุมสอบ
 * 2. ExamLogs    : จัดเก็บบันทึกประวัติการสอบและการแจ้งเตือนเหตุการณ์ผิดปกติ (เชื่อมโยงด้วย room_id)
 * 3. SystemConfig: จัดเก็บการตั้งค่าระบบกลาง และ Master Admin Passcode
 */

const SHEET_ID = "1aDO0taJC_7itVhA4Ft0Pp01muyXPEcNhYtiqdwRvQGU";
const SHEET_ROOMS = "ExamRooms";
const SHEET_LOGS = "ExamLogs";
const SHEET_CONFIG = "SystemConfig";

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

function getRoomsSheet(ss) {
  return getOrCreateSheet(ss, SHEET_ROOMS, [
    "room_id", "title", "category", "grade_level", "form_url", 
    "exam_url", "entry_code", "admin_passcode", "status", 
    "created_by", "created_at", "updated_at"
  ], "#1a73e8");
}

function getLogsSheet(ss) {
  // หากมีชีตเดิม ExamLogs ที่เป็น 5 คอลัมน์เดิม ให้ยังคงใช้งานได้
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

function getConfigSheet(ss) {
  const sheet = getOrCreateSheet(ss, SHEET_CONFIG, [
    "config_key", "config_value", "description", "updated_at"
  ], "#34a853");
  
  if (sheet.getLastRow() <= 1) {
    sheet.appendRow(["master_admin_passcode", "999888", "รหัสผ่านกลางสำหรับ Role Admin", new Date().toISOString()]);
    sheet.appendRow(["system_name", "Exam Proctor Studio", "ชื่อระบบ", new Date().toISOString()]);
  }
  return sheet;
}

function createJsonResponse(data) {
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ===================================================================
 * 1. GET Request Handlers (ดึงข้อมูล)
 * =================================================================== */
function doGet(e) {
  try {
    const ss = getSpreadsheet();
    const params = e && e.parameter ? e.parameter : {};
    const action = params.action || "getLogs"; // ค่าเริ่มต้นสำหรับความเข้ากันได้ย้อนหลัง

    // 1.1 หน้ารวมข้อสอบ: ดึงเฉพาะห้องที่กำลังเปิดรับ (status === 'OPEN')
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

    // 1.2 ดึงห้องสอบทั้งหมด (สำหรับ Admin และประวัติห้องสอบ)
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

    // 1.3 ตรวจสอบรหัสเข้าห้องสอบ (Verify Room Entry Code)
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

    // 1.4 ดึงข้อมูล Logs สำหรับหน้าจอคุมสอบสด (Real-time Monitor)
    const logsSheet = getLogsSheet(ss);
    const lastRow = logsSheet.getLastRow();
    if (lastRow <= 1) return createJsonResponse({ status: "success", data: [] });

    const numCols = logsSheet.getLastColumn();
    const startRow = Math.max(2, lastRow - 199);
    const numRows = lastRow - startRow + 1;
    const values = logsSheet.getRange(startRow, 1, numRows, numCols).getValues();

    const logs = values.map((row) => {
      // รองรับโครงสร้าง 10 คอลัมน์ใหม่
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
      // โครงสร้าง 5 คอลัมน์เดิม (Backward Compatibility)
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
 * 2. POST Request Handlers (บันทึก / แก้ไข / ลบ / จัดการ)
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

    // 2.1 บันทึกสร้างห้องสอบใหม่ (Create Room)
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

    // 2.2 สลับสถานะ เปิด/ปิด ห้องสอบ (Toggle Room Status)
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
            roomsSheet.getRange(rowIndex, 9).setValue(newStatus); // คอลัมน์ I คือ status
            roomsSheet.getRange(rowIndex, 12).setValue(new Date().toISOString()); // คอลัมน์ L คือ updated_at
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

    // 2.3 แก้ไขข้อมูลห้องสอบ (Update Room - Role Admin)
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

    // 2.4 ลบห้องสอบ (Delete Room - Role Admin)
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

    // 2.5 บันทึกเหตุการณ์การสอบ (Log Event: เริ่มสอบ / ละเมิดกฎ / ส่งข้อสอบ)
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
      // รองรับโครงสร้างชีตเดิม 5 คอลัมน์
      logsSheet.appendRow([timeFormatted, studentId, violation, severity, timestamp]);
    }

    if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
    return createJsonResponse({ status: "success", message: "บันทึกข้อมูลเรียบร้อยแล้ว" });

  } catch (error) {
    if (hasLock) { try { lock.releaseLock(); } catch (_) {} }
    return createJsonResponse({ status: "error", message: error.toString() });
  }
}
