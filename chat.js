// chat.js
// WhatsApp-inspired chat UI for Munner Trip while preserving the existing
// group/direct-message chat infrastructure.

import { db, COLLECTIONS } from "./firebase-config.js";
import { currentUser, currentProfile, isAdmin, isSuperAdmin } from "./auth.js";
import { NotificationService, NOTIFICATION_TYPES } from "./notification-service.js";
import { renderAvatar } from "./avatar.js";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const CHAT_COLLECTION = "chats";
const CHAT_THREADS_COLLECTION = "chatThreads";
const STORAGE_KEY = "munner_chat_state_v2";

let unsubChat = null;
let currentThreadId = "group";
let allMembers = [];
let currentThreadType = "group";
let currentReplyTo = null;
let typingTimer = null;
let chatState = loadChatState();
let currentThreadContainer = null;
let currentThreadMessages = [];
let currentMessageSearch = "";
let threadPreviewState = {};
let activeConversationUnsub = null;
let isConversationLoading = false;
let isConversationReady = false;

export async function renderChatTab(container) {
  currentThreadContainer = container;
  if (!currentUser?.uid) {
    container.innerHTML = '<div class="empty-state"><i class="bi bi-chat-dots"></i>Sign in to view chat.</div>';
    return;
  }

  const membersSnap = await getDocs(collection(db, COLLECTIONS.MEMBERS));
  allMembers = membersSnap.docs
    .map((d) => ({ uid: d.id, ...d.data() }))
    .filter((m) => m.uid !== currentUser.uid);

  await markSelfOnline();
  renderThreadList(container);

  const route = readChatRouteFromHash();
  if (route) {
    const entry = buildThreadEntries().find((thread) => thread.id === route.threadId && thread.type === route.threadType);
    if (entry) {
      const mode = window.innerWidth <= 900 ? "mobile" : "panel";
      if (mode === "mobile") {
        openThreadFullScreen(container, entry.id, entry.name, entry.type);
      } else {
        openThreadInPanel(container, entry.id, entry.name, entry.type);
      }
    }
  } else if (window.innerWidth > 900 && !chatState.selectedChatId) {
    openThreadInPanel(container, "group", "Trip Group", "group");
  }
}

export function teardownChatTab() {
  if (unsubChat) unsubChat();
  if (activeConversationUnsub) activeConversationUnsub();
  markSelfOffline();
}

function renderThreadList(container) {
  if (unsubChat) unsubChat();
  currentThreadContainer = container;

  // Only rebuild the full shell if it doesn't already exist (avoids destroying the conversation panel)
  if (!container.querySelector(".chat-shell")) {
    container.innerHTML = `
      <div class="chat-shell">
        <div class="chat-sidebar">
          <div class="chat-sidebar-top">
            <div class="chat-sidebar-heading">
              <div>
                <h3>Chats</h3>
                <div class="chat-thread-preview">Realtime messages</div>
              </div>
              <button class="chat-icon-btn" id="chat-create-group" title="Create group"><i class="bi bi-plus-lg"></i></button>
            </div>
            <div class="chat-search-row">
              <i class="bi bi-search"></i>
              <input id="chat-search" type="text" placeholder="Search members, groups or messages" />
            </div>
            <div class="chat-section-title">Pinned Chats</div>
            <div id="pinned-list"></div>
            <div class="chat-section-title">Groups</div>
            <div id="group-list"></div>
            <div class="chat-section-title">Direct Messages</div>
            <div id="dm-list"></div>
            <div class="chat-section-title">Online Members</div>
            <div id="online-list"></div>
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
    searchInput?.addEventListener("input", () => {
      currentMessageSearch = searchInput.value.trim().toLowerCase();
      refreshChatLists(container);
    });
    document.getElementById("chat-create-group")?.addEventListener("click", () => createGroupThread());

    // On desktop, open the default/selected conversation only on first render
    if (window.innerWidth > 900) {
      const selectedId = chatState.selectedChatId || "group";
      const selectedType = chatState.selectedChatType || "group";
      const allEntries = buildThreadEntries();
      const entry = allEntries.find((t) => t.id === selectedId && t.type === selectedType)
        || allEntries.find((t) => t.id === "group" && t.type === "group");
      if (entry) {
        openThreadInPanel(container, entry.id, entry.name, entry.type);
      }
    }
  }

  refreshChatLists(container);
}

function refreshChatLists(container) {
  const search = (document.getElementById("chat-search")?.value || "").trim().toLowerCase();
  const pinnedList = document.getElementById("pinned-list");
  const groupList = document.getElementById("group-list");
  const dmList = document.getElementById("dm-list");
  const onlineList = document.getElementById("online-list");

  if (!pinnedList || !groupList || !dmList || !onlineList) return;

  const threadEntries = buildThreadEntries(search);
  const groups = threadEntries.filter((entry) => entry.type === "group");
  const directs = threadEntries.filter((entry) => entry.type === "direct");

  groupList.innerHTML = "";
  if (!groups.length) {
    groupList.innerHTML = '<div class="empty-state small">No groups found.</div>';
  } else {
    groups.forEach((thread) => groupList.appendChild(buildThreadCard(thread)));
  }

  dmList.innerHTML = "";
  if (!directs.length) {
    dmList.innerHTML = '<div class="empty-state small">No members found.</div>';
  } else {
    directs.forEach((thread) => dmList.appendChild(buildThreadCard(thread)));
  }

  pinnedList.innerHTML = "";
  const pinnedThreads = threadEntries.filter((thread) => chatState.pinned?.includes(thread.id));
  if (pinnedThreads.length) {
    pinnedThreads.forEach((thread) => pinnedList.appendChild(buildThreadCard(thread)));
  } else {
    pinnedList.innerHTML = '<div class="empty-state small">No pinned chats.</div>';
  }

  onlineList.innerHTML = "";
  const onlineMembers = allMembers.filter((member) => member.isOnline);
  if (!onlineMembers.length) {
    onlineList.innerHTML = '<div class="empty-state small">No members online.</div>';
  } else {
    onlineMembers.forEach((member) => {
      const threadId = getDirectThreadId(member.uid);
      const row = document.createElement("div");
      row.className = "chat-thread-item";
      row.dataset.threadId = threadId;
      row.dataset.threadLabel = member.name || "Member";
      row.dataset.threadType = "direct";
      row.innerHTML = `
        <div class="chat-avatar chat-avatar-direct">
          ${renderAvatar(member.name || "Member", { size: "small", className: "chat-avatar-inline", fallbackText: initials(member.name) })}
        </div>
        <div class="chat-thread-main">
          <div class="chat-thread-top">
            <div class="chat-thread-name">${escapeHtml(member.name || "Member")}</div>
            <span class="pill pill-approved">Online</span>
          </div>
        </div>
      `;
      onlineList.appendChild(row);
    });
  }

  // Wire all thread item clicks (uses event delegation per list section to avoid re-attaching on re-renders)
  [groupList, dmList, pinnedList, onlineList].forEach((listEl) => {
    // Remove old listener by cloning (avoids duplicate listeners)
    const fresh = listEl.cloneNode(true);
    listEl.parentNode.replaceChild(fresh, listEl);
    fresh.querySelectorAll(".chat-thread-item").forEach((item) => {
      item.addEventListener("click", () => {
        const threadId = item.dataset.threadId;
        const label = item.dataset.threadLabel;
        const type = item.dataset.threadType;
        if (!threadId || !type) return;
        selectConversation(threadId, label, type, container);
      });
      item.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        showThreadContextMenu(event, item.dataset.threadId);
      });
    });
  });

  // Update selected highlight
  updateSelectionHighlight();
}

function updateSelectionHighlight() {
  document.querySelectorAll(".chat-thread-item").forEach((item) => {
    const isSelected =
      item.dataset.threadId === chatState.selectedChatId &&
      item.dataset.threadType === chatState.selectedChatType;
    item.classList.toggle("chat-thread-selected", isSelected);
  });
}

function buildThreadEntries(search = "") {
  const entries = [];
  entries.push({
    id: "group",
    name: "Trip Group",
    label: "Trip Group",
    subtitle: "Everyone on the trip",
    type: "group",
    role: "Trip group",
    avatarClass: "chat-avatar-group"
  });

  allMembers.forEach((member) => {
    entries.push({
      id: getDirectThreadId(member.uid),
      name: member.name || "Member",
      label: member.name || "Member",
      subtitle: member.email || "",
      type: "direct",
      participant: member,
      role: member.role || "Member",
      avatarClass: "chat-avatar-direct"
    });
  });

  return entries
    .filter((thread) => {
      if (!search) return true;
      const haystack = `${thread.name} ${thread.subtitle} ${thread.role}`.toLowerCase();
      return haystack.includes(search);
    })
    .sort((a, b) => (threadPreviewState[b.id]?.createdAt || 0) - (threadPreviewState[a.id]?.createdAt || 0));
}

function buildThreadCard(threadMeta) {
  const row = document.createElement("div");
  row.className = "chat-thread-item";
  row.dataset.threadId = threadMeta.id;
  row.dataset.threadLabel = threadMeta.name;
  row.dataset.threadType = threadMeta.type;

  const isPinned = chatState.pinned?.includes(threadMeta.id);
  const isMuted = chatState.muted?.includes(threadMeta.id);
  const unreadCount = chatState.unread?.[threadMeta.id] || 0;
  const isSelected = chatState.selectedChatId === threadMeta.id && chatState.selectedChatType === threadMeta.type;
  const preview = threadPreviewState[threadMeta.id];
  const lastMessageText = preview?.text || threadMeta.subtitle;
  const lastMessageTime = preview?.createdAt ? formatTime(preview.createdAt) : "";
  const onlineLabel = threadMeta.type === "direct" && threadMeta.participant?.isOnline
    ? "Online"
    : threadMeta.type === "direct"
      ? `Last seen ${formatRelativeTime(threadMeta.participant?.lastSeenAt)}`
      : "Group";

  row.innerHTML = `
    <div class="chat-avatar ${threadMeta.avatarClass}">
      ${renderAvatar(threadMeta.name, { size: "small", className: "chat-avatar-inline", fallbackText: initials(threadMeta.name) })}
    </div>
    <div class="chat-thread-main">
      <div class="chat-thread-top">
        <div class="chat-thread-name">${escapeHtml(threadMeta.name)}</div>
        <div class="chat-thread-time">${escapeHtml(lastMessageTime || onlineLabel)}</div>
      </div>
      <div class="chat-thread-bottom">
        <div class="chat-thread-preview">${escapeHtml(lastMessageText)}</div>
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

async function selectConversation(threadId, label, type, container) {
  chatState.selectedChatId = threadId;
  chatState.selectedChatType = type;
  saveChatState();
  updateChatRoute(threadId, type);

  if (window.innerWidth <= 900) {
    openThreadFullScreen(container, threadId, label, type);
  } else {
    openThreadInPanel(container, threadId, label, type);
  }
}

async function openThreadInPanel(container, threadId, label, type) {
  currentThreadId = threadId;
  currentThreadType = type;
  isConversationLoading = true;
  isConversationReady = false;
  currentThreadMessages = [];

  const content = container.querySelector(".chat-content");
  if (!content) return;

  const participant = getThreadParticipant(threadId);
  const statusLabel = type === "group"
    ? "Group · Live chat"
    : participant?.isOnline
      ? "Online"
      : `Last seen ${formatRelativeTime(participant?.lastSeenAt)}`;

  content.innerHTML = `
    <div class="chat-conversation-header">
      <div class="chat-conversation-title">
        <div class="chat-avatar ${type === "group" ? "chat-avatar-group" : "chat-avatar-direct"}">
          ${renderAvatar(label, { size: "small", className: "chat-avatar-inline", fallbackText: initials(label) })}
        </div>
        <div>
          <div class="chat-thread-name">${escapeHtml(label)}</div>
          <div class="chat-thread-preview">${escapeHtml(statusLabel)}</div>
        </div>
      </div>
      <div class="chat-conversation-actions">
        <button class="chat-icon-btn" id="chat-search-msg-btn" title="Search messages"><i class="bi bi-search"></i></button>
        <button class="chat-icon-btn" id="chat-wallpaper-btn" title="Wallpaper"><i class="bi bi-brush"></i></button>
      </div>
    </div>
    <div class="chat-thread-search-row"><input id="chat-message-search" type="text" placeholder="Search this conversation" /></div>
    <div class="chat-messages" id="chat-messages">
      <div class="empty-state"><div class="spinner"></div><div>Loading messages…</div></div>
    </div>
    <div class="chat-reply-bar" id="chat-reply-bar"></div>
    <div class="chat-composer">
      <button class="chat-icon-btn" id="chat-emoji-btn" title="Emoji"><i class="bi bi-emoji-smile"></i></button>
      <button class="chat-icon-btn" id="chat-attachment-btn" title="Attachment"><i class="bi bi-paperclip"></i></button>
      <input id="chat-input" type="text" placeholder="Type a message" />
      <button class="btn-primary" id="chat-send" disabled><i class="bi bi-send"></i></button>
    </div>
  `;

  const sendBtn = document.getElementById("chat-send");
  const input = document.getElementById("chat-input");
  const replyBar = document.getElementById("chat-reply-bar");
  const messageSearchInput = document.getElementById("chat-message-search");

  messageSearchInput?.addEventListener("input", () => {
    currentMessageSearch = (messageSearchInput.value || "").trim().toLowerCase();
    renderThreadMessages(currentThreadMessages);
  });

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
  document.getElementById("chat-attachment-btn").addEventListener("click", () => showAttachmentPicker());
  document.getElementById("chat-wallpaper-btn").addEventListener("click", () => pickWallpaper());
  document.getElementById("chat-search-msg-btn").addEventListener("click", () => messageSearchInput?.focus());
  sendBtn.addEventListener("click", () => sendMessage({ input, replyBar }));
  await ensureConversationExists(threadId, type);
  await subscribeToThreadMessages(threadId, { input, sendBtn });
  refreshChatLists(currentThreadContainer || container);
}

async function openThreadFullScreen(container, threadId, label, type) {
  currentThreadId = threadId;
  currentThreadType = type;

  isConversationLoading = true;
  isConversationReady = false;
  currentThreadMessages = [];

  container.innerHTML = `
    <div class="chat-mobile-shell">
      <div class="chat-mobile-header">
        <button class="chat-icon-btn" id="chat-mobile-back"><i class="bi bi-arrow-left"></i></button>
        <div class="chat-conversation-title">
          <div class="chat-avatar ${type === "group" ? "chat-avatar-group" : "chat-avatar-direct"}">
            ${renderAvatar(label, { size: "small", className: "chat-avatar-inline", fallbackText: initials(label) })}
          </div>
          <div>
            <div class="chat-thread-name">${escapeHtml(label)}</div>
            <div class="chat-thread-preview">${type === "group" ? "Group · Live chat" : "Online"}</div>
          </div>
        </div>
      </div>
      <div class="chat-thread-search-row"><input id="chat-message-search" type="text" placeholder="Search this conversation" /></div>
      <div class="chat-messages" id="chat-messages">
        <div class="empty-state"><div class="spinner"></div><div>Loading messages…</div></div>
      </div>
      <div class="chat-reply-bar" id="chat-reply-bar"></div>
      <div class="chat-composer">
        <button class="chat-icon-btn" id="chat-emoji-btn" title="Emoji"><i class="bi bi-emoji-smile"></i></button>
        <button class="chat-icon-btn" id="chat-attachment-btn" title="Attachment"><i class="bi bi-paperclip"></i></button>
        <input id="chat-input" type="text" placeholder="Type a message" />
        <button class="btn-primary" id="chat-send"><i class="bi bi-send"></i></button>
      </div>
    </div>
  `;

  document.getElementById("chat-mobile-back").addEventListener("click", () => {
    // Force full shell rebuild so the sidebar reappears
    container.innerHTML = "";
    renderThreadList(container);
  });
  const input = document.getElementById("chat-input");
  const sendBtn = document.getElementById("chat-send");
  const replyBar = document.getElementById("chat-reply-bar");
  const messageSearchInput = document.getElementById("chat-message-search");

  messageSearchInput?.addEventListener("input", () => {
    currentMessageSearch = (messageSearchInput.value || "").trim().toLowerCase();
    renderThreadMessages(currentThreadMessages);
  });

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
  document.getElementById("chat-attachment-btn").addEventListener("click", () => showAttachmentPicker());
  sendBtn.addEventListener("click", () => sendMessage({ input, replyBar }));

  await ensureConversationExists(threadId, type);
  await subscribeToThreadMessages(threadId, { input, sendBtn });
}

async function subscribeToThreadMessages(threadId, controls = {}) {
  if (unsubChat) unsubChat();

  if (activeConversationUnsub) {
    activeConversationUnsub();
    activeConversationUnsub = null;
  }

  const q = query(collection(db, CHAT_COLLECTION, threadId, "messages"), orderBy("createdAt", "asc"));
  activeConversationUnsub = onSnapshot(q, (snap) => {
    currentThreadMessages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    isConversationLoading = false;
    isConversationReady = true;
    renderThreadMessages(currentThreadMessages);
    if (controls.sendBtn) {
      controls.sendBtn.disabled = false;
    }
    if (controls.input) {
      controls.input.disabled = false;
      controls.input.focus();
    }
    markThreadMessagesRead(currentThreadMessages);
    updateThreadPreview(threadId, currentThreadMessages.at(-1));
  });
}

function renderThreadMessages(messages) {
  const msgsEl = document.getElementById("chat-messages");
  if (!msgsEl) return;

  if (isConversationLoading) {
    msgsEl.innerHTML = '<div class="empty-state"><div class="spinner"></div><div>Loading messages…</div></div>';
    return;
  }

  const filtered = messages.filter((message) => {
    if (!currentMessageSearch) return true;
    const searchable = `${message.text || ""} ${message.fileName || ""} ${message.type || ""}`.toLowerCase();
    return searchable.includes(currentMessageSearch);
  });

  if (!filtered.length) {
    msgsEl.innerHTML = '<div class="empty-state">No messages yet.<br/>Start the conversation.</div>';
    return;
  }

  msgsEl.innerHTML = filtered.map((message) => renderMessageCard(message)).join("");
  msgsEl.scrollTop = msgsEl.scrollHeight;

  msgsEl.querySelectorAll("[data-edit-msg]").forEach((button) => {
    button.addEventListener("click", () => beginEditMessage(button.dataset.editMsg));
  });
  msgsEl.querySelectorAll("[data-delete-me-msg]").forEach((button) => {
    button.addEventListener("click", () => handleDeleteForMe(button.dataset.deleteMeMsg));
  });
  msgsEl.querySelectorAll("[data-delete-everyone-msg]").forEach((button) => {
    button.addEventListener("click", () => handleDeleteForEveryone(button.dataset.deleteEveryoneMsg));
  });
  msgsEl.querySelectorAll("[data-reply-msg]").forEach((button) => {
    button.addEventListener("click", () => setReplyTarget(button.dataset.replyMsg));
  });
  msgsEl.querySelectorAll("[data-forward-msg]").forEach((button) => {
    button.addEventListener("click", () => forwardMessage(button.dataset.forwardMsg));
  });
  msgsEl.querySelectorAll("[data-copy-msg]").forEach((button) => {
    button.addEventListener("click", () => copyMessage(button.dataset.copyMsg));
  });
  msgsEl.querySelectorAll("[data-react-msg]").forEach((button) => {
    button.addEventListener("click", () => addQuickReaction(button.dataset.reactMsg));
  });
  msgsEl.querySelectorAll("[data-star-msg]").forEach((button) => {
    button.addEventListener("click", () => toggleStarMessage(button.dataset.starMsg));
  });
  msgsEl.querySelectorAll("[data-pin-msg]").forEach((button) => {
    button.addEventListener("click", () => togglePinMessage(button.dataset.pinMsg));
  });
}

function renderMessageCard(message) {
  const mine = message.senderUid === currentUser?.uid;
  const hiddenForMe = message.deletedForUserIds?.includes(currentUser?.uid) || message.deletedForEveryone;
  if (hiddenForMe) {
    return "";
  }

  const content = renderMessageContent(message);
  const actionButtons = mine ? `
    <div class="chat-message-actions">
      <button class="chat-inline-btn" data-edit-msg="${message.id}" title="Edit"><i class="bi bi-pencil"></i></button>
      <button class="chat-inline-btn" data-delete-me-msg="${message.id}" title="Delete for me"><i class="bi bi-trash"></i></button>
      <button class="chat-inline-btn" data-delete-everyone-msg="${message.id}" title="Delete for everyone"><i class="bi bi-x-circle"></i></button>
      <button class="chat-inline-btn" data-reply-msg="${message.id}" title="Reply"><i class="bi bi-reply"></i></button>
      <button class="chat-inline-btn" data-forward-msg="${message.id}" title="Forward"><i class="bi bi-share"></i></button>
      <button class="chat-inline-btn" data-copy-msg="${message.id}" title="Copy"><i class="bi bi-clipboard"></i></button>
      <button class="chat-inline-btn" data-react-msg="${message.id}" title="React"><i class="bi bi-emoji-smile"></i></button>
      <button class="chat-inline-btn" data-star-msg="${message.id}" title="Star"><i class="bi bi-star"></i></button>
      <button class="chat-inline-btn" data-pin-msg="${message.id}" title="Pin"><i class="bi bi-pin-angle"></i></button>
    </div>
  ` : `
    <div class="chat-message-actions">
      <button class="chat-inline-btn" data-delete-me-msg="${message.id}" title="Delete for me"><i class="bi bi-trash"></i></button>
      <button class="chat-inline-btn" data-reply-msg="${message.id}" title="Reply"><i class="bi bi-reply"></i></button>
      <button class="chat-inline-btn" data-forward-msg="${message.id}" title="Forward"><i class="bi bi-share"></i></button>
      <button class="chat-inline-btn" data-copy-msg="${message.id}" title="Copy"><i class="bi bi-clipboard"></i></button>
      <button class="chat-inline-btn" data-react-msg="${message.id}" title="React"><i class="bi bi-emoji-smile"></i></button>
      <button class="chat-inline-btn" data-star-msg="${message.id}" title="Star"><i class="bi bi-star"></i></button>
      <button class="chat-inline-btn" data-pin-msg="${message.id}" title="Pin"><i class="bi bi-pin-angle"></i></button>
    </div>
  `;

  const reactions = message.reactions ? Object.values(message.reactions).filter(Boolean) : [];
  const reactionMarkup = reactions.length ? `<div class="chat-reaction-row">${reactions.map((emoji) => `<span class="chat-reaction-pill">${escapeHtml(emoji)}</span>`).join("")}</div>` : "";
  const statusBadge = mine ? `<span class="chat-status-badge">${message.status || "sent"}</span>` : "";

  return `
    <div class="msg-row ${mine ? "msg-row-mine" : ""}">
      ${currentThreadType === "group" && !mine ? `<div class="msg-sender">${escapeHtml(message.senderName || "User")}</div>` : ""}
      <div class="msg-line">
        <div class="msg-bubble ${mine ? "msg-mine" : "msg-theirs"}">
          ${content}
          <div class="msg-meta">
            <span>${formatTime(message.createdAt)}</span>
            ${statusBadge}
          </div>
        </div>
        ${actionButtons}
      </div>
      ${reactionMarkup}
    </div>
  `;
}

function renderMessageContent(message) {
  if (message.deletedForEveryone) {
    return '<span class="chat-message-deleted">This message was deleted</span>';
  }

  switch (message.type) {
    case "image":
      return `
        <div class="chat-media-card">
          <img src="${escapeAttribute(message.mediaUrl)}" alt="Shared image" />
          ${message.text ? `<div class="chat-media-caption">${escapeHtml(message.text)}</div>` : ""}
          <div class="chat-media-actions"><a href="${escapeAttribute(message.mediaUrl)}" target="_blank" rel="noreferrer">Preview</a><a href="${escapeAttribute(message.mediaUrl)}" download="${escapeAttribute(message.fileName || "image")}">Download</a></div>
        </div>
      `;
    case "video":
      return `
        <div class="chat-media-card">
          <video controls src="${escapeAttribute(message.mediaUrl)}"></video>
          ${message.text ? `<div class="chat-media-caption">${escapeHtml(message.text)}</div>` : ""}
          <div class="chat-media-actions"><a href="${escapeAttribute(message.mediaUrl)}" target="_blank" rel="noreferrer">Preview</a><a href="${escapeAttribute(message.mediaUrl)}" download="${escapeAttribute(message.fileName || "video")}">Download</a></div>
        </div>
      `;
    case "pdf":
    case "document":
      return `
        <div class="chat-media-card">
          <div class="chat-attachment-card">
            <i class="bi bi-file-earmark-text"></i>
            <div>
              <div class="chat-thread-name">${escapeHtml(message.fileName || "Document")}</div>
              <div class="chat-thread-preview">${escapeHtml(message.type === "pdf" ? "PDF" : "Document")}</div>
            </div>
          </div>
          ${message.text ? `<div class="chat-media-caption">${escapeHtml(message.text)}</div>` : ""}
          <div class="chat-media-actions"><a href="${escapeAttribute(message.mediaUrl)}" target="_blank" rel="noreferrer">Open</a><a href="${escapeAttribute(message.mediaUrl)}" download="${escapeAttribute(message.fileName || "document")}">Download</a></div>
        </div>
      `;
    default:
      return `<div class="chat-bubble-text">${escapeHtml(message.text || "")}</div>`;
  }
}

function setTypingState(isTyping) {
  const preview = document.querySelector(".chat-conversation-header .chat-thread-preview") || document.querySelector(".chat-thread-preview");
  if (!preview) return;
  preview.textContent = isTyping ? "Typing..." : currentThreadType === "group" ? "Group · Live chat" : "Online";
}

async function sendMessage({ input, replyBar }) {
  if (!isConversationReady || !currentThreadId) return;
  const text = input.value.trim();
  if (!text) return;

  const payload = {
    text,
    senderUid: currentUser.uid,
    senderName: currentProfile?.name || "You",
    createdAt: Date.now(),
    edited: false,
    deleted: false,
    deletedForUserIds: [],
    status: "sent",
    reactions: {},
    type: "text"
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

function showAttachmentPicker() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*,.pdf,.doc,.docx,.txt,.xls,.xlsx,video/*";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    const type = file.type.startsWith("image/") ? "image" : file.type.startsWith("video/") ? "video" : file.name.toLowerCase().endsWith(".pdf") ? "pdf" : "document";
    const mediaUrl = await readFileAsDataUrl(file);
    const payload = {
      type,
      mediaUrl,
      fileName: file.name,
      mimeType: file.type,
      senderUid: currentUser.uid,
      senderName: currentProfile?.name || "You",
      createdAt: Date.now(),
      edited: false,
      deleted: false,
      deletedForUserIds: [],
      status: "sent",
      reactions: {}
    };
    await addDoc(collection(db, CHAT_COLLECTION, currentThreadId, "messages"), payload);
  };
  input.click();
}

async function updateMessageStatus(threadId, messageId, status) {
  await updateDoc(doc(db, CHAT_COLLECTION, threadId, "messages", messageId), { status });
}

function beginEditMessage(messageId) {
  const input = document.getElementById("chat-input");
  const editedText = prompt("Edit your message", "");
  if (editedText === null) return;
  if (!editedText.trim()) return;
  updateDoc(doc(db, CHAT_COLLECTION, currentThreadId, "messages", messageId), {
    text: editedText.trim(),
    edited: true
  });
  input?.focus();
}

async function handleDeleteForMe(messageId) {
  const currentMessage = currentThreadMessages.find((message) => message.id === messageId);
  await updateDoc(doc(db, CHAT_COLLECTION, currentThreadId, "messages", messageId), {
    deletedForUserIds: Array.from(new Set([...(currentMessage?.deletedForUserIds || []), currentUser.uid]))
  });
}

async function handleDeleteForEveryone(messageId) {
  await updateDoc(doc(db, CHAT_COLLECTION, currentThreadId, "messages", messageId), {
    deletedForEveryone: true,
    deleted: true,
    text: "This message was deleted"
  });
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

async function forwardMessage(messageId) {
  const message = currentThreadMessages.find((entry) => entry.id === messageId);
  if (!message) return;
  const payload = {
    text: `Forwarded: ${message.text || message.fileName || "Forwarded message"}`,
    senderUid: currentUser.uid,
    senderName: currentProfile?.name || "You",
    createdAt: Date.now(),
    edited: false,
    deleted: false,
    deletedForUserIds: [],
    status: "sent",
    reactions: {},
    type: message.type || "text",
    mediaUrl: message.mediaUrl || "",
    fileName: message.fileName || "",
    forwardedFrom: messageId
  };
  await addDoc(collection(db, CHAT_COLLECTION, currentThreadId, "messages"), payload);
}

async function copyMessage(messageId) {
  const message = currentThreadMessages.find((entry) => entry.id === messageId);
  if (!message) return;
  const text = message.text || message.fileName || "";
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
}

async function addQuickReaction(messageId) {
  const emoji = prompt("Add a reaction", "👍");
  if (!emoji) return;
  await updateDoc(doc(db, CHAT_COLLECTION, currentThreadId, "messages", messageId), { [`reactions.${currentUser.uid}`]: emoji });
}

async function toggleStarMessage(messageId) {
  await updateDoc(doc(db, CHAT_COLLECTION, currentThreadId, "messages", messageId), { starred: true, starredByUid: currentUser.uid });
}

async function togglePinMessage(messageId) {
  await updateDoc(doc(db, CHAT_COLLECTION, currentThreadId, "messages", messageId), { pinned: true });
}

async function ensureConversationExists(threadId, type) {
  const conversationRef = doc(db, CHAT_COLLECTION, threadId);
  const conversationSnap = await getDoc(conversationRef);
  if (!conversationSnap.exists()) {
    await setDoc(conversationRef, {
      id: threadId,
      type,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
  }
}

function showThreadContextMenu(event, threadId) {
  const menu = document.createElement("div");
  menu.className = "chat-context-menu";
  menu.innerHTML = `
    <button class="chat-context-item" data-action="mute">${chatState.muted?.includes(threadId) ? "Unmute" : "Mute chat"}</button>
    <button class="chat-context-item" data-action="archive">${chatState.archived?.includes(threadId) ? "Unarchive" : "Archive chat"}</button>
    <button class="chat-context-item" data-action="pin">${chatState.pinned?.includes(threadId) ? "Unpin chat" : "Pin chat"}</button>
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
  } else if (action === "pin") {
    chatState.pinned = chatState.pinned.includes(threadId)
      ? chatState.pinned.filter((item) => item !== threadId)
      : [...chatState.pinned, threadId];
  } else if (action === "delete") {
    chatState.unread[threadId] = 0;
  }

  saveChatState();
  refreshChatLists(currentThreadContainer || document.body);
}

async function createGroupThread() {
  if (!isAdmin() && !isSuperAdmin()) {
    alert("Only admins can create groups.");
    return;
  }

  const groupName = prompt("Group name", "New group");
  if (!groupName) return;
  const threadRef = doc(collection(db, CHAT_THREADS_COLLECTION));
  await setDoc(threadRef, {
    id: threadRef.id,
    name: groupName,
    description: "Custom group",
    createdByUid: currentUser.uid,
    participantIds: [currentUser.uid, ...allMembers.map((member) => member.uid).filter(Boolean)],
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
  currentThreadId = threadRef.id;
  currentThreadType = "group";
  refreshChatLists(currentThreadContainer || document.body);
}

async function markSelfOnline() {
  if (!currentUser?.uid) return;
  await updateDoc(doc(db, COLLECTIONS.MEMBERS, currentUser.uid), {
    isOnline: true,
    lastSeenAt: Date.now(),
    onlineStatus: "online"
  }).catch(() => {});
}

async function markSelfOffline() {
  if (!currentUser?.uid) return;
  await updateDoc(doc(db, COLLECTIONS.MEMBERS, currentUser.uid), {
    isOnline: false,
    lastSeenAt: Date.now(),
    onlineStatus: "offline"
  }).catch(() => {});
}

async function markThreadMessagesRead(messages) {
  if (!messages.length) return;
  const unreadMessages = messages.filter((message) => message.senderUid !== currentUser?.uid && message.status !== "read");
  await Promise.all(unreadMessages.map((message) => updateDoc(doc(db, CHAT_COLLECTION, currentThreadId, "messages", message.id), {
    status: "read",
    readAt: Date.now(),
    readBy: [...new Set([...(message.readBy || []), currentUser.uid])]
  }).catch(() => {})));
}

function updateThreadPreview(threadId, latestMessage) {
  if (!latestMessage) return;
  threadPreviewState[threadId] = {
    text: latestMessage.text || latestMessage.fileName || latestMessage.type || "Message",
    createdAt: latestMessage.createdAt || Date.now()
  };
  if (currentThreadContainer) {
    refreshChatLists(currentThreadContainer);
  }
}

function getDirectThreadId(memberUid) {
  const ids = [currentUser?.uid, memberUid].sort();
  return `${ids[0]}_${ids[1]}`;
}

function counterpartUidForThread(threadId) {
  if (!threadId || threadId === "group") return null;
  const peerIds = threadId.split("_");
  return peerIds.find((uid) => uid !== currentUser?.uid) || null;
}

function getThreadParticipant(threadId) {
  if (threadId === "group") return null;
  return allMembers.find((member) => member.uid === counterpartUidForThread(threadId)) || null;
}

function pickWallpaper() {
  const choice = prompt("Wallpaper", chatState.wallpaper || "default");
  chatState.wallpaper = choice || "default";
  saveChatState();
  const shell = document.querySelector(".chat-messages");
  if (shell) shell.className = `chat-messages ${chatState.wallpaper}`;
}

function updateChatRoute(threadId, type) {
  if (!threadId || !type) {
    history.replaceState(null, "", "#/chat");
    return;
  }
  const route = type === "group" ? `/chat/group/${threadId}` : `/chat/user/${threadId}`;
  history.replaceState(null, "", `#${route}`);
}

function readChatRouteFromHash() {
  const hash = window.location.hash || "";
  const match = hash.match(/^#\/chat\/(group|user)\/([^/]+)$/i);
  if (!match) return null;
  return { threadType: match[1].toLowerCase(), threadId: match[2] };
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

function formatRelativeTime(value) {
  if (!value) return "recently";
  const date = typeof value === "number" ? new Date(value) : value?.toDate ? value.toDate() : new Date(value);
  const diff = Math.max(1, Math.round((Date.now() - date.getTime()) / 60000));
  return diff < 60 ? `${diff}m ago` : `${Math.round(diff / 60)}h ago`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read file"));
    reader.readAsDataURL(file);
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
