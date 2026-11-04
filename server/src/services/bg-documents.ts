import { db } from "../db";
import { BOND_MANAGERS } from "./bonds";
import { sha256, storeFile } from "./files";

/**
 * Scanned bank guarantee documents. Each file is linked to a guarantee by the BG number at the start of its name,
 * e.g. "004GT02242070008.pdf" (the issuance) or "004GT02242830012 Amendment No - 5.pdf" (amendment 5).
 */

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/** BG numbers are compared without spaces or case. */
export const bgKey = (value: string) => value.replace(/\s+/g, "").toUpperCase();

export function parseBgFileName(fileName: string) {
  const base = fileName.split(/[\\/]/).pop() ?? fileName;
  const stem = base.replace(/\.[a-z0-9]+$/i, "");
  const bgNumber = /^\s*([A-Za-z0-9]{6,})/.exec(stem)?.[1] ?? "";
  const amendment = /amend(?:ment)?\.?\s*(?:no\.?)?\s*[-–:#]?\s*(\d+)/i.exec(stem);
  return { bgNumber: bgKey(bgNumber), kind: amendment ? "AMENDMENT" : "ISSUANCE", amendmentNo: amendment ? Number(amendment[1]) : null, fileName: base };
}

/**
 * Stores BG documents. A file already stored (same content) is skipped; a file whose name has no BG number is refused.
 * Files for a BG number that is not in the register yet are kept and show up once that BG is imported.
 */
export async function storeBgDocuments(actor: { id: string; role: string }, files: { name: string; type: string; buffer: Buffer }[], forBg = "") {
  if (!BOND_MANAGERS.includes(actor.role) && actor.role !== "GROUP_CEO") throw new Error("Only Accounts, the ISB owner, coordinators, the Department Head, the Group CEO or an administrator can add BG documents.");
  const known = new Set((await db.bankGuarantee.findMany({})).map((row: { bgNumber: string }) => bgKey(row.bgNumber)));
  const result = { stored: 0, duplicate: 0, unmatched: [] as string[], unnamed: [] as string[], tooLarge: [] as string[] };
  for (const file of files) {
    const parsed = parseBgFileName(file.name);
    if (forBg) parsed.bgNumber = bgKey(forBg);
    if (!parsed.bgNumber) {
      result.unnamed.push(parsed.fileName);
      continue;
    }
    if (file.buffer.length > 25 * 1024 * 1024) {
      result.tooLarge.push(parsed.fileName);
      continue;
    }
    const hash = sha256(file.buffer);
    if (await db.bgDocument.findFirst({ where: { sha256: hash } })) {
      result.duplicate += 1;
      continue;
    }
    const storedPath = await storeFile(`bg/${parsed.bgNumber}`, parsed.fileName, file.buffer);
    const ext = parsed.fileName.split(".").pop()?.toLowerCase() ?? "";
    await db.bgDocument.create({
      data: {
        bgNumber: parsed.bgNumber,
        kind: parsed.kind,
        amendmentNo: parsed.amendmentNo,
        fileName: parsed.fileName.slice(0, 250),
        storedPath,
        mimeType: file.type && file.type !== "application/octet-stream" ? file.type : MIME[ext] ?? "application/octet-stream",
        sizeBytes: file.buffer.length,
        sha256: hash,
        uploadedById: actor.id,
      },
    });
    result.stored += 1;
    if (!known.has(parsed.bgNumber)) result.unmatched.push(parsed.fileName);
  }
  return result;
}

export async function documentsFor(bgNumber: string) {
  const rows = await db.bgDocument.findMany({ where: { bgNumber: bgKey(bgNumber) } });
  return rows
    .map(({ storedPath: _path, sha256: _hash, ...rest }: Record<string, unknown>) => rest)
    .sort((a: any, b: any) => (a.kind === b.kind ? (a.amendmentNo ?? 0) - (b.amendmentNo ?? 0) : a.kind === "ISSUANCE" ? -1 : 1));
}

/** How many documents each BG number has, for the register table. */
export async function documentCounts() {
  const counts: Record<string, number> = {};
  for (const row of await db.bgDocument.findMany({})) counts[row.bgNumber] = (counts[row.bgNumber] ?? 0) + 1;
  return counts;
}
