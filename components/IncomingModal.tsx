"use client";

import { Monitor, Smartphone, Tablet, ShieldCheck, X, Video, MonitorUp } from "lucide-react";
import type { IncomingRequest } from "@/lib/types";
import { formatDeskId } from "@/lib/identity";

interface IncomingModalProps {
  request: IncomingRequest | null;
  canScreenShare: boolean;
  onAccept: (source: "screen" | "camera") => void;
  onReject: () => void;
}

export function IncomingModal({
  request,
  canScreenShare,
  onAccept,
  onReject,
}: IncomingModalProps) {
  if (!request) return null;

  const DeviceIcon =
    request.fromDeviceType === "mobile"
      ? Smartphone
      : request.fromDeviceType === "tablet"
      ? Tablet
      : Monitor;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-[#121216] p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-red-500/15 text-red-400 border border-red-500/25">
              <DeviceIcon className="h-6 w-6" />
            </div>
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-red-400">
                <span className="h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                {request.mode === "videocall"
                  ? "Incoming Video Call"
                  : "Incoming Connection"}
              </span>
              <h3 className="text-lg font-semibold text-zinc-100 mt-0.5">
                {request.fromAlias}
              </h3>
              <p className="font-mono text-xs text-zinc-400">
                ID: {formatDeskId(request.fromDeskId)}
              </p>
            </div>
          </div>
          <button
            onClick={onReject}
            className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition"
            aria-label="Reject"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-4 flex items-center gap-2 rounded-xl bg-zinc-900/90 border border-zinc-800/80 px-3.5 py-2.5 text-xs text-zinc-400">
          <ShieldCheck className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>
            Encrypted peer-to-peer WebRTC session. You can stop sharing anytime.
          </span>
        </div>

        <div className="mt-5 flex flex-col sm:flex-row gap-2.5">
          {request.mode === "videocall" ? (
            <button
              onClick={() => onAccept("camera")}
              className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition cursor-pointer"
            >
              <Video className="h-4 w-4" />
              Answer Video Call
            </button>
          ) : (
            <>
              {canScreenShare && (
                <button
                  onClick={() => onAccept("screen")}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 px-4 py-3 text-sm font-semibold text-white transition cursor-pointer"
                >
                  <MonitorUp className="h-4 w-4" />
                  Accept & Share Screen
                </button>
              )}
              <button
                onClick={() => onAccept("camera")}
                className={`flex-1 inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition cursor-pointer ${
                  canScreenShare
                    ? "bg-zinc-800 hover:bg-zinc-700 text-zinc-100"
                    : "bg-emerald-600 hover:bg-emerald-500 text-white"
                }`}
              >
                <Video className="h-4 w-4" />
                {canScreenShare ? "Share Camera" : "Accept & Share Camera"}
              </button>
            </>
          )}
          <button
            onClick={onReject}
            className="inline-flex items-center justify-center rounded-xl bg-red-500/15 hover:bg-red-500/25 border border-red-500/30 px-4 py-3 text-sm font-semibold text-red-400 transition cursor-pointer"
          >
            {request.mode === "videocall" ? "Decline" : "Dismiss"}
          </button>
        </div>

        {request.mode !== "videocall" && !canScreenShare && (
          <p className="mt-3 text-[11px] text-zinc-500 text-center">
            This mobile browser does not expose screen capture (e.g. iOS Safari
            blocks web screen sharing). Use Android Chrome on HTTPS for mobile
            screen share, or use Camera above.
          </p>
        )}
      </div>
    </div>
  );
}
