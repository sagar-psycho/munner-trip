// firebase-config.js

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

/* ==========================================================
   Firebase Configuration
========================================================== */

const firebaseConfig = {
  apiKey: "AIzaSyApun8uE_t1YH0q_6ldubRPqLubCPTFeF8",
  authDomain: "trip-sprit.firebaseapp.com",
  projectId: "trip-sprit",
  storageBucket: "trip-sprit.firebasestorage.app",
  messagingSenderId: "495850037383",
  appId: "1:495850037383:web:11888e68e2231058efd822"
};

/* ==========================================================
   Firebase Initialization
========================================================== */

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

/* ==========================================================
   Super Admin
========================================================== */

// Only this email gets full access.
export const SUPER_ADMIN_EMAIL = "kothakulasagar2002@gmail.com";

/* Backward compatibility */
export const ADMIN_EMAIL = SUPER_ADMIN_EMAIL;

/* ==========================================================
   User Roles
========================================================== */

export const ROLES = {
  SUPER_ADMIN: "super_admin",
  ADMIN: "admin",
  MEMBER: "member"
};

/* ==========================================================
   Collections
========================================================== */

export const COLLECTIONS = {
  MEMBERS: "members",
  EXPENSES: "expenses",
  PLANNER: "planner",
  MEDIA: "media",
  CHATS: "chats",
  ACTIVITY_LOGS: "activity_logs"
};

/* ==========================================================
   Cloudinary
========================================================== */

export const CLOUDINARY_CLOUD_NAME = "hazf1hmf";
export const CLOUDINARY_UPLOAD_PRESET = "munnar_trip";

/* ==========================================================
   Permission Helpers
========================================================== */

export function isSuperAdminEmail(email) {
  return (
    email &&
    email.toLowerCase() === SUPER_ADMIN_EMAIL.toLowerCase()
  );
}

export function isAdminRole(role) {
  return (
    role === ROLES.ADMIN ||
    role === ROLES.SUPER_ADMIN
  );
}

export function isMemberRole(role) {
  return role === ROLES.MEMBER;
}

export function isSuperAdminRole(role) {
  return role === ROLES.SUPER_ADMIN;
}

// True for anything an admin OR super admin can do (add members, approve
// expenses, add planner items). Delete/destructive actions must check
// isSuperAdminRole specifically, not this.
export function canManage(role) {
  return isAdminRole(role);
}

// True only for destructive actions (delete planner item, delete media,
// delete chat message, delete member, delete expense).
export function canDelete(role) {
  return isSuperAdminRole(role);
}

/* ==========================================================
   Date Helper
========================================================== */

export function now() {
  return Date.now();
}