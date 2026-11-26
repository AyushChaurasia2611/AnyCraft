"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Copy,
  Check,
  RefreshCw,
  Monitor,
  Smartphone,
  Tablet,
  ArrowRight,
  Shield,
  Zap,
  Eye,
  EyeOff,
  Terminal,
  Wifi,
  Clock,
  Lock,
  Download,
} from "lucide-react";
import {
  formatDeskId,
  loadOrCreateIdentity,
  loadRecentPeers,
  normalizeDeskId,
  saveIdentityField,
  saveRecentPeer,
  generatePasscode,
  supportsScreenShare,
} from "@/lib/identity";
import { SignalingClient } from "@/lib/signaling";
import { AnyCraftPeer } from "@/lib/webrtc";
import type {
  ContentMode,
  ControlEvent,
  DeviceType,
  IncomingRequest,
  PeerInfo,
  QualityPreset,
  ReliableEvent,
  SignalingMessage,
  TelemetryStats,
} from "@/lib/types";
import { IncomingModal } from "@/components/IncomingModal";
import { RemoteViewer } from "@/components/RemoteViewer";
import {
  SessionSidePanel,
  type ChatItem,
  type FileItem,
} from "@/components/SessionSidePanel";

export default function HomePage() {
  // Local Desk Identity
  const [deskId, setDeskId] = useState("000000000");
  const [alias, setAlias] = useState("AnyCraft Device");
  const [passcode, setPasscode] = useState("ANY123");
  const [unattended, setUnattended] = useState(false);
  const [deviceType, setDeviceType] = useState<DeviceType>("desktop");
  const [canScreenShare, setCanScreenShare] = useState(true);

  // UI & Signaling State
  const [wsConnected, setWsConnected] = useState(false);
  const [wsRtt, setWsRtt] = useState<number | null>(null);
  const [onlineCount, setOnlineCount] = useState<number>(0);
  const [copiedId, setCopiedId] = useState(false);
  const [showPasscode, setShowPasscode] = useState(false);
  const [targetIdInput, setTargetIdInput] = useState("");
  const [targetPassInput, setTargetPassInput] = useState("");
  const [connectingState, setConnectingState] = useState<string | null>(null);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [recents, setRecents] = useState<PeerInfo[]>([]);
  const [presenceMap, setPresenceMap] = useState<Record<string, boolean>>({});
  const [showAgentHelp, setShowAgentHelp] = useState(false);
  const [copiedMacCmd, setCopiedMacCmd] = useState(false);

  // Optional Local OS Control Agent (ws://127.0.0.1:8765)
  const [agentConnected, setAgentConnected] = useState(false);
  const agentWsRef = useRef<WebSocket | null>(null);

  // Active Session State
  const [incomingReq, setIncomingReq] = useState<IncomingRequest | null>(null);
  const [activePeer, setActivePeer] = useState<{
    deskId: string;
    alias: string;
    isHost: boolean;
  } | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [quality, setQuality] = useState<QualityPreset>("ultra");
  const [contentMode, setContentMode] = useState<ContentMode>("detail");
  const [stats, setStats] = useState<TelemetryStats>({
    rttMs: 0,
    fps: 0,
    bitrateMbps: 0,
    width: 0,
    height: 0,
    packetLossPct: 0,
    connectionType: "Connecting",
  });
  const [remotePointer, setRemotePointer] = useState<{
    x: number;
    y: number;
    visible: boolean;
  } | null>(null);

  // Chat, Files & Clipboard
  const [sideOpen, setSideOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [chats, setChats] = useState<ChatItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [clipboardSynced, setClipboardSynced] = useState(false);

  const signalingRef = useRef<SignalingClient | null>(null);
  const rtcRef = useRef<AnyCraftPeer | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const incomingFileChunks = useRef<
    Map<
      string,
      { name: string; size: number; mime: string; total: number; parts: string[] }
    >
  >(new Map());

  const cleanupSession = useCallback(() => {
    rtcRef.current?.close();
    rtcRef.current = null;
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setActivePeer(null);
    setRemoteStream(null);
    setConnectingState(null);
    setSideOpen(false);
    setRemotePointer(null);
  }, []);

  // Connect to optional local OS control agent on localhost:8765
  useEffect(() => {
    let closed = false;
    let timer: ReturnType<typeof setTimeout>;
    const tryConnectAgent = () => {
      if (closed) return;
      try {
        const ws = new WebSocket("ws://127.0.0.1:8765");
        ws.onopen = () => {
          agentWsRef.current = ws;
          setAgentConnected(true);
        };
        ws.onclose = () => {
          if (agentWsRef.current === ws) agentWsRef.current = null;
          setAgentConnected(false);
          if (!closed) timer = setTimeout(tryConnectAgent, 4000);
        };
        ws.onerror = () => ws.close();
      } catch {
        timer = setTimeout(tryConnectAgent, 4000);
      }
    };
    tryConnectAgent();
    return () => {
      closed = true;
      clearTimeout(timer);
      agentWsRef.current?.close();
    };
  }, []);

  // Initialize Identity + Signaling
  useEffect(() => {
    const id = loadOrCreateIdentity();
    setDeskId(id.deskId);
    setAlias(id.alias);
    setPasscode(id.passcode);
    setUnattended(id.unattended);
    setDeviceType(id.deviceType);
    setCanScreenShare(supportsScreenShare());

    const loadedRecents = loadRecentPeers();
    setRecents(loadedRecents);

    const sig = new SignalingClient();
    signalingRef.current = sig;

    const unsubStatus = sig.onStatus((connected, rtt, online) => {
      setWsConnected(connected);
      if (rtt !== null) setWsRtt(rtt);
      if (typeof online === "number") setOnlineCount(online);
      if (connected && loadedRecents.length > 0) {
        sig.send({
          type: "presence-check",
          deskIds: loadedRecents.map((p) => p.deskId),
        });
      }
    });

    sig.connect();
    sig.send({
      type: "register",
      deskId: id.deskId,
      alias: id.alias,
      deviceType: id.deviceType,
      passcode: id.passcode,
      unattended: id.unattended,
    });

    return () => {
      unsubStatus();
      sig.disconnect();
      cleanupSession();
    };
  }, [cleanupSession]);

  // Re-register whenever alias/passcode/unattended changes
  useEffect(() => {
    if (!deskId || deskId === "000000000") return;
    signalingRef.current?.send({
      type: "register",
      deskId,
      alias,
      deviceType,
      passcode,
      unattended,
    });
  }, [deskId, alias, deviceType, passcode, unattended]);

  // Handle incoming control & reliable DataChannel events
  const handleControlEvent = useCallback((ev: ControlEvent) => {
    if (ev.t === "m" || ev.t === "d" || ev.t === "c") {
      setRemotePointer({ x: ev.x, y: ev.y, visible: true });
    }
    if (agentWsRef.current && agentWsRef.current.readyState === WebSocket.OPEN) {
      agentWsRef.current.send(JSON.stringify(ev));
    }
  }, []);

  const handleReliableEvent = useCallback(
    (ev: ReliableEvent, peerAlias: string) => {
      switch (ev.t) {
        case "chat":
          setChats((prev) => [
            ...prev,
            {
              id: ev.id,
              sender: peerAlias,
              text: ev.text,
              ts: ev.ts,
              self: false,
            },
          ]);
          setUnreadCount((c) => c + 1);
          break;
        case "clip":
          navigator.clipboard?.writeText(ev.text).catch(() => {});
          break;
        case "qual":
          setQuality(ev.preset);
          setContentMode(ev.mode);
          rtcRef.current?.applyQualityToSenders(ev.preset, ev.mode);
          break;
        case "fmeta":
          incomingFileChunks.current.set(ev.id, {
            name: ev.name,
            size: ev.size,
            mime: ev.mime,
            total: 0,
            parts: [],
          });
          setFiles((prev) => [
            {
              id: ev.id,
              name: ev.name,
              size: ev.size,
              progress: 0,
              direction: "received",
            },
            ...prev,
          ]);
          setUnreadCount((c) => c + 1);
          break;
        case "fchunk": {
          const entry = incomingFileChunks.current.get(ev.id);
          if (!entry) return;
          entry.parts[ev.idx] = ev.data;
          entry.total = ev.total;
          const receivedCount = entry.parts.filter(Boolean).length;
          const pct = Math.round((receivedCount / ev.total) * 100);
          if (receivedCount === ev.total) {
            const byteArrays = entry.parts.map((b64) => {
              const bin = atob(b64);
              const arr = new Uint8Array(bin.length);
              for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
              return arr;
            });
            const blob = new Blob(byteArrays, { type: entry.mime });
            const url = URL.createObjectURL(blob);
            setFiles((prev) =>
              prev.map((f) =>
                f.id === ev.id ? { ...f, progress: 100, url } : f
              )
            );
            incomingFileChunks.current.delete(ev.id);
          } else {
            setFiles((prev) =>
              prev.map((f) => (f.id === ev.id ? { ...f, progress: pct } : f))
            );
          }
          break;
        }
      }
    },
    []
  );

  // Create WebRTC peer helper
  const createPeer = useCallback(
    (remoteId: string, remoteName: string, isInitiator: boolean) => {
      rtcRef.current?.close();
      const peer = new AnyCraftPeer(isInitiator, {
        onIceCandidate: (candidate) => {
          signalingRef.current?.send({
            type: "rtc-ice",
            targetDeskId: remoteId,
            fromDeskId: deskId,
            candidate,
          });
        },
        onRemoteStream: (stream) => {
          setRemoteStream(stream);
        },
        onControlEvent: handleControlEvent,
        onReliableEvent: (ev) => handleReliableEvent(ev, remoteName),
        onConnectionState: (state) => {
          if (state === "failed" || state === "closed") {
            cleanupSession();
          }
        },
      });
      rtcRef.current = peer;
      return peer;
    },
    [cleanupSession, deskId, handleControlEvent, handleReliableEvent]
  );

  // Signaling message router
  useEffect(() => {
    const sig = signalingRef.current;
    if (!sig) return;

    return sig.onMessage(async (msg: SignalingMessage) => {
      switch (msg.type) {
        case "presence-result":
          setPresenceMap(msg.statuses);
          break;

        case "peer-error":
          setConnectingState(null);
          setErrorBanner(msg.message);
          break;

        case "incoming-request":
          setIncomingReq({
            fromDeskId: msg.fromDeskId,
            fromAlias: msg.fromAlias,
            fromDeviceType: msg.fromDeviceType,
          });
          break;

        case "connect-reject":
          setConnectingState(null);
          setErrorBanner(msg.reason || "Connection was declined by remote peer.");
          break;

        case "connect-accept": {
          // Viewer side: peer accepted! Start WebRTC offer
          setConnectingState("Establishing P2P tunnel…");
          const updated = saveRecentPeer({
            deskId: msg.fromDeskId,
            alias: msg.fromAlias,
            deviceType: msg.fromDeviceType,
          });
          setRecents(updated);
          setActivePeer({
            deskId: msg.fromDeskId,
            alias: msg.fromAlias,
            isHost: false,
          });

          const peer = createPeer(msg.fromDeskId, msg.fromAlias, true);
          const offer = await peer.createOffer();
          sig.send({
            type: "rtc-offer",
            targetDeskId: msg.fromDeskId,
            fromDeskId: deskId,
            sdp: offer,
          });
          setConnectingState(null);
          break;
        }

        case "rtc-offer": {
          // Host side receives offer from Viewer
          const peer =
            rtcRef.current ||
            createPeer(msg.fromDeskId, msg.fromDeskId, false);
          const answer = await peer.handleOffer(msg.sdp);
          sig.send({
            type: "rtc-answer",
            targetDeskId: msg.fromDeskId,
            fromDeskId: deskId,
            sdp: answer,
          });
          break;
        }

        case "rtc-answer": {
          await rtcRef.current?.handleAnswer(msg.sdp);
          break;
        }

        case "rtc-ice": {
          await rtcRef.current?.addIceCandidate(msg.candidate);
          break;
        }

        case "disconnect-peer": {
          cleanupSession();
          break;
        }
      }
    });
  }, [cleanupSession, createPeer, deskId]);

  // Poll WebRTC telemetry every 1s during active session
  useEffect(() => {
    if (!activePeer) return;
    const timer = setInterval(async () => {
      if (rtcRef.current) {
        const s = await rtcRef.current.getStats();
        setStats(s);
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [activePeer]);

  // Connect to remote Desk ID
  const handleConnect = (e?: React.FormEvent, overrideId?: string) => {
    e?.preventDefault();
    setErrorBanner(null);
    const cleanId = normalizeDeskId(overrideId ?? targetIdInput);
    if (cleanId.length !== 9) {
      setErrorBanner("Enter a valid 9-digit AnyCraft Desk ID.");
      return;
    }
    setConnectingState(`Calling ${formatDeskId(cleanId)}…`);
    signalingRef.current?.send({
      type: "connect-request",
      targetDeskId: cleanId,
      fromDeskId: deskId,
      fromAlias: alias,
      fromDeviceType: deviceType,
      passcode: targetPassInput.trim() || undefined,
    });
  };

  const captureScreenStream = async (): Promise<MediaStream> => {
    try {
      return await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: deviceType === "mobile" ? 30 : 60 },
        },
        audio: true,
      });
    } catch {
      // Mobile browsers (e.g. Android Chrome) often reject audio:true or frameRate constraints
      return await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
    }
  };

  // Host accepts incoming request & captures Screen or Camera
  const handleAcceptIncoming = async (source: "screen" | "camera") => {
    if (!incomingReq) return;
    const req = incomingReq;
    setIncomingReq(null);

    try {
      const stream =
        source === "screen"
          ? await captureScreenStream()
          : await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "environment", frameRate: { ideal: 30 } },
              audio: true,
            });

      localStreamRef.current = stream;
      stream.getVideoTracks()[0].onended = () => {
        handleDisconnect();
      };

      const peer = createPeer(req.fromDeskId, req.fromAlias, false);
      peer.attachLocalStream(stream, quality, contentMode);

      const updated = saveRecentPeer({
        deskId: req.fromDeskId,
        alias: req.fromAlias,
        deviceType: req.fromDeviceType,
      });
      setRecents(updated);

      setRemoteStream(stream);
      setActivePeer({
        deskId: req.fromDeskId,
        alias: req.fromAlias,
        isHost: true,
      });

      signalingRef.current?.send({
        type: "connect-accept",
        targetDeskId: req.fromDeskId,
        fromDeskId: deskId,
        fromAlias: alias,
        fromDeviceType: deviceType,
      });
    } catch (err) {
      const msg =
        err instanceof Error && err.message
          ? `Capture failed: ${err.message}`
          : "Screen/Camera permission was cancelled or not supported on this browser.";
      setErrorBanner(msg);
      signalingRef.current?.send({
        type: "connect-reject",
        targetDeskId: req.fromDeskId,
        fromDeskId: deskId,
        reason: msg,
      });
    }
  };

  const handleRejectIncoming = () => {
    if (!incomingReq) return;
    signalingRef.current?.send({
      type: "connect-reject",
      targetDeskId: incomingReq.fromDeskId,
      fromDeskId: deskId,
      reason: "Connection declined.",
    });
    setIncomingReq(null);
  };

  const handleDisconnect = () => {
    if (activePeer) {
      signalingRef.current?.send({
        type: "disconnect-peer",
        targetDeskId: activePeer.deskId,
        fromDeskId: deskId,
      });
    }
    cleanupSession();
  };

  const handleSwitchSource = async (source: "screen" | "camera") => {
    try {
      const newStream =
        source === "screen"
          ? await captureScreenStream()
          : await navigator.mediaDevices.getUserMedia({
              video: { facingMode: "environment" },
              audio: false,
            });
      const newTrack = newStream.getVideoTracks()[0];
      await rtcRef.current?.replaceVideoTrack(newTrack, quality, contentMode);
      localStreamRef.current?.getVideoTracks().forEach((t) => t.stop());
      localStreamRef.current = newStream;
      setRemoteStream(newStream);
    } catch {
      // Cancelled
    }
  };

  const copyMyId = async () => {
    await navigator.clipboard?.writeText(deskId).catch(() => {});
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1800);
  };

  return (
    <main className="min-h-dvh flex flex-col">
      {/* Top Navbar */}
      <nav className="border-b border-zinc-800/80 bg-[#0c0c10]/90 backdrop-blur-md px-4 sm:px-8 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-red-600 shadow-lg shadow-red-600/25">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <span className="text-lg font-bold tracking-tight text-white">
              AnyCraft
            </span>
            <span className="hidden sm:inline-block ml-2 rounded-md bg-zinc-800 px-2 py-0.5 text-[11px] font-medium text-zinc-400">
              P2P Low-Latency
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3 text-xs">
          <button
            onClick={() => setShowAgentHelp((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 transition cursor-pointer ${
              agentConnected
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                : "border-zinc-800 bg-zinc-900 text-zinc-300 hover:text-white"
            }`}
          >
            <Terminal className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">
              {agentConnected ? "OS Agent Ready" : "Download Agent"}
            </span>
            <span className="sm:hidden">Agent</span>
          </button>

          <div className="inline-flex items-center gap-2 rounded-full border border-zinc-800 bg-zinc-900 px-3 py-1.5">
            <span
              className={`h-2 w-2 rounded-full ${
                wsConnected ? "bg-emerald-500" : "bg-amber-500 animate-pulse"
              }`}
            />
            <span className="text-zinc-300 font-medium">
              {wsConnected ? "Ready" : "Reconnecting"}
            </span>
            {wsRtt !== null && (
              <span className="font-mono text-zinc-500">{wsRtt}ms</span>
            )}
            {wsConnected && onlineCount > 0 && (
              <span className="font-mono text-emerald-400/90">
                · {onlineCount} online
              </span>
            )}
          </div>
        </div>
      </nav>

      {/* Optional OS Control Agent Download & Instructions */}
      {showAgentHelp && (
        <div className="border-b border-zinc-800 bg-[#121218] px-4 sm:px-8 py-4 text-xs text-zinc-300">
          <div className="max-w-5xl mx-auto space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-white">
                  1-Click OS Mouse & Keyboard Control (Windows & Mac)
                </p>
                <p className="text-zinc-400 mt-0.5">
                  Run this on the laptop/Mac you want to control. On Mac, allow
                  Terminal in System Settings → Privacy & Security → Accessibility.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <a
                  href="/api/agent?os=win"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-2 font-medium text-white transition"
                >
                  <Download className="h-3.5 w-3.5 text-red-400" />
                  Windows (.bat)
                </a>
                <a
                  href="/api/agent?os=mac"
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 px-3 py-2 font-medium text-white transition"
                >
                  <Download className="h-3.5 w-3.5 text-emerald-400" />
                  Mac (.command)
                </a>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl bg-black/70 border border-zinc-800 p-2.5">
              <span className="text-zinc-400 shrink-0 px-1">
                Mac 1-Line Terminal:
              </span>
              <code className="flex-1 font-mono text-[11px] text-emerald-400 truncate">
                {`curl -sL ${
                  typeof window !== "undefined" ? window.location.origin : ""
                }/api/agent -o /tmp/anycraft_agent.py && python3 /tmp/anycraft_agent.py`}
              </code>
              <button
                onClick={async () => {
                  const cmd = `curl -sL ${window.location.origin}/api/agent -o /tmp/anycraft_agent.py && python3 /tmp/anycraft_agent.py`;
                  await navigator.clipboard?.writeText(cmd).catch(() => {});
                  setCopiedMacCmd(true);
                  setTimeout(() => setCopiedMacCmd(false), 1800);
                }}
                className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1.5 text-[11px] font-medium text-white cursor-pointer shrink-0"
              >
                {copiedMacCmd ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" />
                ) : (
                  <Copy className="h-3.5 w-3.5" />
                )}
                {copiedMacCmd ? "Copied" : "Copy"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Dashboard */}
      <div className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
        {errorBanner && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-center justify-between">
            <span>{errorBanner}</span>
            <button
              onClick={() => setErrorBanner(null)}
              className="text-xs underline ml-4 cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-12 gap-5">
          {/* Left Card: This Desk */}
          <section className="md:col-span-5 rounded-2xl border border-zinc-800/90 bg-[#121216] p-6 flex flex-col justify-between shadow-xl">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  This Desk
                </span>
                <span className="inline-flex items-center gap-1 text-xs text-zinc-400 capitalize">
                  {deviceType === "mobile" ? (
                    <Smartphone className="h-3.5 w-3.5 text-red-400" />
                  ) : deviceType === "tablet" ? (
                    <Tablet className="h-3.5 w-3.5 text-red-400" />
                  ) : (
                    <Monitor className="h-3.5 w-3.5 text-red-400" />
                  )}
                  {deviceType}
                </span>
              </div>

              <div className="mt-4 flex items-center justify-between gap-2">
                <h1 className="font-mono text-3xl sm:text-4xl font-bold tracking-wider text-white">
                  {formatDeskId(deskId)}
                </h1>
                <button
                  onClick={copyMyId}
                  className="rounded-xl border border-zinc-800 bg-zinc-900 hover:bg-zinc-800 p-2.5 text-zinc-300 transition cursor-pointer"
                  title="Copy Desk ID"
                >
                  {copiedId ? (
                    <Check className="h-5 w-5 text-emerald-400" />
                  ) : (
                    <Copy className="h-5 w-5" />
                  )}
                </button>
              </div>
              <p className="mt-1.5 text-xs text-zinc-500">
                Share this 9-digit address with another laptop or mobile to let them
                connect.
              </p>

              {/* Alias */}
              <div className="mt-5">
                <label className="text-[11px] font-medium text-zinc-400 block mb-1">
                  Device Name
                </label>
                <input
                  type="text"
                  value={alias}
                  onChange={(e) => {
                    setAlias(e.target.value);
                    saveIdentityField("alias", e.target.value);
                  }}
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900/90 px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-red-500"
                />
              </div>
            </div>

            {/* Passcode & Unattended Access */}
            <div className="mt-5 pt-5 border-t border-zinc-800/80 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lock className="h-4 w-4 text-zinc-400" />
                  <span className="text-xs font-medium text-zinc-300">
                    Unattended Access
                  </span>
                </div>
                <button
                  onClick={() => {
                    const next = !unattended;
                    setUnattended(next);
                    saveIdentityField("unattended", next);
                  }}
                  className={`h-6 w-11 rounded-full transition p-0.5 cursor-pointer ${
                    unattended ? "bg-emerald-600" : "bg-zinc-700"
                  }`}
                >
                  <div
                    className={`h-5 w-5 rounded-full bg-white transition-transform ${
                      unattended ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              <div className="flex items-center justify-between rounded-xl bg-zinc-900 border border-zinc-800 px-3 py-2">
                <span className="font-mono text-sm tracking-widest text-zinc-200">
                  {showPasscode ? passcode : "••••••"}
                </span>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowPasscode((v) => !v)}
                    className="p-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    title="Show/Hide Passcode"
                  >
                    {showPasscode ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                  <button
                    onClick={() => {
                      const next = generatePasscode();
                      setPasscode(next);
                      saveIdentityField("passcode", next);
                    }}
                    className="p-1.5 text-zinc-400 hover:text-zinc-200 cursor-pointer"
                    title="Generate New Passcode"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* Right Card: Remote Desk */}
          <section className="md:col-span-7 rounded-2xl border border-zinc-800/90 bg-[#121216] p-6 flex flex-col justify-between shadow-xl">
            <div>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Remote Desk
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-emerald-400">
                  <Shield className="h-3.5 w-3.5" />
                  End-to-End WebRTC
                </span>
              </div>

              <h2 className="mt-3 text-xl font-semibold text-white">
                Connect to Laptop, PC, or Mobile
              </h2>
              <p className="mt-1 text-xs text-zinc-400">
                Enter the 9-digit AnyCraft ID of the remote device to view and
                control it with sub-frame latency.
              </p>

              <form onSubmit={handleConnect} className="mt-6 space-y-3">
                <div className="flex flex-col sm:flex-row gap-2.5">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={targetIdInput}
                    onChange={(e) =>
                      setTargetIdInput(formatDeskId(e.target.value))
                    }
                    placeholder="Enter Remote Desk ID (e.g. 482 910 374)"
                    className="flex-1 rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3.5 font-mono text-base sm:text-lg text-white placeholder:text-zinc-500 focus:outline-none focus:border-red-500"
                  />
                  <button
                    type="submit"
                    disabled={Boolean(connectingState)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-600 hover:bg-red-500 disabled:opacity-60 px-6 py-3.5 text-sm font-semibold text-white shadow-lg shadow-red-600/25 transition cursor-pointer"
                  >
                    {connectingState ? (
                      <span>Connecting…</span>
                    ) : (
                      <>
                        <span>Connect</span>
                        <ArrowRight className="h-4 w-4" />
                      </>
                    )}
                  </button>
                </div>

                <input
                  type="password"
                  value={targetPassInput}
                  onChange={(e) => setTargetPassInput(e.target.value.toUpperCase())}
                  placeholder="Optional Unattended Passcode (if enabled on remote)"
                  className="w-full rounded-xl border border-zinc-800 bg-zinc-900/60 px-4 py-2.5 text-xs font-mono text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-zinc-600"
                />
              </form>

              {connectingState && (
                <div className="mt-4 flex items-center gap-2.5 text-xs text-zinc-300">
                  <div className="h-4 w-4 rounded-full border-2 border-red-500 border-t-transparent animate-spin" />
                  <span>{connectingState}</span>
                </div>
              )}
            </div>

            <div className="mt-6 pt-5 border-t border-zinc-800/80 grid grid-cols-3 gap-3 text-center">
              <div className="rounded-xl bg-zinc-900/70 border border-zinc-800/70 p-3">
                <p className="text-xs font-semibold text-white">60 FPS</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  Unordered Control
                </p>
              </div>
              <div className="rounded-xl bg-zinc-900/70 border border-zinc-800/70 p-3">
                <p className="text-xs font-semibold text-white">Cross-Device</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  PC ↔ PC & Mobile
                </p>
              </div>
              <div className="rounded-xl bg-zinc-900/70 border border-zinc-800/70 p-3">
                <p className="text-xs font-semibold text-white">P2P Files</p>
                <p className="text-[11px] text-zinc-500 mt-0.5">
                  Direct Transfer
                </p>
              </div>
            </div>
          </section>
        </div>

        {/* Recent Sessions */}
        <section className="rounded-2xl border border-zinc-800/90 bg-[#121216] p-5 sm:p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-zinc-400" />
              <h3 className="text-sm font-semibold text-zinc-200">
                Recent Sessions
              </h3>
            </div>
            {recents.length > 0 && (
              <button
                onClick={() =>
                  signalingRef.current?.send({
                    type: "presence-check",
                    deskIds: recents.map((p) => p.deskId),
                  })
                }
                className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
              >
                <Wifi className="h-3.5 w-3.5" />
                Refresh Status
              </button>
            )}
          </div>

          {recents.length === 0 ? (
            <p className="text-xs text-zinc-500 py-4 text-center">
              Your recently connected laptops and phones will appear here for
              one-tap reconnect.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {recents.map((peer) => {
                const online = presenceMap[peer.deskId];
                const Icon =
                  peer.deviceType === "mobile"
                    ? Smartphone
                    : peer.deviceType === "tablet"
                    ? Tablet
                    : Monitor;
                return (
                  <button
                    key={peer.deskId}
                    onClick={() => handleConnect(undefined, peer.deskId)}
                    className="flex items-center justify-between rounded-xl border border-zinc-800 bg-zinc-900/70 hover:bg-zinc-900 hover:border-red-500/40 p-3.5 text-left transition cursor-pointer"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-800 text-zinc-300 shrink-0">
                        <Icon className="h-5 w-5" />
                        <span
                          className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-zinc-900 ${
                            online ? "bg-emerald-500" : "bg-zinc-600"
                          }`}
                        />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-zinc-100 truncate">
                          {peer.alias}
                        </p>
                        <p className="font-mono text-xs text-zinc-400">
                          {formatDeskId(peer.deskId)}
                        </p>
                      </div>
                    </div>
                    <ArrowRight className="h-4 w-4 text-zinc-500 shrink-0" />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      </div>

      {/* Incoming Connection Modal */}
      <IncomingModal
        request={incomingReq}
        canScreenShare={canScreenShare}
        onAccept={handleAcceptIncoming}
        onReject={handleRejectIncoming}
      />

      {/* Active Remote Session Viewport */}
      {activePeer && (
        <RemoteViewer
          remoteDeskId={activePeer.deskId}
          remoteAlias={activePeer.alias}
          remoteStream={remoteStream}
          isSharingLocal={activePeer.isHost}
          stats={stats}
          quality={quality}
          contentMode={contentMode}
          agentConnected={agentConnected}
          remotePointer={remotePointer}
          unreadCount={unreadCount}
          onQualityChange={(p, m) => {
            setQuality(p);
            setContentMode(m);
            rtcRef.current?.sendReliable({ t: "qual", preset: p, mode: m });
          }}
          onControlEvent={(ev) => rtcRef.current?.sendControl(ev)}
          onToggleSidePanel={() => {
            setSideOpen((v) => !v);
            setUnreadCount(0);
          }}
          onSwitchSource={activePeer.isHost ? handleSwitchSource : undefined}
          onDisconnect={handleDisconnect}
        />
      )}

      {/* Chat, File Transfer & Clipboard Drawer */}
      <SessionSidePanel
        open={sideOpen}
        onClose={() => setSideOpen(false)}
        chats={chats}
        files={files}
        onSendChat={(text) => {
          const item: ChatItem = {
            id: `${Date.now()}`,
            sender: alias,
            text,
            ts: Date.now(),
            self: true,
          };
          setChats((prev) => [...prev, item]);
          rtcRef.current?.sendReliable({
            t: "chat",
            id: item.id,
            sender: alias,
            text,
            ts: item.ts,
          });
        }}
        onSendFile={async (file) => {
          const id = `${Date.now()}-${file.name}`;
          setFiles((prev) => [
            {
              id,
              name: file.name,
              size: file.size,
              progress: 0,
              direction: "sent",
            },
            ...prev,
          ]);
          await rtcRef.current?.sendFile(file, (pct) => {
            setFiles((prev) =>
              prev.map((f) => (f.id === id ? { ...f, progress: pct } : f))
            );
          });
        }}
        onSyncClipboard={async () => {
          const text = await navigator.clipboard?.readText().catch(() => "");
          if (text) {
            rtcRef.current?.sendReliable({ t: "clip", text });
            setClipboardSynced(true);
            setTimeout(() => setClipboardSynced(false), 1500);
          }
        }}
        clipboardSynced={clipboardSynced}
      />
    </main>
  );
}
