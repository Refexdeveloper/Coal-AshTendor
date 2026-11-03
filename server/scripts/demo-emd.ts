import "../src/env";
import { NOT_FOUND, TENDER_FIELDS } from "../src/utils/fields";
import { addBusinessMinutes, istDate, type Calendar } from "../src/utils/calendar";

/**
 * Adds three tenders waiting at EMD → Requirement check with Ranjana, so the BG letter form can be tried.
 * Relevance is approved, draft costing is open with Sundaralingam, and no BG letter details are saved yet.
 * Safe to run again: earlier CA-EMDCHK-… tenders are replaced. Other data is left alone.
 * Usage: npm run db:demo:emd
 */
const calendar: Calendar = {
  timeZone: "Asia/Kolkata",
  startMin: 9 * 60,
  endMin: 18 * 60,
  workingDays: new Set([1, 2, 3, 4, 5]),
  holidays: new Set(),
};

const TENDERS = [
  {
    line: "COAL",
    projectName: "Procurement of 2.0 LMT Domestic Coal for JPL Power Station",
    clientName: "JHABUA POWER LTD.",
    portalName: "NTPC e-procurement",
    location: "Ghansore, Seoni, Madhya Pradesh",
    tenderRef: "JPL/COAL/2026-27/014",
    externalTenderId: "JPL-2026-0148",
    estimatedValue: 48e7,
    emdFee: 1e7,
    days: 21,
    work: "Procurement and delivery of 2.0 LMT domestic coal to JPL Power Station, Barela, Seoni (M.P.).",
  },
  {
    line: "ASH",
    projectName: "Fly ash evacuation and transportation at Sipat",
    clientName: "NTPC Limited",
    portalName: "NTPC e-procurement",
    location: "Sipat, Chhattisgarh",
    tenderRef: "NTPC/SIPAT/ASH/2026/221",
    externalTenderId: "NTPC-SPT-22107",
    estimatedValue: 12.5e7,
    emdFee: 25e5,
    days: 14,
    work: "Evacuation of dry fly ash from silos and transportation to user industries for NTPC Sipat.",
  },
  {
    line: "ASH",
    projectName: "Pond ash lifting and disposal at Chandrapur",
    clientName: "MAHAGENCO",
    portalName: "Maharashtra e-procurement",
    location: "Chandrapur, Maharashtra",
    tenderRef: "MAHAGENCO/CSTPS/2026/88",
    externalTenderId: "MH-2026-8812",
    estimatedValue: 6.2e7,
    emdFee: 12.5e5,
    days: 9,
    work: "Lifting of pond ash from ash bund and disposal to low-lying areas at Chandrapur STPS.",
  },
] as const;

async function main() {
  const { db } = await import("../src/db");
  const byEmail = async (email: string) => {
    const user = await db.user.findFirst({ where: { email, active: true } });
    if (!user) throw new Error(`${email} is not an active user. Start the server once so the team roster is added.`);
    return user;
  };
  const ranjana = await byEmail("ranjana.s@refex.co.in");
  const aditya = await byEmail("aditya.ks@refex.co.in");
  const prasanth = await byEmail("prasanth.p@refex.co.in");
  const sundar = await byEmail("sundaralingam.g@refex.co.in");

  const removed = await db.tender.deleteMany({ where: { recordId: { contains: "CA-EMDCHK-" } } });
  if (removed.count) console.log(`Removed ${removed.count} earlier EMD check tenders.`);

  const now = new Date();
  for (const [index, item] of TENDERS.entries()) {
    const recordId = `CA-EMDCHK-${String(index + 1).padStart(3, "0")}`;
    const reviewer = item.line === "COAL" ? aditya : ranjana;
    const createdAt = new Date(now.getTime() - 3 * 864e5);
    const validatedAt = new Date(now.getTime() - 2.5 * 864e5);
    const approvedAt = new Date(now.getTime() - 1 * 864e5);
    const deadline = new Date(now.getTime() + item.days * 864e5);
    const bidSubmissionEnd = istDate(deadline.getFullYear(), deadline.getMonth() + 1, deadline.getDate(), 15, 0);

    const tender = await db.tender.create({
      data: {
        recordId,
        projectName: item.projectName,
        clientName: item.clientName,
        portalName: item.portalName,
        tenderRef: item.tenderRef,
        externalTenderId: item.externalTenderId,
        location: item.location,
        bidSubmissionEnd,
        bidOpeningAt: new Date(bidSubmissionEnd.getTime() + 864e5),
        estimatedValue: item.estimatedValue,
        emdExposure: item.emdFee,
        emdType: "UNCLEAR",
        businessLine: item.line,
        overallStatus: "APPROVED_IN_PROGRESS",
        relevanceStatus: "APPROVED",
        costingStatus: "DRAFT_IN_PROGRESS",
        emdStatus: "CLARIFICATION_REQUIRED",
        bidStatus: "NOT_YET_SUBMITTED",
        approvalStatus: "NOT_STARTED",
        submitterId: reviewer.id,
        source: "MANUAL",
        ocrStatus: "COMPLETED",
        createdById: prasanth.id,
        createdAt,
      },
    });

    const rupees = (value: number) => `Rs. ${value.toLocaleString("en-IN")}`;
    const day = (date: Date) => `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
    const values: Record<string, string> = {
      project_name: item.projectName,
      tender_ref: item.tenderRef,
      tender_id: item.externalTenderId,
      client_name: item.clientName,
      work_description: item.work,
      location: item.location,
      bid_submission_end: `${day(deadline)} 15:00`,
      estimated_cost: rupees(item.estimatedValue),
      emd_fee: rupees(item.emdFee),
      emd_form: "Clarification Required",
      emd_exemption: "No",
      performance_bg: "10% of contract value",
      submission_mode: "Electronic",
      contract_period: "12 months",
      envelope_count: "2",
      bid_validity: "180 days",
      gst: "18% extra",
      scope: item.work,
    };
    await db.tenderField.createMany({
      data: TENDER_FIELDS.map((field) => {
        const value = values[field.key] ?? "";
        return {
          tenderId: tender.id,
          fieldNo: field.no,
          fieldKey: field.key,
          label: field.label,
          critical: Boolean(field.critical),
          extractedValue: value || NOT_FOUND,
          correctedValue: value || NOT_FOUND,
          correctedAt: validatedAt,
          validationStatus: value ? "VALIDATED" : "NOT_FOUND",
          confidence: value ? 0.9 : 0,
        };
      }),
    });

    const done = (stage: string, title: string, assignee: string, at: Date, decision: string, comments: string, startedAt: Date) =>
      db.workflowTask.create({
        data: {
          tenderId: tender.id,
          branch: "MAIN",
          stage,
          title,
          status: "COMPLETED",
          assigneeIds: JSON.stringify([assignee]),
          baseAt: startedAt,
          slaMinutes: 9 * 60,
          dueAt: addBusinessMinutes(startedAt, 9 * 60, calendar),
          decision,
          comments,
          completedById: assignee,
          completedAt: at,
          createdAt: startedAt,
        },
      });
    await done("DATA_VALIDATION", "Review extracted tender data", prasanth.id, validatedAt, "SUBMITTED", "Extraction reviewed.", createdAt);
    const relevance = await done("RELEVANCE", "Relevance review", reviewer.id, approvedAt, "APPROVED", "Relevant. Proceed with costing and EMD.", validatedAt);
    await db.approvalRecord.create({
      data: { tenderId: tender.id, taskId: relevance.id, stage: "RELEVANCE", decision: "APPROVED", approverId: reviewer.id, comments: "Relevant. Proceed with costing and EMD.", createdAt: approvedAt },
    });
    await db.emdRecord.create({ data: { tenderId: tender.id, instrumentType: "UNCLEAR", preparationStatus: "NOT_STARTED" } });
    await db.bidSubmission.create({ data: { tenderId: tender.id, submitterId: reviewer.id, status: "NOT_YET_SUBMITTED" } });

    const open = (branch: string, stage: string, title: string, assignee: string, status = "NOT_STARTED") =>
      db.workflowTask.create({
        data: {
          tenderId: tender.id,
          branch,
          stage,
          title,
          status,
          assigneeIds: JSON.stringify([assignee]),
          baseAt: approvedAt,
          slaMinutes: 2 * 9 * 60,
          dueAt: addBusinessMinutes(approvedAt, 2 * 9 * 60, calendar),
          createdAt: approvedAt,
        },
      });
    await open("COSTING", "DRAFT_COSTING", "Draft costing", sundar.id, "IN_PROGRESS");
    await open("EMD", "EMD_CLARIFICATION", "Clarify EMD requirement", ranjana.id);

    const audit = (action: string, actor: { id: string; name: string }, at: Date, detail = "") =>
      db.auditLog.create({ data: { tenderId: tender.id, actorId: actor.id, actorName: actor.name, action, entity: "Tender", detail, createdAt: at } });
    await audit("Created tender", prasanth, createdAt, `${recordId} from manual upload.`);
    await audit("Submitted for relevance review", prasanth, validatedAt);
    await audit("Approved tender", reviewer, approvedAt, "Costing and EMD started. EMD route: Clarify EMD requirement.");

    console.log(`${recordId} · ${item.clientName} · ${item.line === "COAL" ? "Coal" : "Ash"} · EMD ${rupees(item.emdFee)} → Requirement check with ${ranjana.name}`);
  }
  process.exit(0);
}

main().catch((error) => {
  console.error((error instanceof Error && error.message) || error);
  process.exit(1);
});
