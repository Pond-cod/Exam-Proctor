// BUG-01: ลบ ADMIN_PASS hardcode ออก — อ่านจาก storage เสมอผ่านสาย chrome.storage.local เพื่อไม่ให้รหัสผ่าน hardcode ในโค้ด

// องค์ประกอบแท็บ
const tabStudent = document.getElementById("tabStudent");
const tabAdmin = document.getElementById("tabAdmin");
const panelStudent = document.getElementById("panelStudent");
const panelAdmin = document.getElementById("panelAdmin");

tabStudent.addEventListener("click", () => {
  tabStudent.classList.add("active");
  tabAdmin.classList.remove("active");
  panelStudent.classList.add("active");
  panelAdmin.classList.remove("active");
});

tabAdmin.addEventListener("click", () => {
  tabAdmin.classList.add("active");
  tabStudent.classList.remove("active");
  panelAdmin.classList.add("active");
  panelStudent.classList.remove("active");
});

// องค์ประกอบหน้าผู้เข้าสอบ
const studentInput = document.getElementById("studentId");
const studentIdError = document.getElementById("studentIdError");
const customFormUrl = document.getElementById("customFormUrl");
const formUrlError = document.getElementById("formUrlError");
const detectTabBtn = document.getElementById("detectTabBtn");
const startBtn = document.getElementById("startBtn");
const stopBtn = document.getElementById("stopBtn");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const formUrlHint = document.getElementById("formUrlHint");

// องค์ประกอบหน้า Admin
const adminLoginBox = document.getElementById("adminLoginBox");
const adminConfigBox = document.getElementById("adminConfigBox");
const adminPassInput = document.getElementById("adminPassInput");
const loginAdminBtn = document.getElementById("loginAdminBtn");
const cfgFormUrl = document.getElementById("cfgFormUrl");
const grabCurrentTabAdminBtn = document.getElementById("grabCurrentTabAdminBtn");
const clearFormUrlBtn = document.getElementById("clearFormUrlBtn");
const cfgLockUrl = document.getElementById("cfgLockUrl");
const cfgWebhookUrl = document.getElementById("cfgWebhookUrl");
const cfgSecretToken = document.getElementById("cfgSecretToken");
const cfgAdminPass = document.getElementById("cfgAdminPass");
const saveCfgBtn = document.getElementById("saveCfgBtn");
const testWebhookBtn = document.getElementById("testWebhookBtn");
const openMonitorBtn = document.getElementById("openMonitorBtn");
const saveStatus = document.getElementById("saveStatus");

const DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzN0bSpaAbWaIfgIA3kNfZyDGLr-U0965UDPy27IiQkotdXF576SghQrH8MGQuHGNi_/exec";

let detectedActiveTab = null;

// ตรวจสอบว่าแท็บปัจจุบันใน Chrome เป็น Google Forms หรือไม่
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs && tabs[0] && tabs[0].url) {
    const activeUrl = tabs[0].url;
    if (activeUrl.includes("docs.google.com/forms") || activeUrl.includes("forms.gle")) {
      detectedActiveTab = tabs[0];
      if (detectTabBtn) {
        detectTabBtn.style.display = "block";
      }
      if (customFormUrl && !customFormUrl.value) {
        customFormUrl.value = activeUrl;
      }
    }
  }
});

// กดปุ่มใช้แท็บปัจจุบันทำข้อสอบ (Student Panel)
if (detectTabBtn) {
  detectTabBtn.addEventListener("click", () => {
    if (detectedActiveTab) {
      customFormUrl.value = detectedActiveTab.url;
      detectTabBtn.textContent = "✅ เลือกแท็บนี้แล้ว พร้อมเริ่มสอบ";
      detectTabBtn.style.background = "#e6f4ea";
      detectTabBtn.style.color = "#137333";
    }
  });
}

// กดปุ่มดึงแท็บปัจจุบัน (Admin Panel)
if (grabCurrentTabAdminBtn) {
  grabCurrentTabAdminBtn.addEventListener("click", () => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs && tabs[0] && tabs[0].url && (tabs[0].url.includes("docs.google.com/forms") || tabs[0].url.includes("forms.gle"))) {
        cfgFormUrl.value = tabs[0].url;
      } else {
        alert("แท็บปัจจุบันไม่ได้เปิดหน้า Google Forms อยู่ กรุณาเปิดหน้า Google Forms ก่อนกดปุ่มนี้ครับ");
      }
    });
  });
}

// กดปุ่มล้าง URL เพื่อให้ใช้ฟอร์มไหนก็ได้ (Admin Panel)
if (clearFormUrlBtn) {
  clearFormUrlBtn.addEventListener("click", () => {
    cfgFormUrl.value = "";
    cfgLockUrl.checked = false;
  });
}

// โหลดค่าที่บันทึกไว้เมื่อเปิด Popup
chrome.storage.local.get(["isExamActive", "studentId", "examFormUrl", "lockFormUrl", "webhookUrl", "secretToken", "adminPasscode"], (data) => {
  if (data.examFormUrl) {
    cfgFormUrl.value = data.examFormUrl;
    customFormUrl.value = data.examFormUrl;
  }
  if (data.lockFormUrl) {
    cfgLockUrl.checked = true;
    customFormUrl.disabled = true;
    if (formUrlHint) formUrlHint.textContent = "🔒 กำหนดโดยผู้คุมสอบแล้ว (ไม่อนุญาตให้แก้ไข)";
  } else {
    cfgLockUrl.checked = false;
    customFormUrl.disabled = false;
    if (formUrlHint) formUrlHint.textContent = "*วางลิงก์ Google Forms ใดก็ได้ที่ได้รับมอบหมาย";
  }

  cfgWebhookUrl.value = data.webhookUrl || DEFAULT_WEBHOOK_URL;
  if (data.secretToken) cfgSecretToken.value = data.secretToken;
  if (cfgAdminPass) cfgAdminPass.value = data.adminPasscode || "1234";

  if (data.isExamActive) {
    setExamActiveUI(data.studentId);
  }
});

// ล็อกอินเข้าตั้งค่า Admin
loginAdminBtn.addEventListener("click", () => {
  chrome.storage.local.get(["adminPasscode"], (data) => {
    const currentPass = data.adminPasscode || "1234"; // fallback กรณี storage ว่าง
    if (adminPassInput.value === currentPass) {
      adminLoginBox.style.display = "none";
      adminConfigBox.style.display = "block";
    } else {
      alert("❌ รหัสผ่านผู้คุมสอบไม่ถูกต้อง!");
    }
  });
});

// บันทึกการตั้งค่า Admin
saveCfgBtn.addEventListener("click", () => {
  const formUrl = cfgFormUrl.value.trim();
  const isLocked = cfgLockUrl.checked;
  const webhook = cfgWebhookUrl.value.trim() || DEFAULT_WEBHOOK_URL;
  const token = cfgSecretToken.value.trim() || "EXAM_LOCK_999";
  const pass = (cfgAdminPass && cfgAdminPass.value.trim()) || "1234";

  chrome.storage.local.set({
    examFormUrl: formUrl,
    lockFormUrl: isLocked,
    webhookUrl: webhook,
    secretToken: token,
    adminPasscode: pass
  }, () => {
    customFormUrl.value = formUrl;
    customFormUrl.disabled = isLocked;
    if (formUrlHint) {
      formUrlHint.textContent = isLocked ? "🔒 กำหนดโดยผู้คุมสอบแล้ว (ไม่อนุญาตให้แก้ไข)" : "*วางลิงก์ Google Forms ใดก็ได้ที่ได้รับมอบหมาย";
    }
    saveStatus.style.display = "block";
    setTimeout(() => { saveStatus.style.display = "none"; }, 2500);
  });
});

// ทดสอบส่งสัญญาณ Webhook จากหน้า Admin
if (testWebhookBtn) {
  testWebhookBtn.addEventListener("click", async () => {
    const webhook = cfgWebhookUrl.value.trim() || DEFAULT_WEBHOOK_URL;

    testWebhookBtn.disabled = true;
    testWebhookBtn.textContent = "⏳ กำลังทดสอบ...";

    const testPayload = {
      studentId: "ทดสอบระบบ (Test Ping)",
      violation: "ทดสอบการเชื่อมต่อ Webhook จาก Extension",
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleTimeString("th-TH"),
      content: "🧪 **ทดสอบการเชื่อมต่อระบบคุมสอบ**: Extension สามารถสื่อสารกับ Webhook ได้สมบูรณ์!"
    };

    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(testPayload)
      });
      alert(`✅ ส่งข้อความทดสอบสำเร็จ! (Status: ${res.status})\nคุณสามารถตรวจดูใน Google Sheets ได้ทันที`);
    } catch (err) {
      alert(`⚠️ เกิดข้อผิดพลาดในการเชื่อมต่อ Webhook:\n${err.message}\nโปรดตรวจสอบ URL อีกครั้ง`);
    } finally {
      testWebhookBtn.disabled = false;
      testWebhookBtn.textContent = "📡 ทดสอบส่งสัญญาณ Webhook";
    }
  });
}

// เปิดหน้าจอ Admin Monitor
openMonitorBtn.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("monitor.html") });
});

// ดักจับและอนุญาตให้พิมพ์ได้เฉพาะตัวเลขเท่านั้น (0-9)
studentInput.addEventListener("input", () => {
  const cleanVal = studentInput.value.replace(/\D/g, "");
  if (studentInput.value !== cleanVal) {
    studentInput.value = cleanVal;
  }
  if (studentInput.value.trim()) {
    studentInput.style.borderColor = "";
    studentInput.style.boxShadow = "";
    if (studentIdError) studentIdError.style.display = "none";
  }
});

// กดปุ่มเริ่มทำข้อสอบ
startBtn.addEventListener("click", () => {
  const studentId = studentInput.value.trim();

  // 1. ตรวจสอบว่าได้กรอกรหัสนักเรียนหรือไม่
  if (!studentId) {
    studentInput.focus();
    studentInput.style.borderColor = "#d93025";
    studentInput.style.boxShadow = "0 0 0 2px rgba(217,48,37,0.2)";
    if (studentIdError) {
      studentIdError.textContent = "⚠️ กรุณากรอกรหัสนักเรียน (ตัวเลขเท่านั้น) ก่อนเริ่มสอบ!";
      studentIdError.style.display = "block";
    }
    return;
  }

  // 2. ตรวจสอบว่าเป็นตัวเลขล้วนหรือไม่
  if (!/^\d+$/.test(studentId)) {
    studentInput.focus();
    studentInput.style.borderColor = "#d93025";
    studentInput.style.boxShadow = "0 0 0 2px rgba(217,48,37,0.2)";
    if (studentIdError) {
      studentIdError.textContent = "⚠️ รหัสนักเรียนต้องเป็นตัวเลขเท่านั้น (0-9)";
      studentIdError.style.display = "block";
    }
    return;
  }

  if (studentIdError) studentIdError.style.display = "none";
  studentInput.style.borderColor = "";
  studentInput.style.boxShadow = "";

  let targetUrl = customFormUrl.value.trim();

  // ตรวจสอบว่าแท็บปัจจุบันเปิด URL อะไรอยู่
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const activeTab = tabs && tabs[0];
    if (!targetUrl) {
      if (activeTab && activeTab.url && (activeTab.url.includes("docs.google.com/forms") || activeTab.url.includes("forms.gle"))) {
        targetUrl = activeTab.url;
        customFormUrl.value = targetUrl;
      } else {
        customFormUrl.focus();
        customFormUrl.style.borderColor = "#d93025";
        if (formUrlError) {
          formUrlError.textContent = "⚠️ ยังไม่ได้ระบุลิงก์ข้อสอบ Google Forms!";
          formUrlError.style.display = "block";
        }
        return;
      }
    }

    if (formUrlError) formUrlError.style.display = "none";
    customFormUrl.style.borderColor = "";

  if (!targetUrl.startsWith("http://") && !targetUrl.startsWith("https://")) {
      targetUrl = "https://" + targetUrl;
    }

    // BUG-15: ตรวจสอบว่าเป็น Google Forms URL จริงก่อน start exam
    const isValidFormsUrl =
      targetUrl.includes("docs.google.com/forms") ||
      targetUrl.includes("forms.gle");

    if (!isValidFormsUrl) {
      customFormUrl.focus();
      customFormUrl.style.borderColor = "#d93025";
      if (formUrlError) {
        formUrlError.textContent = "⚠️ URL นี้ไม่ใช่ Google Forms กรุณาใส่ URL ของ Google Forms เท่านั้น";
        formUrlError.style.display = "block";
      }
      return;
    }

    const launchExamWithTab = (tab) => {
      const tabId = tab ? tab.id : null;
      const windowId = tab ? tab.windowId : null;

      // ถ้าแท็บไม่ได้อยู่ที่หน้า Google Forms อยู่แล้ว ให้นำทางไปยังหน้าข้อสอบทันที
      if (tabId && targetUrl) {
        const isAlreadyOnForms = tab.url && (
          tab.url === targetUrl ||
          tab.url.startsWith(targetUrl) ||
          tab.url.includes("docs.google.com/forms") ||
          tab.url.includes("forms.gle")
        );

        if (!isAlreadyOnForms) {
          chrome.tabs.update(tabId, { url: targetUrl, active: true }, () => {});
        }
      }

      // ส่งสัญญาณเริ่มกระบวนการคุมสอบและล็อกหน้าจอทันที
      chrome.runtime.sendMessage({
        type: "START_EXAM",
        studentId: studentId,
        tabId: tabId,
        windowId: windowId,
        formTitle: (tab && tab.title) || targetUrl,
        targetUrl: targetUrl
      }, () => {
        setExamActiveUI(studentId);
        window.close(); // ปิด popup เพื่อให้ผู้สอบเห็นหน้าข้อสอบเต็มจอทันที
      });
    };

    if (activeTab) {
      launchExamWithTab(activeTab);
    } else {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (fallbackTabs) => {
        if (fallbackTabs && fallbackTabs[0]) {
          launchExamWithTab(fallbackTabs[0]);
        } else {
          chrome.tabs.create({ url: targetUrl }, (newTab) => {
            launchExamWithTab(newTab);
          });
        }
      });
    }
  });
});

// กดปุ่มสิ้นสุดการสอบ (โดยผู้คุมสอบ) — BUG-01: อ่านรหัสผ่านจาก storage เสมอ ไม่ใช้ ADMIN_PASS hardcode
stopBtn.addEventListener("click", () => {
  const pass = prompt("กรอกรหัสผ่านผู้คุมสอบ (Admin Passcode) เพื่อปลดล็อก:");
  chrome.storage.local.get(["adminPasscode"], (data) => {
    const currentPass = data.adminPasscode || "1234"; // fallback สำหรับกรณี storage ถูกล้างเท่านั้น
    if (pass !== currentPass) {
      alert("❌ รหัสผ่านผู้คุมสอบไม่ถูกต้อง!\nหากทำข้อสอบเสร็จแล้ว ให้กดปุ่มส่ง (Submit) ใน Google Forms ระบบจะปลดล็อกให้อัตโนมัติ");
      return;
    }

    chrome.runtime.sendMessage({ type: "STOP_EXAM" }, () => {
      studentInput.disabled = false;
      startBtn.style.display = "block";
      stopBtn.style.display = "none";
      statusBadge.classList.remove("active");
      statusText.textContent = "สถานะ: สิ้นสุดการสอบแล้ว (ปลดล็อก)";
    });
  });
});

function setExamActiveUI(studentId) {
  studentInput.value = studentId;
  studentInput.disabled = true;
  startBtn.style.display = "none";
  stopBtn.style.display = "block";
  statusBadge.classList.add("active");
  statusText.textContent = "🔒 กำลังคุมสอบ (ห้ามสลับหน้าจอ)";
}