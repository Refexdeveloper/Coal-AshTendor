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

/*
 * Layout after P2P's procurement report: white header with the logo, the green shimmer divider, grey section
 * captions, gradient stat cards two to a row and green-headed blocks. Everything is one column of full-width
 * blocks (no wide tables), so it fits a phone screen without sideways scrolling or zooming, with or without
 * media query support in the mail app.
 */
const DIVIDER_URL = "https://storage.googleapis.com/aasik-refex-report-assets/refex-shimmer-divider-green.gif";
const GREEN = "#14503a";
const GOLD = "#9a7a3a";
const BLUE = "#3468a8";
const RED = "#b42318";
const INK = "#1a1a1a";
const MUTED = "#6b6b6b";
const LINE = "#ececea";

type Look = { value: string; label: string; background: string; border: string };
const LOOKS: Record<"blue" | "gold" | "green" | "red" | "grey", Look> = {
  blue: { value: INK, label: "#5b7ba3", background: "linear-gradient(180deg,#ffffff 0%,#f2f6fb 100%)", border: "#dfe8f2" },
  gold: { value: GOLD, label: GOLD, background: "linear-gradient(180deg,#fffaf2 0%,#fef3e2 100%)", border: "#f2e2c4" },
  green: { value: GREEN, label: "#3f8f63", background: "linear-gradient(180deg,#f4fbf5 0%,#e0f5e8 100%)", border: "#c7ead4" },
  red: { value: RED, label: RED, background: "linear-gradient(180deg,#fff7f6 0%,#fde4e1 100%)", border: "#f5c6c0" },
  grey: { value: INK, label: MUTED, background: "linear-gradient(180deg,#ffffff 0%,#f4f4f2 100%)", border: "#e5e5e0" },
};

function caption(title: string, note = "") {
  return `<tr><td style="padding:22px 18px 4px" bgcolor="#ffffff">
<div style="font-size:12px;font-weight:bold;color:#8a8a8a;text-transform:uppercase;letter-spacing:0.5px">${escapeHtml(title)}</div>
${note ? `<div style="font-size:12px;color:#a0a0a0;margin-top:3px">${escapeHtml(note)}</div>` : ""}
</td></tr>`;
}

function statCard(value: string, label: string, sub: string, tone: keyof typeof LOOKS) {
  const look = LOOKS[tone];
  return `<td width="48%" align="center" valign="top" style="background:${look.background};border:1px solid ${look.border};border-radius:10px;padding:16px 6px">
<div style="font-size:22px;font-weight:bold;color:${look.value};line-height:1.2">${escapeHtml(value)}</div>
<div style="font-size:11px;color:${look.label};margin-top:5px;font-weight:bold;text-transform:uppercase;letter-spacing:0.4px">${escapeHtml(label)}</div>
<div style="font-size:11px;color:${look.label};margin-top:3px;line-height:1.3">${escapeHtml(sub) || "&nbsp;"}</div>
</td>`;
}

function statPair(left: string, right: string) {
  return `<tr><td style="padding:6px 18px" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${left}<td width="4%"></td>${right}</tr></table>
</td></tr>`;
}

/** A list block with P2P's green header bar: each row is a left column (what) and a right column (when / how much). */
function listBlock(header: [string, string], rows: [string, string][]) {
  return `<tr><td style="padding:8px 18px" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;border:1px solid ${LINE}">
<tr bgcolor="${GREEN}"><td style="padding:10px 12px;color:#ffffff;font-size:12px;font-weight:bold;background:${GREEN}">${escapeHtml(header[0])}</td><td align="right" style="padding:10px 12px;color:#ffffff;font-size:12px;font-weight:bold;background:${GREEN}">${escapeHtml(header[1])}</td></tr>
${rows
  .map(([left, right], index) => {
    const bg = index % 2 === 0 ? "#ffffff" : "#f7f8f6";
    return `<tr bgcolor="${bg}"><td valign="top" style="padding:10px 12px;border-top:1px solid ${LINE};font-size:13px;color:${INK};line-height:1.45;background:${bg}">${left}</td><td valign="top" align="right" width="38%" style="padding:10px 12px;border-top:1px solid ${LINE};font-size:12px;color:${INK};line-height:1.45;background:${bg}">${right}</td></tr>`;
  })
  .join("")}
</table></td></tr>`;
}

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

const urgency = (days: number | null) => (days == null ? MUTED : days <= 3 ? RED : days <= 7 ? GOLD : GREEN);

/** The steps as chips with arrows between them. Inline blocks wrap onto the next line on a narrow screen. */
function stageTrack(steps: Report["pending"][number]["steps"]) {
  const looks = {
    done: { bg: "#e0f5e8", border: "#c7ead4", color: GREEN, mark: "&#10003;" },
    current: { bg: "#fdecd0", border: "#f0d9a8", color: GOLD, mark: "&#9679;" },
    todo: { bg: "#f4f4f2", border: "#e5e5e0", color: "#8a8a8a", mark: "&#9675;" },
  };
  return steps
    .map((step, index) => {
      const look = looks[step.state];
      const arrow = index < steps.length - 1 ? `<span style="color:#b0b0b0;font-size:13px;padding:0 3px">&#10140;</span>` : "";
      return `<span style="display:inline-block;white-space:nowrap;margin:0 0 6px"><span style="display:inline-block;padding:4px 9px;border-radius:999px;background:${look.bg};border:1px solid ${look.border};color:${look.color};font-size:11px;font-weight:bold">${look.mark} ${escapeHtml(step.label)}</span>${arrow}</span>`;
    })
    .join(" ");
}

function detailRow(label: string, value: string) {
  return `<tr><td valign="top" width="38%" style="padding:5px 8px 5px 0;font-size:12px;color:#8a8a8a;border-top:1px solid #f1f1ef">${escapeHtml(label)}</td><td valign="top" style="padding:5px 0;font-size:13px;color:${INK};font-weight:bold;border-top:1px solid #f1f1ef;word-break:break-word">${value}</td></tr>`;
}

/** One card per open tender: where it stands, who has it, its dates and money, and the tender file. */
function pendingCard(tender: Report["pending"][number], openUrl: string, filesUrl: string) {
  const current = tender.steps.filter((step) => step.state === "current");
  const done = tender.steps.filter((step) => step.state === "done");
  const days = tender.daysLeft == null ? "" : tender.daysLeft < 0 ? "Deadline passed" : `${timeLeft(tender.daysLeft)} left`;
  const nowLine = current.length
    ? current.map((step) => `<div style="margin-top:4px"><b style="color:${GOLD}">&#9679; ${escapeHtml(step.label)}</b>${step.who ? ` — with ${escapeHtml(step.who)}` : ""}</div>`).join("")
    : `<div style="margin-top:4px"><b style="color:${GOLD}">&#9679; ${escapeHtml(tender.stage)}</b></div>`;
  const doneLines = done
    .map((step) => `<div style="margin-top:3px;color:${MUTED}"><span style="color:${GREEN}">&#10003;</span> ${escapeHtml(step.label)}${step.who ? ` · ${escapeHtml(step.who)}` : ""}${step.whenText ? ` · ${escapeHtml(step.whenText)}` : ""}</div>`)
    .join("");
  const file = tender.file
    ? `<a href="${escapeHtml(filesUrl)}" style="color:${BLUE};font-weight:bold;text-decoration:none;word-break:break-all">&#128196; ${escapeHtml(tender.file.fileName)}</a> <span style="color:#8a8a8a;font-weight:normal">(${tender.file.sizeBytes >= 1048576 ? `${(tender.file.sizeBytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(tender.file.sizeBytes / 1024))} KB`})</span>`
    : `<span style="color:#8a8a8a;font-weight:normal">No tender file uploaded yet</span>`;
  return `<tr><td style="padding:8px 18px" bgcolor="#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:separate;border:1px solid ${tender.late ? "#f5c6c0" : "#e5e5e0"};border-radius:10px;overflow:hidden">
<tr bgcolor="${GREEN}"><td style="padding:12px 14px;background:${GREEN}">
<a href="${escapeHtml(openUrl)}" style="color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">${escapeHtml(tender.recordId)}</a>${tender.late ? ` <span style="display:inline-block;margin-left:4px;padding:2px 8px;border-radius:999px;background:#fde4e1;color:${RED};font-size:10px;font-weight:bold">OVERDUE TASK</span>` : ""}
<div style="color:#d6eadf;font-size:13px;margin-top:3px;line-height:1.4">${escapeHtml(tender.project)}</div>
</td></tr>
<tr><td style="padding:12px 14px 4px;background:#ffffff">
<div style="font-size:11px;font-weight:bold;color:#8a8a8a;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:6px">Stage</div>
${stageTrack(tender.steps)}
<div style="font-size:12px;color:${INK};line-height:1.45;margin-top:2px">${nowLine}${doneLines}</div>
</td></tr>
<tr><td style="padding:8px 14px 12px;background:#ffffff">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
${tender.reference ? detailRow("Reference", escapeHtml(tender.reference)) : ""}
${detailRow("Client", escapeHtml(tender.client || "—"))}
${detailRow("Location", escapeHtml(tender.location || "—"))}
${detailRow("Portal", escapeHtml(tender.portal || "—"))}
${detailRow("Tender start", escapeHtml(when(tender.received)))}
${detailRow("Tender end", `${escapeHtml(when(tender.deadline))}${days ? `<div style="color:${urgency(tender.daysLeft)};font-size:12px">${escapeHtml(days)}</div>` : ""}`)}
${detailRow("Bid opening", escapeHtml(when(tender.opening)))}
${detailRow("Estimated value", tender.estimated ? `${escapeHtml(inr(tender.estimated))}<div style="color:#8a8a8a;font-size:11px;font-weight:normal">${escapeHtml(inrFull(tender.estimated))}</div>` : "—")}
${detailRow("EMD", escapeHtml(tender.emd ? `${inr(tender.emd)} · ${tender.emdType}` : tender.emdType || "—"))}
${tender.finalCosting ? detailRow("Final costing", escapeHtml(inr(tender.finalCosting))) : ""}
${detailRow("Now with", escapeHtml(tender.withWhom || "—"))}
${detailRow("Tender file", file)}
</table>
</td></tr>
</table></td></tr>`;
}

export async function buildTodayReportEmail(report: Report) {
  const base = await emailLink("/");
  const tenderLinks = new Map<string, string>();
  const fileLinks = new Map<string, string>();
  for (const id of new Set([...report.newTenders.map((row) => row.id), ...report.closing.map((row) => row.id), ...report.overdue.map((row) => row.id), ...report.pending.map((row) => row.id)])) {
    tenderLinks.set(id, await emailLink(`/tenders/${id}`));
  }
  for (const tender of report.pending) {
    if (tender.file) fileLinks.set(tender.id, await emailLink(`/tenders/${tender.id}?tab=documents`));
  }
  const appUrl = (id: string) => tenderLinks.get(id) ?? base;
  const link = (id: string, text: string) => `<a href="${escapeHtml(appUrl(id))}" style="color:${GREEN};font-weight:bold;text-decoration:none">${escapeHtml(text)}</a>`;
  const sub = (text: string) => `<div style="font-size:12px;color:${MUTED};margin-top:2px">${escapeHtml(text)}</div>`;
  const { stats } = report;
  const day = dayLabel(report.now);
  const subject = `Coal & Ash — Today's tender report · ${day}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:#eef0f2;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%" bgcolor="#eef0f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef0f2" bgcolor="#eef0f2">
<tr><td align="center" style="padding:16px 8px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:640px;background-color:#ffffff;border-radius:10px;overflow:hidden" bgcolor="#ffffff">

<tr><td style="padding:22px 18px 16px" bgcolor="#ffffff">
<img src="${REFEXONE_EMAIL_LOGO_URL}" alt="refexOne" width="150" style="display:block;width:150px;max-width:150px;height:auto;border:0">
<div style="font-size:18px;font-weight:bold;color:${INK};margin-top:14px">Coal &amp; Ash Tender Report</div>
<div style="font-size:12px;color:${MUTED};margin-top:4px;line-height:1.5">Tenders &middot; Pending stages &middot; Bids closing</div>
<div style="font-size:12px;color:${MUTED};margin-top:2px">${escapeHtml(day)}</div>
</td></tr>

<tr><td style="padding:0;line-height:0"><img src="${DIVIDER_URL}" alt="" width="640" height="6" style="display:block;width:100%;height:6px;border:0"></td></tr>

${caption("Tenders")}
${statPair(statCard(String(stats.total), "Total tenders", `${stats.active} active`, "blue"), statCard(String(stats.newToday), "New today", "Tenders received", "gold"))}
${caption("Bids")}
${statPair(statCard(String(stats.bidsToday), "Bids today", `${stats.wonToday} won · ${stats.lostToday} lost`, "green"), statCard(String(stats.closing), "Closing in 7 days", "Bid deadlines", "gold"))}
${caption("Work and money")}
${statPair(statCard(String(stats.overdue), "Overdue tasks", stats.overdue ? "Past their SLA" : "All on time", stats.overdue ? "red" : "green"), statCard(inr(stats.pipelineValue), "Active pipeline", inrFull(stats.pipelineValue), "blue"))}
${statPair(statCard(inr(stats.emdExposure), "EMD exposure", "Guarantees and bonds", "grey"), statCard(String(stats.active), "Active tenders", "Still in the workflow", "green"))}

${report.pending.length
  ? `${caption("Pending tender", `${report.pending.length} open tender${report.pending.length === 1 ? "" : "s"}, soonest bid deadline first`)}
${report.pending.map((tender) => pendingCard(tender, appUrl(tender.id), fileLinks.get(tender.id) ?? appUrl(tender.id))).join("")}`
  : ""}

${report.newTenders.length
  ? `${caption("New tenders today")}
${listBlock(
  ["Tender", "Value · deadline"],
  report.newTenders.map((row) => [
    `${link(row.id, row.recordId)}${sub(row.project)}${row.client ? sub(row.client) : ""}`,
    `<b>${escapeHtml(inr(row.value))}</b>${sub(when(row.deadline))}${sub(row.status)}`,
  ]),
)}`
  : ""}

${report.closing.length
  ? `${caption("Bids closing in the next 7 days", "Soonest first")}
${listBlock(
  ["Tender", "Time left"],
  report.closing.map((row) => [
    `${link(row.id, row.recordId)}${sub(row.project)}${sub(`${row.status}${row.withWhom ? ` · with ${row.withWhom}` : ""}`)}`,
    `<b style="color:${urgency(row.daysLeft)}">${escapeHtml(timeLeft(row.daysLeft))}</b>${sub(when(row.deadline))}`,
  ]),
)}`
  : ""}

${report.overdue.length
  ? `${caption("Overdue tasks", "Past their working-time SLA, oldest first")}
${listBlock(
  ["Task", "Late by"],
  report.overdue.map((row) => [
    `${link(row.id, row.recordId)}${sub(row.task)}${sub(`With ${row.withWhom || "—"}`)}`,
    `<b style="color:${RED}">${row.lateDays < 1 ? `${Math.max(1, Math.round(row.lateDays * 24))} hours` : `${Math.floor(row.lateDays)} days`}</b>${sub(`Due ${when(row.due)}`)}`,
  ]),
)}`
  : ""}

<tr><td align="center" style="padding:24px 18px 8px" bgcolor="#ffffff">
<a href="${escapeHtml(base)}" style="display:inline-block;padding:12px 26px;background:${GREEN};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:bold;font-size:14px">Open Coal &amp; Ash</a>
</td></tr>
<tr><td style="padding:8px 18px 20px;font-size:11px;color:#a0a0a0;line-height:1.6" bgcolor="#ffffff">
The attached sheet lists every tender. Times are India time. Generated ${escapeHtml(when(report.now))}.
</td></tr>
<tr><td style="background-color:#faf9f7;padding:16px 18px;border-top:1px solid ${LINE};font-size:11px;color:#a0a0a0" bgcolor="#faf9f7">
Coal &amp; Ash Tender Report &middot; Automated &middot; Do not reply to this email
</td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  const text = [
    subject,
    `Total ${stats.total} (${stats.active} active) · new today ${stats.newToday} · bids today ${stats.bidsToday} · overdue ${stats.overdue} · closing in 7 days ${stats.closing}`,
    `Active pipeline ${inr(stats.pipelineValue)} · EMD exposure ${inr(stats.emdExposure)}`,
    ...(report.newTenders.length ? ["", "New tenders today:", ...report.newTenders.map((row) => `- ${row.recordId} ${row.project}`)] : []),
    ...(report.closing.length ? ["", "Bids closing in the next 7 days:", ...report.closing.map((row) => `- ${row.recordId} ${row.project}: ${when(row.deadline)}`)] : []),
    ...(report.overdue.length ? ["", "Overdue tasks:", ...report.overdue.map((row) => `- ${row.recordId} ${row.task} with ${row.withWhom}, due ${when(row.due)}`)] : []),
    ...(report.pending.length
      ? [
          "",
          "Pending Tender:",
          ...report.pending.map((tender) => {
            const current = tender.steps.filter((step) => step.state === "current").map((step) => step.label);
            const stage = current.length ? current.join(", ") : tender.stage;
            return `- ${tender.recordId} ${tender.project} · ${stage} · deadline ${when(tender.deadline)}`;
          }),
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
