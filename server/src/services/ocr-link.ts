import { createHmac, timingSafeEqual } from "crypto";
import { readFileSync } from "fs";
import path from "path";
import { UPLOAD_ROOT, safeName } from "./files";
import { repoRoot } from "../utils/root";

const TEN_MINUTES = 10 * 60 * 1000;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value) throw new Error("SESSION_SECRET is not set");
  return value;
}

function sign(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function ocrPublicBase() {
  try {
    const published = readFileSync(path.join(repoRoot(), "data", "ocr-public-base.txt"), "utf8").trim();
    if (published) return published.replace(/\/$/, "");
  } catch {
    // No published address yet; fall through to env.
  }
  return (process.env.OCR_PUBLIC_BASE_URL || process.env.APP_URL || "http://localhost:5173").replace(/\/$/, "");
}

/** Short-lived link the OCR service can download. The path is signed, not guessed. */
export function ocrFileUrl(storedPath: string, fileName: string) {
  const relative = path.relative(UPLOAD_ROOT, path.resolve(storedPath));
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Document path is outside the upload store.");
  const payload = Buffer.from(JSON.stringify({ p: relative, exp: Date.now() + TEN_MINUTES }), "utf8").toString("base64url");
  const token = `${payload}.${sign(payload)}`;
  const base = ocrPublicBase();
  return `${base}/api/ocr-files/${token}/${safeName(fileName)}`;
}

export function pathFromOcrToken(token: string) {
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return null;
  const expected = sign(payload);
  const given = Buffer.from(signature);
  const actual = Buffer.from(expected);
  if (given.length !== actual.length || !timingSafeEqual(given, actual)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { p?: string; exp?: number };
    if (!parsed.p || !parsed.exp || parsed.exp < Date.now()) return null;
    const resolved = path.resolve(UPLOAD_ROOT, parsed.p);
    const root = path.resolve(UPLOAD_ROOT);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) return null;
    return resolved;
  } catch {
    return null;
  }
}
