import { db } from "../db";

export const TEMPLATES: { event: string; subject: string; body: string }[] = [
  {
    event: "TASK_ASSIGNED",
    subject: "{{recordId}} assigned: {{taskTitle}}",
    body: "Hello {{recipientName}},\n\n{{taskTitle}} is now on your worklist for {{projectName}} ({{recordId}}).\nDue: {{dueAt}}\n\nOpen the tender: {{link}}",
  },
  {
    event: "SLA_REMINDER_50",
    subject: "{{recordId}} reminder: half the SLA has elapsed",
    body: "Hello {{recipientName}},\n\n{{taskTitle}} for {{projectName}} ({{recordId}}) has used half of its working-time SLA.\nDue: {{dueAt}}\n\n{{link}}",
  },
  {
    event: "SLA_REMINDER_75",
    subject: "{{recordId}} urgent: SLA is nearly due",
    body: "Hello {{recipientName}},\n\n{{taskTitle}} for {{projectName}} ({{recordId}}) has used 75% of its working-time SLA.\nDue: {{dueAt}}\n\n{{link}}",
  },
  {
    event: "SLA_BREACH",
    subject: "{{recordId}} overdue: {{taskTitle}}",
    body: "Hello {{recipientName}},\n\n{{taskTitle}} for {{projectName}} ({{recordId}}) is past its SLA.\nDue: {{dueAt}}\n\n{{link}}",
  },
  {
    event: "SLA_BREACH_LEVEL2",
    subject: "{{recordId}} escalation: {{taskTitle}} remains overdue",
    body: "Hello {{recipientName}},\n\n{{taskTitle}} for {{projectName}} ({{recordId}}) is still overdue and has been escalated.\nDue: {{dueAt}}\n\n{{link}}",
  },
  {
    event: "TASK_COMPLETED",
    subject: "{{recordId}} completed: {{taskTitle}}",
    body: "Hello {{recipientName}},\n\n{{taskTitle}} was completed for {{projectName}} ({{recordId}}).\n{{detail}}\n\n{{link}}",
  },
  {
    event: "RELEVANCE_DECISION",
    subject: "{{recordId}} relevance {{decision}}",
    body: "Hello {{recipientName}},\n\nRelevance review for {{projectName}} ({{recordId}}) is {{decision}}.\n{{comments}}\n\n{{link}}",
  },
  {
    event: "APPROVAL_DECISION",
    subject: "{{recordId}} costing {{decision}}",
    body: "Hello {{recipientName}},\n\nDepartment Head decision for {{projectName}} ({{recordId}}): {{decision}}.\n{{comments}}\n\n{{link}}",
  },
  {
    event: "EMD_COMPLETED",
    subject: "{{recordId}} EMD {{decision}}",
    body: "Hello {{recipientName}},\n\nThe EMD task for {{projectName}} ({{recordId}}) is {{decision}}.\n{{detail}}\n\n{{link}}",
  },
  {
    event: "BID_DEADLINE",
    subject: "{{recordId}} bid deadline in {{detail}}",
    body: "Hello {{recipientName}},\n\n{{projectName}} ({{recordId}}) is due for bid submission at {{dueAt}}.\nTime remaining on the portal clock: {{detail}}.\n\n{{link}}",
  },
  {
    event: "BID_READY",
    subject: "{{recordId}} is ready to bid",
    body: "Hello {{recipientName}},\n\n{{projectName}} ({{recordId}}) has passed readiness checks. Submit the bid on the portal and record the acknowledgement here.\nDeadline: {{dueAt}}\n\n{{link}}",
  },
  {
    event: "SUBMISSION_EVIDENCE_MISSING",
    subject: "{{recordId}} submission evidence is missing",
    body: "Hello {{recipientName}},\n\n{{projectName}} ({{recordId}}) is marked submitted, but the portal acknowledgement is not on the record yet.\n\n{{link}}",
  },
  {
    event: "DEADLINE_MISSED",
    subject: "{{recordId}} was not bid before the deadline",
    body: "Hello {{recipientName}},\n\n{{projectName}} ({{recordId}}) passed its bid submission deadline without a recorded submission.\nDeadline: {{dueAt}}\n\n{{link}}",
  },
  {
    event: "OCR_FAILED",
    subject: "{{recordId}} document extraction failed",
    body: "Hello {{recipientName}},\n\nText could not be extracted from the documents for {{projectName}} ({{recordId}}). The tender is waiting for manual entry. {{detail}}\n\n{{link}}",
  },
  {
    event: "TENDER_AMENDMENT",
    subject: "{{recordId}} deadline changed",
    body: "Hello {{recipientName}},\n\nThe bid submission deadline for {{projectName}} ({{recordId}}) changed.\n{{detail}}\n\n{{link}}",
  },
];

function fill(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => vars[key] ?? "");
}

const escapeHtml = (value: string) => value.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);

/** Mail settings read from the environment. MAIL_REDIRECT_TO sends every message to one inbox for testing. */
export function mailConfig() {
  return {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER || "",
    hasPassword: Boolean(process.env.SMTP_PASS),
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "",
    redirectTo: (process.env.MAIL_REDIRECT_TO || "").trim(),
  };
}

/** True when a server and its sign-in are both set; otherwise notices stay in the log only. */
export function mailReady() {
  const config = mailConfig();
  return Boolean(config.host && config.user && config.hasPassword);
}

let cachedTransport: import("nodemailer").Transporter | null = null;
async function transport() {
  if (cachedTransport) return cachedTransport;
  const config = mailConfig();
  const nodemailer = await import("nodemailer");
  cachedTransport = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user ? { user: config.user, pass: process.env.SMTP_PASS } : undefined,
  });
  return cachedTransport;
}

/** Branded HTML version of a plain-text notice; the tender link becomes a button. */
function renderHtml(subject: string, body: string, link: string, intendedFor: string | null) {
  const paragraphs = escapeHtml(body.replace(link, "").trim())
    .split(/\n{2,}/)
    .map((block) => `<p style="margin:0 0 14px;line-height:1.55">${block.replace(/\n/g, "<br>")}</p>`)
    .join("");
  const banner = intendedFor
    ? `<div style="background:#fff4e6;border:1px solid #f8d9b4;color:#9a4a0b;border-radius:10px;padding:10px 14px;margin-bottom:16px;font-size:13px">Test mode: this message was addressed to <b>${escapeHtml(intendedFor)}</b>.</div>`
    : "";
  return `<!doctype html><html><body style="margin:0;background:#f5f4f2;font-family:Segoe UI,Arial,sans-serif;color:#1c1917">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 8px 24px rgba(41,37,36,.12)">
<tr><td style="background:linear-gradient(135deg,#2b2724,#1c1917);padding:20px 24px;color:#fff">
<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#fdba74">Coal &amp; Ash tenders</div>
<div style="font-size:18px;font-weight:700;margin-top:4px">${escapeHtml(subject)}</div></td></tr>
<tr><td style="height:3px;background:linear-gradient(90deg,#3a3532,#a8a29e,#ea580c)"></td></tr>
<tr><td style="padding:22px 24px;font-size:15px">${banner}${paragraphs}
<a href="${escapeHtml(link)}" style="display:inline-block;background:#c2410c;color:#fff;text-decoration:none;font-weight:600;padding:11px 20px;border-radius:10px">Open the tender</a>
</td></tr>
<tr><td style="padding:14px 24px;background:#faf8f6;color:#78716c;font-size:12px">Sent by the Coal &amp; Ash tender workflow. Due times use the company working calendar.</td></tr>
</table></td></tr></table></body></html>`;
}

/** Sends one message, honouring MAIL_REDIRECT_TO. Returns the delivery status for the log. */
export async function deliver(message: { to: string; toName: string; subject: string; text: string; link: string }) {
  const config = mailConfig();
  if (!mailReady()) return "LOGGED";
  const redirected = config.redirectTo && config.redirectTo.toLowerCase() !== message.to.toLowerCase();
  const intendedFor = redirected ? `${message.toName} <${message.to}>` : null;
  try {
    await (await transport()).sendMail({
      from: config.from,
      to: redirected ? config.redirectTo : message.to,
      subject: redirected ? `[for ${message.toName}] ${message.subject}` : message.subject,
      text: intendedFor ? `Test mode: addressed to ${intendedFor}.\n\n${message.text}` : message.text,
      html: renderHtml(message.subject, message.text, message.link, intendedFor),
    });
    return "SENT";
  } catch (error) {
    console.error("Email delivery failed", error);
    return "FAILED";
  }
}

export async function notifyAddresses(options: {
  tenderId: string;
  taskId?: string;
  event: string;
  templateEvent?: string;
  addresses: { email: string; name: string }[];
  extra?: Record<string, string>;
}) {
  const unique = new Map<string, { email: string; name: string }>();
  for (const address of options.addresses) {
    const email = address.email.trim().toLowerCase();
    if (!email) continue;
    if (!unique.has(email)) unique.set(email, { email, name: address.name || email });
  }
  if (!unique.size) return;

  const tender = await db.tender.findUnique({ where: { id: options.tenderId } });
  if (!tender) return;
  const templateKey = options.templateEvent ?? options.event;
  const template = (await db.emailTemplate.findUnique({ where: { event: templateKey } })) ??
    TEMPLATES.find((item) => item.event === templateKey);
  const subjectTpl = template?.subject ?? options.event;
  const bodyTpl = template?.body ?? "{{projectName}} ({{recordId}})\n{{link}}";

  for (const address of unique.values()) {
    const vars = {
      recordId: tender.recordId,
      projectName: tender.projectName || "Untitled tender",
      recipientName: address.name,
      link: `${process.env.APP_URL || "http://localhost:5173"}/tenders/${tender.id}`,
      taskTitle: "",
      dueAt: "",
      decision: "",
      comments: "",
      detail: "",
      ...options.extra,
    };
    const subject = fill(subjectTpl, vars);
    const body = fill(bodyTpl, vars);
    const status = await deliver({ to: address.email, toName: address.name, subject, text: body, link: vars.link });
    await db.notificationLog.create({
      data: {
        tenderId: tender.id,
        taskId: options.taskId ?? "",
        eventType: options.event,
        recipientEmail: address.email,
        recipientName: address.name,
        subject,
        body,
        status,
      },
    });
  }
}

export async function emailsFor(userIds: string[]) {
  if (!userIds.length) return [];
  const users = await db.user.findMany({ where: { id: { in: userIds }, active: true } });
  return users.map((user) => ({ email: user.email, name: user.name }));
}
