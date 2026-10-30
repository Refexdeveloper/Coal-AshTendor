import "../src/env";
import { NOT_FOUND, TENDER_FIELDS } from "../src/utils/fields";
import { addBusinessMinutes, istDate, type Calendar } from "../src/utils/calendar";

/**
 * Adds about 40 dummy tenders spread over FY 2024–25 to today, so dashboards, filters and reports have data.
 * Users must already exist (npm run db:seed). Safe to run again: earlier demo tenders (record IDs CA-DEMO-…) are replaced.
 * Usage: npm run db:demo
 */
const calendar: Calendar = {
  timeZone: "Asia/Kolkata",
  startMin: 9 * 60,
  endMin: 18 * 60,
  workingDays: new Set([1, 2, 3, 4, 5]),
  holidays: new Set(),
};

const CLIENTS = [
  { name: "NTPC Limited", portal: "NTPC e-procurement", places: ["Sipat, Chhattisgarh", "Korba, Chhattisgarh", "Vindhyachal, Madhya Pradesh", "Ramagundam, Telangana"] },
  { name: "MAHAGENCO", portal: "Maharashtra e-procurement", places: ["Chandrapur, Maharashtra", "Koradi, Maharashtra", "Khaperkheda, Maharashtra"] },
  { name: "CSPGCL", portal: "CSPGCL e-tender", places: ["Korba West, Chhattisgarh", "Marwa, Chhattisgarh"] },
  { name: "DVC", portal: "DVC portal", places: ["Mejia, West Bengal", "Bokaro, Jharkhand", "Raghunathpur, West Bengal"] },
  { name: "TANGEDCO", portal: "TN e-tender", places: ["Mettur, Tamil Nadu", "North Chennai, Tamil Nadu", "Tuticorin, Tamil Nadu"] },
  { name: "Adani Power", portal: "Adani supplier portal", places: ["Mundra, Gujarat", "Tiroda, Maharashtra"] },
  { name: "JSW Energy", portal: "JSW e-sourcing", places: ["Ratnagiri, Maharashtra", "Vijayanagar, Karnataka"] },
  { name: "Coal India (MCL)", portal: "GeM", places: ["Talcher, Odisha", "Ib Valley, Odisha"] },
  { name: "SCCL", portal: "GeM", places: ["Kothagudem, Telangana", "Ramagundam, Telangana"] },
  { name: "UPRVUNL", portal: "UP e-tender", places: ["Anpara, Uttar Pradesh", "Obra, Uttar Pradesh"] },
];

const WORKS = [
  "Fly ash evacuation and transportation",
  "Pond ash lifting and disposal",
  "Bottom ash transport to mine void",
  "Dry fly ash supply to cement plants",
  "Ash dyke raising and maintenance",
  "Coal handling and washery rejects removal",
  "Legacy ash mound removal",
  "Fly ash brick plant operation",
  "Coal transportation by road",
  "Ash slurry pipeline O&M",
  "Rail loading of fly ash rakes",
  "Ash utilisation in road embankment",
];

// Deterministic pseudo-random numbers, so every run gives the same demo set.
let state = 20260401;
const rand = () => {
  state = (state * 1103515245 + 12345) % 2147483648;
  return state / 2147483648;
};
const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
const between = (low: number, high: number) => low + rand() * (high - low);

type Plan = { overall: string; relevance: string; costing: string; emd: string; bid: string; approval: string; outcome: string };
const OPEN: Plan[] = [
  { overall: "DATA_VALIDATION_REQUIRED", relevance: "NOT_STARTED", costing: "NOT_STARTED", emd: "NOT_STARTED", bid: "NOT_STARTED", approval: "NOT_STARTED", outcome: "" },
  { overall: "PENDING_RELEVANCE", relevance: "PENDING", costing: "NOT_STARTED", emd: "NOT_STARTED", bid: "NOT_STARTED", approval: "NOT_STARTED", outcome: "" },
  { overall: "APPROVED_IN_PROGRESS", relevance: "APPROVED", costing: "DRAFT_IN_PROGRESS", emd: "PENDING_BG", bid: "NOT_STARTED", approval: "NOT_STARTED", outcome: "" },
  { overall: "APPROVED_IN_PROGRESS", relevance: "APPROVED", costing: "PENDING_DEPT", emd: "IN_PROGRESS", bid: "NOT_STARTED", approval: "PENDING", outcome: "" },
  { overall: "READY_TO_BID", relevance: "APPROVED", costing: "APPROVED", emd: "COMPLETED", bid: "NOT_YET_SUBMITTED", approval: "APPROVED", outcome: "" },
  { overall: "BID_EVIDENCE_PENDING", relevance: "APPROVED", costing: "APPROVED", emd: "COMPLETED", bid: "BID_SUBMITTED_EVIDENCE_PENDING", approval: "APPROVED", outcome: "" },
  { overall: "BID_EVIDENCE_RECORDED", relevance: "APPROVED", costing: "APPROVED", emd: "COMPLETED", bid: "BID_SUBMITTED_EVIDENCE_RECORDED", approval: "APPROVED", outcome: "" },
];
const CLOSED: Plan[] = [
  { overall: "WON", relevance: "APPROVED", costing: "APPROVED", emd: "COMPLETED", bid: "BID_SUBMITTED_EVIDENCE_RECORDED", approval: "APPROVED", outcome: "WON" },
  { overall: "WON", relevance: "APPROVED", costing: "APPROVED", emd: "COMPLETED", bid: "BID_SUBMITTED_EVIDENCE_RECORDED", approval: "APPROVED", outcome: "WON" },
  { overall: "LOST", relevance: "APPROVED", costing: "APPROVED", emd: "COMPLETED", bid: "BID_SUBMITTED_EVIDENCE_RECORDED", approval: "APPROVED", outcome: "LOST" },
  { overall: "LOST", relevance: "APPROVED", costing: "APPROVED", emd: "COMPLETED", bid: "BID_SUBMITTED_EVIDENCE_RECORDED", approval: "APPROVED", outcome: "LOST" },
  { overall: "REJECTED_CLOSED", relevance: "REJECTED", costing: "NOT_STARTED", emd: "NOT_STARTED", bid: "NOT_STARTED", approval: "NOT_STARTED", outcome: "" },
  { overall: "NOT_BID_DEADLINE_MISSED", relevance: "APPROVED", costing: "DRAFT_COMPLETED", emd: "IN_PROGRESS", bid: "NOT_BID_DEADLINE_MISSED", approval: "NOT_STARTED", outcome: "" },
  { overall: "CLOSED_BUSINESS", relevance: "APPROVED", costing: "SALES_COMPLETED", emd: "NOT_STARTED", bid: "NOT_STARTED", approval: "NOT_STARTED", outcome: "" },
  { overall: "CANCELLED", relevance: "APPROVED", costing: "APPROVED", emd: "COMPLETED", bid: "NOT_STARTED", approval: "APPROVED", outcome: "CANCELLED" },
];

async function main() {
  const { db } = await import("../src/db");
  const users = await db.user.findMany();
  const user = Object.fromEntries(users.map((item) => [item.personKey, item]));
  const needed = ["coordinator", "vishesh", "ranjana", "sundarlingam", "krishnanath", "surya", "sanjeev", "depthead", "submitter"];
  const missing = needed.filter((key) => !user[key]);
  if (missing.length) throw new Error(`Seed users are missing (${missing.join(", ")}). Run npm run db:seed first.`);
  const ids = (...keys: string[]) => JSON.stringify(keys.map((key) => user[key].id));

  const removed = await db.tender.deleteMany({ where: { recordId: { contains: "CA-DEMO-" } } });
  if (removed.count) console.log(`Removed ${removed.count} earlier demo tenders.`);

  const now = new Date();
  const start = new Date(2024, 3, 5).getTime();
  const total = 42;
  const openCount = 14;
  const closedCount = total - openCount;
  let made = 0;

  for (let index = 0; index < total; index += 1) {
    // Closed tenders spread from April 2024 to about two months ago; the newest 14 are live, one or two per stage.
    const live = index >= closedCount;
    const createdAt = live
      ? new Date(now.getTime() - (openCount - (index - closedCount)) * 2.6 * 864e5 - between(0, 1) * 864e5)
      : new Date(start + (index / closedCount) * (now.getTime() - 60 * 864e5 - start) + between(0, 3) * 864e5);
    const plan = live ? OPEN[(index - closedCount) % OPEN.length] : CLOSED[index % CLOSED.length];

    const client = pick(CLIENTS);
    const location = pick(client.places);
    const work = pick(WORKS);
    const site = location.split(",")[0];
    const year = createdAt.getFullYear();
    // Amounts in rupees: ₹25 L to ₹90 Cr, rounded to the lakh.
    const estimatedValue = Math.round(Math.exp(between(Math.log(25e5), Math.log(90e7))) / 1e5) * 1e5;
    const emdType = pick(["BG", "BG", "BG", "ISB", "DD", "ONLINE", "EXEMPTION"] as const);
    const emdExposure = emdType === "EXEMPTION" ? 0 : Math.round((estimatedValue * between(0.01, 0.03)) / 1e4) * 1e4;
    const costed = ["APPROVED", "PENDING_DEPT"].includes(plan.costing);
    const finalCostingValue = costed ? Math.round((estimatedValue * between(0.86, 1.04)) / 1e5) * 1e5 : null;
    // Live tenders that are not yet bid close in the coming weeks (a few inside 7 days); otherwise automation would mark them missed.
    const upcoming = live && !plan.bid.startsWith("BID_SUBMITTED");
    const deadline = upcoming
      ? new Date(now.getTime() + (index % 3 === 0 ? between(1.5, 6) : between(8, 35)) * 864e5)
      : new Date(createdAt.getTime() + between(18, 40) * 864e5);
    const bidSubmissionEnd = istDate(deadline.getFullYear(), deadline.getMonth() + 1, deadline.getDate(), 15, 0);
    const closed = Boolean(CLOSED.includes(plan));
    const recordId = `CA-DEMO-${String(index + 1).padStart(3, "0")}`;
    const tenderRef = `${client.name.split(" ")[0].toUpperCase()}/${site.toUpperCase().replace(/\s+/g, "")}/${year}/${100 + index}`;

    const tender = await db.tender.create({
      data: {
        recordId,
        projectName: `${work} at ${site}`,
        clientName: client.name,
        portalName: client.portal,
        tenderRef,
        externalTenderId: `${client.portal === "GeM" ? "GEM/" : ""}${year}-${4000 + index * 37}`,
        location,
        bidSubmissionEnd,
        bidOpeningAt: new Date(bidSubmissionEnd.getTime() + 864e5),
        estimatedValue,
        finalCostingValue,
        emdExposure,
        emdType,
        overallStatus: plan.overall,
        relevanceStatus: plan.relevance,
        costingStatus: plan.costing,
        emdStatus: emdType === "EXEMPTION" && plan.emd !== "NOT_STARTED" ? "COMPLETED" : plan.emd,
        bidStatus: plan.bid,
        approvalStatus: plan.approval,
        outcome: plan.outcome,
        outcomeNotes: plan.outcome === "WON" ? "Lowest bidder (L1). LOA received." : plan.outcome === "LOST" ? `L${Math.ceil(between(2, 4))} by a small margin.` : "",
        closureReason:
          plan.overall === "REJECTED_CLOSED" ? "Outside the ash business scope." : plan.overall === "CLOSED_BUSINESS" ? "Margins too thin after sales input." : plan.overall === "CANCELLED" ? "Client cancelled the tender." : "",
        submitterId: ["READY_TO_BID", "BID_EVIDENCE_PENDING", "BID_EVIDENCE_RECORDED", "WON", "LOST"].includes(plan.overall) ? user.submitter.id : null,
        deadlineMissed: plan.overall === "NOT_BID_DEADLINE_MISSED",
        closedAt: closed ? new Date(bidSubmissionEnd.getTime() + between(5, 30) * 864e5) : null,
        source: client.portal === "GeM" ? "PORTAL" : "MANUAL",
        ocrStatus: "COMPLETED",
        createdById: user.coordinator.id,
        createdAt,
      },
    });

    const lakhs = (value: number) => `Rs. ${value.toLocaleString("en-IN")}`;
    const values: Record<string, string> = {
      project_name: tender.projectName,
      tender_ref: tenderRef,
      tender_id: tender.externalTenderId,
      client_name: client.name,
      work_description: `${work} for ${client.name} at ${location}.`,
      location,
      bid_submission_end: `${String(deadline.getDate()).padStart(2, "0")}/${String(deadline.getMonth() + 1).padStart(2, "0")}/${deadline.getFullYear()} 15:00`,
      estimated_cost: lakhs(estimatedValue),
      emd_fee: emdType === "EXEMPTION" ? "" : lakhs(emdExposure),
      emd_form: { BG: "Bank Guarantee", ISB: "ISB / Surety Bond", DD: "Demand Draft", ONLINE: "Online Payment", EXEMPTION: "Exemption" }[emdType],
      emd_exemption: emdType === "EXEMPTION" ? "Yes" : "No",
      submission_mode: pick(["Electronic", "Electronic", "Both"]),
      contract_period: `${pick([12, 24, 36])} months`,
      envelope_count: "2",
      bid_validity: "180 days",
      gst: "18% extra",
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
          correctedValue: plan.overall === "DATA_VALIDATION_REQUIRED" ? "" : value || NOT_FOUND,
          correctedAt: plan.overall === "DATA_VALIDATION_REQUIRED" ? null : createdAt,
          validationStatus: plan.overall === "DATA_VALIDATION_REQUIRED" ? (value ? "EXTRACTED" : "MISSING") : value ? "VALIDATED" : "NOT_FOUND",
          confidence: value ? 0.88 : 0,
        };
      }),
    });

    if (plan.relevance === "APPROVED" || plan.relevance === "REJECTED") {
      await db.approvalRecord.create({
        data: {
          tenderId: tender.id,
          stage: "RELEVANCE",
          decision: plan.relevance,
          approverId: pick([user.vishesh.id, user.ranjana.id]),
          comments: plan.relevance === "APPROVED" ? "Relevant to the ash business." : "Not in our line of work.",
          createdAt: new Date(createdAt.getTime() + 864e5),
        },
      });
    }
    if (plan.approval === "APPROVED") {
      await db.approvalRecord.create({
        data: { tenderId: tender.id, stage: "DEPT_APPROVAL", decision: "APPROVED", approverId: user.depthead.id, comments: "Costing approved.", createdAt: new Date(createdAt.getTime() + 5 * 864e5) },
      });
    }
    if (finalCostingValue) {
      await db.costingRecord.create({
        data: { tenderId: tender.id, version: 1, stage: "FINAL_COSTING", assumptions: "Rates checked against recent awards in the region.", amount: finalCostingValue, createdById: user.sundarlingam.id },
      });
    }
    if (plan.emd !== "NOT_STARTED" && emdType !== "EXEMPTION") {
      const done = plan.emd === "COMPLETED";
      await db.emdRecord.create({
        data: {
          tenderId: tender.id,
          instrumentType: emdType,
          amount: lakhs(emdExposure),
          beneficiary: client.name,
          referenceNumber: done ? `${emdType}/${year}/${300 + index}` : "",
          preparationStatus: done ? "VERIFIED" : "IN_PROGRESS",
          completedAt: done ? new Date(createdAt.getTime() + 6 * 864e5) : null,
          verifiedAt: done ? new Date(createdAt.getTime() + 7 * 864e5) : null,
        },
      });
    }
    if (tender.submitterId) {
      const submitted = plan.bid.startsWith("BID_SUBMITTED");
      await db.bidSubmission.create({
        data: {
          tenderId: tender.id,
          submitterId: user.submitter.id,
          status: plan.bid,
          referenceNumber: submitted ? `ACK-${year}-${7000 + index}` : "",
          // Submitted a few hours before the deadline, but never in the future.
          submittedAt: submitted ? new Date(Math.min(bidSubmissionEnd.getTime() - between(2, 30) * 36e5, now.getTime() - between(1, 20) * 36e5)) : null,
        },
      });
    }

    // Open work, so "Now with", overdue and worklists have something to show. About one in four runs late.
    const task = (branch: string, stage: string, title: string, assignees: string, status = "NOT_STARTED") => {
      const late = rand() < 0.25;
      const baseAt = late ? new Date(now.getTime() - between(3, 8) * 864e5) : new Date(now.getTime() - between(0, 1) * 864e5);
      return db.workflowTask.create({
        data: { tenderId: tender.id, branch, stage, title, status, assigneeIds: assignees, baseAt, slaMinutes: 2 * 9 * 60, dueAt: addBusinessMinutes(baseAt, 2 * 9 * 60, calendar) },
      });
    };
    if (plan.overall === "DATA_VALIDATION_REQUIRED") await task("MAIN", "DATA_VALIDATION", "Validate extracted fields", ids("coordinator"));
    if (plan.overall === "PENDING_RELEVANCE") await task("MAIN", "RELEVANCE", "Relevance review", ids("vishesh", "ranjana"));
    if (plan.overall === "APPROVED_IN_PROGRESS") {
      if (plan.costing === "PENDING_DEPT") await task("COSTING", "DEPT_APPROVAL", "Department Head approval", ids("depthead"));
      else await task("COSTING", "DRAFT_COSTING", "Draft costing", ids("sundarlingam"), "IN_PROGRESS");
      if (emdType === "ISB") await task("EMD", "EMD_ISB", "Arrange ISB / surety bond", ids("sanjeev"));
      else if (emdType !== "EXEMPTION") await task("EMD", "EMD_BG", "Prepare EMD instrument", ids("krishnanath", "surya"));
    }
    if (plan.overall === "READY_TO_BID" || plan.overall === "BID_EVIDENCE_PENDING") {
      await task("BID", "BID_SUBMISSION", plan.overall === "READY_TO_BID" ? "Submit bid and record evidence" : "Upload portal acknowledgement", ids("submitter"));
    }
    made += 1;
  }

  console.log(`Added ${made} demo tenders (CA-DEMO-001 to CA-DEMO-${String(made).padStart(3, "0")}).`);
  process.exit(0);
}

main().catch((error) => {
  console.error((error instanceof Error && error.message) || error);
  process.exit(1);
});
