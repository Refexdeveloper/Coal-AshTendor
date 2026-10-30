import { NOT_FOUND, TENDER_FIELDS, fieldLabels, type FieldDef } from "../utils/fields";

export type PageText = { documentId: string; page: number; text: string };

export type FieldHit = {
  value: string;
  confidence: number;
  documentId: string;
  page: string;
  conflictNote: string;
  status: "EXTRACTED" | "LOW_CONFIDENCE" | "CONFLICT" | "MISSING";
};

function clean(line: string) {
  return line.replace(/[—–−]/g, "-").replace(/\s+/g, " ").trim();
}

function allLabels() {
  return TENDER_FIELDS.flatMap((field) => fieldLabels(field).map((label) => clean(label).toLowerCase()));
}

const LABEL_INDEX = allLabels().sort((a, b) => b.length - a.length);

function looksLikeLabel(line: string) {
  const lower = clean(line).toLowerCase();
  return LABEL_INDEX.some((label) => lower === label || lower.startsWith(`${label}:`) || lower.startsWith(`${label} -`) || lower.startsWith(`${label}-`));
}

function valueAfterLabel(line: string, labels: string[]) {
  const cleaned = clean(line);
  const lower = cleaned.toLowerCase();
  const ordered = [...labels].sort((a, b) => clean(b).length - clean(a).length);
  for (const label of ordered) {
    const normalized = clean(label).toLowerCase();
    if (lower === normalized) return "";
    if (lower.startsWith(normalized)) {
      return cleaned.slice(normalized.length).replace(/^[\s:-]+/, "").trim();
    }
  }
  return null;
}

export function canonicalize(field: FieldDef, raw: string) {
  const value = raw.trim();
  const lower = value.toLowerCase();
  if (!value) return { value: "", mapped: false };
  if (field.options) {
    const exact = field.options.find((option) => option.toLowerCase() === lower);
    if (exact) return { value: exact, mapped: true };
    if (field.key === "emd_form") {
      if (/\bbank guarantee\b|\bbg\b/.test(lower)) return { value: "Bank Guarantee", mapped: true };
      if (/\bsurety\b|\bisb\b/.test(lower)) return { value: "ISB / Surety Bond", mapped: true };
      if (/\bdemand draft\b|\bdd\b/.test(lower)) return { value: "Demand Draft", mapped: true };
      if (/online payment|neft|rtgs/.test(lower)) return { value: "Online Payment", mapped: true };
      if (/\bexempt/.test(lower)) return { value: "Exemption", mapped: true };
    }
    if (field.key === "submission_mode") {
      if (/electronic|online|e-tender|portal/.test(lower)) return { value: "Electronic", mapped: true };
      if (/physical|offline|hard copy only/.test(lower)) return { value: "Physical", mapped: true };
      if (/both/.test(lower)) return { value: "Both", mapped: true };
    }
    if (field.key === "price_type") {
      if (/fixed|item rate|lumpsum|lump sum/.test(lower)) return { value: lower.includes("item") ? value : "Fixed", mapped: lower.includes("fixed") || lower.includes("lump") };
      if (/variable|escalat/.test(lower)) return { value: "Variable", mapped: true };
    }
    if (["yes", "y"].includes(lower)) {
      const yes = field.options.find((option) => option.toLowerCase() === "yes");
      if (yes) return { value: yes, mapped: true };
    }
    if (["no", "n"].includes(lower)) {
      const no = field.options.find((option) => option.toLowerCase() === "no");
      if (no) return { value: no, mapped: true };
    }
    if (lower.includes("clarification")) {
      const option = field.options.find((item) => item.toLowerCase().includes("clarification"));
      if (option) return { value: option, mapped: true };
    }
    if (lower === "conditional" && field.options.includes("Conditional")) return { value: "Conditional", mapped: true };
    return { value, mapped: false };
  }
  if (field.type === "integer") {
    if (/^\d+$/.test(value)) return { value, mapped: true };
    return { value, mapped: false };
  }
  return { value, mapped: true };
}

function readField(pages: PageText[], field: FieldDef) {
  const labels = fieldLabels(field);
  const hits: { value: string; confidence: number; documentId: string; page: number }[] = [];
  for (const page of pages) {
    const lines = page.text.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const found = valueAfterLabel(lines[index], labels);
      if (found === null) continue;
      let value = found;
      let confidence = labels.some((label) => clean(label).toLowerCase() === clean(field.label).toLowerCase()) &&
        clean(lines[index]).toLowerCase().startsWith(clean(field.label).toLowerCase())
        ? 0.9
        : 0.74;
      if (field.type === "long") {
        const extra: string[] = [];
        for (let follow = index + 1; follow < lines.length; follow += 1) {
          const line = lines[follow].trim();
          if (!line) break;
          if (looksLikeLabel(line)) break;
          extra.push(clean(line));
          if (extra.length > 8) break;
        }
        if (extra.length) {
          value = [value, ...extra].filter(Boolean).join(" ");
          confidence = Math.min(confidence, 0.8);
        }
      }
      const canonical = canonicalize(field, value);
      if (!canonical.value) continue;
      if (field.options && !canonical.mapped) confidence = Math.min(confidence, 0.45);
      if (field.type === "integer" && !canonical.mapped) confidence = Math.min(confidence, 0.45);
      hits.push({ value: canonical.value, confidence, documentId: page.documentId, page: page.page });
      break;
    }
  }
  return hits;
}

function sameValue(a: string, b: string) {
  return a.replace(/\s+/g, " ").trim().toLowerCase() === b.replace(/\s+/g, " ").trim().toLowerCase();
}

export function extractFields(pages: PageText[]): Record<string, FieldHit> {
  const output: Record<string, FieldHit> = {};
  for (const field of TENDER_FIELDS) {
    const hits = readField(pages, field);
    if (!hits.length) {
      output[field.key] = {
        value: "",
        confidence: 0,
        documentId: "",
        page: "",
        conflictNote: "",
        status: "MISSING",
      };
      continue;
    }
    const distinct = hits.filter((hit, index) => hits.findIndex((other) => sameValue(other.value, hit.value)) === index);
    if (distinct.length > 1) {
      output[field.key] = {
        value: distinct[0].value,
        confidence: Math.min(...distinct.map((hit) => hit.confidence)),
        documentId: distinct[0].documentId,
        page: distinct.map((hit) => String(hit.page)).join(", "),
        conflictNote: distinct.map((hit) => `${hit.value} (page ${hit.page})`).join(" | "),
        status: "CONFLICT",
      };
      continue;
    }
    const hit = hits[0];
    output[field.key] = {
      value: hit.value,
      confidence: hit.confidence,
      documentId: hit.documentId,
      page: String(hit.page),
      conflictNote: "",
      status: hit.confidence < 0.6 ? "LOW_CONFIDENCE" : "EXTRACTED",
    };
  }
  return output;
}

export function parseDateTime(value: string, timeZone: string) {
  const cleaned = value.replace(/\bhrs?\b/gi, "").replace(/[—–]/g, "-").trim();
  const patterns = [
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})$/,
    /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})\s+(\d{1,2}):(\d{2})\s*([ap]m)?$/i,
  ];
  const iso = cleaned.match(patterns[0]);
  if (iso) {
    return zoned(Number(iso[1]), Number(iso[2]), Number(iso[3]), Number(iso[4]), Number(iso[5]), timeZone);
  }
  const local = cleaned.match(patterns[1]);
  if (!local) return null;
  let hour = Number(local[4]);
  const minute = Number(local[5]);
  const ampm = local[6]?.toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return zoned(Number(local[3]), Number(local[2]), Number(local[1]), hour, minute, timeZone);
}

function zoned(year: number, month: number, day: number, hour: number, minute: number, timeZone: string) {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) return null;
  let utc = Date.UTC(year, month - 1, day, hour, minute, 0);
  for (let i = 0; i < 4; i += 1) {
    const fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date(utc)).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
    const diff =
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour === "24" ? "0" : parts.hour), Number(parts.minute), Number(parts.second)) -
      Date.UTC(year, month - 1, day, hour, minute, 0);
    if (diff === 0) break;
    utc -= diff;
  }
  return new Date(utc);
}

export function parseInr(value: string) {
  if (!value || value === NOT_FOUND) return null;
  const letters = value.replace(/rs\.?|inr|₹/gi, "").replace(/[0-9.,\s]/g, "");
  if (letters.length) return null;
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : null;
}

export function effectiveValue(field: { extractedValue: string; correctedValue: string; correctedAt: Date | null }) {
  if (field.correctedAt) return field.correctedValue;
  return field.extractedValue;
}

export const SAMPLE_NOTICE = `NTPC LIMITED
Name of the Project: Raising of Ash Dyke at Sipat Super Thermal Power Station
Tender reference number: NTPC/SIPAT/ASH/2026/014
Tender ID: 2026_NTPC_123456
Client name: NTPC Limited
Work description: Evacuation, loading and disposal of pond ash from the existing dyke.
Location: Sipat, Chhattisgarh
Bid submission end date: 18/12/2026 15:00
Bid opening date: 18/12/2026 16:30
Pre-bid conference date and time: 02/12/2026 11:00
Hard copy submission date: 18/12/2026 14:00
Estimated cost: Rs. 125000000
Tender fee: Rs. 5900
EMD fee: Rs. 2500000
EMD form process: Bank Guarantee
EMD exemption: No
Performance fee starting (PBG): 10 percent of contract value
Mode of submission: Electronic
Hard copy required: Yes
Contract period: 18 months
Number of envelopes: 2
Pre-qualification criteria - technical: Experience of ash handling works of at least 2 projects in 7 years.
Pre-qualification criteria - financial: Average annual turnover of Rs. 10 crore during the last 3 years.
Consortium / JV allowed: Conditional
Bid validity: 180 days
Contact person: AGM (Ash Management)
Contact details: ash.sipat@ntpc.co.in
GeM/e-procurement Ref: https://eprocure.ntpc.co.in/tender/2026_NTPC_123456
Registration on tender portal: Yes
Reverse auction: Yes
Acceptance of L1 rates parameters: L1 rates may be counter-offered to other technically suitable bidders.
Scope of work: Excavation, loading, transport and disposal of pond ash to the designated mine void.
GST: Extra at actuals
Penalties: Delay penalty as per the general conditions of contract.
Mobilization period: 15 days
Mode of measurement: Cubic metre of ash evacuated
Measurement of load: Weighbridge at project site
Contract price type: Variable
Price variation: WPI linked quarterly
Security deposit: 5 percent of contract value
Liquidated damages: 0.5 percent per week capped at 5 percent
Payment terms: Monthly running bills payable within 30 days of certification.
Penalty recovery: Recovered from running bills.
Quantity deviation: Plus or minus 20 percent
Defect liability: 12 months
`;
