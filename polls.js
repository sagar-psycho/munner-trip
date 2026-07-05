// polls.js
// Full Poll & Voting module for Munner Trip.

import { db, COLLECTIONS } from "./firebase-config.js";
import { currentUser, currentProfile, isAdmin, isSuperAdmin } from "./auth.js";
import { NotificationService, NOTIFICATION_TYPES } from "./notification-service.js";
import { renderAvatar } from "./avatar.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ─── Constants ────────────────────────────────────────────────────────────────
const POLL_TYPES = { SINGLE: "single", MULTIPLE: "multiple", YES_NO: "yes_no" };
const POLL_TYPE_LABELS = { single: "Single Choice", multiple: "Multiple Choice", yes_no: "Yes / No" };
const MAX_OPTIONS = 20;
const MIN_OPTIONS = 2;

// ─── Module State ─────────────────────────────────────────────────────────────
let containerEl = null;
let pollsUnsub = null;
let pollVotesUnsub = null;
let countdownTimers = {};
let allPolls = [];
let allMembers = [];

// ─── Public API ───────────────────────────────────────────────────────────────
export async function renderPollsAdminSection(container) {
  containerEl = container;
  if (!isAdmin() && !isSuperAdmin()) {
    container.innerHTML = '<div class="empty-state">Access denied.</div>';
    return;
  }
  const membersSnap = await getDocs(collection(db, COLLECTIONS.MEMBERS));
  allMembers = membersSnap.docs.map((d) => ({ uid: d.id, ...d.data() }));
  renderPollsShell(container);
  subscribeToPollsRealtime(container);
}

export function teardownPollsSection() {
  if (pollsUnsub) { pollsUnsub(); pollsUnsub = null; }
  if (pollVotesUnsub) { pollVotesUnsub(); pollVotesUnsub = null; }
  clearAllCountdownTimers();
}

// ─── Shell ────────────────────────────────────────────────────────────────────
function renderPollsShell(container) {
  container.innerHTML = `
    <div class="polls-shell">
      <div class="polls-header">
        <div>
          <h3 class="polls-title">Poll Management</h3>
          <p class="polls-subtitle">Create and manage polls for your trip members.</p>
        </div>
        <button class="btn-primary" id="poll-create-btn"><i class="bi bi-plus-lg"></i> Create Poll</button>
      </div>
      <div id="polls-active-section"></div>
      <div id="polls-history-section"></div>
    </div>
  `;
  document.getElementById("poll-create-btn").addEventListener("click", () => openCreatePollModal());
}

// ─── Realtime listener ────────────────────────────────────────────────────────
function subscribeToPollsRealtime(container) {
  if (pollsUnsub) pollsUnsub();
  const q = query(collection(db, COLLECTIONS.POLLS), orderBy("createdAt", "desc"));
  pollsUnsub = onSnapshot(q, (snap) => {
    allPolls = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderPollsLists();
  });
}

function renderPollsLists() {
  clearAllCountdownTimers();
  const now = Date.now();
  const activePolls = allPolls.filter((p) => isPollActive(p, now));
  const historicPolls = allPolls.filter((p) => !isPollActive(p, now));

  const activeSec = document.getElementById("polls-active-section");
  const historySec = document.getElementById("polls-history-section");
  if (!activeSec || !historySec) return;

  activeSec.innerHTML = "";
  if (activePolls.length) {
    activeSec.innerHTML = `<div class="polls-section-title">Active Polls</div>`;
    activePolls.forEach((poll) => {
      const card = buildPollCard(poll, true);
      activeSec.appendChild(card);
    });
  }

  historySec.innerHTML = "";
  if (historicPolls.length) {
    historySec.innerHTML = `<div class="polls-section-title">Poll History</div>`;
    historicPolls.forEach((poll) => {
      const card = buildPollCard(poll, false);
      historySec.appendChild(card);
    });
  }

  if (!activePolls.length && !historicPolls.length) {
    activeSec.innerHTML = `<div class="empty-state"><i class="bi bi-bar-chart"></i><p>No polls yet. Create your first poll.</p></div>`;
  }
}

// ─── Poll Card ────────────────────────────────────────────────────────────────
function buildPollCard(poll, isActive) {
  const card = document.createElement("div");
  card.className = `poll-card ${isActive ? "poll-card-active" : "poll-card-closed"}`;
  card.dataset.pollId = poll.id;

  const myVoteEntry = (poll.pollVotes || []).find((v) => v.userId === currentUser?.uid);
  const hasVoted = Boolean(myVoteEntry);
  const totalVotes = (poll.pollVotes || []).length;
  const totalMembers = allMembers.length;
  const winner = computeWinner(poll);
  const canEdit = isAdmin() || isSuperAdmin();
  const now = Date.now();
  const started = getTimestamp(poll.startTime) <= now;
  const ended = getTimestamp(poll.endTime) <= now;

  let statusBadge = isActive
    ? `<span class="pill pill-approved">Active</span>`
    : `<span class="pill pill-individual">Closed</span>`;

  card.innerHTML = `
    <div class="poll-card-header">
      <div class="poll-card-meta">
        ${statusBadge}
        <span class="poll-type-badge">${escapeHtml(POLL_TYPE_LABELS[poll.type] || poll.type || "Single")}</span>
      </div>
      <div class="poll-card-actions">
        ${canEdit ? `<button class="btn-ghost small" data-action="edit" data-id="${poll.id}">Edit</button>` : ""}
        ${canEdit ? `<button class="btn-danger small" data-action="delete" data-id="${poll.id}">Delete</button>` : ""}
      </div>
    </div>
    <div class="poll-question">${escapeHtml(poll.question)}</div>
    ${poll.description ? `<div class="poll-description">${escapeHtml(poll.description)}</div>` : ""}
    ${isActive ? `<div class="poll-countdown" id="countdown-${poll.id}"></div>` : ""}
    ${renderResultBars(poll)}
    ${isActive && !ended ? renderVotingSection(poll, hasVoted, myVoteEntry) : ""}
    ${!isActive || ended ? renderClosedSection(poll, winner) : ""}
    ${renderVoteCount(totalVotes, totalMembers)}
    ${(isAdmin() || isSuperAdmin()) ? renderAdminVoterSection(poll) : ""}
    <div class="poll-card-footer">
      <span>Created by ${escapeHtml(poll.createdByName || "Admin")}</span>
      <span>${formatDate(getTimestamp(poll.createdAt))}</span>
    </div>
  `;

  // Countdown timer
  if (isActive && poll.endTime) {
    startCountdown(poll.id, getTimestamp(poll.endTime));
  }

  // Vote action
  const voteBtn = card.querySelector("[data-action='vote']");
  if (voteBtn) {
    voteBtn.addEventListener("click", () => handleVote(poll.id, card));
  }

  // Edit / Delete
  card.querySelector("[data-action='edit']")?.addEventListener("click", () => openEditPollModal(poll.id));
  card.querySelector("[data-action='delete']")?.addEventListener("click", () => handleDeletePoll(poll.id));

  // Open Results
  card.querySelector("[data-action='open-results']")?.addEventListener("click", () => openResultsModal(poll.id));

  return card;
}

// ─── Render helpers ───────────────────────────────────────────────────────────
function renderResultBars(poll) {
  const votes = poll.pollVotes || [];
  const totalVotes = votes.length;

  return `
    <div class="poll-results">
      ${(poll.options || []).map((opt, idx) => {
        const count = votes.filter((v) =>
          Array.isArray(v.selectedOptions)
            ? v.selectedOptions.includes(idx)
            : v.selectedOption === idx
        ).length;
        const pct = totalVotes ? Math.round((count / totalVotes) * 100) : 0;
        return `
          <div class="poll-result-row">
            <div class="poll-result-label">
              <span>${escapeHtml(opt.text)}</span>
              <span class="poll-result-pct">${pct}%</span>
            </div>
            <div class="poll-bar-track">
              <div class="poll-bar-fill" style="width:${pct}%" data-pct="${pct}"></div>
            </div>
            <div class="poll-result-count">${count} vote${count === 1 ? "" : "s"}</div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function renderVotingSection(poll, hasVoted, myVoteEntry) {
  if (hasVoted) {
    return `
      <div class="poll-voted-msg"><i class="bi bi-check-circle-fill"></i> You have already voted.</div>
    `;
  }
  const isMultiple = poll.type === POLL_TYPES.MULTIPLE;
  const isYesNo = poll.type === POLL_TYPES.YES_NO;
  const opts = isYesNo ? [{ text: "Yes" }, { text: "No" }] : (poll.options || []);

  return `
    <div class="poll-warning">
      <i class="bi bi-exclamation-triangle-fill"></i>
      You can vote only ONE time. After the timer expires you cannot vote.
    </div>
    <div class="poll-options-vote" data-type="${poll.type}">
      ${opts.map((opt, idx) => `
        <label class="poll-option-label">
          <input type="${isMultiple ? "checkbox" : "radio"}" name="poll-vote-${poll.id}" value="${idx}" class="poll-option-input" />
          <span>${escapeHtml(opt.text)}</span>
        </label>
      `).join("")}
    </div>
    <button class="btn-primary poll-vote-btn" data-action="vote" data-poll-id="${poll.id}" data-type="${poll.type}">
      <i class="bi bi-check2"></i> Submit Vote
    </button>
  `;
}

function renderClosedSection(poll, winner) {
  return `
    <div class="poll-closed-banner">
      <i class="bi bi-lock-fill"></i> Voting Closed
    </div>
    ${renderWinner(winner)}
  `;
}

function renderVoteCount(totalVotes, totalMembers) {
  const pct = totalMembers ? Math.round((totalVotes / totalMembers) * 100) : 0;
  return `
    <div class="poll-vote-count">
      <i class="bi bi-people-fill"></i>
      <strong>${totalVotes} / ${totalMembers}</strong> Members Voted &nbsp; <strong>${pct}%</strong>
    </div>
  `;
}

function renderWinner(winner) {
  if (!winner) return "";
  const isTie = winner.tie;
  return `
    <div class="poll-winner">
      <span class="poll-winner-crown">🥇</span>
      <span class="poll-winner-label">${isTie ? "Tie" : "Winner"}</span>
      ${isTie
        ? winner.options.map((o) => `<span class="poll-winner-name">${escapeHtml(o.text)}</span>`).join("<span>,</span>")
        : `<span class="poll-winner-name">${escapeHtml(winner.option.text)}</span>`}
      <span class="poll-winner-stats">
        ${isTie
          ? `${winner.votes} Votes Each`
          : `${winner.pct}% · ${winner.votes} Vote${winner.votes === 1 ? "" : "s"}`}
      </span>
    </div>
  `;
}

function renderAdminVoterSection(poll) {
  const votes = poll.pollVotes || [];
  const votedUids = votes.map((v) => v.userId);
  const notVoted = allMembers.filter((m) => !votedUids.includes(m.uid));

  return `
    <div class="poll-admin-section">
      <details class="poll-admin-details">
        <summary>View Votes (Admin) — ${votes.length} total</summary>
        <div class="poll-voter-table">
          ${votes.length ? `
            <table class="admin-table">
              <thead><tr><th>Member</th><th>Option(s)</th><th>Time</th></tr></thead>
              <tbody>
                ${votes.map((v) => {
                  const member = allMembers.find((m) => m.uid === v.userId);
                  const selectedIdxs = Array.isArray(v.selectedOptions) ? v.selectedOptions : [v.selectedOption];
                  const optionTexts = selectedIdxs.map((idx) => poll.options?.[idx]?.text || `Option ${idx + 1}`).join(", ");
                  return `<tr>
                    <td>${escapeHtml(member?.name || v.userName || "Member")}</td>
                    <td>${escapeHtml(optionTexts)}</td>
                    <td>${formatDate(v.voteTime)}</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
          ` : `<div class="empty-state small">No votes yet.</div>`}
        </div>
        ${notVoted.length ? `
          <div class="poll-not-voted">
            <strong>Members Yet To Vote (${notVoted.length})</strong>
            <div class="poll-not-voted-list">
              ${notVoted.map((m) => `<span class="pill pill-pending">${escapeHtml(m.name || "Member")}</span>`).join("")}
            </div>
          </div>
        ` : ""}
      </details>
      <button class="btn-ghost small" data-action="open-results" style="margin-top:6px;">Open Results</button>
    </div>
  `;
}

// ─── Countdown ────────────────────────────────────────────────────────────────
function startCountdown(pollId, endTs) {
  const el = document.getElementById(`countdown-${pollId}`);
  if (!el) return;

  function tick() {
    const remaining = endTs - Date.now();
    if (remaining <= 0) {
      el.innerHTML = `<span class="poll-countdown-red">🔒 Voting Closed</span>`;
      clearInterval(countdownTimers[pollId]);
      delete countdownTimers[pollId];
      // Re-render polls list to reflect closed state
      renderPollsLists();
      return;
    }
    const days = Math.floor(remaining / 86400000);
    const hours = Math.floor((remaining % 86400000) / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);

    let cls = "poll-countdown-green";
    if (remaining < 600000) cls = "poll-countdown-red";
    else if (remaining < 3600000) cls = "poll-countdown-orange";

    el.innerHTML = `
      <div class="poll-countdown-inner ${cls}">
        <i class="bi bi-clock"></i> Voting Ends In &nbsp;
        <span class="poll-cd-seg">${pad(days)}d</span>
        <span class="poll-cd-seg">${pad(hours)}h</span>
        <span class="poll-cd-seg">${pad(mins)}m</span>
        <span class="poll-cd-seg">${pad(secs)}s</span>
      </div>
    `;
  }

  tick();
  countdownTimers[pollId] = setInterval(tick, 1000);
}

function clearAllCountdownTimers() {
  Object.values(countdownTimers).forEach(clearInterval);
  countdownTimers = {};
}

function pad(n) { return String(n).padStart(2, "0"); }

// ─── Voting ───────────────────────────────────────────────────────────────────
async function handleVote(pollId, cardEl) {
  const poll = allPolls.find((p) => p.id === pollId);
  if (!poll) return;

  const now = Date.now();
  if (!isPollActive(poll, now)) {
    alert("This poll is no longer active.");
    return;
  }

  const alreadyVoted = (poll.pollVotes || []).some((v) => v.userId === currentUser?.uid);
  if (alreadyVoted) {
    alert("You have already voted on this poll.");
    return;
  }

  const isMultiple = poll.type === POLL_TYPES.MULTIPLE;
  let selectedIdxs = [];

  if (isMultiple) {
    const checked = cardEl.querySelectorAll(`input[name="poll-vote-${pollId}"]:checked`);
    selectedIdxs = Array.from(checked).map((i) => Number(i.value));
    if (!selectedIdxs.length) {
      alert("Please select at least one option.");
      return;
    }
  } else {
    const checked = cardEl.querySelector(`input[name="poll-vote-${pollId}"]:checked`);
    if (!checked) {
      alert("Please select an option.");
      return;
    }
    selectedIdxs = [Number(checked.value)];
  }

  const voteEntry = {
    userId: currentUser.uid,
    userName: currentProfile?.name || "Member",
    selectedOption: isMultiple ? null : selectedIdxs[0],
    selectedOptions: selectedIdxs,
    voteTime: Date.now()
  };

  const updatedVotes = [...(poll.pollVotes || []), voteEntry];
  const winner = computeWinnerFromVotes(poll.options || [], updatedVotes);

  const voteBtn = cardEl.querySelector("[data-action='vote']");
  if (voteBtn) { voteBtn.disabled = true; voteBtn.textContent = "Saving…"; }

  try {
    await updateDoc(doc(db, COLLECTIONS.POLLS, pollId), {
      pollVotes: updatedVotes,
      totalVotes: updatedVotes.length,
      winner: winner || null,
      updatedAt: Date.now()
    });
  } catch (err) {
    console.error("Vote error:", err);
    alert("Couldn't save your vote. Please try again.");
    if (voteBtn) { voteBtn.disabled = false; voteBtn.textContent = "Submit Vote"; }
  }
}

// ─── Create Poll Modal ────────────────────────────────────────────────────────
function openCreatePollModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = buildPollFormHTML("Create Poll", null);
  document.body.appendChild(overlay);
  initPollForm(overlay, null);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

function buildPollFormHTML(title, poll) {
  const isEdit = Boolean(poll);
  const defaultStart = isEdit && poll.startTime ? toDateTimeLocal(getTimestamp(poll.startTime)) : "";
  const defaultEnd = isEdit && poll.endTime ? toDateTimeLocal(getTimestamp(poll.endTime)) : "";
  const pollType = poll?.type || POLL_TYPES.SINGLE;
  const optionsList = isEdit && poll.options?.length ? poll.options : [{ text: "" }, { text: "" }];
  const hasVotes = isEdit && (poll.pollVotes || []).length > 0;

  return `
    <div class="modal-sheet modal-sheet-wide">
      <h3>${escapeHtml(title)}</h3>
      <div class="poll-form">
        <label class="poll-form-label">Poll Question *</label>
        <input id="pf-question" type="text" placeholder="What should we have for breakfast?" value="${escapeAttribute(poll?.question || "")}" ${isEdit && hasVotes ? "disabled" : ""} />

        <label class="poll-form-label">Description (Optional)</label>
        <input id="pf-description" type="text" placeholder="Add more context…" value="${escapeAttribute(poll?.description || "")}" />

        <label class="poll-form-label">Poll Type</label>
        <select id="pf-type" ${isEdit && hasVotes ? "disabled" : ""}>
          <option value="single" ${pollType === "single" ? "selected" : ""}>Single Choice</option>
          <option value="multiple" ${pollType === "multiple" ? "selected" : ""}>Multiple Choice</option>
          <option value="yes_no" ${pollType === "yes_no" ? "selected" : ""}>Yes / No</option>
        </select>

        <div id="pf-options-section">
          <label class="poll-form-label">Options</label>
          <div id="pf-options-list">
            ${optionsList.map((opt, idx) => buildOptionRow(opt.text, idx, isEdit && hasVotes)).join("")}
          </div>
          ${!(isEdit && hasVotes) ? `<button type="button" class="btn-ghost small" id="pf-add-option"><i class="bi bi-plus"></i> Add Option</button>` : ""}
        </div>

        <div class="poll-form-grid">
          <div>
            <label class="poll-form-label">Start Date & Time</label>
            <input id="pf-start" type="datetime-local" value="${escapeAttribute(defaultStart)}" />
          </div>
          <div>
            <label class="poll-form-label">End Date & Time</label>
            <input id="pf-end" type="datetime-local" value="${escapeAttribute(defaultEnd)}" />
          </div>
        </div>

        <p id="pf-error" class="error-text"></p>
        <div class="modal-actions">
          <button class="btn-ghost" id="pf-cancel">Cancel</button>
          <button class="btn-primary" id="pf-submit">${isEdit ? "Save Changes" : "Create Poll"}</button>
        </div>
      </div>
    </div>
  `;
}

function buildOptionRow(text, idx, disabled) {
  return `
    <div class="poll-option-row" data-opt-idx="${idx}">
      <input type="text" class="pf-option-input" placeholder="Option ${idx + 1}" value="${escapeAttribute(text)}" ${disabled ? "disabled" : ""} />
      ${!disabled ? `<button type="button" class="btn-danger small pf-remove-option" data-idx="${idx}" title="Remove"><i class="bi bi-trash"></i></button>` : ""}
    </div>
  `;
}

// ─── Poll Form Initialization ─────────────────────────────────────────────────
function initPollForm(overlay, existingPoll) {
  const isEdit = Boolean(existingPoll);
  const hasVotes = isEdit && (existingPoll.pollVotes || []).length > 0;

  overlay.querySelector("#pf-cancel").addEventListener("click", () => overlay.remove());

  const typeSelect = overlay.querySelector("#pf-type");
  const optionsSection = overlay.querySelector("#pf-options-section");

  typeSelect?.addEventListener("change", () => {
    optionsSection.style.display = typeSelect.value === "yes_no" ? "none" : "";
  });
  if (typeSelect?.value === "yes_no") optionsSection.style.display = "none";

  // Add option
  overlay.querySelector("#pf-add-option")?.addEventListener("click", () => {
    const list = overlay.querySelector("#pf-options-list");
    const currentCount = list.querySelectorAll(".poll-option-row").length;
    if (currentCount >= MAX_OPTIONS) {
      alert(`Maximum ${MAX_OPTIONS} options allowed.`);
      return;
    }
    const row = document.createElement("div");
    row.className = "poll-option-row";
    row.dataset.optIdx = currentCount;
    row.innerHTML = `
      <input type="text" class="pf-option-input" placeholder="Option ${currentCount + 1}" />
      <button type="button" class="btn-danger small pf-remove-option" data-idx="${currentCount}" title="Remove"><i class="bi bi-trash"></i></button>
    `;
    list.appendChild(row);
    wireRemoveButtons(overlay);
    row.querySelector("input").focus();
  });

  wireRemoveButtons(overlay);

  overlay.querySelector("#pf-submit").addEventListener("click", () => savePoll(overlay, existingPoll));
}

function wireRemoveButtons(overlay) {
  overlay.querySelectorAll(".pf-remove-option").forEach((btn) => {
    btn.replaceWith(btn.cloneNode(true));
  });
  overlay.querySelectorAll(".pf-remove-option").forEach((btn) => {
    btn.addEventListener("click", () => {
      const list = overlay.querySelector("#pf-options-list");
      const rows = list.querySelectorAll(".poll-option-row");
      if (rows.length <= MIN_OPTIONS) {
        alert(`Minimum ${MIN_OPTIONS} options required.`);
        return;
      }
      btn.closest(".poll-option-row").remove();
    });
  });
}

// ─── Save Poll ────────────────────────────────────────────────────────────────
async function savePoll(overlay, existingPoll) {
  const errorEl = overlay.querySelector("#pf-error");
  errorEl.textContent = "";

  const question = overlay.querySelector("#pf-question").value.trim();
  const description = overlay.querySelector("#pf-description").value.trim();
  const type = overlay.querySelector("#pf-type").value;
  const startVal = overlay.querySelector("#pf-start").value;
  const endVal = overlay.querySelector("#pf-end").value;

  if (!question) { errorEl.textContent = "Poll question is required."; return; }
  if (!endVal) { errorEl.textContent = "End Date & Time is required."; return; }

  const startTime = startVal ? new Date(startVal).getTime() : Date.now();
  const endTime = new Date(endVal).getTime();

  if (endTime <= startTime) {
    errorEl.textContent = "End time must be after start time.";
    return;
  }

  let options = [];
  if (type === POLL_TYPES.YES_NO) {
    options = [{ text: "Yes" }, { text: "No" }];
  } else {
    const inputs = overlay.querySelectorAll(".pf-option-input");
    const texts = Array.from(inputs).map((i) => i.value.trim()).filter(Boolean);
    const unique = [...new Set(texts)];
    if (unique.length < MIN_OPTIONS) { errorEl.textContent = `At least ${MIN_OPTIONS} unique options required.`; return; }
    if (unique.length > MAX_OPTIONS) { errorEl.textContent = `Maximum ${MAX_OPTIONS} options allowed.`; return; }
    if (unique.length !== texts.length) { errorEl.textContent = "Duplicate option text is not allowed."; return; }
    options = texts.map((t) => ({ text: t }));
  }

  const submitBtn = overlay.querySelector("#pf-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";

  try {
    const isEdit = Boolean(existingPoll);
    const hasVotes = isEdit && (existingPoll.pollVotes || []).length > 0;

    if (isEdit) {
      const updates = { description, endTime, updatedAt: Date.now() };
      if (!hasVotes) {
        updates.question = question;
        updates.type = type;
        updates.options = options;
        updates.startTime = startTime;
      } else {
        // Only allow adding NEW options (appending), not removing existing
        const existingOptions = existingPoll.options || [];
        const extra = options.filter((_, i) => i >= existingOptions.length);
        updates.options = [...existingOptions, ...extra];
      }
      await updateDoc(doc(db, COLLECTIONS.POLLS, existingPoll.id), updates);
    } else {
      const pollRef = await addDoc(collection(db, COLLECTIONS.POLLS), {
        question,
        description,
        type,
        options,
        startTime,
        endTime,
        status: "active",
        pollVotes: [],
        totalVotes: 0,
        winner: null,
        createdAt: Date.now(),
        createdByUid: currentUser?.uid || null,
        createdByName: currentProfile?.name || "Admin",
        updatedAt: Date.now()
      });

      await sendPollNotification("new_poll", question, pollRef.id);
      scheduleNotifications(pollRef.id, question, startTime, endTime);
    }

    overlay.remove();
  } catch (err) {
    console.error("Save poll error:", err);
    errorEl.textContent = "Failed to save poll. Please try again.";
    submitBtn.disabled = false;
    submitBtn.textContent = isEdit ? "Save Changes" : "Create Poll";
  }
}

// ─── Edit Poll Modal ──────────────────────────────────────────────────────────
async function openEditPollModal(pollId) {
  const poll = allPolls.find((p) => p.id === pollId);
  if (!poll) return;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = buildPollFormHTML("Edit Poll", poll);
  document.body.appendChild(overlay);
  initPollForm(overlay, poll);
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// ─── Delete Poll ──────────────────────────────────────────────────────────────
async function handleDeletePoll(pollId) {
  const poll = allPolls.find((p) => p.id === pollId);
  if (!poll) return;

  const confirmed = confirm(`Delete Poll?\n\n"${poll.question}"\n\nThis cannot be undone. All votes, results and notifications will be deleted.`);
  if (!confirmed) return;

  try {
    await deleteDoc(doc(db, COLLECTIONS.POLLS, pollId));
  } catch (err) {
    console.error("Delete poll error:", err);
    alert("Couldn't delete poll: " + err.message);
  }
}

// ─── Results Modal ────────────────────────────────────────────────────────────
function openResultsModal(pollId) {
  const poll = allPolls.find((p) => p.id === pollId);
  if (!poll) return;
  const winner = computeWinner(poll);
  const votes = poll.pollVotes || [];
  const totalVotes = votes.length;

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet modal-sheet-wide">
      <h3>Poll Results</h3>
      <div class="poll-question" style="margin-bottom:12px;">${escapeHtml(poll.question)}</div>
      ${renderResultBars(poll)}
      ${renderWinner(winner)}
      ${renderVoteCount(totalVotes, allMembers.length)}
      <div class="poll-voter-table" style="margin-top:12px;">
        <strong>All Votes</strong>
        <table class="admin-table" style="margin-top:8px;">
          <thead><tr><th>Member</th><th>Option(s)</th><th>Time</th></tr></thead>
          <tbody>
            ${votes.map((v) => {
              const member = allMembers.find((m) => m.uid === v.userId);
              const idxs = Array.isArray(v.selectedOptions) ? v.selectedOptions : [v.selectedOption];
              const optionTexts = idxs.map((i) => poll.options?.[i]?.text || `Option ${i + 1}`).join(", ");
              return `<tr>
                <td>${escapeHtml(member?.name || v.userName || "Member")}</td>
                <td>${escapeHtml(optionTexts)}</td>
                <td>${formatDate(v.voteTime)}</td>
              </tr>`;
            }).join("")}
          </tbody>
        </table>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="results-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#results-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => { if (e.target === overlay) overlay.remove(); });
}

// ─── Notifications ────────────────────────────────────────────────────────────
async function sendPollNotification(eventType, question, pollId) {
  const typeMap = {
    new_poll: { title: "New Poll Created", msg: `📊 New poll: "${question}" — Cast your vote!` },
    one_hour: { title: "Poll Ending Soon", msg: `⏰ 1 hour left to vote: "${question}"` },
    ten_min: { title: "Poll Ending Very Soon", msg: `🚨 10 minutes left to vote: "${question}"` },
    closed: { title: "Poll Closed", msg: `🔒 Poll closed: "${question}"` },
    winner: { title: "Poll Winner Announced", msg: `🏆 Results are in for: "${question}"` }
  };
  const entry = typeMap[eventType];
  if (!entry) return;

  try {
    const membersSnap = await getDocs(collection(db, COLLECTIONS.MEMBERS));
    const receiverIds = membersSnap.docs.map((d) => d.id).filter((id) => id !== currentUser?.uid);

    await NotificationService.send({
      type: "poll_event",
      title: entry.title,
      message: entry.msg,
      senderId: currentUser?.uid,
      senderName: currentProfile?.name || "Admin",
      receiverIds,
      priority: "normal",
      deepLink: "#polls",
      targetType: "polls",
      targetId: pollId,
      metadata: { pollId, eventType }
    });
  } catch (err) {
    console.warn("Poll notification error:", err);
  }
}

function scheduleNotifications(pollId, question, startTime, endTime) {
  const oneHourBefore = endTime - 3600000;
  const tenMinBefore = endTime - 600000;
  const now = Date.now();

  if (oneHourBefore > now) {
    setTimeout(() => sendPollNotification("one_hour", question, pollId), oneHourBefore - now);
  }
  if (tenMinBefore > now) {
    setTimeout(() => sendPollNotification("ten_min", question, pollId), tenMinBefore - now);
  }
  if (endTime > now) {
    setTimeout(async () => {
      await sendPollNotification("closed", question, pollId);
      const snap = await getDoc(doc(db, COLLECTIONS.POLLS, pollId));
      if (snap.exists()) {
        const p = { id: snap.id, ...snap.data() };
        const w = computeWinner(p);
        await updateDoc(doc(db, COLLECTIONS.POLLS, pollId), { status: "closed", winner: w || null });
        if (w) await sendPollNotification("winner", question, pollId);
      }
    }, endTime - now);
  }
}

// ─── Winner Computation ───────────────────────────────────────────────────────
function computeWinner(poll) {
  return computeWinnerFromVotes(poll.options || [], poll.pollVotes || []);
}

function computeWinnerFromVotes(options, votes) {
  if (!options.length || !votes.length) return null;

  const counts = options.map((opt, idx) =>
    votes.filter((v) =>
      Array.isArray(v.selectedOptions) ? v.selectedOptions.includes(idx) : v.selectedOption === idx
    ).length
  );

  const max = Math.max(...counts);
  if (max === 0) return null;

  const topIdxs = counts.map((c, i) => ({ c, i })).filter(({ c }) => c === max);

  if (topIdxs.length > 1) {
    return {
      tie: true,
      options: topIdxs.map(({ i }) => options[i]),
      votes: max,
      pct: votes.length ? Math.round((max / votes.length) * 100) : 0
    };
  }

  const winnerIdx = topIdxs[0].i;
  return {
    tie: false,
    option: options[winnerIdx],
    optionIndex: winnerIdx,
    votes: max,
    pct: votes.length ? Math.round((max / votes.length) * 100) : 0
  };
}

// ─── Utility ──────────────────────────────────────────────────────────────────
function isPollActive(poll, now) {
  const start = getTimestamp(poll.startTime);
  const end = getTimestamp(poll.endTime);
  return start <= now && end > now;
}

function getTimestamp(value) {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (value?.toMillis) return value.toMillis();
  if (value?.seconds) return value.seconds * 1000;
  return Number(new Date(value)) || 0;
}

function toDateTimeLocal(ts) {
  if (!ts) return "";
  const d = new Date(ts);
  const pad2 = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(typeof value === "number" ? value : (value?.toDate ? value.toDate() : value));
  return d.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
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

// ─── Dashboard Poll Widget (exported for dashboard.js) ───────────────────────
export function renderDashboardPollWidget(polls, members, currentUid, currentUserName, canManage) {
  const now = Date.now();
  const activePoll = polls.find((p) => isPollActive(p, now));

  if (!activePoll) {
    // Show latest closed poll result if any
    const latestClosed = polls.find((p) => !isPollActive(p, now) && (p.pollVotes || []).length > 0);
    if (!latestClosed) return "";
    const winner = computeWinner(latestClosed);
    return `
      <article class="card dashboard-panel" id="dashboard-poll-widget">
        <div class="dashboard-panel-header">
          <h3>🏆 Latest Poll Result</h3>
          <span class="pill pill-individual">Closed</span>
        </div>
        <div class="poll-question">${escapeHtml(latestClosed.question)}</div>
        ${renderResultBars(latestClosed)}
        ${renderWinner(winner)}
        ${renderVoteCount((latestClosed.pollVotes || []).length, members.length)}
      </article>
    `;
  }

  const myVote = (activePoll.pollVotes || []).find((v) => v.userId === currentUid);
  const hasVoted = Boolean(myVote);
  const endTs = getTimestamp(activePoll.endTime);
  const ended = endTs <= now;

  return `
    <article class="card dashboard-panel" id="dashboard-poll-widget">
      <div class="dashboard-panel-header">
        <h3>📊 Live Poll</h3>
        <span class="pill pill-approved">Active</span>
      </div>
      <div class="poll-question">${escapeHtml(activePoll.question)}</div>
      ${activePoll.description ? `<div class="poll-description">${escapeHtml(activePoll.description)}</div>` : ""}
      <div class="poll-countdown" id="dash-countdown-${activePoll.id}"></div>
      ${renderResultBars(activePoll)}
      ${!ended && !hasVoted ? renderDashboardVoteForm(activePoll) : ""}
      ${hasVoted ? `<div class="poll-voted-msg"><i class="bi bi-check-circle-fill"></i> You already voted.</div>` : ""}
      ${ended ? `<div class="poll-closed-banner"><i class="bi bi-lock-fill"></i> Voting Closed</div>` : ""}
      ${renderVoteCount((activePoll.pollVotes || []).length, members.length)}
    </article>
  `;
}

function renderDashboardVoteForm(poll) {
  const isMultiple = poll.type === POLL_TYPES.MULTIPLE;
  const isYesNo = poll.type === POLL_TYPES.YES_NO;
  const opts = isYesNo ? [{ text: "Yes" }, { text: "No" }] : (poll.options || []);
  return `
    <div class="poll-warning">
      <i class="bi bi-exclamation-triangle-fill"></i>
      You can vote only ONE time. After the timer expires you cannot vote.
    </div>
    <div class="poll-options-vote" data-type="${poll.type}">
      ${opts.map((opt, idx) => `
        <label class="poll-option-label">
          <input type="${isMultiple ? "checkbox" : "radio"}" name="dash-poll-vote-${poll.id}" value="${idx}" class="poll-option-input" />
          <span>${escapeHtml(opt.text)}</span>
        </label>
      `).join("")}
    </div>
    <button class="btn-primary poll-vote-btn" id="dash-vote-btn-${poll.id}" data-poll-id="${poll.id}" data-type="${poll.type}">
      <i class="bi bi-check2"></i> Submit Vote
    </button>
  `;
}

export function initDashboardPollWidget(polls, members) {
  const now = Date.now();
  const activePoll = polls.find((p) => isPollActive(p, now));
  if (!activePoll) return;

  const countdownEl = document.getElementById(`dash-countdown-${activePoll.id}`);
  if (countdownEl) startCountdown(`dash-${activePoll.id}`, getTimestamp(activePoll.endTime));

  const voteBtn = document.getElementById(`dash-vote-btn-${activePoll.id}`);
  if (!voteBtn) return;

  voteBtn.addEventListener("click", async () => {
    const isMultiple = activePoll.type === POLL_TYPES.MULTIPLE;
    let selectedIdxs = [];

    if (isMultiple) {
      const checked = document.querySelectorAll(`input[name="dash-poll-vote-${activePoll.id}"]:checked`);
      selectedIdxs = Array.from(checked).map((i) => Number(i.value));
      if (!selectedIdxs.length) { alert("Please select at least one option."); return; }
    } else {
      const checked = document.querySelector(`input[name="dash-poll-vote-${activePoll.id}"]:checked`);
      if (!checked) { alert("Please select an option."); return; }
      selectedIdxs = [Number(checked.value)];
    }

    const alreadyVoted = (activePoll.pollVotes || []).some((v) => v.userId === currentUser?.uid);
    if (alreadyVoted) { alert("You have already voted."); return; }
    if (!isPollActive(activePoll, Date.now())) { alert("This poll has ended."); return; }

    voteBtn.disabled = true;
    voteBtn.textContent = "Saving…";

    const voteEntry = {
      userId: currentUser.uid,
      userName: currentProfile?.name || "Member",
      selectedOption: isMultiple ? null : selectedIdxs[0],
      selectedOptions: selectedIdxs,
      voteTime: Date.now()
    };
    const updatedVotes = [...(activePoll.pollVotes || []), voteEntry];
    const winner = computeWinnerFromVotes(activePoll.options || [], updatedVotes);

    try {
      await updateDoc(doc(db, COLLECTIONS.POLLS, activePoll.id), {
        pollVotes: updatedVotes,
        totalVotes: updatedVotes.length,
        winner: winner || null,
        updatedAt: Date.now()
      });
    } catch (err) {
      console.error("Dashboard vote error:", err);
      alert("Couldn't save your vote.");
      voteBtn.disabled = false;
      voteBtn.textContent = "Submit Vote";
    }
  });
}
