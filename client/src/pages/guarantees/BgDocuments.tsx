import { lazy, Suspense, useEffect, useState } from "react";
import { bgDocumentUrl, postAction } from "@client/api/client";
import type { BgDocument } from "@client/lib/types";
import { Icon } from "@client/pages/executive/ExecutiveView";
import { day } from "@client/pages/bonds/Bonds";

const PdfViewer = lazy(() => import("@client/components/feature/pdf-viewer"));

/** Files per request; the server takes up to 20 files of 25 MB each, so small batches stay well inside that. */
const BATCH = 8;

export const docLabel = (doc: Pick<BgDocument, "kind" | "amendmentNo">) => (doc.kind === "AMENDMENT" ? `Amendment ${doc.amendmentNo ?? ""}`.trim() : "Issuance");
const size = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/**
 * Uploads BG documents in small batches with a progress bar. With `bgNumber` every file is filed under that BG;
 * without it (the bulk upload) each file is matched by the BG number at the start of its name.
 */
export function BgDocUploader({ bgNumber, onDone }: { bgNumber?: string; onDone: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [messages, setMessages] = useState<{ ok: string[]; errors: string[] }>({ ok: [], errors: [] });

  const pick = (list: FileList | null) => {
    setFiles([...(list ?? [])].filter((file) => /\.(pdf|png|jpe?g|tiff?|webp)$/i.test(file.name)));
    setMessages({ ok: [], errors: [] });
    setDone(0);
  };

  const upload = async () => {
    setBusy(true);
    const ok: string[] = [];
    const errors: string[] = [];
    for (let at = 0; at < files.length; at += BATCH) {
      const form = new FormData();
      if (bgNumber) form.append("bgNumber", bgNumber);
      for (const file of files.slice(at, at + BATCH)) form.append("files", file, file.name);
      const result = await postAction("upload-bg-documents", form);
      if (result?.error) errors.push(result.error);
      else if (result?.ok) ok.push(result.ok);
      setDone(Math.min(files.length, at + BATCH));
    }
    setMessages({ ok, errors });
    setBusy(false);
    setFiles([]);
    onDone();
  };

  // Totals across batches, from messages like "8 stored · 1 already there".
  const total = (pattern: RegExp) => messages.ok.reduce((sum, text) => sum + Number(pattern.exec(text)?.[1] ?? 0), 0);
  const summary = messages.ok.length
    ? [`${total(/(\d+) stored/)} stored`, total(/(\d+) already there/) ? `${total(/(\d+) already there/)} already there` : "", total(/(\d+) for BG numbers/) ? `${total(/(\d+) for BG numbers/)} for BG numbers not in the register yet` : "", total(/(\d+) without a BG number/) ? `${total(/(\d+) without a BG number/)} without a BG number in the name` : ""].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="bgdoc-upload">
      <div className="bgdoc-pick">
        <label className="dk-btn bgdoc-choose">
          <Icon name="doc" />
          Choose files
          <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp" onChange={(event) => pick(event.target.files)} disabled={busy} hidden />
        </label>
        {bgNumber ? null : (
          <label className="dk-ghost bgdoc-choose">
            Choose a folder
            <input
              type="file"
              multiple
              onChange={(event) => pick(event.target.files)}
              disabled={busy}
              hidden
              // A folder picker: every file inside the chosen folder is offered.
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
            />
          </label>
        )}
        <span className="muted">
          {files.length
            ? `${files.length} file${files.length === 1 ? "" : "s"} ready`
            : bgNumber
              ? `Files are filed under ${bgNumber}; “Amendment - n” in the name marks an amendment`
              : "Each file is matched by the BG number at the start of its name, e.g. 004GT02242830012 Amendment - 3.pdf"}
        </span>
        <button type="button" className="dk-btn" onClick={() => void upload()} disabled={!files.length || busy}>
          {busy ? `Uploading ${done}/${files.length}…` : "Upload"}
        </button>
      </div>
      {busy ? (
        <span className="bgdoc-progress" aria-hidden>
          <i style={{ width: `${files.length ? (done / files.length) * 100 : 0}%` }} />
        </span>
      ) : null}
      {summary ? <p className="banner good">{summary}</p> : null}
      {messages.errors.length ? <p className="banner bad">{[...new Set(messages.errors)].join(" ")}</p> : null}
    </div>
  );
}

/** The documents of one BG: a list on the left and a preview of the chosen file on the right. */
export function BgDocumentsPanel({ documents, bgNumber, canUpload, onChange, selectedId }: { documents: BgDocument[]; bgNumber: string; canUpload: boolean; onChange: () => void; selectedId?: string | null }) {
  const [selected, setSelected] = useState<string | null>(selectedId ?? documents[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (selectedId) setSelected(selectedId);
  }, [selectedId]);
  const current = documents.find((doc) => doc.id === selected) ?? documents[0];
  const isPdf = current && (current.mimeType === "application/pdf" || /\.pdf$/i.test(current.fileName));

  return (
    <section className="dk-panel" id="documents">
      <header className="dk-panel-head">
        <span className="dk-panel-icon">
          <Icon name="doc" />
        </span>
        <div>
          <h2>Documents</h2>
          <p>
            {documents.length} file{documents.length === 1 ? "" : "s"} for {bgNumber} · click one to preview
          </p>
        </div>
        {canUpload ? (
          <button type="button" className={`dk-ghost${adding ? " is-on" : ""}`} onClick={() => setAdding((value) => !value)}>
            {adding ? "Close" : "Add documents"}
          </button>
        ) : null}
      </header>
      {adding ? <BgDocUploader bgNumber={bgNumber} onDone={onChange} /> : null}
      {documents.length === 0 ? (
        <p className="dk-empty">No documents for this BG yet.{canUpload ? " Use Add documents to upload the scans." : ""}</p>
      ) : (
        <div className="bgdoc-layout">
          <ul className="bgdoc-list">
            {documents.map((doc) => (
              <li key={doc.id} className={current?.id === doc.id ? "is-on" : ""}>
                <button type="button" onClick={() => setSelected(doc.id)}>
                  <span className={`bgdoc-kind ${doc.kind === "AMENDMENT" ? "amend" : "issue"}`}>{doc.kind === "AMENDMENT" ? `A${doc.amendmentNo ?? ""}` : "BG"}</span>
                  <span className="bgdoc-name">
                    <strong>{docLabel(doc)}</strong>
                    <small title={doc.fileName}>
                      {doc.fileName} · {size(doc.sizeBytes)} · {day(doc.uploadedAt)}
                    </small>
                  </span>
                </button>
                <span className="bgdoc-actions">
                  <a href={bgDocumentUrl(doc.id)} target="_blank" rel="noreferrer" title="Open in a new tab">
                    Open
                  </a>
                  <a href={bgDocumentUrl(doc.id, true)} title="Download">
                    Download
                  </a>
                </span>
              </li>
            ))}
          </ul>
          <div className="bgdoc-preview">
            {current ? (
              isPdf ? (
                <Suspense fallback={<p className="dk-empty">Loading the viewer…</p>}>
                  <PdfViewer key={current.id} src={bgDocumentUrl(current.id)} name={current.fileName} />
                </Suspense>
              ) : (
                <img src={bgDocumentUrl(current.id)} alt={current.fileName} />
              )
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
