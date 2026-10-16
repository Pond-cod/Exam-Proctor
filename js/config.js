/**
 * Config & Utilities for Exam Proctor Web App
 */
const DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzN0bSpaAbWaIfgIA3kNfZyDGLr-U0965UDPy27IiQkotdXF576SghQrH8MGQuHGNi_/exec";
const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1aDO0taJC_7itVhA4Ft0Pp01muyXPEcNhYtiqdwRvQGU/edit?usp=sharing";
const DEFAULT_ADMIN_PASSCODE = "1234";

/**
 * ปรับแต่งและแปลง URL ของ Google Forms ให้พร้อมสำหรับการ Embed ใน Iframe
 * @param {string} url - URL ของ Google Forms
 * @returns {string} - URL ที่มี ?embedded=true
 */
function formatGoogleFormEmbedUrl(url) {
  if (!url) return "";
  let cleanUrl = url.trim();

  if (!cleanUrl.startsWith("http://") && !cleanUrl.startsWith("https://")) {
    cleanUrl = "https://" + cleanUrl;
  }

  // หากเป็นลิงก์แบบ edit ให้เปลี่ยนเป็น viewform
  if (cleanUrl.includes("/edit")) {
    cleanUrl = cleanUrl.replace(/\/edit.*$/, "/viewform");
  }

  // หากยังไม่มี embedded=true ให้เติมต่อท้าย
  if (cleanUrl.includes("docs.google.com/forms")) {
    const urlObj = new URL(cleanUrl);
    urlObj.searchParams.set("embedded", "true");
    return urlObj.toString();
  }

  return cleanUrl;
}

/**
 * เข้ารหัสการตั้งค่าห้องสอบเป็น Base64 ปลอดภัย (รองรับภาษาไทย UTF-8)
 * @param {object} config - ข้อมูลการตั้งค่าห้องสอบ
 * @returns {string} - Base64 Safe String
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
 * @param {string} base64Str - Base64 Safe String
 * @returns {object|null} - ข้อมูลการตั้งค่าห้องสอบ
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
