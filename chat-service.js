// chat-service.js
// Reusable chat helpers for one-to-one and group conversations.

import { db, COLLECTIONS } from "./firebase-config.js";
import { currentUser, currentProfile } from "./auth.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export const CHAT_TYPES = {
  DIRECT: "direct",
  GROUP: "group"
};

export function threadIdFor(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

export async function ensureChatRoom(roomId, payload) {
  const ref = doc(db, COLLECTIONS.CHAT_ROOMS, roomId);
  await setDoc(ref, { roomId, ...payload, updatedAt: serverTimestamp() }, { merge: true });
  return ref;
}

export async function sendChatMessage({ roomId, text = "", senderUid = currentUser?.uid, senderName = currentProfile?.name, type = "text", metadata = {} }) {
  if (!roomId || !senderUid) return null;
  const ref = await addDoc(collection(db, COLLECTIONS.CHAT_ROOMS, roomId, "messages"), {
    roomId,
    text,
    senderUid,
    senderName,
    type,
    metadata,
    createdAt: serverTimestamp(),
    edited: false,
    deleted: false,
    status: "sent"
  });
  await updateDoc(doc(db, COLLECTIONS.CHAT_ROOMS, roomId), {
    lastMessage: text || "📎 Attachment",
    lastMessageAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
  return ref;
}

export function subscribeToMessages(roomId, callback) {
  const q = query(collection(db, COLLECTIONS.CHAT_ROOMS, roomId, "messages"), orderBy("createdAt", "asc"));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export function subscribeToChatRooms(uid, callback) {
  const q = query(collection(db, COLLECTIONS.CHAT_ROOMS), where("participantIds", "array-contains", uid));
  return onSnapshot(q, (snap) => callback(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
}

export async function editMessage(roomId, messageId, text) {
  await updateDoc(doc(db, COLLECTIONS.CHAT_ROOMS, roomId, "messages", messageId), { text, edited: true });
}

export async function deleteMessage(roomId, messageId) {
  await updateDoc(doc(db, COLLECTIONS.CHAT_ROOMS, roomId, "messages", messageId), { deleted: true, text: "This message was deleted" });
}

export async function addReaction(roomId, messageId, emoji, uid) {
  const ref = doc(db, COLLECTIONS.CHAT_ROOMS, roomId, "messages", messageId);
  await updateDoc(ref, { [`reactions.${uid}`]: emoji });
}
