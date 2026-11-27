import { createHash, randomBytes } from "crypto";
import { db, type User } from "../db";
import { WorkflowError } from "./domain";

/** Shown in the admin list so the full secret is never stored again. */
const PREFIX_LEN = 12;

function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

/** One-time secret for another app. Prefix stays visible; the hash is what we keep. */
export function mintApiToken() {
  const secret = `ca_${randomBytes(32).toString("base64url")}`;
  return { token: secret, prefix: secret.slice(0, PREFIX_LEN), tokenHash: hashToken(secret) };
}

export type ApiTokenRow = {
  id: string;
  name: string;
  prefix: string;
  userId: string;
  createdById: string;
  createdAt: Date;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
};

/** Active tokens for the admin page (never includes the secret or hash). */
export async function listApiTokens(): Promise<(ApiTokenRow & { userName: string; userEmail: string })[]> {
  const rows = (await db.apiToken.findMany({ orderBy: { createdAt: "desc" } })) as ApiTokenRow[];
  const users = (await db.user.findMany({})) as User[];
  const byId = new Map(users.map((user) => [user.id, user]));
  return rows.map((row) => {
    const user = byId.get(row.userId);
    return {
      ...row,
      userName: user?.name ?? "",
      userEmail: user?.email ?? "",
    };
  });
}

/**
 * Creates a non-expiring API token that acts as the chosen user (default: the admin who creates it).
 * The raw token is returned once; only its hash is stored.
 */
export async function createApiToken(actor: User, name: string, asUserId = "") {
  if (actor.role !== "ADMIN") throw new WorkflowError("Only a system administrator can create API tokens.");
  const label = name.trim().slice(0, 120);
  if (label.length < 2) throw new WorkflowError("Give the token a short name (for example “Partner app”).");
  const userId = asUserId.trim() || actor.id;
  const user = (await db.user.findUnique({ where: { id: userId } })) as User | null;
  if (!user?.active) throw new WorkflowError("Choose an active person for this token to act as.");
  const { token, prefix, tokenHash } = mintApiToken();
  const row = (await db.apiToken.create({
    data: {
      name: label,
      prefix,
      tokenHash,
      userId: user.id,
      createdById: actor.id,
      lastUsedAt: null,
      revokedAt: null,
    },
  })) as ApiTokenRow;
  return { id: row.id, name: row.name, prefix: row.prefix, token, userName: user.name, userEmail: user.email };
}

export async function revokeApiToken(actor: User, id: string) {
  if (actor.role !== "ADMIN") throw new WorkflowError("Only a system administrator can revoke API tokens.");
  const row = (await db.apiToken.findUnique({ where: { id } })) as ApiTokenRow | null;
  if (!row) throw new WorkflowError("That API token is not in the list.");
  if (row.revokedAt) return { ok: "That token was already revoked." };
  await db.apiToken.update({ where: { id }, data: { revokedAt: new Date() } });
  return { ok: `Token “${row.name}” (${row.prefix}…) revoked. Apps using it can no longer call the API.` };
}

/** Resolves Authorization: Bearer <token> to the active user the token acts as. */
export async function userFromBearer(header: string | undefined): Promise<User | null> {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  if (!token.startsWith("ca_")) return null;
  const tokenHash = hashToken(token);
  const row = (await db.apiToken.findFirst({ where: { tokenHash } })) as ApiTokenRow | null;
  if (!row || row.revokedAt) return null;
  const user = (await db.user.findUnique({ where: { id: row.userId } })) as User | null;
  if (!user?.active) return null;
  // Touch last-used without blocking the request on a failed write.
  void db.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return user;
}
