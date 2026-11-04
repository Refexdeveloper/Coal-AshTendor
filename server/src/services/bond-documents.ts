import { db } from "../db";
import { BOND_MANAGERS } from "./bonds";
import { sha256, storeFile } from "./files";

/**
 * ISB copies: scanned EMD and PBG surety bonds, linked to a bond in the register by the digits of its bond number
 * ("12-6621-0011144971-00.pdf", "42250056255100000060 Ext-2.pdf"). Hyphens and spaces in either the file name or
 * the sheet do not matter. A number one digit off a single bond (a typo on either side) is linked to that bond and
 * marked as a close match; anything else is stored unlinked and can be attached from the bond's page.
 */

const MIME: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", tif: "image/tiff", tiff: "image/tiff" };

export const bondKey = (value: string) => value.replace(/\D+/g, "");

export function parseBondFileName(fileName: string) {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const stem = base.replace(/\.[a-z0-9]+$/i, "");
  const extension = /\bext(?:n|ension)?\.?\s*[-–:#]?\s*(\d+)/i.exec(stem);
  // The number is what comes before "Ext…", without a trailing copy marker such as " 1".
  const numberPart = stem.replace(/\s*\bext(?:n|ension)?\b.*$/i, "").replace(/\s+\d{1,2}$/, "");
  return { fileKey: bondKey(numberPart), kind: extension ? "EXTENSION" : "ISSUANCE", extensionNo: extension ? Number(extension[1]) : null, fileName: base };
}

/** True when two digit strings differ by one added, removed or changed digit. */
function oneEdit(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

/** Which bond number a file belongs to: the same digits, else the one bond a digit away, else none. */
function resolve(fileKey: string, keys: string[]) {
  if (keys.includes(fileKey)) return { key: fileKey, matchedBy: "EXACT" };
  const close = [...new Set(keys.filter((key) => key.length >= 8 && oneEdit(key, fileKey)))];
  if (close.length === 1) return { key: close[0], matchedBy: "CLOSE" };
  return { key: fileKey, matchedBy: "NONE" };
}

export async function storeBondDocuments(actor: { id: string; role: string }, files: { name: string; type: string; buffer: Buffer }[], forBondId = "") {
  if (!BOND_MANAGERS.includes(actor.role)) throw new Error("Only Accounts, the ISB owner, coordinators, the Department Head or an administrator can add ISB documents.");
  const bonds = await db.suretyBond.findMany({});
  const keys = bonds.map((bond: { bondNumber: string }) => bondKey(bond.bondNumber)).filter(Boolean);
  const target = forBondId ? bonds.find((bond: { id: string }) => bond.id === forBondId) : null;
  if (forBondId && !target) throw new Error("That bond is not in the register.");
  const result = { stored: 0, duplicate: 0, close: [] as string[], unmatched: [] as string[], unnamed: [] as string[], tooLarge: [] as string[] };
  for (const file of files) {
    const parsed = parseBondFileName(file.name);
    // Short numbers (e.g. "862") are fine when a bond carries exactly that number.
    if (!target && parsed.fileKey.length < 8 && !keys.includes(parsed.fileKey)) {
      result.unnamed.push(parsed.fileName);
      continue;
    }
    if (file.buffer.length > 25 * 1024 * 1024) {
      result.tooLarge.push(parsed.fileName);
      continue;
    }
    const hash = sha256(file.buffer);
    if (await db.bondDocument.findFirst({ where: { sha256: hash } })) {
      result.duplicate += 1;
      continue;
    }
    const link = target ? { key: bondKey(target.bondNumber), matchedBy: "MANUAL" } : resolve(parsed.fileKey, keys);
    const storedPath = await storeFile(`isb/${link.key || "unlinked"}`, parsed.fileName, file.buffer);
    const ext = parsed.fileName.split(".").pop()?.toLowerCase() ?? "";
    await db.bondDocument.create({
      data: {
        bondKey: link.key,
        fileKey: parsed.fileKey,
        matchedBy: link.matchedBy,
        kind: parsed.kind,
        extensionNo: parsed.extensionNo,
        fileName: parsed.fileName.slice(0, 250),
        storedPath,
        mimeType: file.type && file.type !== "application/octet-stream" ? file.type : MIME[ext] ?? "application/octet-stream",
        sizeBytes: file.buffer.length,
        sha256: hash,
        uploadedById: actor.id,
      },
    });
    result.stored += 1;
    if (link.matchedBy === "CLOSE") result.close.push(parsed.fileName);
    if (link.matchedBy === "NONE") result.unmatched.push(parsed.fileName);
  }
  return result;
}

export async function documentsForBond(bondNumber: string) {
  const rows = await db.bondDocument.findMany({ where: { bondKey: bondKey(bondNumber) } });
  return rows
    .map(({ storedPath: _path, sha256: _hash, ...rest }: Record<string, unknown>) => rest)
    .sort((a: any, b: any) => (a.kind === b.kind ? (a.extensionNo ?? 0) - (b.extensionNo ?? 0) || String(a.fileName).localeCompare(String(b.fileName)) : a.kind === "ISSUANCE" ? -1 : 1));
}

/** Documents per bond-number key, for the register table. */
export async function bondDocumentCounts() {
  const counts: Record<string, number> = {};
  for (const row of await db.bondDocument.findMany({})) counts[row.bondKey] = (counts[row.bondKey] ?? 0) + 1;
  return counts;
}
