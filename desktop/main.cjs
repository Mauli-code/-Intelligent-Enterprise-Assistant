const { app, BrowserWindow, dialog } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const backendPort = 3001;
let backendServer;
let mainWindow;

async function startBackend() {
  try {
    const response = await fetch(`http://127.0.0.1:${backendPort}/api/health`);
    if (response.ok) return;
  } catch {
    // Start the bundled backend when no healthy instance is available.
  }

  process.env.IEA_MANAGED_SERVER = "true";
  process.env.PORT = String(backendPort);
  process.env.DATABASE_PATH = path.join(app.getPath("userData"), "assistant.db");
  process.env.IEA_KNOWLEDGE_DIR = path.join(app.getAppPath(), "knowledge");
  process.env.DOTENV_CONFIG_PATH = path.join(app.getPath("userData"), ".env");

  const serverModule = await import(
    pathToFileURL(path.join(app.getAppPath(), "server", "index.js")).href
  );
  backendServer = await new Promise((resolve, reject) => {
    const server = serverModule.startServer();
    server.once("listening", () => resolve(server));
    server.once("error", reject);
  });
}

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  await mainWindow.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
}

async function showStartupError(error) {
  console.error("Desktop application startup failed.");
  await dialog.showMessageBox({
    type: "error",
    title: "Intelligent Enterprise Assistant",
    message: "The application could not start its backend.",
    detail: "Check that port 3001 is available, then restart the application.",
  });
  console.error(error);
  app.quit();
}

app.whenReady().then(async () => {
  try {
    await startBackend();
    await createWindow();
  } catch (error) {
    await showStartupError(error);
  }
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  backendServer?.close();
});

app.on("activate", async () => {
  if (BrowserWindow.getAllWindows().length === 0) await createWindow();
});
