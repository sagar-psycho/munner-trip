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
  signOut
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
          <input id="admin-mobile" type="tel" placeholder="Mobile number" />
          <input id="admin-country" type="text" placeholder="Country code" value="+91" />
          <input id="admin-emergency" type="text" placeholder="Emergency contact" />
          <select id="admin-role">
            <option value="member">Member</option>
            <option value="admin">Admin</option>
            ${isSuperAdmin() ? '<option value="super_admin">Super Admin</option>' : ""}
          </select>
        </div>
        <button id="admin-add-btn" class="btn-primary">Add member</button>
        <p id="admin-add-error" class="error-text"></p>
        <p class="hint" style="text-align:left; margin-top:10px;">The member signs in with this email and password on the login screen.</p>
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
            <th>Mobile</th>
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
        <td>${escapeHtml(member.mobileNumber || "-")}</td>
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
  const mobile = document.getElementById("admin-mobile").value.trim();
  const countryCode = document.getElementById("admin-country").value.trim();
  const emergencyContact = document.getElementById("admin-emergency").value.trim();
  const role = document.getElementById("admin-role")?.value || "member";
  const errorEl = document.getElementById("admin-add-error");
  errorEl.textContent = "";

  if (!name || !email || !password || !mobile) {
    errorEl.textContent = "Name, email, password, and mobile number are required.";
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = "Password must be at least 6 characters.";
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
      mobileNumber: mobile,
      countryCode,
      emergencyContact,
      role,
      status: "active",
      addedAt: Date.now(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
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
    document.getElementById("admin-mobile").value = "";
    document.getElementById("admin-country").value = "+91";
    document.getElementById("admin-emergency").value = "";
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
  try {
    await sendPasswordResetEmail(getAuth(primaryApp), member.email);
    alert("Reset password email sent.");
  } catch (err) {
    alert("Couldn't send reset email: " + err.message);
  }
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
        <div><strong>Mobile</strong><div>${escapeHtml(member.mobileNumber || "-")}</div></div>
        <div><strong>Role</strong><div>${escapeHtml(ROLE_LABEL[member.role] || member.role)}</div></div>
        <div><strong>Joined</strong><div>${formatDate(member.addedAt || member.createdAt)}</div></div>
        <div><strong>Last Login</strong><div>${member.lastLoginAt ? formatDate(member.lastLoginAt) : "Not recorded"}</div></div>
        <div><strong>Emergency Contact</strong><div>${escapeHtml(member.emergencyContact || "-")}</div></div>
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
      <input id="edit-mobile" type="tel" placeholder="Mobile number" />
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
    document.getElementById("edit-mobile").value = member?.mobileNumber || "";
  });

  overlay.querySelector("#edit-cancel").addEventListener("click", () => overlay.remove());
  overlay.querySelector("#edit-save").addEventListener("click", async () => {
    const name = document.getElementById("edit-name").value.trim();
    const email = document.getElementById("edit-email").value.trim();
    const mobile = document.getElementById("edit-mobile").value.trim();

    try {
      const payload = {
        name,
        email,
        mobileNumber: mobile,
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