import bcrypt from "bcryptjs";
import { db, type User } from "../db";
import { WorkflowError } from "./domain";
import * as domain from "./domain";
import { TEMPLATES } from "./notify";
import { SAMPLE_NOTICE } from "./extract";
import { textToPdf } from "./pdf";
import { TENDER_FIELDS } from "../utils/fields";
import { createAccount, updateUserAccess } from "./accounts";
import { describeSync, syncRefexOneUsers } from "./refexone-directory";
import type { ActionState } from "../utils/action-state";

/** Every action receives the signed-in user and the submitted form, and answers with an ActionState. */
export type Action = (actor: User, formData: FormData) => Promise<ActionState>;

function failure(error: unknown): ActionState {
  console.error(error);
  const message = error instanceof Error && error.message ? error.message : "The action could not be completed.";
  return { error: message };
}

async function filesFrom(formData: FormData, name: string) {
  const selected = formData.getAll(name).filter((item): item is File => item instanceof File && item.size > 0);
  const files = [];
  for (const file of selected) {
    files.push({ name: file.name, type: file.type, buffer: Buffer.from(await file.arrayBuffer()) });
  }
  return files;
}

/** Returns the user when the credentials match an active account; the caller sets the session cookie. */
/** Ignoring a search result needs a reason and a comment; both are kept with who ignored it and when. */
const IGNORE_REASONS = [
  "Not our scope of work",
  "Tender value less than 2 Cr",
  "SOW not as per strategy",
  "Location not serviceable",
  "Value too low or too high",
  "Eligibility not met",
  "Duplicate of another tender",
  "Deadline too close",
  "Tender closed or cancelled",
  "Other",
];
function ignoreFields(formData: FormData, actor: { id: string; name: string }, intent: string) {
  if (intent !== "ignore") return { ignoreReason: "", ignoreComment: null, ignoredById: "", ignoredByName: "", ignoredAt: null };
  const reason = String(formData.get("ignoreReason") || "").trim();
  const comment = String(formData.get("ignoreComment") || "").trim();
  if (!IGNORE_REASONS.includes(reason)) throw new WorkflowError("Choose a reason for ignoring it.");
  if (comment.length < 3) throw new WorkflowError("Add a comment saying why it is ignored.");
  return { ignoreReason: reason, ignoreComment: comment.slice(0, 2000), ignoredById: actor.id, ignoredByName: actor.name, ignoredAt: new Date() };
}

export async function checkLogin(emailInput: string, password: string) {
  const email = emailInput.trim().toLowerCase();
  const user = await db.user.findUnique({ where: { email } });
  if (!user?.active || !(await bcrypt.compare(password, user.passwordHash))) return null;
  return user;
}

export async function createTenderAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const result = await domain.createTender(actor, {
      projectName: String(formData.get("projectName") || ""),
      clientName: String(formData.get("clientName") || ""),
      portalName: String(formData.get("portalName") || ""),
      tenderRef: String(formData.get("tenderRef") || ""),
      externalTenderId: String(formData.get("externalTenderId") || ""),
      source: "MANUAL",
      files: await filesFrom(formData, "files"),
    });
    if (result.duplicate) {
      return {
        error: `This matches open tender ${result.recordId}. A second active workflow was not created.`,
        tenderId: result.tenderId,
      };
    }
    return { ok: result.recordId, tenderId: result.tenderId };
  } catch (error) {
    return failure(error);
  }
}

export async function createSampleAction(actor: User, _formData: FormData): Promise<ActionState> {
  try {
    const buffer = await textToPdf(SAMPLE_NOTICE);
    const result = await domain.createTender(actor, {
      projectName: "",
      clientName: "",
      portalName: "Sample portal",
      tenderRef: "",
      externalTenderId: "",
      source: "MANUAL",
      files: [{ name: "sample-ash-tender.pdf", type: "application/pdf", buffer }],
    });
    if (result.duplicate) return { error: `Open tender ${result.recordId} already has this sample.`, tenderId: result.tenderId };
    return { ok: result.recordId, tenderId: result.tenderId };
  } catch (error) {
    return failure(error);
  }
}

export async function updateFieldsAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const tenderId = String(formData.get("tenderId") || "");
    const values: Record<string, string> = {};
    for (const field of TENDER_FIELDS) values[field.key] = String(formData.get(`field_${field.key}`) ?? "");
    const mode = formData.get("intent") === "validate" ? "validate" : "save";
    const result = await domain.updateFields(actor, tenderId, values, mode);
    if (result.reopened) return { ok: `Saved. The bid end date is extended and the tender is open again.` };
    if (result.warnings.length) return { error: `Saved. ${result.warnings.join(" ")}` };
    // "Save and send": corrections are stored first, then the validation task is submitted, so no edit is lost.
    if (formData.get("intent") === "validate") {
      await domain.submitForRelevance(actor, String(formData.get("taskId") || ""), formData.get("confirmed") === "yes");
        return { ok: "Verified and sent for relevance review. The reviewers have been notified.", tenderId };
    }
    return { ok: result.changed ? `${result.changed} field${result.changed === 1 ? "" : "s"} saved.` : "No changes to save." };
  } catch (error) {
    return failure(error);
  }
}

/** BG letter details and supporting files that ride along with an EMD task's own submit. */
async function saveEmdExtras(actor: User, tenderId: string, formData: FormData) {
  const bg = Object.fromEntries(domain.BG_REQUEST_KEYS.filter((key) => formData.has(`bg_${key}`)).map((key) => [key, String(formData.get(`bg_${key}`) || "")]));
  if (domain.hasBgRequest(bg)) await domain.saveBgRequest(actor, tenderId, bg);
  await domain.attachEmdDocuments(actor, tenderId, await filesFrom(formData, "emdDocs"));
}

export async function taskAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const intent = String(formData.get("intent") || "");
    const taskId = String(formData.get("taskId") || "");
    const tenderId = String(formData.get("tenderId") || "");
    const notes = String(formData.get("notes") || "");
    const file = (await filesFrom(formData, "file"))[0];
    if (intent === "assign-task") await domain.assignTask(actor, taskId, String(formData.get("assigneeId") || ""), notes);
    else if (intent === "send-back") await domain.sendBack(actor, taskId, notes);
    else if (intent === "admin-send-back") {
      const result = await domain.adminSendBack(actor, tenderId, String(formData.get("stage") || ""), notes);
      return { ok: `Sent back to ${result.step}${result.reopened ? " and reopened" : ""}. The owner has been emailed.` };
    }
    else if (intent === "validate") await domain.submitForRelevance(actor, taskId, formData.get("confirmed") === "yes");
    else if (intent === "approve-relevance" || intent === "reject-relevance") {
      await domain.decideRelevance(actor, taskId, intent === "approve-relevance" ? "APPROVED" : "REJECTED", notes);
    } else if (intent === "cost-complete" || intent === "cost-return") {
      await domain.completeCosting(actor, taskId, {
        intent: intent === "cost-complete" ? "complete" : "return",
        notes,
        amount: String(formData.get("amount") || ""),
        file,
      });
    } else if (intent === "dept-approve" || intent === "dept-reject" || intent === "dept-return") {
      const decision = intent === "dept-approve" ? "APPROVED" : intent === "dept-reject" ? "REJECTED" : "RETURNED";
      await domain.decideDepartment(actor, taskId, decision, notes, String(formData.get("returnStage") || "FINAL_COSTING"));
    } else if (intent === "emd-save" || intent === "emd-complete") {
      await saveEmdExtras(actor, tenderId, formData);
      const evidence = [...(await filesFrom(formData, "files")), ...(file ? [file] : [])];
      await domain.saveEmdProgress(actor, taskId, {
        intent: intent === "emd-save" ? "save" : "complete",
        amount: String(formData.get("amount") || ""),
        stampAmount: String(formData.get("stampAmount") || ""),
        beneficiary: String(formData.get("beneficiary") || ""),
        referenceNumber: String(formData.get("referenceNumber") || ""),
        exemptionBasis: String(formData.get("exemptionBasis") || ""),
        notes,
        authorityNote: String(formData.get("authorityNote") || ""),
        submittedToAuthority: formData.get("submittedToAuthority") === "yes",
        preparationStatus: intent === "emd-complete" ? "Verified" : String(formData.get("preparationStatus") || ""),
        files: evidence,
      });
    } else if (intent === "remove-emd-doc") {
      await domain.removeEmdDocument(actor, tenderId, String(formData.get("documentId") || ""));
    } else if (intent === "bg-request") {
      await domain.saveBgRequest(actor, tenderId, Object.fromEntries(domain.BG_REQUEST_KEYS.map((key) => [key, String(formData.get(`bg_${key}`) || "")])));
    } else if (intent === "emd-clarify") {
      if (!String(formData.get("choice") || "")) throw new WorkflowError("Choose an EMD type. The system will not assume one.");
      if (notes.trim().length < 3) throw new WorkflowError("Record why this EMD type was selected.");
      await saveEmdExtras(actor, tenderId, formData);
      await domain.resolveEmdClarification(actor, taskId, String(formData.get("choice") || ""), notes);
    } else if (intent === "bid") {
      await domain.recordBid(actor, tenderId, {
        status: String(formData.get("bidStatus") || ""),
        submittedAt: String(formData.get("submittedAt") || ""),
        referenceNumber: String(formData.get("referenceNumber") || ""),
        notes,
        exceptionReason: String(formData.get("exceptionReason") || ""),
        file,
      });
    } else if (intent === "exception") await domain.completeException(actor, taskId, notes);
    else if (intent === "set-line") await domain.setBusinessLine(actor, tenderId, String(formData.get("businessLine") || ""));
    else if (intent === "assign-submitter") await domain.assignSubmitter(actor, tenderId, String(formData.get("submitterId") || ""));
    else if (intent === "close") await domain.closeBusiness(actor, tenderId, notes);
    else if (intent === "outcome") {
      const outcome = String(formData.get("outcome") || "");
      if (outcome !== "WON" && outcome !== "LOST" && outcome !== "CANCELLED") {
        throw new WorkflowError("Choose Won, Lost, or Cancelled.");
      }
      await domain.recordOutcome(actor, tenderId, outcome, notes);
    } else if (intent === "add-docs") await domain.addDocuments(actor, tenderId, await filesFrom(formData, "files"), String(formData.get("docType") || "SUPPORTING"));
    else if (intent === "remove-doc") await domain.removeDocument(actor, tenderId, String(formData.get("documentId") || ""));
    else throw new WorkflowError("Unknown action.");
    return { ok: "Saved." };
  } catch (error) {
    return failure(error);
  }
}

function adminOnly(actor: User): ActionState {
  return actor.role === "ADMIN" ? null : { error: "Only a system administrator can change this configuration." };
}

export async function saveCalendarAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const days = formData.getAll("days").map(String).filter((day) => /^[1-7]$/.test(day));
  await db.calendarSettings.upsert({
    where: { id: "default" },
    update: {
      workStart: String(formData.get("workStart") || "09:00"),
      workEnd: String(formData.get("workEnd") || "18:00"),
      workingDays: days.length ? days.join(",") : "1,2,3,4,5",
      timezone: "Asia/Kolkata",
    },
    create: {
      id: "default",
      workStart: String(formData.get("workStart") || "09:00"),
      workEnd: String(formData.get("workEnd") || "18:00"),
      workingDays: days.length ? days.join(",") : "1,2,3,4,5",
    },
  });
  return { ok: "Working calendar saved" };
}

export async function addUserAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  try {
    return await createAccount({
      name: String(formData.get("name") || ""),
      email: String(formData.get("email") || ""),
      role: String(formData.get("role") || ""),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/duplicate/i.test(message)) return { error: "That email already has an account." };
    return failure(error);
  }
}

/** Creates a non-expiring Bearer token for another app. The secret is in apiToken and is shown only this once. */
export async function createApiTokenAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  try {
    const { createApiToken } = await import("./api-tokens");
    const result = await createApiToken(actor, String(formData.get("name") || ""), String(formData.get("userId") || ""));
    return {
      ok: `API token “${result.name}” created for ${result.userName}. Copy it now — it is not shown again.`,
      apiToken: result.token,
    };
  } catch (error) {
    return failure(error);
  }
}

export async function revokeApiTokenAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  try {
    const { revokeApiToken } = await import("./api-tokens");
    return await revokeApiToken(actor, String(formData.get("id") || ""));
  } catch (error) {
    return failure(error);
  }
}

export async function updateUserAccessAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  try {
    return await updateUserAccess(actor.id, {
      userId: String(formData.get("userId") || ""),
      role: String(formData.get("role") || ""),
      allow: formData.get("allow") === "yes",
      phone: formData.has("phone") ? String(formData.get("phone") || "") : undefined,
    });
  } catch (error) {
    return failure(error);
  }
}

export async function sendTodayReportAction(actor: User, _formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const { REPORT_TO, REPORT_CC, REPORT_BCC, sendTodayReport } = await import("./daily-report");
  try {
    const result = await sendTodayReport();
    const sent = result.statuses.filter((status) => status === "SENT").length;
    if (!sent) return { error: `The report was not sent (${result.statuses.join(", ").toLowerCase()}). The Email log shows why.` };
    const { stats } = result;
    return {
      ok: `Today's report sent to ${REPORT_TO}. CC: ${REPORT_CC.join(", ")}. BCC: ${REPORT_BCC.join(", ")}. Total tenders ${stats.total}, active ${stats.active}, new today ${stats.newToday}, closing in 7 days ${stats.closing}, overdue tasks ${stats.overdue}.`,
    };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The report could not be sent." };
  }
}

export async function resendEmailAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const extra = String(formData.get("extraTo") || "")
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const bad = extra.filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (bad.length) return { error: `Not an email address: ${bad.join(", ")}` };
  try {
    const { resendLogged } = await import("./notify");
    return await resendLogged(String(formData.get("id") || ""), extra);
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The email could not be resent." };
  }
}

export async function syncRefexOneUsersAction(actor: User): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  try {
    return { ok: describeSync(await syncRefexOneUsers(actor)) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "The Refex One sync failed." };
  }
}

export async function addHolidayAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const date = String(formData.get("date") || "");
  const name = String(formData.get("name") || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !name) return { error: "Enter a holiday date and name" };
  await db.holiday.upsert({ where: { date }, update: { name }, create: { date, name } });
  return { ok: "Holiday saved" };
}

export async function deleteTenderAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const tenderId = String(formData.get("tenderId") || "");
  if (!tenderId) return { error: "Choose a tender to remove." };
  try {
    const recordId = await domain.removeTender(actor, tenderId);
    return { ok: `Removed ${recordId} and the records tied to it.` };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteGuaranteeAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const id = String(formData.get("id") || "");
  if (!id) return { error: "Choose a bank guarantee to remove." };
  try {
    const label = await domain.removeGuarantee(actor, id);
    return { ok: `Removed bank guarantee ${label} and its documents.` };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteBondAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const id = String(formData.get("id") || "");
  if (!id) return { error: "Choose an ISB record to remove." };
  try {
    const label = await domain.removeBond(actor, id);
    return { ok: `Removed ISB ${label} and its documents.` };
  } catch (error) {
    return failure(error);
  }
}

export async function clearGuaranteesAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  if (String(formData.get("confirm") || "") !== "REMOVE BG") return { error: "Type REMOVE BG to confirm." };
  try {
    const count = await domain.removeAllGuarantees(actor);
    return { ok: count ? `Removed ${count} bank guarantee${count === 1 ? "" : "s"} and their documents.` : "There were no bank guarantees to remove." };
  } catch (error) {
    return failure(error);
  }
}

export async function clearBondsAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  if (String(formData.get("confirm") || "") !== "REMOVE ISB") return { error: "Type REMOVE ISB to confirm." };
  try {
    const count = await domain.removeAllBonds(actor);
    return { ok: count ? `Removed ${count} ISB record${count === 1 ? "" : "s"} and their documents.` : "There were no ISB records to remove." };
  } catch (error) {
    return failure(error);
  }
}

export async function clearTendersAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  if (String(formData.get("confirm") || "") !== "REMOVE") return { error: "Type REMOVE to confirm." };
  try {
    const count = await domain.removeAllTenderData(actor);
    return { ok: count ? `Removed ${count} tender${count === 1 ? "" : "s"} and the records tied to them.` : "There were no tenders to remove." };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteHolidayAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  await db.holiday.delete({ where: { id: String(formData.get("id") || "") } }).catch(() => null);
  return { ok: "Holiday removed" };
}

export async function saveSlaAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const policies = await db.slaPolicy.findMany();
  for (const policy of policies) {
    const value = Number(formData.get(`value_${policy.stage}`));
    const unit = String(formData.get(`unit_${policy.stage}`) || policy.durationUnit);
    if (!Number.isFinite(value) || value <= 0) continue;
    if (unit !== "HOURS" && unit !== "DAYS") continue;
    await db.slaPolicy.update({ where: { id: policy.id }, data: { durationValue: value, durationUnit: unit } });
  }
  return { ok: "SLA policy saved" };
}

export async function saveSettingsAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  await db.appSettings.update({
    where: { id: "default" },
    data: {
      bgRequiresBoth: formData.get("bgRequiresBoth") === "yes",
      revisionResetsSla: formData.get("revisionResetsSla") === "yes",
      bidReminderHours: String(formData.get("bidReminderHours") || "72,24,4"),
      level2AfterMinutes: Math.max(30, Number(formData.get("level2AfterMinutes") || 240)),
    },
  });
  const levels = [1, 2];
  for (const level of levels) {
    const email = String(formData.get(`escalation_${level}`) || "").trim();
    const label = level === 1 ? "Workflow manager" : "Business owner";
    const existing = await db.escalationRecipient.findFirst({ where: { level } });
    if (!email) {
      if (existing) await db.escalationRecipient.delete({ where: { id: existing.id } });
      continue;
    }
    if (existing) await db.escalationRecipient.update({ where: { id: existing.id }, data: { email, label } });
    else await db.escalationRecipient.create({ data: { level, email, label } });
  }
  return { ok: "Workflow settings saved" };
}

export async function saveTemplateAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const event = String(formData.get("event") || "");
  if (!TEMPLATES.some((template) => template.event === event)) return { error: "Unknown template" };
  await db.emailTemplate.update({
    where: { event },
    data: { subject: String(formData.get("subject") || ""), body: String(formData.get("body") || "") },
  });
  return { ok: "Email template saved" };
}

export async function savePortalAction(_actor: User, formData: FormData): Promise<ActionState> {
  const name = String(formData.get("name") || "").trim();
  const url = String(formData.get("url") || "").trim();
  if (!name || !url) return { error: "Portal name and URL are required" };
  await db.portal.create({
    data: {
      name,
      url,
      category: String(formData.get("category") || ""),
      keywords: String(formData.get("keywords") || ""),
      frequencyHours: Math.max(1, Number(formData.get("frequencyHours") || 24)),
      enabled: formData.get("enabled") === "yes",
      accessMethod: "UNVALIDATED",
      lastStatus: "NOT_SCANNED",
    },
  });
  return { ok: "Portal saved. Scanning stays off until access is validated." };
}

export async function togglePortalAction(_actor: User, formData: FormData): Promise<ActionState> {
  const portal = await db.portal.findUnique({ where: { id: String(formData.get("id") || "") } });
  if (!portal) return { error: "Portal not found" };
  await db.portal.update({ where: { id: portal.id }, data: { enabled: !portal.enabled } });
  return { ok: "Portal updated" };
}

export async function logExceptionAction(_actor: User, formData: FormData): Promise<ActionState> {
  const portalId = String(formData.get("portalId") || "");
  const kind = String(formData.get("kind") || "").trim();
  const detail = String(formData.get("detail") || "").trim();
  if (!kind || !detail) return { error: "Exception type and detail are required" };
  await db.crawlerException.create({ data: { portalId, kind, detail, tenderHint: String(formData.get("tenderHint") || "") } });
  await db.portal.update({ where: { id: portalId }, data: { lastStatus: "EXCEPTION", lastError: detail, lastScanAt: new Date() } }).catch(() => null);
  return { ok: "Exception recorded" };
}

/** Sends a tender's unread documents to Unfyd again. */
export async function reextractDocumentsAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const tenderId = String(formData.get("tenderId") || "");
    const count = await domain.reextractDocuments(actor, tenderId);
    return { ok: `${count} document${count === 1 ? "" : "s"} sent to Unfyd again. The extracted data appears here when it returns.`, tenderId };
  } catch (error) {
    return failure(error);
  }
}

/** Replaces the bond register from the uploaded "Performance Bond & EMD ISB" workbook. */
export async function importBondsAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const file = (await filesFrom(formData, "file"))[0];
    if (!file) return { error: "Choose the Excel workbook to import." };
    const { importBonds } = await import("./bonds");
    const result = await importBonds(actor, file);
    return { ok: `Imported ${result.emd} EMD bonds and ${result.performance} performance bonds from ${file.name}.` };
  } catch (error) {
    return failure(error);
  }
}

/** Replaces the BG register from the uploaded BG workbook. */
export async function importGuaranteesAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const file = (await filesFrom(formData, "file"))[0];
    if (!file) return { error: "Choose the Excel workbook to import." };
    const { importGuarantees } = await import("./guarantees");
    const result = await importGuarantees(actor, file);
    return { ok: `Imported ${result.count} bank guarantees (${result.amended} with amendments) from ${file.name}.` };
  } catch (error) {
    return failure(error);
  }
}

/** One slot per amendment row, including rows left without a file, so file indexes match the text fields. */
async function amendmentFilesFrom(formData: FormData) {
  const rowCount = Math.max(
    formData.getAll("amendmentNo").length,
    formData.getAll("amendmentAmount").length,
    formData.getAll("amendmentCharges").length,
    formData.getAll("amendmentChargesPercent").length,
    formData.getAll("amendmentDate").length,
    formData.getAll("amendmentExpiry").length,
    formData.getAll("amendmentClaim").length,
    formData.getAll("amendmentStamp").length,
  );
  const amendmentFiles = [];
  for (let index = 0; index < rowCount; index += 1) {
    const item = formData.get(`amendmentFile_${index}`);
    if (!(item instanceof File) || item.size <= 0) amendmentFiles.push({ name: "", type: "", buffer: Buffer.alloc(0) });
    else amendmentFiles.push({ name: item.name, type: item.type, buffer: Buffer.from(await item.arrayBuffer()) });
  }
  return amendmentFiles;
}

/** Turns one tender's EMD into a security deposit. */
export async function convertEmdToSdAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const { convertEmdToSd } = await import("./emd-board");
    const result = await convertEmdToSd(actor, formData);
    return { ok: `${result.recordId} EMD converted to a security deposit.`, tenderId: result.tenderId };
  } catch (error) {
    return failure(error);
  }
}

/** Saves every field of one EMD or performance surety bond. */
export async function updateBondAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const { updateBond } = await import("./bonds");
    const result = await updateBond(actor, formData);
    return { ok: `${result.bondNumber} saved.` };
  } catch (error) {
    return failure(error);
  }
}

/** Saves one tender's EMD instrument, and its refund or security-deposit conversion. */
export async function updateEmdRegisterAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const { updateEmdRegister } = await import("./emd-board");
    const result = await updateEmdRegister(actor, formData);
    return { ok: `${result.recordId} EMD details saved.`, tenderId: result.tenderId };
  } catch (error) {
    return failure(error);
  }
}

/** Adds one bank guarantee, with its scans and any amendment rows entered on the form. */
export async function addGuaranteeAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const { createGuarantee } = await import("./guarantees");
    const result = await createGuarantee(actor, formData, await filesFrom(formData, "files"), await amendmentFilesFrom(formData), await filesFrom(formData, "closure"));
    const notes = [`${result.bgNumber} added`, result.amendments ? `${result.amendments} amendment${result.amendments === 1 ? "" : "s"}` : "", result.documents ? `${result.documents} document${result.documents === 1 ? "" : "s"} stored` : ""].filter(Boolean);
    return { ok: `${notes.join(" · ")}.`, tenderId: result.id };
  } catch (error) {
    return failure(error);
  }
}

/** Sets the status of one bank guarantee from its page. */
export async function guaranteeStatusAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const { setGuaranteeStatus } = await import("./guarantees");
    const result = await setGuaranteeStatus(actor, String(formData.get("id") || ""), formData.get("bgStatus"));
    const label: Record<string, string> = { LIVE: "Live", EXPIRE: "Expired", CLOSED: "Closed", CLAIMED: "Claimed" };
    return { ok: `${result.bgNumber} is now ${label[result.bgStatus] ?? result.bgStatus}.` };
  } catch (error) {
    return failure(error);
  }
}

/** Saves changes to a bank guarantee already in the register, including new scans. */
export async function updateGuaranteeAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const { updateGuarantee } = await import("./guarantees");
    const result = await updateGuarantee(actor, formData, await filesFrom(formData, "files"), await amendmentFilesFrom(formData), await filesFrom(formData, "closure"));
    const notes = [`${result.bgNumber} updated`, `${result.amendments} amendment${result.amendments === 1 ? "" : "s"}`, result.documents ? `${result.documents} new document${result.documents === 1 ? "" : "s"} stored` : ""].filter(Boolean);
    return { ok: `${notes.join(" · ")}.`, tenderId: result.id };
  } catch (error) {
    return failure(error);
  }
}

/** Stores scanned BG documents; each file is linked to its guarantee by the BG number in its name. */
export async function uploadBgDocumentsAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const files = await filesFrom(formData, "files");
    if (!files.length) return { error: "Choose the BG documents to upload." };
    const { storeBgDocuments } = await import("./bg-documents");
    // "Closure" on the BG page files the scans as the guarantee's closure documents.
    const result = await storeBgDocuments(actor, files, String(formData.get("bgNumber") || ""), formData.get("kind") === "CLOSURE" ? "CLOSURE" : undefined);
    const notes = [
      `${result.stored} stored`,
      result.duplicate ? `${result.duplicate} already there` : "",
      result.unmatched.length ? `${result.unmatched.length} for BG numbers not in the register yet` : "",
      result.unnamed.length ? `${result.unnamed.length} without a BG number in the name (${result.unnamed.slice(0, 3).join(", ")})` : "",
      result.tooLarge.length ? `${result.tooLarge.length} over 25 MB` : "",
    ].filter(Boolean);
    return { ok: notes.join(" · ") };
  } catch (error) {
    return failure(error);
  }
}

/** Stores ISB copies; each file is linked to its bond by the bond number in its name, or to `bondId` when given. */
export async function uploadBondDocumentsAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const files = await filesFrom(formData, "files");
    if (!files.length) return { error: "Choose the ISB copies to upload." };
    const { storeBondDocuments } = await import("./bond-documents");
    const result = await storeBondDocuments(actor, files, String(formData.get("bondId") || ""));
    const notes = [
      `${result.stored} stored`,
      result.duplicate ? `${result.duplicate} already there` : "",
      result.close.length ? `${result.close.length} linked by a close bond number (${result.close.slice(0, 3).join(", ")})` : "",
      result.unmatched.length ? `${result.unmatched.length} not linked to a bond (${result.unmatched.slice(0, 3).join(", ")})` : "",
      result.unnamed.length ? `${result.unnamed.length} without a bond number in the name (${result.unnamed.slice(0, 3).join(", ")})` : "",
      result.tooLarge.length ? `${result.tooLarge.length} over 25 MB` : "",
    ].filter(Boolean);
    return { ok: notes.join(" · ") };
  } catch (error) {
    return failure(error);
  }
}

/** GeM bid watch: settings, a manual run, and importing or ignoring a found bid. Any signed-in user. */
export async function gemAction(actor: User, formData: FormData): Promise<ActionState> {
  const gem = await import("./gem");
  const intent = String(formData.get("intent") || "");
  try {
    const portal = await gem.gemPortal();
    if (intent === "settings") {
      const keywords = String(formData.get("keywords") || "").trim();
      if (!keywords) throw new WorkflowError("Add at least one keyword.");
      await db.portal.update({
        where: { id: portal.id },
        data: {
          keywords,
          excludeWords: String(formData.get("excludeWords") || "").trim(),
          frequencyHours: Math.min(168, Math.max(1, Number(formData.get("frequencyHours")) || 6)),
          maxPages: Math.min(100, Math.max(1, Number(formData.get("maxPages")) || 30)),
          maxImports: Math.min(200, Math.max(0, Number(formData.get("maxImports")) || 0)),
          enabled: formData.get("enabled") === "yes",
          autoImport: formData.get("autoImport") === "yes",
        },
      });
      return { ok: "GeM watch settings saved." };
    }
    if (intent === "add-keyword" || intent === "remove-keyword") {
      const word = String(formData.get("keyword") || "").trim();
      if (!word) throw new WorkflowError("Type a keyword.");
      const current: string[] = String(portal.keywords)
        .split(/[,\n;]+/)
        .map((item: string) => item.trim())
        .filter(Boolean);
      const next =
        intent === "add-keyword"
          ? current.some((item: string) => item.toLowerCase() === word.toLowerCase())
            ? current
            : [...current, word]
          : current.filter((item: string) => item.toLowerCase() !== word.toLowerCase());
      if (!next.length) throw new WorkflowError("Keep at least one keyword.");
      await db.portal.update({ where: { id: portal.id }, data: { keywords: next.join(", ") } });
      return { ok: intent === "add-keyword" ? `Keyword “${word}” added. Press Run now to search it.` : `Keyword “${word}” removed.` };
    }
    if (intent === "run") {
      if (gem.gemRunning()) return { ok: "A GeM pass is already running. Its results appear here when it finishes." };
      // A pass takes a few minutes, so it runs in the background and the page refreshes as results arrive.
      void gem.runGemWatch(actor).catch((error) => console.error("GeM watch failed", error));
      return { ok: "GeM pass started. New matching bids appear below as they are found." };
    }
    const bidId = String(formData.get("bidId") || "");
    if (intent === "import") {
      const uploads = (await filesFrom(formData, "files")).filter((file) => file.buffer.length);
      const result = await gem.importGemBid(actor, bidId, uploads);
      return {
        ok: result.already
          ? result.note || "This bid was already on a tender."
          : uploads.length
            ? `${result.recordId} created with the tender file; Unfyd is extracting the tender data from it.`
            : `${result.recordId} created from the GeM bid${result.note ? `. ${result.note}` : "; Unfyd is extracting the tender data from the bid document."}`,
        tenderId: result.tenderId,
      };
    }
    if (intent === "send-line") {
      const line = formData.get("line") === "Coal" ? "Coal" : formData.get("line") === "Ash" ? "Ash" : "";
      if (!line) throw new WorkflowError("Choose Ash or Coal.");
      await db.gemBid.update({ where: { id: bidId }, data: { sentLine: line } });
      return { ok: `This search result is now in the ${line} list. It was not added to the pipeline.` };
    }
    if (intent === "ignore" || intent === "restore") {
      await db.gemBid.update({ where: { id: bidId }, data: { status: intent === "ignore" ? "IGNORED" : "NEW", error: "", ...ignoreFields(formData, actor, intent) } });
      return { ok: intent === "ignore" ? "Bid ignored." : "Bid moved back to the review list." };
    }
    throw new WorkflowError("Unknown GeM action.");
  } catch (error) {
    return failure(error);
  }
}

/**
 * Adds or removes a search keyword or exclude word on both searches (the tender websites and GeM). An exclude word
 * also applies at once to the results already found: matching tenders still to review move to Excluded, and taking
 * the word off brings back the ones it had excluded. A new keyword is searched on the next run.
 */
async function searchWords(
  intent: string,
  raw: string,
  sitePortal: { id: string; keywords: string; excludeWords: string | null },
  place: { heading: string; newHeading: string; minCrore: number; type?: string } = { heading: "", newHeading: "", minCrore: 0 },
) {
  const word = raw.replace(/\s+/g, " ").trim();
  if (!word) throw new WorkflowError("Type a word first.");
  if (word.length > 120) throw new WorkflowError("Keep it under 120 characters.");
  const { formatKeywordHeadings, headingType, OTHER_HEADING, parseKeywordHeadings } = await import("./site-keywords");
  const { siteExcludedBy } = await import("./site-watch");
  const gem = await import("./gem");
  const gemPortal = await gem.gemPortal();
  const same = (item: string) => item.toLowerCase() === word.toLowerCase();
  const commaList = (value: string | null) =>
    String(value || "")
      .split(/[,\n;]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  if (intent === "search-keyword" || intent === "search-unkeyword") {
    const adding = intent === "search-keyword";
    if (adding && /[,;]/.test(word)) throw new WorkflowError("Use a keyword without commas or semicolons.");
    if (/^#/.test(word)) throw new WorkflowError("A keyword cannot start with #.");
    // The website list keeps its headings: the word leaves every heading, and when added goes under the chosen one.
    const groups = parseKeywordHeadings(sitePortal.keywords || "").map((group) => ({ ...group, keywords: group.keywords.filter((item) => !same(item)) }));
    let heading = "";
    if (adding) {
      const fresh = place.newHeading.replace(/[|#\n]/g, " ").replace(/\s+/g, " ").trim();
      if (place.heading === "__new" && !fresh) throw new WorkflowError("Type the new heading's name.");
      heading = place.heading === "__new" ? fresh : place.heading || OTHER_HEADING;
      let group = groups.find((item) => item.heading.toLowerCase() === heading.toLowerCase());
      if (!group) {
        const type = place.type === "Ash" || place.type === "Coal" ? place.type : headingType(heading);
        groups.push((group = { heading, type, minCrore: place.heading === "__new" ? Math.max(0, place.minCrore) : 0, keywords: [] }));
      }
      heading = group.heading;
      group.keywords.push(word);
    }
    const gemWords = commaList(gemPortal.keywords);
    const nextGem = adding ? (gemWords.some(same) ? gemWords : [...gemWords, word]) : gemWords.filter((item) => !same(item));
    if (!groups.some((group) => group.keywords.length) || !nextGem.length) throw new WorkflowError("Keep at least one keyword.");
    await db.portal.update({ where: { id: sitePortal.id }, data: { keywords: formatKeywordHeadings(groups) } });
    await db.portal.update({ where: { id: gemPortal.id }, data: { keywords: nextGem.join(", ") } });
    return {
      ok: adding ? `Keyword “${word}” added under ${heading} on the website and GeM searches. Press Re-run search to find its tenders.` : `Keyword “${word}” removed; it is not searched from the next run.`,
    };
  }
  const adding = intent === "search-exclude";
  const siteEx = commaList(sitePortal.excludeWords);
  const gemEx = commaList(gemPortal.excludeWords);
  await db.portal.update({ where: { id: sitePortal.id }, data: { excludeWords: (adding ? (siteEx.some(same) ? siteEx : [...siteEx, word]) : siteEx.filter((item) => !same(item))).join(", ") } });
  await db.portal.update({ where: { id: gemPortal.id }, data: { excludeWords: (adding ? (gemEx.some(same) ? gemEx : [...gemEx, word]) : gemEx.filter((item) => !same(item))).join(", ") } });
  let moved = 0;
  if (adding) {
    const note = `Title mentions "${word}".`;
    for (const row of (await db.siteTender.findMany({ where: { status: "NEW" } })) as { id: string; title: string }[]) {
      if (!siteExcludedBy(row.title, [word])) continue;
      await db.siteTender.update({ where: { id: row.id }, data: { status: "EXCLUDED", error: note } });
      moved += 1;
    }
    for (const row of (await db.gemBid.findMany({ where: { status: "NEW" } })) as { id: string; title: string }[]) {
      if (!gem.excludedBy(row.title, [word])) continue;
      await db.gemBid.update({ where: { id: row.id }, data: { status: "EXCLUDED", error: note } });
      moved += 1;
    }
    return { ok: `Exclude word “${word}” added.${moved ? ` ${moved} result${moved === 1 ? "" : "s"} moved to Excluded.` : " No current result has it."}` };
  }
  const note = `Title mentions "${word}".`.toLowerCase();
  for (const row of (await db.siteTender.findMany({ where: { status: "EXCLUDED" } })) as { id: string; error: string }[]) {
    if (String(row.error || "").toLowerCase() !== note) continue;
    await db.siteTender.update({ where: { id: row.id }, data: { status: "NEW", error: "" } });
    moved += 1;
  }
  for (const row of (await db.gemBid.findMany({ where: { status: "EXCLUDED" } })) as { id: string; error: string }[]) {
    if (String(row.error || "").toLowerCase() !== note) continue;
    await db.gemBid.update({ where: { id: row.id }, data: { status: "NEW", error: "" } });
    moved += 1;
  }
  return { ok: `Exclude word “${word}” removed.${moved ? ` ${moved} result${moved === 1 ? "" : "s"} it had excluded are back to review.` : ""}` };
}

export async function siteWatchAction(actor: User, formData: FormData): Promise<ActionState> {
  const sites = await import("./site-watch");
  const intent = String(formData.get("intent") || "");
  try {
    const portal = await sites.siteWatchPortal();
    if (intent === "settings") {
      const keywords = String(formData.get("keywords") || "").trim();
      if (!keywords) throw new WorkflowError("Add at least one keyword.");
      await db.portal.update({
        where: { id: portal.id },
        data: {
          keywords,
          excludeWords: String(formData.get("excludeWords") || "").trim(),
          frequencyHours: Math.min(168, Math.max(1, Number(formData.get("frequencyHours")) || 12)),
          enabled: formData.get("enabled") === "yes",
        },
      });
      return { ok: "Tender sites watch settings saved." };
    }
    if (intent === "search-keyword" || intent === "search-unkeyword" || intent === "search-exclude" || intent === "search-unexclude") {
      return await searchWords(intent, String(formData.get("word") || ""), portal, {
        heading: String(formData.get("heading") || ""),
        newHeading: String(formData.get("newHeading") || ""),
        minCrore: Number(formData.get("minCrore")) || 0,
        type: String(formData.get("type") || ""),
      });
    }
    if (intent === "search-run") {
      // One button for both searches: every website pass and the GeM pass start side by side in the background.
      const gem = await import("./gem");
      const started: string[] = [];
      if (!sites.siteWatchRunning()) {
        void sites.runSiteWatch().catch((error) => console.error("Tender sites watch failed", error));
        started.push("websites");
      }
      if (!gem.gemRunning()) {
        void gem.runGemWatch(actor).catch((error) => console.error("GeM watch failed", error));
        started.push("GeM");
      }
      return { ok: started.length ? `Search started on the ${started.join(" and ")}. New matches appear in the list as they are found.` : "Both searches are already running; their results appear in the list as they are found." };
    }
    if (intent === "add-number") {
      // A GeM bid number or an NIC tender ID / reference number, put straight into the Ash or Coal list.
      const number = String(formData.get("number") || "").trim().replace(/[\s-]+$/, "");
      const line = formData.get("line") === "Ash" ? "Ash" : "Coal";
      const website = String(formData.get("website") || "").trim();
      if (!number) throw new WorkflowError("Type the GeM bid number or the tender ID.");
      const isGem = /^GEM\/\d{4}\/[A-Z]\/\d+$/i.test(number);
      if (!isGem && !website) throw new WorkflowError("For a website tender, give the website address as well (for example https://eproc.rajasthan.gov.in/nicgep/app).");
      try {
        const result = isGem ? await (await import("./gem")).addGemBidByNumber(number, line) : await sites.addSiteTenderByNumber(website, number, line);
        return { ok: result.already ? `${number} was already in the list; it is now under ${line}.` : `${number} added under ${line}: ${result.title}` };
      } catch (error) {
        throw new WorkflowError(error instanceof Error ? error.message : String(error));
      }
    }
    if (intent === "run" || intent === "run-site") {
      if (sites.siteWatchRunning()) return { ok: "A pass is already running. Its results appear here as they are found." };
      const siteId = intent === "run-site" ? String(formData.get("siteId") || "") : undefined;
      void sites.runSiteWatch(siteId).catch((error) => console.error("Tender sites watch failed", error));
      return { ok: siteId ? "Site pass started." : "Tender sites pass started. Matching tenders appear below as they are found." };
    }
    if (intent === "toggle-site") {
      const site = await db.watchSite.findUnique({ where: { id: String(formData.get("siteId") || "") } });
      if (!site) throw new WorkflowError("That site is not in the list.");
      if (site.method === "MANUAL") throw new WorkflowError("This site has no list that can be read automatically.");
      await db.watchSite.update({ where: { id: site.id }, data: { enabled: !site.enabled } });
      return { ok: site.enabled ? `${site.host} paused.` : `${site.host} back on.` };
    }
    const tenderId = String(formData.get("siteTenderId") || "");
    if (intent === "import") {
      const uploads = (await filesFrom(formData, "files")).filter((file) => file.buffer.length);
      const result = await sites.importSiteTender(actor, tenderId, uploads, String(formData.get("docToken") || ""));
      const skipped = result.skipped.length ? ` Not sent for extraction: ${result.skipped.join(", ")}.` : "";
      const ok = result.already
        ? result.files
          ? `${result.files} document${result.files === 1 ? "" : "s"} added to the tender; Unfyd is reading ${result.files === 1 ? "it" : "them"}.${skipped}`
          : "This tender was already registered."
        : result.files
          ? `${result.recordId} created with ${result.files} document${result.files === 1 ? "" : "s"}; Unfyd is extracting the tender data.${skipped}`
          : `${result.recordId} created from the portal listing. No documents were fetched: visit the website to download them (${result.sourceUrl}), then add them to the tender.`;
      return { ok, tenderId: result.tenderId };
    }
    if (intent === "send-line") {
      const line = formData.get("line") === "Coal" ? "Coal" : formData.get("line") === "Ash" ? "Ash" : "";
      if (!line) throw new WorkflowError("Choose Ash or Coal.");
      await db.siteTender.update({ where: { id: tenderId }, data: { sentLine: line } });
      return { ok: `This search result is now in the ${line} list. It was not added to the pipeline.` };
    }
    if (intent === "ignore" || intent === "restore") {
      await db.siteTender.update({ where: { id: tenderId }, data: { status: intent === "ignore" ? "IGNORED" : "NEW", error: "", ...ignoreFields(formData, actor, intent) } });
      return { ok: intent === "ignore" ? "Tender ignored." : "Tender moved back to the review list." };
    }
    throw new WorkflowError("Unknown tender sites action.");
  } catch (error) {
    return failure(error);
  }
}

export async function ingestDiscoveredAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const result = await domain.createTender(actor, {
      projectName: String(formData.get("projectName") || ""),
      clientName: String(formData.get("clientName") || ""),
      portalName: String(formData.get("portalName") || ""),
      tenderRef: String(formData.get("tenderRef") || ""),
      externalTenderId: String(formData.get("externalTenderId") || ""),
      source: "CRAWLER",
      files: await filesFrom(formData, "files"),
    });
    if (result.duplicate) return { error: `Open tender ${result.recordId} already covers this discovery.`, tenderId: result.tenderId };
    return { ok: `${result.recordId} created and sent for data validation.`, tenderId: result.tenderId };
  } catch (error) {
    return failure(error);
  }
}
