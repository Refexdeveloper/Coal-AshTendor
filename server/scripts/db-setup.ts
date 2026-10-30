import "../src/env";
import { readFileSync } from "fs";
import path from "path";
import mysql from "mysql2/promise";
import type { ConnectionOptions } from "mysql2/promise";
import { cloudSqlSocketPath } from "../src/env";
import { repoRoot } from "../src/utils/root";

/**
 * Creates the MySQL database and the tables in schema.sql.
 * Existing tables are left alone; pass --reset to drop and recreate them.
 */
function connectionOptions(withoutDatabase = false): ConnectionOptions {
  const database = process.env.DB_NAME || "";
  const user = process.env.DB_USER || "";
  const password = process.env.DB_PASSWORD || "";
  const socketPath = cloudSqlSocketPath();

  if (socketPath && user && database) {
    return {
      socketPath,
      user,
      password,
      ...(withoutDatabase ? {} : { database }),
      multipleStatements: true,
    };
  }

  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("mysql://")) {
    throw new Error("Set DB_HOST/DB_NAME/DB_USER (or INSTANCE_CONNECTION_NAME for Cloud SQL). See server/.env.example.");
  }
  const parsed = new URL(url);
  const name = decodeURIComponent(parsed.pathname.replace(/^\//, "")) || database;
  const socketFromUrl = parsed.searchParams.get("socketPath");
  if (socketFromUrl) {
    return {
      socketPath: socketFromUrl,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      ...(withoutDatabase ? {} : { database: name }),
      multipleStatements: true,
    };
  }
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    ...(withoutDatabase ? {} : { database: name }),
    multipleStatements: true,
  };
}

async function main() {
  const database = process.env.DB_NAME || (() => {
    const url = process.env.DATABASE_URL;
    if (!url?.startsWith("mysql://")) return "";
    return decodeURIComponent(new URL(url).pathname.replace(/^\//, ""));
  })();
  if (!database || !/^[A-Za-z0-9_$-]+$/.test(database)) throw new Error(`Unsupported database name "${database}".`);

  const connection = await mysql.createConnection(connectionOptions(true));
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.query(`USE \`${database}\``);

  const [existing] = await connection.query("SHOW TABLES LIKE 'User'");
  if ((existing as unknown[]).length && !process.argv.includes("--reset")) {
    console.log(`Tables already exist in ${database}. Run "npm run db:reset" to drop and recreate them.`);
    await connection.end();
    return;
  }
  if (process.argv.includes("--reset")) {
    const [tables] = await connection.query("SHOW TABLES");
    const names = (tables as Record<string, string>[]).map((row) => Object.values(row)[0]);
    if (names.length) {
      await connection.query(`SET FOREIGN_KEY_CHECKS = 0; ${names.map((name) => `DROP TABLE \`${name}\`;`).join(" ")} SET FOREIGN_KEY_CHECKS = 1;`);
      console.log(`Dropped ${names.length} tables.`);
    }
  }

  const sql = readFileSync(path.join(repoRoot(), "schema.sql"), "utf8");
  await connection.query(sql);
  await connection.end();
  console.log(`Created the Coal & Ash tables in ${database}.`);
}

main().catch((error) => {
  const code = (error as { code?: string })?.code;
  if (code === "ECONNREFUSED") console.error("Could not connect to MySQL. Start the MySQL server and check DATABASE_URL in server/.env.");
  else if (code === "ER_ACCESS_DENIED_ERROR") console.error("MySQL refused the user name or password in DATABASE_URL (server/.env).");
  else console.error((error instanceof Error && error.message) || code || error);
  process.exit(1);
});
