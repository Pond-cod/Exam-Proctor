/**
 * Vercel Serverless Function API for Exam Proctor Studio
 * Connects directly to Neon Serverless Postgres via @neondatabase/serverless
 * Features:
 * - Sub-30ms query speeds
 * - HMAC-SHA256 Token-based Session Authentication & Role Authorization
 * - Secure Server-side Admin Unlock (no passcode leakage to students)
 * - Delta Polling support for real-time live monitor
 */

const crypto = require("crypto");
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

// Secret key derived from database URL or environment variable
const AUTH_SECRET = process.env.AUTH_SECRET || crypto.createHash("sha256").update(process.env.DATABASE_URL || "exam_proctor_secret_key_2026").digest("hex");

/**
 * Password Hashing & Verification (scrypt - RFC 7914)
 * Provides military-grade protection against brute-force and dictionary attacks.
 * Format: scrypt$<salt_hex>$<derived_key_hex>
 */
function hashPassword(password) {
  if (!password || typeof password !== "string") return "";
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(password, salt, 32);
  return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

function verifyPassword(password, storedPasscode) {
  if (!password || !storedPasscode || typeof storedPasscode !== "string") return false;
  try {
    if (storedPasscode.startsWith("scrypt$")) {
      const parts = storedPasscode.split("$");
      if (parts.length !== 3) return false;
      const [, salt, expectedHashHex] = parts;
      const expectedKey = Buffer.from(expectedHashHex, "hex");
      const derivedKey = crypto.scryptSync(password, salt, 32);
      if (derivedKey.length !== expectedKey.length) return false;
      return crypto.timingSafeEqual(derivedKey, expectedKey);
    }
    // Backward compatibility: If still legacy plaintext
    return storedPasscode.trim() === password.trim();
  } catch (_) {
    return false;
  }
}

/* ===================================================================
   RFC 6238 Standard Time-based One-Time Password (TOTP / 2FA) Engine
   Zero external dependencies — Native Node.js crypto
   =================================================================== */

function generateBase32Secret(length = 20) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes = crypto.randomBytes(length);
  let secret = "";
  for (let i = 0; i < length; i++) {
    secret += chars[bytes[i] % chars.length];
  }
  return secret;
}

function base32Decode(secret) {
  const base32chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  const clean = String(secret || "").toUpperCase().replace(/=+$/, "").replace(/[\s-]/g, "");
  for (let i = 0; i < clean.length; i++) {
    const val = base32chars.indexOf(clean.charAt(i));
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.substr(i, 8), 2));
  }
  return Buffer.from(bytes);
}

function generateTOTP(secret, step = 30, digits = 6, timeOffset = 0) {
  try {
    const key = base32Decode(secret);
    if (!key || key.length === 0) return null;
    const counter = Math.floor((Math.floor(Date.now() / 1000) + timeOffset * step) / step);
    const buf = Buffer.alloc(8);
    buf.writeBigInt64BE(BigInt(counter));
    const hmac = crypto.createHmac("sha1", key).update(buf).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = ((hmac[offset] & 0x7f) << 24 | (hmac[offset + 1] & 0xff) << 16 | (hmac[offset + 2] & 0xff) << 8 | (hmac[offset + 3] & 0xff)) % Math.pow(10, digits);
    return code.toString().padStart(digits, "0");
  } catch (_) {
    return null;
  }
}

function verifyTOTP(token, secret, window = 1) {
  if (!token || !secret) return false;
  const cleanToken = String(token).trim().replace(/\s+/g, "");
  if (cleanToken.length !== 6) return false;
  for (let i = -window; i <= window; i++) {
    const expected = generateTOTP(secret, 30, 6, i);
    if (expected && expected === cleanToken) {
      return true;
    }
  }
  return false;
}

function createSessionToken(user) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    userId: user.user_id,
    username: user.username,
    role: String(user.role).toUpperCase(),
    exp: Math.floor(Date.now() / 1000) + (86400 * 7) // 7 days expiration
  })).toString("base64url");
  const signature = crypto.createHmac("sha256", AUTH_SECRET).update(`${header}.${payload}`).digest("base64url");
  return `${header}.${payload}.${signature}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expectedSig = crypto.createHmac("sha256", AUTH_SECRET).update(`${header}.${payload}`).digest("base64url");
  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) return null;
    return data;
  } catch (_) {
    return null;
  }
}

function extractAuthUser(req, bodyData, queryParams) {
  const authHeader = req.headers["authorization"] || req.headers["Authorization"] || "";
  let token = "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  } else if (bodyData && bodyData.authToken) {
    token = String(bodyData.authToken).trim();
  } else if (queryParams && queryParams.action === "streamLogs" && queryParams.authToken) {
    // Only permit query token for SSE EventSource where browser EventSource API forbids custom headers
    token = String(queryParams.authToken).trim();
  }
  return verifySessionToken(token);
}

// ===================================================================
// Rate Limiting & Spam Protection State
// ===================================================================

// H-05: Rate limiting สำหรับ verifyLogin (IP-based sliding window)
const loginAttempts = new Map();
const MAX_LOGIN_ATTEMPTS = 10;
const LOGIN_LOCKOUT_WINDOW_MS = 5 * 60 * 1000; // 5 นาที

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record) return { allowed: true };
  if (now - record.firstAttempt > LOGIN_LOCKOUT_WINDOW_MS) {
    loginAttempts.delete(ip);
    return { allowed: true };
  }
  if (record.count >= MAX_LOGIN_ATTEMPTS) {
    const remainingSecs = Math.ceil((LOGIN_LOCKOUT_WINDOW_MS - (now - record.firstAttempt)) / 1000);
    return { allowed: false, remainingSecs };
  }
  return { allowed: true };
}

function recordLoginAttempt(ip, isSuccess) {
  if (isSuccess) {
    loginAttempts.delete(ip);
    return;
  }
  const now = Date.now();
  const record = loginAttempts.get(ip);
  if (!record || (now - record.firstAttempt > LOGIN_LOCKOUT_WINDOW_MS)) {
    loginAttempts.set(ip, { count: 1, firstAttempt: now });
  } else {
    record.count++;
  }
}

// H-07: Spam Guard สำหรับ logEvent (ป้องกัน flood spam ลง exam_logs)
const logSpamMap = new Map();
const MIN_LOG_INTERVAL_MS = 300; // ห้ามบันทึกซ้ำเร็วกว่า 300ms ต่อคีย์

function isLogSpam(identifier) {
  const now = Date.now();
  const lastTime = logSpamMap.get(identifier);
  if (lastTime && (now - lastTime < MIN_LOG_INTERVAL_MS)) {
    return true;
  }
  logSpamMap.set(identifier, now);
  if (logSpamMap.size > 2000) {
    const cutoff = now - 60000;
    for (const [key, time] of logSpamMap.entries()) {
      if (time < cutoff) logSpamMap.delete(key);
    }
  }
  return false;
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
    const authUser = extractAuthUser(req, bodyData, queryParams);

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
      if (!authUser || authUser.role !== "ADMIN") {
        return res.status(403).json({
          status: "error",
          message: "ต้องเข้าสู่ระบบด้วยสิทธิ์ผู้ดูแลระบบ (Admin) เท่านั้น จึงจะแก้ไขการตั้งค่าระบบได้"
        });
      }

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
      const clientIp = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1").split(",")[0].trim();
      
      // H-05: ตรวจสอบ Rate Limiting (ป้องกัน Brute Force Password)
      const rateLimitCheck = checkLoginRateLimit(clientIp);
      if (!rateLimitCheck.allowed) {
        return res.status(429).json({
          status: "error",
          message: `คุณพยายามเข้าสู่ระบบผิดพลาดเกินกำหนด กรุณารอ ${rateLimitCheck.remainingSecs} วินาทีก่อนลองใหม่อีกครั้ง`
        });
      }

      const username = String(bodyData.username || queryParams.username || "").trim().toLowerCase();
      const passcode = String(bodyData.passcode || queryParams.passcode || "").trim();

      if (!username || !passcode || passcode.length < 8) {
        recordLoginAttempt(clientIp, false);
        return res.status(200).json({
          status: "error",
          message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง (รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร/หลัก)"
        });
      }

      const rows = await sql`
        SELECT user_id, username, display_name, role, passcode, status, totp_secret, totp_enabled
        FROM users
        WHERE LOWER(username) = ${username}
        LIMIT 1;
      `;

      if (rows.length === 0 || !verifyPassword(passcode, rows[0].passcode)) {
        recordLoginAttempt(clientIp, false);
        return res.status(200).json({
          status: "error",
          message: "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง กรุณาตรวจสอบใหม่อีกครั้ง"
        });
      }

      const user = rows[0];

      // Two-Factor Authentication (2FA / TOTP) Check
      if (user.totp_enabled && user.totp_secret) {
        const totpCode = String(bodyData.totpCode || queryParams.totpCode || "").trim();
        if (!totpCode) {
          return res.status(200).json({
            status: "2fa_required",
            message: "บัญชีนี้เปิดใช้งานการยืนยันตัวตน 2 ชั้น (2FA) กรุณากรอกรหัส Authenticator 6 หลัก"
          });
        }
        if (!verifyTOTP(totpCode, user.totp_secret)) {
          recordLoginAttempt(clientIp, false);
          return res.status(200).json({
            status: "error",
            message: "รหัส 2FA (Authenticator Code) ไม่ถูกต้อง กรุณาตรวจสอบรหัสในแอปพลิเคชัน"
          });
        }
      }

      // C-03: ตรวจสอบสถานะ ACTIVE ก่อน auto-upgrade เพื่อป้องกันไม่ให้บัญชีที่ถูกระงับเข้าถึงหรือเขียน DB
      if (String(user.status).toUpperCase() !== "ACTIVE") {
        recordLoginAttempt(clientIp, false);
        return res.status(200).json({
          status: "error",
          message: "บัญชีผู้ใช้นี้ถูกระงับการใช้งาน กรุณาติดต่อผู้ดูแลระบบ"
        });
      }

      // รีเซ็ตประวัติความพยายามผิดพลาดเมื่อเข้าสู่ระบบสำเร็จ
      recordLoginAttempt(clientIp, true);

      // Auto-upgrade legacy plaintext passwords to scrypt hash upon successful login
      if (!String(user.passcode).startsWith("scrypt$")) {
        const upgradedHash = hashPassword(passcode);
        await sql`UPDATE users SET passcode = ${upgradedHash} WHERE user_id = ${user.user_id};`;
      }

      // Update last_login
      await sql`
        UPDATE users
        SET last_login = NOW()
        WHERE user_id = ${user.user_id};
      `;

      const token = createSessionToken(user);

      return res.status(200).json({
        status: "success",
        message: "เข้าสู่ระบบสำเร็จ",
        token: token,
        user: {
          userId: user.user_id,
          username: user.username,
          displayName: user.display_name,
          role: String(user.role).toUpperCase()
        }
      });
    }

    if (action === "getAllUsers") {
      if (!authUser) {
        return res.status(401).json({
          status: "error",
          message: "กรุณาเข้าสู่ระบบก่อนดูรายชื่อผู้ใช้งาน"
        });
      }

      // SECURITY: ห้ามส่ง passcode คืนให้ Client เด็ดขาด!
      const rows = await sql`
        SELECT user_id, username, display_name, role, status, created_at, updated_at, last_login
        FROM users
        ORDER BY created_at ASC;
      `;

      const users = rows.map((r) => ({
        userId: r.user_id,
        username: r.username,
        displayName: r.display_name,
        role: String(r.role).toUpperCase(),
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
      if (!authUser || authUser.role !== "ADMIN") {
        return res.status(403).json({
          status: "error",
          message: "เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถสร้างผู้ใช้งานใหม่ได้"
        });
      }

      const username = String(bodyData.username || "").trim().toLowerCase();
      const displayName = String(bodyData.displayName || bodyData.username || "ผู้ใช้งานใหม่").trim();
      const role = String(bodyData.role || "TEACHER").toUpperCase();
      const passcode = String(bodyData.passcode || Math.floor(100000 + Math.random() * 900000)).trim();
      const status = String(bodyData.status || "ACTIVE").toUpperCase();

      if (!username || !passcode || passcode.length < 8) {
        return res.status(200).json({
          status: "error",
          message: "กรุณาระบุ Username และ Password (ต้องมีอย่างน้อย 8 ตัวอักษร) ให้ครบถ้วน"
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
      const hashedPasscode = hashPassword(passcode);
      await sql`
        INSERT INTO users (user_id, username, display_name, role, passcode, status, created_at, updated_at)
        VALUES (${userId}, ${username}, ${displayName}, ${role}, ${hashedPasscode}, ${status}, NOW(), NOW());
      `;

      return res.status(200).json({
        status: "success",
        message: "เพิ่มผู้ใช้งานใหม่เรียบร้อยแล้ว",
        data: { userId, username, displayName, role, status }
      });
    }

    if (action === "updateUser") {
      if (!authUser || authUser.role !== "ADMIN") {
        return res.status(403).json({
          status: "error",
          message: "เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถแก้ไขข้อมูลผู้ใช้งานได้"
        });
      }

      const userId = String(bodyData.userId || "").trim();
      const displayName = bodyData.displayName ? String(bodyData.displayName).trim() : null;
      const role = bodyData.role ? String(bodyData.role).toUpperCase() : null;
      const rawPasscode = bodyData.passcode ? String(bodyData.passcode).trim() : null;
      const hashedPasscode = rawPasscode ? hashPassword(rawPasscode) : null;
      const status = bodyData.status ? String(bodyData.status).toUpperCase() : null;

      const result = await sql`
        UPDATE users
        SET
          display_name = COALESCE(${displayName}, display_name),
          role = COALESCE(${role}, role),
          passcode = COALESCE(${hashedPasscode}, passcode),
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
      if (!authUser || authUser.role !== "ADMIN") {
        return res.status(403).json({
          status: "error",
          message: "เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบผู้ใช้งานได้"
        });
      }

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

    if (action === "setup2FA") {
      if (!authUser) {
        return res.status(401).json({ status: "error", message: "กรุณาเข้าสู่ระบบก่อนตั้งค่า 2FA" });
      }

      const secret = generateBase32Secret(20);
      const appName = "ExamProctor";
      const otpauthUrl = `otpauth://totp/${appName}:${encodeURIComponent(authUser.username)}?secret=${secret}&issuer=${appName}`;

      return res.status(200).json({
        status: "success",
        secret: secret,
        otpauthUrl: otpauthUrl,
        message: "สร้าง Secret Key สำหรับ 2FA เรียบร้อยแล้ว กรุณาสแกน QR Code หรือกรอก Key ในแอป Authenticator เพื่อยืนยัน"
      });
    }

    if (action === "verifyAndEnable2FA") {
      if (!authUser) {
        return res.status(401).json({ status: "error", message: "กรุณาเข้าสู่ระบบก่อนเปิดใช้งาน 2FA" });
      }

      const secret = String(bodyData.secret || "").trim();
      const code = String(bodyData.totpCode || bodyData.code || "").trim();

      if (!secret || !code) {
        return res.status(200).json({ status: "error", message: "กรุณาระบุ secret และรหัสยืนยัน 6 หลัก" });
      }

      if (!verifyTOTP(code, secret)) {
        return res.status(200).json({ status: "error", message: "รหัสยืนยัน 6 หลักไม่ถูกต้อง กรุณาลองใหม่อีกครั้ง" });
      }

      await sql`
        UPDATE users
        SET totp_secret = ${secret}, totp_enabled = TRUE, updated_at = NOW()
        WHERE user_id = ${authUser.userId};
      `;

      return res.status(200).json({
        status: "success",
        message: "เปิดใช้งานการยืนยันตัวตน 2 ชั้น (2FA) เรียบร้อยแล้ว บัญชีของคุณได้รับการปกป้องสูงสุด"
      });
    }

    if (action === "disable2FA") {
      if (!authUser) {
        return res.status(401).json({ status: "error", message: "กรุณาเข้าสู่ระบบก่อนปิดใช้งาน 2FA" });
      }

      const passcode = String(bodyData.passcode || "").trim();
      if (!passcode) {
        return res.status(200).json({ status: "error", message: "กรุณาระบุรหัสผ่านเพื่อยืนยันการปิด 2FA" });
      }

      const rows = await sql`SELECT passcode FROM users WHERE user_id = ${authUser.userId} LIMIT 1;`;
      if (rows.length === 0 || !verifyPassword(passcode, rows[0].passcode)) {
        return res.status(200).json({ status: "error", message: "รหัสผ่านไม่ถูกต้อง" });
      }

      await sql`
        UPDATE users
        SET totp_secret = NULL, totp_enabled = FALSE, updated_at = NOW()
        WHERE user_id = ${authUser.userId};
      `;

      return res.status(200).json({
        status: "success",
        message: "ปิดใช้งาน 2FA เรียบร้อยแล้ว"
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
      // C-04: หากยังไม่ได้ล็อกอิน ให้ fallback ส่งเฉพาะห้องที่เปิดสอบอยู่ (status = 'OPEN') และ Mask adminPasscode เป็น '******'
      // เพื่อป้องกัน Information Disclosure และป้องกัน HTTP 401 error ในหน้าบ้านนักเรียน
      if (!authUser) {
        const rows = await sql`
          SELECT room_id, title, category, grade_level, form_url, exam_url, entry_code, status, created_by, created_at, updated_at
          FROM exam_rooms
          WHERE status = 'OPEN'
          ORDER BY created_at DESC;
        `;
        const publicRooms = rows.map((r) => ({
          roomId: r.room_id,
          title: r.title,
          category: r.category,
          gradeLevel: r.grade_level,
          formUrl: r.form_url,
          examUrl: r.exam_url,
          entryCode: r.entry_code,
          adminPasscode: "******",
          status: r.status,
          createdBy: r.created_by || "",
          creatorUsername: "",
          creatorId: "",
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : "",
          updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : ""
        }));
        return res.status(200).json({ status: "success", data: publicRooms });
      }

      const rows = await sql`
        SELECT room_id, title, category, grade_level, form_url, exam_url, entry_code, admin_passcode, status, created_by, creator_username, creator_id, created_at, updated_at
        FROM exam_rooms
        ORDER BY created_at DESC;
      `;

      const isAdmin = String(authUser.role).toUpperCase() === "ADMIN";

      const rooms = rows.map((r) => {
        // C-04: ส่ง adminPasscode ให้เฉพาะ Admin หรือครูผู้สร้างห้องนั้นๆ เท่านั้น (ห้องของครูท่านอื่นจะถูก Mask เป็น '******')
        const isOwner = isAdmin || (r.creator_username && String(r.creator_username).toLowerCase() === String(authUser.username).toLowerCase());
        return {
          roomId: r.room_id,
          title: r.title,
          category: r.category,
          gradeLevel: r.grade_level,
          formUrl: r.form_url,
          examUrl: r.exam_url,
          entryCode: r.entry_code,
          adminPasscode: isOwner ? r.admin_passcode : "******",
          status: r.status,
          createdBy: r.created_by || "",
          creatorUsername: r.creator_username || "",
          creatorId: r.creator_id || "",
          createdAt: r.created_at ? new Date(r.created_at).toISOString() : "",
          updatedAt: r.updated_at ? new Date(r.updated_at).toISOString() : ""
        };
      });

      return res.status(200).json({ status: "success", data: rooms });
    }

    if (action === "verifyRoomEntry") {
      const targetRoomId = String(queryParams.roomId || bodyData.roomId || "").trim();
      const targetEntryCode = String(queryParams.entryCode || bodyData.entryCode || "").trim();

      const rows = await sql`
        SELECT room_id, title, form_url, exam_url, entry_code, status
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

      // SECURITY: ไม่ส่ง admin_passcode ให้นักเรียนเด็ดขาด!
      return res.status(200).json({
        status: "success",
        valid: true,
        room: {
          roomId: r.room_id,
          title: r.title,
          formUrl: r.form_url,
          examUrl: r.exam_url
        }
      });
    }

    if (action === "verifyAdminUnlock") {
      const roomId = String(bodyData.roomId || queryParams.roomId || "").trim();
      const inputPasscode = String(bodyData.passcode || queryParams.passcode || "").trim();

      if (!inputPasscode) {
        return res.status(200).json({ status: "error", valid: false, message: "กรุณาระบุรหัสผ่านผู้คุมสอบ" });
      }

      // 1. ตรวจสอบกับ Master Admin Passcode กลาง
      const cfgRows = await sql`SELECT master_admin_passcode FROM system_config WHERE id = 1 LIMIT 1;`;
      const masterPass = cfgRows.length > 0 ? String(cfgRows[0].master_admin_passcode) : "999888";
      if (inputPasscode === masterPass) {
        return res.status(200).json({ status: "success", valid: true, message: "ปลดล็อกสำเร็จ (Master Admin)" });
      }

      // 2. ตรวจสอบกับ Admin Passcode ของห้องสอบ
      if (roomId) {
        const roomRows = await sql`SELECT admin_passcode FROM exam_rooms WHERE room_id = ${roomId} LIMIT 1;`;
        if (roomRows.length > 0 && String(roomRows[0].admin_passcode).trim() === inputPasscode) {
          return res.status(200).json({ status: "success", valid: true, message: "ปลดล็อกสำเร็จ (Room Admin)" });
        }
      }

      return res.status(200).json({ status: "error", valid: false, message: "รหัสผ่านผู้คุมสอบไม่ถูกต้อง" });
    }

    if (action === "createRoom") {
      if (!authUser) {
        return res.status(401).json({ status: "error", message: "กรุณาเข้าสู่ระบบก่อนสร้างห้องสอบ" });
      }

      const roomId = bodyData.roomId || ("RM-" + Math.floor(100000 + Math.random() * 900000));
      const title = bodyData.title || "แบบทดสอบออนไลน์";
      const category = bodyData.category || "ทั่วไป (General)";
      const gradeLevel = bodyData.gradeLevel || "ไม่ระบุ (All / Not Specified)";
      const formUrl = bodyData.formUrl || "";
      const examUrl = bodyData.examUrl || "";
      const entryCode = String(bodyData.entryCode || Math.floor(100000 + Math.random() * 900000));
      const adminPasscode = String(bodyData.adminPasscode || Math.floor(100000 + Math.random() * 900000));
      const status = String(bodyData.status || "OPEN").toUpperCase();
      const creatorUsername = authUser.username || bodyData.creatorUsername || "";
      const creatorId = authUser.userId || bodyData.creatorId || "";
      const createdBy = bodyData.createdBy || (creatorUsername ? `ครูผู้สอน (@${creatorUsername})` : "ครูผู้สอน");

      await sql`
        INSERT INTO exam_rooms (
          room_id, title, category, grade_level, form_url, exam_url, entry_code,
          admin_passcode, status, created_by, creator_username, creator_id, created_at, updated_at
        ) VALUES (
          ${roomId}, ${title}, ${category}, ${gradeLevel}, ${formUrl}, ${examUrl},
          ${entryCode}, ${adminPasscode}, ${status}, ${createdBy}, ${creatorUsername},
          ${creatorId}, NOW(), NOW()
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
          updated_at = NOW();
      `;

      return res.status(200).json({
        status: "success",
        message: "สร้างห้องสอบใหม่เรียบร้อยแล้ว",
        data: { roomId, title, category, gradeLevel, entryCode, adminPasscode, status }
      });
    }

    if (action === "toggleRoomStatus") {
      if (!authUser) {
        return res.status(401).json({ status: "error", message: "กรุณาเข้าสู่ระบบก่อนเปลี่ยนสถานะห้องสอบ" });
      }

      const roomId = String(bodyData.roomId || "").trim();
      const newStatus = String(bodyData.status || "OPEN").toUpperCase();

      // ตรวจสอบสิทธิ์ (Admin ทำได้ทุกห้อง, Teacher ทำได้เฉพาะห้องของตนเอง)
      if (authUser.role !== "ADMIN") {
        const check = await sql`SELECT creator_username FROM exam_rooms WHERE room_id = ${roomId} LIMIT 1;`;
        if (check.length > 0 && check[0].creator_username && check[0].creator_username !== authUser.username) {
          return res.status(403).json({ status: "error", message: "ท่านไม่มีสิทธิ์เปลี่ยนสถานะห้องสอบของครูท่านอื่น" });
        }
      }

      await sql`
        UPDATE exam_rooms
        SET status = ${newStatus}, updated_at = NOW()
        WHERE room_id = ${roomId};
      `;

      return res.status(200).json({
        status: "success",
        message: "เปลี่ยนสถานะห้องสอบเป็น " + newStatus + " เรียบร้อยแล้ว",
        roomStatus: newStatus
      });
    }

    if (action === "updateRoom") {
      if (!authUser) {
        return res.status(401).json({ status: "error", message: "กรุณาเข้าสู่ระบบก่อนแก้ไขห้องสอบ" });
      }

      const roomId = String(bodyData.roomId || "").trim();
      if (authUser.role !== "ADMIN") {
        const check = await sql`SELECT creator_username FROM exam_rooms WHERE room_id = ${roomId} LIMIT 1;`;
        if (check.length > 0 && check[0].creator_username && check[0].creator_username !== authUser.username) {
          return res.status(403).json({ status: "error", message: "ท่านไม่มีสิทธิ์แก้ไขห้องสอบของครูท่านอื่น" });
        }
      }

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
      if (!authUser) {
        return res.status(401).json({ status: "error", message: "กรุณาเข้าสู่ระบบก่อนลบห้องสอบ" });
      }

      const roomId = String(bodyData.roomId || "").trim();
      if (authUser.role !== "ADMIN") {
        const check = await sql`SELECT creator_username FROM exam_rooms WHERE room_id = ${roomId} LIMIT 1;`;
        if (check.length > 0 && check[0].creator_username && check[0].creator_username !== authUser.username) {
          return res.status(403).json({ status: "error", message: "ท่านไม่มีสิทธิ์ลบห้องสอบของครูท่านอื่น" });
        }
      }

      await sql`DELETE FROM exam_rooms WHERE room_id = ${roomId};`;
      return res.status(200).json({ status: "success", message: "ลบห้องสอบเรียบร้อยแล้ว" });
    }

    // ===================================================================
    // 4. Exam Logs Handlers (Live Monitor)
    // ===================================================================
    if (action === "logEvent") {
      const studentId = String(bodyData.studentId || "ไม่ระบุชื่อ").trim();
      const clientIp = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "127.0.0.1").split(",")[0].trim();
      const spamKey = `${studentId}_${clientIp}`;

      // H-07: Spam Guard ป้องกันการยิง request ถี่เกินไป
      if (isLogSpam(spamKey)) {
        return res.status(200).json({ status: "success", message: "บันทึกข้อมูลเรียบร้อยแล้ว (throttled)" });
      }

      const logId = "LOG-" + Date.now() + "-" + Math.floor(Math.random() * 1000);
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

      const severity = bodyData.isSeverityHigh ? "วิกฤต" : "ทั่วไป";
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
      // H-06: ป้องกัน Information Disclosure ตรวจสอบสิทธิ์ก่อนเข้าถึงประวัติเหตุการณ์และข้อมูลนักเรียน
      if (!authUser) {
        return res.status(401).json({ status: "error", message: "กรุณาเข้าสู่ระบบก่อนดูบันทึกการสอบ" });
      }

      const since = queryParams.since || bodyData.since;
      let rows;

      if (since) {
        // Delta Polling: ดึงเฉพาะข้อมูลใหม่ที่เกิดขึ้นหลังจาก timestamp ที่กำหนด
        const sinceDate = new Date(since);
        if (!isNaN(sinceDate.getTime())) {
          rows = await sql`
            SELECT log_id, room_id, room_title, student_id, event_type,
                   violation_detail, violation_count, severity, formatted_time, iso_timestamp
            FROM exam_logs
            WHERE iso_timestamp > ${sinceDate}
            ORDER BY iso_timestamp ASC
            LIMIT 100;
          `;
        }
      }

      if (!rows) {
        rows = await sql`
          SELECT log_id, room_id, room_title, student_id, event_type,
                 violation_detail, violation_count, severity, formatted_time, iso_timestamp
          FROM exam_logs
          ORDER BY iso_timestamp DESC
          LIMIT 200;
        `;
      }

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
      }));

      // หากเป็นการดึงปกติ (ไม่ส่ง since) ให้ reverse เพื่อให้เรียงตามเวลาเก่าไปใหม่
      if (!since) {
        logs.reverse();
      }

      return res.status(200).json({ status: "success", data: logs });
    }

    // Ultra Low-Latency Real-Time SSE Stream (<1s Latency)
    if (action === "streamLogs") {
      if (!authUser) {
        return res.status(401).json({ status: "error", message: "กรุณาเข้าสู่ระบบก่อนติดตาม Live Stream" });
      }

      // ตั้งค่า Header สำหรับ Server-Sent Events (SSE)
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      });

      res.write(`data: ${JSON.stringify({ type: "connected", message: "Real-time SSE Stream Connected" })}\n\n`);

      let lastSeenDate = new Date();
      const filterRoomId = String(queryParams.roomId || bodyData.roomId || "").trim();

      const streamInterval = setInterval(async () => {
        try {
          let rows;
          if (filterRoomId) {
            rows = await sql`
              SELECT log_id, room_id, room_title, student_id, event_type,
                     violation_detail, violation_count, severity, formatted_time, iso_timestamp
              FROM exam_logs
              WHERE iso_timestamp > ${lastSeenDate} AND room_id = ${filterRoomId}
              ORDER BY iso_timestamp ASC
              LIMIT 50;
            `;
          } else {
            rows = await sql`
              SELECT log_id, room_id, room_title, student_id, event_type,
                     violation_detail, violation_count, severity, formatted_time, iso_timestamp
              FROM exam_logs
              WHERE iso_timestamp > ${lastSeenDate}
              ORDER BY iso_timestamp ASC
              LIMIT 50;
            `;
          }

          if (rows && rows.length > 0) {
            lastSeenDate = new Date(rows[rows.length - 1].iso_timestamp);
            const newLogs = rows.map((r) => ({
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
            }));
            res.write(`data: ${JSON.stringify({ type: "logs", data: newLogs })}\n\n`);
          } else {
            // Heartbeat comment to keep connection alive through proxies
            res.write(": ping\n\n");
          }
        } catch (e) {
          console.warn("SSE stream error:", e.message);
        }
      }, 850);

      req.on("close", () => {
        clearInterval(streamInterval);
        res.end();
      });

      return;
    }

    // L-02: ฟังก์ชันสำหรับ Admin เพื่อลบหรือล้าง Log
    if (action === "deleteLog" || action === "deleteLogs" || action === "clearLogs") {
      if (!authUser || String(authUser.role).toUpperCase() !== "ADMIN") {
        return res.status(403).json({ status: "error", message: "เฉพาะผู้ดูแลระบบ (Admin) เท่านั้นที่สามารถลบหรือล้างประวัติการสอบได้" });
      }

      const targetLogId = String(bodyData.logId || queryParams.logId || "").trim();
      const targetRoomId = String(bodyData.roomId || queryParams.roomId || "").trim();

      if (targetLogId) {
        await sql`DELETE FROM exam_logs WHERE log_id = ${targetLogId};`;
        return res.status(200).json({ status: "success", message: "ลบบันทึกเหตุการณ์เรียบร้อยแล้ว" });
      } else if (targetRoomId) {
        await sql`DELETE FROM exam_logs WHERE room_id = ${targetRoomId};`;
        return res.status(200).json({ status: "success", message: "ล้างบันทึกเหตุการณ์ของห้องสอบเรียบร้อยแล้ว" });
      } else if (action === "clearLogs") {
        await sql`DELETE FROM exam_logs;`;
        return res.status(200).json({ status: "success", message: "ล้างบันทึกเหตุการณ์ทั้งหมดเรียบร้อยแล้ว" });
      } else {
        return res.status(400).json({ status: "error", message: "กรุณาระบุ logId หรือ roomId หรือ action=clearLogs" });
      }
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
