/**
 * Admin Studio & Monitor Engine for index.html (Web App)
 */

let allLogs = [];
let previousViolationCount = 0;
let monitorInterval = null;

// Audio Chime for Admin Monitor
function playAdminChime() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5
    gain.gain.setValueAtTime(0.2, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch (e) {}
}

// 1. Navigation Tab Switching
function setupTabNavigation() {
  const tabs = document.querySelectorAll(".nav-tab-btn");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("active"));
      tab.classList.add("active");

      const targetId = tab.getAttribute("data-target");
      document.querySelectorAll(".view-section").forEach((sec) => {
        sec.classList.remove("active");
      });
      const targetSec = document.getElementById(targetId);
      if (targetSec) targetSec.classList.add("active");

      // หากสลับมาหน้า Monitor ให้ดึงข้อมูลทันที
      if (targetId === "monitorSection") {
        fetchMonitorLogs();
        if (!monitorInterval) {
          monitorInterval = setInterval(fetchMonitorLogs, 5000);
        }
      } else {
        if (monitorInterval) {
          clearInterval(monitorInterval);
          monitorInterval = null;
        }
      }
    });
  });
}

// 2. Sub-site Link Generator
function generateExamLink() {
  const title = (document.getElementById("examTitleInput").value || "").trim() || "แบบทดสอบออนไลน์";
  const rawFormUrl = (document.getElementById("examFormUrlInput").value || "").trim();
  const webhookUrl = (document.getElementById("examWebhookInput").value || "").trim() || DEFAULT_WEBHOOK_URL;
  const passcode = (document.getElementById("examPasscodeInput").value || "").trim() || DEFAULT_ADMIN_PASSCODE;

  if (!rawFormUrl) {
    alert("⚠️ กรุณาระบุลิงก์ Google Forms ก่อนสร้างห้องสอบ");
    document.getElementById("examFormUrlInput").focus();
    return;
  }

  const cleanFormUrl = formatGoogleFormEmbedUrl(rawFormUrl);

  const roomConfig = {
    title: title,
    formUrl: cleanFormUrl,
    webhookUrl: webhookUrl,
    adminPasscode: passcode,
    createdAt: new Date().toISOString()
  };

  // เข้ารหัส Base64
  const encodedData = encodeExamConfig(roomConfig);

  // สร้างลิงก์ห้องสอบ Sub-link
  const baseUrl = new URL("exam.html", window.location.href);
  baseUrl.searchParams.set("data", encodedData);
  const fullExamUrl = baseUrl.toString();

  // แสดงผลลัพธ์
  const resultBox = document.getElementById("linkResultBox");
  const linkDisplay = document.getElementById("generatedLinkDisplay");
  const testOpenBtn = document.getElementById("testOpenLinkBtn");
  const qrImg = document.getElementById("examQrImage");

  linkDisplay.value = fullExamUrl;
  testOpenBtn.href = fullExamUrl;

  // สร้าง QR Code ผ่าน API มาตรฐาน
  if (qrImg) {
    qrImg.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(fullExamUrl)}`;
  }

  resultBox.classList.add("active");
  resultBox.scrollIntoView({ behavior: "smooth" });

  // บันทึกประวัติลง LocalStorage
  saveRoomToHistory(roomConfig, fullExamUrl);
}

// บันทึกประวัติห้องสอบ
function saveRoomToHistory(roomConfig, fullUrl) {
  try {
    let history = JSON.parse(localStorage.getItem("examRoomsHistory") || "[]");
    // ลบอันเก่าที่ซ้ำออก
    history = history.filter((r) => r.fullUrl !== fullUrl);
    history.unshift({
      title: roomConfig.title,
      formUrl: roomConfig.formUrl,
      createdAt: new Date().toLocaleString("th-TH"),
      fullUrl: fullUrl
    });
    // เก็บสูงสุด 10 ห้องล่าสุด
    history = history.slice(0, 10);
    localStorage.setItem("examRoomsHistory", JSON.stringify(history));
    renderRoomHistory();
  } catch (e) {}
}

// แสดงรายการประวัติห้องสอบที่เคยสร้าง
function renderRoomHistory() {
  const container = document.getElementById("historyRoomsList");
  if (!container) return;

  try {
    const history = JSON.parse(localStorage.getItem("examRoomsHistory") || "[]");
    if (history.length === 0) {
      container.innerHTML = `<div style="color: var(--text-muted); font-size: 13px;">ยังไม่มีประวัติการสร้างห้องสอบ</div>`;
      return;
    }

    container.innerHTML = history.map((room) => `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid var(--bg-card-border); border-radius: var(--radius-md); padding: 12px 16px; margin-bottom: 10px; display: flex; align-items: center; justify-content: space-between; gap: 12px;">
        <div style="overflow: hidden;">
          <strong style="display: block; font-size: 14px; text-overflow: ellipsis; white-space: nowrap; overflow: hidden;">${room.title}</strong>
          <span style="font-size: 12px; color: var(--text-muted);">${room.createdAt}</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 12px;" onclick="copySpecificUrl('${room.fullUrl}')">📋 คัดลอก</button>
          <a class="btn btn-primary" style="padding: 6px 12px; font-size: 12px;" href="${room.fullUrl}" target="_blank">🔗 เปิดดู</a>
        </div>
      </div>
    `).join("");
  } catch (e) {}
}

window.copySpecificUrl = function(url) {
  navigator.clipboard.writeText(url).then(() => {
    alert("✅ คัดลอกลิงก์ห้องสอบเรียบร้อยแล้ว");
  });
};

// 3. Real-time Admin Monitor Logs Fetcher
function fetchMonitorLogs() {
  const webhookUrl = (document.getElementById("examWebhookInput").value || "").trim() || DEFAULT_WEBHOOK_URL;
  const syncStatus = document.getElementById("syncStatusText");

  if (!webhookUrl) return;

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

      allLogs = fetchedList;
      renderMonitorLogs();
      if (syncStatus) {
        syncStatus.textContent = `● ซิงค์ล่าสุด: ${new Date().toLocaleTimeString("th-TH")}`;
      }
    })
    .catch((err) => {
      if (syncStatus) syncStatus.textContent = `⚠️ ขาดการเชื่อมต่อ Webhook`;
    });
}

function renderMonitorLogs() {
  const query = (document.getElementById("searchLogInput") ? document.getElementById("searchLogInput").value : "").trim().toLowerCase();
  const tableBody = document.getElementById("monitorTableBody");
  const totalStudentsEl = document.getElementById("statTotalStudents");
  const totalViolationsEl = document.getElementById("statTotalViolations");
  const totalSubmittedEl = document.getElementById("statTotalSubmitted");

  const studentSet = new Set();
  const submittedSet = new Set();
  let currentTotalViolations = 0;

  allLogs.forEach((item) => {
    if (item.studentId) studentSet.add(item.studentId);
    const text = item.violation || "";
    const isStart = text.includes("เริ่มเข้าทำข้อสอบ");
    const isSubmitted = text.includes("ส่งข้อสอบเรียบร้อย");

    if (isSubmitted) {
      submittedSet.add(item.studentId);
    } else if (!isStart) {
      currentTotalViolations++;
    }
  });

  if (totalStudentsEl) totalStudentsEl.textContent = `${studentSet.size} คน`;
  if (totalViolationsEl) totalViolationsEl.textContent = `${currentTotalViolations} ครั้ง`;
  if (totalSubmittedEl) totalSubmittedEl.textContent = `${submittedSet.size} คน`;

  // เสียงแจ้งเตือนเมื่อยอดทำผิดกฎเพิ่ม
  if (currentTotalViolations > previousViolationCount && previousViolationCount > 0) {
    playAdminChime();
  }
  previousViolationCount = currentTotalViolations;

  const filtered = allLogs.filter((item) => {
    if (!query) return true;
    return (
      (item.studentId && item.studentId.toLowerCase().includes(query)) ||
      (item.violation && item.violation.toLowerCase().includes(query)) ||
      (item.time && item.time.toLowerCase().includes(query))
    );
  });

  if (filtered.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding: 28px; color: var(--text-muted);">ยังไม่มีข้อมูลเหตุการณ์</td></tr>`;
    return;
  }

  // เรียงลำดับจากเหตุการณ์ล่าสุดขึ้นก่อน
  const reversed = [...filtered].reverse();

  tableBody.innerHTML = reversed.map((item) => {
    const text = item.violation || "";
    const isStart = text.includes("เริ่มเข้าทำข้อสอบ");
    const isEnd = text.includes("ส่งข้อสอบเรียบร้อย");
    const rowClass = (isStart || isEnd) ? "success-row" : "violation-row";
    const badge = (isStart || isEnd)
      ? `<span class="badge badge-success">${isStart ? "🟢 เริ่มสอบ" : "✅ ส่งแล้ว"}</span>`
      : `<span class="badge badge-danger">🚨 ผิดกฎ</span>`;

    return `
      <tr class="${rowClass}">
        <td>${item.time || item.timestamp || "-"}</td>
        <td><strong>${item.studentId || "ไม่ระบุ"}</strong></td>
        <td>${text}</td>
        <td>${badge}</td>
      </tr>
    `;
  }).join("");
}

// ทดสอบส่งสัญญาณ Webhook Ping
async function testWebhookPing() {
  const webhookUrl = (document.getElementById("examWebhookInput").value || "").trim() || DEFAULT_WEBHOOK_URL;
  const testBtn = document.getElementById("testWebhookBtn");

  testBtn.disabled = true;
  testBtn.textContent = "⏳ กำลังทดสอบ...";

  const payload = {
    studentId: "ทดสอบระบบ (Test Ping)",
    violation: "ทดสอบการเชื่อมต่อ Webhook จาก Web App Studio",
    timestamp: new Date().toISOString(),
    time: new Date().toLocaleTimeString("th-TH"),
    date: new Date().toLocaleDateString("th-TH"),
    isSeverityHigh: false,
    formTitle: "ทดสอบการเชื่อมต่อ"
  };

  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(payload)
    });
    alert(`✅ ส่งข้อความทดสอบสำเร็จ! (Status: ${res.status})\nคุณสามารถตรวจดูผลใน Google Sheets ได้ทันที`);
    fetchMonitorLogs();
  } catch (err) {
    alert(`⚠️ เกิดข้อผิดพลาดในการเชื่อมต่อ:\n${err.message}`);
  } finally {
    testBtn.disabled = false;
    testBtn.textContent = "📡 ทดสอบส่งสัญญาณ Webhook";
  }
}

// DOM Ready
document.addEventListener("DOMContentLoaded", () => {
  setupTabNavigation();
  renderRoomHistory();

  // กำหนดค่าเริ่มต้น
  const webhookInput = document.getElementById("examWebhookInput");
  if (webhookInput && !webhookInput.value) {
    webhookInput.value = DEFAULT_WEBHOOK_URL;
  }
  const passInput = document.getElementById("examPasscodeInput");
  if (passInput && !passInput.value) {
    passInput.value = DEFAULT_ADMIN_PASSCODE;
  }

  // ปุ่มสร้างลิงก์
  const generateBtn = document.getElementById("generateLinkBtn");
  if (generateBtn) {
    generateBtn.addEventListener("click", generateExamLink);
  }

  // ปุ่มคัดลอกลิงก์
  const copyBtn = document.getElementById("copyLinkBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", () => {
      const linkDisplay = document.getElementById("generatedLinkDisplay");
      if (linkDisplay && linkDisplay.value) {
        navigator.clipboard.writeText(linkDisplay.value).then(() => {
          const originalText = copyBtn.innerHTML;
          copyBtn.innerHTML = "✅ คัดลอกแล้ว!";
          setTimeout(() => { copyBtn.innerHTML = originalText; }, 2000);
        });
      }
    });
  }

  // ปุ่มทดสอบ Webhook
  const testWebhookBtn = document.getElementById("testWebhookBtn");
  if (testWebhookBtn) {
    testWebhookBtn.addEventListener("click", testWebhookPing);
  }

  // ปุ่มเปิด Google Sheets
  const openSheetBtn = document.getElementById("openSheetBtn");
  if (openSheetBtn) {
    openSheetBtn.addEventListener("click", () => {
      window.open(DEFAULT_SHEET_URL, "_blank");
    });
  }

  // ช่องค้นหาใน Monitor
  const searchLogInput = document.getElementById("searchLogInput");
  if (searchLogInput) {
    searchLogInput.addEventListener("input", renderMonitorLogs);
  }

  // ปุ่มรีเฟรช Monitor
  const refreshLogsBtn = document.getElementById("refreshLogsBtn");
  if (refreshLogsBtn) {
    refreshLogsBtn.addEventListener("click", fetchMonitorLogs);
  }
});
