// dashboard.js
// New home dashboard for Munner Trip.
// Keeps the existing app structure intact while adding a modern, realtime-first landing experience.

import { db, COLLECTIONS } from "./firebase-config.js";
import { currentUser, currentProfile, isAdmin, isSuperAdmin } from "./auth.js";
import { NotificationService, NOTIFICATION_TYPES } from "./notification-service.js";
import { renderAvatar } from "./avatar.js";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let containerEl = null;
let activeUnsubscribers = [];
let weatherTimer = null;
let weatherData = null;
let dashboardState = {
  members: [],
  expenses: [],
  payments: [],
  planner: [],
  media: [],
  notifications: [],
  activity: [],
  polls: [],
  tripSettings: {}
};

const MS_IN_DAY = 1000 * 60 * 60 * 24;

export function renderDashboardTab(container) {
  containerEl = container;
  container.innerHTML = `
    <div class="dashboard-shell">
      <div class="dashboard-skeleton-card dashboard-hero-skeleton"></div>
      <div class="dashboard-grid">
        <div class="dashboard-skeleton-card"></div>
        <div class="dashboard-skeleton-card"></div>
        <div class="dashboard-skeleton-card"></div>
        <div class="dashboard-skeleton-card"></div>
      </div>
    </div>
  `;

  attachListeners();
  loadWeather();
  render();
}

export function teardownDashboardTab() {
  activeUnsubscribers.forEach((unsubscribe) => unsubscribe && unsubscribe());
  activeUnsubscribers = [];
  if (weatherTimer) {
    clearInterval(weatherTimer);
    weatherTimer = null;
  }
}

function attachListeners() {
  const membersQuery = query(collection(db, COLLECTIONS.MEMBERS), orderBy("addedAt", "asc"));
  subscribeToQuery(membersQuery, (snap) => {
    dashboardState.members = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    render();
  });

  const expensesQuery = query(collection(db, COLLECTIONS.EXPENSES), orderBy("createdAt", "desc"));
  subscribeToQuery(expensesQuery, (snap) => {
    dashboardState.expenses = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    render();
  });

  const paymentsQuery = query(collection(db, COLLECTIONS.PAYMENTS), orderBy("createdAt", "desc"));
  subscribeToQuery(paymentsQuery, (snap) => {
    dashboardState.payments = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    render();
  });

  const plannerQuery = query(collection(db, COLLECTIONS.PLANNER), orderBy("createdAt", "asc"));
  subscribeToQuery(plannerQuery, (snap) => {
    dashboardState.planner = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    render();
  });

  const mediaQuery = query(collection(db, COLLECTIONS.MEDIA), orderBy("createdAt", "desc"));
  subscribeToQuery(mediaQuery, (snap) => {
    dashboardState.media = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    render();
  });

  const notificationsQuery = query(collection(db, COLLECTIONS.NOTIFICATIONS), orderBy("createdAt", "desc"));
  subscribeToQuery(notificationsQuery, (snap) => {
    dashboardState.notifications = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    render();
  });

  const activityQuery = query(collection(db, COLLECTIONS.ACTIVITY_LOGS), orderBy("createdAt", "desc"));
  subscribeToQuery(activityQuery, (snap) => {
    dashboardState.activity = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    render();
  });

  const pollsQuery = query(collection(db, COLLECTIONS.POLLS), orderBy("createdAt", "desc"));
  subscribeToQuery(pollsQuery, (snap) => {
    dashboardState.polls = snap.docs.map((entry) => ({ id: entry.id, ...entry.data() }));
    render();
  });

  const settingsRef = doc(db, COLLECTIONS.TRIP_SETTINGS, "current");
  activeUnsubscribers.push(onSnapshot(settingsRef, (snap) => {
    dashboardState.tripSettings = snap.exists() ? snap.data() : {};
    render();
  }));

  weatherTimer = window.setInterval(loadWeather, 60 * 60 * 1000);
}

function subscribeToQuery(queryRef, callback) {
  const unsubscribe = onSnapshot(queryRef, callback);
  activeUnsubscribers.push(unsubscribe);
}

function render() {
  if (!containerEl) return;

  const role = currentProfile?.role || "member";
  const tripName = dashboardState.tripSettings?.tripName || "Munnar Trip";
  const greeting = getGreeting();
  const countdown = getCountdownState();
  const totalExpense = getTotalExpense();
  const pendingSettlements = getPendingSettlements();
  const unreadMessages = getUnreadMessages();
  const photoCount = getMediaCount("image");
  const videoCount = getMediaCount("video");
  const pendingPaymentRequests = getPendingPaymentRequests();
  const nextDestination = getNextDestination();
  const todayPlanner = getTodayPlannerItems();
  const activityFeed = dashboardState.activity.slice(0, 20);
  const activePoll = getActivePoll();
  const canManageTrip = isAdmin() || isSuperAdmin();

  containerEl.innerHTML = `
    <div class="dashboard-shell">
      <section class="dashboard-hero card">
        <div class="dashboard-hero-main">
          <div class="dashboard-profile-row">
            <div class="dashboard-avatar-wrap">
              ${getProfilePhotoMarkup()}
            </div>
            <div>
              <div class="dashboard-greeting">${escapeHtml(greeting)} ${escapeHtml(currentProfile?.name || "Member")} 👋</div>
              <div class="dashboard-role">${escapeHtml(getRoleLabel(role))}</div>
              <div class="dashboard-trip-name">${escapeHtml(tripName)}</div>
            </div>
          </div>
          <div class="dashboard-hero-actions">
            ${canManageTrip ? `<button class="btn-ghost small" id="open-trip-settings">Trip Settings</button>` : ""}
          </div>
        </div>

        <div class="dashboard-countdown-card">
          <div class="dashboard-countdown-header">
            <span class="pill pill-approved">${escapeHtml(countdown.label)}</span>
            <span class="dashboard-countdown-subtitle">${escapeHtml(countdown.subtitle)}</span>
          </div>
          <div class="dashboard-countdown-body">
            ${countdown.mode === "before" ? `
              <div class="countdown-stack">
                <div class="countdown-tile"><strong>${countdown.days}</strong><span>Days</span></div>
                <div class="countdown-tile"><strong>${countdown.hours}</strong><span>Hours</span></div>
                <div class="countdown-tile"><strong>${countdown.minutes}</strong><span>Minutes</span></div>
              </div>
            ` : countdown.mode === "during" ? `
              <div class="countdown-progress-block">
                <div class="dashboard-progress-row">
                  <strong>Day ${countdown.day} of ${countdown.totalDays}</strong>
                  <span>${countdown.progress}%</span>
                </div>
                <div class="dashboard-progress-bar"><span style="width:${Math.max(4, countdown.progress)}%"></span></div>
              </div>
            ` : `
              <div class="countdown-complete">Trip Completed</div>
            `}
          </div>
        </div>
      </section>

      <section class="dashboard-grid">
        <article class="dashboard-card">
          <div class="dashboard-card-icon"><i class="bi bi-calendar2-week"></i></div>
          <div>
            <div class="dashboard-card-label">Days Remaining</div>
            <div class="dashboard-card-value">${countdown.mode === "before" ? countdown.days : countdown.mode === "during" ? Math.max(0, countdown.totalDays - countdown.day + 1) : 0}</div>
          </div>
        </article>
        <article class="dashboard-card">
          <div class="dashboard-card-icon"><i class="bi bi-people"></i></div>
          <div>
            <div class="dashboard-card-label">Members</div>
            <div class="dashboard-card-value">${dashboardState.members.length}</div>
          </div>
        </article>
        <article class="dashboard-card">
          <div class="dashboard-card-icon"><i class="bi bi-receipt"></i></div>
          <div>
            <div class="dashboard-card-label">Expenses</div>
            <div class="dashboard-card-value">₹${formatCurrency(totalExpense)}</div>
          </div>
        </article>
        <article class="dashboard-card">
          <div class="dashboard-card-icon"><i class="bi bi-cash-stack"></i></div>
          <div>
            <div class="dashboard-card-label">Pending Settlements</div>
            <div class="dashboard-card-value">${pendingSettlements}</div>
          </div>
        </article>
        <article class="dashboard-card">
          <div class="dashboard-card-icon"><i class="bi bi-chat-dots"></i></div>
          <div>
            <div class="dashboard-card-label">Unread Messages</div>
            <div class="dashboard-card-value">${unreadMessages}</div>
          </div>
        </article>
        <article class="dashboard-card">
          <div class="dashboard-card-icon"><i class="bi bi-image"></i></div>
          <div>
            <div class="dashboard-card-label">Photos</div>
            <div class="dashboard-card-value">${photoCount}</div>
          </div>
        </article>
        <article class="dashboard-card">
          <div class="dashboard-card-icon"><i class="bi bi-film"></i></div>
          <div>
            <div class="dashboard-card-label">Videos</div>
            <div class="dashboard-card-value">${videoCount}</div>
          </div>
        </article>
        <article class="dashboard-card">
          <div class="dashboard-card-icon"><i class="bi bi-bell"></i></div>
          <div>
            <div class="dashboard-card-label">Pending Payment Requests</div>
            <div class="dashboard-card-value">${pendingPaymentRequests}</div>
          </div>
        </article>
      </section>

      <section class="dashboard-main-grid">
        <div class="dashboard-column">
          <article class="card dashboard-panel">
            <div class="dashboard-panel-header">
              <h3>Next Destination</h3>
            </div>
            ${nextDestination ? `
              <div class="dashboard-destination">
                <div class="dashboard-destination-title">${escapeHtml(nextDestination.title)}</div>
                <div class="dashboard-destination-meta">${escapeHtml(nextDestination.dateTime)}</div>
                <div class="dashboard-destination-meta">${escapeHtml(nextDestination.location)}</div>
                ${nextDestination.distance ? `<div class="dashboard-destination-meta">Distance: ${escapeHtml(nextDestination.distance)}</div>` : ""}
                ${nextDestination.mapsLink ? `<a class="btn-primary dashboard-inline-btn" href="${escapeHtml(nextDestination.mapsLink)}" target="_blank" rel="noreferrer">Open in Google Maps</a>` : ""}
              </div>
            ` : `<div class="empty-state">No upcoming destination.</div>`}
          </article>

          <article class="card dashboard-panel">
            <div class="dashboard-panel-header">
              <h3>Today's Planner</h3>
              <button class="btn-ghost small" id="open-planner">Open Planner</button>
            </div>
            ${todayPlanner.length ? todayPlanner.map((item) => `
              <div class="dashboard-list-item">
                <div class="dashboard-list-title">${escapeHtml(item.title)}</div>
                <div class="dashboard-list-meta">${escapeHtml(item.time || item.details || "Planner item")}</div>
              </div>
            `).join("") : `<div class="empty-state">No planner items for today.</div>`}
          </article>

          <article class="card dashboard-panel">
            <div class="dashboard-panel-header">
              <h3>Live Weather</h3>
              <span class="pill pill-approved">Munnar</span>
            </div>
            ${weatherData ? `
              <div class="dashboard-weather-row">
                <div>
                  <div class="dashboard-weather-temp">${weatherData.temperature}°C</div>
                  <div class="dashboard-weather-meta">${escapeHtml(weatherData.condition)}</div>
                </div>
                <div class="dashboard-weather-stats">
                  <div><strong>Humidity</strong><span>${weatherData.humidity}%</span></div>
                  <div><strong>Rain</strong><span>${weatherData.rain}%</span></div>
                  <div><strong>Wind</strong><span>${weatherData.wind} km/h</span></div>
                  <div><strong>High</strong><span>${weatherData.high}°C</span></div>
                  <div><strong>Low</strong><span>${weatherData.low}°C</span></div>
                </div>
              </div>
            ` : `<div class="empty-state">Weather unavailable.</div>`}
          </article>
        </div>

        <div class="dashboard-column">
          <article class="card dashboard-panel">
            <div class="dashboard-panel-header">
              <h3>Quick Actions</h3>
            </div>
            <div class="dashboard-quick-actions">
              <button class="btn-ghost" data-quick="expenses">Add Expense</button>
              <button class="btn-ghost" data-quick="planner">Open Planner</button>
              <button class="btn-ghost" data-quick="chat">Open Chat</button>
              <button class="btn-ghost" data-quick="media">Upload Media</button>
              <button class="btn-ghost" data-quick="settlements">View Settlements</button>
              ${canManageTrip ? `<button class="btn-ghost" id="create-poll-action">Create Poll</button>` : ""}
            </div>
          </article>

          ${activePoll ? `
            <article class="card dashboard-panel">
              <div class="dashboard-panel-header">
                <h3>Live Poll</h3>
                <span class="pill pill-approved">Active</span>
              </div>
              <div class="dashboard-poll-title">${escapeHtml(activePoll.question)}</div>
              <div class="dashboard-poll-options">
                ${activePoll.options.map((option, index) => {
                  const voteCount = option.voters ? option.voters.length : 0;
                  const totalVotes = activePoll.options.reduce((sum, current) => sum + (current.voters ? current.voters.length : 0), 0);
                  const percent = totalVotes ? Math.round((voteCount / totalVotes) * 100) : 0;
                  return `
                    <div class="dashboard-poll-option">
                      <div class="dashboard-poll-option-top">
                        <span>${escapeHtml(option.text)}</span>
                        <strong>${percent}%</strong>
                      </div>
                      <div class="dashboard-progress-bar"><span style="width:${percent}%"></span></div>
                      <div class="dashboard-poll-meta">
                        <span>${voteCount} vote${voteCount === 1 ? "" : "s"}</span>
                        ${canManageTrip ? `<button class="btn-ghost small" data-vote-poll="${activePoll.id}:${index}">Vote</button>` : `<button class="btn-ghost small" data-vote-poll="${activePoll.id}:${index}">Vote</button>`}
                      </div>
                      ${canManageTrip ? `<div class="dashboard-voter-list">${renderVoters(option.voters || [])}</div>` : ""}
                    </div>
                  `;
                }).join("")}
              </div>
            </article>
          ` : ""}

          <article class="card dashboard-panel">
            <div class="dashboard-panel-header">
              <h3>Recent Activity</h3>
            </div>
            <div class="dashboard-activity-list">
              ${activityFeed.length ? activityFeed.map((item) => `
                <div class="dashboard-activity-item">
                  <div class="dashboard-activity-title">${escapeHtml(item.title || item.message || "Activity")}</div>
                  <div class="dashboard-activity-meta">${escapeHtml(item.message || "")}</div>
                </div>
              `).join("") : `<div class="empty-state">No recent activity yet.</div>`}
            </div>
          </article>
        </div>
      </section>
    </div>
  `;

  attachDashboardEvents();
}

function attachDashboardEvents() {
  const tripSettingsBtn = document.getElementById("open-trip-settings");
  if (tripSettingsBtn) {
    tripSettingsBtn.addEventListener("click", () => openTripSettingsModal());
  }

  document.querySelectorAll("[data-quick]").forEach((button) => {
    button.addEventListener("click", () => {
      window.location.hash = button.dataset.quick;
    });
  });

  const openPlannerBtn = document.getElementById("open-planner");
  if (openPlannerBtn) {
    openPlannerBtn.addEventListener("click", () => {
      window.location.hash = "planner";
    });
  }

  const pollActionBtn = document.getElementById("create-poll-action");
  if (pollActionBtn) {
    pollActionBtn.addEventListener("click", () => openPollModal());
  }

  document.querySelectorAll("[data-vote-poll]").forEach((button) => {
    button.addEventListener("click", () => {
      const [pollId, optionIndex] = button.dataset.votePoll.split(":");
      voteOnPoll(pollId, Number(optionIndex));
    });
  });
}

function getProfilePhotoMarkup() {
  const photoUrl = currentProfile?.photoUrl || currentProfile?.avatarUrl || currentProfile?.profilePhotoUrl;
  if (photoUrl) {
    return `<img class="dashboard-avatar" src="${escapeAttribute(photoUrl)}" alt="Profile" />`;
  }
  return renderAvatar(currentProfile?.name || "Member", { size: "large", className: "dashboard-avatar" });
}

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good Morning";
  if (hour < 18) return "Good Afternoon";
  return "Good Evening";
}

function getCountdownState() {
  const startDate = getDateValue(dashboardState.tripSettings?.startDate);
  const endDate = getDateValue(dashboardState.tripSettings?.endDate);
  const now = new Date();

  if (!startDate && !endDate) {
    return {
      mode: "planning",
      label: "Before Trip",
      subtitle: "Set trip dates to see live countdown",
      days: 0,
      hours: 0,
      minutes: 0
    };
  }

  if (startDate && now < startDate) {
    const diff = startDate - now;
    const days = Math.max(0, Math.floor(diff / MS_IN_DAY));
    const hours = Math.max(0, Math.floor((diff % MS_IN_DAY) / (1000 * 60 * 60)));
    const minutes = Math.max(0, Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60)));
    return {
      mode: "before",
      label: "Before Trip",
      subtitle: "Starts in",
      days,
      hours,
      minutes
    };
  }

  if (startDate && endDate && now <= endDate) {
    const totalDays = Math.max(1, Math.ceil((endDate - startDate) / MS_IN_DAY) + 1);
    const currentDay = Math.min(totalDays, Math.max(1, Math.ceil((now - startDate) / MS_IN_DAY) + 1));
    const progress = Math.round(((now - startDate) / (endDate - startDate)) * 100);
    return {
      mode: "during",
      label: "During Trip",
      subtitle: "Trip Progress",
      day: currentDay,
      totalDays,
      progress: Number.isFinite(progress) ? Math.min(100, Math.max(0, progress)) : 0
    };
  }

  return {
    mode: "completed",
    label: "Completed",
    subtitle: "Trip Completed",
    days: 0,
    hours: 0,
    minutes: 0
  };
}

function getTotalExpense() {
  return dashboardState.expenses.reduce((sum, expense) => {
    if (expense?.status === "rejected") return sum;
    return sum + Number(expense?.amount || 0);
  }, 0);
}

function getPendingSettlements() {
  return dashboardState.payments.filter((payment) => {
    return ["Pending", "Waiting Receiver Approval", "Payment Recorded"].includes(payment?.status);
  }).length;
}

function getUnreadMessages() {
  return dashboardState.notifications.filter((notification) => {
    const state = notification?.userState?.[currentUser?.uid] || {};
    return (notification?.type === NOTIFICATION_TYPES.CHAT_MESSAGE || notification?.category === "Chat") && !state.isRead;
  }).length;
}

function getMediaCount(type) {
  return dashboardState.media.filter((item) => {
    const normalizedType = String(item?.type || item?.mimeType || "").toLowerCase();
    return normalizedType.includes(type);
  }).length;
}

function getPendingPaymentRequests() {
  return dashboardState.payments.filter((payment) => {
    return payment?.creditorUid === currentUser?.uid && ["Pending", "Waiting Receiver Approval", "Payment Recorded"].includes(payment?.status);
  }).length;
}

function getNextDestination() {
  const candidates = dashboardState.planner
    .map((item) => ({
      id: item.id,
      title: item.destinationName || item.title || "Destination",
      dateTime: item.destinationDate || item.dateTime || item.date || item.time || "",
      location: item.destinationAddress || item.location || item.details || "",
      mapsLink: item.destinationGoogleMapsLink || item.mapsUrl || "",
      distance: item.distance || "",
      sortValue: getPlannerSortValue(item)
    }))
    .filter((item) => item.sortValue !== null)
    .sort((a, b) => a.sortValue - b.sortValue);

  return candidates.find((item) => item.sortValue > Date.now()) || null;
}

function getTodayPlannerItems() {
  const today = new Date();
  const todayItems = dashboardState.planner.filter((item) => {
    const itemDate = getDateValue(item.date || item.destinationDate || item.dateTime || item.createdAt);
    if (!itemDate) return true;
    return itemDate.toDateString() === today.toDateString();
  });

  return todayItems.slice(0, 5).map((item) => ({
    title: item.title || item.destinationName || "Planner Item",
    time: item.time || item.destinationTime || item.details || "",
    details: item.details || item.destinationAddress || ""
  }));
}

function getPlannerSortValue(item) {
  const value = getDateValue(item.destinationDate || item.date || item.dateTime || item.startDate || item.createdAt);
  if (!value) return null;
  return value.getTime();
}

function getActivePoll() {
  return dashboardState.polls.find((poll) => poll?.active) || null;
}

function renderVoters(voters = []) {
  if (!voters.length) return '<span class="dashboard-voter-empty">No votes yet</span>';
  return voters.map((voter) => `<span class="dashboard-voter-pill">${escapeHtml(voter.name || "Member")}</span>`).join("");
}

async function openTripSettingsModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>Trip Settings</h3>
      <div class="admin-form-grid">
        <input id="trip-name" type="text" placeholder="Trip Name" value="${escapeAttribute(dashboardState.tripSettings?.tripName || "")}" />
        <input id="trip-cover" type="text" placeholder="Trip Cover Image URL" value="${escapeAttribute(dashboardState.tripSettings?.coverImage || "")}" />
        <input id="trip-description" type="text" placeholder="Trip Description" value="${escapeAttribute(dashboardState.tripSettings?.description || "")}" />
        <input id="trip-start-date" type="date" value="${escapeAttribute(formatDateInput(dashboardState.tripSettings?.startDate))}" />
        <input id="trip-end-date" type="date" value="${escapeAttribute(formatDateInput(dashboardState.tripSettings?.endDate))}" />
        <select id="trip-countdown-mode">
          <option value="before" ${dashboardState.tripSettings?.countdownMode === "before" ? "selected" : ""}>Before Trip</option>
          <option value="during" ${dashboardState.tripSettings?.countdownMode === "during" ? "selected" : ""}>During Trip</option>
          <option value="completed" ${dashboardState.tripSettings?.countdownMode === "completed" ? "selected" : ""}>Completed</option>
        </select>
        <input id="destination-name" type="text" placeholder="Destination Name" value="${escapeAttribute(dashboardState.tripSettings?.destinationName || "")}" />
        <input id="destination-address" type="text" placeholder="Destination Address" value="${escapeAttribute(dashboardState.tripSettings?.destinationAddress || "")}" />
        <input id="destination-link" type="text" placeholder="Destination Google Maps Link" value="${escapeAttribute(dashboardState.tripSettings?.destinationLink || "")}" />
        <input id="destination-date" type="date" value="${escapeAttribute(formatDateInput(dashboardState.tripSettings?.destinationDate))}" />
        <input id="destination-time" type="time" value="${escapeAttribute(dashboardState.tripSettings?.destinationTime || "")}" />
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="trip-settings-cancel">Cancel</button>
        <button class="btn-primary" id="trip-settings-save">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#trip-settings-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.querySelector("#trip-settings-save").addEventListener("click", async () => {
    const payload = {
      tripName: overlay.querySelector("#trip-name").value.trim() || "Munnar Trip",
      coverImage: overlay.querySelector("#trip-cover").value.trim(),
      description: overlay.querySelector("#trip-description").value.trim(),
      startDate: overlay.querySelector("#trip-start-date").value || null,
      endDate: overlay.querySelector("#trip-end-date").value || null,
      countdownMode: overlay.querySelector("#trip-countdown-mode").value,
      destinationName: overlay.querySelector("#destination-name").value.trim(),
      destinationAddress: overlay.querySelector("#destination-address").value.trim(),
      destinationLink: overlay.querySelector("#destination-link").value.trim(),
      destinationDate: overlay.querySelector("#destination-date").value || null,
      destinationTime: overlay.querySelector("#destination-time").value || null,
      updatedAt: Date.now()
    };

    await setDoc(doc(db, COLLECTIONS.TRIP_SETTINGS, "current"), payload, { merge: true });
    await addActivityEntry({
      title: "Trip settings updated",
      message: `${currentProfile?.name || "Admin"} updated trip settings.`,
      type: "trip_updated",
      targetType: "dashboard",
      targetId: "trip-settings",
      entryType: "activity"
    });
    overlay.remove();
  });
}

async function openPollModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>Create Poll</h3>
      <input id="poll-question" type="text" placeholder="Poll question" />
      <input id="poll-option-1" type="text" placeholder="Option 1" />
      <input id="poll-option-2" type="text" placeholder="Option 2" />
      <input id="poll-option-3" type="text" placeholder="Option 3" />
      <input id="poll-option-4" type="text" placeholder="Option 4" />
      <div class="modal-actions">
        <button class="btn-ghost" id="poll-cancel">Cancel</button>
        <button class="btn-primary" id="poll-submit">Create</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#poll-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
  overlay.querySelector("#poll-submit").addEventListener("click", async () => {
    const question = overlay.querySelector("#poll-question").value.trim();
    const options = [1, 2, 3, 4].map((index) => overlay.querySelector(`#poll-option-${index}`).value.trim()).filter(Boolean);
    if (!question || options.length < 2) {
      alert("Enter a question and at least two options.");
      return;
    }

    await addDoc(collection(db, COLLECTIONS.POLLS), {
      question,
      active: true,
      options: options.map((text) => ({ text, voters: [] })),
      createdAt: Date.now(),
      createdByUid: currentUser?.uid || null,
      createdByName: currentProfile?.name || "Admin",
      votedBy: []
    });

    await addActivityEntry({
      title: "Poll created",
      message: `${currentProfile?.name || "Admin"} created a new poll.`,
      type: "poll_created",
      targetType: "dashboard",
      targetId: "poll",
      entryType: "activity"
    });
    overlay.remove();
  });
}

async function voteOnPoll(pollId, optionIndex) {
  const poll = dashboardState.polls.find((entry) => entry.id === pollId);
  if (!poll) return;

  const hasVoted = (poll.votedBy || []).some((entry) => entry.uid === currentUser?.uid);
  if (hasVoted) {
    alert("You already voted on this poll.");
    return;
  }

  const options = Array.isArray(poll.options) ? poll.options : [];
  const nextOptions = options.map((option, index) => {
    if (index !== optionIndex) return option;
    return {
      ...option,
      voters: [
        ...(option.voters || []),
        { uid: currentUser?.uid || null, name: currentProfile?.name || "Member" }
      ]
    };
  });

  await updateDoc(doc(db, COLLECTIONS.POLLS, pollId), {
    options: nextOptions,
    votedBy: [
      ...(poll.votedBy || []),
      { uid: currentUser?.uid || null, name: currentProfile?.name || "Member" }
    ]
  });

  await addActivityEntry({
    title: "Poll voted",
    message: `${currentProfile?.name || "Member"} voted in a poll.`,
    type: "poll_voted",
    targetType: "dashboard",
    targetId: pollId,
    entryType: "activity"
  });
}

async function addActivityEntry(payload) {
  await addDoc(collection(db, COLLECTIONS.ACTIVITY_LOGS), {
    ...payload,
    actorUid: currentUser?.uid || null,
    actorName: currentProfile?.name || "System",
    createdAt: Date.now(),
    updatedAt: Date.now()
  });
}

async function loadWeather() {
  try {
    const response = await fetch("https://api.open-meteo.com/v1/forecast?latitude=10.0889&longitude=77.0595&current=temperature_2m,weather_code,relative_humidity_2m,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto");
    if (!response.ok) throw new Error("Weather unavailable");
    const data = await response.json();
    const current = data.current || {};
    const daily = data.daily || {};
    weatherData = {
      temperature: Math.round(current.temperature_2m),
      condition: describeWeatherCode(current.weather_code),
      humidity: current.relative_humidity_2m,
      rain: daily.precipitation_probability_max?.[0] || 0,
      wind: Math.round(current.wind_speed_10m),
      high: Math.round(daily.temperature_2m_max?.[0] || 0),
      low: Math.round(daily.temperature_2m_min?.[0] || 0)
    };
    render();
  } catch (error) {
    weatherData = null;
    render();
  }
}

function describeWeatherCode(code) {
  const map = {
    0: "Clear sky",
    1: "Mainly clear",
    2: "Partly cloudy",
    3: "Overcast",
    45: "Fog",
    48: "Rime fog",
    51: "Light drizzle",
    61: "Rain",
    71: "Snow",
    95: "Thunderstorm"
  };
  return map[code] || "Clear sky";
}

function getDateValue(value) {
  if (!value) return null;
  if (value?.toDate) return value.toDate();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
    return null;
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
  if (typeof value === "number") return new Date(value);
  return null;
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function formatDateInput(value) {
  const date = getDateValue(value);
  if (!date) return "";
  return date.toISOString().slice(0, 10);
}

function getRoleLabel(role) {
  switch (role) {
    case "super_admin":
      return "Super Admin";
    case "admin":
      return "Admin";
    default:
      return "Member";
  }
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}

function escapeAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
