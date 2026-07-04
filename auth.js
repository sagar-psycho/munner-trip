// auth.js
// Members can only sign in if the admin has already created their account
// in Firebase Authentication (via the Admin tab, which uses a Cloud Function
// or the admin manually adding them in the Firebase console).
//
// This file just handles sign-in / sign-out and exposes the current user
// and their profile doc (name, role) from Firestore.

import { auth, db, ADMIN_EMAIL, isAdminRole, isSuperAdminRole } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export let currentUser = null;
export let currentProfile = null; // { name, email, role: 'admin' | 'member' }

// True for admin OR super_admin - can add members, approve expenses,
// add planner items. Cannot delete anything.
export function isAdmin() {
  return isAdminRole(currentProfile?.role);
}

// True only for super_admin - the only role that can delete anything
// (planner items, media, chat messages, members, expenses).
export function isSuperAdmin() {
  return isSuperAdminRole(currentProfile?.role);
}

export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
  return cred.user;
}

export function logout() {
  return signOut(auth);
}

// Loads (or creates, for the admin's very first login) the member profile doc.
async function loadProfile(user) {
  const ref = doc(db, "members", user.uid);
  const snap = await getDoc(ref);

  if (snap.exists()) {
    currentProfile = snap.data();

    // Self-heal: if this is the super admin's email but their existing doc
    // predates the three-role system (e.g. still says "admin"), correct it
    // on login instead of requiring a manual Firestore edit.
    if (user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase() && currentProfile.role !== "super_admin") {
      await updateDoc(ref, { role: "super_admin" });
      currentProfile = { ...currentProfile, role: "super_admin" };
    }

    return currentProfile;
  }

  // First-ever login for the admin account: bootstrap their profile doc.
  if (user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    const profile = {
      name: "Sagar (Admin)",
      email: user.email,
      role: "super_admin",
      addedAt: Date.now()
    };
    await setDoc(ref, profile);
    currentProfile = profile;
    return profile;
  }

  // A user exists in Firebase Auth but has no member doc and isn't the
  // admin - this shouldn't normally happen since members are only created
  // through the Admin tab, which writes both at once. Treat as not permitted.
  throw new Error("Your account isn't linked to this trip. Ask the admin to add you.");
}

// onAuthReady(callback) - callback receives (user, profile) or (null, null)
export function onAuthReady(callback) {
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      currentUser = null;
      currentProfile = null;
      callback(null, null);
      return;
    }
    try {
      const profile = await loadProfile(user);
      currentUser = user;
      callback(user, profile);
    } catch (err) {
      await signOut(auth);
      callback(null, null, err.message);
    }
  });
}