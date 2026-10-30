import bcrypt from "bcryptjs";
import { db } from "../db";
import { ROLES } from "../utils/labels";

/** Same initial password shown on the sign-in page. */
export const INITIAL_PASSWORD = "CoalAsh@2026";

const DEFAULT_LOGINS = [{ personKey: "lokesh", name: "Lokesh B", email: "lokesh.b@refex.co.in", role: "BID_SUBMITTER" }];

function personKeyFor(email: string) {
  const base = email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 40);
  return base || "user";
}

/** Creates an active user. Returns an error string when the email or role cannot be used. */
export async function createAccount(input: { name: string; email: string; role: string; personKey?: string }) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const role = input.role;
  if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "Enter a name and a valid email." };
  if (!ROLES[role]) return { error: "Choose a role." };
  const existing = await db.user.findFirst({ where: { email } });
  if (existing) return { error: `${email} already has an account.` };

  let personKey = (input.personKey || personKeyFor(email)).toLowerCase();
  const taken = await db.user.findFirst({ where: { personKey } });
  if (taken) personKey = `${personKey.slice(0, 36)}${Date.now().toString(36).slice(-4)}`;

  await db.user.create({
    data: { personKey, name, email, role, passwordHash: bcrypt.hashSync(INITIAL_PASSWORD, 10), active: true },
  });
  return { ok: `${name} can sign in as ${email}. The password is ${INITIAL_PASSWORD}.` };
}

/** Inserts built-in logins that are not in the database yet. Does not change existing accounts. */
export async function ensureDefaultUsers() {
  for (const login of DEFAULT_LOGINS) {
    const existing = await db.user.findFirst({ where: { email: login.email } });
    if (existing) continue;
    const result = await createAccount(login);
    if (result.ok) console.log(`[db] Added default login ${login.email}`);
  }
}
