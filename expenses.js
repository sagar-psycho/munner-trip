// expenses.js
// Two kinds of expense:
//   - "individual": logged and visible, no approval needed, not split.
//   - "group": goes into status "pending" until the admin approves it.
//     Once approved, the amount is split equally across ALL trip members
//     (including the person who paid), and balances are computed live
//     from all approved group expenses.

import { db } from "./firebase-config.js";
import { currentUser, currentProfile, isAdmin } from "./auth.js";
import {
  collection,
  addDoc,
  updateDoc,
  doc,
  onSnapshot,
  query,
  orderBy,
  getDocs
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let allMembers = [];
let allExpenses = [];
let unsubExpenses = null;
let unsubMembers = null;

export function renderExpensesTab(container) {
  container.innerHTML = `
    <div class="section-title">Balances</div>
    <div class="card" id="balances-card">
      <div class="empty-state"><i class="ti ti-scale"></i>Calculating…</div>
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
  const n = allMembers.length;

  // net[uid] = how much that person is owed (positive) or owes (negative)
  const net = {};
  allMembers.forEach((m) => (net[m.uid] = 0));

  approvedGroup.forEach((exp) => {
    const share = exp.amount / n;
    allMembers.forEach((m) => {
      if (m.uid === exp.paidByUid) {
        net[m.uid] += exp.amount - share;
      } else {
        net[m.uid] -= share;
      }
    });
  });

  if (approvedGroup.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-scale"></i>No approved group expenses yet.</div>`;
    return;
  }

  el.innerHTML = allMembers
    .map((m) => {
      const amt = Math.round(net[m.uid]);
      const cls = amt > 0 ? "balance-owed" : amt < 0 ? "balance-owe" : "";
      const label = amt > 0 ? `gets back ₹${amt}` : amt < 0 ? `owes ₹${Math.abs(amt)}` : "settled up";
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
              <div class="expense-meta">Paid by ${escapeHtml(payer?.name || "?")} · would split ₹${Math.round(exp.amount / Math.max(allMembers.length,1))} each</div>
            </div>
            <div class="expense-amount">₹${exp.amount}</div>
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
              <div class="expense-meta">${escapeHtml(payer?.name || "?")} · ${new Date(exp.createdAt).toLocaleDateString()}</div>
              <div style="margin-top:6px; display:flex; gap:6px;">${typePill}${statusPill}</div>
            </div>
            <div class="expense-amount">₹${exp.amount}</div>
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
  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>Add expense</h3>
      <input id="exp-desc" type="text" placeholder="What was it for? (e.g. Lunch at Rapsy)" />
      <input id="exp-amount" type="number" placeholder="Amount (₹)" min="1" />
      <select id="exp-type">
        <option value="individual">Individual (just for me)</option>
        <option value="group">Group (split with everyone)</option>
      </select>
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

    await addDoc(collection(db, "expenses"), {
      description,
      amount,
      type,
      status: type === "group" ? "pending" : "approved",
      paidByUid: currentUser.uid,
      paidByName: currentProfile.name,
      createdAt: Date.now()
    });

    overlay.remove();
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
