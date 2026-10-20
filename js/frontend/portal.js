/**
 * Student Exam Portal Engine (for index.html)
 * Version: v5.2
 */

let currentEntryRoom = null;

function renderPortalRooms() {
  const container = document.getElementById("portalRoomsGrid");
  if (!container) return;

  const searchQuery = (document.getElementById("portalSearchInput") ? document.getElementById("portalSearchInput").value : "").trim().toLowerCase();
  const categoryFilter = (document.getElementById("portalCategoryFilter") ? document.getElementById("portalCategoryFilter").value : "all") || "all";

  const rooms = allRooms.length > 0 ? allRooms : getStoredRooms();
  // หน้ารวมข้อสอบแสดงเฉพาะห้องที่เปิดรับอยู่เท่านั้น (status === "OPEN")
  const activeRooms = rooms.filter(r => r.status === "OPEN");

  if (activeRooms.length === 0) {
    container.innerHTML = `
      <div class="portal-empty-state" style="grid-column: 1 / -1; padding: 48px 16px;">
        <div style="font-size: 48px; margin-bottom: 10px;">🏖️</div>
        <h3 style="font-size: 17px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">ขณะนี้ยังไม่มีห้องสอบที่เปิดรับ</h3>
        <p style="font-size: 13.5px; color: var(--text-muted); max-width: 400px; margin: 0 auto;">
          กรุณารอครูผู้สอนเปิดรับนักเรียนเข้าสอบ หรือสอบถามรหัสเข้าห้องสอบจากครูผู้คุมสอบ
        </p>
      </div>
    `;
    return;
  }

  const filtered = activeRooms.filter((r) => {
    if (searchQuery && !String(r.title || "").toLowerCase().includes(searchQuery) && !String(r.gradeLevel || "").toLowerCase().includes(searchQuery)) {
      return false;
    }
    if (categoryFilter !== "all" && r.category !== categoryFilter) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="portal-empty-state" style="grid-column: 1 / -1; padding: 36px 16px;">
        <p style="font-size: 14px; color: var(--text-muted);">ไม่พบห้องสอบที่ตรงกับคำค้นหาของคุณ</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((r) => `
    <div class="portal-room-card">
      <div class="portal-card-badges">
        <span class="badge badge-primary" style="font-size: 11px;">${escapeHtml(r.category || "ทั่วไป")}</span>
        <span class="badge badge-neutral" style="font-size: 11px;">${escapeHtml(r.gradeLevel || "ทุกระดับชั้น")}</span>
      </div>
      <h3 class="portal-card-title">${escapeHtml(r.title)}</h3>
      <div class="portal-card-meta">
        <span class="live-dot" style="width: 7px; height: 7px; background: #059669; border-radius: 50%; display: inline-block;"></span>
        <span>เปิดรับนักเรียนเข้าสอบ</span>
      </div>
      <button 
        type="button" 
        class="btn btn-primary btn-block portal-enter-btn" 
        data-room-id="${escapeHtml(r.roomId)}"
        style="margin-top: 14px; font-weight: 700;"
      >
        🚀 เข้าสู่ห้องสอบ
      </button>
    </div>
  `).join("");

  // ผูกปุ่มเข้าสู่ห้องสอบ
  container.querySelectorAll(".portal-enter-btn").forEach((btn) => {
    btn.onclick = () => {
      const roomId = btn.getAttribute("data-room-id");
      const room = activeRooms.find(r => r.roomId === roomId);
      if (room) openRoomEntryModal(room);
    };
  });
}

function openRoomEntryModal(room) {
  currentEntryRoom = room;
  const modal = document.getElementById("roomEntryModal");
  const titleEl = document.getElementById("entryModalRoomTitle");
  const catEl = document.getElementById("entryModalRoomCategory");
  const errEl = document.getElementById("entryErrorMessage");
  const passInput = document.getElementById("entryPasscodeInput");

  if (titleEl) titleEl.textContent = room.title;
  if (catEl) catEl.textContent = `${room.category || "ทั่วไป"} • ${room.gradeLevel || ""}`;
  if (errEl) errEl.style.display = "none";
  if (passInput) passInput.value = "";

  if (modal) modal.classList.add("active");
  setTimeout(() => { if (passInput) passInput.focus(); }, 120);
}

function handleConfirmRoomEntry() {
  if (!currentEntryRoom) return;

  const passInput = document.getElementById("entryPasscodeInput");
  const errEl = document.getElementById("entryErrorMessage");
  const enteredPass = (passInput ? passInput.value : "").trim();

  // ตรวจสอบรหัสเข้าห้องสอบสำหรับนักเรียน (6 หลัก)
  const expectedPass = String(currentEntryRoom.entryCode || "").trim();
  if (expectedPass && enteredPass !== expectedPass) {
    if (errEl) {
      errEl.textContent = "รหัสเข้าห้องสอบไม่ถูกต้อง กรุณาตรวจสอบกับครูผู้คุมสอบ";
      errEl.style.display = "block";
    }
    if (passInput) {
      passInput.select();
      passInput.focus();
    }
    return;
  }

  const modal = document.getElementById("roomEntryModal");
  if (modal) modal.classList.remove("active");

  const encoded = encodeExamConfig(currentEntryRoom);
  const examUrl = new URL("exam.html", window.location.href);
  examUrl.searchParams.set("data", encoded);
  examUrl.searchParams.set("entry", enteredPass);

  window.open(examUrl.toString(), "_blank");
}

function populatePortalFilters() {
  const catFilter = document.getElementById("portalCategoryFilter");
  if (catFilter) {
    catFilter.innerHTML = `<option value="all">ทุกกลุ่มสาระ / หมวดหมู่</option>` +
      SUBJECT_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  }
}

async function fetchPortalAnnouncement() {
  const banner = document.getElementById("portalAnnouncementBanner");
  const textEl = document.getElementById("portalAnnouncementText");
  if (!banner || !textEl) return;

  try {
    const webhookUrl = typeof getEffectiveWebhookUrl === "function" 
      ? getEffectiveWebhookUrl() 
      : (localStorage.getItem("examCustomWebhookUrl") || DEFAULT_WEBHOOK_URL);
    const url = new URL(webhookUrl);
    url.searchParams.set("action", "getSystemConfig");
    const fetchFn = typeof fetchWithTimeout === "function" ? fetchWithTimeout : fetch;
    const res = await fetchFn(url.toString(), {}, 4000);
    if (!res || !res.ok) return;
    const json = await res.json();
    if (json && json.status === "success" && json.data) {
      const ann = String(json.data.portalAnnouncement || "").trim();
      if (ann) {
        textEl.textContent = ann;
        banner.style.display = "block";
      }
    }
  } catch (_) {}
}

document.addEventListener("DOMContentLoaded", () => {
  setupMobileNavigation();
  applyRoleUI();
  populatePortalFilters();

  allRooms = getStoredRooms();
  renderPortalRooms();

  fetchPortalAnnouncement();

  fetchCloudRooms(() => {
    renderPortalRooms();
  }, true);

  const portalRefreshBtn = document.getElementById("portalRefreshBtn");
  if (portalRefreshBtn) {
    portalRefreshBtn.addEventListener("click", () => {
      fetchCloudRooms(() => {
        renderPortalRooms();
        showAlert("รีเฟรชรายการห้องสอบเรียบร้อยแล้ว", { type: "info" });
      }, true);
    });
  }

  const portalSearchInput = document.getElementById("portalSearchInput");
  if (portalSearchInput) {
    portalSearchInput.addEventListener("input", renderPortalRooms);
  }

  const portalCategoryFilter = document.getElementById("portalCategoryFilter");
  if (portalCategoryFilter) {
    portalCategoryFilter.addEventListener("change", renderPortalRooms);
  }

  const confirmEntryBtn = document.getElementById("confirmEntryBtn");
  if (confirmEntryBtn) {
    confirmEntryBtn.addEventListener("click", handleConfirmRoomEntry);
  }

  const entryPassInput = document.getElementById("entryPasscodeInput");
  if (entryPassInput) {
    entryPassInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") handleConfirmRoomEntry();
    });
  }

  const closeEntryBtn = document.getElementById("closeEntryModalBtn");
  const cancelEntryBtn = document.getElementById("cancelEntryModalBtn");
  const roomEntryModal = document.getElementById("roomEntryModal");
  const closeEntryModal = () => {
    if (roomEntryModal) roomEntryModal.classList.remove("active");
  };
  if (closeEntryBtn) closeEntryBtn.addEventListener("click", closeEntryModal);
  if (cancelEntryBtn) cancelEntryBtn.addEventListener("click", closeEntryModal);
});
