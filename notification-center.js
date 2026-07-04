// notification-center.js
// Realtime notification center UI for the web app.

import { currentUser } from "./auth.js";
import { NotificationService, NOTIFICATION_CATEGORIES } from "./notification-service.js";
import { renderAvatar } from "./avatar.js";

let unsubscribeNotifications = null;
let unsubscribeUnreadCount = null;
let allNotifications = [];
let visibleNotifications = [];
let currentFilter = "all";
let currentSearch = "";
let currentPage = 1;
let pageSize = 10;
let hasMore = false;
let lastDeletedId = null;
let currentContainer = null;
let currentListEl = null;
let loadMoreObserver = null;

export function renderNotificationCenter(container) {
  currentContainer = container;
  currentContainer.innerHTML = `
    <div class="card notification-shell">
      <div class="row notification-toolbar">
        <h3>Notifications</h3>
        <div class="notification-actions">
          <button class="btn-ghost small" id="mark-all-read">Mark all read</button>
        </div>
      </div>

      <div class="notification-controls">
        <input id="notification-search" class="notification-search" type="text" placeholder="Search notifications" />
        <div class="notification-filters" id="notification-filters"></div>
      </div>

      <div id="notification-feedback" class="notification-feedback"></div>
      <div id="notification-list" class="notification-list"></div>
      <div id="notification-sentinel"></div>
    </div>
  `;

  currentListEl = document.getElementById("notification-list");
  const searchEl = document.getElementById("notification-search");
  const feedbackEl = document.getElementById("notification-feedback");
  const filtersEl = document.getElementById("notification-filters");

  const filters = [
    { key: "all", label: "All" },
    { key: "unread", label: "Unread" },
    { key: "read", label: "Read" },
    { key: "archived", label: "Archived" }
  ];

  filtersEl.innerHTML = filters.map((filter) => `
    <button class="notification-filter ${currentFilter === filter.key ? "active" : ""}" data-filter="${filter.key}">${filter.label}</button>
  `).join("");

  filtersEl.querySelectorAll(".notification-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      currentFilter = btn.dataset.filter;
      currentPage = 1;
      renderVisibleNotifications();
      filtersEl.querySelectorAll(".notification-filter").forEach((candidate) => candidate.classList.toggle("active", candidate.dataset.filter === currentFilter));
    });
  });

  searchEl.addEventListener("input", (event) => {
    currentSearch = event.target.value.trim().toLowerCase();
    currentPage = 1;
    renderVisibleNotifications();
  });

  document.getElementById("mark-all-read").addEventListener("click", () => NotificationService.markAllRead(currentUser.uid));

  if (unsubscribeNotifications) unsubscribeNotifications();
  if (unsubscribeUnreadCount) unsubscribeUnreadCount();

  unsubscribeNotifications = NotificationService.subscribeToNotifications(currentUser.uid, (notifications) => {
    allNotifications = notifications;
    renderVisibleNotifications();
  });

  unsubscribeUnreadCount = NotificationService.subscribeUnreadCount(currentUser.uid, (count) => {
    const badgeEl = document.getElementById("alerts-badge");
    if (badgeEl) {
      badgeEl.textContent = count > 0 ? count : "";
      badgeEl.style.display = count > 0 ? "inline-flex" : "none";
    }
  });

  if (loadMoreObserver) loadMoreObserver.disconnect();
  const sentinel = document.getElementById("notification-sentinel");
  if (sentinel && "IntersectionObserver" in window) {
    loadMoreObserver = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasMore) {
        currentPage += 1;
        renderVisibleNotifications({ append: true });
      }
    }, { rootMargin: "200px 0px" });
    loadMoreObserver.observe(sentinel);
  }

  renderVisibleNotifications();
}

function renderVisibleNotifications({ append = false } = {}) {
  if (!currentListEl) return;

  const filtered = allNotifications.filter((item) => matchesFilter(item) && matchesSearch(item));
  const sorted = filtered.sort((a, b) => (Number(b.createdAt?.seconds || 0) * 1000) - (Number(a.createdAt?.seconds || 0) * 1000));
  const totalPages = Math.ceil(sorted.length / pageSize);
  const visibleSlice = sorted.slice(0, currentPage * pageSize);
  hasMore = currentPage < totalPages;

  if (!append) {
    visibleNotifications = visibleSlice;
  } else {
    visibleNotifications = visibleSlice;
  }

  const feedbackEl = document.getElementById("notification-feedback");
  if (lastDeletedId) {
    feedbackEl.innerHTML = `
      <div class="notification-feedback-bar">
        <span>Notification deleted.</span>
        <button class="btn-ghost small" id="undo-delete-btn">Undo</button>
      </div>
    `;
    document.getElementById("undo-delete-btn").addEventListener("click", async () => {
      await NotificationService.undoDeleteNotification(lastDeletedId);
      lastDeletedId = null;
      renderVisibleNotifications();
    });
  } else {
    feedbackEl.innerHTML = "";
  }

  if (!sorted.length) {
    currentListEl.innerHTML = '<div class="empty-state">No notifications yet.</div>';
    return;
  }

  currentListEl.innerHTML = visibleNotifications.map((item) => {
    const state = item.userState?.[currentUser.uid] || { isRead: false, isArchived: false, isDeleted: false };
    const category = item.category || NOTIFICATION_CATEGORIES.SYSTEM;
    const timestamp = formatTimestamp(item.createdAt);
    const cardClass = state.isRead ? "notification-card read" : "notification-card unread";
    const archiveLabel = state.isArchived ? "Unarchive" : "Archive";
    const archiveHandler = state.isArchived ? "unarchive" : "archive";

    return `
      <div class="${cardClass}">
        <div class="notification-card-top">
          <div style="display:flex; align-items:flex-start; gap:8px;">
            ${renderAvatar(item.senderName || "System", { size: "small", className: "avatar-inline" })}
            <div>
              <div class="notification-title-row">
                <strong>${escapeHtml(item.title)}</strong>
              <span class="pill notification-pill">${escapeHtml(category)}</span>
            </div>
            <div class="notification-meta">${escapeHtml(item.senderName || "System")} · ${timestamp}</div>
          </div>
          <span class="pill ${state.isRead ? "pill-approved" : "pill-pending"}">${state.isRead ? "Read" : "New"}</span>
        </div>
        <div class="notification-message">${escapeHtml(item.message)}</div>
        <div class="notification-actions-row">
          <button class="btn-ghost small" data-action="read" data-id="${item.id}">${state.isRead ? "Mark unread" : "Mark read"}</button>
          <button class="btn-ghost small" data-action="${archiveHandler}" data-id="${item.id}">${archiveLabel}</button>
          <button class="btn-danger small" data-action="delete" data-id="${item.id}">Delete</button>
        </div>
      </div>
    `;
  }).join("");

  currentListEl.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      if (action === "read") {
        await NotificationService.markRead(id);
      } else if (action === "archive") {
        await NotificationService.archiveNotification(id);
      } else if (action === "unarchive") {
        await NotificationService.unarchiveNotification(id);
      } else if (action === "delete") {
        lastDeletedId = id;
        await NotificationService.deleteNotification(id);
      }
      renderVisibleNotifications();
    });
  });

  currentListEl.querySelectorAll(".notification-card").forEach((card) => {
    card.addEventListener("click", async () => {
      const id = card.querySelector("[data-id]")?.dataset.id;
      if (id) {
        await NotificationService.markRead(id);
      }
      const notification = allNotifications.find((item) => item.id === id);
      if (notification?.deepLink) {
        window.location.hash = notification.deepLink.replace(/^#/, "");
      }
      renderVisibleNotifications();
    });
  });

  const loadMoreWrapper = document.createElement("div");
  loadMoreWrapper.className = "notification-load-more";
  loadMoreWrapper.innerHTML = hasMore ? '<button class="btn-ghost" id="load-more-btn">Load more</button>' : '<div class="hint">You are up to date.</div>';
  currentListEl.appendChild(loadMoreWrapper);
  const loadMoreBtn = document.getElementById("load-more-btn");
  if (loadMoreBtn) {
    loadMoreBtn.addEventListener("click", () => {
      currentPage += 1;
      renderVisibleNotifications({ append: true });
    });
  }
}

function matchesFilter(item) {
  const state = item.userState?.[currentUser.uid] || { isRead: false, isArchived: false, isDeleted: false };
  if (currentFilter === "unread") return !state.isRead;
  if (currentFilter === "read") return state.isRead;
  if (currentFilter === "archived") return state.isArchived;
  return true;
}

function matchesSearch(item) {
  if (!currentSearch) return true;
  const haystack = [item.title, item.message, item.senderName, item.category, item.type]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(currentSearch);
}

function formatTimestamp(value) {
  if (!value) return "just now";
  const date = value.toDate ? value.toDate() : new Date(value.seconds ? value.seconds * 1000 : value);
  return date.toLocaleString();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
