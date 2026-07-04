// admin.js
// Admin-only actions: add members, promote members to admin, view roster.
//
// Creating a new Firebase Auth user client-side normally signs you in AS
// that new user, which would log the admin out of their own session. This
// version works around that with a second, temporary Firebase app instance
// used only for the signup call - it never touches the admin's real signed-in
// session. This keeps everything on Firebase's free Spark plan (no Cloud
// Functions, no Blaze upgrade needed).

import { app as primaryApp, db, ADMIN_EMAIL } from "./firebase-config.js";
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
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

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
    '  <div class="empty-state"><i class="ti ti-users"></i>Loading members...</div>',
    '</div>'
  ].join("\n");

  document.getElementById("admin-add-btn").addEventListener("click", handleAddMember);

  const listEl = document.getElementById("admin-member-list");
  const q = query(collection(db, "members"), orderBy("addedAt", "asc"));

  onSnapshot(q, function (snap) {
    if (snap.empty) {
      listEl.innerHTML = '<div class="empty-state"><i class="ti ti-users"></i>No members yet.</div>';
      return;
    }

    listEl.innerHTML = "";

    snap.forEach(function (docSnap) {
      const m = docSnap.data();
      const uid = docSnap.id;
      const row = document.createElement("div");
      row.className = "row";
      row.style.padding = "8px 0";

      const rolePillClass = m.role === "admin" ? "pill-approved" : "pill-individual";
      const promoteButton = m.role !== "admin"
        ? '<button class="btn-ghost small" data-promote="' + uid + '">Make admin</button>'
        : "";

      row.innerHTML = [
        '<div>',
        '  <div style="font-weight:500; font-size:14px;">' + escapeHtml(m.name) + '</div>',
        '  <div style="font-size:12px; color:var(--text-muted);">' + escapeHtml(m.email) + '</div>',
        '</div>',
        '<div style="display:flex; align-items:center; gap:8px;">',
        '  <span class="pill ' + rolePillClass + '">' + m.role + '</span>',
        '  ' + promoteButton,
        '</div>'
      ].join("\n");

      listEl.appendChild(row);
    });

    const promoteButtons = listEl.querySelectorAll("[data-promote]");
    for (let i = 0; i < promoteButtons.length; i++) {
      const btn = promoteButtons[i];
      btn.addEventListener("click", function () {
        handlePromote(btn.getAttribute("data-promote"), btn);
      });
    }
  });
}

async function handlePromote(uid, btnEl) {
  const confirmed = confirm("Make this member an admin? They'll be able to add members, approve expenses, and edit the planner - same as you.");
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