import { useState } from "react";

/** The reasons a search result can be ignored for. The server accepts only these. */
export const IGNORE_REASONS = [
  "Not our scope of work",
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
  if (!open)
    return (
      <button type="button" className="btn ghost" onClick={() => setOpen(true)}>
        Ignore
      </button>
    );
  return (
    <form action={action} className="ignore-form" onClick={(event) => event.stopPropagation()}>
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
        Comment
        <textarea name="ignoreComment" rows={2} required minLength={3} placeholder="Why is this tender not for us?" />
      </label>
      <span className="ignore-actions">
        <button className="btn" type="submit">
          Ignore
        </button>
        <button type="button" className="btn ghost" onClick={() => setOpen(false)}>
          Cancel
        </button>
      </span>
    </form>
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
