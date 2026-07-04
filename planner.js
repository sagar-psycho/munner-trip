// planner.js
// Admin adds/edits/deletes itinerary items (pickup points, bus times,
// train times, anything else). Members see the same list, sorted by time,
// with no edit controls at all.

import { db } from "./firebase-config.js";
import { isAdmin } from "./auth.js";
import {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let unsubPlanner = null;
let items = [];

export function renderPlannerTab(container) {
  container.innerHTML = `
    <div class="section-title">Itinerary</div>
    <div class="card" id="planner-list">
      <div class="empty-state"><i class="ti ti-map-2"></i>Loading…</div>
    </div>
  `;

  if (isAdmin()) injectFab();

  const q = query(collection(db, "planner"), orderBy("time", "asc"));
  unsubPlanner = onSnapshot(q, (snap) => {
    items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
  });
}

export function teardownPlannerTab() {
  if (unsubPlanner) unsubPlanner();
  const fab = document.getElementById("planner-fab");
  if (fab) fab.remove();
}

const modeIcon = {
  pickup: "ti-car",
  bus: "ti-bus",
  train: "ti-train",
  other: "ti-map-pin"
};

function render() {
  const el = document.getElementById("planner-list");
  if (!el) return;

  if (items.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="ti ti-map-2"></i>The admin hasn't added the itinerary yet.</div>`;
    return;
  }

  el.innerHTML = items
    .map(
      (item) => `
      <div class="timeline-item">
        <div class="timeline-time">${escapeHtml(item.time)}</div>
        <div class="timeline-body" style="flex:1;">
          <h4><i class="ti ${modeIcon[item.mode] || "ti-map-pin"}" style="margin-right:6px; vertical-align:-2px;"></i>${escapeHtml(item.title)}</h4>
          <p>${escapeHtml(item.details)}</p>
          <div class="timeline-mode">${escapeHtml(item.mode)}</div>
        </div>
        ${isAdmin() ? `<button class="btn-danger" data-del="${item.id}" style="align-self:flex-start;"><i class="ti ti-trash"></i></button>` : ""}
      </div>
    `
    )
    .join("");

  if (isAdmin()) {
    el.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", () => deleteDoc(doc(db, "planner", btn.dataset.del)))
    );
  }
}

function injectFab() {
  if (document.getElementById("planner-fab")) return;
  const fab = document.createElement("button");
  fab.id = "planner-fab";
  fab.className = "fab";
  fab.innerHTML = `<i class="ti ti-plus"></i>`;
  fab.addEventListener("click", openAddItemModal);
  document.body.appendChild(fab);
}

function openAddItemModal() {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>Add to itinerary</h3>
      <select id="pl-mode">
        <option value="pickup">Pickup</option>
        <option value="bus">Bus</option>
        <option value="train">Train</option>
        <option value="other">Other</option>
      </select>
      <input id="pl-time" type="text" placeholder="Time (e.g. 6:30 AM, Day 1)" />
      <input id="pl-title" type="text" placeholder="Title (e.g. Ernakulam to Munnar)" />
      <textarea id="pl-details" rows="3" placeholder="Details - pickup point, bus number, platform, notes"></textarea>
      <p id="pl-error" class="error-text"></p>
      <div class="modal-actions">
        <button class="btn-ghost" id="pl-cancel">Cancel</button>
        <button class="btn-primary" id="pl-submit">Add</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  overlay.querySelector("#pl-cancel").addEventListener("click", () => overlay.remove());
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  overlay.querySelector("#pl-submit").addEventListener("click", async () => {
    const mode = overlay.querySelector("#pl-mode").value;
    const time = overlay.querySelector("#pl-time").value.trim();
    const title = overlay.querySelector("#pl-title").value.trim();
    const details = overlay.querySelector("#pl-details").value.trim();
    const errorEl = overlay.querySelector("#pl-error");

    if (!time || !title) {
      errorEl.textContent = "Add at least a time and a title.";
      return;
    }

    await addDoc(collection(db, "planner"), { mode, time, title, details, createdAt: Date.now() });
    overlay.remove();
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}
