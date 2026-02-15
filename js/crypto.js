import * as openpgp from "openpgp";

let privateKey = null;
let publicKeyArmored = null;
let peerPublicKey = null;

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
 * Import the peer's armored public key for encrypting messages to them.
 * @param {string} armoredKey
 */
export async function importPeerKey(armoredKey) {
  peerPublicKey = await openpgp.readKey({ armoredKey });
}

/**
 * Encrypt and sign a message for the peer.
 * @param {string} text plaintext message
 * @returns {Promise<string>} armored PGP message
 */
export async function encryptMessage(text) {
  const message = await openpgp.createMessage({ text });
  const encrypted = await openpgp.encrypt({
    message,
    encryptionKeys: peerPublicKey,
    signingKeys: privateKey,
  });
  return encrypted;
}

/**
 * Decrypt and verify a message from the peer.
 * @param {string} armored armored PGP message
 * @returns {Promise<string>} decrypted plaintext
 */
export async function decryptMessage(armored) {
  const message = await openpgp.readMessage({ armoredMessage: armored });
  const { data: decrypted, signatures } = await openpgp.decrypt({
    message,
    decryptionKeys: privateKey,
    verificationKeys: peerPublicKey,
  });

  // Verify signature
  try {
    await signatures[0].verified;
  } catch {
    throw new Error("Signature verification failed");
  }

  return decrypted;
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
  peerPublicKey = null;
}
