import "../src/env";
import bcrypt from "bcryptjs";
import { NOT_FOUND, TENDER_FIELDS } from "../src/utils/fields";
import { TEMPLATES } from "../src/services/notify";
import { SAMPLE_NOTICE } from "../src/services/extract";
import { addBusinessMinutes, istDate, type Calendar } from "../src/utils/calendar";

const calendar: Calendar = {
  timeZone: "Asia/Kolkata",
  startMin: 9 * 60,
  endMin: 18 * 60,
  workingDays: new Set([1, 2, 3, 4, 5]),
  holidays: new Set(),
};

export async function seed() {
  const { db } = await import("../src/db");
  const { createTender } = await import("../src/services/domain");
  const { storeFile, sha256 } = await import("../src/services/files");
  const { textToPdf } = await import("../src/services/pdf");

  await db.crawlerException.deleteMany();
  await db.crawlerRun.deleteMany();
  await db.portal.deleteMany();
  await db.tender.deleteMany();
  await db.user.deleteMany();
  await db.holiday.deleteMany();
  await db.slaPolicy.deleteMany();
  await db.escalationRecipient.deleteMany();
  await db.emailTemplate.deleteMany();
  await db.calendarSettings.deleteMany();
  await db.appSettings.deleteMany();

  await db.calendarSettings.create({ data: { id: "default" } });
  await db.appSettings.create({ data: { id: "default", nextSequence: 0 } });
  await db.slaPolicy.createMany({
    data: [
      { stage: "RELEVANCE", durationValue: 24, durationUnit: "HOURS" },
      { stage: "DRAFT_COSTING", durationValue: 2, durationUnit: "DAYS", targetValue: 1, targetUnit: "DAYS" },
      { stage: "SALES_INPUT", durationValue: 2, durationUnit: "DAYS" },
      { stage: "FINAL_COSTING", durationValue: 2, durationUnit: "DAYS" },
      { stage: "DEPT_APPROVAL", durationValue: 1, durationUnit: "DAYS" },
      { stage: "EMD", durationValue: 2, durationUnit: "DAYS" },
      { stage: "EMD_CLARIFICATION", durationValue: 1, durationUnit: "DAYS" },
      { stage: "DATA_VALIDATION", durationValue: 1, durationUnit: "DAYS" },
      { stage: "OCR_EXCEPTION", durationValue: 1, durationUnit: "DAYS" },
      { stage: "BUSINESS_DECISION", durationValue: 1, durationUnit: "DAYS" },
    ],
  });
  await db.escalationRecipient.createMany({
    data: [
      { level: 1, label: "Workflow manager", email: "workflow.manager@coalandash.local" },
      { level: 2, label: "Business owner", email: "business.owner@coalandash.local" },
    ],
  });
  await db.emailTemplate.createMany({ data: TEMPLATES });

  const passwordHash = bcrypt.hashSync("CoalAsh@2026", 10);
  const people = [
    ["admin", "System Administrator", "admin@coalandash.local", "ADMIN"],
    ["coordinator", "Tender Coordinator", "coordinator@coalandash.local", "COORDINATOR"],
    ["vishesh", "Vishesh", "vishesh@coalandash.local", "REVIEWER"],
    ["ranjana", "Ranjana", "ranjana@coalandash.local", "REVIEWER"],
    ["sundarlingam", "Sundarlingam", "sundarlingam@coalandash.local", "COSTING"],
    ["sales", "Sales Team", "sales@coalandash.local", "SALES"],
    ["krishnanath", "Krishnanath", "krishnanath@coalandash.local", "ACCOUNTS"],
    ["surya", "Surya M", "surya@coalandash.local", "ACCOUNTS"],
    ["sanjeev", "Sanjeev", "sanjeev@coalandash.local", "EMD_ISB"],
    ["depthead", "Department Head", "depthead@coalandash.local", "DEPT_HEAD"],
    ["submitter", "Bid Submitter", "submitter@coalandash.local", "BID_SUBMITTER"],
    ["dinesh", "Dinesh", "dinesh@coalandash.local", "GROUP_CEO"],
  ] as const;
  for (const [personKey, name, email, role] of people) {
    await db.user.create({ data: { personKey, name, email, role, passwordHash } });
  }
  const user = Object.fromEntries((await db.user.findMany()).map((item) => [item.personKey, item]));
  const ids = (...keys: string[]) => JSON.stringify(keys.map((key) => user[key].id));

  const coordinator = user.coordinator;
  await createTender(coordinator, {
    projectName: "",
    clientName: "",
    portalName: "NTPC e-procurement",
    tenderRef: "",
    externalTenderId: "",
    source: "MANUAL",
    files: [{ name: "sipat-ash-dyke.txt", type: "text/plain", buffer: Buffer.from(SAMPLE_NOTICE) }],
  });

  async function fields(tenderId: string, values: Record<string, string>) {
    await db.tenderField.createMany({
      data: TENDER_FIELDS.map((field) => {
        const value = values[field.key] ?? "";
        return {
          tenderId,
          fieldNo: field.no,
          fieldKey: field.key,
          label: field.label,
          critical: Boolean(field.critical),
          extractedValue: value || NOT_FOUND,
          correctedValue: value || NOT_FOUND,
          correctedAt: new Date(),
          validationStatus: value ? "VALIDATED" : "NOT_FOUND",
          confidence: value ? 0.9 : 0,
        };
      }),
    });
  }

  const pending = await db.tender.create({
    data: {
      recordId: "CA-2026-0002",
      projectName: "Pond ash evacuation at Korba",
      clientName: "CSPGCL",
      portalName: "CSPGCL e-tender",
      tenderRef: "CSPGCL/ASH/2026/22",
      externalTenderId: "CSP-ASH-2201",
      location: "Korba, Chhattisgarh",
      bidSubmissionEnd: istDate(2026, 12, 18, 15, 0),
      estimatedValue: 86000000,
      emdExposure: 1700000,
      emdType: "BG",
      overallStatus: "PENDING_RELEVANCE",
      relevanceStatus: "PENDING",
      source: "MANUAL",
      ocrStatus: "COMPLETED",
      createdById: coordinator.id,
    },
  });
  await fields(pending.id, {
    project_name: pending.projectName,
    client_name: pending.clientName,
    tender_ref: pending.tenderRef,
    tender_id: pending.externalTenderId,
    location: pending.location,
    bid_submission_end: "18/12/2026 15:00",
    emd_fee: "Rs. 1700000",
    emd_form: "Bank Guarantee",
    emd_exemption: "No",
  });
  await db.workflowTask.create({
    data: {
      tenderId: pending.id,
      branch: "MAIN",
      stage: "RELEVANCE",
      title: "Relevance review",
      status: "NOT_STARTED",
      assigneeIds: ids("vishesh", "ranjana"),
      dueAt: addBusinessMinutes(new Date(), 24 * 60, calendar),
      slaMinutes: 24 * 60,
      baseAt: new Date(),
    },
  });

  const overdue = await db.tender.create({
    data: {
      recordId: "CA-2026-0003",
      projectName: "Ash dyke raising at Ramagundam",
      clientName: "NTPC Limited",
      portalName: "NTPC e-procurement",
      tenderRef: "NTPC/RAM/ASH/2026/07",
      externalTenderId: "NTPC-RAM-0707",
      location: "Ramagundam, Telangana",
      bidSubmissionEnd: istDate(2026, 11, 12, 15, 0),
      estimatedValue: 54000000,
      emdType: "UNCLEAR",
      overallStatus: "PENDING_RELEVANCE",
      relevanceStatus: "PENDING",
      source: "MANUAL",
      ocrStatus: "COMPLETED",
      createdById: coordinator.id,
    },
  });
  await fields(overdue.id, {
    project_name: overdue.projectName,
    client_name: overdue.clientName,
    tender_ref: overdue.tenderRef,
    tender_id: overdue.externalTenderId,
    location: overdue.location,
    bid_submission_end: "12/11/2026 15:00",
    emd_exemption: "Clarification Required",
  });
  await db.workflowTask.create({
    data: {
      tenderId: overdue.id,
      branch: "MAIN",
      stage: "RELEVANCE",
      title: "Relevance review",
      status: "NOT_STARTED",
      assigneeIds: ids("vishesh", "ranjana"),
      dueAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
      slaMinutes: 24 * 60,
      baseAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000),
    },
  });

  const active = await db.tender.create({
    data: {
      recordId: "CA-2026-0004",
      projectName: "Fly ash utilisation at Chandrapur",
      clientName: "MAHAGENCO",
      portalName: "Maharashtra e-procurement",
      tenderRef: "MAHA/ASH/2026/19",
      externalTenderId: "MAHA-ASH-1919",
      location: "Chandrapur, Maharashtra",
      bidSubmissionEnd: istDate(2026, 11, 20, 15, 0),
      estimatedValue: 240000000,
      emdExposure: 4800000,
      emdType: "BG",
      overallStatus: "APPROVED_IN_PROGRESS",
      relevanceStatus: "APPROVED",
      costingStatus: "DRAFT_IN_PROGRESS",
      emdStatus: "PENDING_BG",
      source: "MANUAL",
      ocrStatus: "COMPLETED",
      createdById: coordinator.id,
    },
  });
  await fields(active.id, {
    project_name: active.projectName,
    client_name: active.clientName,
    tender_ref: active.tenderRef,
    tender_id: active.externalTenderId,
    location: active.location,
    bid_submission_end: "20/11/2026 15:00",
    emd_fee: "Rs. 4800000",
    emd_form: "Bank Guarantee",
    emd_exemption: "No",
    estimated_cost: "Rs. 240000000",
  });
  await db.approvalRecord.create({
    data: { tenderId: active.id, stage: "RELEVANCE", decision: "APPROVED", approverId: user.vishesh.id, comments: "Relevant to the ash business." },
  });
  await db.emdRecord.create({ data: { tenderId: active.id, instrumentType: "BG", preparationStatus: "NOT_STARTED" } });
  const draftDue = addBusinessMinutes(new Date(), 2 * 9 * 60, calendar);
  await db.workflowTask.create({
    data: {
      tenderId: active.id,
      branch: "COSTING",
      stage: "DRAFT_COSTING",
      title: "Draft costing",
      status: "IN_PROGRESS",
      assigneeIds: ids("ranjana", "sundarlingam"),
      dueAt: draftDue,
      slaMinutes: 2 * 9 * 60,
      baseAt: new Date(),
    },
  });
  await db.workflowTask.create({
    data: {
      tenderId: active.id,
      branch: "EMD",
      stage: "EMD_BG",
      title: "Prepare bank guarantee",
      status: "NOT_STARTED",
      assigneeIds: ids("krishnanath", "surya"),
      dueAt: addBusinessMinutes(new Date(), 2 * 9 * 60, calendar),
      slaMinutes: 2 * 9 * 60,
      baseAt: new Date(),
    },
  });

  const ready = await db.tender.create({
    data: {
      recordId: "CA-2026-0005",
      projectName: "Bottom ash transport to mine void",
      clientName: "NTPC Limited",
      portalName: "NTPC e-procurement",
      tenderRef: "NTPC/SIPAT/ASH/2026/030",
      externalTenderId: "NTPC-SIPAT-030",
      location: "Sipat, Chhattisgarh",
      bidSubmissionEnd: istDate(2026, 10, 30, 15, 0),
      estimatedValue: 96000000,
      finalCostingValue: 91200000,
      emdExposure: 1900000,
      emdType: "BG",
      overallStatus: "READY_TO_BID",
      relevanceStatus: "APPROVED",
      costingStatus: "APPROVED",
      emdStatus: "COMPLETED",
      approvalStatus: "APPROVED",
      submitterId: user.submitter.id,
      source: "MANUAL",
      ocrStatus: "COMPLETED",
      createdById: coordinator.id,
    },
  });
  await fields(ready.id, {
    project_name: ready.projectName,
    client_name: ready.clientName,
    tender_ref: ready.tenderRef,
    tender_id: ready.externalTenderId,
    location: ready.location,
    bid_submission_end: "30/10/2026 15:00",
    emd_fee: "Rs. 1900000",
    emd_form: "Bank Guarantee",
    emd_exemption: "No",
  });
  await db.costingRecord.create({
    data: { tenderId: ready.id, version: 1, stage: "FINAL_COSTING", assumptions: "Rates checked against the last Sipat award.", amount: 91200000, createdById: user.vishesh.id },
  });
  await db.emdRecord.create({
    data: {
      tenderId: ready.id,
      instrumentType: "BG",
      amount: "Rs. 1900000",
      beneficiary: "NTPC Limited",
      referenceNumber: "BG/2026/441",
      preparationStatus: "VERIFIED",
      completedAt: new Date(),
      verifiedAt: new Date(),
    },
  });
  await db.approvalRecord.createMany({
    data: [
      { tenderId: ready.id, stage: "RELEVANCE", decision: "APPROVED", approverId: user.ranjana.id, comments: "Approved." },
      { tenderId: ready.id, stage: "DEPT_APPROVAL", decision: "APPROVED", approverId: user.depthead.id, comments: "Costing approved." },
    ],
  });
  await db.bidSubmission.create({ data: { tenderId: ready.id, submitterId: user.submitter.id, status: "NOT_YET_SUBMITTED" } });
  await db.workflowTask.create({
    data: {
      tenderId: ready.id,
      branch: "BID",
      stage: "BID_SUBMISSION",
      title: "Submit bid and record evidence",
      status: "NOT_STARTED",
      assigneeIds: ids("submitter"),
      dueAt: ready.bidSubmissionEnd,
      slaMinutes: 0,
      baseAt: new Date(),
    },
  });

  const won = await db.tender.create({
    data: {
      recordId: "CA-2026-0006",
      projectName: "Legacy ash mound removal",
      clientName: "DVC",
      portalName: "DVC portal",
      tenderRef: "DVC/ASH/2026/04",
      externalTenderId: "DVC-ASH-004",
      location: "Mejia, West Bengal",
      bidSubmissionEnd: istDate(2026, 10, 1, 15, 0),
      estimatedValue: 41000000,
      finalCostingValue: 39800000,
      emdExposure: 800000,
      emdType: "ISB",
      overallStatus: "WON",
      relevanceStatus: "APPROVED",
      costingStatus: "APPROVED",
      emdStatus: "SUBMITTED_EVIDENCE",
      approvalStatus: "APPROVED",
      bidStatus: "BID_SUBMITTED_EVIDENCE_RECORDED",
      outcome: "WON",
      submitterId: user.submitter.id,
      source: "MANUAL",
      ocrStatus: "COMPLETED",
      createdById: coordinator.id,
      closedAt: istDate(2026, 10, 20, 11, 0),
    },
  });
  await fields(won.id, {
    project_name: won.projectName,
    client_name: won.clientName,
    tender_ref: won.tenderRef,
    tender_id: won.externalTenderId,
    bid_submission_end: "01/10/2026 15:00",
    emd_form: "ISB / Surety Bond",
    emd_exemption: "No",
  });
  const proof = await textToPdf("Portal acknowledgement\nTender: DVC/ASH/2026/04\nReference: DVC-ACK-7781\nSubmitted: 01/10/2026 14:12");
  const proofPath = await storeFile(won.id, "dvc-acknowledgement.pdf", proof);
  const proofDoc = await db.tenderDocument.create({
    data: {
      tenderId: won.id,
      fileName: "dvc-acknowledgement.pdf",
      storedPath: proofPath,
      mimeType: "application/pdf",
      sizeBytes: proof.length,
      sha256: sha256(proof),
      docType: "SUBMISSION_EVIDENCE",
      uploadedById: user.submitter.id,
      pageCount: 1,
    },
  });
  await db.bidSubmission.create({
    data: {
      tenderId: won.id,
      submitterId: user.submitter.id,
      status: "BID_SUBMITTED_EVIDENCE_RECORDED",
      submittedAt: istDate(2026, 10, 1, 14, 12),
      referenceNumber: "DVC-ACK-7781",
      evidenceDocumentId: proofDoc.id,
    },
  });
  await db.emdRecord.create({
    data: {
      tenderId: won.id,
      instrumentType: "ISB",
      amount: "Rs. 800000",
      referenceNumber: "ISB/2026/19",
      preparationStatus: "VERIFIED",
      submittedToAuthority: true,
      authorityNote: "Uploaded with the bid on 1 Oct 2026.",
      completedAt: istDate(2026, 9, 30, 16, 0),
    },
  });

  await db.tender.create({
    data: {
      recordId: "CA-2026-0007",
      projectName: "Small ash lifting at a private siding",
      clientName: "Private siding",
      tenderRef: "PVT/ASH/009",
      externalTenderId: "PVT-009",
      location: "Jharsuguda, Odisha",
      overallStatus: "REJECTED_CLOSED",
      relevanceStatus: "REJECTED",
      ocrStatus: "COMPLETED",
      closureReason: "Quantity is below the threshold the desk will bid.",
      closedAt: new Date(),
      createdById: user.ranjana.id,
      fields: {
        create: TENDER_FIELDS.map((field) => ({
          fieldNo: field.no,
          fieldKey: field.key,
          label: field.label,
          critical: Boolean(field.critical),
          extractedValue: NOT_FOUND,
          correctedValue: NOT_FOUND,
          validationStatus: "NOT_FOUND",
          correctedAt: new Date(),
        })),
      },
      approvals: {
        create: { stage: "RELEVANCE", decision: "REJECTED", approverId: user.ranjana.id, comments: "Quantity is below the threshold the desk will bid." },
      },
    },
  });

  const missed = await db.tender.create({
    data: {
      recordId: "CA-2026-0008",
      projectName: "Ash pond desilting package",
      clientName: "WBPDCL",
      tenderRef: "WBPDCL/ASH/2026/11",
      externalTenderId: "WB-ASH-011",
      location: "Bakreswar, West Bengal",
      bidSubmissionEnd: istDate(2026, 10, 20, 15, 0),
      estimatedValue: 30000000,
      overallStatus: "NOT_BID_DEADLINE_MISSED",
      relevanceStatus: "APPROVED",
      costingStatus: "DRAFT_IN_PROGRESS",
      deadlineMissed: true,
      bidStatus: "NOT_BID_DEADLINE_MISSED",
      closureReason: "Bid submission deadline passed without a recorded submission.",
      closedAt: istDate(2026, 10, 20, 15, 1),
      ocrStatus: "COMPLETED",
      createdById: coordinator.id,
    },
  });
  await fields(missed.id, {
    project_name: missed.projectName,
    client_name: missed.clientName,
    tender_ref: missed.tenderRef,
    tender_id: missed.externalTenderId,
    bid_submission_end: "20/10/2026 15:00",
  });
  await db.workflowTask.create({
    data: {
      tenderId: missed.id,
      branch: "COSTING",
      stage: "DRAFT_COSTING",
      title: "Draft costing",
      status: "CANCELLED",
      assigneeIds: ids("ranjana", "sundarlingam"),
      dueAt: istDate(2026, 10, 16, 18, 0),
      slaMinutes: 2 * 9 * 60,
      baseAt: istDate(2026, 10, 14, 10, 0),
      wasOverdue: true,
      breachSent: true,
    },
  });
  await db.bidSubmission.create({ data: { tenderId: missed.id, status: "NOT_BID_DEADLINE_MISSED", submitterId: "" } });

  await db.appSettings.update({ where: { id: "default" }, data: { nextSequence: 8 } });
  const portal = await db.portal.create({
    data: {
      name: "GeM",
      url: "https://gem.gov.in",
      category: "Central procurement",
      keywords: "pond ash, fly ash, coal ash",
      frequencyHours: 24,
      enabled: false,
      accessMethod: "UNVALIDATED",
      lastStatus: "NOT_SCANNED",
    },
  });
  await db.crawlerException.create({
    data: {
      portalId: portal.id,
      kind: "Authentication required",
      detail: "Portal access has not been validated. No scan was executed and nothing was dropped silently.",
    },
  });
  console.log("Seeded Coal & Ash tenders.");
}

if (require.main === module) {
  seed().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
