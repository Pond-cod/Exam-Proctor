const logTableBody = document.getElementById("logTableBody");
const totalStudentsEl = document.getElementById("totalStudents");
const totalViolationsEl = document.getElementById("totalViolations");
const totalSubmittedEl = document.getElementById("totalSubmitted");
const syncStatus = document.getElementById("syncStatus");
const searchInput = document.getElementById("searchInput");
const simulateBtn = document.getElementById("simulateBtn");
const refreshBtn = document.getElementById("refreshBtn");
const clearLocalBtn = document.getElementById("clearLocalBtn");

let allLogs = [];
let previousViolationCount = 0;

// เสียงแจ้งเตือนสั้นๆ ผ่าน Web Audio API (ไม่ต้องพึ่งพาไฟล์เสียงภายนอก)
function playAlertTone() {
  try {
    const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, audioCtx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, audioCtx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.3, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.3);
  } catch (e) {
    console.log("Audio alert not available:", e);
  }
}

const DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzN0bSpaAbWaIfgIA3kNfZyDGLr-U0965UDPy27IiQkotdXF576SghQrH8MGQuHGNi_/exec";

// ฟังก์ชันดึง Log จาก Google Apps Script หรือ Backend API
function fetchLogs() {
  chrome.storage.local.get(["webhookUrl"], (data) => {
    const webhookUrl = data.webhookUrl || DEFAULT_WEBHOOK_URL;

    fetch(webhookUrl)
      .then((res) => res.json())
      .then((resData) => {
        let fetchedList = [];
        if (Array.isArray(resData)) {
          fetchedList = resData;
        } else if (resData && Array.isArray(resData.data)) {
          fetchedList = resData.data;
        } else if (resData && resData.status === "success" && Array.isArray(resData.logs)) {
          fetchedList = resData.logs;
        }

        // อัปเดตเสมอแม้ fetchedList จะเป็น [] เพื่อเคลียร์ข้อความ "กำลังโหลด..."
        allLogs = fetchedList;
        applyFilterAndRender();
        syncStatus.textContent = "● ซิงค์ล่าสุด: " + new Date().toLocaleTimeString("th-TH");
      })
      .catch((err) => {
        syncStatus.textContent = "⚠️ ขาดการเชื่อมต่อ Webhook";
        console.warn("ไม่สามารถดึงข้อมูล Logs ได้:", err);
      });
  });
}

// กรองข้อมูลและแสดงผล
function applyFilterAndRender() {
  const query = (searchInput ? searchInput.value : "").trim().toLowerCase();
  const filtered = allLogs.filter((item) => {
    if (!query) return true;
    return (
      (item.studentId && item.studentId.toLowerCase().includes(query)) ||
      (item.violation && item.violation.toLowerCase().includes(query)) ||
      (item.time && item.time.toLowerCase().includes(query))
    );
  });

  renderMonitor(filtered);
}

function renderMonitor(logsToDisplay) {
  const studentSet = new Set();
  const submittedSet = new Set();
  const violationCountByStudent = {};
  let currentTotalViolations = 0;

  // คำนวณภาพรวมจากข้อมูลทั้งหมด (allLogs)
  allLogs.forEach((item) => {
    if (item.studentId) studentSet.add(item.studentId);
    const text = item.violation || "";
    const isStart = text.includes("เริ่มเข้าทำข้อสอบ");
    const isSubmitted = text.includes("ส่งข้อสอบเรียบร้อย");

    if (isSubmitted) {
      submittedSet.add(item.studentId);
    } else if (!isStart) {
      currentTotalViolations++;
      violationCountByStudent[item.studentId] = (violationCountByStudent[item.studentId] || 0) + 1;
    }
  });

  totalStudentsEl.textContent = `${studentSet.size} คน`;
  totalViolationsEl.textContent = `${currentTotalViolations} ครั้ง`;
  if (totalSubmittedEl) {
    totalSubmittedEl.textContent = `${submittedSet.size} คน`;
  }

  // หากมีการทำผิดกฎเพิ่มขึ้น ส่งเสียงเตือนแอดมิน
  if (currentTotalViolations > previousViolationCount && previousViolationCount > 0) {
    playAlertTone();
  }
  previousViolationCount = currentTotalViolations;

  if (logsToDisplay.length === 0) {
    logTableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 24px; color:#5f6368;">ยังไม่มีข้อมูลเหตุการณ์ที่ตรงกับเงื่อนไข</td></tr>`;
    return;
  }

  // เรียงลำดับจากล่าสุดขึ้นก่อน
  const reversedLogs = [...logsToDisplay].reverse();

  logTableBody.innerHTML = reversedLogs.map((item) => {
    const text = item.violation || "";
    const isStartOrEnd = text.includes("เริ่มเข้าทำข้อสอบ") || text.includes("ส่งข้อสอบเรียบร้อย");
    const rowClass = isStartOrEnd ? "success-row" : "violation-row";
    const vCount = violationCountByStudent[item.studentId] || 0;

    return `
      <tr class="${rowClass}">
        <td>${item.time || item.timestamp || "-"}</td>
        <td><strong>${item.studentId || "ไม่ระบุ"}</strong></td>
        <td class="viol-text">${text}</td>
        <td>${vCount > 0 ? `<span class="count-badge">${vCount} ครั้ง</span>` : "-"}</td>
      </tr>
    `;
  }).join("");
}

// ช่องค้นหาแบบ Real-time
if (searchInput) {
  searchInput.addEventListener("input", applyFilterAndRender);
}

// ปุ่มรีเฟรชข้อมูล
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    syncStatus.textContent = "⏳ กำลังดึงข้อมูล...";
    fetchLogs();
  });
}

// องค์ประกอบแผงตั้งค่าระบบคุมสอบทั้งหมด (Admin Control Panel)
const cfgFormUrl = document.getElementById("cfgFormUrl");
const cfgLockUrl = document.getElementById("cfgLockUrl");
const cfgWebhookUrl = document.getElementById("cfgWebhookUrl");
const cfgSecretToken = document.getElementById("cfgSecretToken");
const cfgAdminPass = document.getElementById("cfgAdminPass");
const saveAllSettingsBtn = document.getElementById("saveAllSettingsBtn");
const testWebhookBtn = document.getElementById("testWebhookBtn");
const openFormBtn = document.getElementById("openFormBtn");
const copyFormBtn = document.getElementById("copyFormBtn");
const clearFormBtn = document.getElementById("clearFormBtn");
const formUrlModeBadge = document.getElementById("formUrlModeBadge");
const toggleSettingsBtn = document.getElementById("toggleSettingsBtn");
const settingsContent = document.getElementById("settingsContent");
const saveToast = document.getElementById("saveToast");

// ฟังก์ชันอัปเดตป้ายสถานะโหมดข้อสอบ
function updateFormUrlBadge(url, isLocked) {
  if (!formUrlModeBadge) return;
  if (url && url.trim()) {
    if (isLocked) {
      formUrlModeBadge.textContent = "🔒 กำหนดฟอร์มกลาง (ล็อกห้ามเปลี่ยน)";
      formUrlModeBadge.style.background = "#fce8e6";
      formUrlModeBadge.style.color = "#d93025";
    } else {
      formUrlModeBadge.textContent = "🟢 กำหนดฟอร์มกลางแล้ว (โหมดแนะนำ)";
      formUrlModeBadge.style.background = "#e6f4ea";
      formUrlModeBadge.style.color = "#137333";
    }
  } else {
    formUrlModeBadge.textContent = "⚪ โหมดอิสระ (อนุญาตทุก Google Forms)";
    formUrlModeBadge.style.background = "#e8f0fe";
    formUrlModeBadge.style.color = "#1a73e8";
  }
}

// โหลดการตั้งค่าทั้งหมดจาก chrome.storage.local มาแสดงผล
chrome.storage.local.get(
  ["examFormUrl", "lockFormUrl", "webhookUrl", "secretToken", "adminPasscode"],
  (data) => {
    if (cfgFormUrl) cfgFormUrl.value = data.examFormUrl || "";
    if (cfgLockUrl) cfgLockUrl.checked = !!data.lockFormUrl;
    if (cfgWebhookUrl) cfgWebhookUrl.value = data.webhookUrl || DEFAULT_WEBHOOK_URL;
    if (cfgSecretToken) cfgSecretToken.value = data.secretToken || "EXAM_LOCK_999";
    if (cfgAdminPass) cfgAdminPass.value = data.adminPasscode || "1234";
    updateFormUrlBadge(data.examFormUrl, data.lockFormUrl);
  }
);

// ย่อ/ขยายแผงตั้งค่า
if (toggleSettingsBtn && settingsContent) {
  toggleSettingsBtn.addEventListener("click", () => {
    const isHidden = settingsContent.style.display === "none";
    settingsContent.style.display = isHidden ? "block" : "none";
    toggleSettingsBtn.textContent = isHidden ? "🔽 ย่อ/ขยายการตั้งค่า" : "▶️ เปิดแผงการตั้งค่า";
  });
}

// 💾 บันทึกการตั้งค่าทั้งหมดจากหน้า Monitor
if (saveAllSettingsBtn) {
  saveAllSettingsBtn.addEventListener("click", () => {
    let formUrl = cfgFormUrl ? cfgFormUrl.value.trim() : "";
    if (formUrl && !formUrl.startsWith("http://") && !formUrl.startsWith("https://")) {
      formUrl = "https://" + formUrl;
      if (cfgFormUrl) cfgFormUrl.value = formUrl;
    }
    const isLocked = cfgLockUrl ? cfgLockUrl.checked : false;
    const webhook = (cfgWebhookUrl && cfgWebhookUrl.value.trim()) || DEFAULT_WEBHOOK_URL;
    const token = (cfgSecretToken && cfgSecretToken.value.trim()) || "EXAM_LOCK_999";
    const pass = (cfgAdminPass && cfgAdminPass.value.trim()) || "1234";

    chrome.storage.local.set({
      examFormUrl: formUrl,
      lockFormUrl: isLocked,
      webhookUrl: webhook,
      secretToken: token,
      adminPasscode: pass
    }, () => {
      updateFormUrlBadge(formUrl, isLocked);
      if (saveToast) {
        saveToast.style.display = "block";
        setTimeout(() => { saveToast.style.display = "none"; }, 3500);
      }
      // อัปเดตและดึงข้อมูลทันทีด้วย Webhook ใหม่
      fetchLogs();
    });
  });
}

// 📡 ทดสอบส่งสัญญาณ Webhook จากหน้า Monitor
if (testWebhookBtn) {
  testWebhookBtn.addEventListener("click", async () => {
    const webhook = (cfgWebhookUrl && cfgWebhookUrl.value.trim()) || DEFAULT_WEBHOOK_URL;
    testWebhookBtn.disabled = true;
    testWebhookBtn.textContent = "⏳ กำลังทดสอบ...";

    const testPayload = {
      studentId: "ทดสอบระบบ (Admin Monitor)",
      violation: "ทดสอบส่งสัญญาณ Webhook จาก Admin Exam Monitor",
      timestamp: new Date().toISOString(),
      time: new Date().toLocaleTimeString("th-TH"),
      content: "🧪 **ทดสอบการเชื่อมต่อระบบ**: ส่งสัญญาณทดสอบจากหน้า Admin Exam Monitor เรียบร้อย!"
    };

    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify(testPayload)
      });
      alert(`✅ ส่งข้อความทดสอบสำเร็จ! (Status: ${res.status})\nระบบบันทึกลง Google Sheets และส่งเข้า Monitor แล้ว`);
      fetchLogs();
    } catch (err) {
      alert(`⚠️ เกิดข้อผิดพลาดในการเชื่อมต่อ Webhook:\n${err.message}\nโปรดตรวจสอบ Webhook URL อีกครั้ง`);
    } finally {
      testWebhookBtn.disabled = false;
      testWebhookBtn.textContent = "📡 ทดสอบส่งสัญญาณ Webhook";
    }
  });
}

// ล้างค่า URL เพื่อเข้าสู่โหมดอิสระ
if (clearFormBtn) {
  clearFormBtn.addEventListener("click", () => {
    if (cfgFormUrl) cfgFormUrl.value = "";
    if (cfgLockUrl) cfgLockUrl.checked = false;
    chrome.storage.local.set({ examFormUrl: "", lockFormUrl: false }, () => {
      updateFormUrlBadge("", false);
      if (saveToast) {
        saveToast.style.display = "block";
        saveToast.textContent = "⚪ เข้าสู่โหมดอิสระ: อนุญาตให้ผู้สอบใช้ Google Forms ใดก็ได้";
        setTimeout(() => { saveToast.style.display = "none"; }, 3000);
      }
    });
  });
}

// เปิดดูฟอร์มข้อสอบ
if (openFormBtn) {
  openFormBtn.addEventListener("click", () => {
    const url = cfgFormUrl ? cfgFormUrl.value.trim() : "";
    if (url) {
      window.open(url, "_blank");
    } else {
      alert("⚠️ ยังไม่ได้ระบุลิงก์ Google Forms ในช่องนี้");
    }
  });
}

// คัดลอกลิงก์ส่งให้นักเรียน
if (copyFormBtn) {
  copyFormBtn.addEventListener("click", () => {
    const url = cfgFormUrl ? cfgFormUrl.value.trim() : "";
    if (url) {
      navigator.clipboard.writeText(url).then(() => {
        alert("📋 คัดลอกลิงก์ Google Forms เรียบร้อยแล้ว! สามารถนำไปส่งให้นักเรียนได้ทันที");
      }).catch(() => {
        alert("ลิงก์ข้อสอบ: " + url);
      });
    } else {
      alert("⚠️ ยังไม่ได้ระบุลิงก์ข้อสอบในช่องนี้");
    }
  });
}

// ปุ่มจำลองเหตุการณ์เพื่อทดสอบ Dashboard
if (simulateBtn) {
  simulateBtn.addEventListener("click", () => {
    const mockStudents = ["660101 ด.ช.สมชาย ใจดี", "660102 ด.ญ.สุดา รักเรียน", "660103 นายกิตติศักดิ์ พากเพียร"];
    const mockViolations = [
      "⚠️ พยายามเปิดแท็บใหม่ (ระบบสั่งปิดแท็บอัตโนมัติแล้ว)",
      "⚠️ สลับหน้าต่างไปโปรแกรมอื่น หรือย่อหน้าจอเบราว์เซอร์",
      "🚨 ตรวจพบความพยายามเปิดหน้าจัดการ Extension เพื่อปิดระบบ (ถูกบล็อกทันที)",
      "⚠️ คลิกออกนอกหน้าจอ หรือสลับโปรแกรม (ขณะทำฟอร์ม: แบบทดสอบปลายภาค)",
      "✅ ผู้สอบส่งข้อสอบเรียบร้อยแล้ว (ระบบปลดล็อกอัตโนมัติ)"
    ];

    const randomStudent = mockStudents[Math.floor(Math.random() * mockStudents.length)];
    const randomViolation = mockViolations[Math.floor(Math.random() * mockViolations.length)];

    const now = new Date();
    allLogs.push({
      time: now.toLocaleTimeString("th-TH"),
      timestamp: now.toISOString(),
      studentId: randomStudent,
      violation: randomViolation
    });

    applyFilterAndRender();
  });
}

// ปุ่มล้างข้อมูลบนหน้าจอ
if (clearLocalBtn) {
  clearLocalBtn.addEventListener("click", () => {
    if (confirm("คุณต้องการล้างข้อมูลบนหน้าจอ Monitor นี้หรือไม่? (ข้อมูลใน Google Sheets จะยังคงอยู่)")) {
      allLogs = [];
      previousViolationCount = 0;
      applyFilterAndRender();
    }
  });
}

// เริ่มต้นดึงข้อมูลทันที และดึงอัตโนมัติทุกๆ 4 วินาที
fetchLogs();
setInterval(fetchLogs, 4000);