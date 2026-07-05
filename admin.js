// admin.js
// Member management for Munner Trip with role-aware admin actions and
// profile support while keeping the existing member workflow intact.

import { app as primaryApp, db, ADMIN_EMAIL } from "./firebase-config.js";
import { isSuperAdmin, currentUser, currentProfile } from "./auth.js";
import { NotificationService, NOTIFICATION_TYPES } from "./notification-service.js";
import { renderAvatar } from "./avatar.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  createUserWithEmailAndPassword,
  getAuth,
  sendPasswordResetEmail,
  signOut,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ROLE_LABEL = {
  super_admin: "Super Admin",
  admin: "Admin",
  member: "Member"
};

const STATUS_LABEL = {
  active: "Active",
  inactive: "Inactive"
};

export function renderAdminTab(container) {
  container.innerHTML = `
    <div class="admin-shell">
      <div class="admin-card">
        <div class="admin-card-header">
          <h3>Add a member</h3>
          <span class="pill pill-approved">New Account</span>
        </div>
        <div class="admin-form-grid">
          <input id="admin-name" type="text" placeholder="Full name" />
          <input id="admin-email" type="email" placeholder="Email address" />
          <input id="admin-password" type="text" placeholder="Temporary password" />
          <input id="admin-country" type="text" value="+91" placeholder="Country code" />
          <input id="admin-whatsapp" type="tel" placeholder="WhatsApp number (e.g. 919845678901)" />
          <select id="admin-role">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            ${isSuperAdmin() ? '<option value="super_admin">Super Admin</option>' : ""}
          </select>
        </div>
        <button id="admin-add-btn" class="btn-primary">Add member</button>
        <p id="admin-add-error" class="error-text"></p>
        <p class="hint" style="text-align:left; margin-top:10px;">The member signs in with this email and password on the login screen. Password is required when creating a new account.</p>
      </div>

      <div class="admin-card">
        <div class="admin-card-header">
          <h3>Trip members</h3>
          <span class="pill pill-pending">Managed roster</span>
        </div>
        <div id="admin-member-list" class="admin-table-wrap"></div>
      </div>
    </div>
  `;

  document.getElementById("admin-add-btn").addEventListener("click", handleAddMember);

  const listEl = document.getElementById("admin-member-list");
  const q = query(collection(db, "members"), orderBy("addedAt", "asc"));

  onSnapshot(q, function (snap) {
    if (snap.empty) {
      listEl.innerHTML = '<div class="empty-state"><i class="bi bi-people"></i>No members yet.</div>';
      return;
    }

    listEl.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Avatar</th>
            <th>Name</th>
            <th>Email</th>
            <th>WhatsApp</th>
            <th>Role</th>
            <th>Status</th>
            <th>Joined</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody id="admin-member-body"></tbody>
      </table>
    `;

    const bodyEl = document.getElementById("admin-member-body");
    snap.forEach(function (docSnap) {
      const member = docSnap.data();
      const uid = docSnap.id;
      const row = document.createElement("tr");
      const isSelf = uid === currentUser?.uid;
      const canManage = isSuperAdmin() || (member.role !== "super_admin" && !isSelf);

      row.innerHTML = `
        <td>${renderAvatar(member.name, { size: "small", className: "admin-avatar" })}</td>
        <td>
          <div class="admin-member-name">${escapeHtml(member.name || "Unknown")}</div>
          <div class="admin-member-meta">${escapeHtml(member.email || "")}</div>
        </td>
        <td>${escapeHtml(member.email || "")}</td>
        <td>${escapeHtml(member.whatsappNumber || member.mobileNumber || "-")}</td>
        <td><span class="pill ${member.role === "super_admin" ? "pill-approved" : member.role === "admin" ? "pill-pending" : "pill-individual"}">${escapeHtml(ROLE_LABEL[member.role] || member.role)}</span></td>
        <td>${escapeHtml(STATUS_LABEL[member.status] || "Active")}</td>
        <td>${formatDate(member.addedAt || member.createdAt)}</td>
        <td>
          <div class="admin-actions">
            <button class="btn-ghost small" data-view="${uid}">View</button>
            <button class="btn-ghost small" data-edit="${uid}">Edit</button>
            ${canManage ? `<button class="btn-ghost small" data-role="${uid}">Change Role</button>` : ""}
            ${!isSelf ? `<button class="btn-danger small" data-delete="${uid}">Remove</button>` : ""}
            <button class="btn-ghost small" data-reset="${uid}">Reset</button>
            ${!isSelf ? `<button class="btn-ghost small" data-deactivate="${uid}">Deactivate</button>` : ""}
          </div>
        </td>
      `;
      bodyEl.appendChild(row);
    });

    bodyEl.querySelectorAll("[data-view]").forEach((button) => {
      button.addEventListener("click", () => showProfileModal(button.dataset.view));
    });
    bodyEl.querySelectorAll("[data-edit]").forEach((button) => {
      button.addEventListener("click", () => openEditMemberModal(button.dataset.edit));
    });
    bodyEl.querySelectorAll("[data-role]").forEach((button) => {
      button.addEventListener("click", () => openRoleModal(button.dataset.role));
    });
    bodyEl.querySelectorAll("[data-delete]").forEach((button) => {
      button.addEventListener("click", () => handleDeleteMember(button.dataset.delete));
    });
    bodyEl.querySelectorAll("[data-reset]").forEach((button) => {
      button.addEventListener("click", () => handleResetPassword(button.dataset.reset));
    });
    bodyEl.querySelectorAll("[data-deactivate]").forEach((button) => {
      button.addEventListener("click", () => handleDeactivateMember(button.dataset.deactivate));
    });
  });
}

async function handleAddMember() {
  const name = document.getElementById("admin-name").value.trim();
  const email = document.getElementById("admin-email").value.trim();
  const password = document.getElementById("admin-password").value;
  const whatsapp = document.getElementById("admin-whatsapp").value.trim();
  const countryCode = document.getElementById("admin-country").value.trim();
  const role = document.getElementById("admin-role")?.value || "member";
  const errorEl = document.getElementById("admin-add-error");
  errorEl.textContent = "";

  const validationError = validateMemberInput({ name, email, password, whatsapp, countryCode, role, requirePassword: true });
  if (validationError) {
    errorEl.textContent = validationError;
    return;
  }

  const normalizedWhatsApp = normalizeWhatsAppNumber(whatsapp, countryCode);
  if (!normalizedWhatsApp) {
    errorEl.textContent = "Enter a valid WhatsApp number with country code.";
    return;
  }

  if (!isSuperAdmin() && role === "super_admin") {
    errorEl.textContent = "Only super admins can create super admin accounts.";
    return;
  }
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    errorEl.textContent = "That admin account already exists.";
    return;
  }

  const secondaryApp = initializeApp(primaryApp.options, "SecondaryAdminApp-" + Date.now());
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);

    await setDoc(doc(db, "members", cred.user.uid), {
      name,
      email,
      whatsappNumber: normalizedWhatsApp,
      countryCode,
      role,
      status: "active",
      addedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: currentUser?.uid || null,
      updatedBy: currentUser?.uid || null
    });

    await NotificationService.send({
      type: NOTIFICATION_TYPES.MEMBER_ADDED,
      title: "Member added",
      message: `${currentProfile?.name || "Admin"} added ${name} to the trip.`,
      senderId: currentUser?.uid,
      senderName: currentProfile?.name || "Admin",
      receiverIds: [cred.user.uid],
      priority: "normal",
      deepLink: "#admin",
      targetType: "admin",
      targetId: cred.user.uid,
      sound: "planner"
    });

    await signOut(secondaryAuth);
    document.getElementById("admin-name").value = "";
    document.getElementById("admin-email").value = "";
    document.getElementById("admin-password").value = "";
    document.getElementById("admin-whatsapp").value = "";
    document.getElementById("admin-country").value = "+91";
    document.getElementById("admin-role").value = "member";
  } catch (err) {
    errorEl.textContent = friendlyError(err);
  } finally {
    await deleteApp(secondaryApp);
  }
}

async function handleDeleteMember(uid) {
  const confirmed = confirm("Remove this member from the trip?");
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, "members", uid));
    await NotificationService.send({
      type: NOTIFICATION_TYPES.MEMBER_REMOVED,
      title: "Member removed",
      message: "A member was removed from your trip.",
      senderId: currentUser?.uid,
      senderName: currentProfile?.name || "Admin",
      receiverIds: [uid],
      priority: "normal",
      deepLink: "#admin"
    });
  } catch (err) {
    alert("Couldn't remove member: " + err.message);
  }
}

async function handleResetPassword(uid) {
  const member = await getMemberById(uid);
  if (!member?.email) return;
  openResetPasswordModal(uid, member);
}

function openResetPasswordModal(uid, member) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>Reset Password</h3>
      <p class="hint" style="text-align:left; margin-top:-4px;">${escapeHtml(member?.name || "Member")}</p>
      <input id="reset-password" type="password" placeholder="New password" />
      <p id="reset-password-error" class="error-text"></p>
      <p id="reset-password-success" class="hint" style="text-align:left;"></p>
      <div class="modal-actions">
        <button class="btn-ghost" id="reset-cancel">Cancel</button>
        <button class="btn-primary" id="reset-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#reset-cancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#reset-save").addEventListener("click", async () => {
    const newPassword = document.getElementById("reset-password").value;
    const errorEl = document.getElementById("reset-password-error");
    const successEl = document.getElementById("reset-password-success");
    errorEl.textContent = "";
    successEl.textContent = "";

    if (!newPassword || newPassword.length < 6) {
      errorEl.textContent = "Password must be at least 6 characters.";
      return;
    }

    try {
      const auth = getAuth(primaryApp);
      if (uid === currentUser?.uid && auth.currentUser) {
        await updatePassword(auth.currentUser, newPassword);
        successEl.textContent = "Password updated successfully.";
        return;
      }

      await sendPasswordResetEmail(getAuth(primaryApp), member.email);
      successEl.textContent = "Password reset link sent to the member's email.";
    } catch (err) {
      errorEl.textContent = err.message || "Couldn't reset password.";
    }
  });
}


async function handleDeactivateMember(uid) {
  try {
    await updateDoc(doc(db, "members", uid), { status: "inactive", updatedAt: Date.now(), updatedBy: currentUser?.uid || null });
    alert("Member deactivated.");
  } catch (err) {
    alert("Couldn't deactivate member: " + err.message);
  }
}

async function showProfileModal(uid) {
  const member = await getMemberById(uid);
  if (!member) return;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>Member Profile</h3>
      <div class="admin-profile-card">
        ${renderAvatar(member.name, { size: "large", className: "admin-avatar" })}
        <div>
          <div class="admin-member-name">${escapeHtml(member.name || "Unknown")}</div>
          <div class="admin-member-meta">${escapeHtml(member.email || "")}</div>
        </div>
      </div>
      <div class="admin-detail-grid">
        <div><strong>WhatsApp</strong><div>${escapeHtml(member.whatsappNumber || member.mobileNumber || "-")}</div></div>
        <div><strong>Role</strong><div>${escapeHtml(ROLE_LABEL[member.role] || member.role)}</div></div>
        <div><strong>Joined</strong><div>${formatDate(member.addedAt || member.createdAt)}</div></div>
        <div><strong>Last Login</strong><div>${member.lastLoginAt ? formatDate(member.lastLoginAt) : "Not recorded"}</div></div>
        <div><strong>Country Code</strong><div>${escapeHtml(member.countryCode || "-")}</div></div>
        <div><strong>Status</strong><div>${escapeHtml(STATUS_LABEL[member.status] || "Active")}</div></div>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="profile-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#profile-close").addEventListener("click", () => overlay.remove());
}

function openRoleModal(uid) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>Change Role</h3>
      <select id="role-select">
        <option value="member">Member</option>
        <option value="admin">Admin</option>
        ${isSuperAdmin() ? '<option value="super_admin">Super Admin</option>' : ""}
      </select>
      <div class="modal-actions">
        <button class="btn-ghost" id="role-cancel">Cancel</button>
        <button class="btn-primary" id="role-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#role-cancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#role-save").addEventListener("click", async () => {
    const newRole = document.getElementById("role-select").value;
    if (!newRole) return;
    await updateRole(uid, newRole);
    overlay.remove();
  });
}

async function updateRole(uid, role) {
  const member = await getMemberById(uid);
  try {
    await updateDoc(doc(db, "members", uid), {
      role,
      updatedAt: Date.now(),
      updatedBy: currentUser?.uid || null
    });
    await NotificationService.send({
      type: NOTIFICATION_TYPES.ROLE_CHANGED,
      title: "Role updated",
      message: `${currentProfile?.name || "Admin"} changed your role to ${ROLE_LABEL[role] || role}.`,
      senderId: currentUser?.uid,
      senderName: currentProfile?.name || "Admin",
      receiverIds: [uid],
      priority: "normal",
      deepLink: "#admin"
    });
  } catch (err) {
    alert("Couldn't update role: " + err.message);
  }
}

function openEditMemberModal(uid) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>Edit Member</h3>
      <input id="edit-name" type="text" placeholder="Name" />
      <input id="edit-email" type="email" placeholder="Email" />
      <input id="edit-country" type="text" placeholder="Country code" />
      <input id="edit-whatsapp" type="tel" placeholder="WhatsApp number" />
      <select id="edit-role">
        <option value="member">Member</option>
        <option value="admin">Admin</option>
        ${isSuperAdmin() ? '<option value="super_admin">Super Admin</option>' : ""}
      </select>
      <p class="hint" style="text-align:left; margin-top:8px;">Password stays unchanged unless you use Reset Password.</p>
      <div class="modal-actions">
        <button class="btn-ghost" id="edit-cancel">Cancel</button>
        <button class="btn-primary" id="edit-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  getMemberById(uid).then((member) => {
    document.getElementById("edit-name").value = member?.name || "";
    document.getElementById("edit-email").value = member?.email || "";
    document.getElementById("edit-country").value = member?.countryCode || "+91";
    document.getElementById("edit-whatsapp").value = member?.whatsappNumber || "";
    document.getElementById("edit-role").value = member?.role || "member";
  });

  overlay.querySelector("#edit-cancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#edit-save").addEventListener("click", async () => {
    const name = document.getElementById("edit-name").value.trim();
    const email = document.getElementById("edit-email").value.trim();
    const countryCode = document.getElementById("edit-country").value.trim();
    const whatsapp = document.getElementById("edit-whatsapp").value.trim();
    const role = document.getElementById("edit-role").value;

    const validationError = validateMemberInput({ name, email, whatsapp, countryCode, role, requirePassword: false });
    if (validationError) {
      alert(validationError);
      return;
    }

    try {
      const existingMember = await getMemberById(uid);
      const normalizedWhatsApp = normalizeWhatsAppNumber(whatsapp, countryCode);
      if (!normalizedWhatsApp) {
        alert("Enter a valid WhatsApp number with country code.");
        return;
      }
      if (!isSuperAdmin() && role === "super_admin") {
        alert("Only super admins can assign super admin.");
        return;
      }
      if (!isSuperAdmin() && existingMember?.role === "super_admin" && role !== "super_admin") {
        alert("Only super admins can remove super admin privileges.");
        return;
      }

      const payload = {
        name,
        email,
        whatsappNumber: normalizedWhatsApp,
        countryCode,
        role,
        updatedAt: Date.now(),
        updatedBy: currentUser?.uid || null
      };
      await updateDoc(doc(db, "members", uid), payload);
      await NotificationService.send({
        type: NOTIFICATION_TYPES.MEMBER_UPDATED,
        title: "Profile updated",
        message: `${currentProfile?.name || "Admin"} updated your member profile.`,
        senderId: currentUser?.uid,
        senderName: currentProfile?.name || "Admin",
        receiverIds: [uid],
        priority: "normal",
        deepLink: "#admin"
      });
      overlay.remove();
    } catch (err) {
      alert("Couldn't edit member: " + err.message);
    }
  });
}

async function getMemberById(uid) {
  const snap = await getDoc(doc(db, "members", uid));
  return snap.exists() ? { uid, ...snap.data() } : null;
}

function friendlyError(err) {
  if (err.code === "auth/email-already-in-use") return "That email is already registered.";
  if (err.code === "auth/invalid-email") return "That doesn't look like a valid email.";
  if (err.code === "auth/weak-password") return "Password is too weak - use at least 6 characters.";
  return err.message;
}

function validateMemberInput({ name, email, password, whatsapp, countryCode, role, requirePassword = false }) {
  if (!name || !email || !whatsapp || !countryCode) {
    return "Name, email, WhatsApp number, and country code are required.";
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return "Enter a valid email address.";
  }
  if (requirePassword && (!password || password.length < 6)) {
    return "Password must be at least 6 characters.";
  }
  if (!requirePassword && password !== undefined && password !== null && password !== "" && password.length < 6) {
    return "Password must be at least 6 characters.";
  }
  if (!/^\+?\d{1,4}$/.test(countryCode.replace(/\s+/g, ""))) {
    return "Country code should be a short numeric prefix such as +91.";
  }
  if (!/^\d{8,15}$/.test(whatsapp.replace(/\D/g, ""))) {
    return "WhatsApp number must contain only digits and be at least 8 digits long.";
  }
  if (role && !["member", "admin", "super_admin"].includes(role)) {
    return "Select a valid role.";
  }
  return "";
}

function normalizeWhatsAppNumber(value, countryCode) {
  const digits = `${countryCode || ""}${value || ""}`.replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : "";
}

function formatDate(value) {
  if (!value) return "-";
  const date = typeof value === "number" ? new Date(value) : value?.toDate ? value.toDate() : new Date(value);
  return date.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}