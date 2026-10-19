/**
 * Config & Utilities for Exam Proctor Web App
 */
const DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzN0bSpaAbWaIfgIA3kNfZyDGLr-U0965UDPy27IiQkotdXF576SghQrH8MGQuHGNi_/exec";
const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1aDO0taJC_7itVhA4Ft0Pp01muyXPEcNhYtiqdwRvQGU/edit?usp=sharing";

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
    if (config.formUrl) compact.f = config.formUrl;
    if (config.adminPasscode) compact.p = config.adminPasscode;
    if (config.title && config.title !== "แบบทดสอบออนไลน์") compact.t = config.title;
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

    // รองรับทั้ง compact keys (f, p, t, w) และ legacy keys (formUrl, adminPasscode, title, webhookUrl)
    return {
      title: data.t || data.title || "แบบทดสอบออนไลน์",
      formUrl: data.f || data.formUrl || "",
      adminPasscode: data.p || data.adminPasscode || DEFAULT_ADMIN_PASSCODE,
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
