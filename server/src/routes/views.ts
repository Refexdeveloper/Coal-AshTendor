import { Router } from "express";
import { ssoStatus } from "../services/refexone";
import { directoryConfigured, lastSync, syncSchedule } from "../services/refexone-directory";
import type { Calendar } from "../utils/calendar";
import { canEditFields, getCalendar, kickAutomation, readinessChecklist } from "../services/domain";
import { OPEN_TASK } from "../utils/labels";
import { loadDashboard, loadReports } from "../services/metrics";
import { db } from "../db";
import { publicUser } from "../middleware/auth";

/** Calendar sets do not survive JSON; the client rebuilds them. */
export function calendarJson(calendar: Calendar) {
  return { ...calendar, workingDays: [...calendar.workingDays], holidays: [...calendar.holidays] };
}

const mineWhere = (userId: string) => ({ status: { in: OPEN_TASK }, assigneeIds: { contains: `"${userId}"` } });

function idList(raw: string) {
  try {
    const value = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Active people, plus anyone already named on this tender, so an approval still shows after a login is turned off. */
async function peopleFor(tender: { createdById: string; submitterId: string | null; tasks: { assigneeIds: string; completedById: string }[]; approvals: { approverId: string }[]; costings: { createdById: string }[] }) {
  const ids = [tender.createdById, tender.submitterId];
  for (const task of tender.tasks) ids.push(task.completedById, ...idList(task.assigneeIds));
  for (const approval of tender.approvals) ids.push(approval.approverId);
  for (const costing of tender.costings) ids.push(costing.createdById);
  const extra = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  const [active, named] = await Promise.all([
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
    extra.length ? db.user.findMany({ where: { id: { in: extra } } }) : Promise.resolve([]),
  ]);
  const merged = new Map(active.map((user) => [user.id, user]));
  for (const user of named) merged.set(user.id, user);
  return [...merged.values()];
}

/** Read-only data for each screen. Every route here runs behind requireActor. */
export const views = Router();

views.get("/me", async (req, res) => {
  const user = req.actor!;
  await kickAutomation();
  const openTasks = await db.workflowTask.count({ where: mineWhere(user.id) });
  res.json({ user: publicUser(user), openTasks });
});

views.get("/dashboard", async (req, res) => {
  const user = req.actor!;
  await kickAutomation();
  if (user.role === "GROUP_CEO") {
    const [tenders, users, calendar] = await Promise.all([
      db.tender.findMany({
        include: {
          fields: { orderBy: { fieldNo: "asc" } },
          tasks: { where: { status: { in: OPEN_TASK } }, orderBy: { dueAt: "asc" } },
          approvals: { orderBy: { createdAt: "desc" } },
          emd: true,
          bid: true,
        },
        orderBy: [{ bidSubmissionEnd: "asc" }],
      }),
      db.user.findMany(),
      getCalendar(),
    ]);
    res.json({ kind: "executive", tenders, users: users.map(publicUser), calendar: calendarJson(calendar) });
    return;
  }
  const data = await loadDashboard();
  const mine = await db.workflowTask.findMany({ where: mineWhere(user.id), include: { tender: true }, orderBy: { dueAt: "asc" } });
  const { cal, overdueTasks: _overdue, upcoming: _upcoming, recent: _recent, ...rest } = data;
  res.json({ kind: "pipeline", ...rest, calendar: calendarJson(cal), mine });
});

views.get("/worklist", async (req, res) => {
  await kickAutomation();
  const [tasks, calendar] = await Promise.all([
    db.workflowTask.findMany({ where: mineWhere(req.actor!.id), include: { tender: true }, orderBy: { dueAt: "asc" } }),
    getCalendar(),
  ]);
  res.json({ tasks, calendar: calendarJson(calendar) });
});

views.get("/register", async (_req, res) => {
  await kickAutomation();
  const [tenders, users, calendar] = await Promise.all([
    db.tender.findMany({ include: { tasks: { where: { status: { in: OPEN_TASK } }, orderBy: { dueAt: "asc" } }, bid: true }, orderBy: { updatedAt: "desc" } }),
    db.user.findMany(),
    getCalendar(),
  ]);
  res.json({ tenders, users: users.map(publicUser), calendar: calendarJson(calendar) });
});

views.get("/reports", async (_req, res) => {
  const { format: _format, ...report } = await loadReports();
  res.json(report);
});

views.get("/notifications", async (req, res) => {
  const actor = req.actor!;
  const calendar = await getCalendar();
  const where = actor.role === "ADMIN" ? {} : { recipientEmail: actor.email };
  const notes = await db.notificationLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, include: { tender: true } });
  res.json({ notes, calendar: calendarJson(calendar), smtpConfigured: Boolean(process.env.SMTP_HOST) });
});

/** Mail log for administrators, like P2P's email log: newest first, filtered by status, type and text. */
views.get("/email-logs", async (req, res) => {
  if (req.actor!.role !== "ADMIN") {
    res.status(403).json({ error: "The mail log is limited to the system administrator." });
    return;
  }
  const status = String(req.query.status || "");
  const type = String(req.query.type || "");
  const needle = String(req.query.q || "").trim().toLowerCase();
  const page = Math.max(1, Number(req.query.page) || 1);
  const size = 50;
  const rows = await db.notificationLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 3000,
    select: {
      id: true, tenderId: true, taskId: true, eventType: true, recipientEmail: true, recipientName: true, subject: true,
      status: true, deliveredTo: true, messageId: true, errorMessage: true, attachments: true, note: true, sentAt: true, createdAt: true,
    },
  });
  const tenderIds = [...new Set(rows.map((row) => row.tenderId).filter(Boolean))] as string[];
  const tenders = tenderIds.length ? await db.tender.findMany({ where: { id: { in: tenderIds } }, select: { id: true, recordId: true, projectName: true } }) : [];
  const byId = new Map(tenders.map((tender) => [tender.id, tender]));
  const counts: Record<string, number> = {};
  for (const row of rows) counts[row.status] = (counts[row.status] ?? 0) + 1;
  const matching = rows.filter((row) => {
    if (status && row.status !== status) return false;
    if (type && row.eventType !== type) return false;
    if (!needle) return true;
    const tender = row.tenderId ? byId.get(row.tenderId) : undefined;
    return [row.subject, row.recipientEmail, row.recipientName, row.deliveredTo, row.eventType, tender?.recordId, tender?.projectName].join(" ").toLowerCase().includes(needle);
  });
  const { mailConfig, mailReady } = await import("../services/notify");
  const config = mailConfig();
  res.json({
    items: matching.slice((page - 1) * size, page * size).map((row) => ({
      ...row,
      attachments: row.attachments ? JSON.parse(row.attachments) : [],
      tender: row.tenderId ? byId.get(row.tenderId) ?? null : null,
    })),
    total: matching.length,
    page,
    size,
    counts,
    types: [...new Set(rows.map((row) => row.eventType))].sort(),
    mail: { ready: mailReady(), from: config.from, testInbox: config.redirectTo },
  });
});

/** Today's report as it will be emailed, for the preview on the Administration page. */
views.get("/reports/today", async (req, res) => {
  if (req.actor!.role !== "ADMIN") {
    res.status(403).json({ error: "Reports by email are limited to the system administrator." });
    return;
  }
  const { REPORT_TO, buildTodayReportEmail, loadTodayReport } = await import("../services/daily-report");
  const report = await loadTodayReport();
  const built = await buildTodayReportEmail(report);
  res.json({ subject: built.subject, html: built.html, stats: report.stats, defaultTo: REPORT_TO });
});

/** One logged email with its exact HTML, for the preview. */
views.get("/email-logs/:id", async (req, res) => {
  if (req.actor!.role !== "ADMIN") {
    res.status(403).json({ error: "The mail log is limited to the system administrator." });
    return;
  }
  const row = await db.notificationLog.findUnique({ where: { id: req.params.id } });
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json({ ...row, attachments: row.attachments ? JSON.parse(row.attachments) : [] });
});

views.get("/portals", async (_req, res) => {
  const [portals, exceptions, calendar] = await Promise.all([
    db.portal.findMany({ orderBy: { name: "asc" }, include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } } }),
    db.crawlerException.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    getCalendar(),
  ]);
  res.json({ portals, exceptions, calendar: calendarJson(calendar) });
});

views.get("/admin", async (req, res) => {
  if (req.actor!.role !== "ADMIN") {
    res.status(403).json({ error: "Administration is limited to the system administrator." });
    return;
  }
  const [calendar, holidays, policies, settings, escalations, templates, users, tenders] = await Promise.all([
    db.calendarSettings.findUnique({ where: { id: "default" } }),
    db.holiday.findMany({ orderBy: { date: "asc" } }),
    db.slaPolicy.findMany({ orderBy: { stage: "asc" } }),
    db.appSettings.findUnique({ where: { id: "default" } }),
    db.escalationRecipient.findMany({ orderBy: { level: "asc" } }),
    db.emailTemplate.findMany({ orderBy: { event: "asc" } }),
    db.user.findMany({ orderBy: { name: "asc" } }),
    db.tender.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, recordId: true, projectName: true, clientName: true } }),
  ]);
  res.json({
    calendar,
    holidays,
    policies,
    settings,
    escalations,
    templates,
    users: users.map(publicUser),
    tenderCount: tenders.length,
    tenders,
    refexone: { configured: directoryConfigured(), lastSync: await lastSync(), schedule: await syncSchedule() },
    sso: ssoStatus(req),
  });
});

views.get("/tenders/:id", async (req, res) => {
  const actor = req.actor!;
  await kickAutomation();
  const tender = await db.tender.findUnique({
    where: { id: req.params.id },
    include: {
      fields: { orderBy: { fieldNo: "asc" } },
      documents: { orderBy: { uploadedAt: "desc" }, omit: { textExtract: true, storedPath: true } },
      tasks: { orderBy: { createdAt: "asc" } },
      costings: { orderBy: { version: "desc" } },
      approvals: { orderBy: { createdAt: "desc" } },
      emd: true,
      bid: true,
      audits: { orderBy: { createdAt: "desc" }, take: 60 },
      notifications: { orderBy: { createdAt: "desc" }, take: 30 },
    },
  });
  if (!tender) {
    res.status(404).json({ error: "Tender not found" });
    return;
  }
  const [users, calendar, settings, fieldEditor] = await Promise.all([
    peopleFor(tender),
    getCalendar(),
    db.appSettings.findUnique({ where: { id: "default" } }),
    canEditFields(actor, tender.id),
  ]);
  res.json({
    tender,
    users: users.map(publicUser),
    calendar: calendarJson(calendar),
    bgRequiresBoth: Boolean(settings?.bgRequiresBoth),
    fieldEditor,
    checklist: readinessChecklist(tender),
  });
});
