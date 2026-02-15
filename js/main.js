import { generateChannelId, parseChannelFromHash, clearHash, buildShareLink } from "./utils.js";
import { generateCodename } from "./words.js";
import * as ui from "./ui.js";
import * as crypto from "./crypto.js";
import * as network from "./network.js";

// ── Session State ──────────────────────────────────────────────
let state = "landing"; // landing | waiting | chat | destroyed | error
let selfCodename = null;
let peerCodename = null;
let channelId = null;
let shareLink = null;
let isCreator = false;
let sessionStartTime = null;
let pendingPingTimestamp = null;

// ── State Machine ──────────────────────────────────────────────
function transition(newState) {
  state = newState;
  ui.showScreen(newState);
}

// ── Creator Flow ───────────────────────────────────────────────
async function createChannel() {
  try {
    ui.hideLandingError();
    const els = ui.getElements();
    els.btnCreate.disabled = true;
    els.btnCreate.textContent = "GENERATING KEYS...";

    // Generate everything in parallel
    channelId = generateChannelId();
    selfCodename = generateCodename();
    const [pubKey] = await Promise.all([crypto.generateKeypair()]);

    shareLink = buildShareLink(channelId);
    isCreator = true;

    // Setup network handlers before creating channel
    setupNetworkHandlers();

    await network.createChannel(channelId);

    // Show waiting screen
    ui.showSelfCodename(selfCodename);
    ui.showShareLink(shareLink);
    transition("waiting");

    els.btnCreate.disabled = false;
    els.btnCreate.textContent = "CREATE SECURE CHANNEL";
  } catch (err) {
    const els = ui.getElements();
    els.btnCreate.disabled = false;
    els.btnCreate.textContent = "CREATE SECURE CHANNEL";
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

    // Show a brief loading state on landing
    const els = ui.getElements();
    els.btnCreate.disabled = true;
    els.btnCreate.textContent = "CONNECTING...";

    await crypto.generateKeypair();

    setupNetworkHandlers();

    await network.joinChannel(channelId);

    els.btnCreate.disabled = false;
    els.btnCreate.textContent = "CREATE SECURE CHANNEL";
  } catch (err) {
    const els = ui.getElements();
    els.btnCreate.disabled = false;
    els.btnCreate.textContent = "CREATE SECURE CHANNEL";

    const msg = err.type === "peer-unavailable"
      ? "This channel link has already been used or has expired. Each link can only be used once."
      : "Failed to connect: " + (err.message || "Network error. The peer may be behind a restrictive firewall.");

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

function onConnectionReady() {
  // Send key exchange immediately
  network.send({
    type: "key_exchange",
    codename: selfCodename,
    publicKey: crypto.getPublicKey(),
  });
}

async function onData(data) {
  if (!data || !data.type) return;

  switch (data.type) {
    case "key_exchange":
      await handleKeyExchange(data);
      break;
    case "chat":
      await handleChatMessage(data);
      break;
    case "close":
      handleRemoteClose();
      break;
    case "clear":
      ui.clearMessages();
      ui.appendMessage("system", "Chat log cleared by peer.");
      break;
    case "ping":
      network.send({ type: "pong", timestamp: data.timestamp });
      break;
    case "pong":
      if (pendingPingTimestamp && data.timestamp === pendingPingTimestamp) {
        const rtt = Date.now() - pendingPingTimestamp;
        ui.appendMessage("system", `Pong from ${peerCodename || "peer"}: ${rtt}ms RTT`);
        pendingPingTimestamp = null;
      }
      break;
  }
}

async function handleKeyExchange(data) {
  try {
    // Reject key exchange if already completed (prevents mid-session key swap)
    if (state === "chat") return;

    // Validate codename is a reasonable string
    if (typeof data.codename !== "string" || data.codename.length === 0 || data.codename.length > 100) {
      throw new Error("Invalid codename received");
    }
    if (typeof data.publicKey !== "string" || !data.publicKey.startsWith("-----BEGIN PGP PUBLIC KEY BLOCK-----")) {
      throw new Error("Invalid public key format");
    }

    peerCodename = data.codename;
    await crypto.importPeerKey(data.publicKey);

    // Transition to chat
    sessionStartTime = Date.now();
    ui.updateStatusBar(selfCodename, peerCodename);
    ui.setConnectionStatus(true);
    transition("chat");

    ui.appendMessage("crypto", "Key exchange complete. E2E encryption active.");
    ui.appendMessage("system", `${peerCodename} has joined the channel.`);
    ui.setInputEnabled(true);

    // Enable beforeunload warning
    window.addEventListener("beforeunload", beforeUnloadHandler);
  } catch (err) {
    ui.appendMessage("error", "Key exchange failed: " + err.message);
  }
}

async function handleChatMessage(data) {
  try {
    const plaintext = await crypto.decryptMessage(data.payload);
    ui.appendMessage("peer", plaintext, peerCodename);
  } catch (err) {
    ui.appendMessage("error", "Failed to decrypt message: " + err.message);
  }
}

function handleRemoteClose() {
  ui.appendMessage("system", `${peerCodename || "Peer"} closed the channel.`);
  ui.setInputEnabled(false);
  ui.setConnectionStatus(false);
  setTimeout(() => destroySession(), 1500);
}

function onPeerDisconnect() {
  if (state === "chat") {
    ui.appendMessage("system", `${peerCodename || "Peer"} disconnected.`);
    ui.setInputEnabled(false);
    ui.setConnectionStatus(false);
    setTimeout(() => destroySession(), 1500);
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
    network.send({ type: "chat", payload: encrypted });
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
    "  /help   — Show this help message",
    "  /close  — Destroy the channel and end the session",
    "  /clear  — Clear the message log",
    "  /whoami — Show your codename, role, and key fingerprint",
    "  /status — Show session info (peer, uptime, encryption)",
    "  /ping   — Measure round-trip time to peer",
  ];
  ui.appendMessage("system", lines.join("\n"));
}

function cmdClose() {
  network.send({ type: "close" });
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
  const peer = peerCodename || "not connected";
  let uptime = "unknown";
  if (sessionStartTime) {
    const elapsed = Math.floor((Date.now() - sessionStartTime) / 1000);
    const mins = Math.floor(elapsed / 60);
    const secs = elapsed % 60;
    uptime = `${mins}m ${secs}s`;
  }
  const lines = [
    `Peer: ${peer}`,
    `Uptime: ${uptime}`,
    `Encryption: OpenPGP (ECC curve25519)`,
  ];
  ui.appendMessage("system", lines.join("\n"));
}

function cmdPing() {
  if (!network.isConnected()) {
    ui.appendMessage("system", "Not connected to a peer.");
    return;
  }
  pendingPingTimestamp = Date.now();
  network.send({ type: "ping", timestamp: pendingPingTimestamp });
  ui.appendMessage("system", "Ping sent...");
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
  peerCodename = null;
  channelId = null;
  shareLink = null;
  sessionStartTime = null;
  pendingPingTimestamp = null;

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
  e.preventDefault();
  e.returnValue = "";
}

// ── Event Wiring ───────────────────────────────────────────────
function init() {
  const els = ui.getElements();

  els.btnCreate.addEventListener("click", createChannel);

  els.btnCopy.addEventListener("click", () => {
    if (shareLink) ui.copyToClipboard(shareLink);
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

  // Check for join link in URL hash
  const joinId = parseChannelFromHash();
  if (joinId) {
    joinChannel(joinId);
  }

  // Handle hash change (e.g., user pastes join link into an already-open tab)
  window.addEventListener("hashchange", () => {
    const id = parseChannelFromHash();
    if (id && state === "landing") {
      joinChannel(id);
    }
  });
}

init();
