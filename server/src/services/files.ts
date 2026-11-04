import { createHash } from "crypto";
import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { deleteObject, docsBucketName, downloadObject, tenderBucketName, tenderObjectName, uploadObject } from "./gcs";
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

function requireDocsBucket() {
  const name = docsBucketName();
  if (!name) throw new Error("STORAGE_BACKEND=gcs requires GCS_BUCKET");
  return name;
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

/** Bank guarantee and surety-bond scans live under Tender Documents. */
function isRegisterScan(key: string) {
  return key.startsWith("bg/") || key.startsWith("isb/");
}

function contentType(fileName: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MIME[ext] ?? "application/octet-stream";
}

async function saveRegisterScan(key: string, buffer: Buffer, fileName: string) {
  await uploadObject(tenderBucketName(), tenderObjectName(key), buffer, contentType(fileName));
}

async function readRegisterScan(key: string) {
  try {
    return await downloadObject(tenderBucketName(), tenderObjectName(key));
  } catch {
    return null;
  }
}

/**
 * Persist an upload. Bond and bank-guarantee scans are also stored at
 * `Tender Documents/bg/...` or `Tender Documents/isb/...` in the P2P bucket.
 */
export async function storeFile(tenderId: string, fileName: string, buffer: Buffer) {
  const key = `${tenderId}/${Date.now()}-${safeName(fileName)}`;
  if (storageBackend() === "gcs") {
    await uploadObject(requireDocsBucket(), objectPath(key), buffer, contentType(fileName));
  } else {
    const stored = path.join(UPLOAD_ROOT, key);
    await mkdir(path.dirname(stored), { recursive: true });
    await writeFile(stored, buffer);
  }
  if (isRegisterScan(key)) await saveRegisterScan(key, buffer, fileName).catch(() => undefined);
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
      if (!isRegisterScan(key)) throw error;
      const cloud = await readRegisterScan(key);
      if (cloud) return cloud;
      throw error;
    }
  }
  if (isRegisterScan(key)) {
    const cloud = await readRegisterScan(key);
    if (cloud) return cloud;
  }
  const bytes = await downloadObject(requireDocsBucket(), objectPath(key));
  if (!bytes) throw new Error("File missing");
  return bytes;
}

export async function deleteStored(storedPath: string) {
  if (!storedPath) return;
  const key = storageKey(storedPath);
  if (isRegisterScan(key)) await deleteObject(tenderBucketName(), tenderObjectName(key)).catch(() => undefined);
  if (storageBackend() === "gcs") {
    await deleteObject(requireDocsBucket(), objectPath(key));
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
