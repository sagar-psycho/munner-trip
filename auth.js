// auth.js
// Members can only sign in if the admin has already created their account
// in Firebase Authentication (via the Admin tab, which uses a Cloud Function
// or the admin manually adding them in the Firebase console).
//
// This file just handles sign-in / sign-out and exposes the current user
// and their profile doc (name, role) from Firestore.

import { auth, db, ADMIN_EMAIL } from "./firebase-config.js";
import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export let currentUser = null;
export let currentProfile = null; // { name, email, role: 'admin' | 'member' }

export function isAdmin() {
  return currentProfile?.role === "admin";
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
    return currentProfile;
  }

  // First-ever login for the admin account: bootstrap their profile doc.
  if (user.email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    const profile = {
      name: "Sagar (Admin)",
      email: user.email,
      role: "admin",
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
