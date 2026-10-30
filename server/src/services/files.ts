import { createHash } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { repoRoot } from "../utils/root";

export type StorageBackend = "local" | "gcs";

export const UPLOAD_ROOT = path.join(repoRoot(), "data", "uploads");

export function storageBackend(): StorageBackend {
  const value = (process.env.STORAGE_BACKEND || "local").toLowerCase();
  return value === "gcs" ? "gcs" : "local";
}

function gcsPrefix() {
  const prefix = (process.env.GCS_PREFIX || "coal-ash-docs/").replace(/^\/+/, "");
  return prefix.endsWith("/") || prefix === "" ? prefix : `${prefix}/`;
}

function objectPath(key: string) {
  return `${gcsPrefix()}${key.replace(/^\/+/, "")}`;
}

let gcsBucket: import("@google-cloud/storage").Bucket | null = null;

async function getGcsBucket() {
  if (gcsBucket) return gcsBucket;
  const bucketName = process.env.GCS_BUCKET;
  if (!bucketName) throw new Error("STORAGE_BACKEND=gcs requires GCS_BUCKET");
  const { Storage } = await import("@google-cloud/storage");
  const storage = new Storage();
  gcsBucket = storage.bucket(bucketName);
  return gcsBucket;
}

export function sha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function safeName(fileName: string) {
  const cleaned = fileName.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+/, "");
  return (cleaned || "document").slice(0, 80);
}

/** Normalize DB values to a storage key (relative under uploads / GCS prefix). */
export function storageKey(storedPath: string) {
  if (!storedPath) return "";
  if (storedPath.startsWith("gcs://")) {
    const without = storedPath.slice("gcs://".length);
    const slash = without.indexOf("/");
    return slash >= 0 ? without.slice(slash + 1).replace(new RegExp(`^${gcsPrefix().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), "") : without;
  }
  if (path.isAbsolute(storedPath)) {
    const relative = path.relative(UPLOAD_ROOT, path.resolve(storedPath));
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Document path is outside the upload store.");
    }
    return relative.split(path.sep).join("/");
  }
  const normalized = storedPath.replace(/^\/+/, "").split(path.sep).join("/");
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    throw new Error("Document path is outside the upload store.");
  }
  return normalized;
}

/**
 * Persist an upload. Returns a portable storage key (relative path), suitable for DB `storedPath`
 * on both local disk and GCS.
 */
export async function storeFile(tenderId: string, fileName: string, buffer: Buffer) {
  const key = `${tenderId}/${Date.now()}-${safeName(fileName)}`;
  if (storageBackend() === "gcs") {
    const bucket = await getGcsBucket();
    await bucket.file(objectPath(key)).save(buffer, {
      resumable: false,
      metadata: { cacheControl: "private, max-age=0" },
    });
    return key;
  }
  const stored = path.join(UPLOAD_ROOT, key);
  await mkdir(path.dirname(stored), { recursive: true });
  await writeFile(stored, buffer);
  return key;
}

export async function readStored(storedPath: string) {
  const key = storageKey(storedPath);
  if (storageBackend() === "gcs") {
    const bucket = await getGcsBucket();
    const [bytes] = await bucket.file(objectPath(key)).download();
    return bytes;
  }
  const resolved = path.resolve(UPLOAD_ROOT, key);
  const root = path.resolve(UPLOAD_ROOT);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Document path is outside the upload store.");
  }
  return readFile(resolved);
}

export async function deleteStored(storedPath: string) {
  if (!storedPath) return;
  const key = storageKey(storedPath);
  if (storageBackend() === "gcs") {
    const bucket = await getGcsBucket();
    await bucket.file(objectPath(key)).delete({ ignoreNotFound: true });
    return;
  }
  const resolved = path.resolve(UPLOAD_ROOT, key);
  const root = path.resolve(UPLOAD_ROOT);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Document path is outside the upload store.");
  }
  await unlink(resolved).catch(() => undefined);
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
      const pages = (Array.isArray(result.text) ? result.text : [String(result.text)]).map((page) => page ?? "");
      return { pages, failed: pages.join("").trim().length < 15 };
    } catch (error) {
      console.error("PDF text extraction failed", error);
      return { pages: [] as string[], failed: true };
    }
  }
  return { pages: [] as string[], failed: true };
}

export function storageLabel() {
  if (storageBackend() === "gcs") {
    return `gcs://${process.env.GCS_BUCKET || "?"}/${gcsPrefix()}`;
  }
  return `local://${UPLOAD_ROOT}`;
}
