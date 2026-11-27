import type { DeviceType, PeerInfo } from "./types";

const ID_KEY = "anycraft_desk_id";
const ALIAS_KEY = "anycraft_alias";
const PASS_KEY = "anycraft_passcode";
const UNATTENDED_KEY = "anycraft_unattended";
const RECENTS_KEY = "anycraft_recents";

export function generateDeskId(): string {
  // 9-digit ID starting with 1-9
  const first = Math.floor(1 + Math.random() * 9);
  const rest = Math.floor(Math.random() * 100_000_000)
    .toString()
    .padStart(8, "0");
  return `${first}${rest}`;
}

export function generatePasscode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

export function formatDeskId(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 9);
  return d.replace(/(\d{3})(?=\d)/g, "$1 ").trim();
}

export function normalizeDeskId(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 9);
}

export function detectDeviceType(): DeviceType {
  if (typeof navigator === "undefined") return "desktop";
  const ua = navigator.userAgent.toLowerCase();
  if (/ipad|tablet|playbook|silk|(android(?!.*mobile))/.test(ua)) {
    return "tablet";
  }
  if (/iphone|ipod|android.*mobile|windows phone|blackberry/.test(ua)) {
    return "mobile";
  }
  return "desktop";
}

export function detectDefaultAlias(): string {
  if (typeof navigator === "undefined") return "My Device";
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android Mobile";
  if (/Windows/.test(ua)) return "Windows PC";
  if (/Mac OS X/.test(ua)) return "MacBook";
  if (/Linux/.test(ua)) return "Linux PC";
  return "AnyCraft Device";
}

export function supportsScreenShare(): boolean {
  if (typeof navigator === "undefined") return false;
  const hasWeb = Boolean(
    navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia
  );
  const hasNative =
    typeof window !== "undefined" &&
    Boolean(
      (window as unknown as { AnyCraftNative?: { startScreenShare?: unknown } })
        .AnyCraftNative?.startScreenShare
    );
  return hasWeb || hasNative;
}

export function loadOrCreateIdentity() {
  if (typeof window === "undefined") {
    return {
      deskId: "000000000",
      alias: "AnyCraft Device",
      passcode: "ANY123",
      unattended: false,
      deviceType: "desktop" as DeviceType,
    };
  }
  let deskId = localStorage.getItem(ID_KEY);
  if (!deskId || deskId.length !== 9) {
    deskId = generateDeskId();
    localStorage.setItem(ID_KEY, deskId);
  }

  let alias = localStorage.getItem(ALIAS_KEY);
  if (!alias) {
    alias = detectDefaultAlias();
    localStorage.setItem(ALIAS_KEY, alias);
  }

  let passcode = localStorage.getItem(PASS_KEY);
  if (!passcode) {
    passcode = generatePasscode();
    localStorage.setItem(PASS_KEY, passcode);
  }

  const unattended = localStorage.getItem(UNATTENDED_KEY) === "true";
  const deviceType = detectDeviceType();

  return { deskId, alias, passcode, unattended, deviceType };
}

export function saveIdentityField(
  key: "alias" | "passcode" | "unattended",
  value: string | boolean
) {
  if (typeof window === "undefined") return;
  if (key === "alias") localStorage.setItem(ALIAS_KEY, String(value));
  if (key === "passcode") localStorage.setItem(PASS_KEY, String(value));
  if (key === "unattended") localStorage.setItem(UNATTENDED_KEY, String(value));
}

export function loadRecentPeers(): PeerInfo[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(RECENTS_KEY);
    return raw ? (JSON.parse(raw) as PeerInfo[]) : [];
  } catch {
    return [];
  }
}

export function saveRecentPeer(peer: PeerInfo): PeerInfo[] {
  const existing = loadRecentPeers().filter((p) => p.deskId !== peer.deskId);
  const updated = [
    { ...peer, lastConnectedAt: Date.now() },
    ...existing,
  ].slice(0, 12);
  if (typeof window !== "undefined") {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(updated));
  }
  return updated;
}
