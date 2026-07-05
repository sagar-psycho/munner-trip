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
import { currentUser, currentProfile, isAdmin, isSuperAdmin } from "./auth.js";
import { NotificationService, NOTIFICATION_TYPES } from "./notification-service.js";
import { renderAvatar } from "./avatar.js";
import {
  collection,
  addDoc,
  updateDoc,
  deleteDoc,
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
      <div class="empty-state"><i class="bi bi-wallet2"></i>Calculating...</div>
    </div>

    <div class="section-title">Pending approval</div>
    <div class="card" id="pending-card">
      <div class="empty-state"><i class="bi bi-clock"></i>Nothing pending.</div>
    </div>

    <div class="section-title">All expenses</div>
    <div class="card" id="expenses-card">
      <div class="empty-state"><i class="bi bi-receipt"></i>No expenses logged yet.</div>
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

function getExpenseParticipants(expense) {
  if (Array.isArray(expense.participants) && expense.participants.length > 0) {
    return expense.participants.map((participant) => ({
      memberId: participant.memberId || participant.uid || participant.userId,
      shareAmount: Number(participant.shareAmount || 0),
      percentage: Number(participant.percentage || 0),
      ratio: Number(participant.ratio || 0)
    })).filter((participant) => participant.memberId);
  }

  const fallbackMembers = Array.isArray(expense.splitAmong) && expense.splitAmong.length > 0
    ? expense.splitAmong
    : allMembers.map((member) => member.uid);

  const fallbackShare = Number(expense.amount || 0) / Math.max(fallbackMembers.length, 1);
  return fallbackMembers.map((memberId) => ({ memberId, shareAmount: fallbackShare, percentage: 0, ratio: 0 }));
}

function getParticipantShare(expense, memberId) {
  const participants = getExpenseParticipants(expense);
  const participant = participants.find((entry) => entry.memberId === memberId);
  return Number(participant?.shareAmount || 0);
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

// --- Balances -------------------------------------------------------

function renderBalances() {
  const el = document.getElementById("balances-card");
  if (!el) return;
  if (allMembers.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="bi bi-wallet2"></i>No members yet.</div>`;
    return;
  }

  const approvedExpenses = allExpenses.filter((expense) => expense.status === "approved");

  const net = {};
  allMembers.forEach((m) => (net[m.uid] = 0));

  approvedExpenses.forEach((expense) => {
    const participants = getExpenseParticipants(expense);
    const payerUid = expense.paidByUid || currentUser?.uid;
    const totalAmount = Number(expense.amount || 0);

    participants.forEach((participant) => {
      const share = roundCurrency(Number(participant.shareAmount || 0));
      if (participant.memberId === payerUid) {
        net[participant.memberId] = (net[participant.memberId] ?? 0) + (totalAmount - share);
      } else {
        net[participant.memberId] = (net[participant.memberId] ?? 0) - share;
      }
    });
  });

  if (approvedExpenses.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="bi bi-wallet2"></i>No approved group expenses yet.</div>`;
    return;
  }

  el.innerHTML = allMembers
    .map((m) => {
      const amt = Math.round(net[m.uid] ?? 0);
      const cls = amt > 0 ? "balance-owed" : amt < 0 ? "balance-owe" : "";
      const label = amt > 0 ? `gets back \u20b9${amt}` : amt < 0 ? `owes \u20b9${Math.abs(amt)}` : "settled up";
      return `
        <div class="row">
          <span style="display:flex; align-items:center; gap:8px;">
            ${renderAvatar(m.name, { size: "small", className: "avatar-inline" })}
            <span>${escapeHtml(m.name)}${m.uid === currentUser?.uid ? " (you)" : ""}</span>
          </span>
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
    el.innerHTML = `<div class="empty-state"><i class="bi bi-clock"></i>Nothing pending.</div>`;
    return;
  }

  el.innerHTML = pending
    .map((exp) => {
      const payer = allMembers.find((m) => m.uid === exp.paidByUid);
      const participants = getExpenseParticipants(exp);
      const participantNames = participants
        .map((participant) => allMembers.find((m) => m.uid === participant.memberId)?.name || "?")
        .join(", ");
      const perHead = participants.length > 0
        ? roundCurrency(participants.reduce((sum, participant) => sum + Number(participant.shareAmount || 0), 0) / participants.length)
        : Number(exp.amount || 0);

      const deleteBtn = isSuperAdmin()
        ? `<button class="btn-danger" data-delete="${exp.id}"><i class="bi bi-trash"></i></button>`
        : "";
      const adminButtons = isAdmin()
        ? `
        <div style="display:flex; gap:8px; margin-top:10px;">
          <button class="btn-primary" style="padding:8px;" data-approve="${exp.id}">Approve</button>
          <button class="btn-danger" data-reject="${exp.id}">Reject</button>
          ${deleteBtn}
        </div>`
        : isSuperAdmin()
        ? `<div style="display:flex; gap:8px; margin-top:10px;">${deleteBtn}</div>`
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
  if (isSuperAdmin()) {
    el.querySelectorAll("[data-delete]").forEach((btn) =>
      btn.addEventListener("click", () => deleteExpense(btn.dataset.delete))
    );
  }
}

async function setStatus(expenseId, status) {
  const expense = allExpenses.find((entry) => entry.id === expenseId);
  await updateDoc(doc(db, "expenses", expenseId), { status });

  if (status === "approved") {
    await NotificationService.send({
      type: NOTIFICATION_TYPES.EXPENSE_APPROVED,
      title: "Expense approved",
      message: `Your expense has been approved.`,
      senderId: currentUser?.uid,
      senderName: currentProfile?.name || "Admin",
      receiverIds: [expense?.paidByUid].filter(Boolean),
      expenseId,
      priority: "high"
    });
  } else if (status === "rejected") {
    await NotificationService.send({
      type: NOTIFICATION_TYPES.EXPENSE_REJECTED,
      title: "Expense rejected",
      message: `Your expense was rejected.`,
      senderId: currentUser?.uid,
      senderName: currentProfile?.name || "Admin",
      receiverIds: [expense?.paidByUid].filter(Boolean),
      expenseId,
      priority: "high"
    });
  }
}

async function deleteExpense(expenseId) {
  const confirmed = confirm("Delete this expense? This can't be undone.");
  if (!confirmed) return;
  await deleteDoc(doc(db, "expenses", expenseId));
}

// --- Full list --------------------------------------------------------

function renderExpenseList() {
  const el = document.getElementById("expenses-card");
  if (!el) return;
  if (allExpenses.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="bi bi-receipt"></i>No expenses logged yet.</div>`;
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
      const deleteBtn = isSuperAdmin()
        ? `<button class="btn-danger" data-list-delete="${exp.id}" style="margin-top:8px;"><i class="bi bi-trash"></i></button>`
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
          ${deleteBtn}
        </div>
      `;
    })
    .join("");

  if (isSuperAdmin()) {
    el.querySelectorAll("[data-list-delete]").forEach((btn) =>
      btn.addEventListener("click", () => deleteExpense(btn.dataset.listDelete))
    );
  }
}

// --- Add expense modal --------------------------------------------------

function injectFab() {
  if (document.getElementById("expense-fab")) return;
  const fab = document.createElement("button");
  fab.id = "expense-fab";
  fab.className = "fab";
  fab.innerHTML = `<i class="bi bi-plus-lg"></i>`;
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
        <div style="display:flex; align-items:center; gap:8px; flex:1;">
          <input type="checkbox" id="split-${m.uid}" value="${m.uid}" checked />
          <label for="split-${m.uid}">${escapeHtml(m.name)}${m.uid === currentUser.uid ? " (you)" : ""}</label>
        </div>
        <div class="split-input-slot" data-member="${m.uid}"></div>
      </div>
    `
    )
    .join("");

  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>Add expense</h3>
      <input id="exp-desc" type="text" placeholder="What was it for? (e.g. Lunch at Rapsy)" />
      <input id="exp-amount" type="number" placeholder="Amount (\u20b9)" min="1" />
      <input id="exp-category" type="text" placeholder="Category" value="General" />
      <select id="exp-type">
        <option value="individual">Individual (just for me)</option>
        <option value="group">Group (split with selected members)</option>
      </select>
      <select id="exp-split-type">
        <option value="equal">Equal</option>
        <option value="exact">Exact Amount</option>
        <option value="percentage">Percentage</option>
        <option value="shares">Shares</option>
      </select>

      <div id="split-section" style="display:none; margin-top:8px;">
        <p class="hint" style="text-align:left; margin:0 0 6px;">Who had this? (defaults to everyone - untick anyone who didn't)</p>
        <div id="split-checkboxes">${memberCheckboxes}</div>
        <div id="split-summary" class="hint" style="text-align:left; margin-top:8px;"></div>
      </div>

      <textarea id="exp-notes" rows="3" placeholder="Notes"></textarea>
      <input id="exp-receipt" type="text" placeholder="Receipt / reference (optional)" />

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
  const splitTypeSelect = overlay.querySelector("#exp-split-type");
  const splitSection = overlay.querySelector("#split-section");
  const amountInput = overlay.querySelector("#exp-amount");
  const splitSummary = overlay.querySelector("#split-summary");

  function renderSplitInputs() {
    const amount = Number(amountInput.value || 0);
    const selectedIds = Array.from(overlay.querySelectorAll("#split-checkboxes input:checked")).map((cb) => cb.value);
    const checkedMembers = allMembers.filter((member) => selectedIds.includes(member.uid));
    const slotEls = Array.from(overlay.querySelectorAll(".split-input-slot"));

    slotEls.forEach((slot) => {
      const memberUid = slot.dataset.member;
      const isChecked = selectedIds.includes(memberUid);
      if (!isChecked) {
        slot.innerHTML = "";
        return;
      }

      if (splitTypeSelect.value === "equal") {
        slot.innerHTML = "";
        return;
      }

      if (splitTypeSelect.value === "exact") {
        const defaultValue = checkedMembers.length > 0 ? roundCurrency(amount / checkedMembers.length) : "";
        slot.innerHTML = `<input type="number" min="0" step="0.01" data-exact="${memberUid}" value="${defaultValue}" style="width:90px;" />`;
        return;
      }

      if (splitTypeSelect.value === "percentage") {
        const defaultValue = checkedMembers.length > 0 ? roundCurrency(100 / checkedMembers.length) : "";
        slot.innerHTML = `<input type="number" min="0" max="100" step="0.01" data-percent="${memberUid}" value="${defaultValue}" style="width:70px;" />`;
        return;
      }

      slot.innerHTML = `<input type="number" min="0" step="0.01" data-shares="${memberUid}" value="1" style="width:70px;" />`;
    });

    if (splitTypeSelect.value === "percentage") {
      splitSummary.textContent = "Percentages must total 100% across the selected members.";
    } else if (splitTypeSelect.value === "exact") {
      splitSummary.textContent = "Exact amounts must total the full expense amount.";
    } else if (splitTypeSelect.value === "shares") {
      splitSummary.textContent = "Shares should be positive numbers and will be converted proportionally.";
    } else {
      splitSummary.textContent = "Equal split will divide the amount evenly across the selected members.";
    }
  }

  typeSelect.addEventListener("change", () => {
    splitSection.style.display = typeSelect.value === "group" ? "block" : "none";
    if (typeSelect.value !== "group") {
      splitTypeSelect.value = "equal";
    }
    renderSplitInputs();
  });
  splitTypeSelect.addEventListener("change", renderSplitInputs);
  amountInput.addEventListener("input", renderSplitInputs);
  overlay.querySelectorAll("#split-checkboxes input").forEach((checkbox) => {
    checkbox.addEventListener("change", renderSplitInputs);
  });

  overlay.querySelector("#exp-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector("#exp-submit").addEventListener("click", async () => {
    const description = overlay.querySelector("#exp-desc").value.trim();
    const amount = Number(overlay.querySelector("#exp-amount").value);
    const type = overlay.querySelector("#exp-type").value;
    const splitType = overlay.querySelector("#exp-split-type").value;
    const category = overlay.querySelector("#exp-category").value.trim() || "General";
    const notes = overlay.querySelector("#exp-notes").value.trim();
    const receipt = overlay.querySelector("#exp-receipt").value.trim();
    const errorEl = overlay.querySelector("#exp-error");

    if (!description || !amount || amount <= 0) {
      errorEl.textContent = "Enter a description and a valid amount.";
      return;
    }

    let participants = [];
    if (type === "group") {
      const selectedIds = Array.from(overlay.querySelectorAll("#split-checkboxes input:checked")).map((cb) => cb.value);
      if (selectedIds.length === 0) {
        errorEl.textContent = "Select at least one person this was split between.";
        return;
      }

      const normalizedParticipants = selectedIds.map((memberId) => {
        if (splitType === "exact") {
          const value = Number(overlay.querySelector(`[data-exact="${memberId}"]`)?.value || 0);
          return { memberId, shareAmount: roundCurrency(value) };
        }
        if (splitType === "percentage") {
          const value = Number(overlay.querySelector(`[data-percent="${memberId}"]`)?.value || 0);
          return { memberId, shareAmount: roundCurrency((amount * value) / 100), percentage: roundCurrency(value) };
        }
        if (splitType === "shares") {
          const shareValue = Number(overlay.querySelector(`[data-shares="${memberId}"]`)?.value || 0);
          return { memberId, shareAmount: 0, ratio: roundCurrency(shareValue) };
        }
        return { memberId, shareAmount: roundCurrency(amount / selectedIds.length) };
      });

      if (splitType === "exact") {
        const total = normalizedParticipants.reduce((sum, participant) => sum + Number(participant.shareAmount || 0), 0);
        if (Math.abs(total - amount) > 0.01) {
          errorEl.textContent = "Exact amounts must total the full expense amount.";
          return;
        }
      }

      if (splitType === "percentage") {
        const total = normalizedParticipants.reduce((sum, participant) => sum + Number(participant.percentage || 0), 0);
        if (Math.abs(total - 100) > 0.01) {
          errorEl.textContent = "Percentages must total 100%.";
          return;
        }
      }

      if (splitType === "shares") {
        const totalShares = normalizedParticipants.reduce((sum, participant) => sum + Number(participant.ratio || 0), 0);
        if (totalShares <= 0) {
          errorEl.textContent = "Shares must be greater than zero.";
          return;
        }
        participants = normalizedParticipants.map((participant) => ({
          ...participant,
          shareAmount: roundCurrency((amount * Number(participant.ratio || 0)) / totalShares)
        }));
      } else {
        participants = normalizedParticipants;
      }
    } else {
      participants = [{ memberId: currentUser.uid, shareAmount: roundCurrency(amount), percentage: 100, ratio: 1 }];
    }

    const payload = {
      description,
      amount,
      category,
      notes,
      receipt,
      type,
      splitType,
      status: type === "group" ? "pending" : "approved",
      paidByUid: currentUser.uid,
      paidByName: currentProfile.name,
      participants,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    if (type === "group") payload.splitAmong = participants.map((participant) => participant.memberId);

    const docRef = await addDoc(collection(db, "expenses"), payload);
    await NotificationService.send({
      type: NOTIFICATION_TYPES.EXPENSE_SUBMITTED,
      title: "Expense submitted",
      message: `${currentProfile?.name || "Someone"} submitted an expense for approval.`,
      senderId: currentUser?.uid,
      senderName: currentProfile?.name || "Member",
      receiverIds: allMembers.map((member) => member.uid).filter((uid) => uid !== currentUser?.uid),
      expenseId: docRef.id,
      priority: "high"
    });
    overlay.remove();
  });

  renderSplitInputs();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}