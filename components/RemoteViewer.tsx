"use client";

import { useEffect, useRef, useState } from "react";
import {
  Maximize2,
  Minimize2,
  MessageSquare,
  PhoneOff,
  Wifi,
  SlidersHorizontal,
  MousePointer2,
  Hand,
  Keyboard,
  ShieldCheck,
  MonitorUp,
  Video,
} from "lucide-react";
import type {
  ContentMode,
  ControlEvent,
  QualityPreset,
  TelemetryStats,
} from "@/lib/types";
import { formatDeskId } from "@/lib/identity";

interface RemoteViewerProps {
  remoteDeskId: string;
  remoteAlias: string;
  remoteStream: MediaStream | null;
  isSharingLocal: boolean;
  stats: TelemetryStats;
  quality: QualityPreset;
  contentMode: ContentMode;
  agentConnected: boolean;
  remotePointer: { x: number; y: number; visible: boolean } | null;
  unreadCount: number;
  onQualityChange: (preset: QualityPreset, mode: ContentMode) => void;
  onControlEvent: (ev: ControlEvent) => void;
  onToggleSidePanel: () => void;
  onSwitchSource?: (source: "screen" | "camera") => void;
  onDisconnect: () => void;
}

export function RemoteViewer({
  remoteDeskId,
  remoteAlias,
  remoteStream,
  isSharingLocal,
  stats,
  quality,
  contentMode,
  agentConnected,
  remotePointer,
  unreadCount,
  onQualityChange,
  onControlEvent,
  onToggleSidePanel,
  onSwitchSource,
  onDisconnect,
}: RemoteViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hiddenInputRef = useRef<HTMLInputElement>(null);

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [touchMode, setTouchMode] = useState<"direct" | "trackpad">("direct");
  const [showMobileKeys, setShowMobileKeys] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [cursorNorm, setCursorNorm] = useState({ x: 0.5, y: 0.5 });

  // Trackpad state for mobile-to-laptop control
  const lastTouchRef = useRef<{ x: number; y: number; time: number } | null>(
    null
  );
  const rafMoveRef = useRef<number | null>(null);
  const pendingMoveRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid || !remoteStream) return;
    vid.srcObject = remoteStream;
    // Ultra-low-latency playout hint in Chromium
    if ("playoutDelayHint" in vid) {
      (vid as HTMLVideoElement & { playoutDelayHint: number }).playoutDelayHint = 0;
    }
    vid.play().catch(() => {});
  }, [remoteStream]);

  useEffect(() => {
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  const toggleFullscreen = async () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      await containerRef.current.requestFullscreen().catch(() => {});
    } else {
      await document.exitFullscreen().catch(() => {});
    }
  };

  const getNormCoords = (clientX: number, clientY: number) => {
    const vid = videoRef.current;
    if (!vid) return null;
    const rect = vid.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;

    // Account for object-contain letterboxing so clicks map accurately to video pixels
    const vw = vid.videoWidth || rect.width;
    const vh = vid.videoHeight || rect.height;
    const videoRatio = vw / vh;
    const rectRatio = rect.width / rect.height;

    let renderW = rect.width;
    let renderH = rect.height;
    let offsetX = 0;
    let offsetY = 0;

    if (videoRatio > rectRatio) {
      renderH = rect.width / videoRatio;
      offsetY = (rect.height - renderH) / 2;
    } else {
      renderW = rect.height * videoRatio;
      offsetX = (rect.width - renderW) / 2;
    }

    const x = Math.min(1, Math.max(0, (clientX - rect.left - offsetX) / renderW));
    const y = Math.min(1, Math.max(0, (clientY - rect.top - offsetY) / renderH));
    return { x: Number(x.toFixed(4)), y: Number(y.toFixed(4)) };
  };

  const scheduleMove = (x: number, y: number) => {
    pendingMoveRef.current = { x, y };
    if (rafMoveRef.current !== null) return;
    rafMoveRef.current = requestAnimationFrame(() => {
      rafMoveRef.current = null;
      if (pendingMoveRef.current) {
        onControlEvent({
          t: "m",
          x: pendingMoveRef.current.x,
          y: pendingMoveRef.current.y,
        });
        pendingMoveRef.current = null;
      }
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isSharingLocal) return;
    const coords = getNormCoords(e.clientX, e.clientY);
    if (coords) scheduleMove(coords.x, coords.y);
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isSharingLocal) return;
    containerRef.current?.focus();
    const coords = getNormCoords(e.clientX, e.clientY);
    if (!coords) return;
    const b = (e.button === 2 ? 2 : e.button === 1 ? 1 : 0) as 0 | 1 | 2;
    onControlEvent({ t: "d", b, x: coords.x, y: coords.y });
  };

  const handleMouseUp = (e: React.MouseEvent) => {
    if (isSharingLocal) return;
    const coords = getNormCoords(e.clientX, e.clientY);
    if (!coords) return;
    const b = (e.button === 2 ? 2 : e.button === 1 ? 1 : 0) as 0 | 1 | 2;
    onControlEvent({ t: "u", b, x: coords.x, y: coords.y });
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (isSharingLocal) return;
    onControlEvent({
      t: "w",
      dx: Math.round(e.deltaX),
      dy: Math.round(e.deltaY),
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isSharingLocal) return;
    // Allow browser DevTools / fullscreen Esc
    if (e.key === "F11" || e.key === "F12") return;
    e.preventDefault();
    onControlEvent({
      t: "kd",
      k: e.key,
      c: e.code,
      ctrl: e.ctrlKey,
      alt: e.altKey,
      shift: e.shiftKey,
      meta: e.metaKey,
    });
  };

  const handleKeyUp = (e: React.KeyboardEvent) => {
    if (isSharingLocal) return;
    onControlEvent({ t: "ku", k: e.key, c: e.code });
  };

  // Mobile touch handlers (Direct Touch vs Trackpad)
  const handleTouchStart = (e: React.TouchEvent) => {
    if (isSharingLocal) return;
    const t = e.touches[0];
    if (!t) return;
    if (touchMode === "direct") {
      const coords = getNormCoords(t.clientX, t.clientY);
      if (coords) {
        setCursorNorm(coords);
        onControlEvent({ t: "d", b: 0, x: coords.x, y: coords.y });
      }
    } else {
      lastTouchRef.current = { x: t.clientX, y: t.clientY, time: Date.now() };
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (isSharingLocal) return;
    const t = e.touches[0];
    if (!t) return;
    if (touchMode === "direct") {
      const coords = getNormCoords(t.clientX, t.clientY);
      if (coords) {
        setCursorNorm(coords);
        scheduleMove(coords.x, coords.y);
      }
    } else if (lastTouchRef.current) {
      const dx = (t.clientX - lastTouchRef.current.x) / 360;
      const dy = (t.clientY - lastTouchRef.current.y) / 360;
      lastTouchRef.current = {
        x: t.clientX,
        y: t.clientY,
        time: lastTouchRef.current.time,
      };
      const nx = Math.min(1, Math.max(0, cursorNorm.x + dx));
      const ny = Math.min(1, Math.max(0, cursorNorm.y + dy));
      setCursorNorm({ x: nx, y: ny });
      scheduleMove(Number(nx.toFixed(4)), Number(ny.toFixed(4)));
    }
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (isSharingLocal) return;
    if (touchMode === "direct") {
      onControlEvent({ t: "u", b: 0, x: cursorNorm.x, y: cursorNorm.y });
    } else if (lastTouchRef.current) {
      const elapsed = Date.now() - lastTouchRef.current.time;
      if (elapsed < 200) {
        // Quick tap = left click (2 fingers = right click)
        const b = e.changedTouches.length > 1 ? 2 : 0;
        onControlEvent({
          t: "c",
          b: b as 0 | 2,
          x: cursorNorm.x,
          y: cursorNorm.y,
        });
      }
      lastTouchRef.current = null;
    }
  };

  const sendQuickKey = (k: string, ctrl = false, alt = false, meta = false) => {
    onControlEvent({ t: "kd", k, c: k, ctrl, alt, meta });
    setTimeout(() => onControlEvent({ t: "ku", k, c: k }), 35);
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onKeyUp={handleKeyUp}
      className="fixed inset-0 z-30 flex flex-col bg-[#060608] outline-none select-none"
    >
      {/* Top Floating Control Bar */}
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-zinc-800/80 bg-[#0d0d11]/95 backdrop-blur-md px-3 py-2 text-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 shrink-0" />
          <div className="min-w-0">
            <span className="font-semibold text-zinc-100 truncate block sm:inline">
              {remoteAlias}
            </span>
            <span className="font-mono text-zinc-400 sm:ml-2 text-[11px]">
              {formatDeskId(remoteDeskId)}
            </span>
          </div>
          {isSharingLocal && (
            <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-red-500/15 border border-red-500/30 px-2 py-0.5 text-[11px] font-medium text-red-400">
              Sharing Screen
            </span>
          )}
          {agentConnected && (
            <span className="hidden md:inline-flex items-center gap-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 px-2 py-0.5 text-[11px] font-medium text-emerald-400">
              <ShieldCheck className="h-3 w-3" />
              OS Control Active
            </span>
          )}
        </div>

        {/* Live Telemetry Pill */}
        <div className="hidden lg:flex items-center gap-3 rounded-lg bg-zinc-900/90 border border-zinc-800 px-3 py-1 font-mono text-[11px] text-zinc-300">
          <span className="inline-flex items-center gap-1 text-emerald-400">
            <Wifi className="h-3 w-3" />
            {stats.connectionType}
          </span>
          <span>{stats.rttMs > 0 ? `${stats.rttMs} ms` : "-- ms"}</span>
          <span>{stats.fps > 0 ? `${stats.fps} fps` : "-- fps"}</span>
          <span>{stats.bitrateMbps > 0 ? `${stats.bitrateMbps} Mbps` : "-- Mbps"}</span>
          {stats.width > 0 && (
            <span className="text-zinc-400">
              {stats.width}×{stats.height}
            </span>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5">
          {isSharingLocal && onSwitchSource && (
            <>
              <button
                onClick={() => onSwitchSource("screen")}
                className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1.5 text-zinc-200 transition cursor-pointer"
                title="Switch to Screen Share"
              >
                <MonitorUp className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Screen</span>
              </button>
              <button
                onClick={() => onSwitchSource("camera")}
                className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1.5 text-zinc-200 transition cursor-pointer"
                title="Switch to Camera"
              >
                <Video className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Cam</span>
              </button>
            </>
          )}

          {!isSharingLocal && (
            <>
              <button
                onClick={() =>
                  setTouchMode((m) => (m === "direct" ? "trackpad" : "direct"))
                }
                className="inline-flex sm:hidden items-center gap-1 rounded-lg bg-zinc-800 px-2 py-1.5 text-zinc-200"
                title="Toggle Touch / Trackpad"
              >
                {touchMode === "direct" ? (
                  <Hand className="h-3.5 w-3.5" />
                ) : (
                  <MousePointer2 className="h-3.5 w-3.5" />
                )}
              </button>
              <button
                onClick={() => {
                  setShowMobileKeys((v) => !v);
                  hiddenInputRef.current?.focus();
                }}
                className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 transition cursor-pointer ${
                  showMobileKeys
                    ? "bg-red-600 text-white"
                    : "bg-zinc-800 hover:bg-zinc-700 text-zinc-200"
                }`}
                title="Quick Keys & Mobile Keyboard"
              >
                <Keyboard className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Keys</span>
              </button>
            </>
          )}

          <div className="relative">
            <button
              onClick={() => setShowQualityMenu((v) => !v)}
              className="inline-flex items-center gap-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1.5 text-zinc-200 transition cursor-pointer"
              title="Stream Quality & Latency"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              <span className="hidden sm:inline capitalize">{quality}</span>
            </button>
            {showQualityMenu && (
              <div className="absolute right-0 mt-2 w-52 rounded-xl border border-zinc-800 bg-[#141419] p-2 shadow-2xl z-50 space-y-1">
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Speed & Quality
                </p>
                {(["ultra", "balanced", "datasaver"] as QualityPreset[]).map(
                  (p) => (
                    <button
                      key={p}
                      onClick={() => {
                        onQualityChange(p, contentMode);
                        setShowQualityMenu(false);
                      }}
                      className={`w-full text-left rounded-lg px-2.5 py-1.5 text-xs flex items-center justify-between cursor-pointer ${
                        quality === p
                          ? "bg-red-600/20 text-red-400 font-medium"
                          : "text-zinc-300 hover:bg-zinc-800"
                      }`}
                    >
                      <span>
                        {p === "ultra"
                          ? "Ultra (60fps / 6 Mbps)"
                          : p === "balanced"
                          ? "Balanced (30fps)"
                          : "Data Saver (Mobile)"}
                      </span>
                    </button>
                  )
                )}
                <div className="border-t border-zinc-800 my-1" />
                <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
                  Optimize For
                </p>
                <div className="grid grid-cols-2 gap-1 px-1">
                  {(["detail", "motion"] as ContentMode[]).map((m) => (
                    <button
                      key={m}
                      onClick={() => {
                        onQualityChange(quality, m);
                        setShowQualityMenu(false);
                      }}
                      className={`rounded-lg py-1.5 text-xs font-medium cursor-pointer ${
                        contentMode === m
                          ? "bg-zinc-700 text-white"
                          : "bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                      }`}
                    >
                      {m === "detail" ? "Crisp Text" : "Smooth Video"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={onToggleSidePanel}
            className="relative inline-flex items-center gap-1 rounded-lg bg-zinc-800 hover:bg-zinc-700 px-2.5 py-1.5 text-zinc-200 transition cursor-pointer"
            title="Chat, Files & Clipboard"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Chat & Files</span>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full bg-red-500 px-1 text-[10px] font-bold text-white flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            onClick={toggleFullscreen}
            className="hidden sm:inline-flex items-center rounded-lg bg-zinc-800 hover:bg-zinc-700 p-1.5 text-zinc-200 transition cursor-pointer"
            title="Toggle Fullscreen"
          >
            {isFullscreen ? (
              <Minimize2 className="h-3.5 w-3.5" />
            ) : (
              <Maximize2 className="h-3.5 w-3.5" />
            )}
          </button>

          <button
            onClick={onDisconnect}
            className="inline-flex items-center gap-1 rounded-lg bg-red-600 hover:bg-red-500 px-3 py-1.5 font-semibold text-white transition cursor-pointer"
          >
            <PhoneOff className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">End</span>
          </button>
        </div>
      </header>

      {/* Main Video Viewport */}
      <div
        className="relative flex-1 flex items-center justify-center overflow-hidden bg-black touch-none"
        onContextMenu={(e) => e.preventDefault()}
        onMouseMove={handleMouseMove}
        onMouseDown={handleMouseDown}
        onMouseUp={handleMouseUp}
        onWheel={handleWheel}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        {remoteStream ? (
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted={isSharingLocal}
            className="h-full w-full object-contain pointer-events-none"
          />
        ) : (
          <div className="flex flex-col items-center gap-3 text-zinc-400">
            <div className="h-8 w-8 rounded-full border-2 border-red-500 border-t-transparent animate-spin" />
            <p className="text-sm">Establishing ultra-low-latency P2P stream…</p>
          </div>
        )}

        {/* Remote Pointer Overlay (for browser-only / collaborative sessions) */}
        {isSharingLocal && remotePointer?.visible && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1/2 -translate-y-1/2 transition-transform duration-75"
            style={{
              left: `${remotePointer.x * 100}%`,
              top: `${remotePointer.y * 100}%`,
            }}
          >
            <div className="h-5 w-5 rounded-full bg-red-500/80 ring-4 ring-red-500/30 shadow-lg" />
          </div>
        )}

        {/* Trackpad virtual cursor when controlling on mobile */}
        {!isSharingLocal && touchMode === "trackpad" && (
          <div
            className="pointer-events-none absolute z-20 -translate-x-1 -translate-y-1"
            style={{
              left: `${cursorNorm.x * 100}%`,
              top: `${cursorNorm.y * 100}%`,
            }}
          >
            <MousePointer2 className="h-5 w-5 text-red-400 drop-shadow-[0_2px_4px_rgba(0,0,0,0.9)]" />
          </div>
        )}

        {/* Mobile compact stats badge */}
        <div className="lg:hidden absolute bottom-3 left-3 rounded-lg bg-black/70 backdrop-blur-md border border-zinc-800 px-2.5 py-1 font-mono text-[10px] text-zinc-300 pointer-events-none">
          {stats.rttMs > 0 ? `${stats.rttMs}ms` : "--"} ·{" "}
          {stats.fps > 0 ? `${stats.fps}fps` : "--"}
        </div>
      </div>

      {/* Hidden input to trigger mobile soft keyboard when needed */}
      <input
        ref={hiddenInputRef}
        type="text"
        className="sr-only"
        aria-hidden="true"
        onChange={(e) => {
          const val = e.target.value;
          if (val) {
            const ch = val[val.length - 1];
            sendQuickKey(ch);
            e.target.value = "";
          }
        }}
      />

      {/* Quick Keys Bar (Mobile & Power Users) */}
      {showMobileKeys && !isSharingLocal && (
        <div className="border-t border-zinc-800 bg-[#0e0e12] px-2 py-2 flex items-center gap-1.5 overflow-x-auto text-xs">
          {[
            { label: "Esc", action: () => sendQuickKey("Escape") },
            { label: "Tab", action: () => sendQuickKey("Tab") },
            { label: "Enter", action: () => sendQuickKey("Enter") },
            { label: "Bksp", action: () => sendQuickKey("Backspace") },
            { label: "Copy", action: () => sendQuickKey("c", true) },
            { label: "Paste", action: () => sendQuickKey("v", true) },
            { label: "Alt+Tab", action: () => sendQuickKey("Tab", false, true) },
            { label: "Win", action: () => sendQuickKey("Meta", false, false, true) },
            { label: "←", action: () => sendQuickKey("ArrowLeft") },
            { label: "↑", action: () => sendQuickKey("ArrowUp") },
            { label: "↓", action: () => sendQuickKey("ArrowDown") },
            { label: "→", action: () => sendQuickKey("ArrowRight") },
          ].map((btn) => (
            <button
              key={btn.label}
              onClick={btn.action}
              className="shrink-0 rounded-lg border border-zinc-800 bg-zinc-900 active:bg-red-600 px-3 py-1.5 font-medium text-zinc-200"
            >
              {btn.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
