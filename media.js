// media.js
// All members and admin can upload and download photos/videos. Files are
// uploaded directly to Cloudinary's free tier (no Firebase Storage / Blaze
// plan needed); only the resulting URL + metadata is saved to Firestore.

import { db, CLOUDINARY_CLOUD_NAME, CLOUDINARY_UPLOAD_PRESET } from "./firebase-config.js";
import { currentUser, currentProfile } from "./auth.js";
import {
  collection,
  addDoc,
  onSnapshot,
  query,
  orderBy
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

let unsubMedia = null;

export function renderMediaTab(container) {
  container.innerHTML = `
    <div class="upload-drop" id="upload-drop">
      <i class="ti ti-cloud-upload" style="font-size:26px;"></i>
      <p style="margin:8px 0 0; font-size:14px;">Tap to upload photos or videos</p>
      <input type="file" id="media-file-input" accept="image/*,video/*" multiple style="display:none;" />
    </div>
    <p id="upload-status" class="hint" style="text-align:left;"></p>
    <div class="section-title">Trip gallery</div>
    <div class="media-grid" id="media-grid"></div>
  `;

  const dropEl = document.getElementById("upload-drop");
  const fileInput = document.getElementById("media-file-input");
  dropEl.addEventListener("click", () => fileInput.click());
  fileInput.addEventListener("change", (e) => handleFiles(e.target.files));

  const q = query(collection(db, "media"), orderBy("createdAt", "desc"));
  unsubMedia = onSnapshot(q, (snap) => {
    const grid = document.getElementById("media-grid");
    if (!grid) return;
    if (snap.empty) {
      grid.innerHTML = `<div class="empty-state" style="grid-column: 1 / -1;"><i class="ti ti-photo"></i>No photos or videos yet.</div>`;
      return;
    }
    grid.innerHTML = snap.docs
      .map((d) => {
        const m = d.data();
        const tag = m.fileType.startsWith("video") ? `<video src="${m.url}" muted></video>` : `<img src="${m.url}" loading="lazy" />`;
        return `
          <a class="media-tile" href="${m.url}" target="_blank" rel="noopener">
            ${tag}
            <div class="media-by">${escapeHtml(m.uploadedByName)}</div>
          </a>
        `;
      })
      .join("");
  });
}

export function teardownMediaTab() {
  if (unsubMedia) unsubMedia();
}

async function handleFiles(fileList) {
  const statusEl = document.getElementById("upload-status");
  const files = Array.from(fileList);
  if (files.length === 0) return;

  if (CLOUDINARY_CLOUD_NAME === "YOUR_CLOUD_NAME") {
    statusEl.textContent = "Media upload isn't configured yet - add your Cloudinary details to firebase-config.js.";
    return;
  }

  for (const file of files) {
    statusEl.textContent = `Uploading ${file.name}...`;
    try {
      const isVideo = file.type.startsWith("video");
      const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${isVideo ? "video" : "image"}/upload`;

      const formData = new FormData();
      formData.append("file", file);
      formData.append("upload_preset", CLOUDINARY_UPLOAD_PRESET);

      const res = await fetch(endpoint, { method: "POST", body: formData });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error?.message || "Upload failed.");
      }
      const data = await res.json();

      await addDoc(collection(db, "media"), {
        url: data.secure_url,
        fileType: file.type,
        uploadedByUid: currentUser.uid,
        uploadedByName: currentProfile.name,
        createdAt: Date.now()
      });
    } catch (err) {
      statusEl.textContent = `Couldn't upload ${file.name}: ${err.message}`;
      return;
    }
  }
  statusEl.textContent = "Upload complete.";
  setTimeout(() => (statusEl.textContent = ""), 2500);
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}