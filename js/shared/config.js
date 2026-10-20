/**
 * Config & Utilities for Exam Proctor Web App
 */
const NEON_API_URL = "https://examproctor-jade.vercel.app/api";
const DEFAULT_WEBHOOK_URL = "https://examproctor-jade.vercel.app/api";
const FALLBACK_GAS_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzN0bSpaAbWaIfgIA3kNfZyDGLr-U0965UDPy27IiQkotdXF576SghQrH8MGQuHGNi_/exec";
const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1aDO0taJC_7itVhA4Ft0Pp01muyXPEcNhYtiqdwRvQGU/edit?usp=sharing";

/**
 * ดึง Webhook URL ปัจจุบัน (รองรับ Neon Serverless Postgres API บน Vercel หรือใช้ค่า Custom ใน Settings)
 */
function getEffectiveWebhookUrl() {
  try {
    const custom = localStorage.getItem("examCustomWebhookUrl");
    if (custom && custom.trim()) return custom.trim();

    // หากรันอยู่บนโดเมน Vercel ให้ใช้ /api แบบ relative ทันทีเพื่อความเร็วสูงสุด (<30ms)
    if (typeof window !== "undefined" && window.location && window.location.hostname && window.location.hostname.includes("vercel.app")) {
      return `${window.location.origin}/api`;
    }

    return DEFAULT_WEBHOOK_URL;
  } catch (_) {
    return DEFAULT_WEBHOOK_URL;
  }
}

/**
 * fetchWithTimeout — Wrapper สำหรับ fetch พร้อมระบบตัดรอบเวลา (Timeout Guard)
 * ป้องกันปัญหาระบบหมุนค้างจาก Google Apps Script Cold Start หรือเน็ตกระตุก
 * @param {string|Request} resource
 * @param {object} options
 * @param {number} timeoutMs - มิลลิวินาที (ค่าเริ่มต้น 4000ms)
 * @returns {Promise<Response>}
 */
async function fetchWithTimeout(resource, options = {}, timeoutMs = 4000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(resource, {
      ...options,
      signal: options.signal || controller.signal
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Helper ป้องกัน XSS และแปลงข้อความสำหรับแสดงผลใน HTML
 */
function escapeHtml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

/**
 * สุ่มรหัสผ่านตัวเลข 6 หลัก (100000 - 999999) เสมอ
 */
function generateRandomPasscode() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

const DEFAULT_ADMIN_PASSCODE = generateRandomPasscode();

/**
 * นิยาม Role สิทธิ์การใช้งานระบบ (Uppercase Standardized)
 */
const USER_ROLES = {
  ADMIN: "ADMIN",     // ผู้ดูแลระบบ (จัดการห้องสอบทั้งหมด, ลบ, แก้ไข, จัดการผู้ใช้, ตั้งค่า Webhook/Google Sheets, รีเซ็ตจอสด)
  TEACHER: "TEACHER", // ครูผู้คุมสอบ (สร้างห้องสอบใหม่, เปิด/ปิดรับนักเรียน, ดูหน้าจอคุมสอบสด)
  USER: "TEACHER"     // Alias เพื่อรองรับโค้ดเดิม
};

/**
 * รหัสผ่านกลางสำหรับ Role Admin (ค่าเริ่มต้น 999888)
 */
const MASTER_ADMIN_PASSCODE = "999888";

/**
 * หมวดหมู่วิชา (Subject Categories)
 */
const SUBJECT_CATEGORIES = [
  "ทั่วไป (General)",
  "คณิตศาสตร์ (Mathematics)",
  "วิทยาศาสตร์และเทคโนโลยี (Science & Tech)",
  "ภาษาไทย (Thai Language)",
  "ภาษาต่างประเทศ (Foreign Languages)",
  "สังคมศึกษา ศาสนา และวัฒนธรรม (Social Studies)",
  "สุขศึกษาและพลศึกษา (Health & PE)",
  "ศิลปะและดนตรี (Arts & Music)",
  "การงานอาชีพ (Career & Technology)",
  "อื่นๆ (Other)"
];

/**
 * ระดับชั้นการศึกษา (Grade Levels)
 */
const GRADE_LEVELS = [
  "ไม่ระบุ (All / Not Specified)",
  "ประถมศึกษาปีที่ 1-3 (Grade 1-3)",
  "ประถมศึกษาปีที่ 4-6 (Grade 4-6)",
  "มัธยมศึกษาปีที่ 1 (Grade 7)",
  "มัธยมศึกษาปีที่ 2 (Grade 8)",
  "มัธยมศึกษาปีที่ 3 (Grade 9)",
  "มัธยมศึกษาปีที่ 4 (Grade 10)",
  "มัธยมศึกษาปีที่ 5 (Grade 11)",
  "มัธยมศึกษาปีที่ 6 (Grade 12)",
  "ปวช. / ปวส. (Vocational)",
  "อุดมศึกษา / บุคคลทั่วไป (University / Adult)"
];

/**
 * สุ่มรหัสเข้าห้องสอบสำหรับนักเรียน 6 หลัก
 */
function generateEntryCode() {
  return generateRandomPasscode();
}

/**
 * ปรับแต่งและแปลง URL ของ Google Forms ให้พร้อมสำหรับการ Embed ใน Iframe
 */
function formatGoogleFormEmbedUrl(url) {
  if (!url) return "";
  let cleanUrl = url.trim();

  if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
    cleanUrl = "https://" + cleanUrl;
  }

  if (cleanUrl.includes("/edit")) {
    cleanUrl = cleanUrl.replace(/\/edit.*$/, "/viewform");
  }

  if (cleanUrl.includes("docs.google.com/forms")) {
    const urlObj = new URL(cleanUrl);
    urlObj.searchParams.set("embedded", "true");
    return urlObj.toString();
  }

  return cleanUrl;
}

/**
 * เข้ารหัสการตั้งค่าห้องสอบเป็น Base64 แบบกะทัดรัดและปลอดภัยใน URL (URL-Safe Base64)
 * ลดขนาดข้อมูลลงกว่า 70% เพื่อให้ QR Code มีจุดโมดูลที่ใหญ่ คมชัด และสแกนติดง่ายที่สุด
 */
function encodeExamConfig(config) {
  try {
    // ย่อ keys และละเว้นค่า default เพื่อให้ URL สั้นที่สุดเท่าที่จะเป็นไปได้
    const compact = {};
    if (config.roomId) compact.r = config.roomId;
    if (config.formUrl) compact.f = config.formUrl;
    // SECURITY: ห้ามฝัง adminPasscode ใน URL ของนักเรียนเด็ดขาด (ตรวจสอบผ่าน Server verifyAdminUnlock แทน)
    if (config.entryCode) compact.e = config.entryCode;
    if (config.title && config.title !== "แบบทดสอบออนไลน์") compact.t = config.title;
    if (config.category && config.category !== "ทั่วไป (General)") compact.c = config.category;
    if (config.gradeLevel && config.gradeLevel !== "ไม่ระบุ (All / Not Specified)") compact.g = config.gradeLevel;
    if (config.webhookUrl && config.webhookUrl !== DEFAULT_WEBHOOK_URL) compact.w = config.webhookUrl;

    const jsonStr = JSON.stringify(compact);
    const utf8Bytes = encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (match, p1) => {
      return String.fromCharCode("0x" + p1);
    });
    // แปลงเป็น URL-Safe Base64 (- แทน +, _ แทน /, ตัด padding = ออก)
    return btoa(utf8Bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  } catch (e) {
    console.error("Encode config error:", e);
    return "";
  }
}

/**
 * ถอดรหัสการตั้งค่าห้องสอบจาก Base64 กลับมาเป็น Object
 * รองรับทั้งรูปแบบ Compact ใหม่, รูปแบบเต็มเดิม, และแก้ปัญหา + ถูกแปลงเป็น Space ใน URL
 */
function decodeExamConfig(base64Str) {
  try {
    if (!base64Str) return null;
    let clean = String(base64Str).trim();

    // 1. ถอด URL decoding เผื่อถูก encode ซ้ำ (%2B, %2F, %25)
    try {
      clean = decodeURIComponent(clean);
    } catch (_) {}

    // 2. แก้ปัญหา URLSearchParams แปลงเครื่องหมาย + เป็น Space
    clean = clean.replace(/ /g, "+");

    // 3. แปลง URL-safe base64 กลับเป็น standard base64 (- เป็น +, _ เป็น /)
    clean = clean.replace(/-/g, "+").replace(/_/g, "/");

    // 4. เติม padding = ให้ครบ 4 ตัว
    while (clean.length % 4 !== 0) {
      clean += "=";
    }

    const binaryStr = atob(clean);
    const jsonStr = decodeURIComponent(Array.prototype.map.call(binaryStr, (c) => {
      return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(""));
    const data = JSON.parse(jsonStr);

    // รองรับทั้ง compact keys (r, f, p, e, t, c, g, w) และ legacy keys
    return {
      roomId: data.r || data.roomId || "",
      title: data.t || data.title || "แบบทดสอบออนไลน์",
      formUrl: data.f || data.formUrl || "",
      adminPasscode: data.p || data.adminPasscode || DEFAULT_ADMIN_PASSCODE,
      entryCode: data.e || data.entryCode || "",
      category: data.c || data.category || "ทั่วไป (General)",
      gradeLevel: data.g || data.gradeLevel || "ไม่ระบุ (All / Not Specified)",
      webhookUrl: data.w || data.webhookUrl || DEFAULT_WEBHOOK_URL
    };
  } catch (e) {
    console.error("Decode config error:", e);
    return null;
  }
}

/* ==========================================================================
   UX-02: Custom Dialog System — แทน native alert / confirm / prompt
   ========================================================================== */

/**
 * สร้าง Dialog Overlay element ถ้ายังไม่มีใน DOM
 */
function _getOrCreateDialogEl() {
  let el = document.getElementById("customDialogOverlay");
  if (!el) {
    el = document.createElement("div");
    el.id = "customDialogOverlay";
    el.className = "custom-dialog-overlay";
    el.innerHTML = `
      <div class="custom-dialog-box" id="customDialogBox">
        <div class="custom-dialog-icon" id="customDialogIcon"></div>
        <div class="custom-dialog-title" id="customDialogTitle"></div>
        <div class="custom-dialog-message" id="customDialogMessage"></div>
        <input class="custom-dialog-input" id="customDialogInput" type="text" style="display:none">
        <div class="custom-dialog-actions" id="customDialogActions"></div>
      </div>
    `;
    document.body.appendChild(el);
  }
  return el;
}

/**
 * showDialog — Promise-based custom dialog
 * @param {object} opts - { type, icon, title, message, confirmText, cancelText, inputType, inputPlaceholder }
 * @returns {Promise<string|boolean|null>}
 */
function showDialog(opts) {
  return new Promise((resolve) => {
    const overlay = _getOrCreateDialogEl();
    const iconEl   = document.getElementById("customDialogIcon");
    const titleEl  = document.getElementById("customDialogTitle");
    const msgEl    = document.getElementById("customDialogMessage");
    const inputEl  = document.getElementById("customDialogInput");
    const actionsEl = document.getElementById("customDialogActions");

    // Icon
    const iconMap = { info: "ℹ️", success: "✅", danger: "🚨", warning: "⚠️", question: "❓", lock: "🔒" };
    const colorMap = { info: "icon-info", success: "icon-success", danger: "icon-danger", warning: "icon-warning", question: "icon-info", lock: "icon-info" };
    iconEl.className = `custom-dialog-icon ${colorMap[opts.type] || "icon-info"}`;
    iconEl.textContent = opts.icon || iconMap[opts.type] || "ℹ️";

    titleEl.textContent  = opts.title || "";
    msgEl.textContent    = opts.message || "";
    titleEl.style.display = opts.title ? "" : "none";

    // Input (สำหรับ prompt)
    if (opts.inputType) {
      inputEl.style.display = "";
      inputEl.type = opts.inputType || "text";
      inputEl.placeholder = opts.inputPlaceholder || "";
      inputEl.value = "";
      inputEl.className = "custom-dialog-input" + (opts.inputType === "password" ? " input-password" : "");
    } else {
      inputEl.style.display = "none";
    }

    // Buttons
    actionsEl.innerHTML = "";

    // Cancel button
    if (opts.cancelText !== undefined) {
      const cancelBtn = document.createElement("button");
      cancelBtn.className = "dlg-btn dlg-btn-secondary";
      cancelBtn.textContent = opts.cancelText || "ยกเลิก";
      cancelBtn.onclick = () => { close(); resolve(null); };
      actionsEl.appendChild(cancelBtn);
    }

    // Confirm button
    const confirmBtn = document.createElement("button");
    confirmBtn.className = `dlg-btn dlg-btn-${opts.confirmClass || "primary"}`;
    confirmBtn.textContent = opts.confirmText || "ตกลง";
    confirmBtn.onclick = () => {
      const val = opts.inputType ? inputEl.value : true;
      close();
      resolve(val);
    };
    actionsEl.appendChild(confirmBtn);

    // Enter key support
    const keyHandler = (e) => {
      if (e.key === "Enter") { confirmBtn.click(); }
      if (e.key === "Escape" && opts.cancelText !== undefined) { close(); resolve(null); }
    };
    document.addEventListener("keydown", keyHandler);

    function close() {
      overlay.classList.remove("active");
      document.removeEventListener("keydown", keyHandler);
    }

    // Show
    overlay.classList.add("active");
    if (opts.inputType) { setTimeout(() => inputEl.focus(), 80); }
    else { setTimeout(() => confirmBtn.focus(), 80); }
  });
}

/** showAlert — แทน alert() */
function showAlert(message, opts = {}) {
  return showDialog({
    type: opts.type || "info",
    icon: opts.icon,
    title: opts.title || "",
    message,
    confirmText: opts.confirmText || "ตกลง",
    confirmClass: opts.confirmClass || "primary"
  });
}

/** showConfirm — แทน confirm() — resolves true/null */
function showConfirm(message, opts = {}) {
  return showDialog({
    type: opts.type || "question",
    icon: opts.icon || "❓",
    title: opts.title || "ยืนยันการดำเนินการ",
    message,
    confirmText: opts.confirmText || "ยืนยัน",
    cancelText: opts.cancelText || "ยกเลิก",
    confirmClass: opts.confirmClass || "primary"
  });
}

/** showPrompt — แทน prompt() — resolves string or null */
function showPrompt(message, opts = {}) {
  return showDialog({
    type: opts.type || "lock",
    icon: opts.icon || "🔒",
    title: opts.title || "",
    message,
    inputType: opts.inputType || "text",
    inputPlaceholder: opts.inputPlaceholder || "",
    confirmText: opts.confirmText || "ยืนยัน",
    cancelText: opts.cancelText || "ยกเลิก",
    confirmClass: opts.confirmClass || "primary"
  });
}

/* ==========================================================================
   UX-05: QR Code Generator (Client-side, Offline-first, Zero-dependency)
   ใช้ qrcode.min.js ประมวลผลแบบ Client-side สแกนได้ทันที ไม่ต้องพึ่งพาเน็ต
   ========================================================================== */

let _qrLibLoaded = false;
let _qrLibLoading = false;
const _qrLibCallbacks = [];

function _loadQrLib(callback) {
  if (typeof QRCode !== "undefined") {
    _qrLibLoaded = true;
    callback(false);
    return;
  }
  if (_qrLibLoaded) { callback(false); return; }
  _qrLibCallbacks.push(callback);
  if (_qrLibLoading) return;
  _qrLibLoading = true;

  const tryScript = (src, onFail) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => {
      _qrLibLoaded = true;
      _qrLibCallbacks.forEach((cb) => cb(false));
      _qrLibCallbacks.length = 0;
    };
    s.onerror = onFail;
    document.head.appendChild(s);
  };

  // 1. ลองโหลดจาก local file js/qrcode.min.js ก่อนเสมอ
  tryScript("js/qrcode.min.js", () => {
    // 2. ถ้า local ไม่พบ จึง fallback ไปที่ CDN
    tryScript("https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js", () => {
      _qrLibLoaded = false;
      _qrLibCallbacks.forEach((cb) => cb(true));
      _qrLibCallbacks.length = 0;
    });
  });
}

/**
 * generateQrCode — สร้าง QR Code ใน element ที่กำหนด
 * @param {HTMLElement} container - element ที่จะแทรก QR Code
 * @param {string} text - ข้อความหรือ URL ที่จะ encode
 * @param {number} size - ขนาด pixel (default 220)
 */
function generateQrCode(container, text, size = 220) {
  if (!container || !text) return;
  container.innerHTML = "";

  _loadQrLib((useFallback) => {
    if (!useFallback && typeof QRCode !== "undefined") {
      container.className = (container.className || "").replace(/qr-canvas-container/g, "").trim() + " qr-canvas-container";
      new QRCode(container, {
        text: text,
        width: size,
        height: size,
        colorDark: "#000000",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      // Fallback: ใช้ api.qrserver.com พร้อม quiet zone margin
      const img = document.createElement("img");
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=${encodeURIComponent(text)}`;
      img.width = size;
      img.height = size;
      img.alt = "QR Code";
      img.style.borderRadius = "8px";
      img.style.display = "block";
      container.appendChild(img);
    }
  });
}
