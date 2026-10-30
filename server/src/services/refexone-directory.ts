import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db, type User } from "../db";

/**
 * Refex One user directory sync, as in the P2P app: GET {REFEXONE_API_URL}/users with an org-admin token.
 * New people are added waiting for access (role PENDING, cannot sign in) until an administrator allows them.
 * Existing people get their name refreshed, and lose sign-in when Refex One marks them inactive.
 * Nobody is given access by the sync, administrators are never switched off, and local-only accounts are left alone.
 */

export type DirectoryPerson = { email: string; name: string; active: boolean; designation: string };
export type SyncResult = { total: number; created: number; renamed: number; deactivated: number; unchanged: number; skippedAdmins: string[] };

const SYNC_ENTITY = "RefexOneSync";
const FAILED_ENTITY = "RefexOneSyncFailed";

/** Who ran a sync: an administrator, or the daily schedule. */
type SyncActor = Pick<User, "id" | "name">;
const SCHEDULE: SyncActor = { id: "refexone-daily", name: "Daily automatic sync" };

function apiConfig() {
  const baseUrl = (process.env.REFEXONE_API_URL || "https://refexone.com/api").replace(/\/$/, "");
  const token = (process.env.REFEXONE_API_TOKEN || "").trim();
  return { baseUrl, token };
}

export function directoryConfigured() {
  return Boolean(apiConfig().token);
}

function listOf(body: unknown): Record<string, unknown>[] {
  const value = body as { data?: unknown; users?: unknown; results?: unknown };
  for (const candidate of [body, value?.data, value?.users, value?.results]) {
    if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
  }
  return [];
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");

/** One directory row in our shape, or null when it has no usable email. */
export function normalizePerson(raw: Record<string, unknown>): DirectoryPerson | null {
  const email = text(raw.email).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  const name = text(raw.name) || text(raw.full_name) || email.split("@")[0];
  const status = text(raw.status).toLowerCase();
  const active = status ? status === "active" : raw.is_active !== false && raw.active !== false;
  const designation = text(raw.designation) || text(raw.job_title) || text(raw.position) || text(raw.title);
  return { email, name, active, designation };
}

/** Reads the whole Refex One directory. Throws a message an administrator can act on. */
export async function fetchDirectory(): Promise<DirectoryPerson[]> {
  const { baseUrl, token } = apiConfig();
  if (!token) throw new Error("Refex One sync is not set up. Put an org-admin API token in REFEXONE_API_TOKEN in server/.env and restart the server.");
  let response: Response;
  try {
    response = await fetch(`${baseUrl}/users`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new Error(`Could not reach Refex One at ${baseUrl}. Check the network and REFEXONE_API_URL.`);
  }
  if (response.status === 401 || response.status === 403) {
    const body = await response.text().catch(() => "");
    throw new Error(
      /expired/i.test(body)
        ? "The Refex One API token has expired. Generate a new org-admin token in Refex One, update REFEXONE_API_TOKEN in server/.env and restart the server."
        : "Refex One refused the API token. It must be an org-admin token; update REFEXONE_API_TOKEN in server/.env.",
    );
  }
  if (!response.ok) throw new Error(`Refex One returned an error (${response.status}).`);
  const people = listOf(await response.json().catch(() => null))
    .map(normalizePerson)
    .filter((person): person is DirectoryPerson => Boolean(person));
  // The same email twice in the directory: keep the active entry.
  const byEmail = new Map<string, DirectoryPerson>();
  for (const person of people) {
    const seen = byEmail.get(person.email);
    if (!seen || (!seen.active && person.active)) byEmail.set(person.email, person);
  }
  return [...byEmail.values()];
}

function personKeyFor(email: string, taken: Set<string>) {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 36) || "user";
  let key = base;
  for (let n = 2; taken.has(key); n += 1) key = `${base}${n}`;
  taken.add(key);
  return key;
}

let running: Promise<SyncResult> | null = null;

/** Brings the local user list in line with the Refex One directory. One sync at a time. */
export function syncRefexOneUsers(actor: SyncActor): Promise<SyncResult> {
  if (!running) running = runSync(actor).finally(() => (running = null));
  return running;
}

async function runSync(actor: SyncActor): Promise<SyncResult> {
  const people = await fetchDirectory();
  if (!people.length) throw new Error("Refex One returned no users, so nothing was changed.");

  const local = await db.user.findMany();
  const byEmail = new Map(local.map((user) => [user.email.toLowerCase(), user]));
  const takenKeys = new Set(local.map((user) => user.personKey));
  const result: SyncResult = { total: people.length, created: 0, renamed: 0, deactivated: 0, unchanged: 0, skippedAdmins: [] };
  // Placeholder hash for people added by the sync: nobody knows it, and allowing access later sets the real one.
  const lockedHash = bcrypt.hashSync(randomBytes(24).toString("hex"), 10);

  for (const person of people) {
    const existing = byEmail.get(person.email);
    if (!existing) {
      if (!person.active) continue;
      await db.user.create({
        data: { personKey: personKeyFor(person.email, takenKeys), name: person.name, email: person.email, role: "PENDING", passwordHash: lockedHash, active: false },
      });
      result.created += 1;
      continue;
    }
    const data: Partial<User> = {};
    if (person.name && person.name !== existing.name) data.name = person.name;
    if (!person.active && existing.active) {
      if (existing.role === "ADMIN" || existing.id === actor.id) result.skippedAdmins.push(existing.email);
      else data.active = false;
    }
    if (!Object.keys(data).length) {
      result.unchanged += 1;
      continue;
    }
    await db.user.update({ where: { id: existing.id }, data });
    if (data.name) result.renamed += 1;
    if (data.active === false) result.deactivated += 1;
  }

  await db.auditLog.create({
    data: { actorId: actor.id, actorName: actor.name, action: "Synced Refex One users", entity: SYNC_ENTITY, detail: JSON.stringify(result) },
  });
  return result;
}

/** Last sync, for the admin screen. */
export async function lastSync() {
  const row = await db.auditLog.findFirst({ where: { entity: SYNC_ENTITY }, orderBy: { createdAt: "desc" } });
  if (!row) return null;
  let summary: SyncResult | null = null;
  try {
    summary = JSON.parse(row.detail) as SyncResult;
  } catch {
    summary = null;
  }
  return { at: row.createdAt, by: row.actorName, summary };
}

/** Hours between automatic syncs (REFEXONE_SYNC_HOURS, default 24). 0 turns the schedule off. */
export function syncEveryHours() {
  const raw = process.env.REFEXONE_SYNC_HOURS;
  const hours = raw === undefined || raw.trim() === "" ? 24 : Number(raw);
  return Number.isFinite(hours) && hours > 0 ? hours : 0;
}

/** The schedule as the admin screen shows it, with the last automatic failure if it is newer than the last success. */
export async function syncSchedule() {
  const hours = syncEveryHours();
  const [success, failure] = await Promise.all([
    lastSync(),
    db.auditLog.findFirst({ where: { entity: FAILED_ENTITY }, orderBy: { createdAt: "desc" } }),
  ]);
  const failed = failure && (!success || failure.createdAt > success.at) ? { at: failure.createdAt, message: failure.detail } : null;
  const nextAt = hours && directoryConfigured() ? new Date(success ? success.at.getTime() + hours * 36e5 : Date.now()) : null;
  return { everyHours: hours, nextAt: nextAt && nextAt.getTime() < Date.now() ? new Date() : nextAt, failed };
}

const CHECK_EVERY_MS = 10 * 60 * 1000;
const RETRY_AFTER_FAILURE_MS = 60 * 60 * 1000;
let lastCheck = 0;
let lastFailureAt = 0;

/**
 * Runs the sync when the last one is older than the schedule. Cheap to call often: it looks at the database
 * at most every ten minutes, and after a failure it waits an hour before trying again.
 * Never throws; a failure is written to the audit log so the admin screen can show it.
 */
export async function maybeScheduledSync() {
  const hours = syncEveryHours();
  const now = Date.now();
  if (!hours || !directoryConfigured() || running || now - lastCheck < CHECK_EVERY_MS || now - lastFailureAt < RETRY_AFTER_FAILURE_MS) return;
  lastCheck = now;
  try {
    const last = await lastSync();
    if (last && now - last.at.getTime() < hours * 36e5) return;
    const result = await syncRefexOneUsers(SCHEDULE);
    console.log(`[refexone] ${describeSync(result)}`);
  } catch (error) {
    lastFailureAt = Date.now();
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[refexone] Daily sync failed: ${message}`);
    await db.auditLog
      .create({ data: { actorId: SCHEDULE.id, actorName: SCHEDULE.name, action: "Refex One sync failed", entity: FAILED_ENTITY, detail: message.slice(0, 2000) } })
      .catch(() => undefined);
  }
}

export function describeSync(result: SyncResult) {
  const parts = [
    `${result.total} people in Refex One`,
    `${result.created} added and waiting for access`,
    `${result.renamed} names updated`,
    `${result.deactivated} switched off because Refex One marks them inactive`,
  ];
  const kept = result.skippedAdmins.length ? ` Administrators kept on although inactive in Refex One: ${result.skippedAdmins.join(", ")}.` : "";
  return `Refex One sync done: ${parts.join(", ")}.${kept}`;
}
