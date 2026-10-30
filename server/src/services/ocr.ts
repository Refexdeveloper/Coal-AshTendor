import { randomUUID } from "crypto";
import { TENDER_FIELDS, type FieldDef } from "../utils/fields";
import { canonicalize, parseDateTime, type FieldHit } from "./extract";
import { ocrFileUrl } from "./ocr-link";

const OCR_URL = process.env.OCR_EXTRACT_URL || "https://refex-live.unfyd.com/unfyd-prism/api/admin/ExtractData";
const BOT_ID = process.env.OCR_BOT_ID || "I7DI-1NLS-XWPK-9OLX";
const DOCUMENT_TYPE = process.env.OCR_DOCUMENT_TYPE || "Tendor";

function norm(value: string) {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Spacing-free form, so Prebid_conference matches "Pre-bid conference" and GeMe_procurement_Ref matches "GeM/e-procurement Ref". */
function compact(value: string) {
  return norm(value).replace(/ /g, "");
}

// Unfyd key spellings that differ from our labels beyond spacing and punctuation.
const OCR_ALIASES: Record<string, string> = {
  Prequalification_criteria_technical: "pq_technical",
  Prequalification_criteria_financial: "pq_financial",
  Performance_fee_starting_PBG: "performance_bg",
  Reverse_auction_Yes_No: "reverse_auction",
};

const FIELD_INDEX = new Map<string, FieldDef>();
for (const field of TENDER_FIELDS) {
  for (const label of [field.key, field.label, ...(field.synonyms ?? [])]) {
    FIELD_INDEX.set(compact(label), field);
  }
}
for (const [alias, key] of Object.entries(OCR_ALIASES)) {
  const field = TENDER_FIELDS.find((item) => item.key === key);
  if (field) FIELD_INDEX.set(compact(alias), field);
}

const EMPTY = /^(n\/?a|nil|none|not applicable|not mentioned|not specified|not available|-+)$/i;

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Bring an OCR answer into the shape the field editor uses: DD/MM/YYYY HH:MM dates, and a choice
 * reduced to its option when the answer leads with one, such as "Yes (MSME firms are exempt)".
 * Returns "" for answers that only say the item does not apply.
 */
function normalizeValue(field: FieldDef, raw: string): { value: string; sure: boolean } {
  const value = raw.trim();
  const bare = value.replace(/^\(.*?\)\s*-?\s*/, "").trim();
  if (!value || EMPTY.test(value) || EMPTY.test(bare)) return { value: "", sure: true };
  if (field.type === "datetime") {
    const date = parseDateTime(value, "UTC");
    if (!date) return { value, sure: false };
    return {
      value: `${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear()} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`,
      sure: true,
    };
  }
  if (field.options) {
    const lead = field.options.find((option) => new RegExp(`^${option.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}\\b`, "i").test(value));
    if (lead) return { value: lead, sure: true };
    const canonical = canonicalize(field, value);
    return { value: canonical.value, sure: canonical.mapped };
  }
  if (field.type === "integer") {
    const number = value.match(/^\d+/);
    return number ? { value: number[0], sure: number[0] === value } : { value, sure: false };
  }
  return { value, sure: true };
}

function asText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

type OcrPage = {
  "Page Number"?: number;
  "Extracted Fields"?: Record<string, unknown>[];
};

type OcrPayload = {
  message?: { ERROR_MESSAGE?: string; DOCUMENT_NAME?: string }[];
  ProcessedAttachments?: {
    Extracted_Data?: {
      success?: boolean;
      confidence?: number;
      Pages?: OcrPage[];
    }[];
  }[];
};

export function ocrErrorNote(payload: unknown) {
  const message = (payload as OcrPayload).message ?? [];
  return message
    .map((item) => item.ERROR_MESSAGE)
    .filter((item): item is string => Boolean(item))
    .join("; ");
}

/** Map Unfyd `Extracted Fields` keys such as Name_of_the_Project_ onto the 44 tender fields. */
export function fieldsFromOcrResponse(payload: unknown, documentId: string): Record<string, FieldHit> {
  const attachments = (payload as OcrPayload).ProcessedAttachments ?? [];
  const grouped = new Map<string, { value: string; confidence: number; page: string }[]>();
  for (const attachment of attachments) {
    for (const document of attachment.Extracted_Data ?? []) {
      if (document.success === false) continue;
      const confidence = typeof document.confidence === "number" ? document.confidence : 0.86;
      for (const page of document.Pages ?? []) {
        const pageNo = page["Page Number"] ? String(page["Page Number"]) : "";
        for (const row of page["Extracted Fields"] ?? []) {
          for (const [rawKey, rawValue] of Object.entries(row)) {
            const field = FIELD_INDEX.get(compact(rawKey));
            if (!field) continue;
            const { value, sure } = normalizeValue(field, asText(rawValue));
            if (!value) continue;
            const list = grouped.get(field.key) ?? [];
            list.push({ value, confidence: sure ? confidence : Math.min(confidence, 0.45), page: pageNo });
            grouped.set(field.key, list);
          }
        }
      }
    }
  }
  const output: Record<string, FieldHit> = {};
  for (const [key, hits] of grouped) {
    const distinct = hits.filter((hit, index) => hits.findIndex((other) => other.value.trim().toLowerCase() === hit.value.trim().toLowerCase()) === index);
    const first = distinct[0];
    if (distinct.length > 1) {
      output[key] = {
        value: first.value,
        confidence: Math.min(...distinct.map((hit) => hit.confidence)),
        documentId,
        page: distinct.map((hit) => hit.page).filter(Boolean).join(", "),
        conflictNote: distinct.map((hit) => hit.value).join(" | "),
        status: "CONFLICT",
      };
      continue;
    }
    output[key] = {
      value: first.value,
      confidence: first.confidence,
      documentId,
      page: first.page,
      conflictNote: "",
      status: first.confidence < 0.6 ? "LOW_CONFIDENCE" : "EXTRACTED",
    };
  }
  return output;
}

export function overlayHits(base: Record<string, FieldHit>, extra?: Record<string, FieldHit>) {
  if (!extra) return base;
  const output = { ...base };
  for (const [key, hit] of Object.entries(extra)) {
    if (hit?.value) output[key] = hit;
  }
  return output;
}

export async function extractUploadedFile(storedPath: string, fileName: string, documentId = "ocr") {
  const documentUrl = ocrFileUrl(storedPath, fileName);
  const body = {
    BotId: BOT_ID,
    InteractionId: randomUUID(),
    DocumentType: DOCUMENT_TYPE,
    Documents: [documentUrl],
  };
  console.log("OCR POST", OCR_URL, JSON.stringify(body));
  const response = await fetch(OCR_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180_000),
  });
  const text = await response.text();
  if (!response.ok) {
    return { hits: {} as Record<string, FieldHit>, note: `OCR request failed (${response.status}).` };
  }
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    return { hits: {} as Record<string, FieldHit>, note: "OCR returned a response that was not JSON." };
  }
  const hits = fieldsFromOcrResponse(payload, documentId);
  const note = Object.keys(hits).length ? "" : ocrErrorNote(payload) || "OCR returned no fields.";
  return { hits, note };
}
