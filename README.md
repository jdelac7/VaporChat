# VaporChat

Ephemeral, encrypted, peer-to-peer chat that runs entirely in the browser. No servers store messages, no accounts are required, and nothing survives a closed tab.

**Live at [vaporchat.org](https://vaporchat.org)**

## How It Works

1. A user creates a channel and shares the link
2. Peers join via the link and connect directly through WebRTC
3. Each session generates unique OpenPGP keys (ECC curve25519)
4. All messages and files are end-to-end encrypted and signed
5. Closing the tab destroys all keys and messages permanently

## Features

- **Direct P2P** -- messages travel between browsers via WebRTC, no relay servers
- **E2E Encryption** -- OpenPGP with per-session ECC keys, every message signed and verified
- **Multi-peer Mesh** -- supports group chats with full mesh connectivity
- **File Sharing** -- send images and documents up to 2 MB, encrypted through the same pipeline
- **Entry Control** -- channel creator can lock/unlock the room to new peers
- **Zero Persistence** -- no databases, no logs, no cookies, no local storage
- **Anonymous Codenames** -- random four-word identifiers instead of usernames

## Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/close` | Destroy the channel and end the session |
| `/close_entry` | Lock the room (creator only) |
| `/open_entry` | Reopen the room (creator only) |
| `/clear` | Clear the message log for all peers |
| `/whoami` | Show your codename, role, and key fingerprint |
| `/status` | Show session info (peers, uptime, encryption) |
| `/ping` | Measure round-trip time to all peers |

Files can be sent via the **[+]** button or by dragging and dropping onto the message log.

## Architecture

```
index.html          -- Single-page app shell + CSP policy
css/style.css       -- Terminal-aesthetic styling
js/main.js          -- Session state, command dispatch, file transfer, event wiring
js/ui.js            -- DOM rendering, screen transitions, message display
js/network.js       -- PeerJS WebRTC connection management, mesh topology
js/crypto.js        -- OpenPGP key generation, encryption, signing, verification
js/utils.js         -- Channel IDs, timestamps, HTML escaping, formatting
js/words.js         -- Random codename generation
```

## Dependencies

Loaded via import maps at runtime (no build step):

- [OpenPGP.js 5.11.2](https://github.com/nicolo-ribaudo/openpgp) -- encryption
- [PeerJS 1.5.4](https://peerjs.com/) -- WebRTC signaling and connection management

## Running Locally

Serve the project root with any static file server:

```bash
npx serve .
```

Open the URL in two browser tabs to test.

## License

MIT
