/**
 * ===================================================================
 * Google Apps Script: ระบบ Webhook บันทึกประวัติและแสดงผล Real-time Monitor
 * สำหรับ Extension: Exam Proctor Lock
 * ===================================================================
 * 
 * วิธีการติดตั้ง:
 * 1. เปิด Google Sheets ใหม่ (https://sheets.new) ตั้งชื่อไฟล์ เช่น "Exam Proctor Logs"
 * 2. ไปที่เมนู "ส่วนขยาย" (Extensions) -> "Apps Script"
 * 3. ลบโค้ดเดิมออกทั้งหมด แล้ววางโค้ดชุดนี้ลงไป
 * 4. กดบันทึก (ไอคอนแผ่นดิสก์)
 * 5. กดปุ่ม "ทำให้ใช้งานได้" (Deploy) -> "การทำให้ใช้งานได้รายการใหม่" (New deployment)
 * 6. เลือกประเภท: "เว็บแอป" (Web app)
 *    - คำอธิบาย: Exam Proctor Webhook v2
 *    - ดำเนินการในฐานะ (Execute as): "ฉัน" (Me - บัญชี Google ของคุณ)
 *    - ผู้มีสิทธิ์เข้าถึง (Who has access): "ทุกคน" (Anyone) **สำคัญมาก!**
 * 7. กด "ทำให้ใช้งานได้" -> ให้สิทธิ์การเข้าถึง (Review Permissions / Allow)
 * 8. คัดลอก "URL ของเว็บแอป" (Web app URL) ไปวางในช่อง Webhook URL ในหน้าต่าง Extension
 */

const SHEET_ID = "1aDO0taJC_7itVhA4Ft0Pp01muyXPEcNhYtiqdwRvQGU";
const SHEET_NAME = "ExamLogs";

// ฟังก์ชันเปิด Spreadsheet ที่รองรับทั้งแบบ Bound Script และ Standalone Script
function getSpreadsheet() {
  try {
    const active = SpreadsheetApp.getActiveSpreadsheet();
    if (active) return active;
  } catch (err) {}
  return SpreadsheetApp.openById(SHEET_ID);
}

// 1. รับข้อมูลแจ้งเตือน (POST Request จาก Extension)
function doPost(e) {
  try {
    const lock = LockService.getScriptLock();
    lock.waitLock(10000); // ป้องกัน race condition เมื่อมีแจ้งเตือนเข้ามาพร้อมกัน

    const ss = getSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    // หากยังไม่มีชีต ให้สร้างชีตและแถวหัวตารางอัตโนมัติ
    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow(["วัน-เวลา", "รหัสประจำตัว / ชื่อผู้สอบ", "พฤติกรรมที่ตรวจพบ", "ระดับความรุนแรง", "ISO Timestamp"]);
      sheet.getRange(1, 1, 1, 5).setBackground("#1a73e8").setFontColor("#ffffff").setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    // แปลงข้อมูล JSON จาก Extension
    let data = {};
    if (e.postData && e.postData.contents) {
      try {
        data = JSON.parse(e.postData.contents);
      } catch (err) {
        data = { violation: e.postData.contents };
      }
    }

    const timeFormatted = data.time || Utilities.formatDate(new Date(), "GMT+7", "dd/MM/yyyy HH:mm:ss");
    const studentId = data.studentId || "ไม่ระบุชื่อ";
    const violation = data.violation || "ไม่มีรายละเอียด";
    const severity = data.isSeverityHigh ? "🚨 วิกฤต" : "⚠️ ทั่วไป";
    const timestamp = data.timestamp || new Date().toISOString();

    // บันทึกแถวใหม่
    sheet.appendRow([timeFormatted, studentId, violation, severity, timestamp]);

    lock.releaseLock();

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      message: "บันทึกข้อมูลเรียบร้อยแล้ว"
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// 2. ส่งข้อมูล Log กลับไปแสดงบนหน้า Admin Monitor (GET Request)
function doGet(e) {
  try {
    const ss = getSpreadsheet();
    const sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        data: []
      })).setMimeType(ContentService.MimeType.JSON);
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      return ContentService.createTextOutput(JSON.stringify({
        status: "success",
        data: []
      })).setMimeType(ContentService.MimeType.JSON);
    }

    // BUG-11: เพิ่ม limit เป็น 200 แถว และ sort ตาม timestamp เพื่อให้ Timeline ถูกต้อง
    const startRow = Math.max(2, lastRow - 199);
    const numRows = lastRow - startRow + 1;
    const values = sheet.getRange(startRow, 1, numRows, 5).getValues();

    const logs = values
      .map((row) => ({
        time: row[0],
        studentId: row[1],
        violation: row[2],
        severity: row[3],
        timestamp: row[4]
      }))
      // Sort ตาม ISO timestamp จากเก่าไปใหม่ (เพื่อให้ admin.js เรียง timeline ถูกต้อง)
      .sort((a, b) => {
        const tA = a.timestamp ? new Date(a.timestamp).getTime() : 0;
        const tB = b.timestamp ? new Date(b.timestamp).getTime() : 0;
        return tA - tB;
      });

    return ContentService.createTextOutput(JSON.stringify({
      status: "success",
      data: logs
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService.createTextOutput(JSON.stringify({
      status: "error",
      message: error.toString()
    })).setMimeType(ContentService.MimeType.JSON);
  }
}
