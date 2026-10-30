import { useActionState, useState } from "react";
import { useNavigate } from "react-router-dom";
import { NOT_FOUND, type FieldDef } from "@client/lib/fields";
import { updateFieldsAction } from "@client/lib/actions";
import type { ActionState } from "@client/lib/action-state";
import { Submit } from "@client/components/base/submit";
import { confetti, fxToast } from "./fx";

export type EditorField = FieldDef & {
  value: string;
  extracted: string;
  status: string;
  confidence: number | null;
  page: string;
  conflict: string;
};

const GROUPS = [
  [1, 6, "Identity"],
  [7, 10, "Dates"],
  [11, 16, "Commercial"],
  [17, 20, "Submission"],
  [21, 30, "Qualification"],
  [31, 44, "Contract conditions"],
] as const;

const ATTENTION = ["MISSING", "LOW_CONFIDENCE", "CONFLICT"];
const PLACEHOLDER: Partial<Record<string, string>> = {
  datetime: "DD/MM/YYYY HH:MM",
  money: "Amount in rupees, e.g. 2500000",
  integer: "Number",
  text: "Leave blank if not in the document",
};
const STATUS_TONE: Record<string, string> = {
  VALIDATED: "good",
  EXTRACTED: "info",
  NOT_FOUND: "neutral",
  MISSING: "warn",
  LOW_CONFIDENCE: "warn",
  CONFLICT: "bad",
};

export function FieldEditor({
  tenderId,
  fields,
  locked,
  validationTaskId = null,
  justUploaded = false,
}: {
  tenderId: string;
  fields: EditorField[];
  locked: boolean;
  /** Set when the viewer holds the open validation task: the form then offers "Save & send for review". */
  validationTaskId?: string | null;
  justUploaded?: boolean;
}) {
  const navigate = useNavigate();
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await updateFieldsAction(previous, formData);
    if (result?.ok && formData.get("intent") === "validate") {
      fxToast(result.ok);
      confetti(document.querySelector(".verify-hero") ?? document.body, 50);
      navigate(`/tenders/${tenderId}?tab=overview`);
    } else if (result?.ok) {
      fxToast(result.ok);
    }
    return result;
  }, null as ActionState);
  const [onlyAttention, setOnlyAttention] = useState(justUploaded);
  const [confirmed, setConfirmed] = useState(false);
  const count = (statuses: string[]) => fields.filter((field) => statuses.includes(field.status)).length;
  const attention = count(ATTENTION);
  const read = count(["EXTRACTED", "LOW_CONFIDENCE", "VALIDATED"]);
  const conflicts = count(["CONFLICT"]);
  return (
    <form action={action} className="stack">
      <input type="hidden" name="tenderId" value={tenderId} />
      {validationTaskId ? <input type="hidden" name="taskId" value={validationTaskId} /> : null}
      {validationTaskId ? (
        <section className="verify-hero">
          <span className="verify-badge" aria-hidden>
            {conflicts ? "!" : "✓"}
          </span>
          <div>
            <h2>{justUploaded ? "Document read. Please verify." : "Verify the extracted data"}</h2>
            <p>
              We read <b>{read} of {fields.length}</b> fields from the document.{" "}
              {attention
                ? `${attention} need a look: they are shown first. Fix what's wrong, leave blanks if the notice doesn't say.`
                : "Nothing is flagged. Give it a quick look and send it for review."}
            </p>
            <div className="verify-meter" aria-hidden>
              <i style={{ width: `${Math.round((read / fields.length) * 100)}%` }} />
            </div>
          </div>
        </section>
      ) : null}
      {state?.error ? <p className="banner bad">{state.error}</p> : null}
      {locked ? (
        <p className="banner neutral">
          You can view these fields. They can be edited by the Tender Coordinator, Vishesh, Ranjana, an administrator, or whoever is validating this tender. Closed tenders keep their recorded values.
        </p>
      ) : null}
      <section className="panel field-summary">
        <div className="chips">
          <span className="pill good">{count(["VALIDATED"])} validated</span>
          <span className="pill info">{count(["EXTRACTED"])} extracted</span>
          <span className="pill warn">{count(["MISSING", "LOW_CONFIDENCE"])} missing or unsure</span>
          <span className="pill bad">{count(["CONFLICT"])} conflicting</span>
          <span className="pill">{count(["NOT_FOUND"])} not in document</span>
        </div>
        <label className="check">
          <input type="checkbox" checked={onlyAttention} onChange={(event) => setOnlyAttention(event.target.checked)} />
          Show only the {attention} field{attention === 1 ? "" : "s"} that need attention
        </label>
      </section>
      {GROUPS.map(([from, to, title]) => {
        const group = fields.filter((field) => field.no >= from && field.no <= to);
        const shown = onlyAttention ? group.filter((field) => ATTENTION.includes(field.status)) : group;
        return (
        <section key={title} className="panel" hidden={!shown.length}>
          <header className="panel-head">
            <h2>{title}</h2>
            <span className="muted">
              Fields {from}–{to}
            </span>
          </header>
          <div className="fields">
            {group
              .map((field) => {
                const options = field.options ? [...field.options, NOT_FOUND] : null;
                if (options && field.value && !options.includes(field.value)) options.unshift(field.value);
                return (
                  <label key={field.key} className={`field ${field.status === "CONFLICT" ? "conflict" : ""}`} hidden={onlyAttention && !ATTENTION.includes(field.status)}>
                    <span className="field-label">
                      <span>
                        {field.no}. {field.label}
                        {field.critical ? <em> Critical</em> : null}
                      </span>
                      <span className="mini">
                        <span className={`pill ${STATUS_TONE[field.status] ?? ""}`}>{field.status.replaceAll("_", " ").toLowerCase()}</span>
                        {field.confidence ? ` ${Math.round(field.confidence * 100)}%` : ""}
                        {field.page ? ` · p.${field.page}` : ""}
                      </span>
                    </span>
                    {field.conflict ? <small className="conflict-note">Conflicting values: {field.conflict}</small> : null}
                    {field.extracted && field.extracted !== field.value ? <small>Extracted: {field.extracted}</small> : null}
                    {options ? (
                      <select name={`field_${field.key}`} defaultValue={field.value} disabled={locked}>
                        <option value="">Select</option>
                        {options.map((option) => (
                          <option key={option}>{option}</option>
                        ))}
                      </select>
                    ) : field.type === "long" ? (
                      <textarea name={`field_${field.key}`} defaultValue={field.value} rows={3} disabled={locked} />
                    ) : (
                      <input
                        name={`field_${field.key}`}
                        defaultValue={field.value}
                        disabled={locked}
                        placeholder={PLACEHOLDER[field.type]}
                      />
                    )}
                    {field.type === "datetime" && !locked ? <small className="muted">Format DD/MM/YYYY HH:MM, 24-hour, e.g. 18/12/2026 15:00</small> : null}
                  </label>
                );
              })}
          </div>
        </section>
        );
      })}
      {locked ? null : validationTaskId ? (
        <div className="sticky-save verify-bar">
          {conflicts ? <span className="text-bad verify-note">Correct the {conflicts} conflicting field{conflicts === 1 ? "" : "s"} (red) before sending.</span> : null}
          <label className="check">
            <input type="checkbox" name="confirmed" value="yes" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
            I have checked these fields against the notice
          </label>
          <span className="actions">
            <Submit variant="ghost" name="intent" value="save">
              Save for later
            </Submit>
            <button className="btn" name="intent" value="validate" disabled={!confirmed}>
              ✓ Save &amp; send for review
            </button>
          </span>
        </div>
      ) : (
        <div className="sticky-save">
          <span className="muted">Changes are kept in the audit trail with your name.</span>
          <Submit>Save corrections</Submit>
        </div>
      )}
    </form>
  );
}
