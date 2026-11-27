const { app, BrowserWindow, session, desktopCapturer } = require("electron");

const TARGET_URL = process.env.ANYCRAFT_URL || "https://anycraft.onrender.com";

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 820,
    minHeight: 600,
    backgroundColor: "#09090b",
    title: "AnyCraft",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Auto-grant screen capture for primary display (1-click accept like AnyDesk)
  session.defaultSession.setDisplayMediaRequestHandler(
    (_request, callback) => {
      desktopCapturer
        .getSources({ types: ["screen"] })
        .then((sources) => {
          if (sources.length > 0) {
            callback({ video: sources[0] });
          } else {
            callback({});
          }
        })
        .catch(() => callback({}));
    }
  );

  // Allow WebRTC camera/mic/clipboard/local-network permissions
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => {
      callback(true);
    }
  );

  win.loadURL(TARGET_URL);
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
