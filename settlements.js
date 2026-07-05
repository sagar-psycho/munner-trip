// settlements.js
// Settlement center for Munner Trip.
// Uses per-user relationship views so each member only sees balances and
// payment transactions that involve them, with receiver approval for payments.

import { db, COLLECTIONS } from "./firebase-config.js";
import { currentUser, currentProfile } from "./auth.js";
import { NotificationService, NOTIFICATION_TYPES } from "./notification-service.js";
import { renderAvatar } from "./avatar.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SETTLEMENT_STATUSES = {
  PENDING: "Pending",
  REMINDER_SENT: "Reminder Sent",
  PAYMENT_RECORDED: "Payment Recorded",
  WAITING_RECEIVER_APPROVAL: "Waiting Receiver Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  COMPLETED: "Completed"
};

let allMembers = [];
let allExpenses = [];
let allPayments = [];
let unsubscribeMembers = null;
let unsubscribeExpenses = null;
let unsubscribePayments = null;
let summaryEl = null;
let contentEl = null;

export function renderSettlementTab(container) {
  container.innerHTML = `
    <div class="card settlement-shell">
      <div class="row settlement-toolbar">
        <h3>Settlement Center</h3>
        <div class="settlement-toolbar-actions">
          <span class="pill pill-approved">Personal View</span>
        </div>
      </div>
      <div id="settlement-summary" class="settlement-summary"></div>
      <div id="settlement-relationships" class="settlement-relationships"></div>
    </div>
  `;

  summaryEl = document.getElementById("settlement-summary");
  contentEl = document.getElementById("settlement-relationships");

  subscribeMembers();
  subscribeExpenses();
  subscribePayments();
}

export function teardownSettlementTab() {
  if (unsubscribeMembers) unsubscribeMembers();
  if (unsubscribeExpenses) unsubscribeExpenses();
  if (unsubscribePayments) unsubscribePayments();
}

function subscribeMembers() {
  const q = query(collection(db, COLLECTIONS.MEMBERS), orderBy("addedAt", "asc"));
  unsubscribeMembers = onSnapshot(q, (snap) => {
    allMembers = snap.docs.map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }));
    render();
  });
}

function subscribeExpenses() {
  const q = query(collection(db, "expenses"), orderBy("createdAt", "desc"));
  unsubscribeExpenses = onSnapshot(q, (snap) => {
    allExpenses = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    render();
  });
}

function subscribePayments() {
  const q = query(collection(db, COLLECTIONS.PAYMENTS), orderBy("createdAt", "desc"));
  unsubscribePayments = onSnapshot(q, (snap) => {
    allPayments = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
    render();
  });
}

function render() {
  if (!summaryEl || !contentEl) return;

  if (!currentUser?.uid) {
    summaryEl.innerHTML = '<div class="empty-state">Sign in to view your settlement relationships.</div>';
    contentEl.innerHTML = "";
    return;
  }

  const { creditItems, debitItems, paymentRequests, paymentHistory } = buildRelationshipItems();
  const totalOwedToMe = creditItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalIOwe = debitItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);

  summaryEl.innerHTML = `
    <div class="settlement-summary-grid">
      <div class="settlement-metric">
        <span>People Who Owe Me</span>
        <strong>${creditItems.length}</strong>
      </div>
      <div class="settlement-metric">
        <span>People I Need To Pay</span>
        <strong>${debitItems.length}</strong>
      </div>
      <div class="settlement-metric">
        <span>Amount to Receive</span>
        <strong>₹${formatCurrency(totalOwedToMe)}</strong>
      </div>
      <div class="settlement-metric">
        <span>Amount to Pay</span>
        <strong>₹${formatCurrency(totalIOwe)}</strong>
      </div>
    </div>
  `;

  contentEl.innerHTML = `
    <div class="settlement-section">
      <div class="settlement-section-header">
        <h4>People Who Owe Me</h4>
        <span class="pill pill-approved">${creditItems.length} active</span>
      </div>
      <div class="settlement-list">
        ${creditItems.length ? creditItems.map((item) => `
          <div class="settlement-item">
            <div class="settlement-item-top">
              <div style="display:flex; align-items:center; gap:8px;">
                ${renderAvatar(item.counterpartName, { size: "small", className: "avatar-inline" })}
                <div>
                  <div class="settlement-member-name">${escapeHtml(item.counterpartName)}</div>
                  <div class="settlement-member-meta">${escapeHtml(item.status)}</div>
                </div>
              </div>
              <div class="settlement-amount">₹${formatCurrency(item.amount)}</div>
            </div>
            <div class="settlement-actions">
              <button class="btn-ghost small" data-whatsapp="${item.counterpartUid}" data-amount="${item.amount}">WhatsApp</button>
              <button class="btn-ghost small" data-notify="${item.counterpartUid}" data-amount="${item.amount}">Notify</button>
              <button class="btn-ghost small" data-history="${item.key}">History</button>
            </div>
          </div>
        `).join("") : '<div class="empty-state">No one currently owes you.</div>'}
      </div>
    </div>

    <div class="settlement-section">
      <div class="settlement-section-header">
        <h4>People I Need To Pay</h4>
        <span class="pill pill-pending">${debitItems.length} active</span>
      </div>
      <div class="settlement-list">
        ${debitItems.length ? debitItems.map((item) => `
          <div class="settlement-item">
            <div class="settlement-item-top">
              <div style="display:flex; align-items:center; gap:8px;">
                ${renderAvatar(item.counterpartName, { size: "small", className: "avatar-inline" })}
                <div>
                  <div class="settlement-member-name">${escapeHtml(item.counterpartName)}</div>
                  <div class="settlement-member-meta">${escapeHtml(item.status)}</div>
                </div>
              </div>
              <div class="settlement-amount">₹${formatCurrency(item.amount)}</div>
            </div>
            <div class="settlement-actions">
              <button class="btn-primary small" data-pay="${item.counterpartUid}">Pay</button>
              <button class="btn-ghost small" data-history="${item.key}">History</button>
            </div>
          </div>
        `).join("") : '<div class="empty-state">You do not currently owe anyone.</div>'}
      </div>
    </div>

    <div class="settlement-section">
      <div class="settlement-section-header">
        <h4>Payment Requests</h4>
        <span class="pill pill-pending">${paymentRequests.length} pending</span>
      </div>
      <div class="settlement-list">
        ${paymentRequests.length ? paymentRequests.map((item) => `
          <div class="settlement-item">
            <div class="settlement-item-top">
              <div>
                <div class="settlement-member-name">${escapeHtml(item.debtorName)}</div>
                <div class="settlement-member-meta">${escapeHtml(item.status)} · ${escapeHtml(item.note || "No note")}</div>
              </div>
              <div class="settlement-amount">₹${formatCurrency(item.amount)}</div>
            </div>
            <div class="settlement-actions">
              <button class="btn-primary small" data-approve="${item.id}">Approve</button>
              <button class="btn-ghost small" data-reject="${item.id}">Reject</button>
            </div>
          </div>
        `).join("") : '<div class="empty-state">No payment requests are waiting for your action.</div>'}
      </div>
    </div>

    <div class="settlement-section">
      <div class="settlement-section-header">
        <h4>Payment History</h4>
        <span class="pill pill-approved">${paymentHistory.length} entries</span>
      </div>
      <div class="settlement-list">
        ${paymentHistory.length ? paymentHistory.map((item) => `
          <div class="settlement-item">
            <div class="settlement-item-top">
              <div>
                <div class="settlement-member-name">${escapeHtml(item.counterpartName)}</div>
                <div class="settlement-member-meta">${escapeHtml(item.status)} · ${escapeHtml(item.reference || "No reference")}</div>
              </div>
              <div class="settlement-amount">₹${formatCurrency(item.amount)}</div>
            </div>
            <div class="settlement-actions">
              <button class="btn-ghost small" data-delete-payment="${item.id}">Delete</button>
            </div>
          </div>
        `).join("") : '<div class="empty-state">No payment history yet.</div>'}
      </div>
    </div>
  `;

  contentEl.querySelectorAll("[data-whatsapp]").forEach((button) => {
    button.addEventListener("click", () => openWhatsApp(button.dataset.whatsapp, button.dataset.amount));
  });

  contentEl.querySelectorAll("[data-notify]").forEach((button) => {
    button.addEventListener("click", () => notifyMember(button.dataset.notify, button.dataset.amount));
  });

  contentEl.querySelectorAll("[data-pay]").forEach((button) => {
    button.addEventListener("click", () => openPaymentModal(button.dataset.pay));
  });

  contentEl.querySelectorAll("[data-history]").forEach((button) => {
    button.addEventListener("click", () => showRelationshipHistory(button.dataset.history));
  });

  contentEl.querySelectorAll("[data-approve]").forEach((button) => {
    button.addEventListener("click", () => approvePayment(button.dataset.approve));
  });

  contentEl.querySelectorAll("[data-reject]").forEach((button) => {
    button.addEventListener("click", () => rejectPayment(button.dataset.reject));
  });

  contentEl.querySelectorAll("[data-delete-payment]").forEach((button) => {
    button.addEventListener("click", () => deletePaymentEntry(button.dataset.deletePayment));
  });
}

function getExpenseParticipants(expense) {
  if (Array.isArray(expense.participants) && expense.participants.length > 0) {
    return expense.participants.map((participant) => ({
      memberId: participant.memberId || participant.uid || participant.userId,
      shareAmount: Number(participant.shareAmount || 0)
    })).filter((participant) => participant.memberId);
  }

  const fallbackMembers = Array.isArray(expense.splitAmong) && expense.splitAmong.length > 0
    ? expense.splitAmong
    : allMembers.map((member) => member.uid);
  const fallbackShare = Number(expense.amount || 0) / Math.max(fallbackMembers.length, 1);
  return fallbackMembers.map((memberId) => ({ memberId, shareAmount: fallbackShare }));
}

function buildRelationshipItems() {
  const approvedExpenses = allExpenses.filter((expense) => expense.status === "approved");
  const relationshipMap = new Map();
  const currentUserUid = currentUser?.uid;

  function addRelationship(debtorUid, creditorUid, amount) {
    const key = `${debtorUid}:${creditorUid}`;
    const existing = relationshipMap.get(key);
    const value = Number(amount || 0);
    if (existing) {
      existing.amount = Number(existing.amount || 0) + value;
    } else {
      relationshipMap.set(key, {
        key,
        debtorUid,
        creditorUid,
        amount: value
      });
    }
  }

  approvedExpenses.forEach((expense) => {
    if (expense.type !== "group") return;

    const participants = getExpenseParticipants(expense);
    if (!participants.some((participant) => participant.memberId === currentUserUid)) return;

    if (expense.paidByUid === currentUserUid) {
      participants.forEach((participant) => {
        if (participant.memberId !== currentUserUid) {
          addRelationship(participant.memberId, currentUserUid, Number(participant.shareAmount || 0));
        }
      });
      return;
    }

    if (expense.paidByUid && expense.paidByUid !== currentUserUid) {
      const currentUserShare = participants.find((participant) => participant.memberId === currentUserUid);
      if (currentUserShare) {
        addRelationship(currentUserUid, expense.paidByUid, Number(currentUserShare.shareAmount || 0));
      }
    }
  });

  const creditItems = [];
  const debitItems = [];

  relationshipMap.forEach((relationship) => {
    const payments = allPayments.filter((payment) => {
      return payment.debtorUid === relationship.debtorUid && payment.creditorUid === relationship.creditorUid;
    });

    const settledAmount = payments
      .filter((payment) => [SETTLEMENT_STATUSES.APPROVED, SETTLEMENT_STATUSES.COMPLETED].includes(payment.status))
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);

    const outstandingAmount = Math.max(0, Number(relationship.amount || 0) - settledAmount);
    if (outstandingAmount <= 0) return;

    const latestPayment = [...payments].sort((a, b) => getTimestampValue(b.createdAt) - getTimestampValue(a.createdAt))[0] || null;
    const status = latestPayment?.status || SETTLEMENT_STATUSES.PENDING;
    const counterpartUid = relationship.creditorUid === currentUserUid ? relationship.debtorUid : relationship.creditorUid;
    const counterpart = allMembers.find((member) => member.uid === counterpartUid);
    const item = {
      key: relationship.key,
      debtorUid: relationship.debtorUid,
      creditorUid: relationship.creditorUid,
      counterpartUid,
      counterpartName: counterpart?.name || "Member",
      amount: outstandingAmount,
      status,
      paymentId: latestPayment?.id || null
    };

    if (relationship.creditorUid === currentUserUid) {
      creditItems.push(item);
    } else {
      debitItems.push(item);
    }
  });

  const paymentRequests = allPayments
    .filter((payment) => payment.creditorUid === currentUserUid && [SETTLEMENT_STATUSES.PENDING, SETTLEMENT_STATUSES.WAITING_RECEIVER_APPROVAL, SETTLEMENT_STATUSES.PAYMENT_RECORDED].includes(payment.status))
    .map((payment) => ({
      id: payment.id,
      debtorName: allMembers.find((member) => member.uid === payment.debtorUid)?.name || "Member",
      amount: Number(payment.amount || 0),
      status: payment.status || SETTLEMENT_STATUSES.PENDING,
      note: payment.note || ""
    }));

  const paymentHistory = allPayments
    .filter((payment) => payment.debtorUid === currentUserUid || payment.creditorUid === currentUserUid)
    .map((payment) => ({
      id: payment.id,
      amount: Number(payment.amount || 0),
      status: payment.status || SETTLEMENT_STATUSES.PENDING,
      reference: payment.reference || payment.paymentMethod || "",
      counterpartName: allMembers.find((member) => member.uid === (payment.creditorUid === currentUserUid ? payment.debtorUid : payment.creditorUid))?.name || "Member"
    }))
    .sort((a, b) => getTimestampValue(b.createdAt) - getTimestampValue(a.createdAt));

  return { creditItems, debitItems, paymentRequests, paymentHistory };
}

function getTimestampValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return Number(value) || 0;
}

function openWhatsApp(memberUid, amount = 0) {
  const member = allMembers.find((entry) => entry.uid === memberUid);
  const tripName = document.getElementById("header-title")?.textContent || "Munner Trip";
  const number = member?.whatsappNumber || member?.mobileNumber || "";
  if (!number) {
    alert("WhatsApp Number Not Available");
    return;
  }

  const message = [
    `Hi ${member?.name || "there"},`,
    "",
    `This is a friendly reminder regarding our "${tripName}" trip.`,
    "",
    `I paid ₹${formatCurrency(amount)} for the group.`,
    "Your share is pending.",
    "Please send it whenever possible.",
    "Thank you 😊"
  ].join("\n");
  const whatsAppUrl = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  window.open(whatsAppUrl, "_blank", "noopener,noreferrer");
}

async function notifyMember(memberUid, amount = 0) {
  const member = allMembers.find((entry) => entry.uid === memberUid);
  const lastSent = Number(localStorage.getItem(`munner-reminder-${memberUid}`) || 0);
  const now = Date.now();
  if (now - lastSent < 30 * 60 * 1000) {
    alert("A reminder was already sent recently. Please wait a little before sending another.");
    return;
  }

  const title = "Payment Reminder";
  const message = `${member?.name || "Member"}\nYour payment of ₹${formatCurrency(amount)} is pending.`;

  await NotificationService.send({
    type: NOTIFICATION_TYPES.PAYMENT_ADDED,
    title,
    message,
    senderId: currentUser?.uid,
    senderName: currentProfile?.name || "Admin",
    receiverIds: [memberUid],
    priority: "high",
    deepLink: "#settlements",
    category: "Payments",
    targetType: "settlements",
    targetId: memberUid,
    sound: "planner"
  });

  localStorage.setItem(`munner-reminder-${memberUid}`, now.toString());

  await addActivityEntry({
    title: "Settlement reminder sent",
    message: `${currentProfile?.name || "Admin"} sent a reminder to ${member?.name || "a member"}.`,
    type: "settlement_reminder",
    targetType: "settlements",
    targetId: memberUid,
    entryType: "activity"
  });
}

function openPaymentModal(creditorUid) {
  const creditor = allMembers.find((entry) => entry.uid === creditorUid);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>Submit payment</h3>
      <p class="hint" style="text-align:left; margin-top:-4px;">${escapeHtml(creditor?.name || "Member")}</p>
      <input id="settlement-amount" type="number" min="0" step="0.01" placeholder="Amount" />
      <select id="settlement-method">
        <option value="UPI">UPI</option>
        <option value="Cash">Cash</option>
        <option value="Bank">Bank</option>
        <option value="Card">Card</option>
        <option value="Other">Other</option>
      </select>
      <input id="settlement-reference" type="text" placeholder="Reference" />
      <textarea id="settlement-note" rows="3" placeholder="Notes"></textarea>
      <div class="modal-actions">
        <button class="btn-ghost" id="settlement-cancel">Cancel</button>
        <button class="btn-primary" id="settlement-submit">Submit</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#settlement-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });

  overlay.querySelector("#settlement-submit").addEventListener("click", async () => {
    const amount = Number(overlay.querySelector("#settlement-amount").value);
    const paymentMethod = overlay.querySelector("#settlement-method").value;
    const reference = overlay.querySelector("#settlement-reference").value.trim();
    const note = overlay.querySelector("#settlement-note").value.trim();
    if (!amount || amount <= 0) {
      alert("Enter a valid payment amount.");
      return;
    }

    await createPaymentTransaction({
      debtorUid: currentUser.uid,
      creditorUid,
      amount,
      paymentMethod,
      reference,
      note
    });

    overlay.remove();
  });
}

async function createPaymentTransaction({ debtorUid, creditorUid, amount, paymentMethod, reference, note }) {
  const creditor = allMembers.find((member) => member.uid === creditorUid);
  const paymentDoc = await addDoc(collection(db, COLLECTIONS.PAYMENTS), {
    debtorUid,
    creditorUid,
    amount,
    status: SETTLEMENT_STATUSES.WAITING_RECEIVER_APPROVAL,
    paymentMethod,
    reference,
    note,
    recordedByUid: currentUser?.uid,
    recordedByName: currentProfile?.name || "You",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    history: [{
      status: SETTLEMENT_STATUSES.PAYMENT_RECORDED,
      note,
      createdAt: Date.now()
    }, {
      status: SETTLEMENT_STATUSES.WAITING_RECEIVER_APPROVAL,
      note: "Waiting for receiver approval",
      createdAt: Date.now()
    }]
  });

  await NotificationService.send({
    type: NOTIFICATION_TYPES.PAYMENT_ADDED,
    title: "New settlement request",
    message: `${currentProfile?.name || "You"} requested payment of ₹${formatCurrency(amount)} from you.`,
    senderId: currentUser?.uid,
    senderName: currentProfile?.name || "You",
    receiverIds: [creditorUid],
    priority: "high",
    deepLink: "#settlements",
    category: "Payments",
    targetType: "settlements",
    targetId: paymentDoc.id,
    sound: "planner"
  });

  await addActivityEntry({
    title: "Payment request recorded",
    message: `${currentProfile?.name || "You"} requested payment of ₹${formatCurrency(amount)} from ${creditor?.name || "the member"}.`,
    type: "payment_recorded",
    targetType: "settlements",
    targetId: paymentDoc.id,
    entryType: "activity"
  });

  render();
}

async function approvePayment(paymentId) {
  const payment = allPayments.find((entry) => entry.id === paymentId);
  if (!payment) return;

  const history = Array.isArray(payment.history) ? payment.history : [];
  await updateDoc(doc(db, COLLECTIONS.PAYMENTS, paymentId), {
    status: SETTLEMENT_STATUSES.COMPLETED,
    updatedAt: serverTimestamp(),
    history: [
      ...history,
      {
        status: SETTLEMENT_STATUSES.COMPLETED,
        note: "Approved by receiver",
        createdAt: Date.now()
      }
    ]
  });

  await NotificationService.send({
    type: NOTIFICATION_TYPES.PAYMENT_CONFIRMED,
    title: "Payment approved",
    message: `${currentProfile?.name || "You"} approved the settlement request.`,
    senderId: currentUser?.uid,
    senderName: currentProfile?.name || "You",
    receiverIds: [payment.debtorUid],
    priority: "high",
    deepLink: "#settlements",
    category: "Payments",
    targetType: "settlements",
    targetId: paymentId,
    sound: "planner"
  });

  await addActivityEntry({
    title: "Payment approved",
    message: `${currentProfile?.name || "You"} approved a settlement payment.`,
    type: "payment_approved",
    targetType: "settlements",
    targetId: paymentId,
    entryType: "activity"
  });
}

async function rejectPayment(paymentId) {
  const payment = allPayments.find((entry) => entry.id === paymentId);
  if (!payment) return;

  const history = Array.isArray(payment.history) ? payment.history : [];
  await updateDoc(doc(db, COLLECTIONS.PAYMENTS, paymentId), {
    status: SETTLEMENT_STATUSES.REJECTED,
    updatedAt: serverTimestamp(),
    history: [
      ...history,
      {
        status: SETTLEMENT_STATUSES.REJECTED,
        note: "Rejected by receiver",
        createdAt: Date.now()
      }
    ]
  });

  const notifyUid = payment.recordedByUid || payment.debtorUid || currentUser?.uid;
  await NotificationService.send({
    type: NOTIFICATION_TYPES.PAYMENT_FAILED,
    title: "Payment rejected",
    message: `${currentProfile?.name || "You"} rejected the settlement request.`,
    senderId: currentUser?.uid,
    senderName: currentProfile?.name || "You",
    receiverIds: [notifyUid],
    priority: "high",
    deepLink: "#settlements",
    category: "Payments",
    targetType: "settlements",
    targetId: paymentId,
    sound: "planner"
  });

  await addActivityEntry({
    title: "Payment rejected",
    message: `${currentProfile?.name || "You"} rejected a settlement payment request.`,
    type: "payment_rejected",
    targetType: "settlements",
    targetId: paymentId,
    entryType: "activity"
  });
}

async function deletePaymentEntry(paymentId) {
  const payment = allPayments.find((entry) => entry.id === paymentId);
  if (!payment) return;

  const confirmed = window.confirm("Delete this payment history entry?");
  if (!confirmed) return;

  await deleteDoc(doc(db, COLLECTIONS.PAYMENTS, paymentId));

  await addActivityEntry({
    title: "Payment entry deleted",
    message: `${currentProfile?.name || "You"} removed a settlement payment entry.`,
    type: "payment_deleted",
    targetType: "settlements",
    targetId: paymentId,
    entryType: "activity"
  });
}

async function showRelationshipHistory(relationshipKey) {
  const payments = allPayments.filter((payment) => payment.debtorUid && payment.creditorUid && `${payment.debtorUid}:${payment.creditorUid}` === relationshipKey);
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>Payment history</h3>
      <div class="settlement-history-list">
        ${payments.length ? payments.map((item) => `
          <div class="settlement-history-item">
            <div class="row">
              <strong>${escapeHtml(item.status || "Pending")}</strong>
              <span>₹${formatCurrency(item.amount || 0)}</span>
            </div>
            <div class="settlement-history-meta">${escapeHtml(item.note || "")}</div>
          </div>
        `).join("") : '<div class="empty-state">No payment history yet.</div>'}
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="history-close">Close</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  overlay.querySelector("#history-close").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });
}

async function addActivityEntry(payload) {
  await addDoc(collection(db, COLLECTIONS.ACTIVITY_LOGS), {
    ...payload,
    actorUid: currentUser?.uid || null,
    actorName: currentProfile?.name || "System",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  });
}

function formatCurrency(value) {
  const amount = Number(value || 0);
  return amount.toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
