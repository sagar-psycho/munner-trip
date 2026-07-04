// functions/index.js
//
// Deploy with: firebase deploy --only functions
// (requires `firebase-tools` and the Blaze/pay-as-you-go plan, since
// outbound network calls from Cloud Functions require it - it stays free
// for this trip's volume, but Firebase requires Blaze to be enabled even
// for near-zero usage)
//
// This function lets the admin create a new member's Firebase Auth account
// AND their Firestore profile doc in one step, without logging the admin
// out of their own session (which client-side signup would otherwise do).
//
// SECURITY NOTE: this minimal version checks a shared admin secret rather
// than verifying a Firebase ID token, to keep setup simple for a small
// friend-group trip. Anyone with the function URL AND the secret can add
// members. Treat the URL + secret like a password - don't post them
// publicly. If you want stronger protection, verify a Firebase Auth ID
// token from the admin instead (ask if you want that version).

const functions = require("firebase-functions");
const admin = require("firebase-admin");
admin.initializeApp();

const ADMIN_SECRET = functions.config().trip?.secret || "change-this-secret";
const ADMIN_EMAIL = "kothakulasagar2002@gmail.com";

exports.addMember = functions.https.onRequest(async (req, res) => {
  res.set("Access-Control-Allow-Origin", "*");
  res.set("Access-Control-Allow-Methods", "POST");
  res.set("Access-Control-Allow-Headers", "Content-Type, X-Admin-Secret");

  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return;
  }

  const secret = req.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET) {
    res.status(403).json({ error: "Not authorized." });
    return;
  }

  const { name, email, password } = req.body || {};
  if (!name || !email || !password) {
    res.status(400).json({ error: "Missing name, email, or password." });
    return;
  }
  if (email.toLowerCase() === ADMIN_EMAIL.toLowerCase()) {
    res.status(400).json({ error: "That email is reserved for the admin." });
    return;
  }

  try {
    const userRecord = await admin.auth().createUser({
      email,
      password,
      displayName: name
    });

    await admin.firestore().collection("members").doc(userRecord.uid).set({
      name,
      email,
      role: "member",
      addedAt: Date.now()
    });

    res.status(200).json({ uid: userRecord.uid });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
