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
  statusPeerWrap:    $("#status-peer-wrap"),
  statusPeerSummary: $("#status-peer-summary"),
  statusPeerList:    $("#status-peer-list"),
  statusDot:     $("#status-dot"),
  statusEntry:   $("#status-entry"),
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
  const onSuccess = () => {
    els.btnCopy.textContent = "[ COPIED ]";
    els.btnCopy.classList.add("copied");
    setTimeout(() => {
      els.btnCopy.textContent = "[ COPY LINK ]";
      els.btnCopy.classList.remove("copied");
    }, 2000);
  };

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(onSuccess);
  } else {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
    onSuccess();
  }
}

/**
 * Update the chat status bar with self and peer codenames.
 * Shows a summary (first name + count) that expands on click.
 * @param {string} selfCodename
 * @param {string[]} peerNames array of peer codenames
 */
export function updateStatusBar(selfCodename, peerNames) {
  els.statusSelf.textContent = selfCodename;

  if (peerNames.length === 0) {
    els.statusPeerSummary.textContent = "no peers";
  } else if (peerNames.length === 1) {
    els.statusPeerSummary.textContent = peerNames[0];
  } else {
    els.statusPeerSummary.textContent = `${peerNames[0]} +${peerNames.length - 1}`;
  }

  els.statusPeerList.innerHTML = "";
  for (const name of peerNames) {
    const div = document.createElement("div");
    div.className = "status-peer-item";
    div.textContent = name;
    els.statusPeerList.appendChild(div);
  }
}

/**
 * Set the connection status dot.
 * @param {boolean} connected
 */
export function setConnectionStatus(connected) {
  els.statusDot.classList.toggle("disconnected", !connected);
}

/**
 * Update the entry status indicator.
 * @param {boolean} open
 */
export function setEntryStatus(open) {
  els.statusEntry.textContent = open ? "entry: open" : "entry: closed";
  els.statusEntry.classList.toggle("entry-closed", !open);
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

// ── Peer list expand/collapse toggle ───────────────────────────
els.statusPeerWrap.addEventListener("click", () => {
  els.statusPeerList.classList.toggle("hidden");
  els.statusPeerWrap.classList.toggle("expanded");
});
