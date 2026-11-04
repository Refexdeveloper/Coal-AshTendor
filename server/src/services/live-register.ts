import { existsSync, readFileSync } from "fs";
import path from "path";
import { db } from "../db";
import { repoRoot } from "../utils/root";

/**
 * The live Cloud SQL database starts empty. On Cloud Run, copy the local register in
 * once, and only when that table has no rows, so a later edit is left alone.
 */
const SNAPSHOTS = [
  { model: "bankGuarantee", file: "bank-guarantees.json", dates: ["issueDate", "amendmentDate", "expiryDate", "claimDate", "importedAt"] },
  { model: "suretyBond", file: "surety-bonds.json", dates: ["issueDate", "startDate", "expiryDate", "claimExpiryDate", "ext1IssueDate", "ext1StartDate", "ext1ExpiryDate", "ext1ClaimDate", "ext2Date", "ext2ClaimDate", "importedAt"] },
  { model: "bgDocument", file: "bg-documents.json", dates: ["uploadedAt"] },
  { model: "bondDocument", file: "bond-documents.json", dates: ["uploadedAt"] },
] as const;

function revive(row: Record<string, unknown>, dates: readonly string[]) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key] = dates.includes(key) && typeof value === "string" && value ? new Date(value) : value;
  }
  return out;
}

export async function restoreLiveRegisters() {
  if (!process.env.K_SERVICE) return;
  const dir = path.join(repoRoot(), "registers");
  for (const snapshot of SNAPSHOTS) {
    const file = path.join(dir, snapshot.file);
    if (!existsSync(file)) continue;
    const count = await db[snapshot.model].count();
    if (count > 0) continue;
    const rows = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>[];
    if (!rows.length) continue;
    await db[snapshot.model].createMany({ data: rows.map((row) => revive(row, snapshot.dates)) });
    console.log(`[db] Loaded ${rows.length} ${snapshot.file} rows into the live register`);
  }
}
