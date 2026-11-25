import type { SignalingMessage } from "./types";

type Listener = (msg: SignalingMessage) => void;
type StatusListener = (
  connected: boolean,
  rttMs: number | null,
  onlineCount?: number
) => void;

export class SignalingClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<Listener>();
  private statusListeners = new Set<StatusListener>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private lastRegisterMsg: SignalingMessage | null = null;
  private closedManually = false;
  private backoffMs = 250;
  private visibilityHandler: (() => void) | null = null;

  connect() {
    if (typeof window === "undefined") return;
    if (!this.visibilityHandler) {
      this.visibilityHandler = () => {
        if (
          document.visibilityState === "visible" &&
          (!this.ws || this.ws.readyState !== WebSocket.OPEN)
        ) {
          this.connect();
        }
      };
      document.addEventListener("visibilitychange", this.visibilityHandler);
      window.addEventListener("online", this.visibilityHandler);
    }
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.closedManually = false;
    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const url = `${proto}//${window.location.host}/ws`;
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.onopen = () => {
      this.backoffMs = 400;
      this.notifyStatus(true, null);
      if (this.lastRegisterMsg) {
        this.send(this.lastRegisterMsg);
      }
      this.send({ type: "ping", ts: performance.now() });

      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          this.send({ type: "ping", ts: performance.now() });
        }
      }, 5000);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as SignalingMessage;
        if (msg.type === "pong") {
          const rtt = Math.max(1, Math.round(performance.now() - msg.ts));
          this.notifyStatus(true, rtt, msg.onlineCount);
          return;
        }
        if (msg.type === "registered") {
          this.notifyStatus(true, null, msg.onlineCount);
        }
        for (const fn of this.listeners) {
          fn(msg);
        }
      } catch {
        // Ignore malformed packets
      }
    };

    ws.onclose = () => {
      this.notifyStatus(false, null);
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (!this.closedManually) {
        this.reconnectTimer = setTimeout(() => {
          this.backoffMs = Math.min(this.backoffMs * 1.5, 4000);
          this.connect();
        }, this.backoffMs);
      }
    };

    ws.onerror = () => {
      ws.close();
    };
  }

  send(msg: SignalingMessage) {
    if (msg.type === "register") {
      this.lastRegisterMsg = msg;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(fn: Listener) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  onStatus(fn: StatusListener) {
    this.statusListeners.add(fn);
    return () => {
      this.statusListeners.delete(fn);
    };
  }

  private notifyStatus(
    connected: boolean,
    rttMs: number | null,
    onlineCount?: number
  ) {
    for (const fn of this.statusListeners) {
      fn(connected, rttMs, onlineCount);
    }
  }

  disconnect() {
    this.closedManually = true;
    if (this.visibilityHandler && typeof window !== "undefined") {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      window.removeEventListener("online", this.visibilityHandler);
      this.visibilityHandler = null;
    }
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.ws?.close();
    this.ws = null;
  }
}
