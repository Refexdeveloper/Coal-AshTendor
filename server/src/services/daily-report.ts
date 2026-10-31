import { db, type User, type WorkflowTask } from "../db";
import { formatWhen } from "../utils/calendar";
import { CLOSED_OVERALL, EMD_TYPE, OPEN_TASK, OVERALL, STAGE } from "../utils/labels";
import { inr, inrFull } from "../utils/money";
import { REFEXONE_EMAIL_LOGO_URL, escapeHtml } from "./email-layout";
import { deliver, emailLink, isStepAction } from "./notify";

/**
 * "Today's report", after the P2P app's activity report: one email with the day's figures, every step that
 * moved today, new tenders, bids closing soon, overdue and open work by person, the pipeline by stage and today's
 * mail, plus a CSV of every tender (opens in Excel). Sent from Administration with one button.
 */

/** Default recipient for the report button. */
export const REPORT_TO = "sathishkumar.r@refex.co.in";

const TIME_ZONE = "Asia/Kolkata";

const GROUPS = [
  { label: "Intake & review", statuses: ["UPLOADED", "OCR_PROCESSING", "DATA_VALIDATION_REQUIRED", "PENDING_RELEVANCE"] },
  { label: "Costing & EMD", statuses: ["APPROVED_IN_PROGRESS"] },
  { label: "Ready to bid", statuses: ["READY_TO_BID"] },
  { label: "Bid submitted", statuses: ["BID_EVIDENCE_PENDING", "BID_EVIDENCE_RECORDED"] },
  { label: "Awarded", statuses: ["WON"] },
  { label: "Lost", statuses: ["LOST"] },
  { label: "Closed / not bid", statuses: ["REJECTED_CLOSED", "NOT_BID_DEADLINE_MISSED", "CLOSED_BUSINESS", "CANCELLED"] },
];

/** The five steps every tender goes through, in order, and the tasks that belong to each. */
const TRACK = ["Intake & review", "Relevance review", "Costing & EMD", "Ready to bid", "Bid submitted"];
const STEP_TASKS = [
  ["DATA_VALIDATION", "OCR_EXCEPTION"],
  ["RELEVANCE"],
  ["DRAFT_COSTING", "SALES_INPUT", "FINAL_COSTING", "DEPT_APPROVAL", "EMD_CLARIFICATION", "EMD_BG", "EMD_ISB", "EMD_EXEMPTION", "EMD_OTHER"],
  [],
  ["BID_SUBMISSION"],
];

/** How far a tender has got: steps before the index are done, the index is the current step (5 = all done). */
const TRACK_INDEX: Record<string, number> = {
  UPLOADED: 0,
  OCR_PROCESSING: 0,
  DATA_VALIDATION_REQUIRED: 0,
  PENDING_RELEVANCE: 1,
  APPROVED_IN_PROGRESS: 2,
  READY_TO_BID: 3,
  BID_EVIDENCE_PENDING: 4,
  BID_EVIDENCE_RECORDED: 5,
};

/** Start of today in India time, as a UTC instant. */
function startOfToday(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  // India has no daylight saving: midnight there is 18:30 UTC the day before.
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - 330 * 60 * 1000);
}

const dayLabel = (date: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
const timeLabel = (date: Date) => new Intl.DateTimeFormat("en-IN", { timeZone: TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: true }).format(date);
const when = (date: Date | null | undefined) => formatWhen(date ?? null, TIME_ZONE);
const ids = (json: string) => {
  try {
    return JSON.parse(json || "[]") as string[];
  } catch {
    return [];
  }
};

export async function loadTodayReport(now = new Date()) {
  const start = startOfToday(now);
  const [tenders, users, audits, mails, documents] = await Promise.all([
    db.tender.findMany({ include: { tasks: true }, orderBy: { createdAt: "desc" } }),
    db.user.findMany(),
    db.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 3000 }),
    db.notificationLog.findMany({ orderBy: { createdAt: "desc" }, take: 3000, select: { status: true, createdAt: true } }),
    db.tenderDocument.findMany({ orderBy: { uploadedAt: "desc" }, select: { id: true, tenderId: true, fileName: true, docType: true, sizeBytes: true } }),
  ]);
  // The tender file: the newest notice, or else the newest document of any kind.
  const fileFor = new Map<string, { fileName: string; sizeBytes: number }>();
  for (const document of documents) {
    const current = fileFor.get(document.tenderId);
    if (!current || (document.docType === "NOTICE" && !(current as { notice?: boolean }).notice)) {
      fileFor.set(document.tenderId, { fileName: document.fileName, sizeBytes: Number(document.sizeBytes) || 0, ...(document.docType === "NOTICE" ? { notice: true } : {}) });
    }
  }
  const names = new Map(users.map((user: User) => [user.id, user.name]));
  const byId = new Map(tenders.map((tender) => [tender.id, tender]));
  const nowMs = now.getTime();
  // Everything from midnight on. No upper bound: rows a database clock stamped slightly ahead still belong to today.
  const today = (date: Date | null | undefined) => Boolean(date && date >= start);

  const active = tenders.filter((tender) => !CLOSED_OVERALL.includes(tender.overallStatus));
  const openTasks = tenders.flatMap((tender) =>
    (tender.tasks as WorkflowTask[]).filter((task) => OPEN_TASK.includes(task.status) && !CLOSED_OVERALL.includes(tender.overallStatus)).map((task) => ({ task, tender })),
  );
  const overdue = openTasks.filter(({ task }) => task.dueAt && task.dueAt.getTime() < nowMs).sort((a, b) => a.task.dueAt!.getTime() - b.task.dueAt!.getTime());
  const closing = active
    .filter((tender) => tender.bidSubmissionEnd && tender.bidSubmissionEnd.getTime() > nowMs && tender.bidSubmissionEnd.getTime() - nowMs < 7 * 864e5)
    .sort((a, b) => a.bidSubmissionEnd!.getTime() - b.bidSubmissionEnd!.getTime());
  const steps = audits.filter((row) => row.tenderId && today(row.createdAt) && isStepAction(row.action)).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const newToday = tenders.filter((tender) => today(tender.createdAt));
  const bidsToday = steps.filter((row) => /bid submission/i.test(row.action)).length;
  const outcomesToday = steps.filter((row) => /recorded outcome/i.test(row.action));
  const wonToday = outcomesToday.filter((row) => /WON/.test(row.detail)).length;
  const lostToday = outcomesToday.filter((row) => /LOST/.test(row.detail)).length;
  const mailToday = mails.filter((row) => today(row.createdAt));

  const people = new Map<string, { name: string; open: number; overdue: number; next: Date | null }>();
  for (const { task } of openTasks) {
    for (const id of ids(task.assigneeIds)) {
      const entry = people.get(id) ?? { name: names.get(id) ?? "Unknown", open: 0, overdue: 0, next: null };
      entry.open += 1;
      if (task.dueAt && task.dueAt.getTime() < nowMs) entry.overdue += 1;
      if (task.dueAt && (!entry.next || task.dueAt < entry.next)) entry.next = task.dueAt;
      people.set(id, entry);
    }
  }

  const sum = (list: typeof tenders, pick: (tender: (typeof tenders)[number]) => number | null) => list.reduce((total, tender) => total + (pick(tender) ?? 0), 0);
  const withWhom = (tender: (typeof tenders)[number]) =>
    [...new Set((tender.tasks as WorkflowTask[]).filter((task) => OPEN_TASK.includes(task.status)).flatMap((task) => ids(task.assigneeIds).map((id) => names.get(id) ?? "Unknown")))].join(", ");

  return {
    now,
    start,
    stats: {
      total: tenders.length,
      active: active.length,
      newToday: newToday.length,
      stepsToday: steps.length,
      bidsToday,
      wonToday,
      lostToday,
      overdue: overdue.length,
      closing: closing.length,
      pipelineValue: sum(active, (tender) => tender.estimatedValue),
      emdExposure: sum(active.filter((tender) => tender.emdType !== "EXEMPTION"), (tender) => tender.emdExposure),
    },
    steps: steps.map((row) => {
      const tender = byId.get(row.tenderId!);
      return { at: row.createdAt, recordId: tender?.recordId ?? "—", tenderId: row.tenderId!, project: tender?.projectName ?? "", action: row.action, by: row.actorName || "System", detail: row.detail };
    }),
    newTenders: newToday.map((tender) => ({
      id: tender.id,
      recordId: tender.recordId,
      project: tender.projectName || "Untitled",
      client: tender.clientName,
      value: tender.estimatedValue,
      deadline: tender.bidSubmissionEnd,
      status: OVERALL[tender.overallStatus]?.label ?? tender.overallStatus,
    })),
    pending: active
      .slice()
      .sort((a, b) => (a.bidSubmissionEnd?.getTime() ?? Infinity) - (b.bidSubmissionEnd?.getTime() ?? Infinity))
      .map((tender) => {
        const index = TRACK_INDEX[tender.overallStatus] ?? 0;
        const tasks = tender.tasks as WorkflowTask[];
        const person = (id: string) => (id ? names.get(id) ?? "" : "");
        const stageOrder = STEP_TASKS.flat();
        const steps: { label: string; state: "done" | "current" | "todo"; who: string; whenText: string }[] = [];
        for (let step = 0; step < TRACK.length; step++) {
          const state = (step < index ? "done" : step === index ? "current" : "todo") as "done" | "current" | "todo";
          const related = tasks
            .filter((task) => STEP_TASKS[step].includes(task.stage) && task.status !== "CANCELLED")
            .sort((a, b) => stageOrder.indexOf(a.stage) - stageOrder.indexOf(b.stage));
          const open = related.filter((task) => OPEN_TASK.includes(task.status));
          const finished = related.filter((task) => !OPEN_TASK.includes(task.status));
          if (state === "todo" || (!finished.length && !(state === "current" && open.length))) {
            steps.push({ label: TRACK[step], state, who: "", whenText: "" });
            continue;
          }
          for (const task of finished) {
            steps.push({
              label: STAGE[task.stage] ?? task.title,
              state: "done",
              who: person(task.completedById),
              whenText: task.completedAt ? when(task.completedAt) : "",
            });
          }
          if (state === "current") {
            for (const task of open) {
              steps.push({
                label: STAGE[task.stage] ?? task.title,
                state: "current",
                who: [...new Set(ids(task.assigneeIds).map(person).filter(Boolean))].join(", "),
                whenText: "",
              });
            }
          }
        }
        const late = (tender.tasks as WorkflowTask[]).some((task) => OPEN_TASK.includes(task.status) && task.dueAt && task.dueAt.getTime() < nowMs);
        return {
          id: tender.id,
          recordId: tender.recordId,
          project: tender.projectName || "Untitled",
          client: tender.clientName,
          location: tender.location,
          portal: tender.portalName,
          reference: [tender.tenderRef, tender.externalTenderId].filter(Boolean).join(" · "),
          status: OVERALL[tender.overallStatus]?.label ?? tender.overallStatus,
          received: tender.createdAt,
          deadline: tender.bidSubmissionEnd,
          opening: tender.bidOpeningAt,
          daysLeft: tender.bidSubmissionEnd ? (tender.bidSubmissionEnd.getTime() - nowMs) / 864e5 : null,
          estimated: tender.estimatedValue,
          finalCosting: tender.finalCostingValue,
          emd: tender.emdExposure,
          emdType: EMD_TYPE[tender.emdType] ?? tender.emdType,
          withWhom: withWhom(tender),
          late,
          file: fileFor.get(tender.id) ?? null,
          steps,
          stage: index >= TRACK.length ? "All steps done, awaiting result" : TRACK[index],
        };
      }),
    closing: closing.map((tender) => ({
      id: tender.id,
      recordId: tender.recordId,
      project: tender.projectName || "Untitled",
      client: tender.clientName,
      deadline: tender.bidSubmissionEnd!,
      daysLeft: (tender.bidSubmissionEnd!.getTime() - nowMs) / 864e5,
      status: tender.overallStatus === "APPROVED_IN_PROGRESS" ? "In progress" : (OVERALL[tender.overallStatus]?.label ?? tender.overallStatus),
      withWhom: withWhom(tender),
    })),
    overdue: overdue.map(({ task, tender }) => ({
      id: tender.id,
      recordId: tender.recordId,
      project: tender.projectName || "Untitled",
      task: STAGE[task.stage] ?? task.title,
      withWhom: ids(task.assigneeIds).map((id) => names.get(id) ?? "Unknown").join(", "),
      due: task.dueAt!,
      lateDays: (nowMs - task.dueAt!.getTime()) / 864e5,
    })),
    people: [...people.values()].sort((a, b) => b.overdue - a.overdue || b.open - a.open),
    stages: GROUPS.map((group) => {
      const list = tenders.filter((tender) => group.statuses.includes(tender.overallStatus));
      return { label: group.label, count: list.length, value: sum(list, (tender) => tender.estimatedValue) };
    }),
    mail: {
      sent: mailToday.filter((row) => row.status === "SENT").length,
      failed: mailToday.filter((row) => row.status === "FAILED").length,
      notSent: mailToday.filter((row) => row.status === "LOGGED").length,
    },
    rows: tenders.map((tender) => ({
      recordId: tender.recordId,
      project: tender.projectName,
      client: tender.clientName,
      location: tender.location,
      portal: tender.portalName,
      status: OVERALL[tender.overallStatus]?.label ?? tender.overallStatus,
      estimated: tender.estimatedValue,
      finalCosting: tender.finalCostingValue,
      emd: tender.emdExposure,
      emdType: EMD_TYPE[tender.emdType] ?? tender.emdType,
      deadline: tender.bidSubmissionEnd,
      received: tender.createdAt,
      withWhom: withWhom(tender),
      stage: CLOSED_OVERALL.includes(tender.overallStatus) ? "Closed" : (TRACK[TRACK_INDEX[tender.overallStatus] ?? 0] ?? "All steps done"),
      file: fileFor.get(tender.id)?.fileName ?? "",
    })),
  };
}

type Report = Awaited<ReturnType<typeof loadTodayReport>>;

const cell = "padding:8px 10px;border-bottom:1px solid #eeeae6;font-size:13px;color:#292524;vertical-align:top";
const head = "padding:8px 10px;background:#f5f2ee;font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:#57534e;text-align:left";

function table(headers: string[], rows: string[][], empty: string) {
  if (!rows.length) return `<p style="margin:8px 0 0;font-size:13px;color:#78716c">${escapeHtml(empty)}</p>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:8px;border:1px solid #eeeae6;border-radius:8px">
<tr>${headers.map((label) => `<th style="${head}">${escapeHtml(label)}</th>`).join("")}</tr>
${rows.map((row) => `<tr>${row.map((value) => `<td style="${cell}">${value}</td>`).join("")}</tr>`).join("")}
</table>`;
}

function section(title: string, note: string, body: string) {
  return `<tr><td style="padding:22px 28px 0">
<div style="font-size:16px;font-weight:800;color:#1c1917">${escapeHtml(title)}</div>
${note ? `<div style="font-size:12px;color:#78716c;margin-top:2px">${escapeHtml(note)}</div>` : ""}
${body}</td></tr>`;
}

function statCard(label: string, value: string, note: string, color: string) {
  return `<td width="25%" valign="top" style="padding:5px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#ffffff;border:1px solid #eeeae6;border-top:3px solid ${color};border-radius:10px">
<tr><td style="padding:12px 12px">
<div style="font-size:10px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:#78716c">${escapeHtml(label)}</div>
<div style="font-size:22px;font-weight:800;color:#1c1917;margin-top:4px">${escapeHtml(value)}</div>
<div style="font-size:11px;color:#78716c;margin-top:2px">${escapeHtml(note)}</div>
</td></tr></table></td>`;
}

const fileSize = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** "1 day 20 hours", so a deadline is not rounded down to a whole day. */
function timeLeft(days: number) {
  if (days < 0) return "Deadline passed";
  const totalHours = Math.max(0, Math.round(days * 24));
  const wholeDays = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  const parts: string[] = [];
  if (wholeDays > 0) parts.push(`${wholeDays} day${wholeDays === 1 ? "" : "s"}`);
  if (hours > 0 || wholeDays === 0) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  return parts.join(" ");
}

/** One block per open tender, matching the report card: stages, then the tender facts. */
function pendingCard(tender: Report["pending"][number], tenderUrl: string, fileUrl: string) {
  const days = tender.daysLeft == null ? "No deadline" : `${timeLeft(tender.daysLeft)} left`;
  const daysColor = tender.daysLeft != null && tender.daysLeft <= 3 ? "#dc2626" : tender.daysLeft != null && tender.daysLeft <= 7 ? "#d97706" : "#16a34a";
  const fact = (label: string, value: string) =>
    `<tr><td style="${cell};color:#78716c;width:34%">${escapeHtml(label)}</td><td style="${cell}" colspan="3">${value}</td></tr>`;
  const stageRows = tender.steps
    .map((step) => {
      const done = step.state === "done";
      const status = done
        ? `<span style="color:#047857;font-weight:700">Completed</span>`
        : `<span style="color:${step.state === "current" ? "#c2410c" : "#a8a29e"};font-weight:700">Awaiting</span>`;
      return `<tr><td style="${cell}">${escapeHtml(step.label)}</td><td style="${cell}">${status}</td><td style="${cell}">${escapeHtml(step.who || "—")}</td><td style="${cell}">${escapeHtml(step.whenText || "—")}</td></tr>`;
    })
    .join("");
  const file = tender.file
    ? `<a href="${escapeHtml(fileUrl)}" style="color:#c2410c;font-weight:700;text-decoration:none">${escapeHtml(tender.file.fileName)}</a> <span style="color:#78716c">(${escapeHtml(fileSize(tender.file.sizeBytes))})</span>`
    : `<span style="color:#78716c">No tender file uploaded yet</span>`;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin-top:14px;border:1px solid #eeeae6;border-left:4px solid ${tender.late ? "#dc2626" : "#ea580c"};background:#ffffff">
<tr><td colspan="4" style="padding:12px 14px;background:#fafaf9;border-bottom:1px solid #eeeae6">
<a href="${escapeHtml(tenderUrl)}" style="color:#c2410c;font-weight:800;font-size:14px;text-decoration:none">${escapeHtml(tender.recordId)}</a>
<span style="font-size:15px;font-weight:700;color:#1c1917"> · ${escapeHtml(tender.project)}</span>
${tender.reference ? `<div style="font-size:12px;color:#78716c;margin-top:2px">Ref: ${escapeHtml(tender.reference)}</div>` : ""}
<div style="font-size:12px;font-weight:700;color:#9a3412;margin-top:2px">Now: ${escapeHtml(tender.stage)}${tender.late ? " · Overdue task" : ""}</div>
</td></tr>
<tr><th style="${head}">Stage</th><th style="${head}">Status</th><th style="${head}">Who</th><th style="${head}">Time</th></tr>
${stageRows}
${fact("Client", escapeHtml(tender.client || "—"))}
${fact("Location", escapeHtml(tender.location || "—"))}
${fact("Tender start (received)", escapeHtml(when(tender.received)))}
${fact("Tender end (bid deadline)", `${escapeHtml(when(tender.deadline))} <span style="color:${daysColor};font-weight:700">· ${escapeHtml(days)}</span>`)}
${fact("Bid opening", escapeHtml(when(tender.opening)))}
${fact("Portal", escapeHtml(tender.portal || "—"))}
${fact("Estimated value", escapeHtml(tender.estimated ? `${inr(tender.estimated)} (${inrFull(tender.estimated)})` : "—"))}
${fact("EMD", escapeHtml(tender.emd ? `${inr(tender.emd)} · ${tender.emdType}` : tender.emdType || "—"))}
${fact("Final costing", escapeHtml(tender.finalCosting ? inr(tender.finalCosting) : "Not yet"))}
${fact("Now with", escapeHtml(tender.withWhom || "—"))}
${fact("Tender file", file)}
</table>`;
}

export async function buildTodayReportEmail(report: Report) {
  const link = (id: string, text: string) => `<a href="${escapeHtml(appUrl(id))}" style="color:#c2410c;font-weight:700;text-decoration:none">${escapeHtml(text)}</a>`;
  const base = await emailLink("/");
  const tenderLinks = new Map<string, string>();
  for (const id of new Set([
    ...report.steps.map((row) => row.tenderId),
    ...report.newTenders.map((row) => row.id),
    ...report.closing.map((row) => row.id),
    ...report.overdue.map((row) => row.id),
    ...report.pending.map((row) => row.id),
  ])) {
    tenderLinks.set(id, await emailLink(`/tenders/${id}`));
  }
  const fileLinks = new Map<string, string>();
  for (const tender of report.pending) if (tender.file) fileLinks.set(tender.id, await emailLink(`/tenders/${tender.id}?tab=documents`));
  function appUrl(id: string) {
    return tenderLinks.get(id) ?? base;
  }
  const { stats } = report;
  const day = dayLabel(report.now);
  const subject = `Coal & Ash — Today's tender report · ${day}`;
  const cards = [
    [
      statCard("Total tenders", String(stats.total), `${stats.active} active`, "#2563eb"),
      statCard("New today", String(stats.newToday), "Tenders received", "#7c3aed"),
      statCard("Steps today", String(stats.stepsToday), "Workflow moves", "#0d9488"),
      statCard("Bids today", String(stats.bidsToday), `${stats.wonToday} won · ${stats.lostToday} lost`, "#ea580c"),
    ],
    [
      statCard("Overdue tasks", String(stats.overdue), stats.overdue ? "Past their SLA" : "All on time", stats.overdue ? "#dc2626" : "#16a34a"),
      statCard("Closing in 7 days", String(stats.closing), "Bid deadlines", "#d97706"),
      statCard("Active pipeline", inr(stats.pipelineValue), inrFull(stats.pipelineValue), "#c2410c"),
      statCard("EMD exposure", inr(stats.emdExposure), "Guarantees and bonds", "#57534e"),
    ],
  ];

  const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f5f4f2;font-family:Arial,Helvetica,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="760" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:760px;background:#ffffff;border-radius:12px;border:1px solid #e7e5e4">
<tr><td style="padding:18px 28px 14px;text-align:center"><img src="${REFEXONE_EMAIL_LOGO_URL}" alt="RefexOne" width="160" style="max-width:160px;width:160px;height:auto;border:0" /></td></tr>
<tr><td bgcolor="#7c2d12" style="padding:22px 28px;background:#7c2d12;background-image:linear-gradient(135deg,#292524,#c2410c)">
<div style="color:#fdba74;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase">Coal &amp; Ash tenders · Today's report</div>
<div style="color:#ffffff;font-size:22px;font-weight:800;margin-top:6px">${escapeHtml(day)}</div>
<div style="color:#fde7d4;font-size:13px;margin-top:6px">Full detail from 12:00 am to ${escapeHtml(timeLabel(report.now))} (India time). Every tender is in the attached sheet.</div>
</td></tr>
<tr><td style="padding:18px 23px 0">
${cards.map((row) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${row.join("")}</tr></table>`).join("")}
</td></tr>
${report.steps.length
  ? section(
      "Today's activity",
      `${report.steps.length} workflow step${report.steps.length === 1 ? "" : "s"} moved today`,
      table(
        ["Time", "Tender", "Step", "By"],
        report.steps.map((row) => [
          escapeHtml(timeLabel(row.at)),
          `${link(row.tenderId, row.recordId)}<div style="font-size:12px;color:#78716c">${escapeHtml(row.project)}</div>`,
          `${escapeHtml(row.action)}${row.detail ? `<div style="font-size:12px;color:#78716c">${escapeHtml(row.detail.slice(0, 160))}</div>` : ""}`,
          escapeHtml(row.by),
        ]),
        "",
      ),
    )
  : ""}
${report.newTenders.length
  ? section(
      "New tenders today",
      "",
      table(
        ["Tender", "Client", "Value", "Bid deadline", "Status"],
        report.newTenders.map((row) => [
          `${link(row.id, row.recordId)}<div style="font-size:12px;color:#78716c">${escapeHtml(row.project)}</div>`,
          escapeHtml(row.client || "—"),
          escapeHtml(inr(row.value)),
          escapeHtml(when(row.deadline)),
          escapeHtml(row.status),
        ]),
        "",
      ),
    )
  : ""}
${report.closing.length
  ? section(
      "Bids closing in the next 7 days",
      "Soonest first",
      table(
        ["Tender", "Deadline", "Time left", "Status", "Now with"],
        report.closing.map((row) => [
          `${link(row.id, row.recordId)}<div style="font-size:12px;color:#78716c">${escapeHtml(row.project)} · ${escapeHtml(row.client)}</div>`,
          escapeHtml(when(row.deadline)),
          `<b style="color:${row.daysLeft <= 3 ? "#dc2626" : "#d97706"}">${escapeHtml(timeLeft(row.daysLeft))}</b>`,
          escapeHtml(row.status),
          escapeHtml(row.withWhom || "—"),
        ]),
        "",
      ),
    )
  : ""}
${report.overdue.length
  ? section(
      "Overdue tasks",
      "Past their working-time SLA, oldest first",
      table(
        ["Tender", "Task", "With", "Was due", "Late by"],
        report.overdue.map((row) => [
          `${link(row.id, row.recordId)}<div style="font-size:12px;color:#78716c">${escapeHtml(row.project)}</div>`,
          escapeHtml(row.task),
          escapeHtml(row.withWhom || "—"),
          escapeHtml(when(row.due)),
          `<b style="color:#dc2626">${row.lateDays < 1 ? `${Math.max(1, Math.round(row.lateDays * 24))} hours` : `${Math.floor(row.lateDays)} days`}</b>`,
        ]),
        "",
      ),
    )
  : ""}
${report.pending.length
  ? section(
      "Pending Tender",
      `${report.pending.length} open tender${report.pending.length === 1 ? "" : "s"}, soonest bid deadline first.`,
      report.pending.map((tender) => pendingCard(tender, appUrl(tender.id), fileLinks.get(tender.id) ?? appUrl(tender.id))).join(""),
    )
  : ""}
<tr><td style="padding:24px 28px 26px;text-align:center">
<a href="${escapeHtml(base)}" style="display:inline-block;padding:12px 24px;background:#c2410c;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:14px">Open Coal &amp; Ash →</a>
<p style="margin:14px 0 0;font-size:12px;color:#a8a29e">Generated ${escapeHtml(when(report.now))} by the Coal &amp; Ash tender workflow.</p>
</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    subject,
    `Total ${stats.total} (${stats.active} active) · new today ${stats.newToday} · steps today ${stats.stepsToday} · bids today ${stats.bidsToday} · overdue ${stats.overdue} · closing in 7 days ${stats.closing}`,
    `Active pipeline ${inr(stats.pipelineValue)} · EMD exposure ${inr(stats.emdExposure)}`,
    ...(report.steps.length ? ["", "Today's activity:", ...report.steps.map((row) => `- ${timeLabel(row.at)} ${row.recordId}: ${row.action} (by ${row.by})`)] : []),
    ...(report.newTenders.length ? ["", "New tenders today:", ...report.newTenders.map((row) => `- ${row.recordId} ${row.project}`)] : []),
    ...(report.closing.length ? ["", "Bids closing in the next 7 days:", ...report.closing.map((row) => `- ${row.recordId} ${row.project}: ${when(row.deadline)}`)] : []),
    ...(report.overdue.length ? ["", "Overdue tasks:", ...report.overdue.map((row) => `- ${row.recordId} ${row.task} with ${row.withWhom}, due ${when(row.due)}`)] : []),
    ...(report.pending.length
      ? [
          "",
          "Pending Tender:",
          ...report.pending.flatMap((tender) => [
            `- ${tender.recordId} ${tender.project} · deadline ${when(tender.deadline)}`,
            ...tender.steps.map(
              (step) => `    ${step.label}: ${step.state === "done" ? "Completed" : "Awaiting"}${step.who ? ` · ${step.who}` : ""}${step.whenText ? ` · ${step.whenText}` : ""}`,
            ),
          ]),
        ]
      : []),
    "",
    `Open Coal & Ash: ${base}`,
  ].join("\n");

  return { subject, html, text, csv: reportCsv(report) };
}

/** Every tender as CSV with a BOM, so Excel opens it with the right characters. */
function reportCsv(report: Report) {
  const quote = (value: unknown) => {
    const text = value == null ? "" : String(value);
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const header = ["Record", "Project", "Client", "Location", "Portal", "Status", "Current step", "Estimated value (INR)", "Final costing (INR)", "EMD (INR)", "EMD type", "Received (start)", "Bid deadline (end)", "Now with", "Tender file"];
  const lines = report.rows.map((row) =>
    [row.recordId, row.project, row.client, row.location, row.portal, row.status, row.stage, row.estimated ?? "", row.finalCosting ?? "", row.emd ?? "", row.emdType, when(row.received), when(row.deadline), row.withWhom, row.file]
      .map(quote)
      .join(","),
  );
  return `﻿${[header.join(","), ...lines].join("\r\n")}`;
}

/** Builds today's report and emails it, logged in the Email log as DAILY_REPORT. */
export async function sendTodayReport(to: string[]) {
  const report = await loadTodayReport();
  const built = await buildTodayReportEmail(report);
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE }).format(report.now);
  const statuses: string[] = [];
  for (const email of to) {
    statuses.push(
      await deliver({
        to: email,
        toName: email,
        subject: built.subject,
        text: built.text,
        link: "",
        rawHtml: built.html,
        attachments: [{ filename: `coal-ash-tenders-${stamp}.csv`, content: built.csv, contentType: "text/csv" }],
        log: { eventType: "DAILY_REPORT" },
      }),
    );
  }
  return { statuses, subject: built.subject, stats: report.stats };
}
