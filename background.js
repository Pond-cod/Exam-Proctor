// Background Service Worker (Manifest V3) - Exam Proctor Lock

const DEFAULT_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycbzN0bSpaAbWaIfgIA3kNfZyDGLr-U0965UDPy27IiQkotdXF576SghQrH8MGQuHGNi_/exec";
const DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1aDO0taJC_7itVhA4Ft0Pp01muyXPEcNhYtiqdwRvQGU/edit?usp=sharing";

function updateBadge(isActive) {
  if (isActive) {
    chrome.action.setBadgeText({ text: "LOCK" });
    chrome.action.setBadgeBackgroundColor({ color: "#d93025" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

// กำหนดค่าเริ่มต้นอัตโนมัติเมื่อติดตั้งหรืออัปเดต Extension
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get(["webhookUrl", "secretToken", "sheetUrl", "adminPasscode"], (data) => {
    chrome.storage.local.set({
      webhookUrl: data.webhookUrl || DEFAULT_WEBHOOK_URL,
      secretToken: data.secretToken || "EXAM_LOCK_999",
      sheetUrl: data.sheetUrl || DEFAULT_SHEET_URL,
      adminPasscode: data.adminPasscode || "1234",
      isExamActive: false,
      examTabId: null,
      examWindowId: null
    });
    updateBadge(false);
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.storage.local.get(["isExamActive"], (data) => {
    updateBadge(!!data.isExamActive);
  });
});

// ฟังก์ชันส่งการแจ้งเตือนไปยัง Webhook URL (Google Apps Script / Discord / Custom API)
async function sendAlertToAdmin(violationDetail, isSeverityHigh = false, customStudentId = null) {
  try {
    const data = await chrome.storage.local.get(["isExamActive", "studentId", "webhookUrl"]);
    const webhookUrl = data.webhookUrl || DEFAULT_WEBHOOK_URL;
    const finalStudentId = customStudentId || data.studentId || "ไม่ระบุชื่อผู้สอบ";

    const isStartAlert = violationDetail.includes("เริ่มเข้าทำข้อสอบ");

    if (!webhookUrl) {
      console.log("[ExamProctor] ยังไม่ได้ตั้งค่า Webhook URL");
      return;
    }

    if (!data.isExamActive && !isStartAlert) {
      console.log("[ExamProctor] ยังไม่ได้เปิดสอบ:", violationDetail);
      return;
    }

    const now = new Date();
    const payload = {
      studentId: finalStudentId,
      violation: violationDetail,
      timestamp: now.toISOString(),
      time: now.toLocaleTimeString("th-TH"),
      date: now.toLocaleDateString("th-TH"),
      isSeverityHigh: isSeverityHigh,
      content: `🚨 **แจ้งเตือนการสอบ (${now.toLocaleTimeString("th-TH")})**\n👤 **ผู้สอบ**: ${finalStudentId}\n⚠️ **เหตุการณ์**: ${violationDetail}`
    };

    console.log("[ExamProctor] กำลังส่งรายงานไปที่ Webhook:", payload);

    // ใน Manifest V3 Service Worker ต้องใช้ fetch() เท่านั้น (ห้ามใช้ XMLHttpRequest)
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8"
      },
      body: JSON.stringify(payload)
    });

    console.log("[ExamProctor] ส่งรายงานสำเร็จ Status:", response.status);
  } catch (err) {
    console.error("[ExamProctor] ไม่สามารถส่งแจ้งเตือนได้:", err);
  }
}

// ตัวแปรกันการยิงแจ้งเตือนรัวเกินไป (Debounce / Rate Limit 2 วินาที)
let lastAlertTime = 0;
function debouncedAlert(message, minIntervalMs = 2000) {
  const now = Date.now();
  if (now - lastAlertTime >= minIntervalMs) {
    lastAlertTime = now;
    sendAlertToAdmin(message);
  }
}

// 1. ระบบล็อกแท็บ: ห้ามเปิดแท็บใหม่ หากเปิดขึ้นมาจะปิดทันที ดึงหน้าต่างเดิมกลับมา และแจ้งเตือน
chrome.tabs.onCreated.addListener((tab) => {
  chrome.storage.local.get(["isExamActive", "examTabId", "examWindowId"], (data) => {
    // ตรวจสอบเฉพาะเมื่อเปิดสอบแล้ว และมี examTabId ชัดเจน (เพื่อไม่ให้ปิดแท็บข้อสอบที่กำลังเปิด)
    if (data.isExamActive && data.examTabId && tab.id !== data.examTabId) {
      chrome.tabs.remove(tab.id).catch(() => {});
      debouncedAlert("⚠️ พยายามเปิดแท็บใหม่ (ระบบสั่งปิดแท็บอัตโนมัติแล้ว)");

      if (data.examTabId) {
        chrome.tabs.update(data.examTabId, { active: true }).catch(() => {});
      }
      if (data.examWindowId) {
        chrome.windows.update(data.examWindowId, { focused: true, state: "fullscreen" }).catch(() => {});
      }
    }
  });
});

// ดักจับการเปิดหน้าต่างเบราว์เซอร์ใหม่
chrome.windows.onCreated.addListener((win) => {
  chrome.storage.local.get(["isExamActive", "examWindowId", "examTabId"], (data) => {
    if (data.isExamActive && win.id !== data.examWindowId) {
      chrome.windows.remove(win.id).catch(() => {});
      debouncedAlert("⚠️ พยายามเปิดหน้าต่างเบราว์เซอร์ใหม่ (ระบบสั่งปิดหน้าต่างอัตโนมัติแล้ว)");
      if (data.examWindowId) {
        chrome.windows.update(data.examWindowId, { focused: true, state: "fullscreen" }).catch(() => {});
      }
    }
  });
});

// 2. ป้องกันการเปลี่ยน URL ไปยังเว็บอื่น และป้องกันการเปิดหน้าจัดการ Extension
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  chrome.storage.local.get(["isExamActive", "examTabId"], (data) => {
    if (data.isExamActive && changeInfo.url) {
      const url = changeInfo.url.toLowerCase();

      // ดักจับการพยายามเข้าไปปิด Extension
      if (url.startsWith("chrome://extensions") || url.startsWith("chrome://settings") || url.startsWith("edge://extensions")) {
        chrome.tabs.remove(tabId).catch(() => {});
        sendAlertToAdmin("🚨 ตรวจพบความพยายามเปิดหน้าจัดการ Extension เพื่อปิดระบบ (ถูกบล็อกทันที)", true);
        return;
      }

      // ตรวจสอบว่า URL ที่เปิดได้รับอนุญาตหรือไม่
      const isAllowedUrl =
        url.includes("docs.google.com/forms") ||
        url.includes("google.com/forms") ||
        url.includes("forms.gle") ||
        url.includes("accounts.google.com") ||
        url.includes("gstatic.com") ||
        url.includes("googleusercontent.com") ||
        url.includes("apis.google.com") ||
        url.startsWith("chrome-extension://");

      if (!isAllowedUrl) {
        if (tabId !== data.examTabId) {
          chrome.tabs.remove(tabId).catch(() => {});
        } else {
          // หากพยายามเปลี่ยน URL ในแท็บข้อสอบ ให้เปิดกลับไปหน้าฟอร์มเดิม
          chrome.storage.local.get(["activeExamUrl", "examFormUrl"], (formMeta) => {
            const redirectUrl = formMeta.activeExamUrl || formMeta.examFormUrl;
            if (redirectUrl) {
              chrome.tabs.update(tabId, { url: redirectUrl }).catch(() => {});
            }
          });
        }
        debouncedAlert(`⚠️ พยายามเปิดหน้าเว็บที่ไม่ได้รับอนุญาต: ${changeInfo.url}`);
      }
    }
  });
});

// 3. ตรวจจับการปิดแท็บข้อสอบก่อนกดส่ง (Exam Tab Closed Unexpectedly)
chrome.tabs.onRemoved.addListener((tabId, removeInfo) => {
  chrome.storage.local.get(["isExamActive", "examTabId"], (data) => {
    if (data.isExamActive && tabId === data.examTabId) {
      sendAlertToAdmin("🚨 แท็บข้อสอบถูกปิดก่อนส่งคำตอบ!", true);
      chrome.storage.local.set({ isExamActive: false, examTabId: null, examWindowId: null });
      updateBadge(false);
    }
  });
});

// 4. ห้ามสลับหน้าต่าง หรือเปิดโปรแกรมอื่นทับ (Window Focus Enforcement)
chrome.windows.onFocusChanged.addListener((windowId) => {
  chrome.storage.local.get(["isExamActive", "examWindowId", "examTabId"], (data) => {
    if (!data.isExamActive) return;

    if (windowId === chrome.windows.WINDOW_ID_NONE || (data.examWindowId && windowId !== data.examWindowId)) {
      debouncedAlert("⚠️ ตรวจพบการสลับหน้าต่างไปโปรแกรมอื่น หรือย่อหน้าจอเบราว์เซอร์");

      // บังคับดึงหน้าต่างสอบกลับมาโฟกัส และเข้าโหมด Fullscreen ทันที
      if (data.examWindowId) {
        setTimeout(() => {
          chrome.windows.update(data.examWindowId, {
            focused: true,
            state: "fullscreen",
            drawAttention: true
          }).catch(() => {});
          if (data.examTabId) {
            chrome.tabs.update(data.examTabId, { active: true }).catch(() => {});
          }
        }, 300);
      }
    }
  });
});

// 5. รับข้อความสื่อสารจาก content.js หรือ popup.js
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "START_EXAM") {
    const studentId = message.studentId || "ผู้สอบ";
    const examTabId = message.tabId || (sender && sender.tab && sender.tab.id);
    let examWindowId = message.windowId || (sender && sender.tab && sender.tab.windowId);
    const formTitle = message.formTitle || "Google Forms";
    const activeExamUrl = message.targetUrl || (sender && sender.tab && sender.tab.url);

    const doStart = (winId) => {
      chrome.storage.local.set({
        isExamActive: true,
        studentId: studentId,
        examTabId: examTabId,
        examWindowId: winId,
        activeExamUrl: activeExamUrl
      }, () => {
        updateBadge(true);
        if (winId) {
          chrome.windows.update(winId, { state: "fullscreen", focused: true }).catch(() => {});
        }
        if (examTabId) {
          chrome.tabs.get(examTabId, (tab) => {
            const isForms = tab && tab.url && (tab.url.includes("docs.google.com/forms") || tab.url.includes("forms.gle"));
            if (!isForms && activeExamUrl) {
              // แท็บไม่ได้อยู่ที่หน้า Google Forms ให้นำทางไปยังหน้าข้อสอบทันที
              chrome.tabs.update(examTabId, { url: activeExamUrl, active: true }).catch(() => {});
            } else {
              chrome.tabs.update(examTabId, { active: true }).catch(() => {});
            }
            chrome.tabs.sendMessage(examTabId, {
              type: "ACTIVATE_PROCTORING",
              studentId: studentId,
              targetUrl: activeExamUrl
            }).catch(() => {});
          });
        }
        sendAlertToAdmin(`🟢 เริ่มเข้าทำข้อสอบ: ${formTitle}`, false, studentId);
        sendResponse({ success: true });
      });
    };

    if (!examWindowId) {
      chrome.windows.getLastFocused((w) => {
        doStart(w ? w.id : null);
      });
    } else {
      doStart(examWindowId);
    }
    return true;
  } else if (message.type === "STOP_EXAM") {
    chrome.storage.local.get(["examWindowId"], (data) => {
      if (data.examWindowId) {
        chrome.windows.update(data.examWindowId, { state: "maximized" }).catch(() => {});
      }
      chrome.storage.local.set({ isExamActive: false, examTabId: null, examWindowId: null }, () => {
        updateBadge(false);
        sendResponse({ success: true });
      });
    });
    return true;
  } else if (message.type === "VIOLATION") {
    chrome.storage.local.get(["isExamActive"], (data) => {
      if (data.isExamActive) {
        debouncedAlert(message.detail);
      }
    });
    sendResponse({ received: true });
  } else if (message.type === "EXAM_STARTED") {
    sendAlertToAdmin(`🟢 เริ่มเข้าทำข้อสอบ: ${message.formTitle || "Google Forms"}`, false, message.studentId);
    sendResponse({ received: true });
  } else if (message.type === "EXAM_SUBMITTED") {
    chrome.storage.local.get(["isExamActive", "examWindowId"], (data) => {
      if (data.isExamActive) {
        sendAlertToAdmin("✅ ผู้สอบส่งข้อสอบเรียบร้อยแล้ว (ระบบปลดล็อกอัตโนมัติ)");
        if (data.examWindowId) {
          chrome.windows.update(data.examWindowId, { state: "maximized" }).catch(() => {});
        }
        chrome.storage.local.set({ isExamActive: false, examTabId: null, examWindowId: null });
        updateBadge(false);
      }
    });
    sendResponse({ received: true });
  }
  return true;
});