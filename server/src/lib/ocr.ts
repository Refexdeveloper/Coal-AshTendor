import { randomUUID } from "crypto";
import { TENDER_FIELDS, type FieldDef } from "./fields";
import type { FieldHit } from "./extract";
import { ocrFileUrl } from "./ocr-link";

const OCR_URL = process.env.OCR_EXTRACT_URL || "https://refex-uat.unfyd.com/unfyd-prism/api/admin/ExtractData";
const BOT_ID = process.env.OCR_BOT_ID || "I7DI-1NLS-XWPK-9OLX";
const DOCUMENT_TYPE = process.env.OCR_DOCUMENT_TYPE || "Tendor OCR";

function norm(value: string) {
  return value
    .toLowerCase()
    .replace(/[_/]+/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FIELD_INDEX = new Map<string, FieldDef>();
for (const field of TENDER_FIELDS) {
  for (const label of [field.key, field.label, ...(field.synonyms ?? [])]) {
    FIELD_INDEX.set(norm(label), field);
  }
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
            const field = FIELD_INDEX.get(norm(rawKey));
            const value = asText(rawValue);
            if (!field || !value) continue;
            const list = grouped.get(field.key) ?? [];
            list.push({ value, confidence, page: pageNo });
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
