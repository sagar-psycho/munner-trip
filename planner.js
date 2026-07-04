// planner.js
// Admin and super admin can add, edit, and delete itinerary items (pickup
// points, bus times, train times, anything else). Members see the same
// list with no edit controls at all.
//
// Items are shown in the order they were added (first added = first shown),
// not sorted by the free-text "time" field, since that's just a label the
// admin types in (e.g. "6:30 AM", "Day 2") and isn't reliably sortable.
// Each item also shows the date it was added to the itinerary.

import { db } from "./firebase-config.js";
import { isAdmin } from "./auth.js";
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

let unsubPlanner = null;
let items = [];

export function renderPlannerTab(container) {
  container.innerHTML = `
    <div class="section-title">Itinerary</div>
    <div class="card" id="planner-list">
      <div class="empty-state"><i class="bi bi-map"></i>Loading…</div>
    </div>
  `;

  if (isAdmin()) injectFab();

  // Ordered by creation order - first added shows first, second added
  // shows second, and so on.
  const q = query(collection(db, "planner"), orderBy("createdAt", "asc"));
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
  pickup: "bi-car-front",
  bus: "bi-bus-front",
  train: "bi-train-front",
  other: "bi-geo-alt"
};

function render() {
  const el = document.getElementById("planner-list");
  if (!el) return;

  if (items.length === 0) {
    el.innerHTML = `<div class="empty-state"><i class="bi bi-map"></i>The admin hasn't added the itinerary yet.</div>`;
    return;
  }

  el.innerHTML = items
    .map(
      (item) => `
      <div class="timeline-item">
        <div class="timeline-time">${escapeHtml(item.time)}</div>
        <div class="timeline-body" style="flex:1;">
          <h4><i class="bi ${modeIcon[item.mode] || "bi-geo-alt"}" style="margin-right:6px; vertical-align:-2px;"></i>${escapeHtml(item.title)}</h4>
          <p>${escapeHtml(item.details)}</p>
          <div class="timeline-mode">${escapeHtml(item.mode)}</div>
          <div class="timeline-mode" style="margin-top:2px;">Added ${new Date(item.createdAt).toLocaleDateString()}</div>
        </div>
        ${
          isAdmin()
            ? `
          <div style="display:flex; flex-direction:column; gap:6px; align-self:flex-start;">
            <button class="btn-ghost small" data-edit="${item.id}"><i class="bi bi-pencil"></i></button>
            <button class="btn-danger" data-del="${item.id}"><i class="bi bi-trash"></i></button>
          </div>`
            : ""
        }
      </div>
    `
    )
    .join("");

  if (isAdmin()) {
    el.querySelectorAll("[data-del]").forEach((btn) =>
      btn.addEventListener("click", () => deleteDoc(doc(db, "planner", btn.dataset.del)))
    );
    el.querySelectorAll("[data-edit]").forEach((btn) =>
      btn.addEventListener("click", () => {
        const item = items.find((i) => i.id === btn.dataset.edit);
        if (item) openItemModal(item);
      })
    );
  }
}

function injectFab() {
  if (document.getElementById("planner-fab")) return;
  const fab = document.createElement("button");
  fab.id = "planner-fab";
  fab.className = "fab";
  fab.innerHTML = `<i class="bi bi-plus-lg"></i>`;
  fab.addEventListener("click", () => openItemModal(null));
  document.body.appendChild(fab);
}

// Shared modal for both adding a new item (existingItem = null) and
// editing an existing one (existingItem = the item being edited).
function openItemModal(existingItem) {
  const isEdit = !!existingItem;
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  overlay.innerHTML = `
    <div class="modal-sheet">
      <h3>${isEdit ? "Edit itinerary item" : "Add to itinerary"}</h3>
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
        <button class="btn-primary" id="pl-submit">${isEdit ? "Save" : "Add"}</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  if (isEdit) {
    overlay.querySelector("#pl-mode").value = existingItem.mode || "other";
    overlay.querySelector("#pl-time").value = existingItem.time || "";
    overlay.querySelector("#pl-title").value = existingItem.title || "";
    overlay.querySelector("#pl-details").value = existingItem.details || "";
  }

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

    if (isEdit) {
      await updateDoc(doc(db, "planner", existingItem.id), { mode, time, title, details });
    } else {
      await addDoc(collection(db, "planner"), { mode, time, title, details, createdAt: Date.now() });
    }
    overlay.remove();
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}