import { generateChannelId, parseChannelFromHash, clearHash, buildShareLink } from "./utils.js";
import { generateCodename, normalizeRoomCode } from "./words.js";
import * as ui from "./ui.js";
import * as crypto from "./crypto.js";
import * as network from "./network.js";

// ── Session State ──────────────────────────────────────────────
let state = "landing"; // landing | waiting | chat | destroyed | error
let selfCodename = null;
let peers = new Map(); // peerId → { codename, connected }
let channelId = null;
let shareLink = null;
let isCreator = false;
let entryOpen = true;
let sessionStartTime = null;
let pendingPings = new Map(); // peerId → timestamp
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2 MB

// ── State Machine ──────────────────────────────────────────────
function transition(newState) {
  state = newState;
  ui.showScreen(newState);
}

// ── Helper: check if a peer is the channel creator ────────────
function isFromCreator(peerId) {
  return peerId === "vaporchat-" + channelId;
}

// ── Helper: get all peer codenames ─────────────────────────────
function getPeerNames() {
  return Array.from(peers.values()).map(p => p.codename);
}

function refreshStatusBar() {
  ui.updateStatusBar(selfCodename, getPeerNames());
}

// ── Creator Flow ───────────────────────────────────────────────
async function createChannel(customChannelId) {
  try {
    ui.hideLandingError();
    const els = ui.getElements();
    els.btnCreateConfirm.disabled = true;
    els.btnCreateConfirm.textContent = "GENERATING KEYS...";

    // Use custom words or generate random
    channelId = customChannelId || generateChannelId();
    selfCodename = generateCodename();
    await crypto.generateKeypair();

    shareLink = buildShareLink(channelId);
    isCreator = true;

    // Setup network handlers before creating channel
    setupNetworkHandlers();

    await network.createChannel(channelId);

    // Show waiting screen
    ui.showSelfCodename(selfCodename);
    ui.showRoomCode(channelId);
    ui.showShareLink(shareLink);
    transition("waiting");

    els.btnCreateConfirm.disabled = false;
    els.btnCreateConfirm.textContent = "CREATE CHANNEL";
  } catch (err) {
    const els = ui.getElements();
    els.btnCreateConfirm.disabled = false;
    els.btnCreateConfirm.textContent = "CREATE CHANNEL";
    ui.showLandingError("Failed to create channel: " + err.message);
  }
}

// ── Joiner Flow ────────────────────────────────────────────────
async function joinChannel(joinChannelId) {
  try {
    // Clear hash from URL immediately
    clearHash();

    channelId = joinChannelId;
    selfCodename = generateCodename();
    isCreator = false;

    // Show a brief loading state
    const els = ui.getElements();
    els.btnJoin.disabled = true;
    els.btnJoin.textContent = "CONNECTING...";

    await crypto.generateKeypair();

    setupNetworkHandlers();

    await network.joinChannel(channelId);

    els.btnJoin.disabled = false;
    els.btnJoin.textContent = "JOIN CHANNEL";
  } catch (err) {
    const els = ui.getElements();
    els.btnJoin.disabled = false;
    els.btnJoin.textContent = "JOIN CHANNEL";

    let msg;
    if (err.type === "peer-unavailable") {
      msg = "This channel is no longer active or entry has been closed.";
    } else if (err.type === "request-timeout") {
      msg = "Connection timed out. The channel may no longer be active, or the peer may be behind a restrictive firewall.";
    } else {
      msg = "Failed to connect: " + (err.message || "Network error. The peer may be behind a restrictive firewall.");
    }

    ui.showError(msg);
  }
}

// ── Network Event Handlers ─────────────────────────────────────
function setupNetworkHandlers() {
  network.setHandlers({
    connectionReady: onConnectionReady,
    data: onData,
    close: onPeerDisconnect,
    error: onNetworkError,
  });
}

function onConnectionReady(peerId) {
  // Send key exchange to the specific peer
  network.sendTo(peerId, {
    type: "key_exchange",
    codename: selfCodename,
    publicKey: crypto.getPublicKey(),
  });
}

async function onData(data, peerId) {
  if (!data || !data.type) return;

  switch (data.type) {
    case "key_exchange":
      await handleKeyExchange(data, peerId);
      break;
    case "chat":
      await handleChatMessage(data, peerId);
      break;
    case "file":
      await handleFileMessage(data, peerId);
      break;
    case "close":
      if (!isFromCreator(peerId)) break;
      handleRemoteClose(peerId);
      break;
    case "clear":
      ui.clearMessages();
      ui.appendMessage("system", "Chat log cleared by peer.");
      break;
    case "ping":
      network.sendTo(peerId, { type: "pong", timestamp: data.timestamp });
      break;
    case "pong":
      handlePong(data, peerId);
      break;
    case "peer_list":
      if (!isFromCreator(peerId)) break;
      await handlePeerList(data);
      break;
    case "peer_joined":
      if (!isFromCreator(peerId)) break;
      await handlePeerJoined(data);
      break;
    case "peer_left":
      if (!isFromCreator(peerId)) break;
      handlePeerLeft(data);
      break;
    case "entry_closed":
      if (!isFromCreator(peerId)) break;
      handleEntryClosed();
      break;
    case "entry_opened":
      if (!isFromCreator(peerId)) break;
      handleEntryOpened();
      break;
    case "leave":
      handlePeerLeave(data, peerId);
      break;
  }
}

async function handleKeyExchange(data, peerId) {
  try {
    // Validate codename is a reasonable string
    if (typeof data.codename !== "string" || data.codename.length === 0 || data.codename.length > 100) {
      throw new Error("Invalid codename received");
    }
    if (typeof data.publicKey !== "string" || !data.publicKey.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
      throw new Error("Invalid public key format");
    }

    // Idempotent: skip if we already have this peer fully set up
    if (peers.has(peerId) && peers.get(peerId).connected) return;

    const isNewPeer = !peers.has(peerId);
    peers.set(peerId, { codename: data.codename, connected: true });
    await crypto.importPeerKey(peerId, data.publicKey);

    // If creator and this is a new peer, send peer_list to new joiner and broadcast peer_joined to existing peers
    if (isCreator && isNewPeer) {
      // Send peer_list to the new joiner (all existing peers except the new one)
      const peerList = [];
      for (const [pid, pinfo] of peers) {
        if (pid !== peerId && pinfo.connected) {
          peerList.push({
            peerId: pid,
            codename: pinfo.codename,
            publicKey: crypto.getPeerArmoredKey(pid),
          });
        }
      }
      if (peerList.length > 0) {
        network.sendTo(peerId, { type: "peer_list", peers: peerList });
      }

      // Broadcast peer_joined to existing peers (exclude the new joiner)
      network.broadcast({
        type: "peer_joined",
        peerId: peerId,
        codename: data.codename,
        publicKey: data.publicKey,
      }, peerId);
    }

    // Transition to chat on first key exchange
    if (state !== "chat") {
      sessionStartTime = Date.now();
      refreshStatusBar();
      ui.setConnectionStatus(true);
      transition("chat");
      if (isCreator) ui.setEntryClickable(true);
      ui.appendMessage("crypto", "Key exchange complete. E2E encryption active.");
      ui.setInputEnabled(true);
      window.addEventListener("beforeunload", beforeUnloadHandler);
    } else {
      // Already in chat — just update the status bar
      refreshStatusBar();
    }

    if (isNewPeer) {
      ui.appendMessage("system", `${data.codename} has joined the channel.`);
    }
  } catch (err) {
    ui.appendMessage("error", "Key exchange failed: " + err.message);
  }
}

async function handleChatMessage(data, peerId) {
  try {
    const senderPeerId = peerId || data.senderPeerId;
    const { text, verified } = await crypto.decryptMessage(data.payload, senderPeerId);
    const senderInfo = senderPeerId ? peers.get(senderPeerId) : null;
    const senderName = senderInfo ? senderInfo.codename : "Unknown";
    ui.appendMessage("peer", text, senderName, { unverified: !verified });
    if (!verified) {
      ui.appendMessage("error", "WARNING: Signature verification failed for the above message. It may have been tampered with or sent by an impersonator.");
    }
  } catch (err) {
    ui.appendMessage("error", "Failed to decrypt message: " + err.message);
  }
}

// ── File Transfer ───────────────────────────────────────────────
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      // dataURL format: "data:<mime>;base64,<data>"
      const base64 = reader.result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

async function sendFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    ui.appendMessage("error", `File too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Maximum is 2 MB.`);
    return;
  }

  try {
    const base64Data = await readFileAsBase64(file);
    const metadata = {
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      fileSize: file.size,
      data: base64Data,
    };

    const encrypted = await crypto.encryptMessage(JSON.stringify(metadata));
    network.send({ type: "file", payload: encrypted, senderPeerId: network.getMyPeerId() });

    ui.appendFileMessage("self", metadata, selfCodename);
  } catch (err) {
    ui.appendMessage("error", "Failed to send file: " + err.message);
  }
}

async function handleFileMessage(data, peerId) {
  try {
    const senderPeerId = peerId || data.senderPeerId;
    const { text, verified } = await crypto.decryptMessage(data.payload, senderPeerId);
    const metadata = JSON.parse(text);

    // Validate file metadata
    if (typeof metadata.data !== "string" || metadata.data.length === 0) {
      ui.appendMessage("error", "Rejected file: missing or invalid file data.");
      return;
    }
    if (metadata.data.length > MAX_FILE_SIZE * 1.37) {
      ui.appendMessage("error", "Rejected file: exceeds maximum allowed size (2 MB).");
      return;
    }
    if (typeof metadata.fileName !== "string" || metadata.fileName.length === 0 || metadata.fileName.length > 255) {
      ui.appendMessage("error", "Rejected file: invalid file name.");
      return;
    }

    const senderInfo = senderPeerId ? peers.get(senderPeerId) : null;
    const senderName = senderInfo ? senderInfo.codename : "Unknown";
    ui.appendFileMessage("peer", metadata, senderName, { unverified: !verified });
    if (!verified) {
      ui.appendMessage("error", "WARNING: Signature verification failed for the above file. It may have been tampered with or sent by an impersonator.");
    }
  } catch (err) {
    ui.appendMessage("error", "Failed to decrypt file: " + err.message);
  }
}

async function handlePeerList(data) {
  if (!data.peers || !Array.isArray(data.peers)) return;
  for (const p of data.peers) {
    if (!peers.has(p.peerId)) {
      peers.set(p.peerId, { codename: p.codename, connected: false });
    }
    if (!crypto.hasPeerKey(p.peerId)) {
      await crypto.importPeerKey(p.peerId, p.publicKey);
    }
    // Initiate mesh connection to each existing peer
    network.connectToPeer(p.peerId);
  }
}

async function handlePeerJoined(data) {
  // Pre-import the new peer's key so we're ready when they connect to us
  if (!peers.has(data.peerId)) {
    peers.set(data.peerId, { codename: data.codename, connected: false });
  }
  if (!crypto.hasPeerKey(data.peerId)) {
    await crypto.importPeerKey(data.peerId, data.publicKey);
  }
}

function handlePeerLeft(data) {
  const peerInfo = peers.get(data.peerId);
  const name = peerInfo ? peerInfo.codename : data.codename;
  peers.delete(data.peerId);
  crypto.removePeerKey(data.peerId);
  refreshStatusBar();
  ui.appendMessage("system", `${name} has left the channel.`);
}

function handleEntryClosed() {
  entryOpen = false;
  network.closeEntry();
  ui.setEntryStatus(false);
  ui.appendMessage("system", "Entry has been closed. No new peers can join.");
}

function handleEntryOpened() {
  entryOpen = true;
  network.openEntry();
  ui.setEntryStatus(true);
  ui.appendMessage("system", "Entry has been reopened. New peers can join.");
}

function handlePeerLeave(data, peerId) {
  if (state !== "chat") return;
  const peerInfo = peers.get(peerId);
  const name = peerInfo ? peerInfo.codename : data.codename || "Peer";
  peers.delete(peerId);
  crypto.removePeerKey(peerId);
  refreshStatusBar();
  ui.appendMessage("system", `${name} left the channel.`);

  if (isCreator) {
    network.broadcast({ type: "peer_left", peerId, codename: name });
  }

  if (peers.size === 0 && !isCreator) {
    ui.setInputEnabled(false);
    ui.setConnectionStatus(false);
    setTimeout(() => destroySession(), 1500);
  } else if (peers.size === 0 && isCreator) {
    ui.setConnectionStatus(false);
  }
}

function handleRemoteClose(peerId) {
  const peerInfo = peers.get(peerId);
  const name = peerInfo ? peerInfo.codename : "Peer";
  ui.appendMessage("system", `${name} closed the channel.`);
  ui.setInputEnabled(false);
  ui.setConnectionStatus(false);
  setTimeout(() => destroySession(), 1500);
}

function onPeerDisconnect(peerId) {
  if (state !== "chat") return;

  const peerInfo = peers.get(peerId);
  const name = peerInfo ? peerInfo.codename : "Peer";
  peers.delete(peerId);
  crypto.removePeerKey(peerId);
  refreshStatusBar();
  ui.appendMessage("system", `${name} disconnected.`);

  // Creator broadcasts peer_left to remaining peers
  if (isCreator) {
    network.broadcast({ type: "peer_left", peerId, codename: name });
  }

  // If no peers remain and not the creator, destroy the session
  if (peers.size === 0 && !isCreator) {
    ui.setInputEnabled(false);
    ui.setConnectionStatus(false);
    setTimeout(() => destroySession(), 1500);
  } else if (peers.size === 0 && isCreator) {
    ui.setConnectionStatus(false);
  }
}

function handlePong(data, peerId) {
  const pingTs = pendingPings.get(peerId);
  if (pingTs && data.timestamp === pingTs) {
    const rtt = Date.now() - pingTs;
    const peerInfo = peers.get(peerId);
    const name = peerInfo ? peerInfo.codename : peerId;
    ui.appendMessage("system", `Pong from ${name}: ${rtt}ms RTT`);
    pendingPings.delete(peerId);
  }
}

function onNetworkError(err) {
  if (state === "chat") {
    ui.appendMessage("error", "Connection error: " + err.message);
  }
}

// ── Chat Actions ───────────────────────────────────────────────
async function sendMessage(text) {
  if (!text.trim()) return;

  const trimmed = text.trim();

  // Route slash commands through dispatcher
  if (trimmed.startsWith("/")) {
    handleCommand(trimmed);
    return;
  }

  try {
    const encrypted = await crypto.encryptMessage(text);
    network.send({ type: "chat", payload: encrypted, senderPeerId: network.getMyPeerId() });
    ui.appendMessage("self", text, selfCodename);
  } catch (err) {
    ui.appendMessage("error", "Failed to encrypt message: " + err.message);
  }
}

// ── Command Dispatcher ──────────────────────────────────────────
const commands = {
  "/help": cmdHelp,
  "/close": cmdClose,
  "/clear": cmdClear,
  "/whoami": cmdWhoami,
  "/status": cmdStatus,
  "/ping": cmdPing,
  "/close_entry": cmdCloseEntry,
  "/open_entry": cmdOpenEntry,
};

function handleCommand(input) {
  const cmd = input.toLowerCase().split(/\s+/)[0];
  const handler = commands[cmd];
  if (handler) {
    handler();
  } else {
    ui.appendMessage("system", `Unknown command: ${cmd}. Type /help for a list of commands.`);
  }
}

function cmdHelp() {
  const lines = [
    "Available commands:",
    "  /help        — Show this help message",
    "  /close       — Destroy the channel and end the session",
    "  /close_entry — Lock the room (creator only) — no new peers can join",
    "  /open_entry  — Reopen the room (creator only) — allow new peers to join",
    "  /clear       — Clear the message log",
    "  /whoami      — Show your codename, role, and key fingerprint",
    "  /status      — Show session info (peers, uptime, encryption)",
    "  /ping        — Measure round-trip time to all peers",
    "",
    "File sharing:",
    "  [+] button   — Attach and send a file (max 2 MB)",
    "  Drag & drop  — Drop a file onto the message log to send",
  ];
  ui.appendMessage("system", lines.join("\n"));
}

function cmdClose() {
  network.broadcast({ type: "close" });
  ui.appendMessage("system", "You closed the channel.");
  ui.setInputEnabled(false);
  setTimeout(() => destroySession(), 500);
}

function cmdClear() {
  ui.clearMessages();
  network.send({ type: "clear" });
}

function cmdWhoami() {
  const role = isCreator ? "creator" : "joiner";
  const fingerprint = crypto.getFingerprint() || "unavailable";
  const short = fingerprint.length > 16 ? fingerprint.slice(-16) : fingerprint;
  const lines = [
    `Codename: ${selfCodename}`,
    `Role: ${role}`,
    `Key fingerprint: ${short}`,
  ];
  ui.appendMessage("system", lines.join("\n"));
}

function cmdStatus() {
  const peerNames = getPeerNames();
  const peerDisplay = peerNames.length > 0 ? peerNames.join(", ") : "no peers connected";
  let uptime = "unknown";
  if (sessionStartTime) {
    const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    uptime = `${mins}m ${secs}s`;
  }
  const lines = [
    `Peers (${peerNames.length}): ${peerDisplay}`,
    `Entry: ${entryOpen ? "open" : "closed"}`,
    `Uptime: ${uptime}`,
    `Encryption: OpenPGP (ECC curve25519)`,
  ];
  ui.appendMessage("system", lines.join("\n"));
}

function cmdPing() {
  if (!network.isConnected()) {
    ui.appendMessage("system", "Not connected to any peers.");
    return;
  }
  const now = Date.now();
  for (const [peerId] of peers) {
    pendingPings.set(peerId, now);
    network.sendTo(peerId, { type: "ping", timestamp: now });
  }
  ui.appendMessage("system", "Ping sent to all peers...");
}

function cmdCloseEntry() {
  if (!isCreator) {
    ui.appendMessage("system", "Only the channel creator can close entry.");
    return;
  }
  if (!entryOpen) {
    ui.appendMessage("system", "Entry is already closed.");
    return;
  }
  entryOpen = false;
  network.closeEntry();
  ui.setEntryStatus(false);
  network.broadcast({ type: "entry_closed" });
  ui.appendMessage("system", "Entry closed. No new peers can join this channel.");
}

function cmdOpenEntry() {
  if (!isCreator) {
    ui.appendMessage("system", "Only the channel creator can open entry.");
    return;
  }
  if (entryOpen) {
    ui.appendMessage("system", "Entry is already open.");
    return;
  }
  entryOpen = true;
  network.openEntry();
  ui.setEntryStatus(true);
  network.broadcast({ type: "entry_opened" });
  ui.appendMessage("system", "Entry reopened. New peers can join this channel.");
}

// ── Session Cleanup ────────────────────────────────────────────
function destroySession() {
  if (state === "destroyed") return; // Guard against double-destroy

  window.removeEventListener("beforeunload", beforeUnloadHandler);
  network.destroy();
  crypto.purgeKeys();
  ui.purgeMessages();
  ui.setInputEnabled(false);

  selfCodename = null;
  peers.clear();
  channelId = null;
  shareLink = null;
  sessionStartTime = null;
  pendingPings.clear();
  entryOpen = true;

  transition("destroyed");
}

function cancelWaiting() {
  network.destroy();
  crypto.purgeKeys();
  selfCodename = null;
  channelId = null;
  shareLink = null;
  transition("landing");
}

function returnToLanding() {
  transition("landing");
}

function beforeUnloadHandler(e) {
  // Notify peers before the tab closes
  try {
    network.broadcast({ type: "leave", codename: selfCodename });
  } catch {}
  e.preventDefault();
  e.returnValue = "";
}

// ── Event Wiring ───────────────────────────────────────────────
function init() {
  const els = ui.getElements();

  // ── Landing panel navigation ─────────────────────────────────
  els.btnCreate.addEventListener("click", () => ui.showCreatePanel());
  els.btnJoinShow.addEventListener("click", () => ui.showJoinPanel());
  els.btnBackCreate.addEventListener("click", () => ui.showLandingButtons());
  els.btnBackJoin.addEventListener("click", () => ui.showLandingButtons());

  // ── Create channel confirm ─────────────────────────────────
  els.btnCreateConfirm.addEventListener("click", () => {
    ui.hideLandingError();
    if (els.chkRandom.checked) {
      createChannel();
    } else {
      const raw = ui.getCreateCode();
      const normalized = normalizeRoomCode(raw);
      if (!normalized) {
        ui.showLandingError("Invalid words. Enter 4 words from the word list.");
        return;
      }
      createChannel(normalized);
    }
  });

  // ── Random toggle for create panel ─────────────────────────
  els.chkRandom.addEventListener("change", () => {
    const random = els.chkRandom.checked;
    els.createWords.forEach(el => { el.disabled = random; });
    els.createWordsWrap.classList.toggle("create-inputs-disabled", random);
    if (random) {
      els.createWords.forEach(el => { el.value = ""; });
    } else {
      els.createWords[0].focus();
    }
  });

  // ── Join channel handler ───────────────────────────────────
  function handleJoinInput() {
    ui.hideLandingError();
    const raw = ui.getJoinCode();
    const normalized = normalizeRoomCode(raw);
    if (!normalized) {
      ui.showLandingError("Invalid room code. Enter 4 words (e.g. bold echo fern grid).");
      return;
    }
    ui.clearJoinInputs();
    joinChannel(normalized);
  }

  els.btnJoin.addEventListener("click", handleJoinInput);

  // ── Wire up word inputs: paste spreading, auto-advance ─────
  function wireWordInputs(inputs, onEnter) {
    inputs.forEach((input, idx) => {
      input.addEventListener("paste", (e) => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData).getData("text");
        const words = text.trim().split(/[\s\-]+/).filter(Boolean);
        for (let i = 0; i < words.length && idx + i < 4; i++) {
          inputs[idx + i].value = words[i];
        }
        const nextEmpty = inputs.findIndex(el => !el.value.trim());
        if (nextEmpty !== -1) {
          inputs[nextEmpty].focus();
        } else {
          inputs[3].focus();
        }
      });

      input.addEventListener("keydown", (e) => {
        if (e.key === " " || e.key === "-") {
          e.preventDefault();
          if (idx < 3) inputs[idx + 1].focus();
        }
        if (e.key === "Enter") {
          e.preventDefault();
          onEnter();
        }
        if (e.key === "Backspace" && !input.value && idx > 0) {
          inputs[idx - 1].focus();
        }
      });
    });
  }

  wireWordInputs(els.joinWords, handleJoinInput);
  wireWordInputs(els.createWords, () => els.btnCreateConfirm.click());

  els.btnCopyCode.addEventListener("click", () => {
    if (channelId) ui.copyToClipboard(channelId.replace(/-/g, " "), els.btnCopyCode, "[ COPY CODE ]");
  });

  els.btnCopyLink.addEventListener("click", () => {
    if (shareLink) ui.copyToClipboard(shareLink, els.btnCopyLink, "[ COPY LINK ]");
  });

  els.btnCancel.addEventListener("click", cancelWaiting);

  els.btnReturn.addEventListener("click", returnToLanding);

  els.btnErrorReturn.addEventListener("click", returnToLanding);

  els.chatInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      const text = ui.getInputValue();
      if (text.trim()) {
        sendMessage(text);
        ui.clearInput();
      }
    }
  });

  // ── File input + attach button wiring ──────────────────────
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.style.display = "none";
  document.body.appendChild(fileInput);

  fileInput.addEventListener("change", () => {
    if (fileInput.files.length > 0) {
      sendFile(fileInput.files[0]);
      fileInput.value = "";
    }
  });

  els.btnAttach.addEventListener("click", () => {
    fileInput.click();
  });

  // ── Drag-and-drop on message log ──────────────────────────
  els.messageLog.addEventListener("dragover", (e) => {
    e.preventDefault();
    els.messageLog.classList.add("drag-over");
  });

  els.messageLog.addEventListener("dragleave", () => {
    els.messageLog.classList.remove("drag-over");
  });

  els.messageLog.addEventListener("drop", (e) => {
    e.preventDefault();
    els.messageLog.classList.remove("drag-over");
    if (state === "chat" && e.dataTransfer.files.length > 0) {
      sendFile(e.dataTransfer.files[0]);
    }
  });

  // ── Entry toggle via status bar click ───────────────────────
  let entryToggleCooldown = false;
  els.statusEntry.addEventListener("click", () => {
    if (!isCreator || entryToggleCooldown) return;
    if (entryOpen) {
      cmdCloseEntry();
    } else {
      cmdOpenEntry();
    }
    entryToggleCooldown = true;
    els.statusEntry.classList.add("cooldown");
    setTimeout(() => {
      entryToggleCooldown = false;
      els.statusEntry.classList.remove("cooldown");
    }, 1500);
  });

  // Check for join link in URL hash
  const joinId = parseChannelFromHash();
  if (joinId) {
    ui.showJoinPanel();
    joinChannel(joinId);
  }

  // Handle hash change (e.g., user pastes join link into an already-open tab)
  window.addEventListener("hashchange", () => {
    const id = parseChannelFromHash();
    if (id && state === "landing") {
      ui.showJoinPanel();
      joinChannel(id);
    }
  });
}

init();
