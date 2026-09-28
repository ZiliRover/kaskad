/** Deletes the local dev database (and generated files) so it is recreated clean on next start. */
import { rmSync } from "node:fs";
import path from "node:path";
import { killOrphanPostgres } from "./pg-orphans";

killOrphanPostgres();
for (const dir of [".pgdata", process.env.STORAGE_DIR ?? "storage"]) {
  rmSync(path.resolve(dir), { recursive: true, force: true });
  console.log(`[db] removed ${dir}`);
}
console.log("[db] done: npm run dev recreates the database");
