// chat.js
// WhatsApp-inspired chat UI for Munner Trip while preserving the existing
// group/direct-message chat infrastructure.

import { db } from "./firebase-config.js";
import { currentUser, currentProfile, isSuperAdmin } from "./auth.js";
import { NotificationService, NOTIFICATION_TYPES } from "./notification-service.js";
import { renderAvatar } from "./avatar.js";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CHAT_COLLECTION = "chats";
const STORAGE_KEY = "munner_chat_state_v1";

let unsubChat = null;
let currentThreadId = "group";
let allMembers = [];
let currentThreadType = "group";
let currentReplyTo = null;
let typingTimer = null;
let chatState = loadChatState();

export async function renderChatTab(container) {
  if (!currentUser?.uid) {
    container.innerHTML = '<div class="empty-state"><i class="bi bi-chat-dots"></i>Sign in to view chat.</div>';
    return;
  }

  const membersSnap = await getDocs(collection(db, "members"));
  allMembers = membersSnap.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .filter((m) => m.uid !== currentUser.uid);

  renderThreadList(container);
}

export function teardownChatTab() {
  if (unsubChat) unsubChat();
}

function renderThreadList(container) {
  if (unsubChat) unsubChat();

  container.innerHTML = `
    <div class="chat-shell">
      <div class="chat-sidebar">
        <div class="chat-sidebar-top">
          <div class="chat-sidebar-heading">
            <h3>Chats</h3>
            <span class="pill pill-approved">Munner Trip</span>
          </div>
          <div class="chat-search-row">
            <i class="bi bi-search"></i>
            <input id="chat-search" type="text" placeholder="Search members or groups" />
          </div>
          <div class="chat-section-title">Pinned Chats</div>
          <div id="pinned-list"></div>
          <div class="chat-section-title">Groups</div>
          <div id="group-list"></div>
          <div class="chat-section-title">Direct Messages</div>
          <div id="dm-list"></div>
        </div>
      </div>
      <div class="chat-content">
        <div class="chat-empty-state">
          <i class="bi bi-chat-text"></i>
          <h4>Select a conversation</h4>
          <p>Pick a group or member to begin chatting.</p>
        </div>
      </div>
    </div>
  `;

  const searchInput = document.getElementById("chat-search");
  searchInput?.addEventListener("input", () => renderThreadList(container));

  renderChatLists(container);

  if (window.innerWidth > 900) {
    openThreadInPanel(container, "group", "Group chat", "group");
  }
}

function renderChatLists(container) {
  const search = (document.getElementById("chat-search")?.value || "").trim().toLowerCase();
  const pinnedList = document.getElementById("pinned-list");
  const groupList = document.getElementById("group-list");
  const dmList = document.getElementById("dm-list");

  const groupNode = buildThreadCard({
    uid: "group",
    name: "Group chat",
    subtitle: "Everyone on the trip",
    type: "group",
    icon: "bi-people",
    avatarClass: "chat-avatar-group"
  }, search);
  groupList.innerHTML = "";
  if (groupNode) groupList.appendChild(groupNode);

  const visibleMembers = allMembers.filter((member) => {
    const haystack = `${member.name || ""} ${member.email || ""}`.toLowerCase();
    return !search || haystack.includes(search);
  });

  dmList.innerHTML = "";
  if (visibleMembers.length === 0) {
    dmList.innerHTML = '<div class="empty-state small">No members match your search.</div>';
  } else {
    visibleMembers.forEach((member) => {
      const node = buildThreadCard({
        uid: member.uid,
        name: member.name || "Member",
        subtitle: member.email || "",
        type: "direct",
        participant: member,
        icon: "bi-person",
        avatarClass: "chat-avatar-direct"
      }, search);
      if (node) dmList.appendChild(node);
    });
  }

  pinnedList.innerHTML = "";
  const pinnedThreads = ["group", ...visibleMembers.map((member) => member.uid)].filter((uid) => chatState.pinned?.includes(uid));
  if (pinnedThreads.length) {
    pinnedThreads.forEach((uid) => {
      const threadMeta = uid === "group"
        ? { uid: "group", name: "Group chat", subtitle: "Everyone on the trip", type: "group", icon: "bi-people", avatarClass: "chat-avatar-group" }
        : { uid, name: allMembers.find((member) => member.uid === uid)?.name || "Member", subtitle: allMembers.find((member) => member.uid === uid)?.email || "", type: "direct", participant: allMembers.find((member) => member.uid === uid), icon: "bi-person", avatarClass: "chat-avatar-direct" };
      const node = buildThreadCard(threadMeta, search);
      if (node) pinnedList.appendChild(node);
    });
  } else {
    pinnedList.innerHTML = '<div class="empty-state small">No pinned chats.</div>';
  }

  container.querySelectorAll(".chat-thread-item").forEach((item) => {
    item.addEventListener("click", () => {
      const threadId = item.dataset.threadId;
      const label = item.dataset.threadLabel;
      const type = item.dataset.threadType;
      if (window.innerWidth <= 900) {
        openThreadFullScreen(container, threadId, label, type);
      } else {
        openThreadInPanel(container, threadId, label, type);
      }
    });

    item.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      showThreadContextMenu(event, item.dataset.threadId);
    });
  });
}

function buildThreadCard(threadMeta, search) {
  const normalized = search ? `${threadMeta.name} ${threadMeta.subtitle}`.toLowerCase().includes(search) : true;
  if (!normalized) return null;

  const row = document.createElement("div");
  row.className = "chat-thread-item";
  row.dataset.threadId = threadMeta.uid;
  row.dataset.threadLabel = threadMeta.name;
  row.dataset.threadType = threadMeta.type;

  const isPinned = chatState.pinned?.includes(threadMeta.uid);
  const isMuted = chatState.muted?.includes(threadMeta.uid);
  const unreadCount = chatState.unread?.[threadMeta.uid] || 0;

  row.innerHTML = `
    <div class="chat-avatar ${threadMeta.avatarClass}">
      ${threadMeta.type === "group" ? renderAvatar("Group", { size: "small", className: "chat-avatar-inline", fallbackText: "G" }) : renderAvatar(threadMeta.name, { size: "small", className: "chat-avatar-inline", fallbackText: initials(threadMeta.name) })}
    </div>
    <div class="chat-thread-main">
      <div class="chat-thread-top">
        <div class="chat-thread-name">${escapeHtml(threadMeta.name)}</div>
        <div class="chat-thread-time">${threadMeta.type === "group" ? "Now" : "Online"}</div>
      </div>
      <div class="chat-thread-bottom">
        <div class="chat-thread-preview">${escapeHtml(threadMeta.subtitle)}</div>
        <div class="chat-thread-badges">
          ${isPinned ? '<i class="bi bi-pin-angle"></i>' : ""}
          ${isMuted ? '<i class="bi bi-bell-slash"></i>' : ""}
          ${unreadCount ? `<span class="chat-unread-badge">${unreadCount}</span>` : ""}
        </div>
      </div>
    </div>
  `;
  return row;
}

function openThreadInPanel(container, threadId, label, type) {
  currentThreadId = threadId;
  currentThreadType = type;

  const content = container.querySelector(".chat-content");
  if (!content) return;

  content.innerHTML = `
    <div class="chat-conversation-header">
      <div class="chat-conversation-title">
        <div class="chat-avatar ${type === "group" ? "chat-avatar-group" : "chat-avatar-direct"}">
          ${type === "group" ? renderAvatar("Group", { size: "small", className: "chat-avatar-inline", fallbackText: "G" }) : renderAvatar(label, { size: "small", className: "chat-avatar-inline", fallbackText: initials(label) })}
        </div>
        <div>
          <div class="chat-thread-name">${escapeHtml(label)}</div>
          <div class="chat-thread-preview">${type === "group" ? "Group · Live chat" : "Online · Last seen now"}</div>
        </div>
      </div>
      <div class="chat-conversation-actions">
        <button class="chat-icon-btn" title="Voice call"><i class="bi bi-telephone"></i></button>
        <button class="chat-icon-btn" title="Video call"><i class="bi bi-camera-video"></i></button>
        <button class="chat-icon-btn" title="Search"><i class="bi bi-search"></i></button>
      </div>
    </div>
    <div class="chat-messages" id="chat-messages"></div>
    <div class="chat-reply-bar" id="chat-reply-bar"></div>
    <div class="chat-composer">
      <button class="chat-icon-btn" id="chat-emoji-btn" title="Emoji"><i class="bi bi-emoji-smile"></i></button>
      <button class="chat-icon-btn" id="chat-attachment-btn" title="Attachment"><i class="bi bi-paperclip"></i></button>
      <button class="chat-icon-btn" id="chat-camera-btn" title="Camera"><i class="bi bi-camera"></i></button>
      <button class="chat-icon-btn" id="chat-gallery-btn" title="Gallery"><i class="bi bi-image"></i></button>
      <button class="chat-icon-btn" id="chat-document-btn" title="Document"><i class="bi bi-file-earmark-text"></i></button>
      <input id="chat-input" type="text" placeholder="Type a message" />
      <button class="btn-primary" id="chat-send"><i class="bi bi-send"></i></button>
    </div>
  `;

  const sendBtn = document.getElementById("chat-send");
  const input = document.getElementById("chat-input");
  const replyBar = document.getElementById("chat-reply-bar");

  input.addEventListener("focus", () => setTypingState(true));
  input.addEventListener("blur", () => setTypingState(false));
  input.addEventListener("input", () => {
    setTypingState(true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setTypingState(false), 1500);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage({ input, replyBar });
    }
  });

  document.getElementById("chat-emoji-btn").addEventListener("click", () => {
    const emoji = prompt("Add an emoji", "👍");
    if (emoji) {
      input.value = `${input.value}${emoji}`.trim();
      input.focus();
    }
  });
  document.getElementById("chat-attachment-btn").addEventListener("click", () => {
    const file = prompt("Attach a file", "image.png");
    if (file) input.value = `${input.value}📎 ${file}`.trim();
  });
  document.getElementById("chat-camera-btn").addEventListener("click", () => {
    input.value = `${input.value}📷 Camera`.trim();
  });
  document.getElementById("chat-gallery-btn").addEventListener("click", () => {
    input.value = `${input.value}🖼️ Gallery`.trim();
  });
  document.getElementById("chat-document-btn").addEventListener("click", () => {
    input.value = `${input.value}📄 Document`.trim();
  });

  sendBtn.addEventListener("click", () => sendMessage({ input, replyBar }));
  subscribeToThreadMessages(threadId);
}

function openThreadFullScreen(container, threadId, label, type) {
  currentThreadId = threadId;
  currentThreadType = type;

  container.innerHTML = `
    <div class="chat-mobile-shell">
      <div class="chat-mobile-header">
        <button class="chat-icon-btn" id="chat-mobile-back"><i class="bi bi-arrow-left"></i></button>
        <div class="chat-conversation-title">
          <div class="chat-avatar ${type === "group" ? "chat-avatar-group" : "chat-avatar-direct"}">
            ${type === "group" ? renderAvatar("Group", { size: "small", className: "chat-avatar-inline", fallbackText: "G" }) : renderAvatar(label, { size: "small", className: "chat-avatar-inline", fallbackText: initials(label) })}
          </div>
          <div>
            <div class="chat-thread-name">${escapeHtml(label)}</div>
            <div class="chat-thread-preview">${type === "group" ? "Group · Live chat" : "Online · Last seen now"}</div>
          </div>
        </div>
      </div>
      <div class="chat-messages" id="chat-messages"></div>
      <div class="chat-reply-bar" id="chat-reply-bar"></div>
      <div class="chat-composer">
        <button class="chat-icon-btn" id="chat-emoji-btn" title="Emoji"><i class="bi bi-emoji-smile"></i></button>
        <input id="chat-input" type="text" placeholder="Type a message" />
        <button class="btn-primary" id="chat-send"><i class="bi bi-send"></i></button>
      </div>
    </div>
  `;

  document.getElementById("chat-mobile-back").addEventListener("click", () => renderThreadList(container));
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const replyBar = document.getElementById("chat-reply-bar");

  input.addEventListener("focus", () => setTypingState(true));
  input.addEventListener("blur", () => setTypingState(false));
  input.addEventListener("input", () => {
    setTypingState(true);
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => setTypingState(false), 1500);
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      sendMessage({ input, replyBar });
    }
  });
  document.getElementById("chat-emoji-btn").addEventListener("click", () => {
    const emoji = prompt("Add an emoji", "👍");
    if (emoji) {
      input.value = `${input.value}${emoji}`.trim();
      input.focus();
    }
  });
  sendBtn.addEventListener("click", () => sendMessage({ input, replyBar }));

  subscribeToThreadMessages(threadId);
}

function subscribeToThreadMessages(threadId) {
  if (unsubChat) unsubChat();

  const q = query(collection(db, CHAT_COLLECTION, threadId, "messages"), orderBy("createdAt", "asc"));
  unsubChat = onSnapshot(q, (snap) => {
    const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const msgsEl = document.getElementById("chat-messages");
    if (!msgsEl) return;

    msgsEl.innerHTML = messages.map((message) => renderMessageCard(message, threadId)).join("");
    msgsEl.scrollTop = msgsEl.scrollHeight;

    msgsEl.querySelectorAll("[data-edit-msg]").forEach((button) => {
      button.addEventListener("click", () => beginEditMessage(threadId, button.dataset.editMsg));
    });
    msgsEl.querySelectorAll("[data-delete-msg]").forEach((button) => {
      button.addEventListener("click", () => handleDeleteMessage(threadId, button.dataset.deleteMsg));
    });
    msgsEl.querySelectorAll("[data-reply-msg]").forEach((button) => {
      button.addEventListener("click", () => setReplyTarget(button.dataset.replyMsg));
    });
    msgsEl.querySelectorAll("[data-react-msg]").forEach((button) => {
      button.addEventListener("click", () => addQuickReaction(threadId, button.dataset.reactMsg));
    });
  });
}

function renderMessageCard(message, threadId) {
  const mine = message.senderUid === currentUser?.uid;
  const deleted = message.deleted;
  const actionButtons = mine ? `
    <div class="chat-message-actions">
      <button class="chat-inline-btn" data-edit-msg="${message.id}" title="Edit"><i class="bi bi-pencil"></i></button>
      <button class="chat-inline-btn" data-delete-msg="${message.id}" title="Delete"><i class="bi bi-trash"></i></button>
      <button class="chat-inline-btn" data-reply-msg="${message.id}" title="Reply"><i class="bi bi-reply"></i></button>
      <button class="chat-inline-btn" data-react-msg="${message.id}" title="React"><i class="bi bi-emoji-smile"></i></button>
    </div>
  ` : `
    <div class="chat-message-actions">
      <button class="chat-inline-btn" data-reply-msg="${message.id}" title="Reply"><i class="bi bi-reply"></i></button>
      <button class="chat-inline-btn" data-react-msg="${message.id}" title="React"><i class="bi bi-emoji-smile"></i></button>
    </div>
  `;

  const content = deleted
    ? '<span class="chat-message-deleted">This message was deleted</span>'
    : `<div class="chat-bubble-text">${escapeHtml(message.text || "")}</div>`;

  const reactions = message.reactions ? Object.values(message.reactions).filter(Boolean) : [];
  const reactionMarkup = reactions.length ? `<div class="chat-reaction-row">${reactions.map((emoji) => `<span class="chat-reaction-pill">${escapeHtml(emoji)}</span>`).join("")}</div>` : "";

  return `
    <div class="msg-row ${mine ? "msg-row-mine" : ""}">
      ${threadId === "group" && !mine ? `<div class="msg-sender">${escapeHtml(message.senderName || "User")}</div>` : ""}
      <div class="msg-line">
        <div class="msg-bubble ${mine ? "msg-mine" : "msg-theirs"}">
          ${content}
          <div class="msg-meta">
            <span>${formatTime(message.createdAt)}</span>
            ${mine ? `<span>${message.status || "sent"}</span>` : ""}
          </div>
        </div>
        ${actionButtons}
      </div>
      ${reactionMarkup}
    </div>
  `;
}

function setTypingState(isTyping) {
  const preview = document.querySelector(".chat-thread-preview");
  if (!preview) return;
  preview.textContent = isTyping ? "Typing..." : currentThreadType === "group" ? "Group · Live chat" : "Online · Last seen now";
}

async function sendMessage({ input, replyBar }) {
  const text = input.value.trim();
  if (!text) return;

  const payload = {
    text,
    senderUid: currentUser.uid,
    senderName: currentProfile?.name || "You",
    createdAt: Date.now(),
    edited: false,
    deleted: false,
    status: "sent",
    reactions: {}
  };

  if (currentReplyTo) payload.replyTo = currentReplyTo;

  input.value = "";
  const ref = await addDoc(collection(db, CHAT_COLLECTION, currentThreadId, "messages"), payload);

  if (currentReplyTo) {
    currentReplyTo = null;
    renderReplyBar(replyBar);
  }

  const receiverIds = currentThreadType === "group"
    ? allMembers.map((member) => member.uid)
    : [counterpartUidForThread(currentThreadId)].filter(Boolean);

  if (receiverIds.length) {
    await NotificationService.send({
      type: NOTIFICATION_TYPES.CHAT_MESSAGE,
      title: currentThreadType === "group" ? "New group message" : "New message",
      message: `${currentProfile?.name || "You"}: ${text}`,
      senderId: currentUser.uid,
      senderName: currentProfile?.name || "You",
      receiverIds: receiverIds.filter((uid) => uid !== currentUser.uid),
      priority: "normal",
      deepLink: "#chat",
      targetType: "chat",
      targetId: currentThreadId,
      sound: "chat"
    });
  }

  setTimeout(() => updateMessageStatus(currentThreadId, ref.id, "delivered"), 700);
  setTimeout(() => updateMessageStatus(currentThreadId, ref.id, "read"), 1400);
}

async function updateMessageStatus(threadId, messageId, status) {
  await updateDoc(doc(db, CHAT_COLLECTION, threadId, "messages", messageId), { status });
}

function beginEditMessage(threadId, messageId) {
  const input = document.getElementById("chat-input");
  const editedText = prompt("Edit your message", "");
  if (editedText === null) return;
  if (!editedText.trim()) return;
  updateDoc(doc(db, CHAT_COLLECTION, threadId, "messages", messageId), {
    text: editedText.trim(),
    edited: true
  });
  input?.focus();
}

async function handleDeleteMessage(threadId, messageId) {
  const confirmed = confirm("Delete this message? This can't be undone.");
  if (!confirmed) return;
  await updateDoc(doc(db, CHAT_COLLECTION, threadId, "messages", messageId), { deleted: true, text: "This message was deleted" });
}

function setReplyTarget(messageId) {
  currentReplyTo = messageId;
  const replyBar = document.getElementById("chat-reply-bar");
  renderReplyBar(replyBar);
}

function renderReplyBar(replyBar) {
  if (!replyBar) return;
  if (!currentReplyTo) {
    replyBar.innerHTML = "";
    return;
  }
  replyBar.innerHTML = `
    <div class="chat-reply-preview">
      <span>Replying to a message</span>
      <button class="chat-inline-btn" id="clear-reply"><i class="bi bi-x"></i></button>
    </div>
  `;
  document.getElementById("clear-reply").addEventListener("click", () => {
    currentReplyTo = null;
    renderReplyBar(replyBar);
  });
}

async function addQuickReaction(threadId, messageId) {
  const emoji = prompt("Add a reaction", "👍");
  if (!emoji) return;
  await updateDoc(doc(db, CHAT_COLLECTION, threadId, "messages", messageId), { [`reactions.${currentUser.uid}`]: emoji });
}

function showThreadContextMenu(event, threadId) {
  const menu = document.createElement("div");
  menu.className = "chat-context-menu";
  menu.innerHTML = `
    <button class="chat-context-item" data-action="mute">${chatState.muted?.includes(threadId) ? "Unmute" : "Mute chat"}</button>
    <button class="chat-context-item" data-action="archive">${chatState.archived?.includes(threadId) ? "Unarchive" : "Archive chat"}</button>
    <button class="chat-context-item" data-action="delete">Delete chat</button>
  `;
  document.body.appendChild(menu);
  menu.style.left = `${event.clientX}px`;
  menu.style.top = `${event.clientY}px`;
  menu.querySelectorAll("[data-action]").forEach((button) => {
    button.addEventListener("click", () => {
      handleThreadAction(threadId, button.dataset.action);
      menu.remove();
    });
  });
  document.addEventListener("click", () => menu.remove(), { once: true });
}

function handleThreadAction(threadId, action) {
  if (!chatState.pinned) chatState.pinned = [];
  if (!chatState.muted) chatState.muted = [];
  if (!chatState.archived) chatState.archived = [];
  if (!chatState.unread) chatState.unread = {};

  if (action === "mute") {
    chatState.muted = chatState.muted.includes(threadId)
      ? chatState.muted.filter((item) => item !== threadId)
      : [...chatState.muted, threadId];
  } else if (action === "archive") {
    chatState.archived = chatState.archived.includes(threadId)
      ? chatState.archived.filter((item) => item !== threadId)
      : [...chatState.archived, threadId];
  } else if (action === "delete") {
    chatState.unread[threadId] = 0;
  }

  saveChatState();
  renderThreadList(document.querySelector(".chat-shell")?.parentElement || document.body);
}

function loadChatState() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveChatState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(chatState));
}

function counterpartUidForThread(threadId) {
  if (!threadId || threadId === "group") return null;
  const peerIds = threadId.split("_");
  return peerIds.find((uid) => uid !== currentUser?.uid) || null;
}

function initials(name) {
  return (name || "?")
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function formatTime(value) {
  if (!value) return "";
  const date = typeof value === "number" ? new Date(value) : value?.toDate ? value.toDate() : new Date(value);
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}