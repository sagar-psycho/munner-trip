// chat.js
// Two chat surfaces:
//   - One shared "group" thread everyone can see and post in.
//   - One-to-one threads between any two members, using a deterministic
//     thread id (sorted uid pair) so both sides land in the same doc.

import { db } from "./firebase-config.js";
import { currentUser, currentProfile, isSuperAdmin } from "./auth.js";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  where,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let unsubChat = null;
let currentThreadId = "group";
let currentThreadLabel = "Group chat";
let allMembers = [];

function threadIdFor(uidA, uidB) {
  return [uidA, uidB].sort().join("_");
}

export async function renderChatTab(container) {
  const membersSnap = await getDocs(collection(db, "members"));
  allMembers = membersSnap.docs.map((d) => ({ uid: d.id, ...d.data() })).filter((m) => m.uid !== currentUser.uid);

  renderThreadList(container);
}

export function teardownChatTab() {
  if (unsubChat) unsubChat();
}

function renderThreadList(container) {
  if (unsubChat) unsubChat();

  container.innerHTML = `
    <div class="chat-list-item" id="open-group-chat">
      <div class="chat-avatar"><i class="bi bi-people"></i></div>
      <div>
        <div style="font-weight:500; font-size:14px;">Group chat</div>
        <div style="font-size:12px; color:var(--text-muted);">Everyone on the trip</div>
      </div>
    </div>
    <div class="section-title">Direct messages</div>
    <div id="dm-list"></div>
  `;

  document.getElementById("open-group-chat").addEventListener("click", () => openThread(container, "group", "Group chat"));

  const dmList = document.getElementById("dm-list");
  if (allMembers.length === 0) {
    dmList.innerHTML = `<div class="empty-state"><i class="bi bi-chat-dots"></i>No other members yet.</div>`;
    return;
  }
  allMembers.forEach((m) => {
    const row = document.createElement("div");
    row.className = "chat-list-item";
    row.innerHTML = `
      <div class="chat-avatar">${initials(m.name)}</div>
      <div>
        <div style="font-weight:500; font-size:14px;">${escapeHtml(m.name)}</div>
        <div style="font-size:12px; color:var(--text-muted);">${escapeHtml(m.email)}</div>
      </div>
    `;
    row.addEventListener("click", () => openThread(container, threadIdFor(currentUser.uid, m.uid), m.name));
    dmList.appendChild(row);
  });
}

function openThread(container, threadId, label) {
  currentThreadId = threadId;
  currentThreadLabel = label;

  container.innerHTML = `
    <button class="back-link" id="chat-back"><i class="bi bi-chevron-left"></i> ${escapeHtml(label)}</button>
    <div class="chat-window">
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-input-row">
        <input id="chat-input" type="text" placeholder="Message" />
        <button class="btn-primary" id="chat-send"><i class="bi bi-send"></i></button>
      </div>
    </div>
  `;

  document.getElementById("chat-back").addEventListener("click", () => renderThreadList(container));

  const sendBtn = document.getElementById("chat-send");
  const input = document.getElementById("chat-input");
  const send = async () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await addDoc(collection(db, "chats", threadId, "messages"), {
      text,
      senderUid: currentUser.uid,
      senderName: currentProfile.name,
      createdAt: Date.now()
    });
  };
  sendBtn.addEventListener("click", send);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") send();
  });

  if (unsubChat) unsubChat();
  const q = query(collection(db, "chats", threadId, "messages"), orderBy("createdAt", "asc"));
  unsubChat = onSnapshot(q, (snap) => {
    const msgsEl = document.getElementById("chat-messages");
    if (!msgsEl) return;
    msgsEl.innerHTML = snap.docs
      .map((d) => {
        const m = d.data();
        const mine = m.senderUid === currentUser.uid;
        const deleteBtn = isSuperAdmin()
          ? `<button class="msg-delete" data-delete-msg="${d.id}" title="Delete message"><i class="bi bi-trash"></i></button>`
          : "";
        return `
          <div class="msg-row ${mine ? "msg-row-mine" : ""}">
            ${threadId === "group" && !mine ? `<div class="msg-sender">${escapeHtml(m.senderName)}</div>` : ""}
            <div class="msg-line">
              <div class="msg-bubble ${mine ? "msg-mine" : "msg-theirs"}">${escapeHtml(m.text)}</div>
              ${deleteBtn}
            </div>
          </div>
        `;
      })
      .join("");
    msgsEl.scrollTop = msgsEl.scrollHeight;

    if (isSuperAdmin()) {
      msgsEl.querySelectorAll("[data-delete-msg]").forEach((btn) =>
        btn.addEventListener("click", () => handleDeleteMessage(threadId, btn.dataset.deleteMsg))
      );
    }
  });
}

async function handleDeleteMessage(threadId, messageId) {
  const confirmed = confirm("Delete this message? This can't be undone.");
  if (!confirmed) return;
  await deleteDoc(doc(db, "chats", threadId, "messages", messageId));
}

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}