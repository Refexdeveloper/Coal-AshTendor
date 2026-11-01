import { useActionState, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { createSampleAction, createTenderAction } from "@client/api/actions";
import type { ActionState } from "@client/api/action-state";
import { apiGet } from "@client/api/client";
import { Submit, useFormPending } from "@client/components/base/submit";

const READING_STEPS = ["Uploading your document", "Sending the file to OCR", "Waiting for the OCR response"];

type OcrWatch = { tender: { ocrStatus: string; documents: { ocrJson?: string }[] } };

function stillReading(data: OcrWatch) {
  return data.tender.ocrStatus === "PROCESSING" || data.tender.documents.some((document) => (document.ocrJson ?? "").trim() === "PENDING");
}

/** Full-card overlay until the OCR response is stored. */
function Reading({ hold }: { hold: boolean }) {
  const { pending } = useFormPending();
  const active = pending || hold;
  const [step, setStep] = useState(0);
  useEffect(() => {
    if (!active) {
      setStep(0);
      return;
    }
    if (hold) {
      setStep(READING_STEPS.length - 1);
      return;
    }
    const timer = setInterval(() => setStep((current) => Math.min(current + 1, READING_STEPS.length - 2)), 1100);
    return () => clearInterval(timer);
  }, [active, hold]);
  if (!active) return null;
  return (
    <div className="reading" role="status">
      <div className="reading-doc" aria-hidden>
        <i /><i /><i /><i />
        <span className="scan" />
      </div>
      <strong>{READING_STEPS[step]}…</strong>
      <ol>
        {READING_STEPS.map((label, index) => (
          <li key={label} className={index < step ? "done" : index === step ? "now" : ""}>
            {index < step ? "✓" : "•"} {label}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function CreateForm() {
  const navigate = useNavigate();
  const formRef = useRef<HTMLFormElement>(null);
  const [names, setNames] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [hold, setHold] = useState("");
  const [state, action] = useActionState(createTenderAction, null as ActionState);
  const [sample, sampleAction] = useActionState(createSampleAction, null as ActionState);
  useEffect(() => {
    const next = state?.tenderId && state.ok ? state.tenderId : sample?.tenderId && sample.ok ? sample.tenderId : "";
    if (next) setHold(next);
  }, [state, sample]);
  useEffect(() => {
    if (!hold) return;
    let cancelled = false;
    let timer = 0;
    const look = async () => {
      try {
        const data = await apiGet<OcrWatch>(`/tenders/${encodeURIComponent(hold)}`);
        if (!stillReading(data)) {
          if (!cancelled) navigate(`/tenders/${hold}?tab=details&new=1`);
          return;
        }
      } catch {
        // The file is saved. Keep the loading screen until the OCR response can be read.
      }
      if (!cancelled) timer = window.setTimeout(() => void look(), 2000);
    };
    timer = window.setTimeout(() => void look(), 800);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hold, navigate]);
  const failed = state?.error ? state : sample?.error ? sample : null;
  return (
    <div className="stack">
      {failed ? (
        <div className="stack">
          <p className="banner bad">
            {failed.error}
            {failed.tenderId ? (
              <>
                {" "}
                <Link to={`/tenders/${failed.tenderId}?tab=details`}>Open that tender</Link>
              </>
            ) : null}
          </p>
          {failed.exchange ? (
            <section className="panel stack">
              <h2>Network</h2>
              <p className="muted">The same POST the browser sent, and the response the server returned.</p>
              <pre className="network-hit">{`${failed.exchange.method} ${failed.exchange.url}\n\n${failed.exchange.request}`}</pre>
              <p className="muted">Response {failed.exchange.status || "failed before a status"}</p>
              <pre className="ocr-json">{failed.exchange.response}</pre>
            </section>
          ) : null}
        </div>
      ) : null}
      <form ref={formRef} action={action} className="panel upload-card">
        <Reading hold={Boolean(hold)} />
        <label
          className={`drop-hero ${over ? "over" : ""} ${names.length ? "has-file" : ""}`}
          onDragOver={() => setOver(true)}
          onDragLeave={() => setOver(false)}
          onDrop={() => setOver(false)}
        >
          <span className="drop-icon" aria-hidden>
            ⇪
          </span>
          <strong>{names.length ? names.join(", ") : "Drop the tender notice here"}</strong>
          <span className="muted">or click to choose a file. PDF, scan, image or text, up to 20 MB. It is read as soon as you choose it.</span>
          <input
            name="files"
            type="file"
            accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,.tif,.tiff"
            multiple
            required
            onChange={(event) => {
              const picked = [...(event.target.files ?? [])].map((file) => file.name);
              setNames(picked);
              // Upload and extract straight away; details can be added on the verify screen.
              if (picked.length) window.setTimeout(() => formRef.current?.requestSubmit(), 150);
            }}
          />
        </label>
        <details className="manual-details">
          <summary>Add details yourself (optional)</summary>
          <p className="muted">Only needed if they are not printed on the notice. Fill these before choosing the file; anything you type wins over extraction.</p>
          <div className="form-grid">
            <label>
              Project name
              <input name="projectName" />
            </label>
            <label>
              Client
              <input name="clientName" />
            </label>
            <label>
              Portal
              <input name="portalName" placeholder="GeM, NIC, state portal…" />
            </label>
            <label>
              Tender reference
              <input name="tenderRef" />
            </label>
            <label>
              Tender ID
              <input name="externalTenderId" />
            </label>
          </div>
        </details>
      </form>
      <form action={sampleAction} className="sample-row">
        <span className="muted">No notice to hand?</span>
        <Submit variant="ghost">Try the bundled sample notice</Submit>
      </form>
    </div>
  );
}
