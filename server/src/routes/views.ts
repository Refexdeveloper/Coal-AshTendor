import { Router } from "express";
import { ssoStatus } from "../services/refexone";
import { directoryConfigured, lastSync, syncSchedule } from "../services/refexone-directory";
import type { Calendar } from "../utils/calendar";
import { canEditFields, getCalendar, kickAutomation, readinessChecklist } from "../services/domain";
import { WORKABLE } from "../utils/labels";
import { loadReports } from "../services/metrics";
import { db } from "../db";
import { publicUser } from "../middleware/auth";
import { plannedOwners } from "../services/team";
import { BOND_MANAGERS, listBonds } from "../services/bonds";
import { listGuarantees } from "../services/guarantees";
import { listEmdBoard } from "../services/emd-board";
import { documentCounts, documentsFor } from "../services/bg-documents";
import { bondDocumentCounts, documentsForBond } from "../services/bond-documents";
import { isSpreadsheet } from "../services/files";

/** Calendar sets do not survive JSON; the client rebuilds them. */
export function calendarJson(calendar: Calendar) {
  return { ...calendar, workingDays: [...calendar.workingDays], holidays: [...calendar.holidays] };
}

const mineWhere = (userId: string) => ({ status: { in: WORKABLE }, assigneeIds: { contains: `"${userId}"` } });

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

views.get("/dashboard", async (_req, res) => {
  await kickAutomation();
  const [tenders, users, calendar] = await Promise.all([
    db.tender.findMany({
      include: {
        fields: { orderBy: { fieldNo: "asc" } },
        tasks: { where: { status: { in: WORKABLE } }, orderBy: { dueAt: "asc" } },
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
    db.tender.findMany({ include: { tasks: { where: { status: { in: WORKABLE } }, orderBy: { dueAt: "asc" } }, bid: true }, orderBy: { updatedAt: "desc" } }),
    db.user.findMany(),
    getCalendar(),
  ]);
  res.json({ tenders, users: users.map(publicUser), calendar: calendarJson(calendar) });
});

/** Person-wise daily usage: who used the app on the day, and each person's tender tasks. Same page for every login. */
views.get("/reports/users", async (req, res) => {
  const { userReport } = await import("../services/user-activity");
  res.json(await userReport(typeof req.query.day === "string" ? req.query.day : undefined));
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
/** WhatsApp notices: the latest 300, with the setup state. Administrator only. */
views.get("/whatsapp-logs", async (req, res) => {
  if (req.actor!.role !== "ADMIN") {
    res.status(403).json({ error: "The WhatsApp log is limited to the system administrator." });
    return;
  }
  const { whatsAppStatus } = await import("../services/whatsapp");
  const [rows, users] = await Promise.all([db.whatsAppLog.findMany({ orderBy: { createdAt: "desc" }, take: 300 }), db.user.findMany({ where: { active: true } })]);
  const withPhone = users.filter((user: { phone?: string }) => user.phone).length;
  res.json({ rows, status: whatsAppStatus(), people: { active: users.length, withPhone } });
});

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
    mail: { ready: mailReady(), from: config.from, testInbox: config.redirectTo, cc: config.cc, bcc: config.bcc },
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

/** The sheet attached to today's report, for the Download Excel button. */
views.get("/reports/today.csv", async (req, res) => {
  if (req.actor!.role !== "ADMIN") {
    res.status(403).json({ error: "Reports are limited to the system administrator." });
    return;
  }
  const { buildTodayReportEmail, loadTodayReport } = await import("../services/daily-report");
  const report = await loadTodayReport();
  const built = await buildTodayReportEmail(report);
  const stamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(report.now);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="coal-ash-tenders-${stamp}.csv"`);
  res.send(built.csv);
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

// GeM bid results (technical and financial evaluation) for a tender that carries a GeM bid number; null when it has none.
views.get("/tenders/:id/gem-result", async (req, res) => {
  const { gemResultFor } = await import("../services/gem-result");
  try {
    res.json(await gemResultFor(req.params.id, req.query.refresh === "1"));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

views.get("/gem-bids/:id/result", async (req, res) => {
  const { gemResultForNumber } = await import("../services/gem-result");
  const bid = await db.gemBid.findUnique({ where: { id: req.params.id } });
  if (!bid) {
    res.status(404).json({ error: "GeM bid not found" });
    return;
  }
  try {
    res.json(await gemResultForNumber(bid.bidNumber, req.query.refresh === "1"));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

views.get("/site-tenders/:id/details", async (req, res) => {
  const { siteTenderDetails } = await import("../services/site-watch");
  try {
    res.json(await siteTenderDetails(req.params.id, req.query.refresh === "1"));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? (error.name === "TimeoutError" ? "The portal did not answer in time." : error.message) : String(error) });
  }
});

// Tender documents behind the portal's security code: start (shows the code image), unlock (the person's code), file.
views.post("/site-tenders/:id/documents/start", async (req, res) => {
  const { startTenderDocuments } = await import("../services/site-watch");
  try {
    res.json(await startTenderDocuments(req.params.id));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? (error.name === "TimeoutError" ? "The portal did not answer in time." : error.message) : String(error) });
  }
});
views.post("/site-tenders/:id/documents/unlock", async (req, res) => {
  const { unlockTenderDocuments } = await import("../services/site-watch");
  try {
    res.json(await unlockTenderDocuments(req.params.id, String(req.body?.token ?? ""), String(req.body?.code ?? "").slice(0, 12)));
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});
views.get("/site-tenders/:id/documents/:token/:index", async (req, res) => {
  const { tenderDocument } = await import("../services/site-watch");
  try {
    const file = await tenderDocument(req.params.id, req.params.token, Number(req.params.index));
    const safe = file.name.replace(/[^\w.\- ()]+/g, "_");
    res.setHeader("Content-Type", file.type.split(";")[0] || "application/octet-stream");
    res.setHeader("Content-Disposition", `${req.query.download === "1" ? "attachment" : "inline"}; filename="${safe}"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(file.body);
  } catch (error) {
    const captcha = (error as { captcha?: string }).captcha;
    res.status(captcha ? 409 : 502).json({ error: error instanceof Error ? error.message : String(error), ...(captcha ? { captcha } : {}) });
  }
});

views.get("/portals", async (_req, res) => {
  const { clearStaleRuns, gemPortal, gemProgress, gemRunning } = await import("../services/gem");
  await clearStaleRuns().catch(() => undefined);
  const gem = await gemPortal();
  const sw = await import("../services/site-watch");
  const { SHEET_LINKS } = await import("../services/site-list");
  await sw.clearStaleSiteRuns().catch(() => undefined);
  const sitePortal = await sw.siteWatchPortal();
  const [watchSites, allSiteTenders, siteRuns] = await Promise.all([
    db.watchSite.findMany({ orderBy: { host: "asc" } }),
    db.siteTender.findMany({ orderBy: { firstSeenAt: "desc" } }),
    db.crawlerRun.findMany({ where: { portalId: sitePortal.id }, orderBy: { startedAt: "desc" }, take: 200 }),
  ]);
  // Totals and the keyword ranking cover every match ever found; the table itself gets the latest 500.
  const keywordRank = new Map<string, { keyword: string; total: number; open: number; added: number; sites: Set<string> }>();
  const statusCount: Record<string, number> = {};
  for (const item of allSiteTenders) {
    statusCount[item.status] = (statusCount[item.status] ?? 0) + 1;
    if (item.status === "EXCLUDED") continue;
    const entry = keywordRank.get(item.keyword) ?? { keyword: item.keyword, total: 0, open: 0, added: 0, sites: new Set<string>() };
    entry.total += 1;
    if (item.status === "NEW") entry.open += 1;
    if (item.status === "IMPORTED") entry.added += 1;
    entry.sites.add(item.siteId);
    keywordRank.set(item.keyword, entry);
  }
  // Tenders first found today (company time zone), for the "New tenders today" card.
  const { dayKeyOf } = await import("../services/user-activity");
  const zone = (await getCalendar()).timeZone;
  const todayKey = dayKeyOf(new Date(), zone);
  const siteStats = {
    total: allSiteTenders.length,
    byStatus: statusCount,
    newToday: allSiteTenders.filter((item: { firstSeenAt: Date }) => dayKeyOf(new Date(item.firstSeenAt), zone) === todayKey).length,
    today: todayKey,
    keywords: [...keywordRank.values()].sort((a, b) => b.total - a.total || a.keyword.localeCompare(b.keyword)).map(({ sites, ...rest }) => ({ ...rest, sites: sites.size })),
  };
  const siteTenders = allSiteTenders.slice(0, 500);
  const [portals, exceptions, calendar, gemRuns, gemBids] = await Promise.all([
    db.portal.findMany({ orderBy: { name: "asc" }, include: { runs: { orderBy: { startedAt: "desc" }, take: 1 } } }),
    db.crawlerException.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    getCalendar(),
    db.crawlerRun.findMany({ where: { portalId: gem.id }, orderBy: { startedAt: "desc" }, take: 10 }),
    db.gemBid.findMany({ orderBy: { firstSeenAt: "desc" }, take: 300 }),
  ]);
  const tenderIds = [...gemBids, ...siteTenders].map((bid: { tenderId: string }) => bid.tenderId).filter(Boolean);
  const tenders = tenderIds.length ? await db.tender.findMany({ where: { id: { in: tenderIds } }, select: { id: true, recordId: true, overallStatus: true } }) : [];
  res.json({
    portals: portals.filter((portal: { id: string }) => portal.id !== gem.id && portal.id !== sitePortal.id),
    exceptions,
    calendar: calendarJson(calendar),
    // The raw GeM record is only needed to download the document, so it stays on the server.
    gem: { portal: gem, runs: gemRuns, bids: gemBids.map(({ raw: _raw, ...bid }: Record<string, unknown>) => bid), tenders, running: gemRunning(), progress: gemProgress() },
    sites: { portal: sitePortal, sites: watchSites, tenders: siteTenders, runs: siteRuns, stats: siteStats, links: SHEET_LINKS, running: sw.siteWatchRunning(), progress: sw.siteWatchProgress() },
  });
});

views.get("/admin", async (req, res) => {
  if (req.actor!.role !== "ADMIN") {
    res.status(403).json({ error: "Administration is limited to the system administrator." });
    return;
  }
  const [calendar, holidays, policies, settings, escalations, templates, users, tenders, guarantees, bonds] = await Promise.all([
    db.calendarSettings.findUnique({ where: { id: "default" } }),
    db.holiday.findMany({ orderBy: { date: "asc" } }),
    db.slaPolicy.findMany({ orderBy: { stage: "asc" } }),
    db.appSettings.findUnique({ where: { id: "default" } }),
    db.escalationRecipient.findMany({ orderBy: { level: "asc" } }),
    db.emailTemplate.findMany({ orderBy: { event: "asc" } }),
    db.user.findMany({ orderBy: { name: "asc" } }),
    db.tender.findMany({ orderBy: { updatedAt: "desc" }, select: { id: true, recordId: true, projectName: true, clientName: true } }),
    db.bankGuarantee.findMany({ orderBy: [{ serialNo: "asc" }] }),
    db.suretyBond.findMany({ orderBy: [{ kind: "asc" }, { serialNo: "asc" }] }),
  ]);
  res.json({
    calendar,
    holidays,
    policies,
    settings,
    escalations,
    templates,
    // Mobiles are shown to the administrator only, for WhatsApp notices.
    users: users.map((user: { phone?: string } & Parameters<typeof publicUser>[0]) => ({ ...publicUser(user), phone: user.phone ?? "" })),
    tenderCount: tenders.length,
    tenders,
    guarantees: guarantees.map((row: { id: string; bgNumber: string; beneficiary: string; bgType: string; bank: string }) => ({
      id: row.id,
      bgNumber: row.bgNumber,
      beneficiary: row.beneficiary,
      bgType: row.bgType,
      bank: row.bank,
    })),
    bonds: bonds.map((row: { id: string; bondNumber: string; customer: string; kind: string; insurer: string }) => ({
      id: row.id,
      bondNumber: row.bondNumber,
      customer: row.customer,
      kind: row.kind,
      insurer: row.insurer,
    })),
    refexone: { configured: directoryConfigured(), lastSync: await lastSync(), schedule: await syncSchedule() },
    sso: ssoStatus(req),
  });
});

/** EMD submissions while tenders are open: instrument, result, refund and security-deposit conversion. */
views.get("/emd-board", async (req, res) => {
  const board = await listEmdBoard();
  const canEdit = [...BOND_MANAGERS, "GROUP_CEO", "REVIEWER"].includes(req.actor!.role);
  const rows = req.actor!.role === "GROUP_CEO" ? board.rows : board.rows.map((row) => ({ ...row, documents: row.documents.filter((doc) => !isSpreadsheet(doc.fileName)) }));
  res.json({ ...board, rows, canEdit });
});

/** The EMD / performance bond register for the dashboard. */
views.get("/bonds", async (req, res) => {
  const [bonds, docCounts] = await Promise.all([listBonds(), bondDocumentCounts()]);
  res.json({ bonds, docCounts, canImport: BOND_MANAGERS.includes(req.actor!.role), importedAt: bonds.reduce((latest: Date | null, bond: { importedAt: Date }) => (!latest || bond.importedAt > latest ? bond.importedAt : latest), null) });
});

/** One surety bond (EMD or PBG ISB), for its detail page. */
views.get("/bonds/:id", async (req, res) => {
  const bond = await db.suretyBond.findUnique({ where: { id: req.params.id } });
  if (!bond) {
    res.status(404).json({ error: "Bond not found" });
    return;
  }
  res.json({ bond, documents: await documentsForBond(bond.bondNumber), canUpload: BOND_MANAGERS.includes(req.actor!.role) });
});

/** The bank guarantee register for the BG dashboard. */
views.get("/guarantees", async (req, res) => {
  const [guarantees, docCounts] = await Promise.all([listGuarantees(), documentCounts()]);
  res.json({ guarantees, docCounts, canImport: BOND_MANAGERS.includes(req.actor!.role), canAdd: BOND_MANAGERS.includes(req.actor!.role) || req.actor!.role === "GROUP_CEO", importedAt: guarantees.reduce((latest: Date | null, row: { importedAt: Date }) => (!latest || row.importedAt > latest ? row.importedAt : latest), null) });
});

/** One bank guarantee, for its detail page. */
views.get("/guarantees/:id", async (req, res) => {
  const guarantee = await db.bankGuarantee.findUnique({ where: { id: req.params.id } });
  if (!guarantee) {
    res.status(404).json({ error: "Bank guarantee not found" });
    return;
  }
  const canEdit = BOND_MANAGERS.includes(req.actor!.role) || req.actor!.role === "GROUP_CEO";
  res.json({ guarantee, documents: await documentsFor(guarantee.bgNumber), canUpload: canEdit, canEdit });
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
  const ceo = actor.role === "GROUP_CEO";
  if (!ceo) {
    const hidden = new Set(tender.documents.filter((doc) => isSpreadsheet(doc.fileName, doc.mimeType)).map((doc) => doc.id));
    tender.documents = tender.documents.filter((doc) => !hidden.has(doc.id));
    tender.costings = tender.costings.map((row) => (hidden.has(row.documentId) ? { ...row, documentId: "" } : row));
    if (tender.emd && hidden.has(tender.emd.documentId)) tender.emd = { ...tender.emd, documentId: "" };
    if (tender.bid && hidden.has(tender.bid.evidenceDocumentId)) tender.bid = { ...tender.bid, evidenceDocumentId: "" };
  }
  const [users, calendar, settings, fieldEditor, plan] = await Promise.all([
    peopleFor(tender),
    getCalendar(),
    db.appSettings.findUnique({ where: { id: "default" } }),
    canEditFields(actor, tender.id),
    plannedOwners(tender),
  ]);
  res.json({
    tender,
    users: users.map(publicUser),
    calendar: calendarJson(calendar),
    bgRequiresBoth: Boolean(settings?.bgRequiresBoth),
    fieldEditor,
    checklist: readinessChecklist(tender),
    plan,
  });
});
