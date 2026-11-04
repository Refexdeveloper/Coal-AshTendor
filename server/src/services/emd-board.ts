import { db } from "../db";
import { BOND_MANAGERS } from "./bonds";
import { parseInr } from "./extract";

/** People who can correct the EMD register from the dashboard. */
const EDITORS = [...BOND_MANAGERS, "GROUP_CEO", "REVIEWER"];

const METHODS = ["BG", "ISB", "ONLINE", "DD", "EXEMPTION", "OTHER", "UNCLEAR"] as const;

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

function money(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value);
  if (!raw) return null;
  const parsed = parseInr(raw);
  if (parsed != null) return parsed;
  const plain = Number(raw.replace(/,/g, ""));
  return Number.isFinite(plain) ? plain : null;
}

function day(value: unknown) {
  const raw = text(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
  if (!match) return null;
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
}

function resultOf(tender: { outcome: string; overallStatus: string }) {
  const status = tender.outcome || tender.overallStatus;
  if (status === "WON") return "WON";
  if (status === "LOST") return "LOST";
  if (status === "CANCELLED") return "CANCELLED";
  return "EVALUATION";
}

/** Tenders whose EMD is being managed: an instrument, a fee, or a tender the business is pursuing. */
export async function listEmdBoard() {
  const [tenders, records, fields, documents] = await Promise.all([
    db.tender.findMany({}),
    db.emdRecord.findMany({}),
    db.tenderField.findMany({ where: { fieldKey: { in: ["emd_fee"] } } }),
    db.tenderDocument.findMany({ where: { docType: { in: ["EMD_EVIDENCE", "EMD_DOCUMENT"] } }, select: { id: true, tenderId: true, fileName: true } }),
  ]);
  const recordByTender = new Map(records.map((row: { tenderId: string }) => [row.tenderId, row]));
  const feeByTender = new Map(fields.map((row: { tenderId: string; correctedAt: Date | null; correctedValue: string; extractedValue: string }) => [row.tenderId, row.correctedAt ? row.correctedValue : row.extractedValue]));
  const docsByTender = new Map<string, { id: string; fileName: string }[]>();
  for (const doc of documents as { id: string; tenderId: string; fileName: string }[]) {
    const list = docsByTender.get(doc.tenderId) ?? [];
    list.push({ id: doc.id, fileName: doc.fileName });
    docsByTender.set(doc.tenderId, list);
  }

  const rows = (tenders as Record<string, unknown>[])
    .filter((tender) => {
      const record = recordByTender.get(String(tender.id));
      const fee = money(feeByTender.get(String(tender.id)));
      const typed = tender.emdType && !["UNCLEAR", "NONE", ""].includes(String(tender.emdType));
      const started = tender.emdStatus && tender.emdStatus !== "NOT_STARTED";
      const pursuing = tender.relevanceStatus === "APPROVED" && tender.overallStatus !== "REJECTED_CLOSED";
      return Boolean(record || fee != null || tender.emdExposure != null || typed || started || pursuing);
    })
    .map((tender) => {
      const record = recordByTender.get(String(tender.id)) as Record<string, unknown> | undefined;
      const method = String(record?.instrumentType || tender.emdType || "UNCLEAR");
      const amount = money(record?.amount) ?? (tender.emdExposure as number | null) ?? money(feeByTender.get(String(tender.id)));
      const refundRequested = (record?.refundRequested as number | null) ?? null;
      const refundReceived = (record?.refundReceived as number | null) ?? null;
      const result = resultOf(tender as { outcome: string; overallStatus: string });
      const outstanding = refundRequested ?? amount ?? 0;
      const pending = result === "LOST" ? Math.max(0, outstanding - (refundReceived ?? 0)) : 0;
      const docs = docsByTender.get(String(tender.id)) ?? [];
      if (record?.documentId && !docs.some((doc) => doc.id === record.documentId)) {
        docs.unshift({ id: String(record.documentId), fileName: "EMD evidence" });
      }
      return {
        tenderId: String(tender.id),
        recordId: String(tender.recordId ?? ""),
        project: String(tender.projectName ?? ""),
        customer: String(tender.clientName ?? ""),
        portal: String(tender.portalName ?? ""),
        location: String(tender.location ?? ""),
        tenderRef: String(tender.tenderRef ?? ""),
        method: METHODS.includes(method as (typeof METHODS)[number]) ? method : method || "UNCLEAR",
        amount,
        bank: String(record?.bankDetails ?? ""),
        instrument: String(record?.referenceNumber ?? ""),
        issueDate: (record?.issueDate as Date | null) ?? null,
        expiryDate: (record?.expiryDate as Date | null) ?? null,
        result,
        refundRequested,
        refundReceived,
        pending,
        convertedToSd: Boolean(record?.convertedToSd),
        sdAmount: (record?.sdAmount as number | null) ?? null,
        documents: docs,
      };
    })
    .sort((a, b) => a.recordId.localeCompare(b.recordId));

  return { rows, canEdit: false };
}

/** Saves the instrument and, where the result calls for it, the refund or the security-deposit conversion. */
export async function updateEmdRegister(actor: { id: string; name: string; role: string }, formData: FormData) {
  if (!EDITORS.includes(actor.role)) throw new Error("You cannot update the EMD register.");
  const tenderId = text(formData.get("tenderId"));
  const tender = await db.tender.findUnique({ where: { id: tenderId } });
  if (!tender) throw new Error("Tender not found.");
  const requested = text(formData.get("method"));
  const method = METHODS.includes(requested as (typeof METHODS)[number]) ? requested : "UNCLEAR";
  const amount = money(formData.get("amount"));
  const refundRequested = money(formData.get("refundRequested"));
  const refundReceived = money(formData.get("refundReceived"));
  const converted = ["1", "on", "true"].includes(text(formData.get("convertedToSd")).toLowerCase());
  const sdAmount = converted ? money(formData.get("sdAmount")) ?? amount : money(formData.get("sdAmount"));
  const data = {
    instrumentType: method,
    amount: amount == null ? "" : String(amount),
    bankDetails: text(formData.get("bank")).slice(0, 255),
    referenceNumber: text(formData.get("instrument")),
    issueDate: day(formData.get("issueDate")),
    expiryDate: day(formData.get("expiryDate")),
    refundRequested,
    refundReceived,
    convertedToSd: converted,
    sdAmount,
  };
  const existing = await db.emdRecord.findFirst({ where: { tenderId } });
  if (existing) await db.emdRecord.update({ where: { id: existing.id }, data });
  else {
    await db.emdRecord.create({
      data: { tenderId, preparationStatus: "NOT_STARTED", beneficiary: "", exemptionBasis: "", documentId: "", notes: "", authorityNote: "", ...data },
    });
  }
  await db.tender.update({
    where: { id: tenderId },
    data: { emdType: method, emdExposure: method === "EXEMPTION" ? 0 : amount },
  });
  await db.auditLog.create({
    data: {
      tenderId,
      actorId: actor.id,
      actorName: actor.name,
      action: "Updated EMD register",
      entity: "EmdRecord",
      detail: `${method}${amount != null ? ` · ₹${amount.toLocaleString("en-IN")}` : ""}`,
    },
  });
  return { tenderId, recordId: String(tender.recordId) };
}
