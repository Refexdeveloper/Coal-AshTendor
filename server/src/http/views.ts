import { Router } from "express";
import type { Calendar } from "../lib/calendar";
import { canEditFields, getCalendar, kickAutomation, readinessChecklist } from "../lib/domain";
import { OPEN_TASK } from "../lib/labels";
import { loadDashboard, loadReports } from "../lib/metrics";
import { db } from "../lib/db";
import { publicUser } from "./auth";

/** Calendar sets do not survive JSON; the client rebuilds them. */
export function calendarJson(calendar: Calendar) {
  return { ...calendar, workingDays: [...calendar.workingDays], holidays: [...calendar.holidays] };
}

const mineWhere = (userId: string) => ({ status: { in: OPEN_TASK }, assigneeIds: { contains: `"${userId}"` } });

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
  const [calendar, holidays, policies, settings, escalations, templates, users] = await Promise.all([
    db.calendarSettings.findUnique({ where: { id: "default" } }),
    db.holiday.findMany({ orderBy: { date: "asc" } }),
    db.slaPolicy.findMany({ orderBy: { stage: "asc" } }),
    db.appSettings.findUnique({ where: { id: "default" } }),
    db.escalationRecipient.findMany({ orderBy: { level: "asc" } }),
    db.emailTemplate.findMany({ orderBy: { event: "asc" } }),
    db.user.findMany({ orderBy: { name: "asc" } }),
  ]);
  res.json({ calendar, holidays, policies, settings, escalations, templates, users: users.map(publicUser) });
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
    db.user.findMany({ where: { active: true }, orderBy: { name: "asc" } }),
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
