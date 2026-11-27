declare global {
  interface Window {
    AnyCraftNative?: {
      startScreenShare: () => void;
      stopScreenShare: () => void;
      isNativeAndroid?: boolean;
    };
    __anycraftNativeFrame?: (base64Jpeg: string, w: number, h: number) => void;
    __anycraftNativeStarted?: () => void;
    __anycraftNativeError?: (msg: string) => void;
  }
}

export function isNativeMobileBridge(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean(window.AnyCraftNative?.startScreenShare);
}

/**
 * Captures the Android screen via the native MediaProjection bridge into a
 * standard WebRTC-compatible MediaStream using an offscreen canvas.
 */
export function captureNativeAndroidScreen(): Promise<MediaStream> {
  return new Promise((resolve, reject) => {
    const bridge = window.AnyCraftNative;
    if (!bridge) {
      reject(new Error("Native Android screen-share bridge not available."));
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 720;
    canvas.height = 1280;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("Canvas 2D context unavailable."));
      return;
    }

    // Paint initial frame so captureStream has a live video track immediately
    ctx.fillStyle = "#09090b";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#e4e4e7";
    ctx.font = "bold 28px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Connecting mobile screen...", canvas.width / 2, canvas.height / 2);

    let settled = false;
    const cleanupCallbacks = () => {
      window.__anycraftNativeStarted = undefined;
      window.__anycraftNativeError = undefined;
    };

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        cleanupCallbacks();
        reject(new Error("Timed out waiting for Android screen permission."));
      }
    }, 30000);

    const resolveStream = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanupCallbacks();
      const stream = canvas.captureStream(24);
      const track = stream.getVideoTracks()[0];
      const origStop = track.stop.bind(track);
      track.stop = () => {
        window.__anycraftNativeFrame = undefined;
        bridge.stopScreenShare();
        origStop();
      };
      resolve(stream);
    };

    window.__anycraftNativeStarted = () => {
      resolveStream();
    };

    window.__anycraftNativeError = (msg: string) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        cleanupCallbacks();
        window.__anycraftNativeFrame = undefined;
        reject(new Error(msg || "Screen capture permission denied."));
      }
    };

    const img = new Image();
    let drawing = false;

    window.__anycraftNativeFrame = (b64: string, w: number, h: number) => {
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
      if (!settled) resolveStream();
      if (drawing) return;
      drawing = true;
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        drawing = false;
      };
      img.onerror = () => {
        drawing = false;
      };
      img.src = `data:image/jpeg;base64,${b64}`;
    };

    bridge.startScreenShare();
  });
}
