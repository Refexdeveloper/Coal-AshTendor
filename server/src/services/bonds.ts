import { db } from "../db";
import { readWorkbook, type Sheet } from "./xlsx";

/**
 * The bond register: EMD insurance surety bonds (ISB) and performance bonds,
 * imported from the "Performance Bond & EMD ISB Data" workbook. An import replaces the whole register.
 */

export const BOND_MANAGERS = ["ADMIN", "ACCOUNTS", "EMD_ISB", "COORDINATOR", "DEPT_HEAD"];

const STATES: Record<string, string> = {
  CG: "Chhattisgarh",
  MP: "Madhya Pradesh",
  WB: "West Bengal",
  UP: "Uttar Pradesh",
  OD: "Odisha",
  OR: "Odisha",
  MH: "Maharashtra",
  JH: "Jharkhand",
  BR: "Bihar",
  TN: "Tamil Nadu",
  TS: "Telangana",
  AP: "Andhra Pradesh",
  KA: "Karnataka",
  GJ: "Gujarat",
  RJ: "Rajasthan",
  HR: "Haryana",
  AS: "Assam",
  DL: "Delhi",
};

const clean = (value: string | undefined) => (value ?? "").replace(/\s+/g, " ").trim();

function number(value: string | undefined) {
  const text = clean(value).replace(/,/g, "").replace(/^(rs\.?|inr|₹)\s*/i, "");
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Excel serial days (from 1899-12-30) or "dd.mm.yyyy" / "dd/mm/yyyy" / "dd-mm-yyyy". Noon UTC so the day never shifts. */
function date(value: string | undefined) {
  const text = clean(value);
  if (!text) return null;
  if (/^\d+(\.\d+)?$/.test(text)) {
    const serial = Number(text);
    if (serial < 20000 || serial > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 864e5 + 12 * 36e5);
  }
  const match = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/.exec(text);
  if (!match) return null;
  const year = Number(match[3].length === 2 ? `20${match[3]}` : match[3]);
  const parsed = new Date(Date.UTC(year, Number(match[2]) - 1, Number(match[1]), 12));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/** 0.008 in the sheet means 0.8 %; 1.2 already means 1.2 %. */
function percent(value: string | undefined) {
  const parsed = number(value);
  if (parsed == null) return null;
  return parsed < 0.1 ? +(parsed * 100).toFixed(4) : parsed;
}

function state(value: string | undefined) {
  const text = clean(value);
  return STATES[text.toUpperCase()] ?? text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function line(value: string | undefined) {
  return clean(value).toUpperCase();
}

/** "ISB No.46010056259100000025", "ISB on 4601…" → the number itself. */
function bondNumber(value: string | undefined) {
  const text = clean(value);
  const digits = /(\d[\d/-]{7,})/.exec(text)?.[1];
  return digits ?? text;
}

/** Finds the header row by the cells a header must have, so a title row or blank rows above it do not matter. */
function headerRow(sheet: Sheet, must: string[]) {
  const at = sheet.rows.findIndex((row) => {
    const values = Object.values(row).map((cell) => clean(cell).toLowerCase());
    return must.every((word) => values.some((cell) => cell.includes(word)));
  });
  if (at < 0) throw new Error(`The "${sheet.name}" sheet does not have the expected header row (${must.join(", ")}).`);
  return at;
}

type BondRow = Record<string, unknown>;

function emdRows(sheet: Sheet): BondRow[] {
  const start = headerRow(sheet, ["tender id", "emd amount", "bond no"]) + 1;
  return sheet.rows
    .slice(start)
    .filter((row) => (row.D || row.E || row.G) && number(row.H) != null)
    .map((row) => ({
      kind: "EMD",
      serialNo: number(row.A),
      state: state(row.B),
      line: line(row.C),
      tenderRef: clean(row.D),
      tenderDetails: clean(row.E),
      plant: clean(row.F),
      customer: clean(row.G),
      amount: number(row.H),
      onlineAmount: number(row.I),
      isbAmount: number(row.J),
      broker: clean(row.K),
      insurer: clean(row.L),
      bondNumber: bondNumber(row.M),
      issueDate: date(row.N),
      startDate: date(row.O),
      expiryDate: date(row.P),
      claimExpiryDate: date(row.Q),
      ext1IssueDate: date(row.R),
      ext1StartDate: date(row.S),
      ext1ExpiryDate: date(row.T),
      ext1ClaimDate: date(row.U),
      premium: number(row.V),
      premiumPercent: percent(row.W),
      stampDuty: number(row.X),
      mode: clean(row.Y),
      transferType: clean(row.Z),
      status: clean(row.AA),
    }));
}

function performanceRows(sheet: Sheet): BondRow[] {
  const start = headerRow(sheet, ["company name", "bond number", "bond value"]) + 1;
  return sheet.rows
    .slice(start)
    .filter((row) => clean(row.B) && !/^total/i.test(clean(row.B)) && number(row.G) != null)
    .map((row) => ({
      kind: "PERFORMANCE",
      serialNo: number(row.A),
      customer: clean(row.B),
      tenderRef: clean(row.C),
      broker: clean(row.D),
      insurer: clean(row.E),
      bondNumber: bondNumber(row.F),
      amount: number(row.G),
      issueDate: date(row.H),
      startDate: date(row.I),
      expiryDate: date(row.J),
      claimExpiryDate: date(row.K),
      ext1IssueDate: date(row.L),
      ext1ExpiryDate: date(row.M),
      ext1ClaimDate: date(row.N),
      ext2Date: date(row.O),
      ext2ClaimDate: date(row.P),
      premium: number(row.Q),
      premiumPercent: percent(row.R),
      stampDuty: number(row.S),
      usedFor: clean(row.T),
      // The performance bond sheet has no Ash/Coal or state column; they stay blank rather than guessed.
      line: "",
      state: "",
    }));
}

/** Reads the workbook and replaces the register. Returns how many bonds of each kind were stored. */
export async function importBonds(actor: { id: string; role: string }, file: { name: string; buffer: Buffer }) {
  if (!BOND_MANAGERS.includes(actor.role)) throw new Error("Only Accounts, the ISB owner, coordinators, the Department Head or an administrator can import bonds.");
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Upload the bond register as an Excel .xlsx file.");
  const sheets = readWorkbook(file.buffer);
  const find = (pattern: RegExp) => sheets.find((sheet) => pattern.test(sheet.name));
  const emdSheet = find(/emd|isb/i);
  const pbSheet = find(/performance|pbg|bond/i);
  if (!emdSheet && !pbSheet) throw new Error('The workbook needs an "EMD" sheet or a "Performance Bond" sheet.');
  const rows = [...(emdSheet ? emdRows(emdSheet) : []), ...(pbSheet && pbSheet !== emdSheet ? performanceRows(pbSheet) : [])];
  if (!rows.length) throw new Error("No bonds were found in the workbook.");
  const importedAt = new Date();
  await db.$transaction(async (tx) => {
    // Only the kinds present in this workbook are replaced.
    if (emdSheet) await tx.suretyBond.deleteMany({ where: { kind: "EMD" } });
    if (pbSheet && pbSheet !== emdSheet) await tx.suretyBond.deleteMany({ where: { kind: "PERFORMANCE" } });
    await tx.suretyBond.createMany({ data: rows.map((row) => ({ ...row, sourceFile: file.name.slice(0, 250), importedById: actor.id, importedAt })) });
  });
  return { emd: rows.filter((row) => row.kind === "EMD").length, performance: rows.filter((row) => row.kind === "PERFORMANCE").length };
}

export async function listBonds() {
  return db.suretyBond.findMany({ orderBy: [{ kind: "asc" }, { serialNo: "asc" }] });
}
