import { createHash } from "crypto";
import { existsSync } from "fs";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";
import { repoRoot } from "../utils/root";

/** Bond scans are stored in this folder of the P2P bucket, same layout as the existing ISB copies. */
const TENDER_DOCUMENTS = "Tender Documents";
const TENDER_BUCKET = "p2p-app-storage-master-diorama-489103-u2";
const TENDER_PROJECT = "master-diorama-489103-u2";

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

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
  txt: "text/plain",
};

/** Bond document keys are `isb/<bond number>/<file>`, matching the folder already in the bucket. */
function isBondDocument(key: string) {
  return key.startsWith("isb/");
}

function contentType(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

function tenderObject(key: string) {
  return `${TENDER_DOCUMENTS}/${key.replace(/^\/+/, "")}`;
}

/** The P2P storage helper, when this machine has that project beside Coal & Ash. */
async function tenderDocuments() {
  const file = path.resolve(repoRoot(), "../../P2P/server/src/services/gcsStorage.js");
  if (!existsSync(file)) return null;
  return import(pathToFileURL(file).href) as Promise<{
    uploadToGcs: (gcsPath: string, buffer: Buffer, contentType?: string) => Promise<string | null>;
    downloadFromGcs: (gcsPath: string) => Promise<Buffer | null>;
    deleteFromGcs: (gcsPath: string) => Promise<void>;
  }>;
}

let tenderBucket: import("@google-cloud/storage").Bucket | null = null;

/** Cloud Run has no P2P checkout, so it uses the runtime service account on the same bucket. */
async function getTenderBucket() {
  if (tenderBucket) return tenderBucket;
  const { Storage } = await import("@google-cloud/storage");
  const storage = new Storage({ projectId: TENDER_PROJECT });
  tenderBucket = storage.bucket(TENDER_BUCKET);
  return tenderBucket;
}

/** Puts one bond scan at `Tender Documents/isb/...` in the P2P bucket. */
async function saveBondDocument(key: string, buffer: Buffer, fileName: string) {
  const objectName = tenderObject(key);
  const storage = await tenderDocuments();
  if (storage) {
    const saved = await storage.uploadToGcs(objectName, buffer, contentType(fileName));
    if (!saved) throw new Error("The document could not be stored in Tender Documents.");
    return;
  }
  const bucket = await getTenderBucket();
  await bucket.file(objectName).save(buffer, {
    resumable: false,
    metadata: { contentType: contentType(fileName), cacheControl: "private, max-age=0" },
  });
}

async function readBondDocument(key: string) {
  const objectName = tenderObject(key);
  const storage = await tenderDocuments();
  if (storage) return storage.downloadFromGcs(objectName);
  try {
    const bucket = await getTenderBucket();
    const [bytes] = await bucket.file(objectName).download();
    return bytes;
  } catch {
    return null;
  }
}

async function deleteBondDocument(key: string) {
  const storage = await tenderDocuments();
  if (storage) {
    await storage.deleteFromGcs(tenderObject(key)).catch(() => undefined);
    return;
  }
  try {
    const bucket = await getTenderBucket();
    await bucket.file(tenderObject(key)).delete({ ignoreNotFound: true });
  } catch {
    /* The local copy is still removed. */
  }
}

/**
 * Persist an upload. Returns a portable storage key (relative path), suitable for DB `storedPath`
 * on both local disk and GCS. Bond documents (`isb/...`) are saved in the P2P Tender Documents folder.
 */
export async function storeFile(tenderId: string, fileName: string, buffer: Buffer) {
  const key = `${tenderId}/${Date.now()}-${safeName(fileName)}`;
  if (isBondDocument(key)) {
    if (storageBackend() !== "gcs") {
      const stored = path.join(UPLOAD_ROOT, key);
      await mkdir(path.dirname(stored), { recursive: true });
      await writeFile(stored, buffer);
    }
    await saveBondDocument(key, buffer, fileName);
    return key;
  }
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
  if (storageBackend() !== "gcs") {
    const resolved = path.resolve(UPLOAD_ROOT, key);
    const root = path.resolve(UPLOAD_ROOT);
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new Error("Document path is outside the upload store.");
    }
    try {
      return await readFile(resolved);
    } catch (error) {
      if (!isBondDocument(key)) throw error;
      const cloud = await readBondDocument(key);
      if (cloud) return cloud;
      throw error;
    }
  }
  if (isBondDocument(key)) {
    const cloud = await readBondDocument(key);
    if (cloud) return cloud;
  }
  const bucket = await getGcsBucket();
  const [bytes] = await bucket.file(objectPath(key)).download();
  return bytes;
}

export async function deleteStored(storedPath: string) {
  if (!storedPath) return;
  const key = storageKey(storedPath);
  if (isBondDocument(key)) await deleteBondDocument(key);
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
