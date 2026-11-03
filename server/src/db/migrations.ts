import { db } from "./index";

/** Raw SQL without parameters, for schema statements (table and column names cannot be bound). */
const run = (sql: string) => db.$queryRaw(Object.assign([sql], { raw: [sql] }) as unknown as TemplateStringsArray);

/** Columns added after the first release. New databases get them from schema.sql; existing ones here. */
const ADDED_COLUMNS: Record<string, [string, string][]> = {
  Tender: [["businessLine", "VARCHAR(191) NOT NULL DEFAULT 'ASH'"]],
  EmdRecord: [["bgRequest", "LONGTEXT NULL"]],
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

/** Tables added after the first release, created when missing. */
const ADDED_TABLES: string[] = [
  `CREATE TABLE IF NOT EXISTS \`SuretyBond\` (
  \`id\` VARCHAR(191) NOT NULL,
  \`kind\` VARCHAR(32) NOT NULL,
  \`serialNo\` INT NULL,
  \`state\` VARCHAR(191) NOT NULL DEFAULT '',
  \`line\` VARCHAR(32) NOT NULL DEFAULT '',
  \`tenderRef\` TEXT NOT NULL DEFAULT (''),
  \`tenderDetails\` TEXT NOT NULL DEFAULT (''),
  \`plant\` VARCHAR(191) NOT NULL DEFAULT '',
  \`customer\` VARCHAR(191) NOT NULL DEFAULT '',
  \`amount\` DOUBLE NULL,
  \`onlineAmount\` DOUBLE NULL,
  \`isbAmount\` DOUBLE NULL,
  \`broker\` VARCHAR(191) NOT NULL DEFAULT '',
  \`insurer\` VARCHAR(191) NOT NULL DEFAULT '',
  \`bondNumber\` VARCHAR(191) NOT NULL DEFAULT '',
  \`issueDate\` DATETIME(3) NULL,
  \`startDate\` DATETIME(3) NULL,
  \`expiryDate\` DATETIME(3) NULL,
  \`claimExpiryDate\` DATETIME(3) NULL,
  \`ext1IssueDate\` DATETIME(3) NULL,
  \`ext1StartDate\` DATETIME(3) NULL,
  \`ext1ExpiryDate\` DATETIME(3) NULL,
  \`ext1ClaimDate\` DATETIME(3) NULL,
  \`ext2Date\` DATETIME(3) NULL,
  \`ext2ClaimDate\` DATETIME(3) NULL,
  \`premium\` DOUBLE NULL,
  \`premiumPercent\` DOUBLE NULL,
  \`stampDuty\` DOUBLE NULL,
  \`mode\` VARCHAR(191) NOT NULL DEFAULT '',
  \`transferType\` VARCHAR(191) NOT NULL DEFAULT '',
  \`status\` VARCHAR(191) NOT NULL DEFAULT '',
  \`usedFor\` VARCHAR(191) NOT NULL DEFAULT '',
  \`sourceFile\` VARCHAR(255) NOT NULL DEFAULT '',
  \`importedById\` VARCHAR(191) NOT NULL DEFAULT '',
  \`importedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (\`id\`),
  KEY \`SuretyBond_kind_idx\` (\`kind\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`,
];

const ADDED_INDEXES: [string, string, string][] = [["NotificationLog", "NotificationLog_createdAt_idx", "(`createdAt`)"]];

/** Brings an existing database up to the current schema. Safe to run on every start. */
export async function migrate() {
  for (const sql of ADDED_TABLES) await run(sql);
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
