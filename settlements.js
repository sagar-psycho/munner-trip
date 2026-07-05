// settlements.js
// Settlement center for Munner Trip.
// Uses a personal settlement engine based on real participant share values and
// keeps the current UI language while supporting payment requests, QR payments,
// reminders, approval workflows, history and profile payment details.

import { db, COLLECTIONS } from "./firebase-config.js";
import { currentUser, currentProfile } from "./auth.js";
import { NotificationService, NOTIFICATION_TYPES } from "./notification-service.js";
import { renderAvatar } from "./avatar.js";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { updatePassword } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const SETTLEMENT_STATUSES = {
  PENDING: "Pending",
  REMINDER_SENT: "Reminder Sent",
  PAYMENT_SUBMITTED: "Payment Submitted",
  WAITING_RECEIVER_APPROVAL: "Waiting Receiver Approval",
  APPROVED: "Approved",
  REJECTED: "Rejected",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled"
};

let allMembers = [];
let allExpenses = [];
let allPayments = [];
let allSettlementHistory = [];
let unsubscribeMembers = null;
let unsubscribeExpenses = null;
let unsubscribePayments = null;
let unsubscribeHistory = null;
let summaryEl = null;
let contentEl = null;
let timelineEl = null;

export function renderSettlementTab(container) {
  container.innerHTML = `
    <div class="card settlement-shell">
      <div class="row settlement-toolbar">
        <div>
          <h3>Settlement Center</h3>
          <p class="settlement-subtitle">Personal payments, reminders and approvals for your trip.</p>
        </div>
        <div class="settlement-toolbar-actions">
          <span class="pill pill-approved">Personal View</span>
        </div>
      </div>
      <div id="settlement-summary" class="settlement-summary"></div>
      <div id="settlement-content" class="settlement-content"></div>
    </div>
  `;

  summaryEl = document.getElementById("settlement-summary");
  contentEl = document.getElementById("settlement-content");

  subscribeMembers();
  subscribeExpenses();
  subscribePayments();
  subscribeHistory();
}

export function teardownSettlementTab() {
  if (unsubscribeMembers) unsubscribeMembers();
  if (unsubscribeExpenses) unsubscribeExpenses();
  if (unsubscribePayments) unsubscribePayments();
  if (unsubscribeHistory) unsubscribeHistory();
}

function subscribeMembers() {
  const q = query(collection(db, COLLECTIONS.MEMBERS), orderBy("addedAt", "asc"));
  unsubscribeMembers = onSnapshot(q, (snap) => {
    allMembers = snap.docs.map((docSnap) => ({ uid: docSnap.id, ...docSnap.data() }));
    render();
  });
}

function subscribeExpenses() {
  const q = query(collection(db, COLLECTIONS.EXPENSES), orderBy("createdAt", "desc"));
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

function subscribeHistory() {
  const q = query(collection(db, COLLECTIONS.SETTLEMENT_HISTORY), orderBy("createdAt", "desc"));
  unsubscribeHistory = onSnapshot(q, (snap) => {
    allSettlementHistory = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
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

  const { creditItems, debitItems, paymentRequests, paymentHistory, timeline } = buildRelationshipItems();
  const totalOwedToMe = creditItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalIOwe = debitItems.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const pendingRequests = paymentRequests.filter((item) => [SETTLEMENT_STATUSES.PENDING, SETTLEMENT_STATUSES.PAYMENT_SUBMITTED, SETTLEMENT_STATUSES.WAITING_RECEIVER_APPROVAL].includes(item.status)).length;
  const completedPayments = paymentHistory.filter((item) => [SETTLEMENT_STATUSES.APPROVED, SETTLEMENT_STATUSES.COMPLETED].includes(item.status)).length;

  summaryEl.innerHTML = `
    <div class="settlement-summary-grid">
      <div class="settlement-metric">
        <span>Amount to Receive</span>
        <strong>₹${formatCurrency(totalOwedToMe)}</strong>
      </div>
      <div class="settlement-metric">
        <span>Amount to Pay</span>
        <strong>₹${formatCurrency(totalIOwe)}</strong>
      </div>
      <div class="settlement-metric">
        <span>Pending Requests</span>
        <strong>${pendingRequests}</strong>
      </div>
      <div class="settlement-metric">
        <span>Completed Payments</span>
        <strong>${completedPayments}</strong>
      </div>
    </div>
  `;

  contentEl.innerHTML = `
    <div class="settlement-grid">
      <div class="settlement-stack">
        <div class="settlement-section">
          <div class="settlement-section-header">
            <h4>My Profile & Payment Details</h4>
            <button class="btn-ghost small" id="open-profile-editor">Edit Profile</button>
          </div>
          <div id="settlement-profile-card" class="settlement-profile-card"></div>
        </div>
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
                  <button class="btn-primary small" data-pay="${item.counterpartUid}" data-amount="${item.amount}">Pay</button>
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
                  <button class="btn-primary small" data-pay="${item.counterpartUid}" data-amount="${item.amount}">Pay</button>
                </div>
              </div>
            `).join("") : '<div class="empty-state">You do not currently owe anyone.</div>'}
          </div>
        </div>
      </div>
      <div class="settlement-stack">
        <div class="settlement-section">
          <div class="settlement-section-header">
            <h4>Payment Requests</h4>
            <span class="pill pill-pending">${pendingRequests} pending</span>
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
            <div class="settlement-history-toolbar">
              <input id="settlement-search" class="settlement-search" type="search" placeholder="Search payment" />
              <select id="settlement-status-filter">
                <option value="All">All status</option>
                <option value="Pending">Pending</option>
                <option value="Reminder Sent">Reminder Sent</option>
                <option value="Payment Submitted">Payment Submitted</option>
                <option value="Waiting Receiver Approval">Waiting Receiver Approval</option>
                <option value="Approved">Approved</option>
                <option value="Rejected">Rejected</option>
                <option value="Completed">Completed</option>
              </select>
              <button class="btn-ghost small" id="settlement-export">Export</button>
            </div>
          </div>
          <div class="settlement-list" id="settlement-history-list">
            ${paymentHistory.map((item) => `
              <div class="settlement-item">
                <div class="settlement-item-top">
                  <div>
                    <div class="settlement-member-name">${escapeHtml(item.counterpartName)}</div>
                    <div class="settlement-member-meta">${escapeHtml(item.status)} · ${escapeHtml(item.reference || "No reference")}</div>
                  </div>
                  <div class="settlement-amount">₹${formatCurrency(item.amount)}</div>
                </div>
                <div class="settlement-actions">
                  ${item.screenshotUrl ? `<a class="btn-ghost small" href="${escapeAttribute(item.screenshotUrl)}" target="_blank" rel="noreferrer">Screenshot</a>` : ""}
                  ${item.paymentId ? `<button class="btn-ghost small" data-delete-payment="${item.paymentId}">Delete</button>` : ""}
                </div>
              </div>
            `).join("")}
          </div>
        </div>
        <div class="settlement-section">
          <div class="settlement-section-header">
            <h4>Settlement Timeline</h4>
            <span class="pill pill-approved">Newest First</span>
          </div>
          <div class="settlement-timeline">
            ${timeline.length ? timeline.map((entry) => `
              <div class="settlement-timeline-item">
                <div class="settlement-timeline-dot"></div>
                <div class="settlement-timeline-body">
                  <div class="settlement-member-name">${escapeHtml(entry.title || entry.type || "Activity")}</div>
                  <div class="settlement-member-meta">${escapeHtml(entry.message || "")}</div>
                  <div class="settlement-member-meta">${escapeHtml(formatDisplayDate(entry.createdAt))}</div>
                </div>
              </div>
            `).join("") : '<div class="empty-state">No settlement activity yet.</div>'}
          </div>
        </div>
      </div>
    </div>
  `;

  renderProfileCard();
  bindSettlementEvents();
}

function bindSettlementEvents() {
  contentEl.querySelectorAll("[data-whatsapp]").forEach((button) => {
    button.addEventListener("click", () => openWhatsApp(button.dataset.whatsapp, button.dataset.amount));
  });

  contentEl.querySelectorAll("[data-notify]").forEach((button) => {
    button.addEventListener("click", () => notifyMember(button.dataset.notify, button.dataset.amount));
  });

  contentEl.querySelectorAll("[data-pay]").forEach((button) => {
    button.addEventListener("click", () => openPaymentModal(button.dataset.pay, button.dataset.amount));
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

  contentEl.querySelector("#open-profile-editor")?.addEventListener("click", () => openProfileEditor());
  const searchInput = contentEl.querySelector("#settlement-search");
  const filterSelect = contentEl.querySelector("#settlement-status-filter");
  const exportButton = contentEl.querySelector("#settlement-export");

  searchInput?.addEventListener("input", () => filterHistoryList());
  filterSelect?.addEventListener("change", () => filterHistoryList());
  exportButton?.addEventListener("click", exportPaymentHistory);
}

function filterHistoryList() {
  const queryText = (contentEl.querySelector("#settlement-search")?.value || "").toLowerCase();
  const statusValue = contentEl.querySelector("#settlement-status-filter")?.value || "All";
  const items = Array.from(contentEl.querySelectorAll("#settlement-history-list > .settlement-item"));
  items.forEach((item) => {
    const text = item.textContent.toLowerCase();
    const status = item.textContent.includes("Pending") || item.textContent.includes("Reminder") || item.textContent.includes("Payment") || item.textContent.includes("Approved") || item.textContent.includes("Rejected") || item.textContent.includes("Completed");
    const matchesText = !queryText || text.includes(queryText);
    const matchesStatus = statusValue === "All" || text.includes(statusValue);
    item.style.display = matchesText && matchesStatus ? "block" : "none";
  });
}

function renderProfileCard() {
  const card = contentEl.querySelector("#settlement-profile-card");
  if (!card) return;
  const profile = allMembers.find((member) => member.uid === currentUser?.uid) || currentProfile || {};
  const photoUrl = profile.profilePhotoUrl || profile.photoURL || "";
  card.innerHTML = `
    <div class="settlement-profile-top">
      <div class="settlement-avatar-frame">
        ${photoUrl ? `<img src="${escapeAttribute(photoUrl)}" alt="Profile" />` : renderAvatar(profile.name || currentProfile?.name || "You", { size: "large", className: "avatar-inline" })}
      </div>
      <div>
        <div class="settlement-member-name">${escapeHtml(profile.name || currentProfile?.name || "You")}</div>
        <div class="settlement-member-meta">${escapeHtml(profile.email || currentUser?.email || "")}</div>
        <div class="settlement-member-meta">WhatsApp: ${escapeHtml(profile.whatsappNumber || "Not added")}</div>
        <div class="settlement-member-meta">UPI: ${escapeHtml(profile.upiId || "Not added")}</div>
      </div>
    </div>
    <div class="settlement-profile-actions">
      <button class="btn-ghost small" id="profile-edit-button">Edit Profile</button>
      <button class="btn-ghost small" id="profile-qr-download">Download QR</button>
    </div>
  `;

  card.querySelector("#profile-edit-button")?.addEventListener("click", () => openProfileEditor());
  card.querySelector("#profile-qr-download")?.addEventListener("click", () => downloadQrCode(profile.qrCodeUrl, profile.name));
}

function openProfileEditor(memberUid = currentUser?.uid) {
  const member = allMembers.find((entry) => entry.uid === memberUid) || currentProfile || {};
  const canEdit = memberUid === currentUser?.uid || currentProfile?.role === "admin" || currentProfile?.role === "super_admin";
  if (!canEdit) {
    alert("You can only edit your own profile unless you are an admin.");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet settlement-profile-modal">
      <h3>${memberUid === currentUser?.uid ? "Edit your profile" : `Edit ${escapeHtml(member.name || "profile")}`}</h3>
      <div class="settlement-profile-grid">
        <div class="settlement-profile-field">
          <label>Profile Photo</label>
          <input id="profile-photo-file" type="file" accept="image/*" />
          <div class="settlement-avatar-frame large">
            ${member.profilePhotoUrl ? `<img src="${escapeAttribute(member.profilePhotoUrl)}" alt="Profile" />` : renderAvatar(member.name || "Member", { size: "large", className: "avatar-inline" })}
          </div>
        </div>
        <div class="settlement-profile-field">
          <label>Name</label>
          <input id="profile-name" type="text" value="${escapeAttribute(member.name || "")}" />
        </div>
        <div class="settlement-profile-field">
          <label>Email</label>
          <input id="profile-email" type="email" value="${escapeAttribute(member.email || currentUser?.email || "")}" />
        </div>
        <div class="settlement-profile-field">
          <label>Password</label>
          <input id="profile-password" type="password" placeholder="Leave blank to keep current password" />
        </div>
        <div class="settlement-profile-field">
          <label>WhatsApp Number</label>
          <input id="profile-whatsapp" type="text" value="${escapeAttribute(member.whatsappNumber || "")}" />
        </div>
        <div class="settlement-profile-field">
          <label>UPI ID</label>
          <input id="profile-upi" type="text" value="${escapeAttribute(member.upiId || "")}" />
        </div>
        <div class="settlement-profile-field">
          <label>QR Code</label>
          <input id="profile-qr-file" type="file" accept="image/*" />
          ${member.qrCodeUrl ? `<div class="settlement-qr-preview"><img src="${escapeAttribute(member.qrCodeUrl)}" alt="QR code" /></div>` : '<div class="empty-state">No QR Code Available</div>'}
        </div>
      </div>
      <div class="settlement-profile-actions">
        ${member.qrCodeUrl ? `<button class="btn-ghost small" id="profile-qr-download" type="button">Download QR</button>` : ""}
        ${member.qrCodeUrl ? `<button class="btn-ghost small" id="profile-qr-remove" type="button">Delete QR</button>` : ""}
        <button class="btn-ghost small" id="profile-cancel" type="button">Cancel</button>
        <button class="btn-primary small" id="profile-save" type="button">Save</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let profilePhotoUrl = member.profilePhotoUrl || "";
  let qrCodeUrl = member.qrCodeUrl || "";

  overlay.querySelector("#profile-photo-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    profilePhotoUrl = await readFileAsDataUrl(file);
    overlay.querySelector(".settlement-avatar-frame")?.remove();
  });

  overlay.querySelector("#profile-qr-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    qrCodeUrl = await readFileAsDataUrl(file);
    const preview = overlay.querySelector(".settlement-qr-preview") || document.createElement("div");
    preview.className = "settlement-qr-preview";
    preview.innerHTML = `<img src="${escapeAttribute(qrCodeUrl)}" alt="QR code" />`;
    overlay.querySelector(".empty-state")?.remove();
    overlay.querySelector(".settlement-profile-field")?.appendChild(preview);
  });

  overlay.querySelector("#profile-qr-download")?.addEventListener("click", () => downloadQrCode(qrCodeUrl, member.name));
  overlay.querySelector("#profile-qr-remove")?.addEventListener("click", () => {
    qrCodeUrl = "";
    const preview = overlay.querySelector(".settlement-qr-preview");
    if (preview) preview.remove();
    const field = overlay.querySelectorAll(".settlement-profile-field")[6];
    if (field) field.insertAdjacentHTML("beforeend", '<div class="empty-state">No QR Code Available</div>');
  });

  overlay.querySelector("#profile-cancel")?.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });

  overlay.querySelector("#profile-save")?.addEventListener("click", async () => {
    const name = overlay.querySelector("#profile-name")?.value?.trim() || member.name || "Member";
    const email = overlay.querySelector("#profile-email")?.value?.trim() || member.email || currentUser?.email || "";
    const password = overlay.querySelector("#profile-password")?.value || "";
    const whatsappNumber = overlay.querySelector("#profile-whatsapp")?.value?.trim() || "";
    const upiId = overlay.querySelector("#profile-upi")?.value?.trim() || "";

    try {
      if (password && memberUid === currentUser?.uid) {
        await updatePassword(currentUser, password);
      }
      await updateDoc(doc(db, COLLECTIONS.MEMBERS, memberUid), {
        name,
        email,
        whatsappNumber,
        upiId,
        profilePhotoUrl,
        qrCodeUrl,
        updatedAt: Date.now()
      });
      overlay.remove();
      render();
    } catch (error) {
      alert(error.message || "Unable to update profile right now.");
    }
  });
}

function openPaymentModal(counterpartUid, amount = 0) {
  const counterpart = allMembers.find((entry) => entry.uid === counterpartUid);
  const existingPayment = allPayments.find((payment) => {
    return payment.debtorUid === currentUser?.uid && payment.creditorUid === counterpartUid && [SETTLEMENT_STATUSES.PENDING, SETTLEMENT_STATUSES.REMINDER_SENT, SETTLEMENT_STATUSES.PAYMENT_SUBMITTED, SETTLEMENT_STATUSES.WAITING_RECEIVER_APPROVAL].includes(payment.status);
  });
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet settlement-payment-modal">
      <h3>Pay ${escapeHtml(counterpart?.name || "Member")}</h3>
      <div class="settlement-payment-profile">
        <div class="settlement-avatar-frame">
          ${counterpart?.profilePhotoUrl ? `<img src="${escapeAttribute(counterpart.profilePhotoUrl)}" alt="Profile" />` : renderAvatar(counterpart?.name || "Member", { size: "large", className: "avatar-inline" })}
        </div>
        <div>
          <div class="settlement-member-name">${escapeHtml(counterpart?.name || "Member")}</div>
          <div class="settlement-member-meta">${escapeHtml(counterpart?.email || "")}</div>
          <div class="settlement-member-meta">UPI: ${escapeHtml(counterpart?.upiId || "Not added")}</div>
        </div>
      </div>
      <div class="settlement-detail-grid">
        <div><strong>Amount</strong><span>₹${formatCurrency(amount || existingPayment?.amount || 0)}</span></div>
        <div><strong>Receiver QR</strong><span>${counterpart?.qrCodeUrl ? "Available" : "No QR Code Available"}</span></div>
      </div>
      ${counterpart?.qrCodeUrl ? `<div class="settlement-qr-preview large"><img src="${escapeAttribute(counterpart.qrCodeUrl)}" alt="Receiver QR code" /></div>` : '<div class="empty-state">No QR Code Available</div>'}
      <div class="settlement-profile-actions">
        <button class="btn-ghost small" id="qr-download" type="button">Download QR</button>
        <button class="btn-ghost small" id="upi-apps" type="button">Open UPI Apps</button>
        <button class="btn-ghost small" id="copy-upi" type="button">Copy UPI ID</button>
      </div>
      <div class="settlement-profile-actions">
        <button class="btn-ghost small" id="gpay" type="button">Google Pay</button>
        <button class="btn-ghost small" id="phonepe" type="button">PhonePe</button>
        <button class="btn-ghost small" id="paytm" type="button">Paytm</button>
      </div>
      <label>Payment Method</label>
      <select id="payment-method">
        <option value="UPI">UPI</option>
        <option value="Cash">Cash</option>
        <option value="Bank Transfer">Bank Transfer</option>
        <option value="Card">Card</option>
        <option value="Other">Other</option>
      </select>
      <label>Reference Number</label>
      <input id="payment-reference" type="text" placeholder="Reference" value="${escapeAttribute(existingPayment?.reference || "")}" />
      <label>Payment Note</label>
      <textarea id="payment-note" rows="3" placeholder="Add a note">${escapeAttribute(existingPayment?.note || "")}</textarea>
      <label>Payment Screenshot</label>
      <input id="payment-screenshot" type="file" accept="image/*" />
      ${existingPayment?.paymentScreenshotUrl ? `<div class="settlement-qr-preview large"><img src="${escapeAttribute(existingPayment.paymentScreenshotUrl)}" alt="Payment screenshot" /></div>` : ""}
      <div class="modal-actions">
        <button class="btn-ghost" id="payment-cancel" type="button">Cancel</button>
        <button class="btn-primary" id="payment-submit" type="button">Mark as Paid</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  let screenshotUrl = existingPayment?.paymentScreenshotUrl || "";

  overlay.querySelector("#payment-screenshot")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    screenshotUrl = await readFileAsDataUrl(file);
  });

  overlay.querySelector("#qr-download")?.addEventListener("click", () => downloadQrCode(counterpart?.qrCodeUrl, counterpart?.name));
  overlay.querySelector("#copy-upi")?.addEventListener("click", async () => {
    if (navigator.clipboard) {
      await navigator.clipboard.writeText(counterpart?.upiId || "");
      alert("UPI ID copied.");
    }
  });
  overlay.querySelector("#upi-apps")?.addEventListener("click", () => window.open(counterpart?.upiId ? `upi://pay?pa=${encodeURIComponent(counterpart.upiId)}&cu=INR` : "https://www.google.com/search?q=upi+payment", "_blank", "noopener,noreferrer"));
  overlay.querySelector("#gpay")?.addEventListener("click", () => window.open("https://pay.google.com/", "_blank", "noopener,noreferrer"));
  overlay.querySelector("#phonepe")?.addEventListener("click", () => window.open("https://www.phonepe.com/", "_blank", "noopener,noreferrer"));
  overlay.querySelector("#paytm")?.addEventListener("click", () => window.open("https://paytm.com/", "_blank", "noopener,noreferrer"));
  overlay.querySelector("#payment-cancel")?.addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) overlay.remove();
  });

  overlay.querySelector("#payment-submit")?.addEventListener("click", async () => {
    const paymentMethod = overlay.querySelector("#payment-method")?.value || "UPI";
    const reference = overlay.querySelector("#payment-reference")?.value?.trim() || "";
    const note = overlay.querySelector("#payment-note")?.value?.trim() || "";
    const amountValue = Number(amount || existingPayment?.amount || 0);
    if (!amountValue || amountValue <= 0) {
      alert("Enter a valid amount.");
      return;
    }

    await createOrUpdatePayment({
      debtorUid: currentUser?.uid,
      creditorUid: counterpartUid,
      amount: amountValue,
      paymentMethod,
      reference,
      note,
      paymentScreenshotUrl: screenshotUrl,
      existingPayment
    });
    overlay.remove();
  });
}

async function createOrUpdatePayment({ debtorUid, creditorUid, amount, paymentMethod, reference, note, paymentScreenshotUrl, existingPayment }) {
  const creditor = allMembers.find((member) => member.uid === creditorUid);
  const duplicate = allPayments.find((payment) => {
    return payment.debtorUid === debtorUid && payment.creditorUid === creditorUid && [SETTLEMENT_STATUSES.PENDING, SETTLEMENT_STATUSES.REMINDER_SENT, SETTLEMENT_STATUSES.PAYMENT_SUBMITTED, SETTLEMENT_STATUSES.WAITING_RECEIVER_APPROVAL].includes(payment.status);
  });

  if (duplicate && !existingPayment) {
    alert("A payment request for this member is already in progress.");
    return;
  }

  const paymentPayload = {
    debtorUid,
    creditorUid,
    amount,
    status: SETTLEMENT_STATUSES.PAYMENT_SUBMITTED,
    paymentMethod,
    reference,
    note,
    paymentScreenshotUrl: paymentScreenshotUrl || existingPayment?.paymentScreenshotUrl || "",
    recordedByUid: currentUser?.uid,
    recordedByName: currentProfile?.name || "You",
    updatedAt: serverTimestamp(),
    createdAt: existingPayment?.createdAt || serverTimestamp(),
    history: Array.isArray(existingPayment?.history) ? existingPayment.history : []
  };

  const nextHistory = [
    ...paymentPayload.history,
    {
      status: SETTLEMENT_STATUSES.PAYMENT_SUBMITTED,
      note: note || "Payment submitted",
      createdAt: Date.now()
    }
  ];

  if (existingPayment?.id) {
    await updateDoc(doc(db, COLLECTIONS.PAYMENTS, existingPayment.id), {
      ...paymentPayload,
      status: SETTLEMENT_STATUSES.PAYMENT_SUBMITTED,
      history: nextHistory,
      waitingForReceiverApproval: true,
      submittedAt: Date.now(),
      submittedByUid: currentUser?.uid,
      submittedByName: currentProfile?.name || "You"
    });
    await recordSettlementEvent({
      title: "Payment Submitted",
      message: `${currentProfile?.name || "You"} submitted a payment for approval.`,
      type: "payment_submitted",
      debtorUid,
      creditorUid,
      amount,
      paymentId: existingPayment.id,
      status: SETTLEMENT_STATUSES.PAYMENT_SUBMITTED
    });
  } else {
    const paymentDoc = await addDoc(collection(db, COLLECTIONS.PAYMENTS), {
      ...paymentPayload,
      status: SETTLEMENT_STATUSES.PAYMENT_SUBMITTED,
      history: nextHistory,
      waitingForReceiverApproval: true,
      submittedAt: Date.now(),
      submittedByUid: currentUser?.uid,
      submittedByName: currentProfile?.name || "You"
    });
    await addDoc(collection(db, COLLECTIONS.PAYMENT_REQUESTS), {
      paymentId: paymentDoc.id,
      debtorUid,
      creditorUid,
      amount,
      status: SETTLEMENT_STATUSES.PAYMENT_SUBMITTED,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp()
    });
    await recordSettlementEvent({
      title: "Payment Submitted",
      message: `${currentProfile?.name || "You"} submitted a payment for approval.`,
      type: "payment_submitted",
      debtorUid,
      creditorUid,
      amount,
      paymentId: paymentDoc.id,
      status: SETTLEMENT_STATUSES.PAYMENT_SUBMITTED
    });
    await NotificationService.send({
      type: NOTIFICATION_TYPES.PAYMENT_ADDED,
      title: "Payment submitted",
      message: `${currentProfile?.name || "You"} submitted a payment for your approval.`,
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
  }

  await NotificationService.send({
    type: NOTIFICATION_TYPES.PAYMENT_CONFIRMED,
    title: "Payment update",
    message: `${currentProfile?.name || "You"} updated a settlement.`,
    senderId: currentUser?.uid,
    senderName: currentProfile?.name || "You",
    receiverIds: [creditorUid],
    priority: "normal",
    deepLink: "#settlements",
    category: "Payments",
    targetType: "settlements",
    targetId: existingPayment?.id || "",
    sound: "planner"
  });

  await addActivityEntry({
    title: "Payment submitted",
    message: `${currentProfile?.name || "You"} marked a payment as submitted to ${creditor?.name || "the receiver"}.`,
    type: "payment_submitted",
    targetType: "settlements",
    targetId: existingPayment?.id || "",
    entryType: "activity"
  });
}

async function approvePayment(paymentId) {
  const payment = allPayments.find((entry) => entry.id === paymentId);
  if (!payment) return;
  if (payment.creditorUid !== currentUser?.uid) {
    alert("You can only approve payments sent to you.");
    return;
  }
  if ([SETTLEMENT_STATUSES.APPROVED, SETTLEMENT_STATUSES.COMPLETED, SETTLEMENT_STATUSES.CANCELLED].includes(payment.status)) {
    alert("This payment has already been finalized.");
    return;
  }

  const history = Array.isArray(payment.history) ? payment.history : [];
  await updateDoc(doc(db, COLLECTIONS.PAYMENTS, paymentId), {
    status: SETTLEMENT_STATUSES.COMPLETED,
    updatedAt: serverTimestamp(),
    approvedByUid: currentUser?.uid,
    approvedByName: currentProfile?.name || "You",
    approvedAt: Date.now(),
    completedAt: Date.now(),
    waitingForReceiverApproval: false,
    history: [
      ...history,
      { status: SETTLEMENT_STATUSES.APPROVED, note: "Receiver approved", createdAt: Date.now() },
      { status: SETTLEMENT_STATUSES.COMPLETED, note: "Settlement completed", createdAt: Date.now() }
    ]
  });
  await recordSettlementEvent({
    title: "Receiver Approved",
    message: `${currentProfile?.name || "You"} approved the payment.`,
    type: "receiver_approved",
    debtorUid: payment.debtorUid,
    creditorUid: payment.creditorUid,
    amount: payment.amount,
    paymentId,
    status: SETTLEMENT_STATUSES.COMPLETED
  });
  await recordSettlementEvent({
    title: "Settlement Completed",
    message: `The settlement between ${payment.debtorUid === currentUser?.uid ? "you" : "the members"} is complete.`,
    type: "settlement_completed",
    debtorUid: payment.debtorUid,
    creditorUid: payment.creditorUid,
    amount: payment.amount,
    paymentId,
    status: SETTLEMENT_STATUSES.COMPLETED
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
}

async function rejectPayment(paymentId) {
  const payment = allPayments.find((entry) => entry.id === paymentId);
  if (!payment) return;
  if (payment.creditorUid !== currentUser?.uid) {
    alert("You can only reject payments sent to you.");
    return;
  }
  const history = Array.isArray(payment.history) ? payment.history : [];
  await updateDoc(doc(db, COLLECTIONS.PAYMENTS, paymentId), {
    status: SETTLEMENT_STATUSES.REJECTED,
    updatedAt: serverTimestamp(),
    history: [
      ...history,
      { status: SETTLEMENT_STATUSES.REJECTED, note: "Rejected by receiver", createdAt: Date.now() }
    ],
    waitingForReceiverApproval: false
  });
  await recordSettlementEvent({
    title: "Payment Rejected",
    message: `${currentProfile?.name || "You"} rejected the payment request.`,
    type: "payment_rejected",
    debtorUid: payment.debtorUid,
    creditorUid: payment.creditorUid,
    amount: payment.amount,
    paymentId,
    status: SETTLEMENT_STATUSES.REJECTED
  });
  await NotificationService.send({
    type: NOTIFICATION_TYPES.PAYMENT_FAILED,
    title: "Payment rejected",
    message: `${currentProfile?.name || "You"} rejected the settlement request.`,
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
}

async function deletePaymentEntry(paymentId) {
  const payment = allPayments.find((entry) => entry.id === paymentId);
  if (!payment) return;
  const confirmed = window.confirm("Delete this payment history entry?");
  if (!confirmed) return;
  await deleteDoc(doc(db, COLLECTIONS.PAYMENTS, paymentId));
}

async function notifyMember(memberUid, amount = 0) {
  const member = allMembers.find((entry) => entry.uid === memberUid);
  const payment = allPayments.find((entry) => entry.debtorUid === currentUser?.uid && entry.creditorUid === memberUid && [SETTLEMENT_STATUSES.PAYMENT_SUBMITTED, SETTLEMENT_STATUSES.WAITING_RECEIVER_APPROVAL].includes(entry.status));
  const lastReminderAt = payment?.lastReminderAt || 0;
  const now = Date.now();
  if (now - Number(lastReminderAt) < 30 * 60 * 1000) {
    alert("A reminder was already sent recently. Please wait a little before sending another.");
    return;
  }
  const title = "Payment Reminder";
  const message = `${member?.name || "Member"}, your payment of ₹${formatCurrency(amount)} is pending.`;
  await NotificationService.send({
    type: NOTIFICATION_TYPES.PAYMENT_ADDED,
    title,
    message,
    senderId: currentUser?.uid,
    senderName: currentProfile?.name || "You",
    receiverIds: [memberUid],
    priority: "high",
    deepLink: "#settlements",
    category: "Payments",
    targetType: "settlements",
    targetId: payment?.id || memberUid,
    sound: "planner"
  });
  if (payment?.id) {
    await updateDoc(doc(db, COLLECTIONS.PAYMENTS, payment.id), {
      status: SETTLEMENT_STATUSES.REMINDER_SENT,
      reminderCount: Number(payment.reminderCount || 0) + 1,
      lastReminderAt: now,
      reminderHistory: [...(payment.reminderHistory || []), { sentAt: now, senderName: currentProfile?.name || "You" }],
      updatedAt: serverTimestamp()
    });
  }
  await recordSettlementEvent({
    title: "Reminder Sent",
    message: `${currentProfile?.name || "You"} sent a reminder to ${member?.name || "the member"}.`,
    type: "reminder_sent",
    debtorUid: currentUser?.uid,
    creditorUid: memberUid,
    amount,
    paymentId: payment?.id || null,
    status: SETTLEMENT_STATUSES.REMINDER_SENT
  });
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
    `Hi ${member?.name || "there"} 👋`,
    "",
    `This is a friendly reminder regarding our "${tripName}".`,
    "",
    `I paid ₹${formatCurrency(amount)} on behalf of the group.`,
    `Your share is ₹${formatCurrency(amount)}.`,
    "Please send it whenever possible.",
    "Thank you 😊"
  ].join("\n");
  const whatsAppUrl = `https://wa.me/${number}?text=${encodeURIComponent(message)}`;
  window.open(whatsAppUrl, "_blank", "noopener,noreferrer");
}

async function recordSettlementEvent({ title, message, type, debtorUid, creditorUid, amount, paymentId, status }) {
  await addDoc(collection(db, COLLECTIONS.SETTLEMENT_HISTORY), {
    title,
    message,
    type,
    debtorUid: debtorUid || null,
    creditorUid: creditorUid || null,
    amount: Number(amount || 0),
    paymentId: paymentId || null,
    status: status || SETTLEMENT_STATUSES.PENDING,
    actorUid: currentUser?.uid || null,
    actorName: currentProfile?.name || "System",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
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

function getExpensePayers(expense) {
  if (Array.isArray(expense.payers) && expense.payers.length > 0) {
    return expense.payers.map((payer) => ({
      memberId: payer.memberId || payer.uid || payer.userId,
      amount: Number(payer.amount || 0)
    })).filter((payer) => payer.memberId);
  }
  if (expense.paidByUid) {
    return [{ memberId: expense.paidByUid, amount: Number(expense.amount || 0) }];
  }
  return [];
}

function buildRelationshipItems() {
  const currentUserUid = currentUser?.uid;
  const relationshipMap = new Map();
  const relationshipExpenseMap = new Map();

  allExpenses.forEach((expense) => {
    const participants = getExpenseParticipants(expense);
    const payers = getExpensePayers(expense);
    if (!participants.length) return;
    if (!participants.some((participant) => participant.memberId === currentUserUid)) return;

    const participantShares = new Map(participants.map((participant) => [participant.memberId, Number(participant.shareAmount || 0)]));
    const paidByMap = new Map();
    payers.forEach((payer) => {
      paidByMap.set(payer.memberId, (paidByMap.get(payer.memberId) || 0) + Number(payer.amount || 0));
    });

    const members = new Set([...participantShares.keys(), ...paidByMap.keys()]);
    members.forEach((memberId) => {
      if (memberId === currentUserUid) return;
      const participantShare = participantShares.get(memberId) || 0;
      const currentUserShare = participantShares.get(currentUserUid) || 0;
      const currentUserPaid = paidByMap.get(currentUserUid) || 0;
      const counterpartPaid = paidByMap.get(memberId) || 0;
      const currentUserBalance = roundCurrency(currentUserPaid - currentUserShare);
      const counterpartBalance = roundCurrency(counterpartPaid - participantShare);
      let delta = 0;
      if (currentUserBalance > 0 && counterpartBalance < 0) {
        delta = Math.min(currentUserBalance, Math.abs(counterpartBalance));
      } else if (currentUserBalance < 0 && counterpartBalance > 0) {
        delta = -Math.min(Math.abs(currentUserBalance), counterpartBalance);
      }
      if (!delta) return;
      const existing = relationshipMap.get(memberId) || { amount: 0 };
      relationshipMap.set(memberId, { amount: roundCurrency(existing.amount + delta), latestExpenseId: expense.id });
      relationshipExpenseMap.set(memberId, expense.id);
    });
  });

  const creditItems = [];
  const debitItems = [];
  const paymentRequests = [];
  const paymentHistory = [];
  const timeline = [];

  relationshipMap.forEach((relationship, counterpartUid) => {
    const member = allMembers.find((entry) => entry.uid === counterpartUid);
    const pairPayments = allPayments.filter((payment) => {
      const pair = payment.debtorUid === currentUserUid && payment.creditorUid === counterpartUid || payment.debtorUid === counterpartUid && payment.creditorUid === currentUserUid;
      return pair;
    });
    const settledAmount = pairPayments.filter((payment) => [SETTLEMENT_STATUSES.APPROVED, SETTLEMENT_STATUSES.COMPLETED].includes(payment.status)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const outstandingAmount = roundCurrency(Math.abs(relationship.amount) - settledAmount);
    if (outstandingAmount <= 0.01) return;

    const latestPayment = [...pairPayments].sort((a, b) => getTimestampValue(b.createdAt) - getTimestampValue(a.createdAt))[0] || null;
    const status = latestPayment?.status || (relationship.amount > 0 ? SETTLEMENT_STATUSES.PENDING : SETTLEMENT_STATUSES.PENDING);
    const item = {
      counterpartUid,
      counterpartName: member?.name || "Member",
      amount: outstandingAmount,
      status,
      paymentId: latestPayment?.id || null
    };

    if (relationship.amount > 0) {
      creditItems.push(item);
    } else {
      debitItems.push(item);
    }
  });

  allPayments.filter((payment) => payment.debtorUid === currentUserUid || payment.creditorUid === currentUserUid).forEach((payment) => {
    const counterpartUid = payment.creditorUid === currentUserUid ? payment.debtorUid : payment.creditorUid;
    const counterpartName = allMembers.find((member) => member.uid === counterpartUid)?.name || "Member";
    paymentHistory.push({
      paymentId: payment.id,
      amount: Number(payment.amount || 0),
      status: payment.status || SETTLEMENT_STATUSES.PENDING,
      reference: payment.reference || payment.paymentMethod || "",
      screenshotUrl: payment.paymentScreenshotUrl || "",
      counterpartName,
      counterpartUid
    });
  });

  paymentHistory.sort((a, b) => getTimestampValue(b.createdAt || 0) - getTimestampValue(a.createdAt || 0));

  allPayments.filter((payment) => payment.creditorUid === currentUserUid && [SETTLEMENT_STATUSES.PENDING, SETTLEMENT_STATUSES.PAYMENT_SUBMITTED, SETTLEMENT_STATUSES.WAITING_RECEIVER_APPROVAL, SETTLEMENT_STATUSES.REMINDER_SENT].includes(payment.status)).forEach((payment) => {
    paymentRequests.push({
      id: payment.id,
      debtorName: allMembers.find((member) => member.uid === payment.debtorUid)?.name || "Member",
      amount: Number(payment.amount || 0),
      status: payment.status || SETTLEMENT_STATUSES.PENDING,
      note: payment.note || ""
    });
  });

  allSettlementHistory.slice(0, 12).forEach((entry) => {
    if (entry.debtorUid && entry.debtorUid !== currentUserUid && entry.creditorUid && entry.creditorUid !== currentUserUid) return;
    timeline.push({
      title: entry.title || entry.type || "Activity",
      message: entry.message || "",
      createdAt: entry.createdAt
    });
  });

  return { creditItems, debitItems, paymentRequests, paymentHistory, timeline };
}

function formatDisplayDate(value) {
  const date = getDateValue(value);
  return date ? date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

function getDateValue(value) {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") return new Date(value);
  return null;
}

function getTimestampValue(value) {
  if (!value) return 0;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value.seconds) return value.seconds * 1000;
  return Number(value) || 0;
}

function roundCurrency(value) {
  return Math.round(Number(value || 0) * 100) / 100;
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

function escapeAttribute(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

function downloadQrCode(url, name = "qr") {
  if (!url) {
    alert("No QR Code Available");
    return;
  }
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(name || "member").replace(/\s+/g, "-").toLowerCase()}-qr.png`;
  link.click();
}

function exportPaymentHistory() {
  const rows = ["Date,Member,Amount,Status,Reference"];
  const visibleItems = Array.from(contentEl.querySelectorAll("#settlement-history-list > .settlement-item")).filter((item) => item.style.display !== "none");
  visibleItems.forEach((item) => {
    const text = item.textContent.replace(/\s+/g, " ").trim();
    const [member, amountAndStatus, reference] = text.split("₹");
    rows.push(`"${new Date().toISOString()}","${(member || "").replace(/"/g, '""')}","${amountAndStatus || ""}","${reference || ""}"`);
  });
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "settlement-history.csv";
  link.click();
  URL.revokeObjectURL(url);
}
