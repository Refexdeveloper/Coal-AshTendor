import { existsSync, readFileSync } from "fs";
import path from "path";
import { repoRoot } from "./lib/root";

/** Loads server/.env (then a repo-root .env) without overriding variables already set. Import this first. */
const files = [path.join(repoRoot(), ".env"), path.join(repoRoot(), "..", ".env")];
for (const file of files) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const match = line.match(/^\s*([^#=\s]+)\s*=(.*)$/);
    if (!match) continue;
    const key = match[1].trim();
    if (process.env[key] === undefined) process.env[key] = match[2].trim().replace(/^"|"$/g, "");
  }
}
