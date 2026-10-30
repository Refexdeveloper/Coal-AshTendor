import { existsSync, readFileSync } from "fs";
import path from "path";
import { repoRoot } from "./utils/root";

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

if (!process.env.APP_URL) {
  const appUrl = process.env.PUBLIC_APP_URL || process.env.FRONTEND_URL;
  if (appUrl) process.env.APP_URL = appUrl;
}

/** DB_* is the compose-style config. DATABASE_URL still wins when it is set. */
if (!process.env.DATABASE_URL && process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER) {
  const user = encodeURIComponent(process.env.DB_USER);
  const password = encodeURIComponent(process.env.DB_PASSWORD || "");
  const port = process.env.DB_PORT || "3306";
  process.env.DATABASE_URL = `mysql://${user}:${password}@${process.env.DB_HOST}:${port}/${process.env.DB_NAME}`;
}
