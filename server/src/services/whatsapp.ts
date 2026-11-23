import { db } from "../db";
import { liveMail } from "./notify";

/**
 * WhatsApp notices, sent the same way as the Procure-to-Pay app: the Unfyd Meta HSM API with the approved template
 * "workflow_all_application", whose body has six values:
 *
 *   Dear {{1}},  Application: {{2}}  Reference ID: {{3}}  Status: {{4}}  Workflow: {{5}}  {{6}} (link)
 *
 * The key and secret come from the environment (WHATSAPP_APP_KEY, WHATSAPP_APP_SECRET); without them nothing is sent
 * and the log says why. Like email, only the live server messages real people: anywhere else every message goes to
 * WHATSAPP_TEST_TO, or is not sent when that is not set. Every attempt is kept in WhatsAppLog.
 */

const DEFAULT_API_URL = "https://whatsapp.unfyd.com:9443/unfyd-meta-api/api/v1/hsm/send";
const DEFAULT_TEMPLATE = "workflow_all_application";
const APP_NAME = "Coal & Ash Tenders";

function config() {
  return {
    apiUrl: (process.env.WHATSAPP_API_URL || DEFAULT_API_URL).trim(),
    appKey: (process.env.WHATSAPP_APP_KEY || "").trim(),
    appSecret: (process.env.WHATSAPP_APP_SECRET || "").trim(),
    template: (process.env.WHATSAPP_TEMPLATE_NAME || DEFAULT_TEMPLATE).trim(),
    language: (process.env.WHATSAPP_TEMPLATE_LANG || "en_US").trim(),
    // Switch off without a deploy: WHATSAPP_ENABLED=false.
    enabled: (process.env.WHATSAPP_ENABLED ?? "true").trim().toLowerCase() !== "false",
    testTo: normalizePhone(process.env.WHATSAPP_TEST_TO || ""),
  };
}

export function whatsAppStatus() {
  const c = config();
  return { enabled: c.enabled, configured: Boolean(c.appKey && c.appSecret), live: liveMail(), testTo: c.testTo };
}

/** Digits with the country code; a 10-digit number is taken as Indian. Empty when it is not a usable number. */
export function normalizePhone(raw: string | null | undefined) {
  let digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) digits = `91${digits.slice(1)}`;
  if (digits.length === 10) digits = `91${digits}`;
  return digits.length >= 11 && digits.length <= 15 ? digits : "";
}

/** Meta drops template values with line breaks, tabs, long runs of spaces or formatting marks. */
function clean(value: unknown, max: number) {
  let text = String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[–—−]/g, "-")
    .replace(/…/g, "...")
    .replace(/[*_~`#<>{}[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) text = "-";
  return text.length > max ? `${text.slice(0, max - 3)}...` : text;
}

type Notice = { tenderId: string; taskId?: string; recordId: string; userId?: string; name: string; phone: string; status: string; workflow: string; link: string };

const recent = new Map<string, number>();
let queue: Promise<unknown> = Promise.resolve();

async function log(data: Record<string, unknown>) {
  return db.whatsAppLog.create({ data }).catch((error: unknown) => console.error("Could not log WhatsApp", error));
}

async function send(notice: Notice) {
  const c = config();
  const parameters = [clean(notice.name, 60), clean(APP_NAME, 40), clean(notice.recordId, 40), clean(notice.status, 80), clean(notice.workflow, 80), clean(notice.link, 200)];
  const to = normalizePhone(notice.phone);
  const deliveredTo = c.testTo && !liveMail() ? c.testTo : to;
  const base = {
    tenderId: notice.tenderId,
    taskId: notice.taskId ?? "",
    recordId: notice.recordId,
    userId: notice.userId ?? "",
    toName: notice.name,
    toPhone: to,
    deliveredTo,
    stage: notice.workflow.slice(0, 190),
    parameters: JSON.stringify(parameters),
  };
  const skip = (error: string) => log({ ...base, status: "SKIPPED", error });
  if (!c.enabled) return skip("WhatsApp is switched off (WHATSAPP_ENABLED=false).");
  if (!c.appKey || !c.appSecret) return skip("WhatsApp is not set up: WHATSAPP_APP_KEY and WHATSAPP_APP_SECRET are missing.");
  if (!to) return skip(`No mobile number for ${notice.name}. Add it in Administration.`);
  if (!liveMail() && !c.testTo) return skip("Not sent from this machine: set WHATSAPP_TEST_TO to try WhatsApp locally.");

  const key = `${deliveredTo}|${notice.recordId}|${notice.workflow}|${notice.status}`;
  const now = Date.now();
  for (const [k, at] of recent) if (now - at > 60_000) recent.delete(k);
  if (recent.has(key)) return skip("Already sent this notice to this number in the last minute.");
  recent.set(key, now);

  const body = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: deliveredTo,
    type: "template",
    template: { name: c.template, language: { code: c.language }, components: [{ type: "body", parameters: parameters.map((text) => ({ type: "text", text })) }] },
  };
  try {
    const response = await fetch(c.apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json", "X-app-key": c.appKey, "X-App-Secret": c.appSecret },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text().catch(() => "");
    let json: { messages?: { id?: string }[] } | null = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      /* not JSON */
    }
    if (!response.ok) return log({ ...base, status: "FAILED", error: `WhatsApp API ${response.status}: ${text.slice(0, 900)}` });
    const messageId = json?.messages?.[0]?.id ?? "";
    return log({ ...base, status: "SENT", messageId, error: messageId ? null : "Accepted without a message id; delivery not confirmed." });
  } catch (error) {
    return log({ ...base, status: "FAILED", error: error instanceof Error ? error.message : String(error) });
  }
}

/** Queues a notice; messages go one after another with a short gap, and never hold up the request. */
export function queueWhatsApp(notice: Notice) {
  queue = queue
    .then(() => new Promise((resolve) => setTimeout(resolve, 400)))
    .then(() => send(notice))
    .catch((error) => console.error("WhatsApp send failed", error));
  return queue;
}

/** People's names and mobiles by user id. */
export async function phonesFor(userIds: string[]) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return [];
  const users = await db.user.findMany({ where: { id: { in: ids }, active: true } });
  return users.map((user: { id: string; name: string; phone?: string }) => ({ id: user.id, name: user.name, phone: user.phone ?? "" }));
}
