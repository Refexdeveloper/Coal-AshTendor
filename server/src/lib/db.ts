import { randomBytes } from "crypto";
import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import mysql from "mysql2/promise";
import "../env";

/** Rows the rest of the server already expects. Relations are attached when a query asks for them. */
export interface User {
  id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: string;
  personKey: string;
  active: boolean;
  createdAt: Date;
}

export interface WorkflowTask {
  id: string;
  tenderId: string;
  branch: string;
  stage: string;
  title: string;
  status: string;
  assigneeIds: string;
  dueAt: Date | null;
  slaMinutes: number;
  baseAt: Date;
  reminder50Sent: boolean;
  reminder75Sent: boolean;
  breachSent: boolean;
  breachLevel2Sent: boolean;
  wasOverdue: boolean;
  decision: string;
  comments: string;
  completedById: string;
  completedAt: Date | null;
  createdAt: Date;
  tender?: Record<string, unknown>;
}

type Row = Record<string, unknown>;

interface Relation {
  table: string;
  fk: string;
  many: boolean;
  /** The foreign key lives on this table and points at the related row. */
  belongsTo?: boolean;
}

const MODELS: Record<string, string> = {
  user: "User",
  calendarSettings: "CalendarSettings",
  holiday: "Holiday",
  slaPolicy: "SlaPolicy",
  escalationRecipient: "EscalationRecipient",
  appSettings: "AppSettings",
  emailTemplate: "EmailTemplate",
  tender: "Tender",
  tenderDocument: "TenderDocument",
  tenderField: "TenderField",
  workflowTask: "WorkflowTask",
  taskAction: "TaskAction",
  costingRecord: "CostingRecord",
  emdRecord: "EmdRecord",
  approvalRecord: "ApprovalRecord",
  bidSubmission: "BidSubmission",
  notificationLog: "NotificationLog",
  auditLog: "AuditLog",
  portal: "Portal",
  crawlerRun: "CrawlerRun",
  crawlerException: "CrawlerException",
};

const RELATIONS: Record<string, Record<string, Relation>> = {
  Tender: {
    fields: { table: "TenderField", fk: "tenderId", many: true },
    documents: { table: "TenderDocument", fk: "tenderId", many: true },
    tasks: { table: "WorkflowTask", fk: "tenderId", many: true },
    costings: { table: "CostingRecord", fk: "tenderId", many: true },
    approvals: { table: "ApprovalRecord", fk: "tenderId", many: true },
    audits: { table: "AuditLog", fk: "tenderId", many: true },
    notifications: { table: "NotificationLog", fk: "tenderId", many: true },
    emd: { table: "EmdRecord", fk: "tenderId", many: false },
    bid: { table: "BidSubmission", fk: "tenderId", many: false },
  },
  WorkflowTask: {
    tender: { table: "Tender", fk: "tenderId", many: false, belongsTo: true },
  },
  TenderDocument: {
    tender: { table: "Tender", fk: "tenderId", many: false, belongsTo: true },
  },
  NotificationLog: {
    tender: { table: "Tender", fk: "tenderId", many: false, belongsTo: true },
  },
  Portal: {
    runs: { table: "CrawlerRun", fk: "portalId", many: true },
  },
};

const BOOLEAN_COLUMNS = new Set([
  "active",
  "relevanceOverdue",
  "deadlineMissed",
  "critical",
  "reminder50Sent",
  "reminder75Sent",
  "breachSent",
  "breachLevel2Sent",
  "wasOverdue",
  "submittedToAuthority",
  "enabled",
  "resolved",
  "bgRequiresBoth",
  "revisionResetsSla",
]);

const TOUCHED = new Set(["Tender", "BidSubmission"]);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

interface Runner {
  query(sql: string, params?: unknown[]): Promise<[unknown, unknown]>;
}

export interface Model {
  findUnique(args: QueryArgs): Lazy<any>;
  findFirst(args?: QueryArgs): Lazy<any>;
  findMany(args?: QueryArgs): Lazy<any[]>;
  create(args: { data: Row }): Lazy<any>;
  createMany(args: { data: Row[] }): Lazy<{ count: number }>;
  update(args: { where: Row; data: Row }): Lazy<any>;
  updateMany(args: { where?: Row; data: Row }): Lazy<{ count: number }>;
  delete(args: { where: Row }): Lazy<any>;
  deleteMany(args?: { where?: Row }): Lazy<{ count: number }>;
  upsert(args: { where: Row; create: Row; update: Row }): Lazy<any>;
  count(args?: { where?: Row }): Lazy<number>;
}

interface QueryArgs {
  where?: Row;
  orderBy?: Row | Row[];
  take?: number;
  select?: Record<string, boolean>;
  include?: Record<string, unknown>;
  omit?: Record<string, boolean>;
}

export type Lazy<T> = PromiseLike<T> & {
  catch<R>(onRejected: (error: unknown) => R): Promise<T | R>;
  execOn(runner: Runner): Promise<T>;
};

export interface Db {
  user: Model;
  calendarSettings: Model;
  holiday: Model;
  slaPolicy: Model;
  escalationRecipient: Model;
  appSettings: Model;
  emailTemplate: Model;
  tender: Model;
  tenderDocument: Model;
  tenderField: Model;
  workflowTask: Model;
  taskAction: Model;
  costingRecord: Model;
  emdRecord: Model;
  approvalRecord: Model;
  bidSubmission: Model;
  notificationLog: Model;
  auditLog: Model;
  portal: Model;
  crawlerRun: Model;
  crawlerException: Model;
  $transaction<T>(work: (tx: Db) => Promise<T>): Promise<T>;
  $transaction<T>(work: Lazy<T>[]): Promise<T[]>;
  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): Lazy<unknown>;
}

/** A connection the server can share. Transactions take one connection from this pool. */
function createPool(): Pool {
  const url = process.env.DATABASE_URL;
  if (!url?.startsWith("mysql://")) throw new Error("DATABASE_URL must be a mysql:// connection string. See server/.env.example.");
  const parsed = new URL(url);
  return mysql.createPool({
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    timezone: "Z",
    connectionLimit: 10,
    dateStrings: false,
  });
}

const pool = createPool();

function quote(name: string) {
  if (!IDENT.test(name)) throw new Error(`Unsupported SQL name "${name}".`);
  return `\`${name}\``;
}

function newId() {
  return randomBytes(16).toString("hex");
}

function bind(value: unknown) {
  if (typeof value === "boolean") return value ? 1 : 0;
  return value;
}

function hydrate(row: Row) {
  const out: Row = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = BOOLEAN_COLUMNS.has(key) && value != null ? Boolean(value) : value;
  }
  return out;
}

function isPlain(value: unknown): value is Row {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date);
}

function whereSql(where: Row | undefined, params: unknown[]) {
  if (!where) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(where)) {
    if (value === undefined) continue;
    if (isPlain(value) && !("in" in value) && !("notIn" in value) && !("contains" in value) && !("not" in value)) {
      for (const [innerKey, innerValue] of Object.entries(value)) {
        params.push(bind(innerValue));
        parts.push(`${quote(innerKey)} = ?`);
      }
      continue;
    }
    if (isPlain(value) && Array.isArray(value.in)) {
      if (!value.in.length) {
        parts.push("1 = 0");
        continue;
      }
      params.push(...value.in.map(bind));
      parts.push(`${quote(key)} IN (${value.in.map(() => "?").join(", ")})`);
      continue;
    }
    if (isPlain(value) && Array.isArray(value.notIn)) {
      if (!value.notIn.length) continue;
      params.push(...value.notIn.map(bind));
      parts.push(`${quote(key)} NOT IN (${value.notIn.map(() => "?").join(", ")})`);
      continue;
    }
    if (isPlain(value) && typeof value.contains === "string") {
      params.push(`%${value.contains.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
      parts.push(`${quote(key)} LIKE ?`);
      continue;
    }
    if (isPlain(value) && "not" in value) {
      if (value.not === null) parts.push(`${quote(key)} IS NOT NULL`);
      else {
        params.push(bind(value.not));
        parts.push(`${quote(key)} <> ?`);
      }
      continue;
    }
    if (value === null) parts.push(`${quote(key)} IS NULL`);
    else {
      params.push(bind(value));
      parts.push(`${quote(key)} = ?`);
    }
  }
  return parts.length ? ` WHERE ${parts.join(" AND ")}` : "";
}

function orderSql(orderBy: Row | Row[] | undefined) {
  const items = !orderBy ? [] : Array.isArray(orderBy) ? orderBy : [orderBy];
  const parts = items.flatMap((item) =>
    Object.entries(item).map(([key, direction]) => {
      const dir = String(direction).toLowerCase() === "desc" ? "DESC" : "ASC";
      return `${quote(key)} ${dir}`;
    }),
  );
  return parts.length ? ` ORDER BY ${parts.join(", ")}` : "";
}

function columnList(select?: Record<string, boolean>) {
  if (!select) return "*";
  const names = Object.entries(select)
    .filter(([, keep]) => keep)
    .map(([name]) => quote(name));
  return names.length ? names.join(", ") : "*";
}

async function selectRows(runner: Runner, table: string, args: QueryArgs = {}) {
  const params: unknown[] = [];
  const limit = args.take && args.take > 0 ? ` LIMIT ${Math.floor(args.take)}` : "";
  const [rows] = await runner.query(
    `SELECT ${columnList(args.select)} FROM ${quote(table)}${whereSql(args.where, params)}${orderSql(args.orderBy)}${limit}`,
    params,
  );
  return (rows as RowDataPacket[]).map((row) => hydrate(row));
}

async function attach(runner: Runner, table: string, rows: Row[], include: Record<string, unknown> | undefined) {
  if (!include || !rows.length) return;
  const relations = RELATIONS[table] ?? {};
  for (const [key, spec] of Object.entries(include)) {
    if (!spec) continue;
    const relation = relations[key];
    if (!relation) throw new Error(`Unknown relation ${table}.${key}.`);
    const options = spec === true ? {} : (spec as QueryArgs);
    if (relation.belongsTo) {
      const ids = [...new Set(rows.map((row) => row[relation.fk]).filter((id): id is string => typeof id === "string" && id.length > 0))];
      const parents = ids.length ? await selectRows(runner, relation.table, { where: { id: { in: ids } } }) : [];
      if (options.include) await attach(runner, relation.table, parents, options.include);
      const byId = new Map(parents.map((parent) => [parent.id, parent]));
      for (const row of rows) row[key] = typeof row[relation.fk] === "string" ? (byId.get(row[relation.fk] as string) ?? null) : null;
      continue;
    }
    const ids = rows.map((row) => row.id).filter((id): id is string => typeof id === "string");
    const children = ids.length
      ? await selectRows(runner, relation.table, {
          where: { ...(options.where ?? {}), [relation.fk]: { in: ids } },
          orderBy: options.orderBy,
        })
      : [];
    if (options.omit) {
      for (const child of children) {
        for (const [column, hidden] of Object.entries(options.omit)) if (hidden) delete child[column];
      }
    }
    if (options.include) await attach(runner, relation.table, children, options.include);
    const grouped = new Map<unknown, Row[]>();
    for (const child of children) {
      const group = grouped.get(child[relation.fk]) ?? [];
      group.push(child);
      grouped.set(child[relation.fk], group);
    }
    for (const row of rows) {
      const group = grouped.get(row.id) ?? [];
      const sliced = options.take ? group.slice(0, options.take) : group;
      row[key] = relation.many ? sliced : (sliced[0] ?? null);
    }
  }
}

function assignment(table: string, data: Row, params: unknown[], touching: boolean) {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || (isPlain(value) && "create" in value)) continue;
    if (isPlain(value) && typeof value.increment === "number") {
      parts.push(`${quote(key)} = ${quote(key)} + ?`);
      params.push(value.increment);
      continue;
    }
    parts.push(`${quote(key)} = ?`);
    params.push(bind(value));
  }
  if (touching && TOUCHED.has(table) && !("updatedAt" in data)) parts.push("`updatedAt` = CURRENT_TIMESTAMP(3)");
  return parts;
}

async function insertRow(runner: Runner, table: string, data: Row) {
  const row = { ...data };
  if (row.id === undefined) row.id = newId();
  const nested = Object.entries(row).filter(([, value]) => isPlain(value) && "create" in value);
  for (const [key] of nested) delete row[key];
  const columns = Object.entries(row).filter(([, value]) => value !== undefined);
  const params = columns.map(([, value]) => bind(value));
  await runner.query(
    `INSERT INTO ${quote(table)} (${columns.map(([key]) => quote(key)).join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
    params,
  );
  const relations = RELATIONS[table] ?? {};
  for (const [key, value] of nested) {
    const relation = relations[key];
    if (!relation || relation.belongsTo) throw new Error(`Cannot nest create ${table}.${key}.`);
    const children = (value as { create: Row | Row[] }).create;
    for (const child of Array.isArray(children) ? children : [children]) {
      await insertRow(runner, relation.table, { ...child, [relation.fk]: row.id });
    }
  }
  const [saved] = await selectRows(runner, table, { where: { id: row.id }, take: 1 });
  return saved;
}

function lazy<T>(runner: Runner, exec: (active: Runner) => Promise<T>): Lazy<T> {
  let cached: Promise<T> | null = null;
  const run = (active: Runner) => (active === runner ? (cached ??= exec(runner)) : exec(active));
  return {
    execOn: (active) => run(active),
    then(onFulfilled, onRejected) {
      return run(runner).then(onFulfilled, onRejected);
    },
    catch(onRejected) {
      return run(runner).catch(onRejected);
    },
  };
}

function modelApi(table: string, runner: Runner): Model {
  return {
    findUnique: (args) =>
      lazy(runner, async (active) => {
        const rows = await selectRows(active, table, { ...args, take: 1 });
        if (args.include) await attach(active, table, rows, args.include);
        return rows[0] ?? null;
      }),
    findFirst: (args = {}) =>
      lazy(runner, async (active) => {
        const rows = await selectRows(active, table, { ...args, take: 1 });
        if (args.include) await attach(active, table, rows, args.include);
        return rows[0] ?? null;
      }),
    findMany: (args = {}) =>
      lazy(runner, async (active) => {
        const rows = await selectRows(active, table, args);
        if (args.include) await attach(active, table, rows, args.include);
        return rows;
      }),
    create: (args) => lazy(runner, (active) => insertRow(active, table, args.data)),
    createMany: (args) =>
      lazy(runner, async (active) => {
        for (const data of args.data) await insertRow(active, table, data);
        return { count: args.data.length };
      }),
    update: (args) =>
      lazy(runner, async (active) => {
        const params: unknown[] = [];
        const sets = assignment(table, args.data, params, true);
        if (!sets.length) throw new Error(`No columns to update on ${table}.`);
        const whereParams: unknown[] = [];
        const where = whereSql(args.where, whereParams);
        await active.query(`UPDATE ${quote(table)} SET ${sets.join(", ")}${where}`, [...params, ...whereParams]);
        const rows = await selectRows(active, table, { where: args.where, take: 1 });
        if (!rows[0]) throw new Error(`${table} record was not found.`);
        return rows[0];
      }),
    updateMany: (args) =>
      lazy(runner, async (active) => {
        const params: unknown[] = [];
        const sets = assignment(table, args.data, params, true);
        const whereParams: unknown[] = [];
        const where = whereSql(args.where, whereParams);
        const [result] = await active.query(`UPDATE ${quote(table)} SET ${sets.join(", ")}${where}`, [...params, ...whereParams]);
        return { count: (result as ResultSetHeader).affectedRows };
      }),
    delete: (args) =>
      lazy(runner, async (active) => {
        const params: unknown[] = [];
        const where = whereSql(args.where, params);
        const [result] = await active.query(`DELETE FROM ${quote(table)}${where} LIMIT 1`, params);
        if ((result as ResultSetHeader).affectedRows < 1) throw new Error(`${table} record was not found.`);
        return { ok: true };
      }),
    deleteMany: (args = {}) =>
      lazy(runner, async (active) => {
        const params: unknown[] = [];
        const where = whereSql(args.where, params);
        const [result] = await active.query(`DELETE FROM ${quote(table)}${where}`, params);
        return { count: (result as ResultSetHeader).affectedRows };
      }),
    upsert: (args) =>
      lazy(runner, async (active) => {
        const existing = await selectRows(active, table, { where: args.where, take: 1 });
        if (!existing.length) return insertRow(active, table, { ...args.create });
        const params: unknown[] = [];
        const sets = assignment(table, args.update, params, true);
        const whereParams: unknown[] = [];
        const where = whereSql(args.where, whereParams);
        if (sets.length) await active.query(`UPDATE ${quote(table)} SET ${sets.join(", ")}${where}`, [...params, ...whereParams]);
        const rows = await selectRows(active, table, { where: args.where, take: 1 });
        return rows[0] ?? null;
      }),
    count: (args = {}) =>
      lazy(runner, async (active) => {
        const params: unknown[] = [];
        const [rows] = await active.query(`SELECT COUNT(*) AS count FROM ${quote(table)}${whereSql(args.where, params)}`, params);
        return Number((rows as RowDataPacket[])[0]?.count ?? 0);
      }),
  };
}

function createDb(runner: Runner): Db {
  const db = {
    $transaction: async <T,>(work: (tx: Db) => Promise<T> | Lazy<unknown>[]) => {
      const connection = await pool.getConnection();
      const connected: Runner = { query: (sql, params) => connection.query(sql, params) };
      try {
        await connection.beginTransaction();
        const tx = createDb(connected);
        const result = typeof work === "function" ? await work(tx) : await runBatch(work, connected);
        await connection.commit();
        return result as T;
      } catch (error) {
        await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = strings.reduce((text, part, index) => text + part + (index < values.length ? "?" : ""), "");
      return lazy(runner, async (active) => {
        const [rows] = await active.query(sql, values.map(bind));
        return rows;
      });
    },
  } as Db;
  for (const [name, table] of Object.entries(MODELS)) (db as unknown as Record<string, Model>)[name] = modelApi(table, runner);
  return db;
}

async function runBatch(work: Lazy<unknown>[], runner: Runner) {
  const results = [];
  for (const item of work) results.push(await item.execOn(runner));
  return results;
}

const poolRunner: Runner = {
  query: (sql, params) => pool.query(sql, params),
};

export type Tx = Db;

export const db = createDb(poolRunner);
