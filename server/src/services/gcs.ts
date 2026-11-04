import { existsSync, readFileSync } from "fs";
import { Storage, type Bucket } from "@google-cloud/storage";

const PROJECT = "master-diorama-489103-u2";

/** Same account as the P2P app, so local and Cloud Run can reach the bucket without a key file. */
const GCS_SERVICE_ACCOUNT = {
  type: "service_account",
  project_id: "master-diorama-489103-u2",
  private_key_id: "4578ba92e8e4f622ce5eead8fcb80089de06b023",
  private_key:
    "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC5nMjWRhlIaULu\nK98YTdQKxo9EJTNsBHj2SWUZkWU2t6Ikkq6tZiJh99s1pgbHrNJqC+dvDIUGzwb8\nH+JhoA/bDUuKYmVoKzexIlgHI8r7DNILr1YYWw1yX+jSv4/I5pfnoKWuCpp31r8b\nCmxRGYsnCYaZlg3FXYkqqEX8bCVmZxjHv3EQrtglODWjAH7lDkZXfOSabhT95Jpp\n2nQXT6+9xjNTD650WAIMJFc2CoEliaIZ17BkOm9ntfxR0TGbrMNqvjOOrRqily5I\nf+a8t5lcwBl1sGNKjny0yrkmP38hd0pXT0yqRVCW4lRJb4hnkgSFx5IkubOJRuZu\nb44x3et5AgMBAAECggEAGhx7xmUDHoQsVbwXPOCKAWAQfHotQzdX2vHVRqUFE47+\nwN1ftGYHVTfcfy4VixZ9XUzCaIVe22fZaDOGEczGHj8/Dr8r290kjwcxUgPPhMS3\nccxfNLruZ9YlNyyaqh0CZqPbWuID+/LaXI/5T+ljgYDeDhIlasvvRXB5s/p0wnRl\nzaZlIkebE+lFnySV5iz+X27yXsooeXaI2T/236ljyqJNHfSyUrX82MrnVt8C1Zoh\nZ0fL/rJRciXGS/0QX1J+TfBc0i0yUs1cC/QilFazD2VaLHJkORJkds2D20dqlby5\noC+obAXASMYYMJe8pmeCOq20FqGuoU1DmpNDOp9R1wKBgQDw1rtgMDlF517qJvKa\njV6Esr2iIJqC33TPh1LrKZDUnc5Mm3CGMwTRX8yLapAlsm9J1R88amQ1crFPjigw\n/hWtpzB0XoyjAOsX0PotYVW5WWwlPIUpre4Hj+CRCkVp8KDSjx13GFYxjc6tFwfi\n2PB/8u83LxcPC46GaePPcLnN3wKBgQDFTAuVPQPB4DU+wXPkyx4vc3qqinjcnXGa\nRTu2iGpjq2mvNBRh/F7LlC2ygVDad7olIza7Eviq7dWVSy6YLBv2KqmlS0FCqmLT\n/1AeVU60X8gIcYVIiaiXp0hMC7m43EcmsLWn/DHIJq4U4tqRjAQy6zroXmTBiTuQ\nYPyYuv1BpwKBgQDnV81ry0bowCSrVbhK/6sgWrXQC/N/7Xg+dSYQYMAPjHqDmfiP\n4GgrWxOXhEhs/abrTD6SATy7Hq311n8C+L8ILQZdcgkz9wjcus/mUY5P2fcJGcZs\nT/fK6cj0aeJdrlg9il3qbcU2GprCJ9JadLsonMpuvtwuhpJkyUiclhLVDwKBgEJS\n2QX3N98hzuRkxd/gxCnxaQgReqW3K6xPn84xt4n/4owqNrvlybwn+OCsBhEa9HFt\nkAV9UCitwQHp/yTalx++ob7WOH7/pi9cAYPg649JL4ZfGw4ScKFic7RUsL9LFYQV\nHUv2RInjLtwIkq8g4Xx4hRn+OWKyDlrvr5psKZy7AoGAQV0/HOioTr5Jhv6jGNmR\nNJd55IuXyqI4g8/P3wgVhgjU0D7qvFoo28ftsLcY+OsiAxieEx5G/NnknAp77R1O\niDDHgi2EUHY/gLz9VbyPPI99tbZl0GEkD5Umx+25DvnwS7ODjw535CD/VcnGmNCd\ncGa6j7OUbIYh0EDzbkvswbA=\n-----END PRIVATE KEY-----\n",
  client_email: "p2p-app-sa@master-diorama-489103-u2.iam.gserviceaccount.com",
  client_id: "105072988660378389770",
  universe_domain: "googleapis.com",
};

let client: Storage | null = null;
const buckets = new Map<string, Bucket>();

function credentials() {
  const keyFilename = process.env.GCS_KEY_FILE || process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
  if (keyFilename && existsSync(keyFilename)) {
    const parsed = JSON.parse(readFileSync(keyFilename, "utf8")) as { client_email?: string; private_key?: string; project_id?: string };
    if (parsed.client_email && parsed.private_key) return parsed;
  }
  return GCS_SERVICE_ACCOUNT;
}

/** Uses the account written in this file, the same way the P2P server does. */
function storage() {
  if (client) return client;
  const account = credentials();
  client = new Storage({ projectId: account.project_id || PROJECT, credentials: account });
  return client;
}

function bucket(name: string) {
  const cached = buckets.get(name);
  if (cached) return cached;
  const next = storage().bucket(name);
  buckets.set(name, next);
  return next;
}

export function docsBucketName() {
  return (process.env.GCS_BUCKET || "").trim();
}

/** BG and ISB scans are kept in this bucket, under Tender Documents/. */
export function tenderBucketName() {
  return (process.env.TENDER_GCS_BUCKET || "p2p-app-storage-master-diorama-489103-u2").trim();
}

export function tenderObjectName(key: string) {
  const prefix = (process.env.TENDER_GCS_PREFIX || "Tender Documents/").replace(/^\/+/, "");
  const folder = prefix.endsWith("/") || prefix === "" ? prefix : `${prefix}/`;
  return `${folder}${key.replace(/^\/+/, "")}`;
}

export async function uploadObject(bucketName: string, objectName: string, buffer: Buffer, contentType: string) {
  if (!bucketName || !objectName) throw new Error("GCS upload needs a bucket and an object name.");
  await bucket(bucketName).file(objectName).save(buffer, {
    resumable: false,
    metadata: { contentType, cacheControl: "private, max-age=0" },
  });
}

export async function downloadObject(bucketName: string, objectName: string) {
  if (!bucketName || !objectName) return null;
  try {
    const [bytes] = await bucket(bucketName).file(objectName).download();
    return bytes;
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code === 404) return null;
    throw error;
  }
}

export async function deleteObject(bucketName: string, objectName: string) {
  if (!bucketName || !objectName) return;
  await bucket(bucketName).file(objectName).delete({ ignoreNotFound: true });
}
