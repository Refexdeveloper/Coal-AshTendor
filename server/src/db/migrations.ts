import { db } from "./index";

/** Raw SQL without parameters, for schema statements (table and column names cannot be bound). */
const run = (sql: string) => db.$queryRaw(Object.assign([sql], { raw: [sql] }) as unknown as TemplateStringsArray);

/** Columns added after the first release. New databases get them from schema.sql; existing ones here. */
const ADDED_COLUMNS: Record<string, [string, string][]> = {
  NotificationLog: [
    ["deliveredTo", "VARCHAR(191) NOT NULL DEFAULT ''"],
    ["messageId", "VARCHAR(255) NOT NULL DEFAULT ''"],
    ["errorMessage", "TEXT NULL"],
    ["attachments", "TEXT NULL"],
    ["html", "LONGTEXT NULL"],
    ["note", "TEXT NULL"],
    ["sentAt", "DATETIME(3) NULL"],
  ],
};

const ADDED_INDEXES: [string, string, string][] = [["NotificationLog", "NotificationLog_createdAt_idx", "(`createdAt`)"]];

/** Brings an existing database up to the current schema. Safe to run on every start. */
export async function migrate() {
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const rows = (await run(
      `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`,
    )) as { name: string }[];
    if (!rows.length) continue;
    const have = new Set(rows.map((row) => row.name));
    for (const [column, spec] of columns) {
      if (have.has(column)) continue;
      await run(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${spec}`);
      console.log(`[db] Added ${table}.${column}`);
    }
  }
  for (const [table, index, columns] of ADDED_INDEXES) {
    const rows = (await run(`SHOW INDEX FROM \`${table}\` WHERE Key_name = '${index}'`).catch(() => [])) as unknown[];
    if (!rows.length) await run(`ALTER TABLE \`${table}\` ADD KEY \`${index}\` ${columns}`).catch(() => undefined);
  }
}
