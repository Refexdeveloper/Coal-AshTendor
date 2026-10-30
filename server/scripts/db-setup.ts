import "../src/env";
import { execFileSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import mysql from "mysql2/promise";
import { repoRoot } from "../src/lib/root";

/**
 * Creates the MySQL database and tables from prisma/schema.prisma.
 *
 * Prisma writes `TEXT ... DEFAULT ''`, which MySQL rejects. MySQL 8.0.13+ accepts the same default
 * written as an expression, `DEFAULT ('')`, so the generated SQL is adjusted before it runs.
 * Existing tables are left alone; pass --reset to drop and recreate them.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("mysql://")) throw new Error("DATABASE_URL must be a mysql:// connection string. See server/.env.example.");
  const parsed = new URL(url);
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/^[A-Za-z0-9_$-]+$/.test(database)) throw new Error(`Unsupported database name "${database}".`);

  const connection = await mysql.createConnection({
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    multipleStatements: true,
  });
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

  const root = repoRoot();
  const prismaBin = path.join(root, "node_modules", ".bin", "prisma");
  const bin = existsSync(prismaBin) ? prismaBin : path.join(root, "..", "node_modules", ".bin", "prisma");
  const sql = execFileSync(bin, ["migrate", "diff", "--from-empty", "--to-schema-datamodel", path.join(root, "prisma", "schema.prisma"), "--script"], {
    encoding: "utf8",
    env: process.env,
  }).replace(/((?:LONG|MEDIUM)?TEXT NOT NULL) DEFAULT '([^']*)'/g, "$1 DEFAULT ('$2')");
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
