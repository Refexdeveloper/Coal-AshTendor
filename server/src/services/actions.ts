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
        return { ok: "Verified and sent for relevance review. Vishesh and Ranjana have been notified.", tenderId };
    }
    return { ok: result.changed ? `${result.changed} field${result.changed === 1 ? "" : "s"} saved.` : "No changes to save." };
  } catch (error) {
    return failure(error);
  }
}

export async function taskAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    const intent = String(formData.get("intent") || "");
    const taskId = String(formData.get("taskId") || "");
    const tenderId = String(formData.get("tenderId") || "");
    const notes = String(formData.get("notes") || "");
    const file = (await filesFrom(formData, "file"))[0];
    if (intent === "validate") await domain.submitForRelevance(actor, taskId, formData.get("confirmed") === "yes");
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
      await domain.saveEmdProgress(actor, taskId, {
        intent: intent === "emd-save" ? "save" : "complete",
        amount: String(formData.get("amount") || ""),
        beneficiary: String(formData.get("beneficiary") || ""),
        referenceNumber: String(formData.get("referenceNumber") || ""),
        exemptionBasis: String(formData.get("exemptionBasis") || ""),
        notes,
        authorityNote: String(formData.get("authorityNote") || ""),
        submittedToAuthority: formData.get("submittedToAuthority") === "yes",
        preparationStatus: intent === "emd-complete" ? "Verified" : String(formData.get("preparationStatus") || ""),
        file,
      });
    } else if (intent === "emd-clarify") {
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
    else if (intent === "assign-submitter") await domain.assignSubmitter(actor, tenderId, String(formData.get("submitterId") || ""));
    else if (intent === "close") await domain.closeBusiness(actor, tenderId, notes);
    else if (intent === "outcome") {
      const outcome = String(formData.get("outcome") || "");
      if (outcome !== "WON" && outcome !== "LOST" && outcome !== "CANCELLED") {
        throw new WorkflowError("Choose Won, Lost, or Cancelled.");
      }
      await domain.recordOutcome(actor, tenderId, outcome, notes);
    } else if (intent === "add-docs") await domain.addDocuments(actor, tenderId, await filesFrom(formData, "files"), String(formData.get("docType") || "SUPPORTING"));
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

export async function updateUserAccessAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  try {
    return await updateUserAccess(actor.id, {
      userId: String(formData.get("userId") || ""),
      role: String(formData.get("role") || ""),
      allow: formData.get("allow") === "yes",
    });
  } catch (error) {
    return failure(error);
  }
}

export async function sendTodayReportAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const { REPORT_TO, sendTodayReport } = await import("./daily-report");
  const to = String(formData.get("to") || REPORT_TO)
    .split(/[\s,;]+/)
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const bad = to.filter((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email));
  if (!to.length) return { error: "Enter at least one email address." };
  if (bad.length) return { error: `Not an email address: ${bad.join(", ")}` };
  try {
    const result = await sendTodayReport(to);
    const sent = result.statuses.filter((status) => status === "SENT").length;
    if (!sent) return { error: `The report was not sent (${result.statuses.join(", ").toLowerCase()}). The Email log shows why.` };
    const { mailConfig } = await import("./notify");
    const inbox = mailConfig().redirectTo;
    return { ok: `Today's report sent to ${to.join(", ")}${inbox && to.some((email) => email !== inbox) ? ` (test mode: delivered to ${inbox})` : ""}.` };
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

export async function savePortalAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
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

export async function togglePortalAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const portal = await db.portal.findUnique({ where: { id: String(formData.get("id") || "") } });
  if (!portal) return { error: "Portal not found" };
  await db.portal.update({ where: { id: portal.id }, data: { enabled: !portal.enabled } });
  return { ok: "Portal updated" };
}

export async function logExceptionAction(actor: User, formData: FormData): Promise<ActionState> {
  const denied = adminOnly(actor);
  if (denied) return denied;
  const portalId = String(formData.get("portalId") || "");
  const kind = String(formData.get("kind") || "").trim();
  const detail = String(formData.get("detail") || "").trim();
  if (!kind || !detail) return { error: "Exception type and detail are required" };
  await db.crawlerException.create({ data: { portalId, kind, detail, tenderHint: String(formData.get("tenderHint") || "") } });
  await db.portal.update({ where: { id: portalId }, data: { lastStatus: "EXCEPTION", lastError: detail, lastScanAt: new Date() } }).catch(() => null);
  return { ok: "Exception recorded" };
}

export async function ingestDiscoveredAction(actor: User, formData: FormData): Promise<ActionState> {
  try {
    if (actor.role !== "ADMIN" && actor.role !== "COORDINATOR") {
      throw new WorkflowError("Only an administrator or coordinator can register a discovered tender.");
    }
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
    return { ok: `${result.recordId} assigned to Vishesh.`, tenderId: result.tenderId };
  } catch (error) {
    return failure(error);
  }
}
