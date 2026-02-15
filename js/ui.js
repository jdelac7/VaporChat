import { formatTimestamp, escapeHtml } from "./utils.js";

const $ = (sel) => document.querySelector(sel);

const screens = {
  landing:   $("#screen-landing"),
  waiting:   $("#screen-waiting"),
  chat:      $("#screen-chat"),
  destroyed: $("#screen-destroyed"),
  error:     $("#screen-error"),
};

const els = {
  btnCreate:     $("#btn-create"),
  btnCopy:       $("#btn-copy"),
  btnCancel:     $("#btn-cancel"),
  btnReturn:     $("#btn-return"),
  btnErrorReturn:$("#btn-error-return"),
  landingError:  $("#landing-error"),
  selfCodename:  $("#self-codename"),
  shareLink:     $("#share-link"),
  statusSelf:    $("#status-self"),
  statusPeer:    $("#status-peer"),
  statusDot:     $("#status-dot"),
  messageLog:    $("#message-log"),
  chatInput:     $("#chat-input"),
  errorMessage:  $("#error-message"),
};

/**
 * Switch to a named screen. Hides all others.
 * @param {"landing"|"waiting"|"chat"|"destroyed"|"error"} name
 */
export function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle("active", key === name);
  }
  if (name === "chat") {
    els.chatInput.focus();
  }
}

/**
 * Display the user's codename on the waiting screen.
 */
export function showSelfCodename(codename) {
  els.selfCodename.textContent = codename;
}

/**
 * Display the shareable link on the waiting screen.
 */
export function showShareLink(link) {
  els.shareLink.textContent = link;
}

/**
 * Copy text to clipboard and flash the copy button.
 */
export function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    els.btnCopy.textContent = "[ COPIED ]";
    els.btnCopy.classList.add("copied");
    setTimeout(() => {
      els.btnCopy.textContent = "[ COPY LINK ]";
      els.btnCopy.classList.remove("copied");
    }, 2000);
  });
}

/**
 * Update the chat status bar with both codenames.
 */
export function updateStatusBar(selfCodename, peerCodename) {
  els.statusSelf.textContent = selfCodename;
  els.statusPeer.textContent = peerCodename;
}

/**
 * Set the connection status dot.
 * @param {boolean} connected
 */
export function setConnectionStatus(connected) {
  els.statusDot.classList.toggle("disconnected", !connected);
}

/**
 * Append a chat message to the log.
 * @param {"self"|"peer"|"system"|"error"|"crypto"} type
 * @param {string} text
 * @param {string} [codename]
 */
export function appendMessage(type, text, codename) {
  const div = document.createElement("div");
  div.className = `message msg-${type}`;

  if (type === "self" || type === "peer") {
    div.innerHTML =
      `<span class="msg-timestamp">${escapeHtml(formatTimestamp())}</span> ` +
      `<span class="msg-codename">${escapeHtml(codename)}</span> &gt; ` +
      `<span class="msg-text">${escapeHtml(text)}</span>`;
  } else {
    div.innerHTML =
      `<span class="msg-timestamp">${escapeHtml(formatTimestamp())}</span> ` +
      `<span>${escapeHtml(text)}</span>`;
  }

  els.messageLog.appendChild(div);
  els.messageLog.scrollTop = els.messageLog.scrollHeight;
}

/**
 * Enable or disable the chat input.
 */
export function setInputEnabled(enabled) {
  els.chatInput.disabled = !enabled;
  if (enabled) els.chatInput.focus();
}

/**
 * Clear the chat input field.
 */
export function clearInput() {
  els.chatInput.value = "";
}

/**
 * Get the current chat input value.
 */
export function getInputValue() {
  return els.chatInput.value;
}

/**
 * Show an error on the landing screen.
 */
export function showLandingError(msg) {
  els.landingError.textContent = msg;
  els.landingError.classList.add("visible");
}

/**
 * Hide the landing screen error.
 */
export function hideLandingError() {
  els.landingError.textContent = "";
  els.landingError.classList.remove("visible");
}

/**
 * Show the error screen with a message.
 */
export function showError(msg) {
  els.errorMessage.textContent = msg;
  showScreen("error");
}

/**
 * Purge all messages from the chat log.
 */
export function purgeMessages() {
  els.messageLog.innerHTML = "";
}

/**
 * Clear the message log (user-facing alias for /clear command).
 */
export function clearMessages() {
  els.messageLog.innerHTML = "";
}

/**
 * Get references to interactive elements for event binding.
 */
export function getElements() {
  return els;
}
