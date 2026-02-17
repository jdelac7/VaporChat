import { formatTimestamp, escapeHtml, formatFileSize } from "./utils.js";

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
  btnJoinShow:   $("#btn-join-show"),
  btnJoin:       $("#btn-join"),
  btnCreateConfirm: $("#btn-create-confirm"),
  btnBackCreate: $("#btn-back-create"),
  btnBackJoin:   $("#btn-back-join"),
  chkRandom:     $("#chk-random"),
  landingButtons: $("#landing-buttons"),
  panelCreate:   $("#panel-create"),
  panelJoin:     $("#panel-join"),
  createWords:   Array.from(document.querySelectorAll(".create-word")),
  createWordsWrap: $("#create-words"),
  joinWords: [
    $("#join-word-1"),
    $("#join-word-2"),
    $("#join-word-3"),
    $("#join-word-4"),
  ],
  btnCopyCode:   $("#btn-copy-code"),
  btnCopyLink:   $("#btn-copy-link"),
  btnCancel:     $("#btn-cancel"),
  btnReturn:     $("#btn-return"),
  btnErrorReturn:$("#btn-error-return"),
  landingError:  $("#landing-error"),
  selfCodename:  $("#self-codename"),
  roomCode:      $("#room-code"),
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
  btnAttach:     $("#btn-attach"),
};

/**
 * Switch to a named screen. Hides all others.
 * Reset landing panels when returning to landing.
 * @param {"landing"|"waiting"|"chat"|"destroyed"|"error"} name
 */
export function showScreen(name) {
  for (const [key, el] of Object.entries(screens)) {
    el.classList.toggle("active", key === name);
  }
  if (name === "chat") {
    els.chatInput.focus();
  }
  if (name === "landing") {
    showLandingButtons();
  }
}

/**
 * Show the main landing buttons, hide panels.
 */
export function showLandingButtons() {
  els.landingButtons.classList.remove("hidden");
  els.panelCreate.classList.add("hidden");
  els.panelJoin.classList.add("hidden");
  hideLandingError();
  clearJoinInputs();
  clearCreateInputs();
}

/**
 * Show the create channel panel, hide main buttons.
 */
export function showCreatePanel() {
  els.landingButtons.classList.add("hidden");
  els.panelJoin.classList.add("hidden");
  els.panelCreate.classList.remove("hidden");
  hideLandingError();
}

/**
 * Show the join channel panel, hide main buttons.
 */
export function showJoinPanel() {
  els.landingButtons.classList.add("hidden");
  els.panelCreate.classList.add("hidden");
  els.panelJoin.classList.remove("hidden");
  hideLandingError();
  els.joinWords[0].focus();
}

/**
 * Read all 4 create word inputs as a space-separated string.
 */
export function getCreateCode() {
  return els.createWords.map(el => el.value.trim()).join(" ");
}

/**
 * Clear all 4 create word inputs.
 */
export function clearCreateInputs() {
  els.createWords.forEach(el => { el.value = ""; });
}

/**
 * Display the user's codename on the waiting screen.
 */
export function showSelfCodename(codename) {
  els.selfCodename.textContent = codename;
}

/**
 * Display the room code on the waiting screen (space-separated for readability).
 * @param {string} channelId - hyphenated room code e.g. "bold-echo-fern-grid"
 */
export function showRoomCode(channelId) {
  els.roomCode.textContent = channelId.replace(/-/g, "  ");
}

/**
 * Display the shareable link on the waiting screen.
 */
export function showShareLink(link) {
  els.shareLink.textContent = link;
}

/**
 * Copy text to clipboard and flash a given button.
 * @param {string} text
 * @param {HTMLElement} btn
 * @param {string} defaultLabel
 */
export function copyToClipboard(text, btn, defaultLabel) {
  const onSuccess = () => {
    btn.textContent = "[ COPIED ]";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = defaultLabel;
      btn.classList.remove("copied");
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
 * Mark the entry status indicator as clickable (creator only).
 * @param {boolean} clickable
 */
export function setEntryClickable(clickable) {
  els.statusEntry.classList.toggle("clickable", clickable);
}

/**
 * Append a chat message to the log.
 * @param {"self"|"peer"|"system"|"error"|"crypto"} type
 * @param {string} text
 * @param {string} [codename]
 * @param {{ unverified?: boolean }} [options]
 */
export function appendMessage(type, text, codename, options) {
  const div = document.createElement("div");
  div.className = `message msg-${type}`;
  if (options && options.unverified) div.classList.add("msg-unverified");

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
 * Append a file message to the log with download link and optional image preview.
 * @param {"self"|"peer"} type
 * @param {{ fileName: string, mimeType: string, fileSize: number, data: string }} metadata
 * @param {string} codename
 * @param {{ unverified?: boolean }} [options]
 */
export function appendFileMessage(type, metadata, codename, options) {
  const { fileName, mimeType, fileSize, data } = metadata;

  // Convert base64 to Blob and create object URL
  const byteString = atob(data);
  const bytes = new Uint8Array(byteString.length);
  for (let i = 0; i < byteString.length; i++) {
    bytes[i] = byteString.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  const blobUrl = URL.createObjectURL(blob);

  const div = document.createElement("div");
  div.className = `message msg-${type}`;
  if (options && options.unverified) div.classList.add("msg-unverified");

  const timestamp = `<span class="msg-timestamp">${escapeHtml(formatTimestamp())}</span>`;
  const name = `<span class="msg-codename">${escapeHtml(codename)}</span>`;
  const link = `<a class="file-download" href="${blobUrl}" download="${escapeHtml(fileName)}">${escapeHtml(fileName)}</a>`;
  const size = `<span class="file-size">(${formatFileSize(fileSize)})</span>`;

  let html = `${timestamp} ${name} &gt; ${link} ${size}`;

  if (mimeType.startsWith("image/")) {
    html += `<img class="file-preview" src="${blobUrl}" alt="${escapeHtml(fileName)}">`;
  }

  div.innerHTML = html;
  div.dataset.blobUrl = blobUrl;

  els.messageLog.appendChild(div);
  els.messageLog.scrollTop = els.messageLog.scrollHeight;
}

/**
 * Revoke all blob URLs in the message log.
 */
function revokeBlobUrls() {
  const items = els.messageLog.querySelectorAll("[data-blob-url]");
  for (const el of items) {
    URL.revokeObjectURL(el.dataset.blobUrl);
  }
}

/**
 * Enable or disable the chat input.
 */
export function setInputEnabled(enabled) {
  els.chatInput.disabled = !enabled;
  els.btnAttach.disabled = !enabled;
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
  revokeBlobUrls();
  els.messageLog.innerHTML = "";
}

/**
 * Clear the message log (user-facing alias for /clear command).
 */
export function clearMessages() {
  revokeBlobUrls();
  els.messageLog.innerHTML = "";
}

/**
 * Read all 4 join inputs and return as a single space-separated string.
 */
export function getJoinCode() {
  return els.joinWords.map(el => el.value.trim()).join(" ");
}

/**
 * Clear all 4 join inputs.
 */
export function clearJoinInputs() {
  els.joinWords.forEach(el => { el.value = ""; });
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
