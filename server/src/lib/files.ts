import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { repoRoot } from "./root";

export const UPLOAD_ROOT = path.join(repoRoot(), "data", "uploads");

export function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function safeName(fileName: string) {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+/, "");
  return (cleaned || "document").slice(0, 80);
}

export async function storeFile(tenderId: string, fileName: string, buffer: Buffer) {
  const dir = path.join(UPLOAD_ROOT, tenderId);
  await mkdir(dir, { recursive: true });
  const stored = path.join(dir, `${Date.now()}-${safeName(fileName)}`);
  await writeFile(stored, buffer);
  return stored;
}

export async function readStored(storedPath: string) {
  const root = path.resolve(UPLOAD_ROOT);
  const resolved = path.resolve(storedPath);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Document path is outside the upload store.");
  }
  return readFile(resolved);
}

export function allowedUpload(fileName: string, mime: string) {
  const lower = fileName.toLowerCase();
  const mimeOk = ["application/pdf", "text/plain", "image/png", "image/jpeg", "image/webp", "image/tiff"].includes(mime);
  const extOk = [".pdf", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff"].some((ext) => lower.endsWith(ext));
  return mimeOk || extOk;
}

export async function pagesFromBuffer(buffer: Buffer, mime: string, fileName: string) {
  const lower = fileName.toLowerCase();
  if (mime === "text/plain" || lower.endsWith(".txt")) {
    const text = buffer.toString("utf8");
    return { pages: [text], failed: text.trim().length < 15 };
  }
  if (mime === "application/pdf" || lower.endsWith(".pdf")) {
    try {
      const { extractText } = await import("unpdf");
      const result = await extractText(new Uint8Array(buffer), { mergePages: false });
      const pages = (Array.isArray(result.text) ? result.text : [result.text]).map((page) => page ?? "");
      return { pages, failed: pages.join("").trim().length < 15 };
    } catch (error) {
      console.error("PDF text extraction failed", error);
      return { pages: [] as string[], failed: true };
    }
  }
  return { pages: [] as string[], failed: true };
}
