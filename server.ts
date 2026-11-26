import { createServer } from "http";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import type { Duplex } from "stream";
import type { DeviceType, SignalingMessage } from "./lib/types";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = parseInt(process.env.PORT || "3000", 10);

interface PeerRecord {
  deskId: string;
  alias: string;
  deviceType: DeviceType;
  passcode: string;
  unattended: boolean;
  ws: WebSocket;
  lastSeen: number;
}

const peers = new Map<string, PeerRecord>();

function normalizeId(id: string): string {
  return id.replace(/\D/g, "").slice(0, 9);
}

function safeSend(ws: WebSocket, msg: SignalingMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("ok");
      return;
    }
    handle(req, res);
  });

  // Disable Nagle's algorithm for minimal TCP latency
  server.on("connection", (socket) => {
    socket.setNoDelay(true);
  });

  const wss = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false, // Skip compression overhead for sub-ms signaling
  });

  server.on("upgrade", (req, socket: Duplex, head) => {
    const pathname = (req.url || "/").split("?")[0];
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      // Let Next.js handle HMR /_next/webpack-hmr in dev mode
      if (!dev) {
        socket.destroy();
      }
    }
  });

  wss.on("connection", (ws: WebSocket) => {
    let currentDeskId: string | null = null;

    ws.on("message", (raw) => {
      let msg: SignalingMessage;
      try {
        msg = JSON.parse(raw.toString()) as SignalingMessage;
      } catch {
        return;
      }

      switch (msg.type) {
        case "ping": {
          safeSend(ws, {
            type: "pong",
            ts: msg.ts,
            serverTs: Date.now(),
            onlineCount: peers.size,
          });
          if (currentDeskId && peers.has(currentDeskId)) {
            peers.get(currentDeskId)!.lastSeen = Date.now();
          }
          break;
        }

        case "register": {
          const deskId = normalizeId(msg.deskId);
          if (!deskId) return;
          currentDeskId = deskId;
          peers.set(deskId, {
            deskId,
            alias: msg.alias || `Device-${deskId.slice(-4)}`,
            deviceType: msg.deviceType || "desktop",
            passcode: msg.passcode || "",
            unattended: Boolean(msg.unattended),
            ws,
            lastSeen: Date.now(),
          });
          console.log(
            `  [+] Registered ${deskId} (${msg.alias || "Device"}) | online: ${peers.size}`
          );
          safeSend(ws, {
            type: "registered",
            deskId,
            serverTime: Date.now(),
            onlineCount: peers.size,
          });
          break;
        }

        case "presence-check": {
          const statuses: Record<string, boolean> = {};
          for (const rawId of msg.deskIds || []) {
            const id = normalizeId(rawId);
            const peer = peers.get(id);
            statuses[id] = Boolean(peer && peer.ws.readyState === WebSocket.OPEN);
          }
          safeSend(ws, { type: "presence-result", statuses });
          break;
        }

        case "connect-request": {
          const targetId = normalizeId(msg.targetDeskId);
          const fromId = normalizeId(msg.fromDeskId);

          if (!targetId || targetId === fromId) {
            safeSend(ws, {
              type: "peer-error",
              code: "SELF_CONNECT",
              message: "Cannot connect to your own Desk ID.",
            });
            return;
          }

          const target = peers.get(targetId);
          if (!target || target.ws.readyState !== WebSocket.OPEN) {
            safeSend(ws, {
              type: "peer-error",
              code: "OFFLINE",
              message: `Desk ${targetId} is offline or not registered.`,
            });
            return;
          }

          // Instant unattended access when passcode matches
          if (msg.passcode && msg.passcode.length > 0) {
            if (target.unattended && msg.passcode === target.passcode) {
              safeSend(ws, {
                type: "connect-accept",
                targetDeskId: fromId,
                fromDeskId: target.deskId,
                fromAlias: target.alias,
                fromDeviceType: target.deviceType,
                autoAccepted: true,
              });
              safeSend(target.ws, {
                type: "connect-accept",
                targetDeskId: target.deskId,
                fromDeskId: fromId,
                fromAlias: msg.fromAlias,
                fromDeviceType: msg.fromDeviceType,
                autoAccepted: true,
              });
              return;
            } else if (!target.unattended) {
              // Fall through to interactive prompt if unattended is disabled
            } else {
              safeSend(ws, {
                type: "peer-error",
                code: "INVALID_PASSCODE",
                message: "Incorrect unattended passcode.",
              });
              return;
            }
          }

          safeSend(target.ws, {
            type: "incoming-request",
            fromDeskId: fromId,
            fromAlias: msg.fromAlias,
            fromDeviceType: msg.fromDeviceType,
          });
          break;
        }

        case "connect-accept":
        case "connect-reject":
        case "rtc-offer":
        case "rtc-answer":
        case "rtc-ice":
        case "disconnect-peer": {
          const targetId = normalizeId(msg.targetDeskId);
          const target = peers.get(targetId);
          if (target && target.ws.readyState === WebSocket.OPEN) {
            safeSend(target.ws, msg);
          }
          break;
        }
      }
    });

    ws.on("close", () => {
      if (currentDeskId) {
        const existing = peers.get(currentDeskId);
        if (existing && existing.ws === ws) {
          peers.delete(currentDeskId);
        }
      }
    });
  });

  // Prune stale sockets every 30s
  setInterval(() => {
    for (const [id, peer] of peers.entries()) {
      if (peer.ws.readyState !== WebSocket.OPEN) {
        peers.delete(id);
      }
    }
  }, 30_000);

  server.listen(port, hostname, () => {
    console.log(
      `\n  ⚡ AnyCraft server ready on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port}`
    );
    console.log(`  📡 WebSocket signaling active on ws://localhost:${port}/ws\n`);
  });
});
