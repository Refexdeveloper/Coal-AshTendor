import { businessMinutesBetween, dayLengthMinutes, formatDuration } from "../utils/calendar";
import { getCalendar, kickAutomation } from "./domain";
import { CLOSED_OVERALL } from "../utils/labels";
import { db } from "../db";

async function calendar() {
  return getCalendar();
}

export async function loadDashboard() {
  await kickAutomation();
  const cal = await calendar();
  const tenders = await db.tender.findMany();
  const overdueTasks = await db.workflowTask.findMany({
    where: { status: "OVERDUE" },
    include: { tender: true },
    orderBy: { dueAt: "asc" },
    take: 8,
  });
  const now = Date.now();
  const active = (status: string) => !["REJECTED_CLOSED", "CANCELLED", "CLOSED_BUSINESS"].includes(status);
  const upcoming = tenders
    .filter((tender) => {
      if (!tender.bidSubmissionEnd || CLOSED_OVERALL.includes(tender.overallStatus)) return false;
      if (["BID_SUBMITTED_EVIDENCE_RECORDED", "BID_SUBMITTED_EVIDENCE_PENDING"].includes(tender.bidStatus)) return false;
      const delta = tender.bidSubmissionEnd.getTime() - now;
      return delta > 0 && delta < 14 * 864e5;
    })
    .sort((a, b) => a.bidSubmissionEnd!.getTime() - b.bidSubmissionEnd!.getTime())
    .slice(0, 8);
  const sum = (pick: (typeof tenders)[number][]) => pick.reduce((total, tender) => total + (tender.estimatedValue ?? 0), 0);
  return {
    cal,
    total: tenders.length,
    pending: tenders.filter((tender) => tender.overallStatus === "PENDING_RELEVANCE").length,
    approved: tenders.filter((tender) => tender.relevanceStatus === "APPROVED").length,
    rejected: tenders.filter((tender) => tender.relevanceStatus === "REJECTED").length,
    inProgress: tenders.filter((tender) => tender.overallStatus === "APPROVED_IN_PROGRESS").length,
    ready: tenders.filter((tender) => tender.overallStatus === "READY_TO_BID").length,
    submitted: tenders.filter((tender) => tender.bidStatus === "BID_SUBMITTED_EVIDENCE_RECORDED").length,
    missed: tenders.filter((tender) => tender.deadlineMissed).length,
    estimated: sum(tenders.filter((tender) => active(tender.overallStatus))),
    finalCost: tenders.filter((tender) => tender.costingStatus === "APPROVED").reduce((total, tender) => total + (tender.finalCostingValue ?? 0), 0),
    emd: tenders
      .filter((tender) => active(tender.overallStatus) && tender.emdType !== "EXEMPTION")
      .reduce((total, tender) => total + (tender.emdExposure ?? 0), 0),
    won: tenders.filter((tender) => tender.outcome === "WON").length,
    lost: tenders.filter((tender) => tender.outcome === "LOST").length,
    cancelled: tenders.filter((tender) => tender.outcome === "CANCELLED").length,
    overdueCount: await db.workflowTask.count({ where: { status: "OVERDUE" } }),
    overdueTasks,
    upcoming,
    recent: tenders.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 6),
    all: tenders,
  };
}

export async function loadReports() {
  await kickAutomation();
  const cal = await calendar();
  const day = dayLengthMinutes(cal);
  const users = await db.user.findMany();
  const nameOf = new Map(users.map((user) => [user.id, user.name]));
  const tenders = await db.tender.findMany({ include: { approvals: true, tasks: true, emd: true } });
  const approvals = tenders.flatMap((tender) =>
    tender.approvals
      .filter((approval: { stage: string; decision: string; createdAt: Date }) => approval.stage === "RELEVANCE" && approval.decision === "APPROVED")
      .map((approval: { createdAt: Date }) => businessMinutesBetween(tender.createdAt, approval.createdAt, cal)),
  );
  const costing = tenders.flatMap((tender) => {
    const start = tender.approvals.find((approval: { stage: string; decision: string; createdAt: Date }) => approval.stage === "RELEVANCE" && approval.decision === "APPROVED");
    const end = tender.approvals.find((approval: { stage: string; decision: string; createdAt: Date }) => approval.stage === "DEPT_APPROVAL" && approval.decision === "APPROVED");
    return start && end ? [businessMinutesBetween(start.createdAt, end.createdAt, cal)] : [];
  });
  const emd = tenders.flatMap((tender) => {
    const start = tender.approvals.find((approval: { stage: string; decision: string; createdAt: Date }) => approval.stage === "RELEVANCE" && approval.decision === "APPROVED");
    return start && tender.emd?.completedAt ? [businessMinutesBetween(start.createdAt, tender.emd.completedAt, cal)] : [];
  });
  const judged = tenders.flatMap((tender) => tender.tasks).filter((task) => task.slaMinutes > 0 && (task.status === "COMPLETED" || task.status === "OVERDUE" || (task.status === "CANCELLED" && task.wasOverdue)));
  const onTime = (task: (typeof judged)[number]) => task.status === "COMPLETED" && task.completedAt && task.dueAt && task.completedAt <= task.dueAt;
  const byStage = new Map<string, { onTime: number; total: number }>();
  const byOwner = new Map<string, { onTime: number; total: number; open: number }>();
  for (const task of judged) {
    const stage = byStage.get(task.stage) ?? { onTime: 0, total: 0 };
    stage.total += 1;
    if (onTime(task)) stage.onTime += 1;
    byStage.set(task.stage, stage);
    for (const id of JSON.parse(task.assigneeIds) as string[]) {
      const row = byOwner.get(id) ?? { onTime: 0, total: 0, open: 0 };
      row.total += 1;
      if (onTime(task)) row.onTime += 1;
      byOwner.set(id, row);
    }
  }
  const open = await db.workflowTask.findMany({ where: { status: { in: ["NOT_STARTED", "IN_PROGRESS", "OVERDUE", "RETURNED_FOR_REVISION"] } } });
  for (const task of open) {
    for (const id of JSON.parse(task.assigneeIds) as string[]) {
      const row = byOwner.get(id) ?? { onTime: 0, total: 0, open: 0 };
      row.open += 1;
      byOwner.set(id, row);
    }
  }
  const average = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const internalMisses = tenders.filter((tender) => tender.deadlineMissed && tender.tasks.some((task: { wasOverdue: boolean }) => task.wasOverdue)).length;
  const decided = tenders.filter((tender) => tender.outcome === "WON" || tender.outcome === "LOST");
  const pipeline = Object.entries(
    tenders.reduce<Record<string, number>>((counts, tender) => {
      counts[tender.overallStatus] = (counts[tender.overallStatus] ?? 0) + 1;
      return counts;
    }, {}),
  );
  return {
    day,
    averageApproval: average(approvals),
    averageCosting: average(costing),
    averageEmd: average(emd),
    byStage: [...byStage.entries()],
    byOwner: [...byOwner.entries()].map(([id, row]) => ({ name: nameOf.get(id) ?? "Unknown", ...row })),
    internalMisses,
    missed: tenders.filter((tender) => tender.deadlineMissed).length,
    submitted: tenders.filter((tender) => tender.bidStatus === "BID_SUBMITTED_EVIDENCE_RECORDED").length,
    winRate: decided.length ? tenders.filter((tender) => tender.outcome === "WON").length / decided.length : null,
    won: tenders.filter((tender) => tender.outcome === "WON").length,
    lost: tenders.filter((tender) => tender.outcome === "LOST").length,
    pipeline,
    format: (minutes: number | null) => (minutes == null ? "—" : formatDuration(minutes, day)),
  };
}

export function percent(part: number, total: number) {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}
