import * as openpgp from "openpgp";

let privateKey = null;
let publicKeyArmored = null;
let peerKeys = new Map(); // peerId → { parsed, armored }

/**
 * Generate an ECC keypair (curve25519) for this session.
 * Keys exist only in memory — no passphrase, no persistence.
 * @returns {Promise<string>} armored public key
 */
export async function generateKeypair() {
  const { privateKey: privKey, publicKey: pubKey } = await openpgp.generateKey({
    type: "ecc",
    curve: "curve25519",
    userIDs: [{ name: "vaporchat-session" }],
    format: "armored",
  });

  privateKey = await openpgp.readPrivateKey({ armoredKey: privKey });
  publicKeyArmored = pubKey;
  return pubKey;
}

/**
 * Import a peer's armored public key for encrypting messages to them.
 * @param {string} peerId
 * @param {string} armoredKey
 */
export async function importPeerKey(peerId, armoredKey) {
  const parsed = await openpgp.readKey({ armoredKey });
  peerKeys.set(peerId, { parsed, armored: armoredKey });
}

/**
 * Remove a peer's key from the map.
 * @param {string} peerId
 */
export function removePeerKey(peerId) {
  peerKeys.delete(peerId);
}

/**
 * Get the armored public key for a specific peer.
 * @param {string} peerId
 * @returns {string|null}
 */
export function getPeerArmoredKey(peerId) {
  const entry = peerKeys.get(peerId);
  return entry ? entry.armored : null;
}

/**
 * Check if we have a key for a specific peer.
 * @param {string} peerId
 * @returns {boolean}
 */
export function hasPeerKey(peerId) {
  return peerKeys.has(peerId);
}

/**
 * Encrypt and sign a message for all peers.
 * @param {string} text plaintext message
 * @returns {Promise<string>} armored PGP message
 */
export async function encryptMessage(text) {
  const message = await openpgp.createMessage({ text });
  const encryptionKeys = Array.from(peerKeys.values()).map(e => e.parsed);
  const encrypted = await openpgp.encrypt({
    message,
    encryptionKeys,
    signingKeys: privateKey,
  });
  return encrypted;
}

/**
 * Decrypt and verify a message from a specific peer.
 * @param {string} armored armored PGP message
 * @param {string} senderPeerId the peer who sent the message
 * @returns {Promise<{text: string, verified: boolean}>} decrypted plaintext and signature status
 */
export async function decryptMessage(armored, senderPeerId) {
  const message = await openpgp.readMessage({ armoredMessage: armored });
  const senderEntry = senderPeerId ? peerKeys.get(senderPeerId) : null;
  const verificationKeys = senderEntry ? senderEntry.parsed : undefined;
  const { data: decrypted, signatures } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
    verificationKeys,
  });

  let verified = false;
  try {
    if (signatures.length > 0) {
      await signatures[0].verified;
      verified = true;
    }
  } catch {
    // Signature check failed — message was still decrypted successfully
  }

  return { text: decrypted, verified };
}

/**
 * Get the armored public key for this session.
 * @returns {string}
 */
export function getPublicKey() {
  return publicKeyArmored;
}

/**
 * Get the fingerprint of the local public key.
 * @returns {string|null} uppercase hex fingerprint, or null if no key
 */
export function getFingerprint() {
  if (!privateKey) return null;
  return privateKey.getFingerprint().toUpperCase();
}

/**
 * Purge all keys from memory.
 */
export function purgeKeys() {
  privateKey = null;
  publicKeyArmored = null;
  peerKeys.clear();
}
