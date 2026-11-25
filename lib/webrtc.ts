import type {
  ContentMode,
  ControlEvent,
  QualityPreset,
  ReliableEvent,
  TelemetryStats,
} from "./types";

const ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
  { urls: "stun:stun.cloudflare.com:3478" },
];

export const QUALITY_CONFIG: Record<
  QualityPreset,
  { maxBitrate: number; maxFramerate: number; scaleDownBy: number }
> = {
  ultra: { maxBitrate: 6_000_000, maxFramerate: 60, scaleDownBy: 1 },
  balanced: { maxBitrate: 2_500_000, maxFramerate: 30, scaleDownBy: 1 },
  datasaver: { maxBitrate: 900_000, maxFramerate: 24, scaleDownBy: 1.5 },
};

export interface PeerCallbacks {
  onIceCandidate: (candidate: RTCIceCandidateInit) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onControlEvent: (ev: ControlEvent) => void;
  onReliableEvent: (ev: ReliableEvent) => void;
  onConnectionState: (state: RTCPeerConnectionState) => void;
}

export class AnyCraftPeer {
  public pc: RTCPeerConnection;
  private controlChannel: RTCDataChannel | null = null;
  private reliableChannel: RTCDataChannel | null = null;
  private callbacks: PeerCallbacks;
  private pendingIce: RTCIceCandidateInit[] = [];
  private remoteDescSet = false;
  private prevBytes = 0;
  private prevBytesTime = 0;

  constructor(isInitiator: boolean, callbacks: PeerCallbacks) {
    this.callbacks = callbacks;
    this.pc = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
      iceCandidatePoolSize: 4,
    });

    this.pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.callbacks.onIceCandidate(e.candidate.toJSON());
      }
    };

    this.pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      this.callbacks.onRemoteStream(stream);
    };

    this.pc.onconnectionstatechange = () => {
      this.callbacks.onConnectionState(this.pc.connectionState);
    };

    if (isInitiator) {
      // Unordered zero-retransmit channel for ultra-fast mouse/keyboard input
      const ctrl = this.pc.createDataChannel("control", {
        ordered: false,
        maxRetransmits: 0,
      });
      this.setupControlChannel(ctrl);

      // Reliable ordered channel for files, clipboard, chat, quality sync
      const rel = this.pc.createDataChannel("reliable", {
        ordered: true,
      });
      this.setupReliableChannel(rel);
    } else {
      this.pc.ondatachannel = (e) => {
        if (e.channel.label === "control") {
          this.setupControlChannel(e.channel);
        } else if (e.channel.label === "reliable") {
          this.setupReliableChannel(e.channel);
        }
      };
    }
  }

  private setupControlChannel(ch: RTCDataChannel) {
    this.controlChannel = ch;
    ch.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data as string) as ControlEvent;
        this.callbacks.onControlEvent(ev);
      } catch {
        // Ignore
      }
    };
  }

  private setupReliableChannel(ch: RTCDataChannel) {
    this.reliableChannel = ch;
    ch.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data as string) as ReliableEvent;
        this.callbacks.onReliableEvent(ev);
      } catch {
        // Ignore
      }
    };
  }

  sendControl(ev: ControlEvent) {
    if (this.controlChannel && this.controlChannel.readyState === "open") {
      // Drop mouse move if buffer is congested to keep latency zero
      if (ev.t === "m" && this.controlChannel.bufferedAmount > 8192) return;
      this.controlChannel.send(JSON.stringify(ev));
    }
  }

  sendReliable(ev: ReliableEvent) {
    if (this.reliableChannel && this.reliableChannel.readyState === "open") {
      this.reliableChannel.send(JSON.stringify(ev));
    }
  }

  async sendFile(
    file: File,
    onProgress?: (pct: number) => void
  ): Promise<void> {
    if (!this.reliableChannel || this.reliableChannel.readyState !== "open") {
      throw new Error("Data channel is not open");
    }
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const chunkSize = 48 * 1024; // 48KB raw -> ~64KB base64, safe for all WebRTC SCTP limits
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const total = Math.max(1, Math.ceil(bytes.length / chunkSize));

    this.sendReliable({
      t: "fmeta",
      id,
      name: file.name,
      size: file.size,
      mime: file.type || "application/octet-stream",
    });

    for (let idx = 0; idx < total; idx++) {
      const slice = bytes.subarray(idx * chunkSize, (idx + 1) * chunkSize);
      let binary = "";
      for (let i = 0; i < slice.length; i++) {
        binary += String.fromCharCode(slice[i]);
      }
      const data = btoa(binary);

      // Backpressure guard
      while (
        this.reliableChannel &&
        this.reliableChannel.bufferedAmount > 512 * 1024
      ) {
        await new Promise((r) => setTimeout(r, 15));
      }

      this.sendReliable({ t: "fchunk", id, idx, total, data });
      onProgress?.(Math.round(((idx + 1) / total) * 100));
    }
  }

  attachLocalStream(
    stream: MediaStream,
    preset: QualityPreset = "ultra",
    mode: ContentMode = "detail"
  ) {
    for (const track of stream.getTracks()) {
      if (track.kind === "video" && "contentHint" in track) {
        track.contentHint = mode;
      }
      const sender = this.pc.addTrack(track, stream);
      if (track.kind === "video") {
        this.applyVideoQuality(sender, preset);
      }
    }
  }

  async replaceVideoTrack(
    newTrack: MediaStreamTrack,
    preset: QualityPreset = "ultra",
    mode: ContentMode = "detail"
  ) {
    if ("contentHint" in newTrack) {
      newTrack.contentHint = mode;
    }
    const sender = this.pc
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");
    if (sender) {
      await sender.replaceTrack(newTrack);
      await this.applyVideoQuality(sender, preset);
    }
  }

  async applyQualityToSenders(preset: QualityPreset, mode: ContentMode) {
    for (const sender of this.pc.getSenders()) {
      if (sender.track?.kind === "video") {
        if ("contentHint" in sender.track) {
          sender.track.contentHint = mode;
        }
        await this.applyVideoQuality(sender, preset);
      }
    }
  }

  private async applyVideoQuality(
    sender: RTCRtpSender,
    preset: QualityPreset
  ) {
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      const cfg = QUALITY_CONFIG[preset];
      params.encodings[0].maxBitrate = cfg.maxBitrate;
      params.encodings[0].maxFramerate = cfg.maxFramerate;
      params.encodings[0].scaleResolutionDownBy = cfg.scaleDownBy;
      params.degradationPreference = "maintain-framerate";
      await sender.setParameters(params);
    } catch {
      // Some browsers restrict setParameters fields
    }
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const offer = await this.pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await this.pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(
    sdp: RTCSessionDescriptionInit
  ): Promise<RTCSessionDescriptionInit> {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.remoteDescSet = true;
    await this.flushIce();
    const answer = await this.pc.createAnswer();
    await this.pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(sdp: RTCSessionDescriptionInit) {
    await this.pc.setRemoteDescription(new RTCSessionDescription(sdp));
    this.remoteDescSet = true;
    await this.flushIce();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit) {
    if (!this.remoteDescSet) {
      this.pendingIce.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore stale candidate
    }
  }

  private async flushIce() {
    while (this.pendingIce.length > 0) {
      const c = this.pendingIce.shift()!;
      try {
        await this.pc.addIceCandidate(new RTCIceCandidate(c));
      } catch {
        // Ignore
      }
    }
  }

  async getStats(): Promise<TelemetryStats> {
    const stats = await this.pc.getStats();
    let rttMs = 0;
    let fps = 0;
    let width = 0;
    let height = 0;
    let totalBytes = 0;
    let packetsLost = 0;
    let packetsReceived = 0;
    let connectionType: TelemetryStats["connectionType"] = "Connecting";

    stats.forEach((report) => {
      if (
        report.type === "candidate-pair" &&
        report.state === "succeeded" &&
        report.nominated
      ) {
        if (typeof report.currentRoundTripTime === "number") {
          rttMs = Math.round(report.currentRoundTripTime * 1000);
        }
        connectionType = "Direct P2P";
      }
      if (report.type === "remote-candidate" && report.candidateType === "relay") {
        connectionType = "Relayed";
      }
      if (report.type === "inbound-rtp" && report.kind === "video") {
        fps = Math.round(report.framesPerSecond || 0);
        width = report.frameWidth || 0;
        height = report.frameHeight || 0;
        totalBytes = report.bytesReceived || 0;
        packetsLost = report.packetsLost || 0;
        packetsReceived = report.packetsReceived || 0;
      }
      if (
        report.type === "outbound-rtp" &&
        report.kind === "video" &&
        totalBytes === 0
      ) {
        fps = Math.round(report.framesPerSecond || 0);
        width = report.frameWidth || 0;
        height = report.frameHeight || 0;
        totalBytes = report.bytesSent || 0;
      }
    });

    const now = performance.now();
    let bitrateMbps = 0;
    if (this.prevBytesTime > 0 && totalBytes >= this.prevBytes) {
      const dt = (now - this.prevBytesTime) / 1000;
      if (dt > 0) {
        bitrateMbps = Number(
          (((totalBytes - this.prevBytes) * 8) / dt / 1_000_000).toFixed(2)
        );
      }
    }
    this.prevBytes = totalBytes;
    this.prevBytesTime = now;

    const totalPkts = packetsReceived + packetsLost;
    const packetLossPct =
      totalPkts > 0 ? Number(((packetsLost / totalPkts) * 100).toFixed(2)) : 0;

    return {
      rttMs,
      fps,
      bitrateMbps,
      width,
      height,
      packetLossPct,
      connectionType,
    };
  }

  close() {
    try {
      this.controlChannel?.close();
      this.reliableChannel?.close();
      this.pc.close();
    } catch {
      // Ignore
    }
  }
}
