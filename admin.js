// admin.js
// Add members, promote members to admin, view roster.
//
// Roles: super_admin > admin > member.
//   - admin and super_admin can both add members, approve/reject expenses,
//     and add planner items.
//   - Only super_admin can delete anything (members, expenses, planner
//     items, media, chat messages) or promote a member to admin.
//
// Creating a new Firebase Auth user client-side normally signs you in AS
// that new user, which would log the admin out of their own session. This
// version works around that with a second, temporary Firebase app instance
// used only for the signup call - it never touches the admin's real signed-in
// session. This keeps everything on Firebase's free Spark plan (no Cloud
// Functions, no Blaze upgrade needed).

import { app as primaryApp, db, ADMIN_EMAIL } from "./firebase-config.js";
import { isSuperAdmin, currentUser } from "./auth.js";
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const ROLE_LABEL = {
  super_admin: "super admin",
  admin: "admin",
  member: "member"
};

export function renderAdminTab(container) {
  container.innerHTML = [
    '<div class="section-title">Add a member</div>',
    '<div class="card">',
    '  <input id="admin-name" type="text" placeholder="Full name" />',
    '  <input id="admin-email" type="email" placeholder="Email address" />',
    '  <input id="admin-password" type="text" placeholder="Temporary password (min 6 characters)" />',
    '  <button id="admin-add-btn" class="btn-primary">Add member</button>',
    '  <p id="admin-add-error" class="error-text"></p>',
    '  <p class="hint" style="text-align:left; margin-top:10px;">',
    "    The member signs in with this email and password on the login screen.",
    "    Share it with them directly. They can't self-register.",
    '  </p>',
    '</div>',
    '<div class="section-title">Trip members</div>',
    '<div class="card" id="admin-member-list">',
    '  <div class="empty-state"><i class="bi bi-people"></i>Loading members...</div>',
    '</div>'
  ].join("\n");

  document.getElementById("admin-add-btn").addEventListener("click", handleAddMember);

  const listEl = document.getElementById("admin-member-list");
  const q = query(collection(db, "members"), orderBy("addedAt", "asc"));

  onSnapshot(q, function (snap) {
    if (snap.empty) {
      listEl.innerHTML = '<div class="empty-state"><i class="bi bi-people"></i>No members yet.</div>';
      return;
    }

    listEl.innerHTML = "";

    snap.forEach(function (docSnap) {
      const m = docSnap.data();
      const uid = docSnap.id;
      const row = document.createElement("div");
      row.className = "row";
      row.style.padding = "8px 0";

      const rolePillClass = m.role === "super_admin" || m.role === "admin" ? "pill-approved" : "pill-individual";
      const roleLabel = ROLE_LABEL[m.role] || m.role;

      // Only super admin sees promote/delete controls, and never on itself.
      const isSelf = uid === currentUser?.uid;
      let controls = "";
      if (isSuperAdmin() && !isSelf) {
        const promoteButton = m.role === "member"
          ? '<button class="btn-ghost small" data-promote="' + uid + '">Make admin</button>'
          : "";
        const deleteButton = '<button class="btn-danger" data-delete="' + uid + '"><i class="bi bi-trash"></i></button>';
        controls = promoteButton + " " + deleteButton;
      }

      row.innerHTML = [
        '<div>',
        '  <div style="font-weight:500; font-size:14px;">' + escapeHtml(m.name) + '</div>',
        '  <div style="font-size:12px; color:var(--text-muted);">' + escapeHtml(m.email) + '</div>',
        '</div>',
        '<div style="display:flex; align-items:center; gap:8px;">',
        '  <span class="pill ' + rolePillClass + '">' + roleLabel + '</span>',
        '  ' + controls,
        '</div>'
      ].join("\n");

      listEl.appendChild(row);
    });

    listEl.querySelectorAll("[data-promote]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        handlePromote(btn.getAttribute("data-promote"), btn);
      });
    });

    listEl.querySelectorAll("[data-delete]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        handleDeleteMember(btn.getAttribute("data-delete"), btn);
      });
    });
  });
}

async function handlePromote(uid, btnEl) {
  const confirmed = confirm("Make this member an admin? They'll be able to add members, approve expenses, and add planner items - but won't be able to delete anything.");
  if (!confirmed) return;

  btnEl.disabled = true;
  btnEl.textContent = "Updating...";

  try {
    await updateDoc(doc(db, "members", uid), { role: "admin" });
  } catch (err) {
    alert("Couldn't update: " + err.message);
    btnEl.disabled = false;
    btnEl.textContent = "Make admin";
  }
}

async function handleDeleteMember(uid, btnEl) {
  const confirmed = confirm("Remove this member from the trip? This only removes their profile/roster entry, not their past expenses, chat messages, or media.");
  if (!confirmed) return;

  btnEl.disabled = true;

  try {
    await deleteDoc(doc(db, "members", uid));
  } catch (err) {
    alert("Couldn't remove member: " + err.message);
    btnEl.disabled = false;
  }
}

async function handleAddMember() {
  const name = document.getElementById("admin-name").value.trim();
  const email = document.getElementById("admin-email").value.trim();
  const password = document.getElementById("admin-password").value;
  const errorEl = document.getElementById("admin-add-error");
  errorEl.textContent = "";

  if (!name || !email || !password) {
    errorEl.textContent = "Fill in name, email, and password.";
    return;
  }
  if (password.length < 6) {
    errorEl.textContent = "Password must be at least 6 characters.";
    return;
  }
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    errorEl.textContent = "That's the admin account already.";
    return;
  }

  const secondaryApp = initializeApp(primaryApp.options, "SecondaryAdminApp-" + Date.now());
  const secondaryAuth = getAuth(secondaryApp);

  try {
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password);

    await setDoc(doc(db, "members", cred.user.uid), {
      name: name,
      email: email,
      role: "member",
      addedAt: Date.now()
    });

    await signOut(secondaryAuth);

    document.getElementById("admin-name").value = "";
    document.getElementById("admin-email").value = "";
    document.getElementById("admin-password").value = "";
  } catch (err) {
    errorEl.textContent = friendlyError(err);
  } finally {
    await deleteApp(secondaryApp);
  }
}

function friendlyError(err) {
  if (err.code === "auth/email-already-in-use") return "That email is already registered.";
  if (err.code === "auth/invalid-email") return "That doesn't look like a valid email.";
  if (err.code === "auth/weak-password") return "Password is too weak - use at least 6 characters.";
  return err.message;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}