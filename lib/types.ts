export type DeviceType = "desktop" | "mobile" | "tablet";

export type QualityPreset = "ultra" | "balanced" | "datasaver";
export type ContentMode = "detail" | "motion";

export interface PeerInfo {
  deskId: string;
  alias: string;
  deviceType: DeviceType;
  online?: boolean;
  lastConnectedAt?: number;
}

export interface IncomingRequest {
  fromDeskId: string;
  fromAlias: string;
  fromDeviceType: DeviceType;
  passcodeProvided?: boolean;
}

export type SignalingMessage =
  | {
      type: "register";
      deskId: string;
      alias: string;
      deviceType: DeviceType;
      passcode: string;
      unattended: boolean;
    }
  | {
      type: "registered";
      deskId: string;
      serverTime: number;
      onlineCount: number;
    }
  | {
      type: "connect-request";
      targetDeskId: string;
      fromDeskId: string;
      fromAlias: string;
      fromDeviceType: DeviceType;
      passcode?: string;
    }
  | {
      type: "incoming-request";
      fromDeskId: string;
      fromAlias: string;
      fromDeviceType: DeviceType;
    }
  | {
      type: "connect-accept";
      targetDeskId: string;
      fromDeskId: string;
      fromAlias: string;
      fromDeviceType: DeviceType;
      autoAccepted?: boolean;
    }
  | {
      type: "connect-reject";
      targetDeskId: string;
      fromDeskId: string;
      reason: string;
    }
  | {
      type: "rtc-offer";
      targetDeskId: string;
      fromDeskId: string;
      sdp: RTCSessionDescriptionInit;
    }
  | {
      type: "rtc-answer";
      targetDeskId: string;
      fromDeskId: string;
      sdp: RTCSessionDescriptionInit;
    }
  | {
      type: "rtc-ice";
      targetDeskId: string;
      fromDeskId: string;
      candidate: RTCIceCandidateInit;
    }
  | {
      type: "disconnect-peer";
      targetDeskId: string;
      fromDeskId: string;
    }
  | {
      type: "peer-error";
      code: "OFFLINE" | "INVALID_PASSCODE" | "SELF_CONNECT" | "REJECTED";
      message: string;
    }
  | {
      type: "presence-check";
      deskIds: string[];
    }
  | {
      type: "presence-result";
      statuses: Record<string, boolean>;
    }
  | {
      type: "ping";
      ts: number;
    }
  | {
      type: "pong";
      ts: number;
      serverTs: number;
      onlineCount: number;
    };

// Ultra-low-latency unordered DataChannel messages (normalized 0..1 coords)
export type ControlEvent =
  | { t: "m"; x: number; y: number }
  | { t: "d"; b: 0 | 1 | 2; x: number; y: number }
  | { t: "u"; b: 0 | 1 | 2; x: number; y: number }
  | { t: "c"; b: 0 | 1 | 2; x: number; y: number; dbl?: boolean }
  | { t: "w"; dx: number; dy: number }
  | {
      t: "kd";
      k: string;
      c: string;
      ctrl?: boolean;
      alt?: boolean;
      shift?: boolean;
      meta?: boolean;
    }
  | { t: "ku"; k: string; c: string };

// Reliable ordered DataChannel messages
export type ReliableEvent =
  | { t: "chat"; id: string; sender: string; text: string; ts: number }
  | { t: "clip"; text: string }
  | { t: "fmeta"; id: string; name: string; size: number; mime: string }
  | { t: "fchunk"; id: string; idx: number; total: number; data: string }
  | { t: "qual"; preset: QualityPreset; mode: ContentMode }
  | { t: "agent"; active: boolean; platform?: string };

export interface TelemetryStats {
  rttMs: number;
  fps: number;
  bitrateMbps: number;
  width: number;
  height: number;
  packetLossPct: number;
  connectionType: "Direct P2P" | "Relayed" | "Connecting";
}
