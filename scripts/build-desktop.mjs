// Builds the Windows app: build/desktop/dist/Kaskad-Setup-<version>.exe
//   npm run desktop:build
// Steps: Next.js standalone server, bundled worker and launcher, Postgres and ffmpeg binaries,
// then electron-builder packs it all into one installer.
// The project's .env is NOT read: the build must not carry the owner's server settings.
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "build", "desktop");
const stage = path.join(out, "stage");   // becomes resources/ in the installed app
const appDir = path.join(out, "app");    // the Electron app itself (launcher only)
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const step = (s) => console.log(`\n== ${s}`);
const run = (cmd, args, env = {}) => {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
};

rmSync(stage, { recursive: true, force: true });
rmSync(appDir, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
mkdirSync(appDir, { recursive: true });

step("Next.js standalone server");
// __NEXT_PROCESSED_ENV makes Next skip .env files; NODE_ENV production as in the app
run("npx", ["next", "build"], {
  KASKAD_STANDALONE: "1", __NEXT_PROCESSED_ENV: "true", NODE_ENV: "production",
  // routes import the db module, which wants a URL; nothing connects during the build
  DATABASE_URL: "postgres://build:build@127.0.0.1:1/build",
});
const standalone = path.join(root, ".next", "standalone");
cpSync(standalone, path.join(stage, "server"), { recursive: true });
cpSync(path.join(root, ".next", "static"), path.join(stage, "server", ".next", "static"), { recursive: true });
cpSync(path.join(root, "public"), path.join(stage, "server", "public"), { recursive: true });
for (const f of readdirSync(path.join(stage, "server"))) {
  if (f.startsWith(".env")) rmSync(path.join(stage, "server", f)); // never ship server secrets
}
// local data that tracing may have picked up
for (const d of [".pgdata", "storage", "build", "prototype", "desktop"]) rmSync(path.join(stage, "server", d), { recursive: true, force: true });

step("worker and launcher bundles");
const common = { bundle: true, platform: "node", target: "node22", format: "cjs", logLevel: "warning", tsconfig: path.join(root, "tsconfig.json") };
await build({ ...common, entryPoints: [path.join(root, "src", "server", "worker", "main.ts")], outfile: path.join(stage, "worker", "worker.cjs") });
await build({ ...common, entryPoints: [path.join(root, "desktop", "main.ts")], outfile: path.join(appDir, "main.cjs"), external: ["electron"] });
writeFileSync(path.join(appDir, "package.json"), JSON.stringify({
  name: "kaskad", productName: "Kaskad", version: pkg.version, main: "main.cjs",
  description: "Каскад: картинки, видео и карточки товаров на лучших моделях", author: "Kaskad",
}, null, 2));

step("migrations, Postgres, ffmpeg, icons");
cpSync(path.join(root, "drizzle"), path.join(stage, "drizzle"), { recursive: true });
cpSync(path.join(root, "node_modules", "@embedded-postgres", "windows-x64", "native"), path.join(stage, "pg"), { recursive: true });
const ffmpegSrc = path.join(root, "desktop", "vendor", "ffmpeg");
if (!existsSync(path.join(ffmpegSrc, "ffmpeg.exe")) || !existsSync(path.join(ffmpegSrc, "ffprobe.exe"))) {
  throw new Error("desktop/vendor/ffmpeg/ffmpeg.exe and ffprobe.exe are missing: run node desktop/fetch-ffmpeg.mjs");
}
cpSync(ffmpegSrc, path.join(stage, "ffmpeg"), { recursive: true });
cpSync(path.join(root, "desktop", "tray.png"), path.join(stage, "tray.png"));
cpSync(path.join(root, "desktop", "icon.png"), path.join(stage, "icon.png"));

step("installer");
run("npx", ["electron-builder", "--win", "nsis", "--x64", "--config", path.join("desktop", "electron-builder.yml"), `--config.extraMetadata.version=${pkg.version}`]);
console.log(`\nDone: ${path.join(out, "dist")}`);
execFileSync("cmd", ["/c", "dir", "/b", path.join(out, "dist", "*.exe")], { stdio: "inherit" });
