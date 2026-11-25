import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** The reasons a search result can be ignored for. The server accepts only these. */
export const IGNORE_REASONS = [
  "Not our scope of work",
  "Tender value less than 2 Cr",
  "SOW not as per strategy",
  "Location not serviceable",
  "Value too low or too high",
  "Eligibility not met",
  "Duplicate of another tender",
  "Deadline too close",
  "Tender closed or cancelled",
  "Other",
];

/**
 * "Ignore" for a search result (a website tender or a GeM bid): opens a small form asking for the reason and a
 * comment, which are kept with the result and shown on it afterwards.
 */
export function IgnoreForm({ action, idName, id }: { action: (formData: FormData) => Promise<void> | void; idName: string; id: string }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  return (
    <>
      <button type="button" className="btn ghost" onClick={(event) => { event.stopPropagation(); setOpen(true); }}>
        Ignore
      </button>
      {open
        ? createPortal(
            <div className="step-pop" role="presentation" onClick={() => setOpen(false)}>
              <form action={action} className="step-pop-card ignore-pop" role="dialog" aria-modal="true" aria-label="Ignore this tender" onClick={(event) => event.stopPropagation()}>
                <header>
                  <h3>Ignore this tender</h3>
                  <button type="button" className="step-pop-x" onClick={() => setOpen(false)} aria-label="Close">
                    ×
                  </button>
                </header>
                <input type="hidden" name="intent" value="ignore" />
                <input type="hidden" name={idName} value={id} />
                <label>
                  Reason
                  <select name="ignoreReason" required defaultValue="">
                    <option value="" disabled>
                      Choose a reason
                    </option>
                    {IGNORE_REASONS.map((reason) => (
                      <option key={reason}>{reason}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Comment <abbr className="req" title="Required">*</abbr>
                  <textarea name="ignoreComment" rows={4} required minLength={3} placeholder="Why is this tender not for us?" />
                </label>
                <span className="step-pop-actions">
                  <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
                    Cancel
                  </button>
                  <button className="btn" type="submit">
                    Ignore
                  </button>
                </span>
              </form>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** What was recorded when a result was ignored. */
export function IgnoredNote({ item }: { item: { ignoreReason?: string; ignoreComment?: string | null; ignoredByName?: string; ignoredAt?: string | Date | null } }) {
  if (!item.ignoreReason) return null;
  const when = item.ignoredAt ? new Date(item.ignoredAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return (
    <span className="ignored-note">
      <b>{item.ignoreReason}</b>
      {item.ignoreComment ? <span>“{item.ignoreComment}”</span> : null}
      {item.ignoredByName || when ? (
        <small>
          {item.ignoredByName}
          {item.ignoredByName && when ? " · " : ""}
          {when}
        </small>
      ) : null}
    </span>
  );
}

/**
 * A row's note (why an import failed, or what was not fetched). A link written in the note, or `href`, becomes a
 * "Visit website" link so the documents can be fetched by hand.
 */
export function ErrorNote({ text, href = "" }: { text: string; href?: string }) {
  const found = /https?:\/\/\S+/.exec(text)?.[0]?.replace(/[).,]+$/, "") ?? "";
  const link = found || href;
  const shown = found ? text.replace(/\s*(Visit GeM to get (it|them):|\()?\s*https?:\/\/\S+\)?/, "").trim() : text;
  return (
    <small className="muted gem-error">
      {shown}
      {link ? (
        <>
          {" "}
          <a href={link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
            {/gem\.gov\.in/.test(link) ? "Visit GeM →" : "Visit website →"}
          </a>
        </>
      ) : null}
    </small>
  );
}
