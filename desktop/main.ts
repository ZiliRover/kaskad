/**
 * Kaskad for Windows: a launcher with no window of its own. It starts the bundled Postgres,
 * the Next.js server and the generation worker on this computer, then opens Kaskad in the
 * person's browser, signed in. A tray icon reopens it or quits.
 *
 * Everything the person makes lives in %APPDATA%\Kaskad (database, files, settings with
 * their OpenRouter key). Built by scripts/build-desktop.mjs; layout of the resources:
 *   server/  Next.js standalone build      worker/worker.cjs  generation worker
 *   drizzle/ migrations                    pg/bin             Postgres binaries
 *   ffmpeg/  ffmpeg.exe, ffprobe.exe       tray.png
 */
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { app, BrowserWindow, dialog, Menu, nativeImage, shell, Tray } from "electron";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import { clusterComplete, dataDir, initClusterAsync, shortPath, startServer, stopServer } from "../scripts/pg-local";

const PREFERRED_PORT = 47790;
const DB_NAME = "kaskad";

app.setPath("userData", path.join(app.getPath("appData"), "Kaskad"));
const DATA = app.getPath("userData");
const RES = process.env.KASKAD_RESOURCES || process.resourcesPath;
const SETTINGS = path.join(DATA, "settings.json");
const LOG_DIR = path.join(DATA, "logs");

let tray: Tray | null = null;
let splash: BrowserWindow | null = null;
let web: ChildProcess | null = null;
let worker: ChildProcess | null = null;
let pg: ChildProcess | null = null;
let url = "";
let quitting = false;

function log(line: string) {
  try { appendFileSync(path.join(LOG_DIR, "kaskad.log"), `${new Date().toISOString()} ${line.trimEnd()}\n`); } catch { /* logging must never break the app */ }
}

interface Settings { desktopToken?: string; pgPassword?: string; fileSecret?: string; openrouterKey?: string }

/** One-time secrets, made on first launch; the server writes openrouterKey into the same file. */
function settings(): Required<Pick<Settings, "desktopToken" | "pgPassword" | "fileSecret">> {
  let s: Settings = {};
  try { s = JSON.parse(readFileSync(SETTINGS, "utf8")); } catch { /* first launch */ }
  const filled = {
    ...s,
    desktopToken: s.desktopToken ?? randomBytes(32).toString("base64url"),
    pgPassword: s.pgPassword ?? randomBytes(18).toString("base64url"),
    fileSecret: s.fileSecret ?? randomBytes(32).toString("base64url"),
  };
  if (filled.desktopToken !== s.desktopToken || filled.pgPassword !== s.pgPassword || filled.fileSecret !== s.fileSecret) {
    writeFileSync(SETTINGS, JSON.stringify(filled, null, 2), { mode: 0o600 });
  }
  return filled;
}

function freePort(preferred: number): Promise<number> {
  const tryPort = (p: number) => new Promise<number>((resolve, reject) => {
    const srv = net.createServer();
    srv.once("error", reject);
    srv.listen(p, "127.0.0.1", () => { const got = (srv.address() as net.AddressInfo).port; srv.close(() => resolve(got)); });
  });
  return tryPort(preferred).catch(() => tryPort(0));
}

async function waitFor(check: () => Promise<boolean>, ms: number, what: string) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check().catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${what} не запустился вовремя`);
}

function pipeLog(name: string, p: ChildProcess) {
  p.stdout?.on("data", (d) => log(`[${name}] ${d}`));
  p.stderr?.on("data", (d) => log(`[${name}] ${d}`));
}

/**
 * Postgres processes of this install left by a crash or a killed launch. We hold the
 * single-instance lock, so anything running from our binaries is an orphan.
 */
function killOrphans(): Promise<void> {
  const script =
    "$dirs = @($env:KASKAD_BIN_LONG, $env:KASKAD_BIN_SHORT) | ForEach-Object { $_.ToLower().Replace('/', '\\') };" +
    "Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'postgres.exe','initdb.exe','pg_ctl.exe' } | Where-Object {" +
    " $p = (($_.ExecutablePath, $_.CommandLine) -join ' ').ToLower().Replace('/', '\\'); ($dirs | Where-Object { $p.Contains($_) }).Count -gt 0" +
    "} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }";
  const long = path.join(RES, "pg", "bin");
  return new Promise((resolve) => {
    const p = spawn("powershell", ["-NoProfile", "-NonInteractive", "-Command", script], {
      windowsHide: true, stdio: "ignore", env: { ...process.env, KASKAD_BIN_LONG: long, KASKAD_BIN_SHORT: shortPath(long) },
    });
    p.on("exit", () => resolve());
    p.on("error", () => resolve());
  });
}

async function startDatabase(password: string): Promise<string> {
  process.env.KASKAD_PG_BIN = path.join(RES, "pg", "bin");
  process.env.KASKAD_PG_PARENT = DATA;
  await killOrphans();
  const dir = dataDir();
  if (!clusterComplete(dir)) {
    // never-finished init (nothing was ever stored there): start over, keep the remains aside
    if (existsSync(dir)) {
      rmSync(`${dir}-incomplete`, { recursive: true, force: true });
      renameSync(dir, `${dir}-incomplete`);
    }
    setSplash("Первый запуск: готовим базу данных. Это может занять пару минут…");
    // build it under another name and rename at the end: .pgdata is either whole or absent
    const fresh = dataDir(".pgdata-init");
    rmSync(fresh, { recursive: true, force: true });
    await initClusterAsync("postgres", password, fresh, (l) => log(`[initdb] ${l}`));
    renameSync(fresh, dir);
    setSplash("Запускаем Каскад…");
  }
  const port = await freePort(0);
  pg = startServer(port, (l) => log(`[pg] ${l}`));
  pg.on("exit", (code) => { if (!quitting) fail(new Error(`база данных остановилась (код ${code})`)); });
  const admin = () => postgres({ host: "127.0.0.1", port, username: "postgres", password, database: "postgres", max: 1, connect_timeout: 2, onnotice: () => {} });
  await waitFor(async () => { const c = admin(); try { await c`select 1`; return true; } finally { await c.end().catch(() => {}); } }, 60_000, "База данных");
  const a = admin();
  if (!(await a`select 1 from pg_database where datname = ${DB_NAME}`).length) await a.unsafe(`create database "${DB_NAME}"`);
  await a.end();
  const dbUrl = `postgres://postgres:${encodeURIComponent(password)}@127.0.0.1:${port}/${DB_NAME}`;
  const client = postgres(dbUrl, { max: 1, onnotice: () => {} });
  await migrate(drizzle(client), { migrationsFolder: path.join(RES, "drizzle") });
  await client.end();
  return dbUrl;
}

async function start() {
  mkdirSync(LOG_DIR, { recursive: true });
  log(`--- start ${app.getVersion()}`);
  const s = settings();
  const dbUrl = await startDatabase(s.pgPassword);

  setSplash("Запускаем Каскад…");
  const port = await freePort(PREFERRED_PORT);
  const ffmpeg = path.join(RES, "ffmpeg");
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    NODE_ENV: "production",
    KASKAD_DESKTOP: "1",
    KASKAD_DESKTOP_TOKEN: s.desktopToken,
    KASKAD_DESKTOP_CONFIG: SETTINGS,
    DATABASE_URL: dbUrl,
    STORAGE_DIR: path.join(DATA, "storage"),
    FILE_URL_SECRET: s.fileSecret,
    PROVIDER_MODE: "live",
    // the person pays OpenRouter directly: prices as the provider charges them, no site balance
    PRICE_MARKUP: "1",
    WELCOME_BONUS_RUB: "0",
    PAYMENTS_PROVIDER: "",
    FFMPEG_PATH: path.join(ffmpeg, "ffmpeg.exe"),
    FFPROBE_PATH: path.join(ffmpeg, "ffprobe.exe"),
    PORT: String(port),
    HOSTNAME: "127.0.0.1",
  };
  const serverDir = path.join(RES, "server");
  web = spawn(process.execPath, [path.join(serverDir, "server.js")], { cwd: serverDir, env, windowsHide: true });
  pipeLog("web", web);
  web.on("exit", (code) => { if (!quitting) fail(new Error(`сервер остановился (код ${code})`)); });
  worker = spawn(process.execPath, [path.join(RES, "worker", "worker.cjs")], { cwd: DATA, env, windowsHide: true });
  pipeLog("worker", worker);
  worker.on("exit", (code) => { if (!quitting) fail(new Error(`обработчик генераций остановился (код ${code})`)); });

  await waitFor(async () => (await fetch(`http://127.0.0.1:${port}/login`, { signal: AbortSignal.timeout(2000) })).ok, 90_000, "Сервер");
  url = `http://127.0.0.1:${port}`;
  log(`ready at ${url}`);
  tray?.setToolTip("Каскад работает");
  closeSplash();
  openInBrowser();
}

function openInBrowser() {
  if (!url) return;
  const { desktopToken } = settings();
  void shell.openExternal(`${url}/desktop-login?token=${encodeURIComponent(desktopToken)}`);
}

function setSplash(text: string) {
  if (!splash) {
    splash = new BrowserWindow({
      width: 380, height: 150, frame: false, resizable: false, show: false, center: true,
      backgroundColor: "#14161a", skipTaskbar: false, title: "Каскад",
      icon: path.join(RES, "icon.png"),
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    splash.once("ready-to-show", () => splash?.show());
  }
  const html = `<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh;display:grid;place-items:center;
    background:#14161a;color:#f2f3ef;font:15px/1.4 'Segoe UI',system-ui,sans-serif;-webkit-user-select:none">
    <div style="display:flex;align-items:center;gap:14px"><span style="width:22px;height:22px;border-radius:7px;background:#d7f75b;
    position:relative;display:inline-block"><span style="position:absolute;inset:6px;border-radius:3px;background:#14161a"></span></span>
    <span>${text.replace(/</g, "&lt;")}</span></div></body>`;
  void splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function closeSplash() { splash?.destroy(); splash = null; }

let failed = false;
function fail(e: unknown) {
  if (failed || quitting) return;
  failed = true;
  const msg = e instanceof Error ? e.message : String(e);
  log(`FAILED: ${msg}`);
  closeSplash();
  dialog.showErrorBox("Каскад не запустился", `${msg}\n\nПодробности в журнале: ${path.join(LOG_DIR, "kaskad.log")}`);
  app.quit();
}

function stopAll() {
  quitting = true;
  web?.kill(); worker?.kill();
  try { stopServer(); } catch { pg?.kill(); }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // the shortcut clicked again: Kaskad is already running, just show it
  app.on("second-instance", () => { if (url) openInBrowser(); else splash?.focus(); });
  app.on("window-all-closed", () => { /* no windows by design: keep running in the tray */ });
  app.on("before-quit", stopAll);
  app.whenReady().then(() => {
    Menu.setApplicationMenu(null);
    tray = new Tray(nativeImage.createFromPath(path.join(RES, "tray.png")));
    tray.setToolTip("Каскад запускается…");
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "Открыть Каскад", click: openInBrowser },
      { label: "Папка с файлами", click: () => void shell.openPath(DATA) },
      { type: "separator" },
      { label: "Выйти из Каскада", click: () => app.quit() },
    ]));
    tray.on("click", openInBrowser);
    setSplash("Запускаем Каскад…");
    start().catch(fail);
  });
}
