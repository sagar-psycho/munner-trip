// expenses.js
// Two kinds of expense:
//   - "individual": logged and visible, no approval needed, not split.
//   - "group": the payer picks exactly which members shared the cost
//     (defaults to everyone, but can be narrowed - e.g. only 3 of 5 people
//     had food). Goes into status "pending" until the admin approves it.
//     Once approved, the amount splits equally across only the selected
//     members (payer included only if they were in the selected list),
//     and balances are computed live from all approved group expenses.

import { db } from "./firebase-config.js";
import { currentUser, currentProfile, isAdmin } from "./auth.js";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let allMembers = [];
let allExpenses = [];
let unsubExpenses = null;
let unsubMembers = null;

export function renderExpensesTab(container) {
  container.innerHTML = `
    <div class="section-title">Balances</div>
    <div class="card" id="balances-card">
      <div class="empty-state"><i class="ti ti-scale"></i>Calculating...</div>
    </div>

    <div class="section-title">Pending approval</div>
    <div class="card" id="pending-card">
      <div class="empty-state"><i class="ti ti-clock"></i>Nothing pending.</div>
    </div>

    <div class="section-title">All expenses</div>
    <div class="card" id="expenses-card">
      <div class="empty-state"><i class="ti ti-receipt"></i>No expenses logged yet.</div>
    </div>
  `;

  injectFab();
  subscribeMembers();
  subscribeExpenses();
}

export function teardownExpensesTab() {
  if (unsubExpenses) unsubExpenses();
  if (unsubMembers) unsubMembers();
  const fab = document.getElementById("expense-fab");
  if (fab) fab.remove();
}

function subscribeMembers() {
  unsubMembers = onSnapshot(collection(db, "members"), (snap) => {
    allMembers = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
    render();
  });
}

function subscribeExpenses() {
  const q = query(collection(db, "expenses"), orderBy("createdAt", "desc"));
  unsubExpenses = onSnapshot(q, (snap) => {
    allExpenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}

function render() {
  renderBalances();
  renderPending();
  renderExpenseList();
}

// --- Balances -------------------------------------------------------

function renderBalances() {
  const el = document.getElementById("balances-card");
  if (!el) return;
  if (allMembers.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-scale"></i>No members yet.</div>`;
    return;
  }

  const approvedGroup = allExpenses.filter((e) => e.type === "group" && e.status === "approved");

  const net = {};
  allMembers.forEach((m) => (net[m.uid] = 0));

  approvedGroup.forEach((exp) => {
    // Fall back to "everyone" for any older expenses saved before the
    // splitAmong field existed, so past data keeps working.
    const participants = Array.isArray(exp.splitAmong) && exp.splitAmong.length > 0
      ? exp.splitAmong
      : allMembers.map((m) => m.uid);
    const share = exp.amount / participants.length;

    participants.forEach((uid) => {
      if (uid === exp.paidByUid) {
        net[uid] = (net[uid] ?? 0) + (exp.amount - share);
      } else {
        net[uid] = (net[uid] ?? 0) - share;
      }
    });
  });

  if (approvedGroup.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-scale"></i>No approved group expenses yet.</div>`;
    return;
  }

  el.innerHTML = allMembers
    .map((m) => {
      const amt = Math.round(net[m.uid] ?? 0);
      const cls = amt > 0 ? "balance-owed" : amt < 0 ? "balance-owe" : "";
      const label = amt > 0 ? `gets back \u20b9${amt}` : amt < 0 ? `owes \u20b9${Math.abs(amt)}` : "settled up";
      return `
        <div class="row">
          <span>${escapeHtml(m.name)}${m.uid === currentUser?.uid ? " (you)" : ""}</span>
          <span class="${cls}" style="font-weight:500; font-size:14px;">${label}</span>
        </div>
      `;
    })
    .join("");
}

// --- Pending (admin approval queue) ----------------------------------

function renderPending() {
  const el = document.getElementById("pending-card");
  if (!el) return;
  const pending = allExpenses.filter((e) => e.type === "group" && e.status === "pending");

  if (pending.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-clock"></i>Nothing pending.</div>`;
    return;
  }

  el.innerHTML = pending
    .map((exp) => {
      const payer = allMembers.find((m) => m.uid === exp.paidByUid);
      const participants = Array.isArray(exp.splitAmong) && exp.splitAmong.length > 0
        ? exp.splitAmong
        : allMembers.map((m) => m.uid);
      const participantNames = participants
        .map((uid) => allMembers.find((m) => m.uid === uid)?.name || "?")
        .join(", ");
      const perHead = Math.round(exp.amount / Math.max(participants.length, 1));

      const adminButtons = isAdmin()
        ? `
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn-primary" style="padding:8px;" data-approve="${exp.id}">Approve</button>
          <button class="btn-danger" data-reject="${exp.id}">Reject</button>
        </div>`
        : `<p class="hint" style="text-align:left; margin:8px 0 0;">Waiting on admin approval.</p>`;

      return `
        <div class="expense-item">
          <div class="row">
            <div>
              <div class="expense-title">${escapeHtml(exp.description)}</div>
              <div class="expense-meta">Paid by ${escapeHtml(payer?.name || "?")} \u00b7 splits \u20b9${perHead} each among ${participants.length}</div>
              <div class="expense-meta" style="margin-top:2px;">Between: ${escapeHtml(participantNames)}</div>
            </div>
            <div class="expense-amount">\u20b9${exp.amount}</div>
          </div>
          ${adminButtons}
        </div>
      `;
    })
    .join("");

  if (isAdmin()) {
    el.querySelectorAll("[data-approve]").forEach((btn) =>
      btn.addEventListener("click", () => setStatus(btn.dataset.approve, "approved"))
    );
    el.querySelectorAll("[data-reject]").forEach((btn) =>
      btn.addEventListener("click", () => setStatus(btn.dataset.reject, "rejected"))
    );
  }
}

async function setStatus(expenseId, status) {
  await updateDoc(doc(db, "expenses", expenseId), { status });
}

// --- Full list --------------------------------------------------------

function renderExpenseList() {
  const el = document.getElementById("expenses-card");
  if (!el) return;
  if (allExpenses.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-receipt"></i>No expenses logged yet.</div>`;
    return;
  }

  el.innerHTML = allExpenses
    .map((exp) => {
      const payer = allMembers.find((m) => m.uid === exp.paidByUid);
      const typePill = exp.type === "group" ? `<span class="pill pill-group">Group</span>` : `<span class="pill pill-individual">Individual</span>`;
      const statusPill =
        exp.type === "group"
          ? `<span class="pill pill-${exp.status}">${exp.status}</span>`
          : "";
      return `
        <div class="expense-item">
          <div class="row">
            <div>
              <div class="expense-title">${escapeHtml(exp.description)}</div>
              <div class="expense-meta">${escapeHtml(payer?.name || "?")} \u00b7 ${new Date(exp.createdAt).toLocaleDateString()}</div>
              <div style="margin-top:6px; display:flex; gap:6px;">${typePill}${statusPill}</div>
            </div>
            <div class="expense-amount">\u20b9${exp.amount}</div>
          </div>
        </div>
      `;
    })
    .join("");
}

// --- Add expense modal --------------------------------------------------

function injectFab() {
  if (document.getElementById("expense-fab")) return;
  const fab = document.createElement("button");
  fab.id = "expense-fab";
  fab.className = "fab";
  fab.innerHTML = `<i class="ti ti-plus"></i>`;
  fab.addEventListener("click", openAddExpenseModal);
  document.body.appendChild(fab);
}

function openAddExpenseModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";

  const memberCheckboxes = allMembers
    .map(
      (m) => `
      <div class="checkbox-row">
        <input type="checkbox" id="split-${m.uid}" value="${m.uid}" checked />
        <label for="split-${m.uid}">${escapeHtml(m.name)}${m.uid === currentUser.uid ? " (you)" : ""}</label>
      </div>
    `
    )
    .join("");

  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>Add expense</h3>
      <input id="exp-desc" type="text" placeholder="What was it for? (e.g. Lunch at Rapsy)" />
      <input id="exp-amount" type="number" placeholder="Amount (\u20b9)" min="1" />
      <select id="exp-type">
        <option value="individual">Individual (just for me)</option>
        <option value="group">Group (split with selected members)</option>
      </select>

      <div id="split-section" style="display:none; margin-top:8px;">
        <p class="hint" style="text-align:left; margin:0 0 6px;">Who had this? (defaults to everyone - untick anyone who didn't)</p>
        <div id="split-checkboxes">${memberCheckboxes}</div>
      </div>

      <p class="hint" style="text-align:left; margin:6px 0 12px;">
        Group expenses need admin approval before they're split.
      </p>
      <p id="exp-error" class="error-text"></p>
      <div class="modal-actions">
        <button class="btn-ghost" id="exp-cancel">Cancel</button>
        <button class="btn-primary" id="exp-submit">Add</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  const typeSelect = overlay.querySelector("#exp-type");
  const splitSection = overlay.querySelector("#split-section");
  typeSelect.addEventListener("change", () => {
    splitSection.style.display = typeSelect.value === "group" ? "block" : "none";
  });

  overlay.querySelector("#exp-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector("#exp-submit").addEventListener("click", async () => {
    const description = overlay.querySelector("#exp-desc").value.trim();
    const amount = Number(overlay.querySelector("#exp-amount").value);
    const type = overlay.querySelector("#exp-type").value;
    const errorEl = overlay.querySelector("#exp-error");

    if (!description || !amount || amount <= 0) {
      errorEl.textContent = "Enter a description and a valid amount.";
      return;
    }

    let splitAmong = [];
    if (type === "group") {
      splitAmong = Array.from(overlay.querySelectorAll("#split-checkboxes input:checked")).map((cb) => cb.value);
      if (splitAmong.length === 0) {
        errorEl.textContent = "Select at least one person this was split between.";
        return;
      }
    }

    const payload = {
      description,
      amount,
      type,
      status: type === "group" ? "pending" : "approved",
      paidByUid: currentUser.uid,
      paidByName: currentProfile.name,
      createdAt: Date.now()
    };
    if (type === "group") payload.splitAmong = splitAmong;

    await addDoc(collection(db, "expenses"), payload);
    overlay.remove();
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}