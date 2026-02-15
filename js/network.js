import { Peer } from "peerjs";

const CHANNEL_PREFIX = "vaporchat-";

let peer = null;
let conn = null;
let linkBurned = false;

/** @type {function|null} */ let onConnectionReady = null;
/** @type {function|null} */ let onData = null;
/** @type {function|null} */ let onClose = null;
/** @type {function|null} */ let onError = null;

/**
 * Set event handlers for network events.
 */
export function setHandlers({ connectionReady, data, close, error }) {
  onConnectionReady = connectionReady || null;
  onData = data || null;
  onClose = close || null;
  onError = error || null;
}

/**
 * Create a channel (creator flow).
 * Registers as a PeerJS peer with the channel ID and waits for a connection.
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export function createChannel(channelId) {
  return new Promise((resolve, reject) => {
    const peerId = CHANNEL_PREFIX + channelId;
    peer = new Peer(peerId);

    peer.on("open", () => {
      resolve();
    });

    peer.on("connection", (dataConn) => {
      if (linkBurned) {
        // Reject subsequent connections
        dataConn.close();
        return;
      }

      // Burn the link: accept first connection only
      linkBurned = true;
      conn = dataConn;

      // Wait for the data channel to actually be open before wiring handlers
      conn.on("open", () => {
        setupConnection(conn);
        // Disconnect from signaling server to prevent further discovery
        peer.disconnect();
      });
    });

    peer.on("error", (err) => {
      if (onError) onError(err);
      reject(err);
    });

    peer.on("disconnected", () => {
      // Expected after link burning — do not reconnect
    });
  });
}

/**
 * Join a channel (joiner flow).
 * Connects to the creator's peer.
 * @param {string} channelId
 * @returns {Promise<void>}
 */
export function joinChannel(channelId) {
  return new Promise((resolve, reject) => {
    const peerId = CHANNEL_PREFIX + channelId;
    peer = new Peer();

    peer.on("open", () => {
      conn = peer.connect(peerId, { reliable: true });

      conn.on("open", () => {
        // Disconnect joiner from signaling server too
        peer.disconnect();
        setupConnection(conn);
        resolve();
      });

      conn.on("error", (err) => {
        if (onError) onError(err);
        reject(err);
      });
    });

    peer.on("error", (err) => {
      if (onError) onError(err);
      reject(err);
    });
  });
}

/**
 * Wire up data/close handlers on an established connection.
 */
function setupConnection(connection) {
  connection.on("data", (data) => {
    if (onData) onData(data);
  });

  connection.on("close", () => {
    if (onClose) onClose();
  });

  connection.on("error", (err) => {
    if (onError) onError(err);
  });

  if (onConnectionReady) onConnectionReady();
}

/**
 * Send data over the connection.
 * @param {object} data
 */
export function send(data) {
  if (conn && conn.open) {
    conn.send(data);
  }
}

/**
 * Close the connection and destroy the peer.
 */
export function destroy() {
  if (conn) {
    try { conn.close(); } catch {}
  }
  if (peer) {
    try { peer.destroy(); } catch {}
  }
  conn = null;
  peer = null;
  linkBurned = false;
}

/**
 * Check if the connection is currently open.
 * @returns {boolean}
 */
export function isConnected() {
  return conn !== null && conn.open;
}
