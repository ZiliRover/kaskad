/**
 * Local Postgres binaries (from the embedded-postgres platform package) driven directly.
 *
 * Why not the embedded-postgres wrapper: on Windows, Postgres can't initialise a UTF-8
 * cluster when its binaries or data live under a non-ASCII path (e.g. C:\Users\Никита),
 * and the wrapper offers no way to change those paths. We use 8.3 short paths instead.
 */
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";

const win = process.platform === "win32";
const exe = (name: string) => (win ? `${name}.exe` : name);

/** ASCII-only 8.3 form of an existing Windows folder (unchanged elsewhere or if already ASCII). */
export function shortPath(dir: string): string {
  if (!win || /^[\x00-\x7f]*$/.test(dir)) return dir;
  // the path travels in an env var (UTF-16 on Windows), so no codepage mangling
  const out = execFileSync("powershell", [
    "-NoProfile", "-NonInteractive", "-Command",
    "(New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:KASKAD_LONG_PATH).ShortPath",
  ], { env: { ...process.env, KASKAD_LONG_PATH: dir }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 }).trim();
  if (!out || !/^[\x00-\x7f]*$/.test(out)) {
    throw new Error(`no ASCII short path for ${dir}: enable 8.3 names or move the project to an ASCII-only folder`);
  }
  return out;
}

export function binDir(): string {
  const require = createRequire(import.meta.url);
  const pkg = `@embedded-postgres/${win ? "windows" : process.platform}-${process.arch}`;
  // entry is <pkg>/dist/index.js; binaries live in <pkg>/native/bin
  const dir = path.join(path.dirname(require.resolve(pkg)), "..", "native", "bin");
  return shortPath(dir);
}

export function dataDir(): string {
  // the parent exists, so it can be shortened even before initdb creates the folder
  return path.join(shortPath(process.cwd()), ".pgdata");
}

export function initCluster(user: string, password: string) {
  const tmp = mkdtempSync(path.join(tmpdir(), "pgpw-"));
  const pwfile = path.join(tmp, "pw");
  writeFileSync(pwfile, password);
  try {
    const r = spawnSync(path.join(binDir(), exe("initdb")), [
      "-D", dataDir(), `--username=${user}`, `--pwfile=${pwfile}`, "--auth=password",
      // UTF-8 whatever the OS locale: prompts contain emoji and symbols
      "--encoding=UTF8", "--locale=C",
    ], { encoding: "utf8" });
    if (r.status !== 0) throw new Error(`initdb failed: ${r.stderr || r.stdout}`);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export const clusterExists = () => existsSync(path.join(dataDir(), "PG_VERSION"));

export function startServer(port: number, onLog?: (line: string) => void): ChildProcess {
  const p = spawn(path.join(binDir(), exe("postgres")), ["-D", dataDir(), "-p", String(port)], { windowsHide: true });
  p.stderr?.on("data", (d) => onLog?.(String(d)));
  p.stdout?.on("data", (d) => onLog?.(String(d)));
  return p;
}

/** Graceful stop; true if pg_ctl managed it. */
export function stopServer(): boolean {
  if (!existsSync(path.join(dataDir(), "postmaster.pid"))) return true;
  const r = spawnSync(path.join(binDir(), exe("pg_ctl")), ["stop", "-D", dataDir(), "-m", "fast", "-t", "15"], { stdio: "ignore" });
  return r.status === 0;
}
