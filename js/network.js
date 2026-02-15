import { Peer } from "peerjs";

const CHANNEL_PREFIX = "vaporchat-";
const JOIN_TIMEOUT_MS = 20000;

const PEER_CONFIG = {
  config: {
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
      { urls: "stun:stun2.l.google.com:19302" },
      { urls: "stun:stun.services.mozilla.com" },
    ],
  },
};

let peer = null;
let conns = new Map(); // peerId → DataConnection
let entryOpen = true;
let myPeerId = null;

/** @type {function|null} */ let onConnectionReady = null;
/** @type {function|null} */ let onData = null;
/** @type {function|null} */ let onClose = null;
/** @type {function|null} */ let onError = null;

/**
 * Set event handlers for network events.
 * Callbacks receive peerId: connectionReady(peerId), data(data, peerId), close(peerId)
 */
export function setHandlers({ connectionReady, data, close, error }) {
  onConnectionReady = connectionReady || null;
  onData = data || null;
  onClose = close || null;
  onError = error || null;
}

/**
 * Create a channel (creator flow).
 * Registers as a PeerJS peer with the channel ID and accepts multiple connections.
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export function createChannel(channelId) {
  return new Promise((resolve, reject) => {
    const peerId = CHANNEL_PREFIX + channelId;
    peer = new Peer(peerId, PEER_CONFIG);

    peer.on("open", (id) => {
      myPeerId = id;
      resolve();
    });

    peer.on("connection", (dataConn) => {
      if (!entryOpen) {
        dataConn.close();
        return;
      }

      dataConn.on("open", () => {
        const remotePeerId = dataConn.peer;
        conns.set(remotePeerId, dataConn);
        setupConnection(dataConn, remotePeerId);
      });
    });

    peer.on("error", (err) => {
      if (onError) onError(err);
      reject(err);
    });

    peer.on("disconnected", () => {
      if (entryOpen && peer && !peer.destroyed) {
        peer.reconnect();
      }
    });
  });
}

/**
 * Join a channel (joiner flow).
 * Connects to the creator's peer. Stays on signaling server for mesh connections.
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export function joinChannel(channelId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const creatorPeerId = CHANNEL_PREFIX + channelId;
    peer = new Peer(undefined, PEER_CONFIG);

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        const err = new Error("Connection timed out. The channel may no longer be active.");
        err.type = "request-timeout";
        if (onError) onError(err);
        reject(err);
      }
    }, JOIN_TIMEOUT_MS);

    peer.on("open", (id) => {
      myPeerId = id;
      const dataConn = peer.connect(creatorPeerId, { reliable: true, serialization: "json" });

      dataConn.on("open", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        conns.set(creatorPeerId, dataConn);
        setupConnection(dataConn, creatorPeerId);
        resolve();
      });

      dataConn.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (onError) onError(err);
        reject(err);
      });
    });

    // Accept incoming mesh connections from other peers
    peer.on("connection", (dataConn) => {
      dataConn.on("open", () => {
        const remotePeerId = dataConn.peer;
        conns.set(remotePeerId, dataConn);
        setupConnection(dataConn, remotePeerId);
      });
    });

    peer.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (onError) onError(err);
      reject(err);
    });

    peer.on("disconnected", () => {
      if (entryOpen && peer && !peer.destroyed) {
        peer.reconnect();
      }
    });
  });
}

/**
 * Connect to another peer for mesh topology.
 * @param {string} remotePeerId
 */
export function connectToPeer(remotePeerId) {
  if (conns.has(remotePeerId) || !peer || peer.destroyed) return;
  const dataConn = peer.connect(remotePeerId, { reliable: true, serialization: "json" });
  dataConn.on("open", () => {
    conns.set(remotePeerId, dataConn);
    setupConnection(dataConn, remotePeerId);
  });
  dataConn.on("error", (err) => {
    if (onError) onError(err);
  });
}

/**
 * Wire up data/close handlers on an established connection.
 * @param {DataConnection} connection
 * @param {string} peerId
 */
function setupConnection(connection, peerId) {
  connection.on("data", (data) => {
    if (onData) onData(data, peerId);
  });

  connection.on("close", () => {
    conns.delete(peerId);
    if (onClose) onClose(peerId);
  });

  connection.on("error", (err) => {
    if (onError) onError(err);
  });

  if (onConnectionReady) onConnectionReady(peerId);
}

/**
 * Send data to a specific peer.
 * @param {string} peerId
 * @param {object} data
 */
export function sendTo(peerId, data) {
  const c = conns.get(peerId);
  if (c && c.open) {
    c.send(data);
  }
}

/**
 * Send data to all connected peers, optionally excluding one.
 * @param {object} data
 * @param {string} [excludePeerId]
 */
export function broadcast(data, excludePeerId) {
  for (const [peerId, c] of conns) {
    if (peerId !== excludePeerId && c.open) {
      c.send(data);
    }
  }
}

/**
 * Send data to all connected peers (alias for broadcast with no exclusion).
 * @param {object} data
 */
export function send(data) {
  broadcast(data);
}

/**
 * Close entry — no more new peers can join.
 * Disconnects from signaling server.
 */
export function closeEntry() {
  entryOpen = false;
  if (peer && !peer.destroyed && !peer.disconnected) {
    peer.disconnect();
  }
}

/**
 * Get this peer's PeerJS ID.
 * @returns {string|null}
 */
export function getMyPeerId() {
  return myPeerId;
}

/**
 * Close all connections and destroy the peer.
 */
export function destroy() {
  for (const [, c] of conns) {
    try { c.close(); } catch {}
  }
  conns.clear();
  if (peer) {
    try { peer.destroy(); } catch {}
  }
  peer = null;
  myPeerId = null;
  entryOpen = true;
}

/**
 * Check if any connection is currently open.
 * @returns {boolean}
 */
export function isConnected() {
  for (const [, c] of conns) {
    if (c.open) return true;
  }
  return false;
}
