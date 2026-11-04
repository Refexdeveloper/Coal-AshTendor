import { db } from "../db";
import { BOND_MANAGERS } from "./bonds";
import { readWorkbook, type Sheet } from "./xlsx";

/**
 * Bank guarantees, imported from the BG register workbook ("BG Template" sheet).
 * One row per BG: the issuance fields, then up to eight "Amendment - n" blocks of seven columns each.
 * Every block is kept (as JSON), and any column the importer does not know is kept in `extra`.
 */

export type Amendment = {
  no: number;
  amount: number | null;
  charges: number | null;
  chargesPercent: number | null;
  date: string | null;
  expiry: string | null;
  claim: string | null;
  stampDuty: number | null;
};

const clean = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();
const key = (value: string | undefined) => clean(value).toLowerCase().replace(/[^a-z0-9%]+/g, " ").trim();

function number(value: string | undefined) {
  const text = clean(value).replace(/,/g, "").replace(/^(rs\.?|inr|₹)\s*/i, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function percent(value: string | undefined) {
  const text = clean(value);
  if (!text) return null;
  const parsed = number(text.replace(/%$/, ""));
  if (parsed == null) return null;
  // "0.25%" is already a percent; a bare 0.0025 is a fraction.
  return text.endsWith("%") || parsed >= 0.1 ? parsed : +(parsed * 100).toFixed(4);
}

/** yyyy-mm-dd, m/d/yyyy (the sheet writes US-style slashes), dd.mm.yyyy, or an Excel serial day. Noon UTC so the day never shifts. */
function date(value: string | undefined) {
  const text = clean(value);
  if (!text) return null;
  let parsed: Date | null = null;
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(text);
  if (match) parsed = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12));
  else if ((match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(text))) parsed = new Date(Date.UTC(Number(match[3]), Number(match[1]) - 1, Number(match[2]), 12));
  else if ((match = /^(\d{1,2})[.-](\d{1,2})[.-](\d{4})$/.exec(text))) parsed = new Date(Date.UTC(Number(match[3]), Number(match[2]) - 1, Number(match[1]), 12));
  else if (/^\d{5}(\.\d+)?$/.test(text)) parsed = new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 864e5 + 12 * 36e5);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

const iso = (value: Date | null) => (value ? value.toISOString() : null);

/** Column letters → 0-based index, and back. */
const toIndex = (letters: string) => [...letters].reduce((total, char) => total * 26 + char.charCodeAt(0) - 64, 0) - 1;
const toLetters = (index: number) => {
  let out = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) out = String.fromCharCode(65 + ((n - 1) % 26)) + out;
  return out;
};

/** Issuance columns, matched on the header text. */
const BASE: Record<string, string[]> = {
  bgType: ["bg type"],
  bank: ["issuance bank", "issuing bank", "bank"],
  marginMoney: ["margin money", "margin"],
  beneficiary: ["beneficary", "beneficiary"],
  site: ["site plant project", "site", "plant", "project"],
  loiLoa: ["loi loa", "loi", "loa"],
  bgNumber: ["bg number", "bg no"],
  amount: ["bg amount"],
  issueDate: ["bg issue date", "issue date"],
  charges: ["bg charges"],
  chargesPercent: ["bg charges %"],
  details: ["bg details"],
  amendmentNumber: ["amendment number"],
  amendmentDate: ["amendment date"],
  expiryDate: ["expiry dt", "expiry date"],
  claimDate: ["claim dt", "claim date"],
  stampDuty: ["stamp duty"],
};
const AMENDMENT_FIELDS: Record<string, keyof Omit<Amendment, "no">> = {
  "bg amount": "amount",
  "bg charges": "charges",
  "bg charges %": "chargesPercent",
  "amendment date": "date",
  "expiry dt": "expiry",
  "expiry date": "expiry",
  "claim dt": "claim",
  "claim date": "claim",
  "stamp duty": "stampDuty",
};

function parseSheet(sheet: Sheet) {
  const at = sheet.rows.findIndex((row) => {
    const values = Object.values(row).map(key);
    return values.includes("bg type") && values.some((cell) => cell.startsWith("bg number"));
  });
  if (at < 0) throw new Error(`The "${sheet.name}" sheet does not have a header row with "BG Type" and "BG Number".`);
  const header = sheet.rows[at];
  const sub = sheet.rows[at + 1] ?? {};
  const headerAt = (letter: string) => key(header[letter]);

  // Amendment blocks start at an "Amendment - n" header; their own fields are named on the row below.
  const blocks = Object.entries(header)
    .map(([letter, text]) => ({ letter, no: Number(/^amendment\s*-?\s*(\d+)$/i.exec(clean(text))?.[1]) }))
    .filter((block) => block.no)
    .sort((a, b) => toIndex(a.letter) - toIndex(b.letter));
  const firstBlock = blocks.length ? toIndex(blocks[0].letter) : Infinity;
  const blockColumns = blocks.map((block, index) => {
    const from = toIndex(block.letter);
    const to = index + 1 < blocks.length ? toIndex(blocks[index + 1].letter) : from + 7;
    const fields: [string, keyof Omit<Amendment, "no">][] = [];
    for (let column = from; column < to; column += 1) {
      const field = AMENDMENT_FIELDS[key(sub[toLetters(column)])];
      if (field) fields.push([toLetters(column), field]);
    }
    return { no: block.no, fields };
  });

  // Issuance columns: the first header match left of the amendment blocks.
  const columns = Object.keys(header).filter((letter) => toIndex(letter) < firstBlock && toIndex(letter) > 0);
  const base: Record<string, string> = {};
  for (const [field, names] of Object.entries(BASE)) {
    const letter = columns.find((column) => names.includes(headerAt(column)) && !Object.values(base).includes(column));
    if (letter) base[field] = letter;
  }
  if (!base.bgNumber || !base.amount) throw new Error("The BG sheet needs a \"BG Number\" and a \"BG Amount\" column.");
  const known = new Set([...Object.values(base), ...blockColumns.flatMap((block) => block.fields.map(([letter]) => letter)), "A"]);

  const start = at + 1 + (blocks.length ? 1 : 0);
  return sheet.rows
    .slice(start)
    .filter((row) => clean(row[base.bgNumber]) || number(row[base.amount]) != null)
    .map((row, index) => {
      const amendments: Amendment[] = blockColumns
        .map((block) => {
          const values = Object.fromEntries(block.fields.map(([letter, field]) => [field, row[letter]])) as Record<string, string>;
          return {
            no: block.no,
            amount: number(values.amount),
            charges: number(values.charges),
            chargesPercent: percent(values.chargesPercent),
            date: iso(date(values.date)),
            expiry: iso(date(values.expiry)),
            claim: iso(date(values.claim)),
            stampDuty: number(values.stampDuty),
          };
        })
        .filter((amendment) => amendment.amount != null || amendment.date || amendment.expiry || amendment.claim || amendment.charges != null);
      // Anything in a column the importer does not know, under its header, so no field is lost.
      const extra = Object.fromEntries(
        Object.entries(row)
          .filter(([letter, value]) => !known.has(letter) && clean(value))
          .map(([letter, value]) => [clean(header[letter]) || clean(sub[letter]) || `Column ${letter}`, clean(value)]),
      );
      const text = (field: string) => clean(row[base[field]]);
      return {
        serialNo: number(row.A) ?? index + 1,
        bgType: text("bgType").toUpperCase(),
        bank: text("bank"),
        marginMoney: text("marginMoney"),
        beneficiary: text("beneficiary"),
        site: text("site"),
        loiLoa: text("loiLoa"),
        bgNumber: text("bgNumber"),
        amount: number(row[base.amount]),
        issueDate: date(row[base.issueDate]),
        charges: number(row[base.charges]),
        chargesPercent: percent(row[base.chargesPercent]),
        details: text("details"),
        amendmentNumber: text("amendmentNumber"),
        amendmentDate: date(row[base.amendmentDate]),
        expiryDate: date(row[base.expiryDate]),
        claimDate: date(row[base.claimDate]),
        stampDuty: number(row[base.stampDuty]),
        amendments: JSON.stringify(amendments),
        extra: Object.keys(extra).length ? JSON.stringify(extra) : null,
      };
    });
}

/** Reads the BG workbook and replaces the BG register. */
export async function importGuarantees(actor: { id: string; role: string }, file: { name: string; buffer: Buffer }) {
  if (!BOND_MANAGERS.includes(actor.role)) throw new Error("Only Accounts, the ISB owner, coordinators, the Department Head or an administrator can import bank guarantees.");
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Upload the BG register as an Excel .xlsx file.");
  const sheets = readWorkbook(file.buffer);
  const sheet =
    sheets.find((item) => item.rows.some((row) => Object.values(row).map(key).includes("bg type"))) ??
    sheets.find((item) => /bg|guarantee/i.test(item.name));
  if (!sheet) throw new Error('The workbook needs a sheet with a "BG Type" header.');
  const rows = parseSheet(sheet);
  if (!rows.length) throw new Error("No bank guarantees were found in the workbook.");
  const importedAt = new Date();
  await db.$transaction(async (tx) => {
    await tx.bankGuarantee.deleteMany({});
    await tx.bankGuarantee.createMany({ data: rows.map((row) => ({ ...row, sourceFile: file.name.slice(0, 250), importedById: actor.id, importedAt })) });
  });
  return { count: rows.length, amended: rows.filter((row) => JSON.parse(row.amendments).length).length };
}

const textOf = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

type Upload = { name: string; type: string; buffer: Buffer };

function assertCanChange(actor: { role: string }) {
  if (!BOND_MANAGERS.includes(actor.role) && actor.role !== "GROUP_CEO") throw new Error("Only Accounts, the ISB owner, coordinators, the Department Head, the Group CEO or an administrator can change a bank guarantee.");
}

/** PBG, APBG and EMD, or the type already stored on this row when the register used another label. */
function bgTypeOf(value: unknown, current = "") {
  const text = textOf(value).slice(0, 64);
  if (text === "PBG" || text === "APBG" || text === "EMD" || (current && text === current)) return text || "PBG";
  return "PBG";
}

/** Issuance columns plus the latest amendment number, from the add and edit forms. */
function guaranteeFields(formData: FormData, amendments: Amendment[], currentType = "") {
  const last = amendments[amendments.length - 1];
  return {
    bgType: bgTypeOf(formData.get("bgType"), currentType),
    bank: textOf(formData.get("bank")),
    marginMoney: textOf(formData.get("marginMoney")),
    beneficiary: textOf(formData.get("beneficiary")),
    site: textOf(formData.get("site")),
    loiLoa: textOf(formData.get("loiLoa")),
    bgNumber: textOf(formData.get("bgNumber")),
    amount: number(textOf(formData.get("amount"))),
    issueDate: date(textOf(formData.get("issueDate"))),
    charges: number(textOf(formData.get("charges"))),
    chargesPercent: percent(textOf(formData.get("chargesPercent"))),
    details: textOf(formData.get("details")).slice(0, 190),
    amendmentNumber: last ? String(last.no) : "",
    amendmentDate: last?.date ? new Date(last.date) : null,
    expiryDate: date(textOf(formData.get("expiryDate"))),
    claimDate: date(textOf(formData.get("claimDate"))),
    stampDuty: number(textOf(formData.get("stampDuty"))),
    amendments: JSON.stringify(amendments),
  };
}

/**
 * Amendment rows in form order. A row keeps the number it already had; a new row takes the next free number.
 * A row with no figures and no file is ignored. Files are renamed so the document is filed as that amendment.
 */
function amendmentsFrom(formData: FormData, amendmentFiles: Upload[]) {
  const nos = formData.getAll("amendmentNo").map(String);
  const amounts = formData.getAll("amendmentAmount").map(String);
  const charges = formData.getAll("amendmentCharges").map(String);
  const percents = formData.getAll("amendmentChargesPercent").map(String);
  const dates = formData.getAll("amendmentDate").map(String);
  const expiries = formData.getAll("amendmentExpiry").map(String);
  const claims = formData.getAll("amendmentClaim").map(String);
  const stamps = formData.getAll("amendmentStamp").map(String);
  const count = Math.max(nos.length, amounts.length, charges.length, percents.length, dates.length, expiries.length, claims.length, stamps.length, amendmentFiles.length);
  let highest = 0;
  for (const value of nos) {
    const given = Number(value);
    if (Number.isInteger(given) && given > highest) highest = given;
  }
  const used = new Set<number>();
  const amendments: Amendment[] = [];
  const files: Upload[] = [];
  for (let index = 0; index < count; index += 1) {
    const amount = number(amounts[index]);
    const charge = number(charges[index]);
    const chargesPercent = percent(percents[index]);
    const when = date(dates[index]);
    const expiry = date(expiries[index]);
    const claim = date(claims[index]);
    const stampDuty = number(stamps[index]);
    const file = amendmentFiles[index];
    if (amount == null && charge == null && chargesPercent == null && !when && !expiry && !claim && stampDuty == null && !file?.buffer.length) continue;
    const given = Number(nos[index]);
    let no = Number.isInteger(given) && given > 0 ? given : ++highest;
    while (used.has(no)) no = ++highest;
    used.add(no);
    if (no > highest) highest = no;
    amendments.push({ no, amount, charges: charge, chargesPercent, date: iso(when), expiry: iso(expiry), claim: iso(claim), stampDuty });
    if (file?.buffer.length) files.push({ ...file, name: `Amendment - ${no} ${file.name}` });
  }
  amendments.sort((a, b) => a.no - b.no);
  return { amendments, files };
}

/** Adds one bank guarantee, with any amendment rows and the scans uploaded with the form. */
export async function createGuarantee(actor: { id: string; role: string }, formData: FormData, issuanceFiles: Upload[], amendmentFiles: Upload[]) {
  assertCanChange(actor);
  const bgNumber = textOf(formData.get("bgNumber"));
  if (bgNumber.length < 4) throw new Error("Enter the BG number.");
  const { bgKey, storeBgDocuments } = await import("./bg-documents");
  const existing = await db.bankGuarantee.findMany({ select: { serialNo: true, bgNumber: true } });
  if (existing.some((row: { bgNumber: string }) => bgKey(row.bgNumber) === bgKey(bgNumber))) throw new Error(`BG number ${bgNumber} is already in the register.`);

  const { amendments, files } = amendmentsFrom(formData, amendmentFiles);
  const serialNo = existing.reduce((max: number, row: { serialNo: number | null }) => Math.max(max, row.serialNo ?? 0), 0) + 1;
  const saved = await db.bankGuarantee.create({
    data: {
      ...guaranteeFields(formData, amendments),
      serialNo,
      sourceFile: "Added in the register",
      importedById: actor.id,
      importedAt: new Date(),
    },
  });
  const stored = await storeBgDocuments(actor, [...issuanceFiles, ...files], bgNumber);
  return { id: saved.id as string, bgNumber, amendments: amendments.length, documents: stored.stored };
}

/** Updates one bank guarantee already in the register. New scans are added; documents already stored stay. */
export async function updateGuarantee(actor: { id: string; role: string }, formData: FormData, issuanceFiles: Upload[], amendmentFiles: Upload[]) {
  assertCanChange(actor);
  const id = textOf(formData.get("id"));
  const current = await db.bankGuarantee.findUnique({ where: { id } });
  if (!current) throw new Error("Bank guarantee not found.");
  const bgNumber = textOf(formData.get("bgNumber"));
  if (bgNumber.length < 4) throw new Error("Enter the BG number.");
  const { bgKey, storeBgDocuments } = await import("./bg-documents");
  const others = await db.bankGuarantee.findMany({ select: { id: true, bgNumber: true } });
  if (others.some((row: { id: string; bgNumber: string }) => row.id !== id && bgKey(row.bgNumber) === bgKey(bgNumber))) throw new Error(`BG number ${bgNumber} is already in the register.`);

  const { amendments, files } = amendmentsFrom(formData, amendmentFiles);
  await db.bankGuarantee.update({ where: { id }, data: guaranteeFields(formData, amendments, String(current.bgType ?? "")) });
  if (bgKey(String(current.bgNumber ?? "")) !== bgKey(bgNumber)) {
    await db.bgDocument.updateMany({ where: { bgNumber: bgKey(String(current.bgNumber ?? "")) }, data: { bgNumber: bgKey(bgNumber) } });
  }
  const stored = await storeBgDocuments(actor, [...issuanceFiles, ...files], bgNumber);
  return { id, bgNumber, amendments: amendments.length, documents: stored.stored };
}

export async function listGuarantees() {
  return db.bankGuarantee.findMany({ orderBy: [{ serialNo: "asc" }] });
}
