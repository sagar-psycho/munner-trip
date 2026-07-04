// avatar.js
// Shared initials avatar renderer for members and trip participants.

export function getInitials(name) {
  const safeName = (name || "User").trim();
  if (!safeName) return "U";

  const parts = safeName.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function renderAvatar(name, options = {}) {
  const safeName = name || "User";
  const size = options.size || "default";
  const className = options.className || "";
  const fallbackText = options.fallbackText || "";
  const icon = options.icon || "";
  const initials = fallbackText || getInitials(safeName);
  const palette = getAvatarPalette(safeName);
  const classes = ["avatar-bubble", className, size === "small" ? "small" : size === "large" ? "large" : ""]
    .filter(Boolean)
    .join(" ");

  const content = icon ? `<i class="bi ${icon}"></i>` : escapeHtml(initials);
  return `<div class="${classes}" style="--avatar-bg:${palette.background}; --avatar-fg:${palette.foreground};">${content}</div>`;
}

function getAvatarPalette(name) {
  const seed = hashString(name || "User");
  const hue = seed % 360;
  return {
    background: `hsl(${hue} 42% 45%)`,
    foreground: "#ffffff"
  };
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash);
}

function escapeHtml(value) {
  const div = document.createElement("div");
  div.textContent = value ?? "";
  return div.innerHTML;
}
