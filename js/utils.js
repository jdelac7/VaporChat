import { generateRoomCode } from "./words.js";

/**
 * Generate a channel ID as a 4-word room code.
 * @returns {string} e.g. "bold-echo-fern-grid"
 */
export function generateChannelId() {
  return generateRoomCode();
}

/**
 * Parse channel ID from the current URL hash.
 * Accepts any 4-word hyphenated code.
 * @returns {string|null} channel ID or null if not present/invalid
 */
export function parseChannelFromHash() {
  const hash = window.location.hash.slice(1);
  if (!hash) return null;
  const parts = hash.split("-");
  return parts.length === 4 && parts.every(w => w.length > 0) ? hash : null;
}

/**
 * Clear the URL hash without triggering a page reload.
 */
export function clearHash() {
  history.replaceState(null, "", window.location.pathname + window.location.search);
}

/**
 * Format a timestamp as [HH:MM:SS].
 * @param {Date} [date]
 * @returns {string}
 */
export function formatTimestamp(date = new Date()) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `[${h}:${m}:${s}]`;
}

/**
 * Escape HTML entities to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
export function escapeHtml(str) {
  const div = document.createElement("div");
  div.appendChild(document.createTextNode(str));
  return div.innerHTML;
}

/**
 * Build the shareable link for a channel.
 * @param {string} channelId
 * @returns {string}
 */
export function buildShareLink(channelId) {
  return `${window.location.origin}${window.location.pathname}#${channelId}`;
}

/**
 * Format a byte count as a human-readable file size.
 * @param {number} bytes
 * @returns {string}
 */
export function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
