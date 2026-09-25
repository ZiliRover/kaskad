/**
 * Windows doesn't always take child processes down with their parent, so a killed
 * dev session can leave embedded Postgres processes holding the data directory.
 */
import { spawnSync } from "node:child_process";

export function killOrphanPostgres(): void {
  if (process.platform === "win32") {
    spawnSync("powershell", [
      "-NoProfile", "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name='postgres.exe'\" | " +
      "Where-Object { $_.CommandLine -like '*@embedded-postgres*' } | " +
      "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ], { stdio: "ignore" });
  } else {
    spawnSync("pkill", ["-f", "@embedded-postgres"], { stdio: "ignore" });
  }
}
