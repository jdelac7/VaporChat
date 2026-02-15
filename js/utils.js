/**
 * Generate a cryptographically random channel ID (hex string).
 * @returns {string} 32-character hex string
 */
export function generateChannelId() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Parse channel ID from the current URL hash.
 * Returns null if the hash is missing or not a valid 32-char hex string.
 * @returns {string|null} channel ID or null if not present/invalid
 */
export function parseChannelFromHash() {
  const hash = window.location.hash.slice(1);
  if (/^[0-9a-f]{32}$/.test(hash)) return hash;
  return null;
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
