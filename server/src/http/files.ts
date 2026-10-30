import { Router } from "express";
import { readStored } from "../lib/files";
import { pathFromOcrToken } from "../lib/ocr-link";
import { prisma } from "../lib/prisma";
import { requireActor } from "./auth";

const MIME: Record<string, string> = {
  pdf: "application/pdf",
  txt: "text/plain",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
};

export const files = Router();

/** Stored tender documents, for signed-in users. */
files.get("/documents/:id", requireActor, async (req, res) => {
  const document = await prisma.tenderDocument.findUnique({ where: { id: req.params.id as string } });
  if (!document) {
    res.status(404).send("Not found");
    return;
  }
  try {
    const bytes = await readStored(document.storedPath);
    res.set({
      "Content-Type": document.mimeType || "application/octet-stream",
      "Content-Disposition": `inline; filename="${document.fileName.replace(/[^\x20-\x7e]|"/g, "")}"`,
      "X-Content-Type-Options": "nosniff",
    });
    res.send(bytes);
  } catch {
    res.status(404).send("File missing");
  }
});

/** Short-lived signed links the OCR service downloads. Public on purpose: the signature is the access check. */
files.get("/ocr-files/:token/:fileName", async (req, res) => {
  const storedPath = pathFromOcrToken(req.params.token);
  if (!storedPath) {
    res.status(404).send("Not found");
    return;
  }
  try {
    const bytes = await readStored(storedPath);
    const ext = req.params.fileName.split(".").pop()?.toLowerCase() ?? "";
    res.set({
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Content-Disposition": `inline; filename="${req.params.fileName.replace(/"/g, "")}"`,
      "Cache-Control": "private, max-age=60",
      "X-Content-Type-Options": "nosniff",
    });
    res.send(bytes);
  } catch {
    res.status(404).send("Not found");
  }
});
