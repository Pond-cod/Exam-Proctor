/**
 * Exam Rooms Management Engine (for rooms.html)
 * Version: v5.3
 * Handles room filtering, toggling active status, copying links, QR codes,
 * and Admin editing / deletion.
 */

function isRoomOwnedByUser(room, user) {
  if (!user) return false;
  if (user.role && String(user.role).toUpperCase() === USER_ROLES.ADMIN) return true;

  const curUser = String(user.username || "").trim().toLowerCase();
  const curName = String(user.displayName || "").trim().toLowerCase();
  const curId = String(user.userId || "").trim();

  // 1. เช็ค creatorUsername
  if (room.creatorUsername && String(room.creatorUsername).trim().toLowerCase() === curUser) {
    return true;
  }
  // 2. เช็ค creatorId
  if (room.creatorId && curId && String(room.creatorId).trim() === curId) {
    return true;
  }
  // 3. เช็ค createdBy (เช่น "ครูผู้สอน" หรือ "ครูสมชาย")
  if (room.createdBy) {
    const cb = String(room.createdBy).trim().toLowerCase();
    if (cb === curUser || cb === curName || cb.includes(curUser) || cb.includes(curName)) {
      return true;
    }
  }
  // 4. กรณีไม่มีผู้สร้างระบุไว้ชัดเจน (ห้องเก่า) หากเป็น user เริ่มต้น 'teacher' และห้องไม่ได้ระบุ admin ให้ครูเห็นได้
  if (!room.creatorUsername && (!room.createdBy || room.createdBy === "User" || room.createdBy === "ครูผู้สอน") && curUser === "teacher") {
    return true;
  }
  return false;
}

function populateRoomsDropdowns() {
  const catFilter = document.getElementById("historyCategoryFilter");
  const gradeFilter = document.getElementById("historyGradeFilter");
  const editCat = document.getElementById("editRoomCategorySelect");
  const editGrade = document.getElementById("editRoomGradeSelect");
  const creatorFilterBox = document.getElementById("historyCreatorFilterBox");
  const creatorFilter = document.getElementById("historyCreatorFilter");

  if (catFilter) {
    catFilter.innerHTML = `<option value="all">ทุกหมวดหมู่ / กลุ่มสาระ</option>` +
      SUBJECT_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  }

  if (gradeFilter) {
    gradeFilter.innerHTML = `<option value="all">ทุกระดับชั้น</option>` +
      GRADE_LEVELS.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  }

  if (editCat) {
    editCat.innerHTML = SUBJECT_CATEGORIES.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
  }

  if (editGrade) {
    editGrade.innerHTML = GRADE_LEVELS.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join("");
  }

  const isAdmin = typeof isCurrentUserAdmin === "function" ? isCurrentUserAdmin() : false;
  if (creatorFilterBox && creatorFilter) {
    if (isAdmin) {
      creatorFilterBox.style.display = "block";
      const rooms = allRooms.length > 0 ? allRooms : getStoredRooms();
      const creatorSet = new Set();
      rooms.forEach(r => {
        const name = r.createdBy || r.creatorUsername;
        if (name) creatorSet.add(name);
      });
      const creatorList = Array.from(creatorSet);
      creatorFilter.innerHTML = `<option value="all">👥 ทุกผู้สร้างห้องสอบ</option>` +
        creatorList.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join("");
    } else {
      creatorFilterBox.style.display = "none";
    }
  }
}

function renderRoomHistory() {
  const container = document.getElementById("historyRoomsList");
  if (!container) return;

  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const isAdmin = typeof isCurrentUserAdmin === "function" ? isCurrentUserAdmin() : false;

  // อัปเดต Scope Badge หัวตาราง
  const scopeBadge = document.getElementById("roomsScopeBadge");
  if (scopeBadge) {
    if (isAdmin) {
      scopeBadge.textContent = "🛡️ สิทธิ์ Admin: แสดงห้องสอบทั้งหมดในระบบ (All Rooms)";
      scopeBadge.className = "badge badge-danger";
    } else {
      const uName = currentUser ? (currentUser.displayName || currentUser.username || "ครูผู้สอน") : "ฉัน";
      scopeBadge.textContent = `👨‍🏫 สิทธิ์ครู: แสดงเฉพาะห้องสอบของ ${uName}`;
      scopeBadge.className = "badge badge-primary";
    }
  }

  const searchQuery = (document.getElementById("historySearchInput") ? document.getElementById("historySearchInput").value : "").trim().toLowerCase();
  const categoryFilter = (document.getElementById("historyCategoryFilter") ? document.getElementById("historyCategoryFilter").value : "all") || "all";
  const gradeFilter = (document.getElementById("historyGradeFilter") ? document.getElementById("historyGradeFilter").value : "all") || "all";
  const statusFilter = (document.getElementById("historyStatusFilter") ? document.getElementById("historyStatusFilter").value : "all") || "all";
  const creatorFilter = (isAdmin && document.getElementById("historyCreatorFilter")) ? document.getElementById("historyCreatorFilter").value : "all";

  const allSystemRooms = allRooms.length > 0 ? allRooms : getStoredRooms();

  // กรองตามสิทธิ์: Admin ดูทั้งหมด, ครูผู้สอนดูเฉพาะห้องของตนเอง
  const accessibleRooms = isAdmin ? allSystemRooms : allSystemRooms.filter(r => isRoomOwnedByUser(r, currentUser));

  if (accessibleRooms.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 48px 16px; color: var(--text-muted);">
        <div style="font-size: 42px; margin-bottom: 10px;">📋</div>
        <h4 style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">${isAdmin ? "ยังไม่มีข้อมูลห้องสอบในระบบ" : "คุณยังไม่มีห้องสอบที่สร้างไว้"}</h4>
        <p style="font-size: 13px;">คุณสามารถสร้างห้องสอบแรกได้ที่เมนู <a href="create.html" style="color: var(--primary); font-weight: 700; text-decoration: underline;">➕ สร้างห้องสอบ</a></p>
      </div>
    `;
    return;
  }

  const filtered = accessibleRooms.filter((r) => {
    if (searchQuery && !String(r.title || "").toLowerCase().includes(searchQuery) && !String(r.roomId || "").toLowerCase().includes(searchQuery)) {
      return false;
    }
    if (categoryFilter !== "all" && r.category !== categoryFilter) {
      return false;
    }
    if (gradeFilter !== "all" && r.gradeLevel !== gradeFilter) {
      return false;
    }
    if (statusFilter !== "all" && r.status !== statusFilter) {
      return false;
    }
    if (isAdmin && creatorFilter !== "all") {
      const matchCreator = (r.creatorUsername && r.creatorUsername === creatorFilter) || (r.createdBy && r.createdBy === creatorFilter);
      if (!matchCreator) return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
        <p style="font-size: 14px;">ไม่พบห้องสอบที่ตรงกับเงื่อนไขการค้นหา</p>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((r) => {
    const isOpen = r.status === "OPEN";
    const statusBadge = isOpen
      ? `<span class="badge badge-success" style="font-weight: 700;">🟢 กำลังเปิดสอบ (OPEN)</span>`
      : `<span class="badge badge-neutral" style="font-weight: 700; color: #dc2626; background: #fef2f2; border: 1px solid #fecaca;">🔴 ปิดห้องสอบ (CLOSED)</span>`;

    const canManage = isAdmin || isRoomOwnedByUser(r, currentUser);

    // Ensure full exam URL is present
    let roomExamUrl = r.examUrl;
    if (!roomExamUrl) {
      try {
        const encoded = encodeExamConfig(r);
        const examRelPath = window.location.pathname.includes("/admin/") ? "../exam.html" : "exam.html";
        const baseUrl = new URL(examRelPath, window.location.href);
        baseUrl.searchParams.set("data", encoded);
        roomExamUrl = baseUrl.toString();
      } catch (_) {
        roomExamUrl = "#";
      }
    }

    const creatorDisplayName = r.createdBy || r.creatorUsername || "ครูผู้สอน";
    const creatorUserTag = r.creatorUsername ? ` (@${escapeHtml(r.creatorUsername)})` : "";

    return `
      <div class="room-mgmt-card" style="background: #ffffff; border: 1.5px solid var(--bg-card-border); border-radius: var(--radius-md); padding: 16px 20px; margin-bottom: 14px; box-shadow: var(--shadow-sm);">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; flex-wrap: wrap; gap: 10px; margin-bottom: 10px;">
          <div style="flex: 1; min-width: 240px;">
            <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 4px;">
              <strong style="font-size: 16px; color: var(--text-primary);">${escapeHtml(r.title)}</strong>
              ${statusBadge}
            </div>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; align-items: center; margin-top: 4px;">
              <span class="badge badge-neutral" style="font-size: 11.5px;">📁 ${escapeHtml(r.category || "ทั่วไป")}</span>
              <span class="badge badge-neutral" style="font-size: 11.5px;">🎓 ${escapeHtml(r.gradeLevel || "ไม่ระบุ")}</span>
              <span class="badge badge-neutral" style="font-size: 11.5px; background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe;">
                👤 ผู้สร้าง: <strong>${escapeHtml(creatorDisplayName)}</strong>${creatorUserTag}
              </span>
              <span style="font-size: 12px; color: var(--text-muted);">รหัสห้อง: <code>${escapeHtml(r.roomId || "-")}</code></span>
            </div>
          </div>

          <div style="display: flex; gap: 6px; flex-wrap: wrap;">
            <!-- สลับเปิด/ปิดสถานะสอบ (เจ้าของห้อง หรือ Admin) -->
            ${canManage ? `
              <button 
                type="button" 
                class="btn ${isOpen ? "btn-secondary" : "btn-success"} btn-toggle-status" 
                data-room-id="${escapeHtml(r.roomId)}" 
                style="min-height: 36px; padding: 6px 12px; font-size: 12.5px;"
                title="${isOpen ? "คลิกเพื่อปิดห้องสอบชั่วคราว" : "คลิกเพื่อเปิดรับนักเรียนเข้าสอบ"}"
              >
                ${isOpen ? "⏸️ พักการสอบ" : "▶️ เปิดรับเข้าสอบ"}
              </button>
            ` : ""}

            <!-- คัดลอกลิงก์ -->
            <button 
              type="button" 
              class="btn btn-secondary btn-copy-room-link" 
              data-url="${escapeHtml(roomExamUrl)}" 
              style="min-height: 36px; padding: 6px 12px; font-size: 12.5px;"
            >
              📋 คัดลอกลิงก์
            </button>

            <!-- แสดง QR Code -->
            <button 
              type="button" 
              class="btn btn-secondary btn-show-room-qr" 
              data-room-id="${escapeHtml(r.roomId)}" 
              style="min-height: 36px; padding: 6px 12px; font-size: 12.5px;"
            >
              🔍 QR Code
            </button>

            <!-- แก้ไข และ ลบ (เจ้าของห้อง หรือ Admin) -->
            ${canManage ? `
              <button 
                type="button" 
                class="btn btn-secondary btn-edit-room" 
                data-room-id="${escapeHtml(r.roomId)}" 
                style="min-height: 36px; padding: 6px 12px; font-size: 12.5px;"
              >
                ✏️ แก้ไข
              </button>
              <button 
                type="button" 
                class="btn btn-danger btn-delete-room" 
                data-room-id="${escapeHtml(r.roomId)}" 
                style="min-height: 36px; padding: 6px 12px; font-size: 12.5px;"
              >
                🗑️ ลบ
              </button>
            ` : ""}
          </div>
        </div>

        <!-- แถบแสดงรหัส 2 รูปแบบ -->
        <div style="display: flex; gap: 12px; flex-wrap: wrap; background: var(--bg-subtle); padding: 8px 14px; border-radius: var(--radius-sm); align-items: center;">
          <div style="font-size: 12.5px;">
            <span style="color: #1e40af; font-weight: 700;">🎓 รหัสเข้าสอบนักเรียน:</span>
            <code style="font-size: 15px; font-weight: 800; color: #1d4ed8; letter-spacing: 0.1em; margin-left: 4px;">${escapeHtml(r.entryCode || "-")}</code>
          </div>
          <div style="font-size: 12.5px; border-left: 1.5px solid #cbd5e1; padding-left: 12px;">
            <span style="color: #991b1b; font-weight: 700;">🔒 รหัสคุมสอบ (Passcode 6 หลัก):</span>
            <code style="font-size: 15px; font-weight: 800; color: #b91c1c; letter-spacing: 0.1em; margin-left: 4px;">${escapeHtml(r.adminPasscode || "-")}</code>
          </div>
          <div style="font-size: 12px; color: var(--text-muted); margin-left: auto;">
            สร้างเมื่อ: ${escapeHtml(r.createdAt || "-")}
          </div>
        </div>
      </div>
    `;
  }).join("");

  // ผูก Event Listeners สำหรับปุ่มในการ์ดห้องสอบ
  container.querySelectorAll(".btn-copy-room-link").forEach((btn) => {
    btn.onclick = () => {
      const url = btn.getAttribute("data-url");
      if (url && url !== "#") {
        navigator.clipboard.writeText(url).then(() => {
          const orig = btn.textContent;
          btn.textContent = "คัดลอกแล้ว!";
          setTimeout(() => { btn.textContent = orig; }, 2000);
        });
      }
    };
  });

  container.querySelectorAll(".btn-show-room-qr").forEach((btn) => {
    btn.onclick = () => {
      const roomId = btn.getAttribute("data-room-id");
      const room = (allRooms.length > 0 ? allRooms : getStoredRooms()).find(r => r.roomId === roomId);
      if (!room) return;

      let roomExamUrl = room.examUrl;
      if (!roomExamUrl) {
        try {
          const encoded = encodeExamConfig(room);
          const examRelPath = window.location.pathname.includes("/admin/") ? "../exam.html" : "exam.html";
          const baseUrl = new URL(examRelPath, window.location.href);
          baseUrl.searchParams.set("data", encoded);
          roomExamUrl = baseUrl.toString();
        } catch (_) {}
      }

      const projectorModal = document.getElementById("qrProjectorModal");
      const projectorContainer = document.getElementById("projectorQrContainer");
      const projectorTitle = document.getElementById("projectorExamTitle");
      const projectorEntry = document.getElementById("projectorEntryCodeDisplay");
      const projectorPasscode = document.getElementById("projectorPasscodeDisplay");

      if (projectorTitle) projectorTitle.textContent = room.title;
      if (projectorEntry) projectorEntry.textContent = room.entryCode || "------";
      if (projectorPasscode) projectorPasscode.textContent = room.adminPasscode || "------";
      if (projectorContainer && roomExamUrl) {
        generateQrCode(projectorContainer, roomExamUrl, 320);
      }
      if (projectorModal) projectorModal.classList.add("active");
    };
  });

  container.querySelectorAll(".btn-toggle-status").forEach((btn) => {
    btn.onclick = () => {
      const roomId = btn.getAttribute("data-room-id");
      if (roomId) toggleRoomStatus(roomId);
    };
  });

  container.querySelectorAll(".btn-edit-room").forEach((btn) => {
    btn.onclick = () => {
      const roomId = btn.getAttribute("data-room-id");
      if (roomId) openEditRoomModal(roomId);
    };
  });

  container.querySelectorAll(".btn-delete-room").forEach((btn) => {
    btn.onclick = () => {
      const roomId = btn.getAttribute("data-room-id");
      if (roomId) deleteRoom(roomId);
    };
  });
}

// สลับสถานะเปิด/ปิดห้องสอบ (Toggle Open / Closed) — ทำได้ทั้ง Admin และเจ้าของห้องสอบ
async function toggleRoomStatus(roomId) {
  let rooms = getStoredRooms();
  const room = rooms.find(r => r.roomId === roomId);
  if (!room) return;

  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const isAdmin = typeof isCurrentUserAdmin === "function" ? isCurrentUserAdmin() : false;

  if (!isAdmin && !isRoomOwnedByUser(room, currentUser)) {
    showAlert("คุณสามารถเปิด/ปิดได้เฉพาะห้องสอบที่คุณเป็นผู้สร้างเท่านั้น", {
      type: "warning",
      confirmText: "เข้าใจแล้ว"
    });
    return;
  }

  const newStatus = room.status === "OPEN" ? "CLOSED" : "OPEN";
  room.status = newStatus;
  setStoredRooms(rooms);
  allRooms = rooms;

  syncRoomToCloud("toggleRoomStatus", { roomId, status: newStatus });

  renderRoomHistory();

  const msg = newStatus === "OPEN" 
    ? `เปิดรับนักเรียนเข้าสอบวิชา "${room.title}" เรียบร้อยแล้ว` 
    : `ปิดห้องสอบวิชา "${room.title}" ชั่วคราวแล้ว`;
  showAlert(msg, { type: "info", confirmText: "ตกลง" });
}

// ลบห้องสอบ — เฉพาะ Role Admin หรือเจ้าของห้องสอบ
async function deleteRoom(roomId) {
  let rooms = getStoredRooms();
  const room = rooms.find(r => r.roomId === roomId);
  if (!room) return;

  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const isAdmin = typeof isCurrentUserAdmin === "function" ? isCurrentUserAdmin() : false;

  if (!isAdmin && !isRoomOwnedByUser(room, currentUser)) {
    showAlert("คุณสามารถลบได้เฉพาะห้องสอบที่คุณเป็นผู้สร้างเท่านั้น", {
      type: "warning",
      confirmText: "เข้าใจแล้ว"
    });
    return;
  }

  const confirmed = await showConfirm(
    `คุณแน่ใจหรือไม่ว่าต้องการลบห้องสอบ "${room.title}" (รหัส: ${roomId})?\n\nการกระทำนี้จะนำห้องสอบออกจากระบบและหน้ารวมข้อสอบทันที`,
    {
      title: "ยืนยันการลบห้องสอบ",
      confirmText: "ลบห้องสอบ",
      cancelText: "ยกเลิก",
      confirmClass: "danger",
      icon: "🗑️"
    }
  );

  if (confirmed) {
    rooms = rooms.filter(r => r.roomId !== roomId);
    setStoredRooms(rooms);
    allRooms = rooms;

    syncRoomToCloud("deleteRoom", { roomId });

    renderRoomHistory();
    showAlert("ลบห้องสอบเรียบร้อยแล้ว", { type: "success", confirmText: "ตกลง" });
  }
}

// เปิด Modal แก้ไขข้อมูลห้องสอบ — เฉพาะ Role Admin หรือเจ้าของห้องสอบ
function openEditRoomModal(roomId) {
  const room = (allRooms.length > 0 ? allRooms : getStoredRooms()).find(r => r.roomId === roomId);
  if (!room) return;

  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const isAdmin = typeof isCurrentUserAdmin === "function" ? isCurrentUserAdmin() : false;

  if (!isAdmin && !isRoomOwnedByUser(room, currentUser)) {
    showAlert("คุณสามารถแก้ไขได้เฉพาะห้องสอบที่คุณเป็นผู้สร้างเท่านั้น", {
      type: "warning",
      confirmText: "เข้าใจแล้ว"
    });
    return;
  }

  const modal = document.getElementById("editRoomModal");
  const subEl = document.getElementById("editRoomSubtitle");
  const idInput = document.getElementById("editRoomIdInput");
  const titleInput = document.getElementById("editRoomTitleInput");
  const catSel = document.getElementById("editRoomCategorySelect");
  const gradeSel = document.getElementById("editRoomGradeSelect");
  const formInput = document.getElementById("editRoomFormUrlInput");
  const statusSel = document.getElementById("editRoomStatusSelect");
  const entryInput = document.getElementById("editRoomEntryCodeInput");
  const passInput = document.getElementById("editRoomAdminPasscodeInput");

  if (subEl) subEl.textContent = `รหัสห้อง: ${room.roomId}`;
  if (idInput) idInput.value = room.roomId;
  if (titleInput) titleInput.value = room.title || "";
  if (catSel) catSel.value = room.category || "ทั่วไป (General)";
  if (gradeSel) gradeSel.value = room.gradeLevel || "ไม่ระบุ (All / Not Specified)";
  if (formInput) formInput.value = room.formUrl || "";
  if (statusSel) statusSel.value = room.status || "OPEN";
  if (entryInput) entryInput.value = room.entryCode || "";
  if (passInput) passInput.value = room.adminPasscode || "";

  if (modal) modal.classList.add("active");
}

// บันทึกการแก้ไขห้องสอบ
async function handleSaveEditRoom() {
  const roomId = (document.getElementById("editRoomIdInput").value || "").trim();
  const title = (document.getElementById("editRoomTitleInput").value || "").trim();
  const category = (document.getElementById("editRoomCategorySelect").value || "").trim();
  const gradeLevel = (document.getElementById("editRoomGradeSelect").value || "").trim();
  const formUrl = (document.getElementById("editRoomFormUrlInput").value || "").trim();
  const status = (document.getElementById("editRoomStatusSelect").value || "OPEN").trim();
  const entryCode = (document.getElementById("editRoomEntryCodeInput").value || "").trim();
  const adminPasscode = (document.getElementById("editRoomAdminPasscodeInput").value || "").trim();

  if (!title || !formUrl) {
    showAlert("กรุณากรอกชื่อวิชาและลิงก์ Google Forms ให้ครบถ้วน", { type: "warning" });
    return;
  }

  let rooms = getStoredRooms();
  const idx = rooms.findIndex(r => r.roomId === roomId);
  if (idx === -1) return;

  const currentUser = typeof getCurrentUser === "function" ? getCurrentUser() : null;
  const isAdmin = typeof isCurrentUserAdmin === "function" ? isCurrentUserAdmin() : false;

  if (!isAdmin && !isRoomOwnedByUser(rooms[idx], currentUser)) {
    showAlert("คุณสามารถแก้ไขได้เฉพาะห้องสอบที่คุณเป็นผู้สร้างเท่านั้น", {
      type: "warning",
      confirmText: "เข้าใจแล้ว"
    });
    return;
  }

  const cleanForm = formatGoogleFormEmbedUrl(formUrl);
  const updatedRoom = {
    ...rooms[idx],
    title,
    category,
    gradeLevel,
    formUrl: cleanForm,
    status,
    entryCode,
    adminPasscode,
    updatedAt: new Date().toLocaleString("th-TH")
  };

  // สร้างลิงก์ใหม่ด้วย config ที่อัปเดต
  const encoded = encodeExamConfig(updatedRoom);
  const examRelPath = window.location.pathname.includes("/admin/") ? "../exam.html" : "exam.html";
  const baseUrl = new URL(examRelPath, window.location.href);
  baseUrl.searchParams.set("data", encoded);
  updatedRoom.examUrl = baseUrl.toString();

  rooms[idx] = updatedRoom;
  setStoredRooms(rooms);
  allRooms = rooms;

  syncRoomToCloud("updateRoom", updatedRoom);

  const modal = document.getElementById("editRoomModal");
  if (modal) modal.classList.remove("active");

  renderRoomHistory();
  showAlert("บันทึกการแก้ไขข้อมูลห้องสอบเรียบร้อยแล้ว", { type: "success" });
}

document.addEventListener("DOMContentLoaded", () => {
  if (typeof requireAuth === "function" && !requireAuth()) return;

  setupMobileNavigation();
  applyRoleUI();
  populateRoomsDropdowns();

  allRooms = getStoredRooms();
  renderRoomHistory();

  fetchCloudRooms(() => {
    populateRoomsDropdowns();
    renderRoomHistory();
  });

  const refreshBtn = document.getElementById("refreshHistoryBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      fetchCloudRooms(() => {
        renderRoomHistory();
        showAlert("ดึงข้อมูลห้องสอบจากระบบคลาวด์เรียบร้อยแล้ว", { type: "info" });
      });
    });
  }

  const historySearchInput = document.getElementById("historySearchInput");
  if (historySearchInput) {
    historySearchInput.addEventListener("input", renderRoomHistory);
  }

  const historyCategoryFilter = document.getElementById("historyCategoryFilter");
  if (historyCategoryFilter) {
    historyCategoryFilter.addEventListener("change", renderRoomHistory);
  }

  const historyGradeFilter = document.getElementById("historyGradeFilter");
  if (historyGradeFilter) {
    historyGradeFilter.addEventListener("change", renderRoomHistory);
  }

  const historyStatusFilter = document.getElementById("historyStatusFilter");
  if (historyStatusFilter) {
    historyStatusFilter.addEventListener("change", renderRoomHistory);
  }

  const historyCreatorFilter = document.getElementById("historyCreatorFilter");
  if (historyCreatorFilter) {
    historyCreatorFilter.addEventListener("change", renderRoomHistory);
  }

  // Edit Room Modal bindings
  const saveEditBtn = document.getElementById("saveEditRoomBtn");
  if (saveEditBtn) {
    saveEditBtn.addEventListener("click", handleSaveEditRoom);
  }

  const closeEditBtn = document.getElementById("closeEditRoomModalBtn");
  const cancelEditBtn = document.getElementById("cancelEditRoomBtn");
  const editModal = document.getElementById("editRoomModal");
  const closeEditModal = () => {
    if (editModal) editModal.classList.remove("active");
  };
  if (closeEditBtn) closeEditBtn.addEventListener("click", closeEditModal);
  if (cancelEditBtn) cancelEditBtn.addEventListener("click", closeEditModal);

  // QR Projector Modal bindings
  const closeQrProjectorBtn = document.getElementById("closeQrProjectorBtn") || document.getElementById("closeProjectorBtn");
  const qrProjectorModal = document.getElementById("qrProjectorModal");
  if (closeQrProjectorBtn && qrProjectorModal) {
    closeQrProjectorBtn.addEventListener("click", () => {
      qrProjectorModal.classList.remove("active");
    });
  }
});
