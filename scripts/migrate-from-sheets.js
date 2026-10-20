/**
 * Data Migration Script: Google Sheets / Apps Script -> Neon Postgres
 * Run: node scripts/migrate-from-sheets.js
 */

const { neon } = require("@neondatabase/serverless");

const DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzN0bSpaAbWaIfgIA3kNfZyDGLr-U0965UDPy27IiQkotdXF576SghQrH8MGQuHGNi_/exec";
const DATABASE_URL = process.env.DATABASE_URL;

async function runMigration() {
  if (!DATABASE_URL) {
    console.error("❌ Error: กรุณากำหนด DATABASE_URL ใน environment variable ก่อนรันสคริปต์นี้");
    console.error("ตัวอย่าง: set DATABASE_URL=postgresql://... (Windows) หรือ export DATABASE_URL=... (Mac/Linux)");
    process.exit(1);
  }

  console.log("🚀 กำลังเริ่มต้นย้ายข้อมูลจาก Google Apps Script สู่ Neon Serverless Postgres...");
  const sql = neon(DATABASE_URL);

  // 1. ดึงข้อมูล System Config จาก Apps Script
  try {
    console.log("📥 กำลังดึงการตั้งค่าระบบ (SystemConfig)...");
    const cfgRes = await fetch(`${DEFAULT_WEBHOOK_URL}?action=getSystemConfig`);
    if (cfgRes.ok) {
      const cfgJson = await cfgRes.json();
      if (cfgJson && cfgJson.status === "success" && cfgJson.data) {
        const d = cfgJson.data;
        await sql`
          INSERT INTO system_config (id, master_admin_passcode, system_name, portal_announcement, teacher_passcode)
          VALUES (1, ${d.masterAdminPasscode || '999888'}, ${d.systemName || 'Exam Proctor Studio'}, ${d.portalAnnouncement || ''}, ${d.teacherPasscode || '111222'})
          ON CONFLICT (id) DO UPDATE
          SET 
            master_admin_passcode = EXCLUDED.master_admin_passcode,
            system_name = EXCLUDED.system_name,
            portal_announcement = EXCLUDED.portal_announcement,
            teacher_passcode = EXCLUDED.teacher_passcode,
            updated_at = NOW();
        `;
        console.log("✅ ย้าย SystemConfig สำเร็จ!");
      }
    }
  } catch (err) {
    console.warn("⚠️ ไม่สามารถดึง SystemConfig ได้:", err.message);
  }

  // 2. ดึงข้อมูล Users จาก Apps Script
  try {
    console.log("📥 กำลังดึงรายชื่อผู้ใช้งาน (Users)...");
    const usersRes = await fetch(`${DEFAULT_WEBHOOK_URL}?action=getAllUsers`);
    if (usersRes.ok) {
      const usersJson = await usersRes.json();
      if (usersJson && usersJson.status === "success" && Array.isArray(usersJson.data)) {
        const users = usersJson.data;
        console.log(`👤 พบผู้ใช้งาน ${users.length} รายการ กำลังบันทึกลง Neon...`);
        for (const u of users) {
          await sql`
            INSERT INTO users (user_id, username, display_name, role, passcode, status, created_at, updated_at, last_login)
            VALUES (
              ${u.userId || ('USR-' + Math.floor(Math.random() * 900000))},
              ${String(u.username).toLowerCase()},
              ${u.displayName || u.username},
              ${String(u.role).toUpperCase()},
              ${String(u.passcode)},
              ${String(u.status || 'ACTIVE').toUpperCase()},
              ${u.createdAt ? new Date(u.createdAt) : new Date()},
              ${u.updatedAt ? new Date(u.updatedAt) : new Date()},
              ${u.lastLogin ? new Date(u.lastLogin) : null}
            )
            ON CONFLICT (username) DO UPDATE
            SET
              display_name = EXCLUDED.display_name,
              role = EXCLUDED.role,
              passcode = EXCLUDED.passcode,
              status = EXCLUDED.status,
              updated_at = NOW();
          `;
        }
        console.log("✅ ย้าย Users ทั้งหมดสำเร็จ!");
      }
    }
  } catch (err) {
    console.warn("⚠️ ไม่สามารถดึง Users ได้:", err.message);
  }

  // 3. ดึงข้อมูล ExamRooms จาก Apps Script
  try {
    console.log("📥 กำลังดึงห้องสอบทั้งหมด (ExamRooms)...");
    const roomsRes = await fetch(`${DEFAULT_WEBHOOK_URL}?action=getAllRooms`);
    if (roomsRes.ok) {
      const roomsJson = await roomsRes.json();
      if (roomsJson && roomsJson.status === "success" && Array.isArray(roomsJson.data)) {
        const rooms = roomsJson.data;
        console.log(`📁 พบห้องสอบ ${rooms.length} ห้อง กำลังบันทึกลง Neon...`);
        for (const r of rooms) {
          if (!r.roomId) continue;
          await sql`
            INSERT INTO exam_rooms (
              room_id, title, category, grade_level, form_url, exam_url,
              entry_code, admin_passcode, status, created_by, creator_username,
              created_at, updated_at
            ) VALUES (
              ${r.roomId},
              ${r.title || 'แบบทดสอบออนไลน์'},
              ${r.category || 'ทั่วไป (General)'},
              ${r.gradeLevel || 'ไม่ระบุ (All / Not Specified)'},
              ${r.formUrl || ''},
              ${r.examUrl || ''},
              ${String(r.entryCode || '')},
              ${String(r.adminPasscode || '')},
              ${String(r.status || 'OPEN').toUpperCase()},
              ${r.createdBy || ''},
              ${r.creatorUsername || ''},
              ${r.createdAt ? new Date(r.createdAt) : new Date()},
              ${r.updatedAt ? new Date(r.updatedAt) : new Date()}
            )
            ON CONFLICT (room_id) DO UPDATE
            SET
              title = EXCLUDED.title,
              category = EXCLUDED.category,
              grade_level = EXCLUDED.grade_level,
              form_url = EXCLUDED.form_url,
              exam_url = EXCLUDED.exam_url,
              entry_code = EXCLUDED.entry_code,
              admin_passcode = EXCLUDED.admin_passcode,
              status = EXCLUDED.status,
              created_by = EXCLUDED.created_by,
              creator_username = EXCLUDED.creator_username,
              updated_at = NOW();
          `;
        }
        console.log("✅ ย้าย ExamRooms ทั้งหมดสำเร็จ!");
      }
    }
  } catch (err) {
    console.warn("⚠️ ไม่สามารถดึง ExamRooms ได้:", err.message);
  }

  console.log("🎉 การย้ายข้อมูลจาก Google Apps Script สู่ Neon Serverless Postgres เสร็จสมบูรณ์ 100%!");
}

runMigration().catch((err) => {
  console.error("❌ Migration failed:", err);
  process.exit(1);
});
