import { randomBytes } from "crypto";
import bcrypt from "bcryptjs";
import { db } from "../db";
import { deliver } from "./notify";
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

/** Stores a Refex One person without letting them sign in until an administrator allows it. */
export async function recordRefexOnePerson(emailInput: string, nameInput: string) {
  const email = emailInput.trim().toLowerCase();
  const name = nameInput.trim() || email;
  const existing = await db.user.findFirst({ where: { email } });
  if (existing) return existing;
  let personKey = personKeyFor(email);
  const taken = await db.user.findFirst({ where: { personKey } });
  if (taken) personKey = `${personKey.slice(0, 36)}${Date.now().toString(36).slice(-4)}`;
  return db.user.create({
    data: {
      personKey,
      name,
      email,
      role: "PENDING",
      passwordHash: bcrypt.hashSync(randomBytes(24).toString("hex"), 10),
      active: false,
    },
  });
}

/** Turns sign-in on or off and sets the role. Newly allowed people receive the initial password. */
export async function updateUserAccess(actorId: string, input: { userId: string; role: string; allow: boolean }) {
  const user = await db.user.findUnique({ where: { id: input.userId } });
  if (!user) return { error: "That person is not on the list." };
  const role = ROLES[input.role] ? input.role : user.role;
  if (input.allow && !ROLES[role]) return { error: "Choose a role before allowing sign-in." };
  if (user.id === actorId && !input.allow) return { error: "You cannot turn off your own sign-in." };
  if (user.id === actorId && role !== "ADMIN") return { error: "You cannot remove your own administrator role." };
  const turningOn = input.allow && !user.active;
  await db.user.update({
    where: { id: user.id },
    data: {
      role: ROLES[role] ? role : user.role,
      active: input.allow,
      ...(turningOn ? { passwordHash: bcrypt.hashSync(INITIAL_PASSWORD, 10) } : {}),
    },
  });
  if (!input.allow) return { ok: `${user.name} can no longer sign in.` };
  if (!turningOn) return { ok: `${user.name} is now ${ROLES[role] ?? role}.` };
  const link = `${(process.env.APP_URL || process.env.PUBLIC_APP_URL || "").replace(/\/$/, "")}/login`;
  const mailed = await deliver({
    to: user.email,
    toName: user.name,
    subject: "Your Coal & Ash sign-in",
    link: link || "/login",
    text: `Hello ${user.name},\n\nYou can sign in to Coal & Ash tenders.\n\nEmail: ${user.email}\nPassword: ${INITIAL_PASSWORD}`,
  }).catch(() => "FAILED");
  const sent = mailed === "SENT" ? " The sign-in details were emailed." : " Email is not set up, so give them this password.";
  return { ok: `${user.name} can sign in as ${user.email}. Password: ${INITIAL_PASSWORD}.${sent}` };
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
