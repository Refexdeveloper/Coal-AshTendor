import { db } from "../db";
import { formatWhen } from "../utils/calendar";
import { CLOSED_OVERALL, OPEN_TASK, OVERALL, STAGE } from "../utils/labels";
import { inr, inrFull } from "../utils/money";
import { renderEmail, renderEmailText, type EmailContent, type EmailFacts } from "./email-layout";

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
    event: "WORKFLOW_STEP",
    subject: "{{recordId}}: {{action}}",
    body: "Hello {{recipientName}},\n\n{{action}} on {{projectName}} ({{recordId}}) by {{actorName}}.\n{{detail}}\n\n{{link}}",
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

/**
 * Outgoing mail, set up like the P2P app: Google Workspace SMTP on 587 with STARTTLS, sent from
 * support@refexone.com, one pooled connection with a rate limit so Gmail is not flooded.
 * Everything is set here, as in P2P; server/.env (SMTP_HOST, SMTP_USER, SMTP_PASS, ...) can still override it.
 */
/**
 * Test mode: every email goes only to this inbox, whoever it is for. The subject starts with "[for Name]"
 * and a banner names the real recipient, so each workflow step can be checked from one mailbox.
 * Set this to "" (or MAIL_REDIRECT_TO= on the server) when the app goes live and people should get their own mail.
 */
const TEST_INBOX = "sathishkumar.r@refex.co.in";

const SMTP_DEFAULTS = {
  host: "smtp.gmail.com",
  port: 587,
  user: "support@refexone.com",
  // Google app password for support@refexone.com, the same one the P2P app uses. Keep this repository private.
  pass: "skrmayqcqwvjanne",
  fromEmail: "support@refexone.com",
  fromName: "Coal & Ash Tenders",
};

/** Mail settings. MAIL_REDIRECT_TO sends every message to one inbox for testing. */
export function mailConfig() {
  const port = Number(process.env.SMTP_PORT || SMTP_DEFAULTS.port);
  const pass = (process.env.SMTP_PASS || process.env.SMTP_PASSWORD || SMTP_DEFAULTS.pass).replace(/\s+/g, "");
  const secureEnv = (process.env.SMTP_SECURE || "").trim();
  return {
    host: (process.env.SMTP_HOST || SMTP_DEFAULTS.host).trim(),
    port,
    secure: secureEnv ? secureEnv === "true" : port === 465,
    user: (process.env.SMTP_USER || SMTP_DEFAULTS.user).trim(),
    pass,
    hasPassword: Boolean(pass),
    from:
      (process.env.SMTP_FROM || "").trim() ||
      `"${(process.env.SMTP_FROM_NAME || SMTP_DEFAULTS.fromName).trim()}" <${(process.env.SMTP_FROM_EMAIL || SMTP_DEFAULTS.fromEmail).trim()}>`,
    redirectTo: (process.env.MAIL_REDIRECT_TO ?? TEST_INBOX).trim(),
  };
}

/** Inboxes that get a copy of every workflow step (MAIL_STEP_COPY_TO, comma separated). */
export function stepCopyAddresses() {
  return (process.env.MAIL_STEP_COPY_TO || "")
    .split(",")
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email, name: email }));
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
    auth: { user: config.user, pass: config.pass },
    requireTLS: !config.secure && config.port === 587,
    pool: true,
    maxConnections: 1,
    maxMessages: 100,
    rateDelta: 1000,
    rateLimit: 8,
    connectionTimeout: 12_000,
    greetingTimeout: 12_000,
    socketTimeout: 30_000,
  });
  return cachedTransport;
}

/** Link to a page of this app for emails: through Refex One sign-in when it is set up (see appLink). */
export async function emailLink(path: string) {
  const { appLink } = await import("./refexone");
  return appLink(path);
}

/** A plain notice in the email layout: the first paragraphs become the header, the link becomes the button. */
function plainContent(subject: string, text: string, link: string): EmailContent {
  const blocks = text
    .replace(link, "")
    // A label left over from "Open the tender: {{link}}" once the link becomes the button.
    .replace(/^[^\S\n]*[^\n:]{1,40}:[^\S\n]*$/gm, "")
    .trim()
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  const greeting = blocks[0] && /^hello\b/i.test(blocks[0]) ? blocks.shift() : "";
  const intro = [greeting, blocks.shift() ?? ""].filter(Boolean).join(" ");
  return { headline: subject, intro, body: blocks.join("\n\n"), cta: { label: "Open Coal & Ash →", url: link } };
}

/** Who actually receives the message. Workflow mail goes only to the test inbox while that is set. */
export function deliveredTo(to: string, toName: string) {
  const inbox = mailConfig().redirectTo;
  if (inbox && inbox.toLowerCase() !== to.toLowerCase()) {
    return { email: inbox, name: "Sathishkumar", forWhom: `${toName} <${to}>` };
  }
  return { email: to, name: toName, forWhom: "" };
}

export type MailAttachment = { filename: string; content: string | Buffer; contentType: string; documentId?: string };

/** Where a message belongs in the mail log. Without it the message is sent but not logged. */
export type MailLog = { tenderId?: string | null; taskId?: string; eventType: string; note?: string };

const sizeLabel = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Sends one message, honouring the test inbox, and keeps a full log row like P2P's email log: queued first,
 * then sent (with Gmail's message ID), failed (with the error) or logged when mail is not set up. The row keeps
 * who the message was for and where it actually went, plus the exact HTML so it can be previewed and resent.
 */
export async function deliver(message: {
  to: string;
  toName: string;
  subject: string;
  text: string;
  link: string;
  /** Rich content for the email layout. Without it, the plain text is laid out as a simple notice. */
  content?: EmailContent;
  /** Exact HTML to send again (resend from the log); skips the layout. */
  rawHtml?: string;
  /** Send to this address itself. The daily report uses this so an extra recipient is not folded into the test inbox. */
  direct?: boolean;
  attachments?: MailAttachment[];
  log?: MailLog;
}) {
  const config = mailConfig();
  const target = message.direct ? { email: message.to, name: message.toName, forWhom: "" } : deliveredTo(message.to, message.toName);
  const intendedFor = target.forWhom || null;
  const subject = intendedFor ? `[for ${message.toName}] ${message.subject}` : message.subject;
  const content: EmailContent = {
    ...(message.content ?? plainContent(message.subject, message.text, message.link)),
    banner: intendedFor ? `Test mode: this message was addressed to ${intendedFor}.` : undefined,
  };
  const html = message.rawHtml ?? renderEmail(content);
  const text = message.content ? renderEmailText(content) : intendedFor ? `Test mode: addressed to ${intendedFor}.\n\n${message.text}` : message.text;
  const files = message.attachments ?? [];
  const attachmentLog = files.map((file) => ({ filename: file.filename, size: Buffer.byteLength(file.content), documentId: file.documentId ?? "" }));

  const row = message.log
    ? await db.notificationLog
        .create({
          data: {
            tenderId: message.log.tenderId ?? null,
            taskId: message.log.taskId ?? "",
            eventType: message.log.eventType,
            recipientEmail: message.to,
            recipientName: message.toName,
            subject: message.subject,
            body: message.text,
            status: "QUEUED",
            deliveredTo: target.email,
            attachments: attachmentLog.length ? JSON.stringify(attachmentLog) : null,
            html,
            note: message.log.note ?? null,
          },
        })
        .catch((error) => {
          console.error("Mail log write failed", error);
          return null;
        })
    : null;
  const finish = async (data: Record<string, unknown>) => {
    if (row) await db.notificationLog.update({ where: { id: row.id }, data }).catch((error) => console.error("Mail log update failed", error));
  };

  if (!mailReady()) {
    await finish({ status: "LOGGED", errorMessage: "Mail is not set up (no SMTP password), so the message was only logged." });
    return "LOGGED";
  }
  const mail = {
    from: config.from,
    to: target.email,
    subject,
    text,
    html,
    attachments: files.length ? files.map(({ filename, content: body, contentType }) => ({ filename, content: body, contentType })) : undefined,
  };
  try {
    let info;
    try {
      info = await (await transport()).sendMail(mail);
    } catch (first) {
      // One reconnect and retry, as in P2P: dropped SMTP sessions usually succeed on a fresh connection.
      console.warn("Email send failed, retrying once:", first instanceof Error ? first.message : first);
      cachedTransport?.close();
      cachedTransport = null;
      info = await (await transport()).sendMail(mail);
    }
    await finish({ status: "SENT", messageId: String(info?.messageId ?? ""), sentAt: new Date() });
    return "SENT";
  } catch (error) {
    console.error("Email delivery failed", error);
    await finish({ status: "FAILED", errorMessage: (error instanceof Error ? error.message : String(error)).slice(0, 2000) });
    return "FAILED";
  }
}

const ATTACH_LIMIT = 15 * 1024 * 1024;

/**
 * The tender's uploaded documents, newest first, one per file name, up to 15 MB in all (Gmail allows 25 MB).
 * Read once per notice and reused for every recipient. Files that do not fit are named in the email instead.
 */
export async function tenderAttachments(tenderId: string) {
  const { readStored } = await import("./files");
  const documents = await db.tenderDocument.findMany({ where: { tenderId }, orderBy: { uploadedAt: "desc" } });
  const seen = new Set<string>();
  const files: MailAttachment[] = [];
  const skipped: string[] = [];
  let total = 0;
  for (const document of documents) {
    if (seen.has(document.fileName)) continue;
    seen.add(document.fileName);
    const size = Number(document.sizeBytes) || 0;
    if (total + size > ATTACH_LIMIT) {
      skipped.push(`${document.fileName} (${sizeLabel(size)})`);
      continue;
    }
    try {
      const content = await readStored(document.storedPath);
      files.push({ filename: document.fileName, content, contentType: document.mimeType || "application/octet-stream", documentId: document.id });
      total += content.length;
    } catch {
      skipped.push(`${document.fileName} (could not be read)`);
    }
  }
  const lines = [
    ...files.map((file) => `${file.filename} · ${sizeLabel(Buffer.byteLength(file.content))}`),
    ...skipped.map((name) => `${name} · too large to attach, open it in Coal & Ash`),
  ];
  return { files, lines };
}

/** Sends a logged message again, to its original recipient and any extra addresses (all still go through the test inbox). */
export async function resendLogged(logId: string, extraTo: string[] = []) {
  const original = await db.notificationLog.findUnique({ where: { id: logId } });
  if (!original) return { error: "That email is no longer in the log." };
  const attachments: MailAttachment[] = [];
  const listed = original.attachments ? (JSON.parse(original.attachments) as { filename: string; documentId?: string }[]) : [];
  if (listed.length) {
    const { readStored } = await import("./files");
    for (const item of listed) {
      if (!item.documentId) continue;
      const document = await db.tenderDocument.findUnique({ where: { id: item.documentId } });
      if (!document) continue;
      try {
        attachments.push({ filename: document.fileName, content: await readStored(document.storedPath), contentType: document.mimeType || "application/octet-stream", documentId: document.id });
      } catch {
        // a document removed since the first send is left out
      }
    }
  }
  const targets = [
    { email: original.recipientEmail, name: original.recipientName || original.recipientEmail },
    ...extraTo.map((email) => ({ email, name: email })),
  ];
  const statuses: string[] = [];
  for (const target of targets) {
    statuses.push(
      await deliver({
        to: target.email,
        toName: target.name,
        subject: original.subject,
        text: original.body,
        link: "",
        rawHtml: original.html || undefined,
        attachments,
        log: { tenderId: original.tenderId, taskId: original.taskId, eventType: original.eventType, note: `Resent from an earlier ${String(original.status).toLowerCase()} email` },
      }),
    );
  }
  const sent = statuses.filter((status) => status === "SENT").length;
  const where = targets.map((target) => target.email).join(", ");
  if (!sent) return { error: `Not sent (${statuses.join(", ").toLowerCase()}) to ${where}. The newest rows in the log show why.` };
  const inbox = mailConfig().redirectTo;
  return { ok: `Resent to ${where}${inbox ? ` (test mode: delivered to ${inbox})` : ""}.` };
}

type TenderFacts = { recordId: string; projectName: string; clientName: string; estimatedValue: number | null; bidSubmissionEnd: Date | null; overallStatus: string };

/** The tender's key facts for the email header. */
async function factsFor(tender: TenderFacts): Promise<EmailFacts> {
  const settings = await db.calendarSettings.findUnique({ where: { id: "default" } }).catch(() => null);
  const timeZone = settings?.timezone || "Asia/Kolkata";
  const value = tender.estimatedValue ? `${inr(tender.estimatedValue)} (${inrFull(tender.estimatedValue)})` : "";
  return {
    recordId: tender.recordId,
    projectName: tender.projectName || "Untitled tender",
    clientName: tender.clientName || "",
    value,
    deadline: tender.bidSubmissionEnd ? formatWhen(tender.bidSubmissionEnd, timeZone) : "",
    status: OVERALL[tender.overallStatus]?.label ?? tender.overallStatus,
  };
}

/** Audit actions that are not a step moving: edits and housekeeping get no step email. */
const NOT_A_STEP = new Set(["Corrected tender fields", "Uploaded documents", "Extracted tender fields", "Escalation recipient missing", "Synced Refex One users"]);

export function isStepAction(action: string) {
  return !NOT_A_STEP.has(action);
}

/** The step that just moved on this tender (within the last 15 minutes), for "Completed step" boxes. */
async function lastStep(tenderId: string) {
  const rows = await db.auditLog.findMany({ where: { tenderId }, orderBy: { createdAt: "desc" }, take: 10 });
  const row = rows.find((item) => isStepAction(item.action) && Date.now() - item.createdAt.getTime() < 15 * 60 * 1000);
  return row ? { label: row.action, note: `by ${row.actorName || "the system"}` } : undefined;
}

/**
 * The P2P-style step email: sent whenever a tender's workflow moves. The person who acted gets a confirmation,
 * the tender's creator and MAIL_STEP_COPY_TO an update; the next owners get their own "pending your action"
 * mail when their task is assigned. Each message shows the completed step and what comes next.
 */
export async function notifyStepMoved(step: { tenderId: string; action: string; actorId: string; actorName: string; detail?: string }) {
  if (!isStepAction(step.action)) return;
  const tender = await db.tender.findUnique({ where: { id: step.tenderId } });
  if (!tender) return;
  const openTasks = await db.workflowTask.findMany({ where: { tenderId: tender.id, status: { in: OPEN_TASK } }, orderBy: { dueAt: "asc" } });
  const ownerIds = [...new Set(openTasks.flatMap((task) => JSON.parse(task.assigneeIds || "[]") as string[]))];
  const owners = await db.user.findMany({ where: { id: { in: ownerIds } } });
  const names = new Map(owners.map((user) => [user.id, user.name]));
  const closed = CLOSED_OVERALL.includes(tender.overallStatus);
  const nextLabel = openTasks.length
    ? [...new Set(openTasks.map((task) => STAGE[task.stage] ?? task.title))].join(" + ")
    : closed
      ? OVERALL[tender.overallStatus]?.label ?? "Closed"
      : "No open step";
  const nextNote = openTasks.length
    ? `With ${[...new Set(openTasks.flatMap((task) => (JSON.parse(task.assigneeIds || "[]") as string[]).map((id) => names.get(id) ?? "someone")))].join(", ")}`
    : closed
      ? "No further steps on this tender"
      : "";

  const actor = await db.user.findUnique({ where: { id: step.actorId } }).catch(() => null);
  const creator = tender.createdById && tender.createdById !== step.actorId ? await db.user.findUnique({ where: { id: tender.createdById } }).catch(() => null) : null;
  const recipients = new Map<string, { email: string; name: string; perspective: "actor" | "fyi" }>();
  const add = (email: string | undefined, name: string, perspective: "actor" | "fyi") => {
    const key = (email || "").trim().toLowerCase();
    if (key && !recipients.has(key)) recipients.set(key, { email: key, name, perspective });
  };
  if (actor?.active) add(actor.email, actor.name, "actor");
  if (creator?.active) add(creator.email, creator.name, "fyi");
  // In test mode everything already reaches the test inbox, so its own step copy would only repeat the same step.
  const inbox = mailConfig().redirectTo.toLowerCase();
  for (const copy of stepCopyAddresses()) {
    if (inbox && copy.email.toLowerCase() === inbox && recipients.size) continue;
    add(copy.email, copy.name, "fyi");
  }
  if (!recipients.size) return;

  const facts = await factsFor(tender);
  const link = await emailLink(`/tenders/${tender.id}`);
  const subject = closed && !openTasks.length ? `${tender.recordId}: ${step.action} — ${nextLabel}` : `${tender.recordId}: ${step.action} → next: ${nextLabel}`;
  const attached = await tenderAttachments(tender.id);
  for (const person of recipients.values()) {
    const content: EmailContent = {
      headline: person.perspective === "actor" ? "Your step was recorded — workflow moved" : closed && !openTasks.length ? `Tender closed: ${nextLabel}` : "Step completed — workflow moved",
      intro:
        person.perspective === "actor"
          ? `Hello ${person.name}, "${step.action}" was recorded. The tender has moved to: ${nextLabel}.`
          : `Hello ${person.name}, ${step.actorName} completed "${step.action}". The workflow has moved to: ${nextLabel}.`,
      facts,
      completed: { label: step.action, note: `by ${step.actorName}` },
      next: { label: nextLabel, note: nextNote || undefined },
      remarks: step.detail?.trim() ? step.detail.trim().slice(0, 1500) : undefined,
      attachments: attached.lines,
      cta: { label: "View the tender →", url: link },
      footer: "You get an update whenever this tender moves to the next step.",
    };
    const text = renderEmailText(content);
    await deliver({ to: person.email, toName: person.name, subject, text, link, content, attachments: attached.files, log: { tenderId: tender.id, eventType: "WORKFLOW_STEP" } });
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

  const link = await emailLink(`/tenders/${tender.id}`);
  const facts = await factsFor(tender);
  const assigned = options.event === "TASK_ASSIGNED" || options.event === "OCR_FAILED";
  const completed = assigned ? await lastStep(tender.id) : undefined;
  const attached = assigned ? await tenderAttachments(tender.id) : { files: [] as MailAttachment[], lines: [] as string[] };

  for (const address of unique.values()) {
    const vars = {
      recordId: tender.recordId,
      projectName: tender.projectName || "Untitled tender",
      recipientName: address.name,
      link,
      taskTitle: "",
      dueAt: "",
      decision: "",
      comments: "",
      detail: "",
      ...options.extra,
    };
    const subject = fill(subjectTpl, vars);
    const body = fill(bodyTpl, vars);
    const plain = plainContent(subject, body, vars.link);
    const content: EmailContent = {
      ...plain,
      headline: assigned && vars.taskTitle ? `Pending your action — ${vars.taskTitle}` : subject,
      facts,
      completed,
      next: assigned && vars.taskTitle ? { label: vars.taskTitle, note: vars.dueAt ? `Pending your action · due ${vars.dueAt}` : "Pending your action" } : undefined,
      attachments: attached.lines.length ? attached.lines : undefined,
      cta: { label: assigned ? "Review and act →" : "View the tender →", url: vars.link },
    };
    await deliver({
      to: address.email,
      toName: address.name,
      subject,
      text: body,
      link: vars.link,
      content,
      attachments: attached.files,
      log: { tenderId: tender.id, taskId: options.taskId, eventType: options.event },
    });
  }
}

function safeFile(name: string) {
  const base = name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "-").replace(/-+/g, "-").slice(0, 80);
  return base || "upload";
}

/** Inbox that receives the raw OCR JSON. Override with OCR_RESULT_EMAIL. */
export function ocrResultEmail() {
  return (process.env.OCR_RESULT_EMAIL || "sathishkumar.r@refex.co.in").trim();
}

/** Emails the OCR service JSON for one uploaded file and records it in Notifications. */
export async function mailOcrResult(tenderId: string, fileName: string, raw: string) {
  const email = ocrResultEmail();
  if (!email || !raw.trim()) return;
  const tender = await db.tender.findUnique({ where: { id: tenderId } });
  if (!tender) return;
  const subject = `${tender.recordId} OCR result JSON`;
  const text = `OCR result for ${fileName} on ${tender.projectName || "Untitled tender"} (${tender.recordId}).\n\n${raw}`;
  const link = `${process.env.APP_URL || "http://localhost:5173"}/tenders/${tender.id}?tab=details`;
  if (!mailReady()) console.error(`OCR result for ${fileName} was not emailed to ${email}: set SMTP_PASS in server/.env.`);
  await deliver({
    to: email,
    toName: "Sathishkumar",
    subject,
    text,
    link,
    attachments: [{ filename: `${safeFile(fileName)}-ocr-response.json`, content: raw, contentType: "application/json" }],
    log: { tenderId: tender.id, eventType: "OCR_RESULT" },
  });
}

export async function emailsFor(userIds: string[]) {
  if (!userIds.length) return [];
  const users = await db.user.findMany({ where: { id: { in: userIds }, active: true } });
  return users.map((user) => ({ email: user.email, name: user.name }));
}
