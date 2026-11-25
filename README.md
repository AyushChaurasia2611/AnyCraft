# AnyCraft — Ultra-Low-Latency Remote Desktop & Mobile Share

AnyCraft is an AnyDesk-style remote desktop and mobile screen-sharing application built with **Next.js (App Router)**, **WebSocket signaling (`ws`)**, and **WebRTC Peer-to-Peer (`RTCPeerConnection` + dual `RTCDataChannel`s)**.

## Key Features
- **9-Digit Desk ID (`XXX XXX XXX`) & Unattended Passcode**: Persistent device identity with instant accept/dismiss or passcode auto-accept.
- **Ultra-Low-Latency WebRTC**:
  - `playoutDelayHint = 0` & `degradationPreference: "maintain-framerate"`
  - Unordered, zero-retransmit `control` DataChannel (`ordered: false, maxRetransmits: 0`) for 60–120Hz mouse, touch, and keyboard events.
  - Reliable `reliable` DataChannel for P2P file transfer, clipboard sync, chat, and live quality switching (`Ultra 60fps`, `Balanced`, `Data Saver`).
- **Laptop ↔ Laptop & Mobile ↔ Mobile**:
  - Responsive PWA layout (`manifest.json`).
  - Mobile **Direct Touch** and **Trackpad Mode** + on-screen Quick Keys (`Esc`, `Tab`, `Ctrl+C`, `Ctrl+V`, `Alt+Tab`, `Win`, arrows).
  - Automatic screen-share (`getDisplayMedia`) with camera fallback (`getUserMedia`) on mobile browsers without screen capture.
- **Optional OS Remote-Control Agent (`agent/anycraft_agent.py`)**:
  - Zero-dependency Python bridge on `ws://127.0.0.1:8765` that turns incoming browser control events into real Windows mouse & keyboard input.

## Running Locally
```bash
npm run dev
```
Open `http://localhost:3000` on your laptop, and on mobile devices on the same network open `http://<YOUR_LAN_IP>:3000` (or deploy behind HTTPS for internet/cellular P2P + `getDisplayMedia` on mobile).

To enable full OS mouse/keyboard control on a Windows host PC:
```bash
python agent/anycraft_agent.py
```
