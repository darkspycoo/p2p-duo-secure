# WhisperDuo 🔒
### Ultra-Private 2-Peer E2EE Video, HD Voice & Chat with Low Tower Signal Resilience

WhisperDuo is a privacy-first web communication system purpose-built for **strictly two persons**. It incorporates zero-knowledge End-to-End Encryption (E2EE), zero server logs, and advanced audio/video packet resilience designed to maintain crystal-clear HD voice even under weak cellular tower signals (3G/4G/5G edge zones).

---

## 🚀 Key Features

### 1. 👥 Strict 2-Person Room Lock
- **Hard Limit**: Each room strictly allows a maximum of 2 participants.
- **Instant Lockdown**: Once the 2nd person connects, the room automatically locks.
- **Third-Party Rejection**: Any 3rd party attempting to connect is immediately blocked and disconnected (`Session Full & Locked`).
- **Zero Traces**: Rooms and keys exist entirely in volatile memory and are purged when participants leave.

### 2. 🛡️ Military-Grade End-to-End Encryption (E2EE)
- **Zero-Knowledge Architecture**: The signaling server only relays the initial connection handshake. Zero audio, video, or chat messages pass through the server.
- **AES-256-GCM DataChannel Encryption**: Text messages and data packets are encrypted in the browser with `window.crypto.subtle` using AES-256-GCM with a unique 12-byte initialization vector (IV) per message.
- **PBKDF2 Key Derivation**: Passphrases and room secrets are stretched through 100,000 iterations of SHA-256 PBKDF2.
- **URL Hash Key Privacy**: Secret keys are passed via URL hash (`#room=...&key=...`). Browsers never transmit hash fragments to HTTP servers, ensuring the server never sees the encryption key.
- **Safety Numbers & Emoji Verification**: A visual fingerprint (4 unique emojis + 12-digit security code) allows peers to verify that no Man-in-the-Middle exists.

### 3. 📶 Low Tower Signal & Weak Cellular Optimization
- **Opus In-Band Forward Error Correction (FEC)**: Configured with `useinbandfec=1` in SDP. When cellular tower signal drops and packets are lost, Opus reconstructs missing speech data from adjacent packets without latency.
- **Discontinuous Transmission (DTX)**: Configured with `usedtx=1`. Pauses transmission during speech silence to save radio bandwidth and battery.
- **Live Cellular Tower Signal HUD**: Real-time 5-bar signal strength indicator analyzing RTT, packet loss, jitter, framerate, and bitrates via `getStats()`.
- **Auto Audio-First Protection**: When packet loss exceeds 12% or RTT spikes, the engine automatically throttles high-bandwidth video and prioritizes 100% of bandwidth to HD Opus audio, preventing call drops in dead zones. Once signal stabilizes, HD video automatically resumes.
- **Manual "Low-Signal Saver" Mode**: One-click button to force audio priority when in rural or low-coverage environments.
- **Automatic ICE Restart**: Recovers from cell tower handovers (e.g. switching between 4G, 5G, and Wi-Fi).

---

## 📂 Project Structure

```
p2p-duo-secure/
├── server.js              # Ephemeral zero-log 2-peer signaling server
├── package.json           # Dependencies (express, ws)
├── README.md              # Documentation
└── public/
    ├── index.html         # Responsive stealth UI & call interface
    ├── style.css          # Glassmorphic cyber theme & tower signal widgets
    └── js/
        ├── crypto.js      # AES-256-GCM + PBKDF2 encryption & safety numbers
        ├── signal-hud.js  # Low-signal monitor & adaptive network engine
        ├── webrtc.js      # Opus FEC audio tuning, ICE restart & P2P DataChannel
        └── app.js         # Audio VU meter, call controls & UI orchestration
```

---

## 🛠️ Getting Started

### 1. Start the Server
From the project folder:
```powershell
node server.js
```
The server will start on:
```
http://localhost:3000
```

### 2. Testing 2-Person Private Communication
1. Open your browser and navigate to `http://localhost:3000`.
2. Click **"Copy Link"** or click **"Enter Encrypted Room"**.
3. Open a second browser tab (or incognito window) and paste the link.
4. Both peers will instantly connect P2P with HD audio, video, and encrypted chat.
5. Try opening a **third** tab with the same link: it will be immediately rejected with a **"Session Full & Locked"** modal.

### 3. In-Call Controls
- **Microphone**: Click the Mic button or press `M` to mute/unmute.
- **Camera**: Click the Video button or press `V` to turn camera on/off.
- **Screen Share**: Click the Monitor icon to share screen with remote peer.
- **Low-Signal Saver**: Click the Antenna icon to force Low-Signal Mode (pauses video, prioritizes HD voice).
- **Signal Telemetry HUD**: Click the 5-bar signal widget to inspect live RTT, packet loss, and bitrate.
- **Safety Fingerprint**: Click the **"E2EE Verified"** shield to verify emoji and 12-digit safety codes.
- **P2P Encrypted Chat**: Click the Chat bubble or press `C` to open the side drawer. Includes a "Burn / Clear Chat" button.
