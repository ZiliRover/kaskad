// Puts ffmpeg.exe and ffprobe.exe (Gyan's "essentials" Windows build, GPL) into
// desktop/vendor/ffmpeg for the installer. Run once: node desktop/fetch-ffmpeg.mjs
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const VERSION = "8.1.1";
const URL_ZIP = `https://github.com/GyanD/codexffmpeg/releases/download/${VERSION}/ffmpeg-${VERSION}-essentials_build.zip`;
const dest = path.join(import.meta.dirname, "vendor", "ffmpeg");

if (existsSync(path.join(dest, "ffmpeg.exe")) && existsSync(path.join(dest, "ffprobe.exe"))) {
  console.log("ffmpeg already in", dest);
  process.exit(0);
}
const tmp = mkdtempSync(path.join(tmpdir(), "kaskad-ffmpeg-"));
try {
  console.log("downloading", URL_ZIP);
  const r = await fetch(URL_ZIP);
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  const zip = path.join(tmp, "ffmpeg.zip");
  writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
  const unpacked = path.join(tmp, "x");
  execFileSync("powershell", ["-NoProfile", "-Command", `Expand-Archive -LiteralPath $env:Z -DestinationPath $env:D -Force`], {
    env: { ...process.env, Z: zip, D: unpacked }, stdio: "inherit",
  });
  const top = readdirSync(unpacked).find((d) => d.startsWith("ffmpeg-"));
  if (!top) throw new Error("unexpected archive layout");
  mkdirSync(dest, { recursive: true });
  for (const f of ["ffmpeg.exe", "ffprobe.exe"]) copyFileSync(path.join(unpacked, top, "bin", f), path.join(dest, f));
  copyFileSync(path.join(unpacked, top, "LICENSE"), path.join(dest, "LICENSE.txt"));
  writeFileSync(path.join(dest, "SOURCE.txt"), `FFmpeg ${VERSION} essentials build by Gyan Doshi (GPLv3).\n${URL_ZIP}\nSource code: https://ffmpeg.org/download.html\n`);
  console.log("ffmpeg ready in", dest);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
