/**
 * Vercel Serverless Function API for Exam Proctor Studio
 * Connects directly to Neon Serverless Postgres via @neondatabase/serverless
 * Replaces Google Apps Script Webhook with sub-50ms query speeds
 */

const { neon } = require("@neondatabase/serverless");

function setCorsHeaders(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
}

function parseRequestBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.body);
  } catch (_) {
    return { violation: String(req.body) };
  }
}

module.exports = async function handler(req, res) {
  setCorsHeaders(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    return res.status(500).json({
      status: "error",
      message: "DATABASE_URL is not configured in environment variables. Please add it to Vercel Settings."
    });
  }

  const sql = neon(databaseUrl);

  try {
    const isPost = req.method === "POST";
    const queryParams = req.query || {};
    const bodyData = isPost ? parseRequestBody(req) : {};
    const action = queryParams.action || bodyData.action || (isPost ? "logEvent" : "getLogs");

    // ===================================================================
    // 1. System Config Handlers
    // ===================================================================
    if (action === "getSystemConfig") {
      const rows = await sql`
        SELECT master_admin_passcode, system_name, portal_announcement, teacher_passcode, updated_at
        FROM system_config
        WHERE id = 1
        LIMIT 1;
      `;

      if (rows.length === 0) {
        return res.status(200).json({
          status: "success",
          data: {
            masterAdminPasscode: "999888",
            systemName: "Exam Proctor Studio",
            portalAnnouncement: "ยินดีต้อนรับสู่นักเรียนทุกคน ขอให้ทำข้อสอบด้วยความตั้งใจและความซื่อสัตย์",
            teacherPasscode: "111222",
            updatedAt: new Date().toISOString()
          }
        });
      }

      const r = rows[0];
      return res.status(200).json({
        status: "success",
        data: {
          masterAdminPasscode: String(r.master_admin_passcode || "999888"),
          systemName: String(r.system_name || "Exam Proctor Studio"),
          portalAnnouncement: String(r.portal_announcement || ""),
          teacherPasscode: String(r.teacher_passcode || "111222"),
          updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : ""
        }
      });
    }

    if (action === "updateSystemConfig") {
      const mPass = bodyData.masterAdminPasscode;
      const sName = bodyData.systemName;
      const pAnn = bodyData.portalAnnouncement;
      const tPass = bodyData.teacherPasscode;

      await sql`
        UPDATE system_config
        SET 
          master_admin_passcode = COALESCE(${mPass || null}, master_admin_passcode),
          system_name = COALESCE(${sName || null}, system_name),
          portal_announcement = COALESCE(${pAnn !== undefined ? pAnn : null}, portal_announcement),
          teacher_passcode = COALESCE(${tPass || null}, teacher_passcode),
          updated_at = NOW()
        WHERE id = 1;
      `;

      return res.status(200).json({
        status: "success",
        message: "บันทึกการตั้งค่าระบบเรียบร้อยแล้ว"
      });
    }

    // ===================================================================
    // 2. Authentication & Users Handlers
    // ===================================================================
    if (action === "verifyLogin") {
      const username = String(bodyData.username || queryParams.username || "").trim().toLowerCase();
      const passcode = String(bodyData.passcode || queryParams.passcode || "").trim();

      if (!username || !passcode || passcode.length < 8) {
        return res.status(200).json({
          status: "error",
          message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร/หลัก)"
        });
      }

      const rows = await sql`
        SELECT user_id, username, display_name, role, passcode, status
        FROM users
        WHERE LOWER(username) = ${username}
        LIMIT 1;
      `;

      if (rows.length === 0 || String(rows[0].passcode).trim() !== passcode) {
        return res.status(200).json({
          status: "error",
          message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบใหม่อีกครั้ง"
        });
      }

      const user = rows[0];
      if (String(user.status).toUpperCase() !== "ACTIVE") {
        return res.status(200).json({
          status: "error",
          message: "บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ"
        });
      }

      // Update last_login
      await sql`
        UPDATE users
        SET last_login = NOW()
        WHERE user_id = ${user.user_id};
      `;

      return res.status(200).json({
        status: "success",
        message: "เข้าสู่ระบบสำเร็จ",
        user: {
          userId: user.user_id,
          username: user.username,
          displayName: user.display_name,
          role: String(user.role).toUpperCase()
        }
      });
    }

    if (action === "getAllUsers") {
      const rows = await sql`
        SELECT user_id, username, display_name, role, passcode, status, created_at, updated_at, last_login
        FROM users
        ORDER BY created_at ASC;
      `;

      const users = rows.map((r) => ({
        userId: r.user_id,
        username: r.username,
        displayName: r.display_name,
        role: String(r.role).toUpperCase(),
        passcode: r.passcode,
        status: String(r.status).toUpperCase(),
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : "",
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : "",
        lastLogin: r.last_login ? new Date(r.last_login).toISOString() : ""
      }));

      return res.status(200).json({
        status: "success",
        data: users
      });
    }

    if (action === "createUser") {
      const username = String(bodyData.username || "").trim().toLowerCase();
      const displayName = String(bodyData.displayName || bodyData.username || "ผู้ใช้งานใหม่").trim();
      const role = String(bodyData.role || "TEACHER").toUpperCase();
      const passcode = String(bodyData.passcode || Math.floor(100000 + Math.random() * 900000)).trim();
      const status = String(bodyData.status || "ACTIVE").toUpperCase();

      if (!username || !passcode) {
        return res.status(200).json({
          status: "error",
          message: "กรุณาระบุ Username และ Passcode ให้ครบถ้วน"
        });
      }

      const existing = await sql`SELECT user_id FROM users WHERE LOWER(username) = ${username} LIMIT 1;`;
      if (existing.length > 0) {
        return res.status(200).json({
          status: "error",
          message: "Username นี้มีอยู่ในระบบแล้ว กรุณาใช้ชื่ออื่น"
        });
      }

      const userId = "USR-" + Math.floor(100000 + Math.random() * 900000);
      await sql`
        INSERT INTO users (user_id, username, display_name, role, passcode, status, created_at, updated_at)
        VALUES (${userId}, ${username}, ${displayName}, ${role}, ${passcode}, ${status}, NOW(), NOW());
      `;

      return res.status(200).json({
        status: "success",
        message: "เพิ่มผู้ใช้งานใหม่เรียบร้อยแล้ว",
        data: { userId, username, displayName, role, passcode, status }
      });
    }

    if (action === "updateUser") {
      const userId = String(bodyData.userId || "").trim();
      const displayName = bodyData.displayName ? String(bodyData.displayName).trim() : null;
      const role = bodyData.role ? String(bodyData.role).toUpperCase() : null;
      const passcode = bodyData.passcode ? String(bodyData.passcode).trim() : null;
      const status = bodyData.status ? String(bodyData.status).toUpperCase() : null;

      const result = await sql`
        UPDATE users
        SET
          display_name = COALESCE(${displayName}, display_name),
          role = COALESCE(${role}, role),
          passcode = COALESCE(${passcode}, passcode),
          status = COALESCE(${status}, status),
          updated_at = NOW()
        WHERE user_id = ${userId}
        RETURNING user_id;
      `;

      if (result.length === 0) {
        return res.status(200).json({ status: "error", message: "ไม่พบผู้ใช้งานที่ต้องการแก้ไข" });
      }

      return res.status(200).json({
        status: "success",
        message: "แก้ไขข้อมูลผู้ใช้งานเรียบร้อยแล้ว"
      });
    }

    if (action === "deleteUser") {
      const userId = String(bodyData.userId || "").trim();
      const username = String(bodyData.username || "").trim().toLowerCase();

      if (userId === "USR-ADMIN" || username === "admin") {
        return res.status(200).json({
          status: "error",
          message: "ไม่สามารถลบบัญชีผู้ดูแลระบบหลัก (Super Admin) ได้"
        });
      }

      const result = await sql`
        DELETE FROM users
        WHERE user_id = ${userId} OR (LOWER(username) = ${username} AND ${username} != '')
        RETURNING user_id;
      `;

      if (result.length === 0) {
        return res.status(200).json({ status: "error", message: "ไม่พบผู้ใช้งานที่ต้องการลบ" });
      }

      return res.status(200).json({
        status: "success",
        message: "ลบผู้ใช้งานออกจากระบบเรียบร้อยแล้ว"
      });
    }

    // ===================================================================
    // 3. Exam Rooms Handlers
    // ===================================================================
    if (action === "getActiveRooms") {
      const rows = await sql`
        SELECT room_id, title, category, grade_level, form_url, exam_url, entry_code, status, created_by, created_at, updated_at
        FROM exam_rooms
        WHERE UPPER(status) = 'OPEN'
        ORDER BY created_at DESC;
      `;

      const activeRooms = rows.map((r) => ({
        roomId: r.room_id,
        title: r.title,
        category: r.category,
        gradeLevel: r.grade_level,
        formUrl: r.form_url,
        examUrl: r.exam_url,
        entryCode: r.entry_code,
        status: r.status,
        createdBy: r.created_by,
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : "",
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : ""
      }));

      return res.status(200).json({ status: "success", data: activeRooms });
    }

    if (action === "getAllRooms") {
      const rows = await sql`
        SELECT room_id, title, category, grade_level, form_url, exam_url, entry_code, admin_passcode, status, created_by, creator_username, creator_id, created_at, updated_at
        FROM exam_rooms
        ORDER BY created_at DESC;
      `;

      const rooms = rows.map((r) => ({
        roomId: r.room_id,
        title: r.title,
        category: r.category,
        gradeLevel: r.grade_level,
        formUrl: r.form_url,
        examUrl: r.exam_url,
        entryCode: r.entry_code,
        adminPasscode: r.admin_passcode,
        status: r.status,
        createdBy: r.created_by || "",
        creatorUsername: r.creator_username || "",
        creatorId: r.creator_id || "",
        createdAt: r.created_at ? new Date(r.created_at).toISOString() : "",
        updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : ""
      }));

      return res.status(200).json({ status: "success", data: rooms });
    }

    if (action === "verifyRoomEntry") {
      const targetRoomId = String(queryParams.roomId || bodyData.roomId || "").trim();
      const targetEntryCode = String(queryParams.entryCode || bodyData.entryCode || "").trim();

      const rows = await sql`
        SELECT room_id, title, form_url, exam_url, entry_code, admin_passcode, status
        FROM exam_rooms
        WHERE room_id = ${targetRoomId}
        LIMIT 1;
      `;

      if (rows.length === 0) {
        return res.status(200).json({ status: "error", message: "ไม่พบรหัสห้องสอบนี้" });
      }

      const r = rows[0];
      if (String(r.status).toUpperCase() !== "OPEN") {
        return res.status(200).json({ status: "error", message: "ห้องสอบนี้ปิดรับการเข้าสอบแล้ว" });
      }

      if (r.entry_code && String(r.entry_code).trim() !== targetEntryCode) {
        return res.status(200).json({ status: "error", message: "รหัสเข้าห้องสอบไม่ถูกต้อง" });
      }

      return res.status(200).json({
        status: "success",
        valid: true,
        room: {
          roomId: r.room_id,
          title: r.title,
          formUrl: r.form_url,
          examUrl: r.exam_url,
          adminPasscode: r.admin_passcode
        }
      });
    }

    if (action === "createRoom") {
      const roomId = bodyData.roomId || ("RM-" + Math.floor(100000 + Math.random() * 900000));
      const title = bodyData.title || "แบบทดสอบออนไลน์";
      const category = bodyData.category || "ทั่วไป (General)";
      const gradeLevel = bodyData.gradeLevel || "ไม่ระบุ (All / Not Specified)";
      const formUrl = bodyData.formUrl || "";
      const examUrl = bodyData.examUrl || "";
      const entryCode = String(bodyData.entryCode || Math.floor(100000 + Math.random() * 900000));
      const adminPasscode = String(bodyData.adminPasscode || Math.floor(100000 + Math.random() * 900000));
      const status = String(bodyData.status || "OPEN").toUpperCase();
      const createdBy = bodyData.createdBy || (bodyData.creatorUsername ? `${bodyData.creatorName || "ครูผู้สอน"} (@${bodyData.creatorUsername})` : "User");
      const creatorUsername = bodyData.creatorUsername || "";
      const creatorId = bodyData.creatorId || "";

      await sql`
        INSERT INTO exam_rooms (
          room_id, title, category, grade_level, form_url, exam_url, entry_code,
          admin_passcode, status, created_by, creator_username, creator_id, created_at, updated_at
        ) VALUES (
          ${roomId}, ${title}, ${category}, ${gradeLevel}, ${formUrl}, ${examUrl},
          ${entryCode}, ${adminPasscode}, ${status}, ${createdBy}, ${creatorUsername},
          ${creatorId}, NOW(), NOW()
        );
      `;

      return res.status(200).json({
        status: "success",
        message: "สร้างห้องสอบใหม่เรียบร้อยแล้ว",
        data: { roomId, title, category, gradeLevel, entryCode, adminPasscode, status }
      });
    }

    if (action === "toggleRoomStatus") {
      const roomId = String(bodyData.roomId || "").trim();
      const newStatus = String(bodyData.status || "OPEN").toUpperCase();

      await sql`
        UPDATE exam_rooms
        SET status = ${newStatus}, updated_at = NOW()
        WHERE room_id = ${roomId};
      `;

      return res.status(200).json({
        status: "success",
        message: "เปลี่ยนสถานะห้องสอบเป็น " + newStatus + " เรียบร้อยแล้ว",
        status: newStatus
      });
    }

    if (action === "updateRoom") {
      const roomId = String(bodyData.roomId || "").trim();
      const title = bodyData.title || null;
      const category = bodyData.category || null;
      const gradeLevel = bodyData.gradeLevel || null;
      const formUrl = bodyData.formUrl || null;
      const examUrl = bodyData.examUrl || null;
      const entryCode = bodyData.entryCode ? String(bodyData.entryCode) : null;
      const adminPasscode = bodyData.adminPasscode ? String(bodyData.adminPasscode) : null;
      const status = bodyData.status ? String(bodyData.status).toUpperCase() : null;

      await sql`
        UPDATE exam_rooms
        SET
          title = COALESCE(${title}, title),
          category = COALESCE(${category}, category),
          grade_level = COALESCE(${gradeLevel}, grade_level),
          form_url = COALESCE(${formUrl}, form_url),
          exam_url = COALESCE(${examUrl}, exam_url),
          entry_code = COALESCE(${entryCode}, entry_code),
          admin_passcode = COALESCE(${adminPasscode}, admin_passcode),
          status = COALESCE(${status}, status),
          updated_at = NOW()
        WHERE room_id = ${roomId};
      `;

      return res.status(200).json({
        status: "success",
        message: "แก้ไขข้อมูลห้องสอบเรียบร้อยแล้ว"
      });
    }

    if (action === "deleteRoom") {
      const roomId = String(bodyData.roomId || "").trim();
      await sql`DELETE FROM exam_rooms WHERE room_id = ${roomId};`;
      return res.status(200).json({ status: "success", message: "ลบห้องสอบเรียบร้อยแล้ว" });
    }

    // ===================================================================
    // 4. Exam Logs Handlers (Live Monitor)
    // ===================================================================
    if (action === "logEvent") {
      const logId = "LOG-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
      const studentId = String(bodyData.studentId || "ไม่ระบุชื่อ").trim();
      const rawRoomId = String(bodyData.roomId || "").trim();
      let validRoomId = null;
      if (rawRoomId) {
        try {
          const roomCheck = await sql`SELECT room_id FROM exam_rooms WHERE room_id = ${rawRoomId} LIMIT 1;`;
          if (roomCheck.length > 0) {
            validRoomId = rawRoomId;
          }
        } catch (_) {}
      }

      const roomTitle = String(bodyData.roomTitle || bodyData.formTitle || "แบบทดสอบออนไลน์").trim();
      let violation = String(bodyData.violation || "ไม่มีรายละเอียด").trim();
      const vCount = Number(bodyData.violationCount || 0);

      if (vCount > 1 && !violation.includes("ครั้งที่") && !violation.includes("เตือน")) {
        violation += " (เตือนสะสม " + vCount + " ครั้ง)";
      }

      let eventType = "VIOLATION";
      if (violation.includes("เริ่มเข้าทำข้อสอบ")) eventType = "START";
      if (violation.includes("ส่งข้อสอบเรียบร้อย")) eventType = "FINISH";

      const severity = bodyData.isSeverityHigh ? "🚨 วิกฤต" : "⚠️ ทั่วไป";
      const formattedTime = bodyData.time || new Date().toLocaleTimeString("th-TH");
      const isoTimestamp = bodyData.timestamp ? new Date(bodyData.timestamp) : new Date();

      await sql`
        INSERT INTO exam_logs (
          log_id, room_id, room_title, student_id, event_type,
          violation_detail, violation_count, severity, formatted_time, iso_timestamp
        ) VALUES (
          ${logId}, ${validRoomId}, ${roomTitle}, ${studentId}, ${eventType},
          ${violation}, ${vCount}, ${severity}, ${formattedTime}, ${isoTimestamp}
        );
      `;

      return res.status(200).json({ status: "success", message: "บันทึกข้อมูลเรียบร้อยแล้ว" });
    }

    if (action === "getLogs") {
      const rows = await sql`
        SELECT log_id, room_id, room_title, student_id, event_type,
               violation_detail, violation_count, severity, formatted_time, iso_timestamp
        FROM exam_logs
        ORDER BY iso_timestamp DESC
        LIMIT 200;
      `;

      const logs = rows.map((r) => ({
        logId: r.log_id,
        roomId: r.room_id || "",
        roomTitle: r.room_title || "",
        studentId: r.student_id,
        eventType: r.event_type,
        violation: r.violation_detail,
        violationCount: Number(r.violation_count || 0),
        severity: r.severity,
        time: r.formatted_time || "",
        timestamp: r.iso_timestamp ? new Date(r.iso_timestamp).toISOString() : ""
      })).reverse();

      return res.status(200).json({ status: "success", data: logs });
    }

    return res.status(200).json({
      status: "error",
      message: `Action '${action}' is not recognized.`
    });

  } catch (err) {
    console.error("API handler error:", err);
    return res.status(500).json({
      status: "error",
      message: "Database query failed: " + err.message
    });
  }
};
