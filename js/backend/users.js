/**
 * User Management Engine (for users.html)
 * Version: v5.5
 * Handles CRUD operations for system users (Admin Only)
 */

let localUsers = [];

function populateUsersList() {
  const container = document.getElementById("usersTableBody");
  if (!container) return;

  const searchQuery = (document.getElementById("userSearchInput") ? document.getElementById("userSearchInput").value : "").trim().toLowerCase();
  const roleFilter = (document.getElementById("userRoleFilter") ? document.getElementById("userRoleFilter").value : "all") || "all";
  const statusFilter = (document.getElementById("userStatusFilter") ? document.getElementById("userStatusFilter").value : "all") || "all";

  const users = localUsers.length > 0 ? localUsers : getStoredUsers();

  const filtered = users.filter((u) => {
    if (searchQuery) {
      const matchU = String(u.username || "").toLowerCase().includes(searchQuery);
      const matchN = String(u.displayName || "").toLowerCase().includes(searchQuery);
      if (!matchU && !matchN) return false;
    }
    if (roleFilter !== "all" && String(u.role).toUpperCase() !== roleFilter) {
      return false;
    }
    if (statusFilter !== "all" && String(u.status).toUpperCase() !== statusFilter) {
      return false;
    }
    return true;
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <tr>
        <td colspan="7" style="text-align: center; padding: 36px 16px; color: var(--text-muted);">
          <div style="font-size: 32px; margin-bottom: 8px;">👤</div>
          <p style="font-size: 14px;">ไม่พบข้อมูลผู้ใช้งานที่ตรงกับเงื่อนไขการค้นหา</p>
        </td>
      </tr>
    `;
    return;
  }

  container.innerHTML = filtered.map((u) => {
    const isAdmin = String(u.role).toUpperCase() === "ADMIN";
    const isActive = String(u.status).toUpperCase() === "ACTIVE";
    const isPrimaryAdmin = u.userId === "USR-ADMIN" || u.username === "admin";

    const roleBadge = isAdmin
      ? `<span class="badge badge-danger" style="font-weight: 700;">🛡️ ผู้ดูแลระบบ (Admin)</span>`
      : `<span class="badge badge-primary" style="font-weight: 700;">👨‍🏫 ครูผู้สอน (Teacher)</span>`;

    const statusBadge = isActive
      ? `<span class="badge badge-success" style="font-weight: 700;">🟢 ใช้งานได้</span>`
      : `<span class="badge badge-neutral" style="font-weight: 700; color: #dc2626; background: #fef2f2;">🔴 ระงับการใช้งาน</span>`;

    const lastLoginText = u.lastLogin
      ? new Date(u.lastLogin).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })
      : "-";

    return `
      <tr>
        <td>
          <code style="font-size: 13.5px; font-weight: 700; color: var(--text-primary);">${escapeHtml(u.username || "-")}</code>
        </td>
        <td>
          <strong style="color: var(--text-primary);">${escapeHtml(u.displayName || "-")}</strong>
          ${isPrimaryAdmin ? `<span style="font-size: 10.5px; color: #dc2626; display: block; font-weight: 600;">(บัญชีหลัก Master Admin)</span>` : ""}
        </td>
        <td>${roleBadge}</td>
        <td>
          <span class="masked-passcode" data-pass="${escapeHtml(u.passcode || "")}" style="font-family: monospace; font-size: 14px; font-weight: 700; letter-spacing: 0.12em; color: #1e3a8a; cursor: pointer;" title="คลิกเพื่อดูรหัสผ่าน">
            ••••••
          </span>
        </td>
        <td>${statusBadge}</td>
        <td style="font-size: 12.5px; color: var(--text-muted);">${escapeHtml(lastLoginText)}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button 
              type="button" 
              class="btn btn-secondary btn-sm btn-edit-user" 
              data-user-id="${escapeHtml(u.userId)}"
              style="padding: 4px 10px; font-size: 12px;"
            >
              ✏️ แก้ไข
            </button>
            ${!isPrimaryAdmin ? `
              <button 
                type="button" 
                class="btn btn-danger btn-sm btn-delete-user" 
                data-user-id="${escapeHtml(u.userId)}"
                style="padding: 4px 10px; font-size: 12px;"
              >
                🗑️ ลบ
              </button>
            ` : ""}
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // ผูกการคลิกดูรหัสผ่าน
  container.querySelectorAll(".masked-passcode").forEach((el) => {
    el.onclick = () => {
      const real = el.getAttribute("data-pass");
      if (el.textContent.trim() === "••••••") {
        el.textContent = real;
      } else {
        el.textContent = "••••••";
      }
    };
  });

  // ผูกปุ่มแก้ไข
  container.querySelectorAll(".btn-edit-user").forEach((btn) => {
    btn.onclick = () => {
      const userId = btn.getAttribute("data-user-id");
      openUserModal(userId);
    };
  });

  // ผูกปุ่มลบ
  container.querySelectorAll(".btn-delete-user").forEach((btn) => {
    btn.onclick = () => {
      const userId = btn.getAttribute("data-user-id");
      handleDeleteUser(userId);
    };
  });
}

function openUserModal(userId = null) {
  const modal = document.getElementById("userModal");
  const titleEl = document.getElementById("userModalTitle");
  const idInput = document.getElementById("modalUserIdInput");
  const usernameInput = document.getElementById("modalUsernameInput");
  const nameInput = document.getElementById("modalDisplayNameInput");
  const roleSelect = document.getElementById("modalRoleSelect");
  const passInput = document.getElementById("modalPasscodeInput");
  const statusSelect = document.getElementById("modalStatusSelect");
  const errBox = document.getElementById("userModalError");

  if (errBox) errBox.style.display = "none";

  if (userId) {
    // โหมดแก้ไข (Edit)
    const users = localUsers.length > 0 ? localUsers : getStoredUsers();
    const user = users.find(u => u.userId === userId);
    if (!user) return;

    const isPrimaryAdmin = user.userId === "USR-ADMIN" || user.username === "admin";
    if (titleEl) titleEl.textContent = isPrimaryAdmin ? "✏️ แก้ไขข้อมูลผู้ดูแลระบบหลัก (Master Admin)" : "✏️ แก้ไขข้อมูลผู้ใช้งาน";
    if (idInput) idInput.value = user.userId;
    if (usernameInput) {
      usernameInput.value = user.username || "";
      usernameInput.readOnly = true; // ห้ามแก้ Username หลัก
    }
    if (nameInput) nameInput.value = user.displayName || "";
    if (roleSelect) {
      roleSelect.value = isPrimaryAdmin ? USER_ROLES.ADMIN : (user.role || "TEACHER");
      roleSelect.disabled = isPrimaryAdmin;
    }
    if (passInput) passInput.value = user.passcode || "";
    if (statusSelect) {
      statusSelect.value = isPrimaryAdmin ? "ACTIVE" : (user.status || "ACTIVE");
      statusSelect.disabled = isPrimaryAdmin;
    }
  } else {
    // โหมดเพิ่มใหม่ (Create)
    if (titleEl) titleEl.textContent = "➕ เพิ่มผู้ใช้งานใหม่";
    if (idInput) idInput.value = "";
    if (usernameInput) {
      usernameInput.value = "";
      usernameInput.readOnly = false;
    }
    if (nameInput) nameInput.value = "";
    if (roleSelect) {
      roleSelect.value = "TEACHER";
      roleSelect.disabled = false;
    }
    if (passInput) passInput.value = Math.floor(10000000 + Math.random() * 90000000).toString();
    if (statusSelect) {
      statusSelect.value = "ACTIVE";
      statusSelect.disabled = false;
    }
  }

  if (modal) modal.classList.add("active");
  setTimeout(() => {
    if (!userId && usernameInput) usernameInput.focus();
    else if (nameInput) nameInput.focus();
  }, 100);
}

function closeUserModal() {
  const modal = document.getElementById("userModal");
  if (modal) modal.classList.remove("active");
}

async function handleSaveUser() {
  const idInput = document.getElementById("modalUserIdInput");
  const usernameInput = document.getElementById("modalUsernameInput");
  const nameInput = document.getElementById("modalDisplayNameInput");
  const roleSelect = document.getElementById("modalRoleSelect");
  const passInput = document.getElementById("modalPasscodeInput");
  const statusSelect = document.getElementById("modalStatusSelect");
  const errBox = document.getElementById("userModalError");

  const userId = idInput ? idInput.value.trim() : "";
  const username = usernameInput ? usernameInput.value.trim().toLowerCase() : "";
  const displayName = nameInput ? nameInput.value.trim() : "";
  const role = roleSelect ? roleSelect.value : "TEACHER";
  const passcode = passInput ? passInput.value.trim() : "";
  const status = statusSelect ? statusSelect.value : "ACTIVE";

  if (!username) {
    if (errBox) { errBox.textContent = "กรุณากรอก Username"; errBox.style.display = "block"; }
    if (usernameInput) usernameInput.focus();
    return;
  }

  if (!passcode || passcode.length < 8) {
    if (errBox) { errBox.textContent = "รหัสผ่านเข้าใช้งานต้องมีความยาวอย่างน้อย 8 ตัวอักษร/หลัก"; errBox.style.display = "block"; }
    if (passInput) passInput.focus();
    return;
  }

  let users = localUsers.length > 0 ? localUsers : getStoredUsers();

  if (userId) {
    // บันทึกแก้ไข
    const idx = users.findIndex(u => u.userId === userId);
    if (idx !== -1) {
      const isPrimary = users[idx].userId === "USR-ADMIN" || users[idx].username === "admin";
      users[idx] = {
        ...users[idx],
        displayName: displayName || username,
        role: isPrimary ? USER_ROLES.ADMIN : role,
        passcode: passcode,
        status: isPrimary ? "ACTIVE" : status,
        updatedAt: new Date().toISOString()
      };

      setStoredUsers(users);
      localUsers = users;
      syncUserToCloud("updateUser", users[idx]);
      closeUserModal();
      populateUsersList();
      showAlert("แก้ไขข้อมูลผู้ใช้งานเรียบร้อยแล้ว", { type: "success" });
    }
  } else {
    // เพิ่มผู้ใช้ใหม่
    if (users.some(u => String(u.username).toLowerCase() === username)) {
      if (errBox) { errBox.textContent = "Username นี้มีอยู่ในระบบแล้ว กรุณาใช้ชื่ออื่น"; errBox.style.display = "block"; }
      if (usernameInput) usernameInput.focus();
      return;
    }

    const newUser = {
      userId: "USR-" + Math.floor(100000 + Math.random() * 900000),
      username: username,
      displayName: displayName || username,
      role: role,
      passcode: passcode,
      status: status,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLogin: ""
    };

    users.push(newUser);
    setStoredUsers(users);
    localUsers = users;
    syncUserToCloud("createUser", newUser);
    closeUserModal();
    populateUsersList();
    showAlert(`เพิ่มผู้ใช้งาน "${displayName || username}" เรียบร้อยแล้ว`, { type: "success" });
  }
}

async function handleDeleteUser(userId) {
  let users = localUsers.length > 0 ? localUsers : getStoredUsers();
  const user = users.find(u => u.userId === userId);
  if (!user) return;

  if (user.userId === "USR-ADMIN" || user.username === "admin") {
    showAlert("ไม่สามารถลบบัญชีผู้ดูแลระบบหลัก (Master Admin) ได้", { type: "warning" });
    return;
  }

  const confirmed = await showConfirm(
    `คุณแน่ใจหรือไม่ว่าต้องการลบผู้ใช้งาน "${user.displayName || user.username}" (Username: ${user.username})?\n\nการลบนี้จะทำให้ผู้ใช้ดังกล่าวไม่สามารถเข้าสู่ระบบได้อีกต่อไป`,
    {
      title: "ยืนยันการลบผู้ใช้งาน 🗑️",
      confirmText: "ลบผู้ใช้งาน",
      cancelText: "ยกเลิก",
      confirmClass: "danger",
      icon: "🗑️"
    }
  );

  if (confirmed) {
    users = users.filter(u => u.userId !== userId);
    setStoredUsers(users);
    localUsers = users;
    syncUserToCloud("deleteUser", { userId: userId, username: user.username });
    populateUsersList();
    showAlert("ลบผู้ใช้งานออกจากระบบเรียบร้อยแล้ว", { type: "success" });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // บังคับสิทธิ์ Admin เท่านั้น (Auth Guard)
  if (typeof requireAuth === "function") {
    if (!requireAuth(USER_ROLES.ADMIN)) return;
  }

  setupMobileNavigation();
  applyRoleUI();

  localUsers = getStoredUsers();
  populateUsersList();

  fetchCloudUsers(() => {
    localUsers = getStoredUsers();
    populateUsersList();
  });

  const refreshBtn = document.getElementById("refreshUsersBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", () => {
      fetchCloudUsers(() => {
        localUsers = getStoredUsers();
        populateUsersList();
        showAlert("รีเฟรชข้อมูลผู้ใช้งานจากคลาวด์เรียบร้อยแล้ว", { type: "info" });
      });
    });
  }

  const addBtn = document.getElementById("openAddUserModalBtn");
  if (addBtn) {
    addBtn.addEventListener("click", () => openUserModal(null));
  }

  const searchInput = document.getElementById("userSearchInput");
  if (searchInput) searchInput.addEventListener("input", populateUsersList);

  const roleFilter = document.getElementById("userRoleFilter");
  if (roleFilter) roleFilter.addEventListener("change", populateUsersList);

  const statusFilter = document.getElementById("userStatusFilter");
  if (statusFilter) statusFilter.addEventListener("change", populateUsersList);

  const saveBtn = document.getElementById("saveUserBtn");
  if (saveBtn) saveBtn.addEventListener("click", handleSaveUser);

  const closeBtn = document.getElementById("closeUserModalBtn");
  const cancelBtn = document.getElementById("cancelUserModalBtn");
  if (closeBtn) closeBtn.addEventListener("click", closeUserModal);
  if (cancelBtn) cancelBtn.addEventListener("click", closeUserModal);

  const randomPassBtn = document.getElementById("randomUserPasscodeBtn");
  if (randomPassBtn) {
    randomPassBtn.addEventListener("click", () => {
      const passInput = document.getElementById("modalPasscodeInput");
      if (passInput) passInput.value = Math.floor(10000000 + Math.random() * 90000000).toString();
    });
  }
});
