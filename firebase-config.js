// firebase-config.js
// Replace the placeholder values below with your actual Firebase project config.
// Get this from: Firebase Console -> Project Settings -> General -> Your apps -> SDK setup and configuration
//
// Before this app will work, enable in the Firebase Console:
//   1. Authentication -> Sign-in method -> Email/Password (enable it)
//   2. Firestore Database -> Create database
//   3. Storage -> Get started
// Then paste the rules from firestore.rules and storage.rules into their
// respective tabs in the console.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js";

  const firebaseConfig = {
    apiKey: "AIzaSyApun8uE_t1YH0q_6ldubRPqLubCPTFeF8",
    authDomain: "trip-sprit.firebaseapp.com",
    projectId: "trip-sprit",
    storageBucket: "trip-sprit.firebasestorage.app",
    messagingSenderId: "495850037383",
    appId: "1:495850037383:web:11888e68e2231058efd822"
  };

// The one and only admin for this trip.
export const ADMIN_EMAIL = "kothakulasagar2002@gmail.com";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
