import { readFileSync } from "fs";
import path from "path";
import mysql from "mysql2/promise";
import type { ConnectionOptions } from "mysql2/promise";
import { cloudSqlSocketPath } from "./env";
import { repoRoot } from "./utils/root";

/**
 * On Cloud Run first boot, create the schema when the database is empty, then seed
 * when there are no users. Set AUTO_DB_SETUP=false to skip entirely.
 */
export async function ensureDatabaseReady() {
  if (process.env.AUTO_DB_SETUP === "false") return;

  const database = process.env.DB_NAME;
  const user = process.env.DB_USER;
  if (!database || !user) return;

  const socketPath = cloudSqlSocketPath();
  const options: ConnectionOptions = socketPath
    ? {
        socketPath,
        user,
        password: process.env.DB_PASSWORD || "",
        multipleStatements: true,
      }
    : {
        host: process.env.DB_HOST || "127.0.0.1",
        port: Number(process.env.DB_PORT || "3306"),
        user,
        password: process.env.DB_PASSWORD || "",
        multipleStatements: true,
      };

  let needsSeed = false;
  const connection = await mysql.createConnection(options);
  try {
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.query(`USE \`${database}\``);
    const [existing] = await connection.query("SHOW TABLES LIKE 'User'");
    if (!(existing as unknown[]).length) {
      const sql = readFileSync(path.join(repoRoot(), "schema.sql"), "utf8");
      await connection.query(sql);
      console.log(`[db] Created Coal & Ash tables in ${database}`);
    } else {
      console.log(`[db] MySQL ready → ${database}${socketPath ? ` via ${socketPath}` : ""}`);
    }

    if (process.env.AUTO_DB_SEED === "false") return;

    const [users] = await connection.query("SELECT COUNT(*) AS count FROM `User`");
    needsSeed = Number((users as Array<{ count: number }>)[0]?.count ?? 0) === 0;
  } finally {
    await connection.end();
  }

  if (needsSeed) {
    const { seed } = await import("../scripts/seed");
    await seed();
  }
}
