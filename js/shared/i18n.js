/**
 * Internationalization (i18n) Engine for Exam Proctor Studio
 * Supports Thai (th) and English (en) with dynamic language switching
 */

const I18N_DICTIONARY = {
  th: {
    // Navigation
    nav_create: "➕ สร้างห้อง",
    nav_monitor: "🖥️ จอคุมสอบสด",
    nav_rooms: "📁 ห้องสอบ",
    nav_users: "👥 ผู้ใช้งาน",
    nav_settings: "⚙️ ตั้งค่า",
    nav_logout: "🚪 ออกจากระบบ",
    brand_sub: "ระบบบริหารจัดการห้องสอบและคุมสอบออนไลน์",

    // Common Actions
    btn_start_exam: "🚀 เริ่มทำข้อสอบ (เต็มจอ)",
    btn_stop_exam: "🔓 สิ้นสุดการสอบ (ปลดล็อก)",
    btn_print_report: "🖨️ พิมพ์รายงาน PDF",
    btn_export_csv: "📥 ส่งออก CSV",
    btn_test_api: "⚡ ทดสอบ API",
    btn_open_sheet: "📊 เปิด Google Sheets",
    btn_save: "💾 บันทึก",
    btn_cancel: "ยกเลิก",
    btn_confirm: "ยืนยัน",
    btn_close: "ปิดหน้าต่าง",

    // Monitor Tabs & Headers
    tab_live_screens: "🖥️ จอคุมสอบสด",
    tab_completed_archive: "📁 ประวัติผู้ส่งข้อสอบแล้ว",
    tab_table_logs: "📋 บันทึกเหตุการณ์ทั้งหมด",
    tab_analytics: "📊 สถิติ & กราฟวิเคราะห์",

    // Analytics Labels
    analytics_integrity: "ความซื่อสัตย์ของการสอบ (Integrity Rate)",
    analytics_integrity_sub: "ผู้สอบไม่มีประวัติแจ้งเตือนเลย",
    analytics_avg_duration: "เวลาทำข้อสอบเฉลี่ย (Avg Duration)",
    analytics_duration_sub: "จากผู้ส่งข้อสอบทั้งหมด",
    analytics_total_alerts: "สถิติแจ้งเตือนรวม (Total Incidents)",
    analytics_alerts_sub: "เหตุการณ์สลับจอ/หลุดเต็มจอ",
    analytics_submitted: "ผู้สอบส่งแล้ว (Submitted)",
    analytics_timeline_title: "📈 ไทม์ไลน์ความถี่การเกิดเหตุการณ์ผิดปกติ",
    analytics_type_title: "🍩 สัดส่วนประเภทเหตุการณ์ผิดปกติ",

    // Theme & Lang
    theme_light: "โหมดสว่าง",
    theme_dark: "โหมดมืด"
  },
  en: {
    // Navigation
    nav_create: "➕ Create Room",
    nav_monitor: "🖥️ Live Monitor",
    nav_rooms: "📁 Exam Rooms",
    nav_users: "👥 Users",
    nav_settings: "⚙️ Settings",
    nav_logout: "🚪 Logout",
    brand_sub: "Online Examination Management & Integrity Proctoring",

    // Common Actions
    btn_start_exam: "🚀 Start Exam (Fullscreen)",
    btn_stop_exam: "🔓 Unlock / Exit Exam",
    btn_print_report: "🖨️ Print PDF Report",
    btn_export_csv: "📥 Export CSV",
    btn_test_api: "⚡ Test API",
    btn_open_sheet: "📊 Open Google Sheets",
    btn_save: "💾 Save Changes",
    btn_cancel: "Cancel",
    btn_confirm: "Confirm",
    btn_close: "Close",

    // Monitor Tabs & Headers
    tab_live_screens: "🖥️ Live Monitor",
    tab_completed_archive: "📁 Submission Archive",
    tab_table_logs: "📋 All Incident Logs",
    tab_analytics: "📊 Analytics & Charts",

    // Analytics Labels
    analytics_integrity: "Exam Integrity Rate",
    analytics_integrity_sub: "Students with zero incident alerts",
    analytics_avg_duration: "Average Duration",
    analytics_duration_sub: "Calculated across all submissions",
    analytics_total_alerts: "Total Incidents Recorded",
    analytics_alerts_sub: "Window switch / Exit fullscreen events",
    analytics_submitted: "Submitted Examinees",
    analytics_timeline_title: "📈 Incident Frequency Over Time",
    analytics_type_title: "🍩 Incident Categories Breakdown",

    // Theme & Lang
    theme_light: "Light Mode",
    theme_dark: "Dark Mode"
  }
};

let currentLanguage = localStorage.getItem("examLanguage") || "th";

function getTranslation(key, fallback = "") {
  const dict = I18N_DICTIONARY[currentLanguage] || I18N_DICTIONARY.th;
  return dict[key] || fallback || key;
}

function setLanguage(lang) {
  if (lang !== "th" && lang !== "en") lang = "th";
  currentLanguage = lang;
  localStorage.setItem("examLanguage", lang);
  applyTranslations();
  updateLangButtonUI();
}

function toggleLanguage() {
  setLanguage(currentLanguage === "th" ? "en" : "th");
}

function applyTranslations() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    const key = el.getAttribute("data-i18n");
    const translation = getTranslation(key);
    if (translation) {
      if (el.tagName === "INPUT" && el.getAttribute("placeholder")) {
        el.setAttribute("placeholder", translation);
      } else {
        el.textContent = translation;
      }
    }
  });
}

function updateLangButtonUI() {
  const btn = document.getElementById("toggleLangBtn");
  if (btn) {
    btn.innerHTML = currentLanguage === "th" ? "🇹🇭 TH" : "🇬🇧 EN";
    btn.title = currentLanguage === "th" ? "คลิกเพื่อเปลี่ยนเป็นภาษาอังกฤษ (Switch to English)" : "Click to switch to Thai (สลับเป็นภาษาไทย)";
  }
}

// Auto init on DOMContentLoaded
document.addEventListener("DOMContentLoaded", () => {
  applyTranslations();
  updateLangButtonUI();
});
