import { existsSync } from "fs";
import path from "path";

/** Server package root (the folder holding schema.sql), whether started from the repo root or the server folder. */
export function repoRoot() {
  const starts = [process.cwd(), path.join(process.cwd(), "server")];
  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 5; i += 1) {
      if (existsSync(path.join(dir, "schema.sql"))) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return process.cwd();
}
