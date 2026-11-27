declare global {
  interface Window {
    AnyCraftNative?: {
      startScreenShare: () => void;
      stopScreenShare: () => void;
      isNativeAndroid?: boolean;
    };
    __anycraftNativeFrame?: (base64Jpeg: string, w: number, h: number) => void;
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

    let resolved = false;
    const timeout = setTimeout(() => {
      if (!resolved) {
        reject(new Error("Timed out waiting for Android screen permission."));
      }
    }, 20000);

    const img = new Image();
    let drawing = false;

    window.__anycraftNativeFrame = (b64: string, w: number, h: number) => {
      if (w > 0 && h > 0 && (canvas.width !== w || canvas.height !== h)) {
        canvas.width = w;
        canvas.height = h;
      }
      if (drawing) return;
      drawing = true;
      img.onload = () => {
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        drawing = false;
        if (!resolved) {
          resolved = true;
          clearTimeout(timeout);
          const stream = canvas.captureStream(24);
          const track = stream.getVideoTracks()[0];
          const origStop = track.stop.bind(track);
          track.stop = () => {
            window.__anycraftNativeFrame = undefined;
            bridge.stopScreenShare();
            origStop();
          };
          resolve(stream);
        }
      };
      img.onerror = () => {
        drawing = false;
      };
      img.src = `data:image/jpeg;base64,${b64}`;
    };

    bridge.startScreenShare();
  });
}
