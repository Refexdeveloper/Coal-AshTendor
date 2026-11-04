import { lazy, Suspense, useState } from "react";
import { apiUrl, postAction } from "@client/api/client";
import { Icon } from "@client/pages/executive/ExecutiveView";
import { day } from "./Bonds";

const PdfViewer = lazy(() => import("@client/components/feature/pdf-viewer"));

/** An ISB copy: a scanned surety bond, or one of its extensions. */
export type BondDocument = {
  id: string;
  bondKey: string;
  fileKey: string;
  matchedBy: "EXACT" | "CLOSE" | "MANUAL" | "NONE";
  kind: "ISSUANCE" | "EXTENSION";
  extensionNo: number | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
};

export const bondDocUrl = (id: string, download = false) => apiUrl(`/bond-documents/${encodeURIComponent(id)}${download ? "?download=1" : ""}`);
export const bondDocLabel = (doc: Pick<BondDocument, "kind" | "extensionNo">) => (doc.kind === "EXTENSION" ? `Extension ${doc.extensionNo ?? ""}`.trim() : "Bond copy");
const size = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

/** Files per request, well inside the server's limit of 20 files of 25 MB. */
const BATCH = 8;

/**
 * Uploads ISB copies in small batches. With `bondId` every file goes to that bond; without it (the bulk upload,
 * e.g. the "ISB Copies" folder) each file is linked by the bond number in its name.
 */
export function BondDocUploader({ bondId, bondNumber, onDone }: { bondId?: string; bondNumber?: string; onDone: () => void }) {
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
      if (bondId) form.append("bondId", bondId);
      for (const file of files.slice(at, at + BATCH)) form.append("files", file, file.name);
      const result = await postAction("upload-bond-documents", form);
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
    ? [
        `${total(/(\d+) stored/)} stored`,
        total(/(\d+) already there/) ? `${total(/(\d+) already there/)} already there` : "",
        total(/(\d+) linked by a close/) ? `${total(/(\d+) linked by a close/)} linked by a close bond number` : "",
        total(/(\d+) not linked/) ? `${total(/(\d+) not linked/)} not linked to a bond` : "",
        total(/(\d+) without a bond number/) ? `${total(/(\d+) without a bond number/)} without a bond number in the name` : "",
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  return (
    <div className="bgdoc-upload">
      <div className="bgdoc-pick">
        <label className="dk-btn bgdoc-choose">
          <Icon name="doc" />
          Choose files
          <input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp" onChange={(event) => pick(event.target.files)} disabled={busy} hidden />
        </label>
        {bondId ? null : (
          <label className="dk-ghost bgdoc-choose">
            Choose a folder
            <input type="file" multiple onChange={(event) => pick(event.target.files)} disabled={busy} hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
          </label>
        )}
        <span className="muted">
          {files.length
            ? `${files.length} file${files.length === 1 ? "" : "s"} ready`
            : bondId
              ? `Files are filed under ${bondNumber}; “Ext-1”, “Extn 2” in the name marks an extension`
              : "Each file is linked by the bond number in its name, e.g. 12-6621-0011144971-00.pdf or 42250056255100000060 Ext-2.pdf"}
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

/** The ISB copies of one bond: a list on the left and a preview of the chosen file on the right. */
export function BondDocumentsPanel({ documents, bondId, bondNumber, canUpload, onChange }: { documents: BondDocument[]; bondId: string; bondNumber: string; canUpload: boolean; onChange: () => void }) {
  const [selected, setSelected] = useState<string | null>(documents[0]?.id ?? null);
  const [adding, setAdding] = useState(false);
  const current = documents.find((doc) => doc.id === selected) ?? documents[0];
  const isPdf = current && (current.mimeType === "application/pdf" || /\.pdf$/i.test(current.fileName));

  return (
    <section className="dk-panel" id="documents">
      <header className="dk-panel-head">
        <span className="dk-panel-icon">
          <Icon name="doc" />
        </span>
        <div>
          <h2>ISB copies</h2>
          <p>
            {documents.length} file{documents.length === 1 ? "" : "s"} for {bondNumber} · click one to preview
          </p>
        </div>
        {canUpload ? (
          <button type="button" className={`dk-ghost${adding ? " is-on" : ""}`} onClick={() => setAdding((value) => !value)}>
            {adding ? "Close" : "Add documents"}
          </button>
        ) : null}
      </header>
      {adding ? <BondDocUploader bondId={bondId} bondNumber={bondNumber} onDone={onChange} /> : null}
      {documents.length === 0 ? (
        <p className="dk-empty">No ISB copy for this bond yet.{canUpload ? " Use Add documents to upload the scan." : ""}</p>
      ) : (
        <div className="bgdoc-layout">
          <ul className="bgdoc-list">
            {documents.map((doc) => (
              <li key={doc.id} className={current?.id === doc.id ? "is-on" : ""}>
                <button type="button" onClick={() => setSelected(doc.id)}>
                  <span className={`bgdoc-kind ${doc.kind === "EXTENSION" ? "amend" : "issue"}`}>{doc.kind === "EXTENSION" ? `E${doc.extensionNo ?? ""}` : "ISB"}</span>
                  <span className="bgdoc-name">
                    <strong>
                      {bondDocLabel(doc)}
                      {doc.matchedBy === "CLOSE" ? <em className="bgdoc-flag" title={`The file name says ${doc.fileKey}, one digit away from this bond's number`}>close number</em> : null}
                    </strong>
                    <small title={doc.fileName}>
                      {doc.fileName} · {size(doc.sizeBytes)} · {day(doc.uploadedAt)}
                    </small>
                  </span>
                </button>
                <span className="bgdoc-actions">
                  <a href={bondDocUrl(doc.id)} target="_blank" rel="noreferrer" title="Open in a new tab">
                    Open
                  </a>
                  <a href={bondDocUrl(doc.id, true)} title="Download">
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
                  <PdfViewer key={current.id} src={bondDocUrl(current.id)} name={current.fileName} />
                </Suspense>
              ) : (
                <img src={bondDocUrl(current.id)} alt={current.fileName} />
              )
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
