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

/** Cloud SQL Unix socket when INSTANCE_CONNECTION_NAME (or DB_SOCKET_PATH) is set. */
export function cloudSqlSocketPath() {
  if (process.env.DB_SOCKET_PATH) return process.env.DB_SOCKET_PATH;
  if (process.env.INSTANCE_CONNECTION_NAME) return `/cloudsql/${process.env.INSTANCE_CONNECTION_NAME}`;
  return "";
}

/**
 * DB_* is the compose-style config. DATABASE_URL still wins when it is set.
 * For Cloud SQL on Cloud Run, prefer INSTANCE_CONNECTION_NAME + DB_* (no TCP host).
 */
if (!process.env.DATABASE_URL && process.env.DB_NAME && process.env.DB_USER) {
  const user = encodeURIComponent(process.env.DB_USER);
  const password = encodeURIComponent(process.env.DB_PASSWORD || "");
  const database = process.env.DB_NAME;
  const socket = cloudSqlSocketPath();
  if (socket) {
    // mysql2 accepts socket via pool options; keep a marker URL for scripts that parse it.
    process.env.DATABASE_URL = `mysql://${user}:${password}@localhost/${database}?socketPath=${encodeURIComponent(socket)}`;
  } else if (process.env.DB_HOST) {
    const port = process.env.DB_PORT || "3306";
    process.env.DATABASE_URL = `mysql://${user}:${password}@${process.env.DB_HOST}:${port}/${database}`;
  }
}
