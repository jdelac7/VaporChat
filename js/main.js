import { generateChannelId, parseChannelFromHash, clearHash, buildShareLink } from "./utils.js";
import { generateCodename } from "./words.js";
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

// ── State Machine ──────────────────────────────────────────────
function transition(newState) {
  state = newState;
  ui.showScreen(newState);
}

// ── Helper: get all peer codenames ─────────────────────────────
function getPeerNames() {
  return Array.from(peers.values()).map(p => p.codename);
}

function refreshStatusBar() {
  ui.updateStatusBar(selfCodename, getPeerNames());
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
    case "close":
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
      await handlePeerList(data);
      break;
    case "peer_joined":
      await handlePeerJoined(data);
      break;
    case "peer_left":
      handlePeerLeft(data);
      break;
    case "entry_closed":
      handleEntryClosed();
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
    ui.appendMessage("peer", text, senderName);
    if (!verified) {
      ui.appendMessage("crypto", "Signature could not be verified for the above message.");
    }
  } catch (err) {
    ui.appendMessage("error", "Failed to decrypt message: " + err.message);
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
  ui.appendMessage("system", "Entry has been closed. No new peers can join.");
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
    "  /clear       — Clear the message log",
    "  /whoami      — Show your codename, role, and key fingerprint",
    "  /status      — Show session info (peers, uptime, encryption)",
    "  /ping        — Measure round-trip time to all peers",
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
  network.broadcast({ type: "entry_closed" });
  ui.appendMessage("system", "Entry closed. No new peers can join this channel.");
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
