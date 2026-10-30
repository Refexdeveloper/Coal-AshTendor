import type { Prisma, WorkflowTask } from "@prisma/client";
import { addBusinessMinutes, businessMinutesBetween, dayLengthMinutes, formatWhen, parseClock, type Calendar } from "./calendar";
import { effectiveValue, extractFields, parseDateTime, parseInr, type FieldHit, type PageText } from "./extract";
import { NOT_FOUND, TENDER_FIELDS } from "./fields";
import { unlink } from "fs/promises";
import { allowedUpload, pagesFromBuffer, sha256, storeFile } from "./files";
import { extractUploadedFile, overlayHits } from "./ocr";
import { CLOSED_OVERALL, CREATOR_ROLES, EDITOR_ROLES, MANAGER_ROLES, OPEN_TASK } from "./labels";
import { emailsFor, notifyAddresses } from "./notify";
import { prisma } from "./prisma";

export class WorkflowError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowError";
  }
}

export type Actor = {
  id: string;
  name: string;
  email: string;
  role: string;
  personKey: string;
};

type Tx = Prisma.TransactionClient;

type FieldRow = {
  fieldKey: string;
  label: string;
  extractedValue: string;
  correctedValue: string;
  correctedAt: Date | null;
  validationStatus: string;
  critical: boolean;
};

const POLICY_FOR: Record<string, string> = {
  EMD_BG: "EMD",
  EMD_ISB: "EMD",
  EMD_EXEMPTION: "EMD",
  EMD_OTHER: "EMD",
};

const EMD_READY = ["COMPLETED", "SUBMITTED_EVIDENCE"];

export async function getCalendar(): Promise<Calendar> {
  const settings = await prisma.calendarSettings.findUnique({ where: { id: "default" } });
  const holidays = await prisma.holiday.findMany();
  const startMin = parseClock(settings?.workStart ?? "09:00");
  const endMin = parseClock(settings?.workEnd ?? "18:00");
  const days = (settings?.workingDays ?? "1,2,3,4,5")
    .split(",")
    .map((day) => Number(day))
    .filter((day) => day >= 1 && day <= 7);
  return {
    timeZone: settings?.timezone ?? "Asia/Kolkata",
    startMin,
    endMin: endMin > startMin ? endMin : startMin + 540,
    workingDays: new Set(days.length ? days : [1, 2, 3, 4, 5]),
    holidays: new Set(holidays.map((holiday) => holiday.date)),
  };
}

async function minutesFor(stage: string, calendar: Calendar) {
  const policy = await prisma.slaPolicy.findUnique({ where: { stage: POLICY_FOR[stage] ?? stage } });
  if (!policy) return dayLengthMinutes(calendar);
  if (policy.durationUnit === "HOURS") return policy.durationValue * 60;
  return policy.durationValue * dayLengthMinutes(calendar);
}

async function mustUser(personKey: string) {
  const user = await prisma.user.findFirst({ where: { personKey, active: true } });
  if (!user) throw new WorkflowError(`No active user is configured for ${personKey}.`);
  return user;
}

function parseIds(value: string) {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function assertOpen(actor: Actor, task: { assigneeIds: string; status: string }) {
  if (!parseIds(task.assigneeIds).includes(actor.id)) {
    throw new WorkflowError("This task is assigned to someone else.");
  }
  if (!OPEN_TASK.includes(task.status)) throw new WorkflowError("This task is already closed.");
}

async function audit(
  client: Tx | typeof prisma,
  entry: {
    tenderId?: string;
    actor: Actor;
    action: string;
    entity: string;
    detail?: string;
    before?: string;
    after?: string;
  },
) {
  await client.auditLog.create({
    data: {
      tenderId: entry.tenderId,
      actorId: entry.actor.id,
      actorName: entry.actor.name,
      action: entry.action,
      entity: entry.entity,
      detail: (entry.detail ?? "").slice(0, 8000),
      before: (entry.before ?? "").slice(0, 8000),
      after: (entry.after ?? "").slice(0, 8000),
    },
  });
}

function valueOf(field: FieldRow | undefined) {
  if (!field) return "";
  const value = effectiveValue(field).trim();
  if (!value || value === NOT_FOUND) return "";
  return value;
}

export function classifyEmd(fields: FieldRow[]) {
  const exemption = valueOf(fields.find((field) => field.fieldKey === "emd_exemption"));
  const form = valueOf(fields.find((field) => field.fieldKey === "emd_form"));
  const leads = (value: string, word: string) => new RegExp(`^\\s*${word}\\b`, "i").test(value);
  const exempt = exemption === "Yes" || leads(exemption, "yes") || form === "Exemption" || leads(form, "exemption");
  const instrument =
    form === "Bank Guarantee"
      ? "BG"
      : form === "ISB / Surety Bond"
        ? "ISB"
        : form === "Demand Draft"
          ? "DD"
          : form === "Online Payment"
            ? "ONLINE"
            : form === "Other"
              ? "OTHER"
              : "";
  if ((exemption === "Clarification Required" || form === "Clarification Required") && !exempt) return "UNCLEAR" as const;
  if (exempt && instrument) return "UNCLEAR" as const;
  if (exempt) return "EXEMPTION" as const;
  if (instrument) return instrument as "BG" | "ISB" | "DD" | "ONLINE" | "OTHER";
  return "UNCLEAR" as const;
}

const EMD_PLAN = {
  BG: { stage: "EMD_BG", title: "Prepare bank guarantee", emdStatus: "PENDING_BG", owners: ["krishnanath", "surya"] },
  ISB: { stage: "EMD_ISB", title: "Prepare ISB / surety bond", emdStatus: "PENDING_ISB", owners: ["sanjeev"] },
  EXEMPTION: { stage: "EMD_EXEMPTION", title: "Verify EMD exemption", emdStatus: "EXEMPTION_VERIFICATION", owners: ["krishnanath", "surya"] },
  DD: { stage: "EMD_OTHER", title: "Prepare demand draft", emdStatus: "IN_PROGRESS", owners: ["krishnanath", "surya"] },
  ONLINE: { stage: "EMD_OTHER", title: "Prepare online EMD payment", emdStatus: "IN_PROGRESS", owners: ["krishnanath", "surya"] },
  OTHER: { stage: "EMD_OTHER", title: "Prepare EMD instrument", emdStatus: "IN_PROGRESS", owners: ["krishnanath", "surya"] },
  UNCLEAR: { stage: "EMD_CLARIFICATION", title: "Clarify EMD requirement", emdStatus: "CLARIFICATION_REQUIRED", owners: ["vishesh"] },
} as const;

async function createTask(
  tx: Tx,
  options: {
    tenderId: string;
    branch: string;
    stage: string;
    title: string;
    assigneeIds: string[];
    dueAt: Date | null;
    slaMinutes: number;
  },
) {
  const existing = await tx.workflowTask.findFirst({
    where: { tenderId: options.tenderId, stage: options.stage, status: { in: OPEN_TASK } },
  });
  if (existing) return { task: existing, created: false };
  const uniqueAssignees = [...new Set(options.assigneeIds)];
  if (!uniqueAssignees.length) throw new WorkflowError(`No owner is available for ${options.title}.`);
  const task = await tx.workflowTask.create({
    data: {
      tenderId: options.tenderId,
      branch: options.branch,
      stage: options.stage,
      title: options.title,
      status: "NOT_STARTED",
      assigneeIds: JSON.stringify(uniqueAssignees),
      dueAt: options.dueAt,
      slaMinutes: options.slaMinutes,
      baseAt: new Date(),
    },
  });
  return { task, created: true };
}

async function plannedDue(stage: string, calendar: Calendar, explicit?: Date | null) {
  if (explicit !== undefined) return { dueAt: explicit, slaMinutes: explicit ? 0 : 0 };
  const slaMinutes = await minutesFor(stage, calendar);
  return { dueAt: addBusinessMinutes(new Date(), slaMinutes, calendar), slaMinutes };
}

async function refreshMaster(tenderId: string, actor?: Actor) {
  const tender = await prisma.tender.findUnique({ where: { id: tenderId }, include: { fields: true, emd: true } });
  if (!tender) return;
  const calendar = await getCalendar();
  const fieldValue = (key: string) => valueOf(tender.fields.find((field) => field.fieldKey === key));
  const nextDeadline = parseDateTime(fieldValue("bid_submission_end"), calendar.timeZone);
  const previous = tender.bidSubmissionEnd?.getTime() ?? null;
  const next = nextDeadline?.getTime() ?? null;
  const exemption = fieldValue("emd_exemption");
  const emdFromRecord = tender.emd?.completedAt ? parseInr(tender.emd.amount) : null;
  const emdExposure = emdFromRecord != null ? emdFromRecord : exemption === "Yes" ? 0 : parseInr(fieldValue("emd_fee"));
  await prisma.tender.update({
    where: { id: tenderId },
    data: {
      projectName: fieldValue("project_name") || tender.projectName,
      tenderRef: fieldValue("tender_ref"),
      externalTenderId: fieldValue("tender_id") || tender.externalTenderId,
      clientName: fieldValue("client_name") || tender.clientName,
      location: fieldValue("location"),
      bidSubmissionEnd: nextDeadline,
      bidOpeningAt: parseDateTime(fieldValue("bid_opening"), calendar.timeZone),
      estimatedValue: parseInr(fieldValue("estimated_cost")),
      emdExposure,
      emdType: tender.relevanceStatus === "APPROVED" ? tender.emdType : classifyEmd(tender.fields),
    },
  });
  if (previous && next && previous !== next) {
    const detail = `${formatWhen(new Date(previous), calendar.timeZone)} → ${formatWhen(nextDeadline, calendar.timeZone)}`;
    await prisma.workflowTask.updateMany({
      where: { tenderId, stage: "BID_SUBMISSION", status: { in: OPEN_TASK } },
      data: { dueAt: nextDeadline },
    });
    const watchers = await prisma.user.findMany({
      where: { active: true, role: { in: ["COORDINATOR", "REVIEWER", "BID_SUBMITTER", "ADMIN"] } },
    });
    await notifyAddresses({
      tenderId,
      event: "TENDER_AMENDMENT",
      addresses: watchers.map((user) => ({ email: user.email, name: user.name })),
      extra: { detail, dueAt: formatWhen(nextDeadline, calendar.timeZone) },
    });
    if (actor) {
      await audit(prisma, { tenderId, actor, action: "Deadline changed", entity: "Tender", detail });
    }
  }
}

export async function applyExtraction(tenderId: string, pages: PageText[], actor: Actor, ocrHits?: Record<string, FieldHit>) {
  const hits = overlayHits(extractFields(pages), ocrHits);
  const fields = await prisma.tenderField.findMany({ where: { tenderId } });
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  for (const field of fields) {
    const hit = hits[field.fieldKey];
    if (!hit || hit.status === "MISSING") continue;
    if (field.correctedAt) {
      const current = effectiveValue(field);
      const differs = Boolean(hit.value && current && current.trim().toLowerCase() !== hit.value.trim().toLowerCase());
      writes.push(
        prisma.tenderField.update({
          where: { id: field.id },
          data: differs
            ? {
                validationStatus: "CONFLICT",
                conflictNote: `Corrected value differs from a later document: ${hit.value} (page ${hit.page})`,
              }
            : {
                extractedValue: hit.value,
                confidence: hit.confidence,
                sourceDocumentId: hit.documentId,
                sourcePage: hit.page,
              },
        }),
      );
      continue;
    }
    if (field.extractedValue && field.extractedValue.trim().toLowerCase() !== hit.value.trim().toLowerCase()) {
      writes.push(
        prisma.tenderField.update({
          where: { id: field.id },
          data: {
            validationStatus: "CONFLICT",
            conflictNote: `${field.extractedValue} | ${hit.value} (page ${hit.page})`,
            sourcePage: [field.sourcePage, hit.page].filter(Boolean).join(", "),
          },
        }),
      );
      continue;
    }
    writes.push(
      prisma.tenderField.update({
        where: { id: field.id },
        data: {
          extractedValue: hit.value,
          confidence: hit.confidence,
          sourceDocumentId: hit.documentId,
          sourcePage: hit.page,
          validationStatus: hit.status,
          conflictNote: hit.conflictNote,
        },
      }),
    );
  }
  if (writes.length) await prisma.$transaction(writes);
  await refreshMaster(tenderId, actor);
  const fromOcr = Object.values(ocrHits ?? {}).filter((hit) => hit.value).length;
  await audit(prisma, {
    tenderId,
    actor,
    action: "Extracted tender fields",
    entity: "TenderField",
    detail: fromOcr
      ? `Unfyd OCR filled ${fromOcr} field${fromOcr === 1 ? "" : "s"} from the uploaded file.`
      : `${pages.length} page extract${pages.length === 1 ? "" : "s"} applied.`,
  });
}

async function rememberManual(tenderId: string, key: string, value: string, actor: Actor) {
  if (!value.trim()) return;
  await prisma.tenderField.update({
    where: { tenderId_fieldKey: { tenderId, fieldKey: key } },
    data: {
      correctedValue: value.trim(),
      correctedAt: new Date(),
      correctedById: actor.id,
      validationStatus: "VALIDATED",
    },
  });
}

async function notifyTasks(tenderId: string, tasks: WorkflowTask[], calendar: Calendar, event = "TASK_ASSIGNED") {
  for (const task of tasks) {
    await notifyAddresses({
      tenderId,
      taskId: task.id,
      event,
      addresses: await emailsFor(parseIds(task.assigneeIds)),
      extra: {
        taskTitle: task.title,
        dueAt: formatWhen(task.dueAt, calendar.timeZone),
        detail: task.comments,
      },
    });
  }
}

export async function createTender(
  actor: Actor,
  input: {
    projectName: string;
    clientName: string;
    portalName: string;
    tenderRef: string;
    externalTenderId: string;
    source: "MANUAL" | "CRAWLER";
    files: { name: string; type: string; buffer: Buffer }[];
  },
) {
  if (input.source === "MANUAL" && !CREATOR_ROLES.includes(actor.role)) {
    throw new WorkflowError("Your role cannot register tenders. Ask the Tender Coordinator to upload it.");
  }
  if (input.source === "MANUAL" && !input.files.length) {
    throw new WorkflowError("Upload at least one tender document.");
  }
  for (const file of input.files) {
    if (file.buffer.length > 20 * 1024 * 1024) throw new WorkflowError(`${file.name} is larger than 20 MB.`);
    if (!allowedUpload(file.name, file.type)) throw new WorkflowError(`${file.name} must be a PDF, text file, or image.`);
  }

  const prepared: {
    file: (typeof input.files)[number];
    hash: string;
    extracted: Awaited<ReturnType<typeof pagesFromBuffer>>;
    storedPath: string;
    ocrHits: Record<string, FieldHit>;
    ocrNote: string;
  }[] = [];
  for (const file of input.files) {
    prepared.push({
      file,
      hash: sha256(file.buffer),
      extracted: await pagesFromBuffer(file.buffer, file.type, file.name),
      storedPath: "",
      ocrHits: {},
      ocrNote: "",
    });
  }
  const hashes = prepared.map((item) => item.hash);
  const hashDup = hashes.length
    ? await prisma.tenderDocument.findFirst({ where: { sha256: { in: hashes } }, include: { tender: true } })
    : null;
  if (hashDup && !CLOSED_OVERALL.includes(hashDup.tender.overallStatus)) {
    return { duplicate: true as const, tenderId: hashDup.tenderId, recordId: hashDup.tender.recordId };
  }

  for (const item of prepared) {
    item.storedPath = await storeFile("incoming", item.file.name, item.file.buffer);
    try {
      const remote = await extractUploadedFile(item.storedPath, item.file.name);
      item.ocrHits = remote.hits;
      item.ocrNote = remote.note;
    } catch (error) {
      console.error(error);
      item.ocrNote = "The extraction service did not return fields.";
    }
  }
  const preview = overlayHits(
    extractFields(prepared.flatMap((item) => item.extracted.pages.map((text, index) => ({ documentId: "preview", page: index + 1, text })))),
    Object.assign({}, ...prepared.map((item) => item.ocrHits)),
  );
  const readable = (key: string) => {
    const hit = preview[key];
    if (!hit || hit.status === "MISSING" || hit.status === "CONFLICT") return "";
    return hit.value;
  };
  const openTenders = await prisma.tender.findMany({
    where: { overallStatus: { notIn: CLOSED_OVERALL } },
    select: { id: true, recordId: true, tenderRef: true, externalTenderId: true, clientName: true, portalName: true },
  });
  const norm = (value: string) => value.trim().toLowerCase();
  const ref = norm(input.tenderRef || readable("tender_ref"));
  const ext = norm(input.externalTenderId || readable("tender_id"));
  const client = norm(input.clientName || readable("client_name"));
  const portal = norm(input.portalName);
  const logicalDup = openTenders.find((tender) => {
    if (ext && norm(tender.externalTenderId) === ext) return true;
    if (ref && portal && norm(tender.tenderRef) === ref && norm(tender.portalName) === portal) return true;
    if (ref && client && norm(tender.tenderRef) === ref && norm(tender.clientName) === client) return true;
    return false;
  });
  if (logicalDup) {
    await Promise.all(prepared.map((item) => (item.storedPath ? unlink(item.storedPath).catch(() => undefined) : undefined)));
    return { duplicate: true as const, tenderId: logicalDup.id, recordId: logicalDup.recordId };
  }

  const settings = await prisma.appSettings.update({
    where: { id: "default" },
    data: { nextSequence: { increment: 1 } },
  });
  const year = new Intl.DateTimeFormat("en", { timeZone: "Asia/Kolkata", year: "numeric" }).format(new Date());
  const recordId = `${settings.recordPrefix}-${year}-${String(settings.nextSequence).padStart(4, "0")}`;
  const tender = await prisma.tender.create({
    data: {
      recordId,
      projectName: input.projectName.trim(),
      clientName: input.clientName.trim(),
      portalName: input.portalName.trim(),
      tenderRef: input.tenderRef.trim(),
      externalTenderId: input.externalTenderId.trim(),
      source: input.source,
      overallStatus: "OCR_PROCESSING",
      ocrStatus: "PROCESSING",
      createdById: actor.id,
      duplicateOfId: hashDup?.tenderId,
      duplicateWarning: hashDup ? `The same file exists on closed tender ${hashDup.tender.recordId}.` : "",
      fields: {
        create: TENDER_FIELDS.map((field) => ({
          fieldNo: field.no,
          fieldKey: field.key,
          label: field.label,
          critical: Boolean(field.critical),
        })),
      },
    },
  });

  await rememberManual(tender.id, "project_name", input.projectName, actor);
  await rememberManual(tender.id, "client_name", input.clientName, actor);
  await rememberManual(tender.id, "tender_ref", input.tenderRef, actor);
  await rememberManual(tender.id, "tender_id", input.externalTenderId, actor);

  const pages: PageText[] = [];
  const ocrHits: Record<string, FieldHit> = {};
  let anyText = false;
  let ocrNotes: string[] = [];
  for (const item of prepared) {
    if (!item.extracted.failed) anyText = true;
    if (item.ocrNote) ocrNotes.push(item.ocrNote);
    const document = await prisma.tenderDocument.create({
      data: {
        tenderId: tender.id,
        fileName: item.file.name,
        storedPath: item.storedPath,
        mimeType: item.file.type || "application/octet-stream",
        sizeBytes: item.file.buffer.length,
        sha256: item.hash,
        docType: "NOTICE",
        version: 1,
        uploadedById: actor.id,
        textExtract: item.extracted.pages.join("\n\f").slice(0, 150000),
        pageCount: item.extracted.pages.length,
      },
    });
    for (const [key, hit] of Object.entries(item.ocrHits)) {
      if (!hit.value) continue;
      const next = { ...hit, documentId: document.id };
      const existing = ocrHits[key];
      if (existing?.value && existing.value.trim().toLowerCase() !== next.value.trim().toLowerCase()) {
        ocrHits[key] = {
          ...next,
          status: "CONFLICT",
          confidence: Math.min(existing.confidence, next.confidence),
          conflictNote: `${existing.value} | ${next.value}`,
        };
      } else {
        ocrHits[key] = next;
      }
    }
    item.extracted.pages.forEach((text, index) => pages.push({ documentId: document.id, page: index + 1, text }));
  }

  const ocrFilled = Object.values(ocrHits).some((hit) => hit.value);
  let ocrFailed = !input.files.length || (!anyText && !ocrFilled);
  try {
    if (pages.length || ocrFilled) await applyExtraction(tender.id, pages, actor, ocrHits);
  } catch (error) {
    console.error(error);
    ocrFailed = true;
  }
  await refreshMaster(tender.id, actor);

  const calendar = await getCalendar();
  const coordinator = await prisma.user.findFirst({ where: { personKey: "coordinator", active: true } });
  const vishesh = await prisma.user.findFirst({ where: { personKey: "vishesh", active: true } });
  const validationOwners =
    input.source === "CRAWLER"
      ? [vishesh?.id].filter((id): id is string => Boolean(id))
      : [...new Set([actor.id, coordinator?.id].filter((id): id is string => Boolean(id)))];
  if (!validationOwners.length) throw new WorkflowError("No reviewer is available to validate this tender.");

  const validationPlan = await plannedDue("DATA_VALIDATION", calendar);
  const exceptionPlan = await plannedDue("OCR_EXCEPTION", calendar);
  const created = await prisma.$transaction(async (tx) => {
    await tx.tender.update({
      where: { id: tender.id },
      data: { overallStatus: "DATA_VALIDATION_REQUIRED", ocrStatus: ocrFailed ? "FAILED" : "COMPLETED" },
    });
    const tasks: WorkflowTask[] = [];
    const validation = await createTask(tx, {
      tenderId: tender.id,
      branch: "MAIN",
      stage: "DATA_VALIDATION",
      title: "Review extracted tender data",
      assigneeIds: validationOwners,
      ...validationPlan,
    });
    if (validation.created) tasks.push(validation.task);
    if (ocrFailed) {
      const admins = await tx.user.findMany({ where: { role: "ADMIN", active: true } });
      const exception = await createTask(tx, {
        tenderId: tender.id,
        branch: "EXCEPTION",
        stage: "OCR_EXCEPTION",
        title: "Resolve document extraction failure",
        assigneeIds: [...admins.map((user) => user.id), coordinator?.id, input.source === "CRAWLER" ? vishesh?.id : undefined].filter(
          (id): id is string => Boolean(id),
        ),
        ...exceptionPlan,
      });
      if (exception.created) tasks.push(exception.task);
    }
    await audit(tx, {
      tenderId: tender.id,
      actor,
      action: "Created tender",
      entity: "Tender",
      detail: [`${recordId} from ${input.source === "CRAWLER" ? "discovered portal intake" : "manual upload"}.`, ...ocrNotes].filter(Boolean).join(" "),
    });
    return tasks;
  });

  await notifyTasks(tender.id, created.filter((task) => task.stage === "DATA_VALIDATION"), calendar);
  const exceptions = created.filter((task) => task.stage === "OCR_EXCEPTION");
  if (exceptions.length) {
    await notifyTasks(tender.id, exceptions, calendar, "OCR_FAILED");
  }
  return { duplicate: false as const, tenderId: tender.id, recordId };
}

function canEdit(actor: Actor) {
  return EDITOR_ROLES.includes(actor.role);
}

/** Editors, or whoever holds an open validation or extraction-exception task on this tender (usually the uploader). */
export async function canEditFields(actor: Actor, tenderId: string) {
  if (canEdit(actor)) return true;
  const task = await prisma.workflowTask.findFirst({
    where: {
      tenderId,
      stage: { in: ["DATA_VALIDATION", "OCR_EXCEPTION"] },
      status: { in: OPEN_TASK },
      assigneeIds: { contains: `"${actor.id}"` },
    },
  });
  return Boolean(task);
}

export async function updateFields(actor: Actor, tenderId: string, values: Record<string, string>) {
  const tender = await prisma.tender.findUnique({ where: { id: tenderId }, include: { fields: true } });
  if (!tender) throw new WorkflowError("Tender not found.");
  if (CLOSED_OVERALL.includes(tender.overallStatus)) throw new WorkflowError("Closed tenders keep their recorded fields.");
  if (!(await canEditFields(actor, tenderId))) throw new WorkflowError("Only the Tender Coordinator, a reviewer, or the person validating this tender can correct its fields.");
  const changes: string[] = [];
  for (const field of tender.fields) {
    if (!(field.fieldKey in values)) continue;
    const next = values[field.fieldKey].trim();
    const previous = effectiveValue(field);
    if (next === previous) continue;
    const status = next === NOT_FOUND ? "NOT_FOUND" : next ? "VALIDATED" : "MISSING";
    await prisma.tenderField.update({
      where: { id: field.id },
      data: {
        correctedValue: next,
        correctedAt: new Date(),
        correctedById: actor.id,
        validationStatus: status,
        conflictNote: "",
      },
    });
    changes.push(`${field.label}: ${previous || "empty"} → ${next || "empty"}`);
  }
  if (changes.length) {
    await audit(prisma, {
      tenderId,
      actor,
      action: "Corrected tender fields",
      entity: "TenderField",
      detail: changes.join("\n"),
    });
  }
  await refreshMaster(tenderId, actor);
  if (tender.relevanceStatus === "APPROVED") await evaluateReadiness(tenderId);
  const calendar = await getCalendar();
  const warnings: string[] = [];
  for (const key of ["bid_submission_end", "bid_opening", "prebid_conference", "hardcopy_submission"]) {
    const value = (values[key] ?? "").trim();
    if (value && value !== NOT_FOUND && !parseDateTime(value, calendar.timeZone)) {
      const label = TENDER_FIELDS.find((field) => field.key === key)?.label ?? key;
      warnings.push(`${label} "${value}" is not a date and time the system can read. Use DD/MM/YYYY HH:MM.`);
    }
  }
  return { changed: changes.length, warnings };
}

export async function submitForRelevance(actor: Actor, taskId: string, confirmed: boolean) {
  if (!confirmed) throw new WorkflowError("Confirm that you have reviewed the extracted fields.");
  const task = await prisma.workflowTask.findUnique({ where: { id: taskId }, include: { tender: { include: { fields: true } } } });
  if (!task || task.stage !== "DATA_VALIDATION") throw new WorkflowError("Validation task not found.");
  assertOpen(actor, task);
  const conflicts = task.tender.fields.filter((field) => field.validationStatus === "CONFLICT");
  if (conflicts.length) {
    throw new WorkflowError(`Resolve conflicting values before relevance review: ${conflicts.map((field) => field.label).join(", ")}.`);
  }
  const current = (key: string) => valueOf(task.tender.fields.find((field) => field.fieldKey === key));
  if (!current("project_name")) throw new WorkflowError("Name of the Project is required before relevance review.");
  if (!current("client_name")) throw new WorkflowError("Client name is required before relevance review.");
  if (!current("bid_submission_end") || !task.tender.bidSubmissionEnd) {
    throw new WorkflowError("Bid submission end date needs a confirmed date and time. A date alone is not enough.");
  }
  if (!current("tender_ref") && !current("tender_id")) {
    throw new WorkflowError("Enter a tender reference number or a tender ID before relevance review.");
  }

  const calendar = await getCalendar();
  const plan = await plannedDue("RELEVANCE", calendar);
  const vishesh = await mustUser("vishesh");
  const ranjana = await mustUser("ranjana");
  const reviewers = task.tender.source === "CRAWLER" ? [vishesh.id] : [vishesh.id, ranjana.id];
  const relevance = await prisma.$transaction(async (tx) => {
    const closed = await tx.workflowTask.updateMany({
      where: { id: task.id, status: { in: OPEN_TASK } },
      data: { status: "COMPLETED", completedAt: new Date(), completedById: actor.id, decision: "SUBMITTED", comments: "Extraction reviewed." },
    });
    if (closed.count !== 1) throw new WorkflowError("Validation was already submitted.");
    for (const field of task.tender.fields) {
      if (field.validationStatus === "CONFLICT") continue;
      const value = effectiveValue(field).trim();
      const confirmedValue = value || NOT_FOUND;
      await tx.tenderField.update({
        where: { id: field.id },
        data: {
          correctedValue: confirmedValue,
          correctedAt: field.correctedAt ?? new Date(),
          correctedById: field.correctedById || actor.id,
          validationStatus: confirmedValue === NOT_FOUND ? "NOT_FOUND" : "VALIDATED",
        },
      });
    }
    await tx.tender.update({
      where: { id: task.tenderId },
      data: { overallStatus: "PENDING_RELEVANCE", relevanceStatus: "PENDING" },
    });
    const created = await createTask(tx, {
      tenderId: task.tenderId,
      branch: "MAIN",
      stage: "RELEVANCE",
      title: "Relevance review",
      assigneeIds: reviewers,
      ...plan,
    });
    await audit(tx, { tenderId: task.tenderId, actor, action: "Submitted for relevance review", entity: "WorkflowTask" });
    return created.created ? created.task : null;
  });
  if (relevance) await notifyTasks(task.tenderId, [relevance], calendar);
}

export async function decideRelevance(actor: Actor, taskId: string, decision: "APPROVED" | "REJECTED", comments: string) {
  const task = await prisma.workflowTask.findUnique({ where: { id: taskId }, include: { tender: { include: { fields: true } } } });
  if (!task || task.stage !== "RELEVANCE") throw new WorkflowError("Relevance task not found.");
  assertOpen(actor, task);
  if (decision === "REJECTED" && comments.trim().length < 3) throw new WorkflowError("Rejection comments are required.");
  const calendar = await getCalendar();
  if (decision === "REJECTED") {
    await prisma.$transaction(async (tx) => {
      const closed = await tx.workflowTask.updateMany({
        where: { id: task.id, status: { in: OPEN_TASK } },
        data: { status: "COMPLETED", decision: "REJECTED", comments: comments.trim(), completedById: actor.id, completedAt: new Date() },
      });
      if (closed.count !== 1) throw new WorkflowError("This relevance review was already decided.");
      await tx.tender.update({
        where: { id: task.tenderId },
        data: {
          relevanceStatus: "REJECTED",
          overallStatus: "REJECTED_CLOSED",
          relevanceOverdue: false,
          closedAt: new Date(),
          closureReason: comments.trim(),
        },
      });
      await tx.workflowTask.updateMany({
        where: { tenderId: task.tenderId, status: { in: OPEN_TASK } },
        data: { status: "CANCELLED" },
      });
      await tx.approvalRecord.create({
        data: { tenderId: task.tenderId, taskId: task.id, stage: "RELEVANCE", decision: "REJECTED", approverId: actor.id, comments: comments.trim() },
      });
      await audit(tx, { tenderId: task.tenderId, actor, action: "Rejected tender", entity: "Approval", detail: comments.trim() });
    });
    await notifyAddresses({
      tenderId: task.tenderId,
      taskId: task.id,
      event: "RELEVANCE_DECISION",
      addresses: await emailsFor([...parseIds(task.assigneeIds), task.tender.createdById]),
      extra: { decision: "Rejected", comments: comments.trim() },
    });
    return;
  }

  const kind = classifyEmd(task.tender.fields);
  const plan = EMD_PLAN[kind];
  const owners = await Promise.all(plan.owners.map((key) => mustUser(key)));
  const ranjana = await mustUser("ranjana");
  const sundar = await mustUser("sundarlingam");
  const sales = await prisma.user.findMany({ where: { role: "SALES", active: true } });
  const heads = await prisma.user.findMany({ where: { role: "DEPT_HEAD", active: true } });
  if (!sales.length) throw new WorkflowError("Add an active Sales user before approving tenders.");
  if (!heads.length) throw new WorkflowError("Add an active Department Head before approving tenders.");
  const draft = await plannedDue("DRAFT_COSTING", calendar);
  const emd = await plannedDue(plan.stage, calendar);
  const tasks = await prisma.$transaction(async (tx) => {
    const closed = await tx.workflowTask.updateMany({
      where: { id: task.id, status: { in: OPEN_TASK } },
      data: { status: "COMPLETED", decision: "APPROVED", comments: comments.trim(), completedById: actor.id, completedAt: new Date() },
    });
    if (closed.count !== 1) throw new WorkflowError("This relevance review was already decided.");
    await tx.tender.update({
      where: { id: task.tenderId },
      data: {
        relevanceStatus: "APPROVED",
        overallStatus: "APPROVED_IN_PROGRESS",
        relevanceOverdue: false,
        costingStatus: "DRAFT_IN_PROGRESS",
        emdStatus: plan.emdStatus,
        emdType: kind,
      },
    });
    await tx.emdRecord.upsert({
      where: { tenderId: task.tenderId },
      create: { tenderId: task.tenderId, instrumentType: kind, preparationStatus: "NOT_STARTED" },
      update: { instrumentType: kind },
    });
    await tx.approvalRecord.create({
      data: { tenderId: task.tenderId, taskId: task.id, stage: "RELEVANCE", decision: "APPROVED", approverId: actor.id, comments: comments.trim() },
    });
    const created: WorkflowTask[] = [];
    const costing = await createTask(tx, {
      tenderId: task.tenderId,
      branch: "COSTING",
      stage: "DRAFT_COSTING",
      title: "Draft costing",
      assigneeIds: [ranjana.id, sundar.id],
      ...draft,
    });
    const instrument = await createTask(tx, {
      tenderId: task.tenderId,
      branch: "EMD",
      stage: plan.stage,
      title: plan.title,
      assigneeIds: owners.map((owner) => owner.id),
      ...emd,
    });
    if (costing.created) created.push(costing.task);
    if (instrument.created) created.push(instrument.task);
    await audit(tx, {
      tenderId: task.tenderId,
      actor,
      action: "Approved tender",
      entity: "Approval",
      detail: `Costing and EMD started. EMD route: ${plan.title}.`,
    });
    return created;
  });
  await notifyAddresses({
    tenderId: task.tenderId,
    taskId: task.id,
    event: "RELEVANCE_DECISION",
    addresses: await emailsFor([...parseIds(task.assigneeIds), task.tender.createdById]),
    extra: { decision: "Approved", comments: comments.trim() },
  });
  await notifyTasks(task.tenderId, tasks, calendar);
}

const COSTING_DOC: Record<string, string> = {
  DRAFT_COSTING: "COSTING_DRAFT",
  SALES_INPUT: "COSTING_SALES",
  FINAL_COSTING: "COSTING_FINAL",
};

export async function completeCosting(
  actor: Actor,
  taskId: string,
  input: { intent: "complete" | "return"; notes: string; amount: string; file?: { name: string; type: string; buffer: Buffer } },
) {
  const task = await prisma.workflowTask.findUnique({ where: { id: taskId } });
  if (!task || !COSTING_DOC[task.stage]) throw new WorkflowError("Costing task not found.");
  assertOpen(actor, task);
  if (input.notes.trim().length < 3) throw new WorkflowError("Record the costing assumptions or the reason for return.");
  const calendar = await getCalendar();
  if (input.intent === "return") {
    const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
    const plan = settings?.revisionResetsSla === false ? { dueAt: task.dueAt, slaMinutes: task.slaMinutes } : await plannedDue(task.stage, calendar);
    const returned = await prisma.workflowTask.updateMany({
      where: { id: task.id, status: { in: OPEN_TASK } },
      data: {
        status: "RETURNED_FOR_REVISION",
        comments: input.notes.trim(),
        dueAt: plan.dueAt,
        baseAt: new Date(),
        slaMinutes: plan.slaMinutes,
        reminder50Sent: false,
        reminder75Sent: false,
        breachSent: false,
        breachLevel2Sent: false,
      },
    });
    if (returned.count !== 1) throw new WorkflowError("This costing task was already completed.");
    await prisma.tender.update({ where: { id: task.tenderId }, data: { costingStatus: "RETURNED" } });
    await audit(prisma, { tenderId: task.tenderId, actor, action: "Returned costing for revision", entity: "WorkflowTask", detail: input.notes.trim() });
    return;
  }
  if (!input.file) throw new WorkflowError("Attach the costing sheet before completing this task.");
  if (!allowedUpload(input.file.name, input.file.type)) throw new WorkflowError("The costing sheet must be a PDF, text file, or image.");
  const amount = parseInr(input.amount);
  if (task.stage === "FINAL_COSTING" && amount == null) throw new WorkflowError("Enter the final costing amount as a number, without crore or lakh wording.");
  const storedPath = await storeFile(task.tenderId, input.file.name, input.file.buffer);
  const version = (await prisma.costingRecord.count({ where: { tenderId: task.tenderId } })) + 1;
  const nextStage =
    task.stage === "DRAFT_COSTING"
      ? { stage: "SALES_INPUT", title: "Sales costing input", status: "SALES_PENDING", owners: (await prisma.user.findMany({ where: { role: "SALES", active: true } })).map((user) => user.id) }
      : task.stage === "SALES_INPUT"
        ? { stage: "FINAL_COSTING", title: "Final costing", status: "FINAL_IN_PROGRESS", owners: [(await mustUser("vishesh")).id] }
        : { stage: "DEPT_APPROVAL", title: "Department head approval", status: "PENDING_DEPT", owners: (await prisma.user.findMany({ where: { role: "DEPT_HEAD", active: true } })).map((user) => user.id) };
  const plan = await plannedDue(nextStage.stage, calendar);
  const created = await prisma.$transaction(async (tx) => {
    const document = await tx.tenderDocument.create({
      data: {
        tenderId: task.tenderId,
        fileName: input.file!.name,
        storedPath,
        mimeType: input.file!.type || "application/octet-stream",
        sizeBytes: input.file!.buffer.length,
        sha256: sha256(input.file!.buffer),
        docType: COSTING_DOC[task.stage],
        uploadedById: actor.id,
      },
    });
    await tx.costingRecord.create({
      data: {
        tenderId: task.tenderId,
        version,
        stage: task.stage,
        assumptions: input.notes.trim(),
        amount,
        documentId: document.id,
        createdById: actor.id,
      },
    });
    const closed = await tx.workflowTask.updateMany({
      where: { id: task.id, status: { in: OPEN_TASK } },
      data: { status: "COMPLETED", decision: "COMPLETED", comments: input.notes.trim(), completedById: actor.id, completedAt: new Date() },
    });
    if (closed.count !== 1) throw new WorkflowError("This costing task was already completed.");
    await tx.tender.update({
      where: { id: task.tenderId },
      data: {
        costingStatus: nextStage.status,
        approvalStatus: task.stage === "FINAL_COSTING" ? "PENDING" : undefined,
        finalCostingValue: task.stage === "FINAL_COSTING" ? amount : undefined,
      },
    });
    const follow = await createTask(tx, {
      tenderId: task.tenderId,
      branch: "COSTING",
      stage: nextStage.stage,
      title: nextStage.title,
      assigneeIds: nextStage.owners,
      ...plan,
    });
    await audit(tx, { tenderId: task.tenderId, actor, action: `Completed ${task.title}`, entity: "CostingRecord", detail: input.notes.trim() });
    return follow.created ? follow.task : null;
  });
  if (created) await notifyTasks(task.tenderId, [created], calendar);
  await notifyAddresses({
    tenderId: task.tenderId,
    taskId: task.id,
    event: "TASK_COMPLETED",
    addresses: await emailsFor([actor.id]),
    extra: { taskTitle: task.title, detail: input.notes.trim() },
  });
}

export async function decideDepartment(
  actor: Actor,
  taskId: string,
  decision: "APPROVED" | "REJECTED" | "RETURNED",
  comments: string,
  returnStage = "FINAL_COSTING",
) {
  const task = await prisma.workflowTask.findUnique({ where: { id: taskId } });
  if (!task || task.stage !== "DEPT_APPROVAL") throw new WorkflowError("Department approval task not found.");
  assertOpen(actor, task);
  if (decision !== "APPROVED" && comments.trim().length < 3) throw new WorkflowError("Comments are required when costing is rejected or returned.");
  const calendar = await getCalendar();
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  if (decision === "APPROVED") {
    await prisma.$transaction(async (tx) => {
      const closed = await tx.workflowTask.updateMany({
        where: { id: task.id, status: { in: OPEN_TASK } },
        data: { status: "COMPLETED", decision: "APPROVED", comments: comments.trim(), completedById: actor.id, completedAt: new Date() },
      });
      if (closed.count !== 1) throw new WorkflowError("This approval was already decided.");
      const latest = await tx.costingRecord.findFirst({ where: { tenderId: task.tenderId, stage: "FINAL_COSTING" }, orderBy: { version: "desc" } });
      await tx.tender.update({
        where: { id: task.tenderId },
        data: { costingStatus: "APPROVED", approvalStatus: "APPROVED", finalCostingValue: latest?.amount ?? undefined },
      });
      await tx.approvalRecord.create({
        data: { tenderId: task.tenderId, taskId: task.id, stage: "DEPT_APPROVAL", decision: "APPROVED", approverId: actor.id, comments: comments.trim() },
      });
      await audit(tx, { tenderId: task.tenderId, actor, action: "Approved final costing", entity: "Approval", detail: comments.trim() });
    });
    await evaluateReadiness(task.tenderId);
  } else if (decision === "REJECTED") {
    const vishesh = await mustUser("vishesh");
    const coordinator = await mustUser("coordinator");
    const plan = await plannedDue("BUSINESS_DECISION", calendar);
    const follow = await prisma.$transaction(async (tx) => {
      const closed = await tx.workflowTask.updateMany({
        where: { id: task.id, status: { in: OPEN_TASK } },
        data: { status: "REJECTED", decision: "REJECTED", comments: comments.trim(), completedById: actor.id, completedAt: new Date() },
      });
      if (closed.count !== 1) throw new WorkflowError("This approval was already decided.");
      await tx.tender.update({
        where: { id: task.tenderId },
        data: { costingStatus: "REJECTED", approvalStatus: "REJECTED", finalCostingValue: null },
      });
      await tx.approvalRecord.create({
        data: { tenderId: task.tenderId, taskId: task.id, stage: "DEPT_APPROVAL", decision: "REJECTED", approverId: actor.id, comments: comments.trim() },
      });
      const business = await createTask(tx, {
        tenderId: task.tenderId,
        branch: "COSTING",
        stage: "BUSINESS_DECISION",
        title: "Business decision after costing rejection",
        assigneeIds: [vishesh.id, coordinator.id],
        ...plan,
      });
      await audit(tx, { tenderId: task.tenderId, actor, action: "Rejected final costing", entity: "Approval", detail: comments.trim() });
      return business.created ? business.task : null;
    });
    if (follow) await notifyTasks(task.tenderId, [follow], calendar);
  } else {
    const stage = ["DRAFT_COSTING", "SALES_INPUT", "FINAL_COSTING"].includes(returnStage) ? returnStage : "FINAL_COSTING";
    const owners =
      stage === "DRAFT_COSTING"
        ? [(await mustUser("ranjana")).id, (await mustUser("sundarlingam")).id]
        : stage === "SALES_INPUT"
          ? (await prisma.user.findMany({ where: { role: "SALES", active: true } })).map((user) => user.id)
          : [(await mustUser("vishesh")).id];
    const plan = settings?.revisionResetsSla === false && stage === "FINAL_COSTING"
      ? { dueAt: task.dueAt, slaMinutes: task.slaMinutes }
      : await plannedDue(stage, calendar);
    const title = stage === "DRAFT_COSTING" ? "Draft costing" : stage === "SALES_INPUT" ? "Sales costing input" : "Final costing";
    const follow = await prisma.$transaction(async (tx) => {
      const closed = await tx.workflowTask.updateMany({
        where: { id: task.id, status: { in: OPEN_TASK } },
        data: { status: "COMPLETED", decision: "RETURNED", comments: comments.trim(), completedById: actor.id, completedAt: new Date() },
      });
      if (closed.count !== 1) throw new WorkflowError("This approval was already decided.");
      await tx.tender.update({
        where: { id: task.tenderId },
        data: { costingStatus: "RETURNED", approvalStatus: "RETURNED", finalCostingValue: null },
      });
      await tx.approvalRecord.create({
        data: { tenderId: task.tenderId, taskId: task.id, stage: "DEPT_APPROVAL", decision: "RETURNED", approverId: actor.id, comments: comments.trim() },
      });
      const next = await createTask(tx, {
        tenderId: task.tenderId,
        branch: "COSTING",
        stage,
        title,
        assigneeIds: owners,
        ...plan,
      });
      await audit(tx, { tenderId: task.tenderId, actor, action: "Returned costing for revision", entity: "Approval", detail: `${title}. ${comments.trim()}` });
      return next.created ? next.task : null;
    });
    if (follow) await notifyTasks(task.tenderId, [follow], calendar);
  }
  await notifyAddresses({
    tenderId: task.tenderId,
    taskId: task.id,
    event: "APPROVAL_DECISION",
    addresses: await emailsFor([actor.id, (await prisma.tender.findUnique({ where: { id: task.tenderId } }))?.createdById || ""]),
    extra: { decision: decision === "RETURNED" ? "Returned for revision" : decision === "APPROVED" ? "Approved" : "Rejected", comments: comments.trim() },
  });
}

export async function saveEmdProgress(
  actor: Actor,
  taskId: string,
  input: {
    intent: "save" | "complete";
    amount: string;
    beneficiary: string;
    referenceNumber: string;
    exemptionBasis: string;
    notes: string;
    authorityNote: string;
    submittedToAuthority: boolean;
    preparationStatus: string;
    file?: { name: string; type: string; buffer: Buffer };
  },
) {
  const task = await prisma.workflowTask.findUnique({ where: { id: taskId }, include: { tender: { include: { emd: true } } } });
  if (!task || task.branch !== "EMD" || task.stage === "EMD_CLARIFICATION") throw new WorkflowError("EMD task not found.");
  assertOpen(actor, task);
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  let documentId = task.tender.emd?.documentId || "";
  if (input.file) {
    if (!allowedUpload(input.file.name, input.file.type)) throw new WorkflowError("Evidence must be a PDF, text file, or image.");
    const storedPath = await storeFile(task.tenderId, input.file.name, input.file.buffer);
    const document = await prisma.tenderDocument.create({
      data: {
        tenderId: task.tenderId,
        fileName: input.file.name,
        storedPath,
        mimeType: input.file.type || "application/octet-stream",
        sizeBytes: input.file.buffer.length,
        sha256: sha256(input.file.buffer),
        docType: "EMD_EVIDENCE",
        uploadedById: actor.id,
      },
    });
    documentId = document.id;
  }
  if (input.intent === "complete") {
    if (input.preparationStatus !== "Verified") throw new WorkflowError("Mark the instrument verified before completing the EMD task.");
    if (!documentId) throw new WorkflowError("Attach preparation evidence before completing the EMD task.");
    if (task.stage === "EMD_EXEMPTION" && input.exemptionBasis.trim().length < 3) {
      throw new WorkflowError("Record the exemption basis and why it applies to this tender.");
    }
    if (task.stage !== "EMD_EXEMPTION") {
      if (parseInr(input.amount) == null && !input.amount.trim()) throw new WorkflowError("Record the EMD amount shown on the instrument.");
      if (!input.referenceNumber.trim()) throw new WorkflowError("Record the instrument reference number.");
    }
    if (task.stage === "EMD_BG" && !input.beneficiary.trim()) throw new WorkflowError("Record the bank guarantee beneficiary.");
    if (input.submittedToAuthority && input.authorityNote.trim().length < 3) {
      throw new WorkflowError("Describe how the instrument was submitted to the tendering authority.");
    }
  }

  const bothRequired = Boolean(settings?.bgRequiresBoth && task.stage === "EMD_BG" && input.intent === "complete");
  if (bothRequired) {
    const prior = await prisma.taskAction.findFirst({ where: { taskId: task.id, userId: actor.id, action: "COMPLETE" } });
    if (!prior) {
      await prisma.taskAction.create({
        data: { taskId: task.id, userId: actor.id, action: "COMPLETE", comments: input.notes.trim() },
      });
    }
    const actions = await prisma.taskAction.findMany({ where: { taskId: task.id, action: "COMPLETE" } });
    const done = new Set(actions.map((action) => action.userId));
    if (!parseIds(task.assigneeIds).every((id) => done.has(id))) {
      await prisma.emdRecord.update({
        where: { tenderId: task.tenderId },
        data: {
          amount: input.amount.trim(),
          beneficiary: input.beneficiary.trim(),
          referenceNumber: input.referenceNumber.trim(),
          exemptionBasis: input.exemptionBasis.trim(),
          notes: input.notes.trim(),
          preparationStatus: "VERIFICATION_PENDING",
          documentId,
          submittedToAuthority: input.submittedToAuthority,
          authorityNote: input.authorityNote.trim(),
        },
      });
      await prisma.workflowTask.update({ where: { id: task.id }, data: { status: "IN_PROGRESS", comments: input.notes.trim() } });
      await prisma.tender.update({ where: { id: task.tenderId }, data: { emdStatus: "VERIFICATION_PENDING" } });
      await audit(prisma, { tenderId: task.tenderId, actor, action: "Verified part of the bank guarantee", entity: "EmdRecord", detail: "Waiting for the second Accounts owner." });
      return;
    }
  }

  const emdStatus = input.intent === "save"
    ? task.tender.emdStatus === "NOT_STARTED" ? "IN_PROGRESS" : task.tender.emdStatus
    : input.submittedToAuthority
      ? "SUBMITTED_EVIDENCE"
      : "COMPLETED";
  await prisma.emdRecord.update({
    where: { tenderId: task.tenderId },
    data: {
      amount: input.amount.trim(),
      beneficiary: input.beneficiary.trim(),
      referenceNumber: input.referenceNumber.trim(),
      exemptionBasis: input.exemptionBasis.trim(),
      notes: input.notes.trim(),
      preparationStatus: input.intent === "complete" ? "VERIFIED" : input.preparationStatus || "IN_PROGRESS",
      documentId,
      submittedToAuthority: input.submittedToAuthority,
      authorityNote: input.authorityNote.trim(),
      verifiedAt: input.intent === "complete" ? new Date() : undefined,
      completedAt: input.intent === "complete" ? new Date() : undefined,
    },
  });
  if (input.intent === "save") {
    await prisma.workflowTask.updateMany({
      where: { id: task.id, status: { in: OPEN_TASK } },
      data: { status: "IN_PROGRESS", comments: input.notes.trim() },
    });
    await prisma.tender.update({ where: { id: task.tenderId }, data: { emdStatus: emdStatus === "PENDING_BG" || emdStatus === "PENDING_ISB" || emdStatus === "EXEMPTION_VERIFICATION" ? "IN_PROGRESS" : emdStatus } });
    return;
  }
  await prisma.workflowTask.updateMany({
    where: { id: task.id, status: { in: OPEN_TASK } },
    data: { status: "COMPLETED", decision: "COMPLETED", comments: input.notes.trim(), completedById: actor.id, completedAt: new Date() },
  });
  const exposure = parseInr(input.amount);
  await prisma.tender.update({
    where: { id: task.tenderId },
    data: { emdStatus, emdExposure: task.stage === "EMD_EXEMPTION" ? 0 : exposure ?? undefined },
  });
  await audit(prisma, { tenderId: task.tenderId, actor, action: "Completed EMD preparation", entity: "EmdRecord", detail: input.notes.trim() });
  await notifyAddresses({
    tenderId: task.tenderId,
    taskId: task.id,
    event: "EMD_COMPLETED",
    addresses: await emailsFor([actor.id, task.tender.createdById]),
    extra: { decision: emdStatus === "SUBMITTED_EVIDENCE" ? "Submitted / evidence recorded" : "Prepared and verified", detail: input.notes.trim() },
  });
  await evaluateReadiness(task.tenderId);
}

export async function resolveEmdClarification(actor: Actor, taskId: string, choice: string, comments: string) {
  const task = await prisma.workflowTask.findUnique({ where: { id: taskId } });
  if (!task || task.stage !== "EMD_CLARIFICATION") throw new WorkflowError("Clarification task not found.");
  assertOpen(actor, task);
  if (comments.trim().length < 3) throw new WorkflowError("Record why this EMD type was selected.");
  const kind = (["BG", "ISB", "EXEMPTION", "DD", "ONLINE", "OTHER"] as const).find((item) => item === choice);
  if (!kind) throw new WorkflowError("Choose an EMD type. The system will not assume one.");
  const plan = EMD_PLAN[kind];
  const owners = await Promise.all(plan.owners.map((key) => mustUser(key)));
  const calendar = await getCalendar();
  const due = await plannedDue(plan.stage, calendar);
  const formValue =
    kind === "BG" ? "Bank Guarantee" :
    kind === "ISB" ? "ISB / Surety Bond" :
    kind === "EXEMPTION" ? "Exemption" :
    kind === "DD" ? "Demand Draft" :
    kind === "ONLINE" ? "Online Payment" : "Other";
  const follow = await prisma.$transaction(async (tx) => {
    const closed = await tx.workflowTask.updateMany({
      where: { id: task.id, status: { in: OPEN_TASK } },
      data: { status: "COMPLETED", decision: kind, comments: comments.trim(), completedById: actor.id, completedAt: new Date() },
    });
    if (closed.count !== 1) throw new WorkflowError("This clarification was already resolved.");
    await tx.tenderField.update({
      where: { tenderId_fieldKey: { tenderId: task.tenderId, fieldKey: "emd_form" } },
      data: { correctedValue: formValue, correctedAt: new Date(), correctedById: actor.id, validationStatus: "VALIDATED", conflictNote: "" },
    });
    await tx.tenderField.update({
      where: { tenderId_fieldKey: { tenderId: task.tenderId, fieldKey: "emd_exemption" } },
      data: {
        correctedValue: kind === "EXEMPTION" ? "Yes" : "No",
        correctedAt: new Date(),
        correctedById: actor.id,
        validationStatus: "VALIDATED",
        conflictNote: "",
      },
    });
    await tx.tender.update({ where: { id: task.tenderId }, data: { emdType: kind, emdStatus: plan.emdStatus } });
    await tx.emdRecord.update({ where: { tenderId: task.tenderId }, data: { instrumentType: kind, notes: comments.trim() } });
    const next = await createTask(tx, {
      tenderId: task.tenderId,
      branch: "EMD",
      stage: plan.stage,
      title: plan.title,
      assigneeIds: owners.map((owner) => owner.id),
      ...due,
    });
    await audit(tx, { tenderId: task.tenderId, actor, action: "Clarified EMD requirement", entity: "EmdRecord", detail: `${formValue}. ${comments.trim()}` });
    return next.created ? next.task : null;
  });
  if (follow) await notifyTasks(task.tenderId, [follow], calendar);
}

type ReadinessInput = {
  relevanceStatus: string;
  costingStatus: string;
  emdStatus: string;
  bidSubmissionEnd: Date | null;
  submitterId: string | null;
  documents: { id: string }[];
  fields: FieldRow[];
};

/** Stage 10 checks, each with the role that clears it, so the page can show who is holding the tender up. */
export function readinessChecklist(tender: ReadinessInput) {
  const has = (key: string) => Boolean(valueOf(tender.fields.find((field) => field.fieldKey === key)));
  const conflicts = tender.fields.filter((field) => field.validationStatus === "CONFLICT");
  const deadlineOpen = Boolean(tender.bidSubmissionEnd && tender.bidSubmissionEnd.getTime() > Date.now());
  return [
    { label: "Relevance approved", gap: "Relevance is not approved.", ok: tender.relevanceStatus === "APPROVED", owner: "Vishesh or Ranjana" },
    { label: "Final costing approved by the Department Head", gap: "Final costing is not approved by the Department Head.", ok: tender.costingStatus === "APPROVED", owner: "Costing team, then Department Head" },
    { label: "EMD prepared and verified, or exemption documented", gap: "EMD is not prepared and verified, and no exemption is recorded.", ok: EMD_READY.includes(tender.emdStatus), owner: "Accounts or Sanjeev" },
    {
      label: "Mandatory tender information validated",
      gap: conflicts.length
        ? `Conflicting fields: ${conflicts.map((field) => field.label).join(", ")}.`
        : "Project name, client name, or a tender reference / ID is missing.",
      ok: has("project_name") && has("client_name") && (has("tender_ref") || has("tender_id")) && !conflicts.length,
      owner: "Tender Coordinator",
    },
    {
      label: "Bid submission deadline still open",
      gap: tender.bidSubmissionEnd ? "The bid submission deadline has passed." : "Bid submission deadline does not have a confirmed date and time.",
      ok: deadlineOpen,
      owner: "Tender Coordinator",
    },
    { label: "Tender documents stored", gap: "No tender document is stored.", ok: tender.documents.length > 0, owner: "Tender Coordinator" },
    { label: "Bid submitter assigned", gap: "A bid submitter is not assigned.", ok: Boolean(tender.submitterId), owner: "Coordinator or Department Head" },
  ];
}

export function readinessGaps(tender: ReadinessInput) {
  return readinessChecklist(tender)
    .filter((item) => !item.ok)
    .map((item) => item.gap);
}

export async function evaluateReadiness(tenderId: string) {
  const tender = await prisma.tender.findUnique({ where: { id: tenderId }, include: { fields: true, documents: true } });
  if (!tender) return;
  if (["BID_EVIDENCE_RECORDED", "BID_EVIDENCE_PENDING", "WON", "LOST", "CANCELLED"].includes(tender.overallStatus)) return;
  if (CLOSED_OVERALL.includes(tender.overallStatus)) return;
  if (tender.bidSubmissionEnd && tender.bidSubmissionEnd.getTime() <= Date.now() && !["BID_SUBMITTED_EVIDENCE_PENDING", "BID_SUBMITTED_EVIDENCE_RECORDED"].includes(tender.bidStatus)) {
    await markMissed(tender.id, "system");
    return;
  }
  const gaps = readinessGaps(tender);
  if (gaps.length) {
    if (tender.overallStatus === "READY_TO_BID") {
      await prisma.tender.update({ where: { id: tender.id }, data: { overallStatus: "APPROVED_IN_PROGRESS" } });
    }
    return;
  }
  const calendar = await getCalendar();
  const task = await prisma.$transaction(async (tx) => {
    await tx.tender.update({ where: { id: tender.id }, data: { overallStatus: "READY_TO_BID" } });
    return createTask(tx, {
      tenderId: tender.id,
      branch: "BID",
      stage: "BID_SUBMISSION",
      title: "Submit bid and record evidence",
      assigneeIds: [tender.submitterId!],
      dueAt: tender.bidSubmissionEnd,
      slaMinutes: 0,
    });
  });
  if (task.created) {
    await notifyAddresses({
      tenderId: tender.id,
      taskId: task.task.id,
      event: "BID_READY",
      addresses: await emailsFor([tender.submitterId!]),
      extra: { dueAt: formatWhen(tender.bidSubmissionEnd, calendar.timeZone), taskTitle: task.task.title },
    });
  }
}

export async function assignSubmitter(actor: Actor, tenderId: string, submitterId: string) {
  if (!MANAGER_ROLES.includes(actor.role)) {
    throw new WorkflowError("You cannot assign the bid submitter.");
  }
  const submitter = await prisma.user.findFirst({ where: { id: submitterId, active: true } });
  if (!submitter) throw new WorkflowError("Choose an active user as the bid submitter.");
  const tender = await prisma.tender.findUnique({ where: { id: tenderId } });
  if (!tender || CLOSED_OVERALL.includes(tender.overallStatus)) throw new WorkflowError("This tender cannot take a new submitter.");
  await prisma.tender.update({ where: { id: tenderId }, data: { submitterId } });
  await prisma.bidSubmission.upsert({
    where: { tenderId },
    create: { tenderId, submitterId, status: tender.bidStatus },
    update: { submitterId },
  });
  await audit(prisma, { tenderId, actor, action: "Assigned bid submitter", entity: "Tender", detail: submitter.name });
  await evaluateReadiness(tenderId);
}

export async function recordBid(
  actor: Actor,
  tenderId: string,
  input: {
    status: string;
    submittedAt: string;
    referenceNumber: string;
    notes: string;
    exceptionReason: string;
    file?: { name: string; type: string; buffer: Buffer };
  },
) {
  const tender = await prisma.tender.findUnique({ where: { id: tenderId }, include: { bid: true } });
  if (!tender) throw new WorkflowError("Tender not found.");
  if (["WON", "LOST", "CANCELLED", "REJECTED_CLOSED", "CLOSED_BUSINESS", "NOT_BID_DEADLINE_MISSED"].includes(tender.overallStatus)) {
    throw new WorkflowError("This tender is already closed.");
  }
  const task = await prisma.workflowTask.findFirst({
    where: { tenderId, stage: "BID_SUBMISSION", status: { in: OPEN_TASK } },
  });
  const assignee = task ? parseIds(task.assigneeIds).includes(actor.id) : tender.submitterId === actor.id;
  const authorizer = actor.role === "ADMIN" || actor.role === "DEPT_HEAD";
  const usingException = input.exceptionReason.trim().length > 0;
  if (!assignee && !(authorizer && usingException)) throw new WorkflowError("Only the assigned bid submitter can record the submission.");
  const allowed = ["SUBMISSION_IN_PROGRESS", "BID_SUBMITTED_EVIDENCE_PENDING", "BID_SUBMITTED_EVIDENCE_RECORDED", "SUBMISSION_FAILED"];
  if (!allowed.includes(input.status)) throw new WorkflowError("Choose a submission status.");
  const calendar = await getCalendar();
  const submittedAt = input.submittedAt ? parseDateTime(input.submittedAt.replace("T", " "), calendar.timeZone) : null;
  if (["BID_SUBMITTED_EVIDENCE_PENDING", "BID_SUBMITTED_EVIDENCE_RECORDED"].includes(input.status)) {
    if (!submittedAt) throw new WorkflowError("Enter the portal submission date and time.");
    if (tender.bidSubmissionEnd && submittedAt.getTime() > tender.bidSubmissionEnd.getTime()) {
      throw new WorkflowError("That submission time is after the bid deadline. A late click cannot be stored as a successful bid.");
    }
  }
  let evidenceId = tender.bid?.evidenceDocumentId || "";
  if (input.file) {
    if (!allowedUpload(input.file.name, input.file.type)) throw new WorkflowError("Evidence must be a PDF, text file, or image.");
    const storedPath = await storeFile(tenderId, input.file.name, input.file.buffer);
    const document = await prisma.tenderDocument.create({
      data: {
        tenderId,
        fileName: input.file.name,
        storedPath,
        mimeType: input.file.type || "application/octet-stream",
        sizeBytes: input.file.buffer.length,
        sha256: sha256(input.file.buffer),
        docType: "SUBMISSION_EVIDENCE",
        uploadedById: actor.id,
      },
    });
    evidenceId = document.id;
  }
  if (input.status === "BID_SUBMITTED_EVIDENCE_RECORDED" && !evidenceId && !usingException) {
    throw new WorkflowError("Upload the portal acknowledgement, or record an authorized exception. A completion click is not evidence.");
  }
  if (usingException && !authorizer) throw new WorkflowError("Only a Department Head or administrator can authorize a submission without the portal file.");
  if (usingException && input.exceptionReason.trim().length < 8) throw new WorkflowError("Describe the authorized exception.");

  const overall =
    input.status === "BID_SUBMITTED_EVIDENCE_RECORDED"
      ? "BID_EVIDENCE_RECORDED"
      : input.status === "BID_SUBMITTED_EVIDENCE_PENDING"
        ? "BID_EVIDENCE_PENDING"
        : tender.overallStatus === "READY_TO_BID"
          ? "READY_TO_BID"
          : tender.overallStatus;
  await prisma.bidSubmission.upsert({
    where: { tenderId },
    create: {
      tenderId,
      submitterId: actor.id,
      status: input.status,
      submittedAt,
      referenceNumber: input.referenceNumber.trim(),
      evidenceDocumentId: evidenceId,
      exceptionReason: usingException ? input.exceptionReason.trim() : "",
      exceptionAuthorizedById: usingException ? actor.id : "",
      notes: input.notes.trim(),
    },
    update: {
      status: input.status,
      submittedAt,
      referenceNumber: input.referenceNumber.trim(),
      evidenceDocumentId: evidenceId,
      exceptionReason: usingException ? input.exceptionReason.trim() : "",
      exceptionAuthorizedById: usingException ? actor.id : "",
      notes: input.notes.trim(),
    },
  });
  await prisma.tender.update({ where: { id: tenderId }, data: { bidStatus: input.status, overallStatus: overall } });
  if (input.status === "BID_SUBMITTED_EVIDENCE_RECORDED" && task) {
    await prisma.workflowTask.updateMany({
      where: { id: task.id, status: { in: OPEN_TASK } },
      data: { status: "COMPLETED", decision: usingException ? "EXCEPTION" : "EVIDENCE", completedById: actor.id, completedAt: new Date(), comments: input.notes.trim() },
    });
  }
  await audit(prisma, {
    tenderId,
    actor,
    action: "Recorded bid submission",
    entity: "BidSubmission",
    detail: `${input.status}${usingException ? ` exception: ${input.exceptionReason.trim()}` : ""}`,
  });
  if (input.status === "BID_SUBMITTED_EVIDENCE_PENDING") {
    const coordinator = await prisma.user.findFirst({ where: { personKey: "coordinator", active: true } });
    await notifyAddresses({
      tenderId,
      event: "SUBMISSION_EVIDENCE_MISSING",
      addresses: await emailsFor([actor.id, coordinator?.id || ""]),
    });
  }
}

export async function closeBusiness(actor: Actor, tenderId: string, reason: string) {
  if (!MANAGER_ROLES.includes(actor.role)) {
    throw new WorkflowError("You cannot close this tender.");
  }
  if (reason.trim().length < 3) throw new WorkflowError("Record the business reason for not bidding.");
  const tender = await prisma.tender.findUnique({ where: { id: tenderId } });
  if (!tender || CLOSED_OVERALL.includes(tender.overallStatus)) throw new WorkflowError("This tender is already closed.");
  await prisma.$transaction(async (tx) => {
    await tx.tender.update({
      where: { id: tenderId },
      data: { overallStatus: "CLOSED_BUSINESS", closureReason: reason.trim(), closedAt: new Date() },
    });
    await tx.workflowTask.updateMany({ where: { tenderId, status: { in: OPEN_TASK } }, data: { status: "CANCELLED" } });
    await audit(tx, { tenderId, actor, action: "Closed without bidding", entity: "Tender", detail: reason.trim() });
  });
}

export async function recordOutcome(actor: Actor, tenderId: string, outcome: "WON" | "LOST" | "CANCELLED", notes: string) {
  if (!MANAGER_ROLES.includes(actor.role)) {
    throw new WorkflowError("You cannot record the tender outcome.");
  }
  const tender = await prisma.tender.findUnique({ where: { id: tenderId } });
  if (!tender) throw new WorkflowError("Tender not found.");
  await prisma.$transaction(async (tx) => {
    await tx.tender.update({
      where: { id: tenderId },
      data: {
        outcome,
        outcomeNotes: notes.trim(),
        overallStatus: outcome,
        closedAt: tender.closedAt ?? new Date(),
        closureReason: tender.closureReason || notes.trim(),
      },
    });
    await tx.workflowTask.updateMany({ where: { tenderId, status: { in: OPEN_TASK } }, data: { status: "CANCELLED" } });
    await audit(tx, { tenderId, actor, action: "Recorded outcome", entity: "Tender", detail: `${outcome}. ${notes.trim()}` });
  });
}

export async function completeException(actor: Actor, taskId: string, comments: string) {
  const task = await prisma.workflowTask.findUnique({ where: { id: taskId } });
  if (!task || task.stage !== "OCR_EXCEPTION") throw new WorkflowError("Exception task not found.");
  assertOpen(actor, task);
  if (comments.trim().length < 3) throw new WorkflowError("Record how the extraction failure was handled.");
  await prisma.workflowTask.updateMany({
    where: { id: task.id, status: { in: OPEN_TASK } },
    data: { status: "COMPLETED", comments: comments.trim(), completedById: actor.id, completedAt: new Date(), decision: "HANDLED" },
  });
  await audit(prisma, { tenderId: task.tenderId, actor, action: "Closed extraction exception", entity: "WorkflowTask", detail: comments.trim() });
}

export async function addDocuments(
  actor: Actor,
  tenderId: string,
  files: { name: string; type: string; buffer: Buffer }[],
  docType = "SUPPORTING",
) {
  if (!files.length) throw new WorkflowError("Choose a file to upload.");
  const tender = await prisma.tender.findUnique({ where: { id: tenderId } });
  if (!tender || CLOSED_OVERALL.includes(tender.overallStatus)) throw new WorkflowError("Documents cannot be added to a closed tender.");
  if (!canEdit(actor) && actor.id !== tender.createdById) throw new WorkflowError("You cannot add documents to this tender.");
  const pages: PageText[] = [];
  const ocrHits: Record<string, FieldHit> = {};
  let anyText = false;
  for (const file of files) {
    if (file.buffer.length > 20 * 1024 * 1024) throw new WorkflowError(`${file.name} is larger than 20 MB.`);
    if (!allowedUpload(file.name, file.type)) throw new WorkflowError(`${file.name} must be a PDF, text file, or image.`);
    const hash = sha256(file.buffer);
    const same = await prisma.tenderDocument.findFirst({ where: { tenderId, sha256: hash } });
    if (same) throw new WorkflowError(`${file.name} is already stored on this tender.`);
    const storedPath = await storeFile(tenderId, file.name, file.buffer);
    const extracted = await pagesFromBuffer(file.buffer, file.type, file.name);
    if (!extracted.failed) anyText = true;
    const version = (await prisma.tenderDocument.count({ where: { tenderId, docType } })) + 1;
    const document = await prisma.tenderDocument.create({
      data: {
        tenderId,
        fileName: file.name,
        storedPath,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.buffer.length,
        sha256: hash,
        docType,
        version,
        uploadedById: actor.id,
        textExtract: extracted.pages.join("\n\f").slice(0, 150000),
        pageCount: extracted.pages.length,
      },
    });
    try {
      const remote = await extractUploadedFile(storedPath, file.name, document.id);
      for (const [key, hit] of Object.entries(remote.hits)) {
        if (hit.value) ocrHits[key] = hit;
      }
    } catch (error) {
      console.error(error);
    }
    extracted.pages.forEach((text, index) => pages.push({ documentId: document.id, page: index + 1, text }));
  }
  if (pages.length || Object.keys(ocrHits).length) await applyExtraction(tenderId, pages, actor, ocrHits);
  if ((anyText || Object.keys(ocrHits).length) && tender.ocrStatus === "FAILED") {
    await prisma.tender.update({ where: { id: tenderId }, data: { ocrStatus: "COMPLETED" } });
  }
  await audit(prisma, { tenderId, actor, action: "Uploaded documents", entity: "TenderDocument", detail: files.map((file) => file.name).join(", ") });
}

async function markMissed(tenderId: string, source: string) {
  const tender = await prisma.tender.findUnique({ where: { id: tenderId } });
  if (!tender || CLOSED_OVERALL.includes(tender.overallStatus)) return;
  if (["BID_SUBMITTED_EVIDENCE_PENDING", "BID_SUBMITTED_EVIDENCE_RECORDED"].includes(tender.bidStatus)) return;
  if (!tender.bidSubmissionEnd || tender.bidSubmissionEnd.getTime() > Date.now()) return;
  const calendar = await getCalendar();
  await prisma.$transaction(async (tx) => {
    await tx.tender.update({
      where: { id: tenderId },
      data: {
        overallStatus: "NOT_BID_DEADLINE_MISSED",
        bidStatus: "NOT_BID_DEADLINE_MISSED",
        deadlineMissed: true,
        closedAt: new Date(),
        closureReason: "Bid submission deadline passed without a recorded submission.",
      },
    });
    await tx.workflowTask.updateMany({ where: { tenderId, status: { in: OPEN_TASK } }, data: { status: "CANCELLED" } });
    await tx.bidSubmission.upsert({
      where: { tenderId },
      create: { tenderId, submitterId: tender.submitterId || "", status: "NOT_BID_DEADLINE_MISSED" },
      update: { status: "NOT_BID_DEADLINE_MISSED" },
    });
  });
  const coordinator = await prisma.user.findFirst({ where: { personKey: "coordinator", active: true } });
  await notifyAddresses({
    tenderId,
    event: "DEADLINE_MISSED",
    addresses: await emailsFor([tender.createdById, tender.submitterId || "", coordinator?.id || ""]),
    extra: { dueAt: formatWhen(tender.bidSubmissionEnd, calendar.timeZone), detail: source },
  });
}

let lastAutomation = 0;
let automation: Promise<void> | null = null;

export function kickAutomation() {
  if (automation || Date.now() - lastAutomation < 15000) return automation ?? Promise.resolve();
  lastAutomation = Date.now();
  automation = processAutomation()
    .catch((error) => console.error("SLA automation failed", error))
    .finally(() => {
      automation = null;
    });
  return automation;
}

export async function processAutomation() {
  const calendar = await getCalendar();
  const settings = await prisma.appSettings.findUnique({ where: { id: "default" } });
  const now = new Date();
  const tasks = await prisma.workflowTask.findMany({ where: { status: { in: OPEN_TASK } }, include: { tender: true } });
  for (const task of tasks) {
    if (CLOSED_OVERALL.includes(task.tender.overallStatus) || task.slaMinutes <= 0 || !task.dueAt) continue;
    const elapsed = businessMinutesBetween(task.baseAt, now, calendar);
    const ratio = elapsed / task.slaMinutes;
    if (ratio >= 0.5 && !task.reminder50Sent) {
      const claimed = await prisma.workflowTask.updateMany({ where: { id: task.id, reminder50Sent: false }, data: { reminder50Sent: true } });
      if (claimed.count === 1) {
        await notifyAddresses({
          tenderId: task.tenderId,
          taskId: task.id,
          event: "SLA_REMINDER_50",
          addresses: await emailsFor(parseIds(task.assigneeIds)),
          extra: { taskTitle: task.title, dueAt: formatWhen(task.dueAt, calendar.timeZone) },
        });
      }
    }
    if (ratio >= 0.75 && !task.reminder75Sent) {
      const claimed = await prisma.workflowTask.updateMany({ where: { id: task.id, reminder75Sent: false }, data: { reminder75Sent: true } });
      if (claimed.count === 1) {
        await notifyAddresses({
          tenderId: task.tenderId,
          taskId: task.id,
          event: "SLA_REMINDER_75",
          addresses: await emailsFor(parseIds(task.assigneeIds)),
          extra: { taskTitle: task.title, dueAt: formatWhen(task.dueAt, calendar.timeZone) },
        });
      }
    }
    if (now.getTime() > task.dueAt.getTime() && !task.breachSent) {
      const claimed = await prisma.workflowTask.updateMany({
        where: { id: task.id, breachSent: false, status: { in: OPEN_TASK } },
        data: { breachSent: true, wasOverdue: true, status: "OVERDUE" },
      });
      if (claimed.count === 1) {
        if (task.stage === "RELEVANCE") await prisma.tender.update({ where: { id: task.tenderId }, data: { relevanceOverdue: true } });
        if (task.branch === "EMD") await prisma.tender.update({ where: { id: task.tenderId }, data: { emdStatus: "OVERDUE" } });
        const level1 = await prisma.escalationRecipient.findMany({ where: { level: 1 } });
        if (!level1.length) {
          await prisma.auditLog.create({
            data: { tenderId: task.tenderId, action: "Escalation recipient missing", entity: "Notification", detail: task.title, actorName: "System" },
          });
        }
        await notifyAddresses({
          tenderId: task.tenderId,
          taskId: task.id,
          event: "SLA_BREACH",
          addresses: [...(await emailsFor(parseIds(task.assigneeIds))), ...level1.map((item) => ({ email: item.email, name: item.label }))],
          extra: { taskTitle: task.title, dueAt: formatWhen(task.dueAt, calendar.timeZone) },
        });
      }
    }
    if (task.breachSent && !task.breachLevel2Sent && task.dueAt) {
      const overdueFor = businessMinutesBetween(task.dueAt, now, calendar);
      if (overdueFor >= (settings?.level2AfterMinutes ?? 240)) {
        const claimed = await prisma.workflowTask.updateMany({ where: { id: task.id, breachLevel2Sent: false }, data: { breachLevel2Sent: true } });
        if (claimed.count === 1) {
          const level2 = await prisma.escalationRecipient.findMany({ where: { level: 2 } });
          await notifyAddresses({
            tenderId: task.tenderId,
            taskId: task.id,
            event: "SLA_BREACH_LEVEL2",
            addresses: [...(await emailsFor(parseIds(task.assigneeIds))), ...level2.map((item) => ({ email: item.email, name: item.label }))],
            extra: { taskTitle: task.title, dueAt: formatWhen(task.dueAt, calendar.timeZone) },
          });
        }
      }
    }
  }

  const hours = (settings?.bidReminderHours ?? "72,24,4")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item) && item > 0)
    .sort((a, b) => b - a);
  const tenders = await prisma.tender.findMany({
    where: { bidSubmissionEnd: { not: null }, overallStatus: { notIn: CLOSED_OVERALL } },
  });
  for (const tender of tenders) {
    if (!tender.bidSubmissionEnd) continue;
    if (["BID_SUBMITTED_EVIDENCE_PENDING", "BID_SUBMITTED_EVIDENCE_RECORDED"].includes(tender.bidStatus)) continue;
    if (tender.bidSubmissionEnd.getTime() <= now.getTime()) {
      await markMissed(tender.id, "scheduler");
      continue;
    }
    const remainingHours = (tender.bidSubmissionEnd.getTime() - now.getTime()) / 36e5;
    for (const hour of hours) {
      if (remainingHours > hour) continue;
      const event = `BID_DEADLINE_${hour}H`;
      const existing = await prisma.notificationLog.findFirst({ where: { tenderId: tender.id, eventType: event } });
      if (existing) continue;
      const coordinator = await prisma.user.findFirst({ where: { personKey: "coordinator", active: true } });
      await notifyAddresses({
        tenderId: tender.id,
        event,
        templateEvent: "BID_DEADLINE",
        addresses: await emailsFor([tender.submitterId || "", coordinator?.id || "", tender.createdById]),
        extra: { dueAt: formatWhen(tender.bidSubmissionEnd, calendar.timeZone), detail: `${hour} hours` },
      });
    }
  }
}
