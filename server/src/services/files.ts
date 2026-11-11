import { createHash } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { deleteObject, docsBucketName, downloadAppObject, downloadObject, tenderBucketName, tenderObjectName, uploadAppObject, uploadObject } from "./gcs";
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

function contentType(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

async function saveCloudCopy(key: string, buffer: Buffer, fileName: string) {
  await uploadObject(tenderBucketName(), tenderObjectName(key), buffer, contentType(fileName));
}

async function readCloudCopy(key: string) {
  const bucketName = docsBucketName() || "coal-ash-docs-master-diorama-489103-u2";
  const prefixed = objectPath(key);
  const fromApp = await downloadAppObject(bucketName, prefixed);
  if (fromApp) return fromApp;
  if (prefixed !== key) {
    const bare = await downloadAppObject(bucketName, key);
    if (bare) return bare;
  }
  try {
    return await downloadObject(tenderBucketName(), tenderObjectName(key));
  } catch {
    return null;
  }
}

/**
 * Persist an upload. Every file is also stored at `Tender Documents/<key>` so a later
 * live open can find tender notices as well as BG and ISB scans.
 */
export async function storeFile(tenderId: string, fileName: string, buffer: Buffer) {
  const key = `${tenderId}/${Date.now()}-${safeName(fileName)}`;
  const type = contentType(fileName);
  if (storageBackend() === "gcs") {
    const bucketName = docsBucketName() || "coal-ash-docs-master-diorama-489103-u2";
    try {
      await uploadAppObject(bucketName, objectPath(key), buffer, type);
    } catch {
      await saveCloudCopy(key, buffer, fileName);
      return key;
    }
    await saveCloudCopy(key, buffer, fileName).catch(() => undefined);
    return key;
  }
  const stored = path.join(UPLOAD_ROOT, key);
  await mkdir(path.dirname(stored), { recursive: true });
  await writeFile(stored, buffer);
  await saveCloudCopy(key, buffer, fileName).catch(() => undefined);
  return key;
}

async function readLocal(key: string) {
  const resolved = path.resolve(UPLOAD_ROOT, key);
  const root = path.resolve(UPLOAD_ROOT);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Document path is outside the upload store.");
  }
  return readFile(resolved);
}

export async function readStored(storedPath: string) {
  const key = storageKey(storedPath);
  try {
    return await readLocal(key);
  } catch (error) {
    const cloud = await readCloudCopy(key);
    if (cloud) return cloud;
    throw error;
  }
}

export async function deleteStored(storedPath: string) {
  if (!storedPath) return;
  const key = storageKey(storedPath);
  await deleteObject(tenderBucketName(), tenderObjectName(key)).catch(() => undefined);
  if (storageBackend() === "gcs") {
    await deleteObject(tenderBucketName(), tenderObjectName(key)).catch(() => undefined);
    const bucketName = docsBucketName();
    if (bucketName) await deleteObject(bucketName, objectPath(key)).catch(() => undefined);
    return;
  }
  const resolved = path.resolve(UPLOAD_ROOT, key);
  const root = path.resolve(UPLOAD_ROOT);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error("Document path is outside the upload store.");
  }
  await unlink(resolved).catch(() => undefined);
}

const SPREADSHEET_EXT = [".xlsx", ".xls", ".xlsm", ".xlsb"];

/** Excel workbooks. These are stored with the tender but shown only to the Group CEO. */
export function isSpreadsheet(fileName: string, mime = "") {
  const lower = fileName.toLowerCase();
  const type = mime.toLowerCase();
  return SPREADSHEET_EXT.some((ext) => lower.endsWith(ext)) || type.includes("spreadsheet") || type === "application/vnd.ms-excel";
}

export function allowedUpload(fileName: string, mime: string) {
  const lower = fileName.toLowerCase();
  const mimeOk = ["application/pdf", "text/plain", "image/png", "image/jpeg", "image/webp", "image/tiff"].includes(mime);
  const extOk = [".pdf", ".txt", ".png", ".jpg", ".jpeg", ".webp", ".tif", ".tiff", ...SPREADSHEET_EXT].some((ext) => lower.endsWith(ext));
  return mimeOk || extOk || isSpreadsheet(fileName, mime);
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
