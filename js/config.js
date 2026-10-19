/**
 * Config & Utilities for Exam Proctor Web App
 */
const DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzN0bSpaAbWaIfgIA3kNfZyDGLr-U0965UDPy27IiQkotdXF576SghQrH8MGQuHGNi_/exec";
const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1aDO0taJC_7itVhA4Ft0Pp01muyXPEcNhYtiqdwRvQGU/edit?usp=sharing";
const DEFAULT_ADMIN_PASSCODE = "1234";

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
 * เข้ารหัสการตั้งค่าห้องสอบเป็น Base64 ปลอดภัย (รองรับภาษาไทย UTF-8)
 */
function encodeExamConfig(config) {
  try {
    const jsonStr = JSON.stringify(config);
    return btoa(encodeURIComponent(jsonStr).replace(/%([0-9A-F]{2})/g, (match, p1) => {
      return String.fromCharCode("0x" + p1);
    }));
  } catch (e) {
    console.error("Encode config error:", e);
    return "";
  }
}

/**
 * ถอดรหัสการตั้งค่าห้องสอบจาก Base64 กลับมาเป็น Object
 */
function decodeExamConfig(base64Str) {
  try {
    if (!base64Str) return null;
    const jsonStr = decodeURIComponent(Array.prototype.map.call(atob(base64Str), (c) => {
      return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(""));
    return JSON.parse(jsonStr);
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
   UX-05: QR Code Generator (Client-side, ไม่ต้องพึ่ง external API)
   ใช้ qrcode-generator library โดย Kazuhiko Arase (MIT License)
   โหลดจาก CDN เมื่อถูกเรียกครั้งแรก
   ========================================================================== */

let _qrLibLoaded = false;
let _qrLibLoading = false;
const _qrLibCallbacks = [];

function _loadQrLib(callback) {
  if (_qrLibLoaded) { callback(); return; }
  _qrLibCallbacks.push(callback);
  if (_qrLibLoading) return;
  _qrLibLoading = true;

  const script = document.createElement("script");
  script.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
  script.onload = () => {
    _qrLibLoaded = true;
    _qrLibCallbacks.forEach((cb) => cb());
    _qrLibCallbacks.length = 0;
  };
  script.onerror = () => {
    // Fallback: ใช้ api.qrserver.com หากโหลด library ล้มเหลว
    _qrLibLoaded = false;
    _qrLibCallbacks.forEach((cb) => cb(true));
    _qrLibCallbacks.length = 0;
  };
  document.head.appendChild(script);
}

/**
 * generateQrCode — สร้าง QR Code ใน element ที่กำหนด
 * @param {HTMLElement} container - element ที่จะแทรก QR Code
 * @param {string} text - ข้อความที่จะ encode
 * @param {number} size - ขนาด pixel (default 200)
 */
function generateQrCode(container, text, size = 200) {
  if (!container || !text) return;
  container.innerHTML = "";

  _loadQrLib((useFallback) => {
    if (!useFallback && typeof QRCode !== "undefined") {
      // ใช้ qrcodejs library
      container.className = (container.className || "") + " qr-canvas-container";
      new QRCode(container, {
        text: text,
        width: size,
        height: size,
        colorDark: "#0f172a",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M
      });
    } else {
      // Fallback: ใช้ img จาก API
      const img = document.createElement("img");
      img.src = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
      img.width = size;
      img.height = size;
      img.alt = "QR Code";
      img.style.borderRadius = "4px";
      container.appendChild(img);
    }
  });
}
