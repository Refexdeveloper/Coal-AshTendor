import { useState } from "react";
import { Submit } from "@client/components/base/submit";
import { BoundForm, DecisionCards, FilePick, ReasonChips, TimeLeft, useNow, type TaskContext } from "./task-kit";
import { documentUrl } from "@client/api/client";

const RUPEES = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

function Fact({ label, value, wide = false }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`glance-item ${wide ? "wide" : ""}`}>
      <span>{label}</span>
      <b>{value || "Not in document"}</b>
    </div>
  );
}

function NoticeLink({ ctx }: { ctx: TaskContext }) {
  return ctx.noticeId ? (
    <a className="btn ghost" href={documentUrl(ctx.noticeId)} target="_blank" rel="noreferrer">
      Open the tender notice ↗
    </a>
  ) : null;
}

/** Appends a phrase to a comment, separated sensibly. */
const addReason = (current: string, reason: string) => (current.trim() ? `${current.trim().replace(/[.]$/, "")}. ${reason}` : reason);

/* ------------------------------------------------------------------ */

export function RelevanceReview({ taskId, tenderId, ctx }: { taskId: string; tenderId: string; ctx: TaskContext }) {
  const [decision, setDecision] = useState("approve-relevance");
  const [notes, setNotes] = useState("");
  const [sure, setSure] = useState(false);
  const rejecting = decision === "reject-relevance";
  return (
    <BoundForm className="form-grid review">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="taskId" value={taskId} />
      <section className="glance wide">
        <header>
          <h3>Tender at a glance</h3>
          <NoticeLink ctx={ctx} />
        </header>
        <div className="glance-grid">
          <Fact label="Client" value={ctx.client} />
          <Fact label="Location" value={ctx.location} />
          <Fact label="Estimated value" value={ctx.estimatedText} />
          <Fact label={`EMD · ${ctx.emdTypeText}`} value={ctx.emdFee} />
          <Fact label="Contract period" value={ctx.contractPeriod} />
          <div className="glance-item">
            <span>Bid deadline</span>
            <b>{ctx.deadlineText}</b>
            <TimeLeft deadline={ctx.deadline} />
          </div>
          <Fact label="Work" value={ctx.workDescription || ctx.scope} wide />
        </div>
        <details className="glance-more">
          <summary>Eligibility criteria</summary>
          <p>
            <b>Technical:</b> {ctx.pqTechnical || "Not in document"}
          </p>
          <p>
            <b>Financial:</b> {ctx.pqFinancial || "Not in document"}
          </p>
        </details>
      </section>

      <h3 className="wide step-q">Should Coal &amp; Ash pursue this tender?</h3>
      <DecisionCards
        name="choice"
        value={decision}
        onChange={(value) => {
          setDecision(value);
          setSure(false);
        }}
        choices={[
          { value: "approve-relevance", tone: "good", icon: "✓", title: "Yes, approve", detail: "Draft costing and EMD start straight away, in parallel." },
          { value: "reject-relevance", tone: "bad", icon: "✕", title: "No, reject", detail: "The tender closes. No costing or EMD work is created." },
        ]}
      />
      <label className="wide">
        {rejecting ? "Reason for rejecting (required)" : "Comments (optional)"}
        <textarea name="notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder={rejecting ? "Why this tender is not a fit" : "Anything the costing team should know"} />
      </label>
      {rejecting ? (
        <ReasonChips
          reasons={["Outside our scope of work", "Eligibility criteria not met", "Location not serviceable", "Value too low", "Deadline too close"]}
          onPick={(reason) => setNotes((current) => addReason(current, reason))}
        />
      ) : (
        <ReasonChips reasons={["Good fit, proceed", "Check transport distances in costing", "Confirm EMD route early"]} onPick={(reason) => setNotes((current) => addReason(current, reason))} />
      )}
      {rejecting ? (
        <label className="check wide confirm-box">
          <input type="checkbox" checked={sure} onChange={(event) => setSure(event.target.checked)} />I understand this closes the tender for everyone.
        </label>
      ) : null}
      <div className="next-box wide">
        <b>What happens next:</b>{" "}
        {rejecting
          ? "the tender moves to Rejected / Closed and the uploader is emailed your reason."
          : "Ranjana and Sundarlingam get the draft costing task, and the EMD task goes to its owner."}
      </div>
      <div className="actions wide">
        {rejecting ? (
          <button className="btn danger" name="intent" value="reject-relevance" disabled={!sure || notes.trim().length < 3}>
            Reject tender
          </button>
        ) : (
          <Submit name="intent" value="approve-relevance">
            ✓ Approve tender
          </Submit>
        )}
      </div>
    </BoundForm>
  );
}

/* ------------------------------------------------------------------ */

export function DeptReview({ taskId, tenderId, ctx }: { taskId: string; tenderId: string; ctx: TaskContext }) {
  const [decision, setDecision] = useState("dept-approve");
  const [notes, setNotes] = useState("");
  const [sure, setSure] = useState(false);
  const final = ctx.costings.find((record) => record.stage === "FINAL_COSTING");
  const ratio = ctx.finalCostingValue && ctx.estimatedValue ? Math.round((ctx.finalCostingValue / ctx.estimatedValue) * 100) : null;
  const needsNote = decision !== "dept-approve";
  return (
    <BoundForm className="form-grid review">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="taskId" value={taskId} />
      <section className="glance wide">
        <header>
          <h3>Costing summary</h3>
          {final?.documentId ? (
            <a className="btn ghost" href={documentUrl(final.documentId)} target="_blank" rel="noreferrer">
              Open final costing sheet ↗
            </a>
          ) : null}
        </header>
        <div className="money-compare">
          <div>
            <span>Estimated tender value</span>
            <b>{ctx.estimatedText}</b>
          </div>
          <div className="arrow" aria-hidden>
            →
          </div>
          <div className="final">
            <span>Proposed final costing</span>
            <b>{ctx.finalCostingValue != null ? RUPEES.format(ctx.finalCostingValue) : "—"}</b>
          </div>
          {ratio != null ? (
            <div className="ratio">
              <span>Final vs estimate</span>
              <b>{ratio}%</b>
              <i style={{ width: `${Math.min(100, ratio)}%` }} />
            </div>
          ) : null}
        </div>
        {ratio != null && (ratio < 40 || ratio > 160) ? (
          <p className="next-box warn">
            <b>Check the amount.</b> The final costing is {ratio}% of the estimated value, which is unusual. It may have been entered with missing or extra zeros. Return it for revision if so.
          </p>
        ) : null}
        <ol className="cost-trail">
          {[...ctx.costings].reverse().map((record) => (
            <li key={record.label + record.when}>
              <strong>
                {record.label}
                {record.amountText ? ` · ${record.amountText}` : ""}
              </strong>
              <small>
                {record.by} · {record.when}
                {record.documentId ? (
                  <>
                    {" · "}
                    <a href={documentUrl(record.documentId)} target="_blank" rel="noreferrer">
                      sheet
                    </a>
                  </>
                ) : null}
              </small>
              <p>{record.assumptions}</p>
            </li>
          ))}
        </ol>
      </section>

      <h3 className="wide step-q">Your decision on the final costing</h3>
      <DecisionCards
        name="choice"
        value={decision}
        onChange={(value) => {
          setDecision(value);
          setSure(false);
        }}
        choices={[
          { value: "dept-approve", tone: "good", icon: "✓", title: "Approve", detail: "Costing is complete. The tender moves toward Ready to Bid." },
          { value: "dept-return", tone: "warn", icon: "↺", title: "Return for revision", detail: "Send it back to a costing step with your comments." },
          { value: "dept-reject", tone: "bad", icon: "✕", title: "Reject", detail: "Costing is rejected and a business decision is requested." },
        ]}
      />
      {decision === "dept-return" ? (
        <label className="wide">
          Send it back to
          <select name="returnStage" defaultValue="FINAL_COSTING">
            <option value="FINAL_COSTING">Final costing · Vishesh</option>
            <option value="SALES_INPUT">Sales costing input · Sales Team</option>
            <option value="DRAFT_COSTING">Draft costing · Ranjana and Sundarlingam</option>
          </select>
        </label>
      ) : null}
      <label className="wide">
        {needsNote ? "Comments (required)" : "Comments (optional)"}
        <textarea name="notes" rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <ReasonChips
        reasons={
          decision === "dept-approve"
            ? ["Approved as proposed", "Margin acceptable"]
            : decision === "dept-return"
              ? ["Recheck transport rates", "Margin too thin", "Quantities need verification", "Add contingency"]
              : ["Not commercially viable", "Risk too high for the value"]
        }
        onPick={(reason) => setNotes((current) => addReason(current, reason))}
      />
      {decision === "dept-reject" ? (
        <label className="check wide confirm-box">
          <input type="checkbox" checked={sure} onChange={(event) => setSure(event.target.checked)} />I understand rejecting stops the costing branch.
        </label>
      ) : null}
      <div className="actions wide">
        {decision === "dept-approve" ? (
          <Submit name="intent" value="dept-approve">
            ✓ Approve final costing
          </Submit>
        ) : decision === "dept-return" ? (
          <button className="btn" name="intent" value="dept-return" disabled={notes.trim().length < 3}>
            ↺ Return for revision
          </button>
        ) : (
          <button className="btn danger" name="intent" value="dept-reject" disabled={!sure || notes.trim().length < 3}>
            Reject final costing
          </button>
        )}
      </div>
    </BoundForm>
  );
}

/* ------------------------------------------------------------------ */

const BID_STATUS = [
  { value: "BID_SUBMITTED_EVIDENCE_RECORDED", tone: "good", icon: "✓", title: "Submitted, I have the acknowledgement", detail: "Upload the portal receipt now. This completes the bid." },
  { value: "BID_SUBMITTED_EVIDENCE_PENDING", tone: "warn", icon: "⧗", title: "Submitted, proof comes later", detail: "Records the submission. You'll be reminded to upload proof." },
  { value: "SUBMISSION_IN_PROGRESS", tone: "info", icon: "…", title: "Still submitting", detail: "Marks the bid as in progress on the portal." },
  { value: "SUBMISSION_FAILED", tone: "bad", icon: "!", title: "Submission failed", detail: "Records the failure so the team can react before the deadline." },
] as const;

function localNow() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

export function BidWizard({ taskId, tenderId, ctx, canAuthorize }: { taskId: string; tenderId: string; ctx: TaskContext; canAuthorize: boolean }) {
  const [step, setStep] = useState(0);
  const [status, setStatus] = useState<string>("BID_SUBMITTED_EVIDENCE_RECORDED");
  const [when, setWhen] = useState("");
  const [reference, setReference] = useState("");
  const [fileName, setFileName] = useState("");
  const [exception, setException] = useState("");
  const now = useNow();
  const submitted = status.startsWith("BID_SUBMITTED");
  const late = Boolean(when && ctx.deadline && new Date(when).getTime() > new Date(ctx.deadline).getTime());
  const missingTime = submitted && !when;
  const missingProof = status === "BID_SUBMITTED_EVIDENCE_RECORDED" && !fileName && !exception.trim();
  const detailsOk = !missingTime && !late && !missingProof;
  const statusInfo = BID_STATUS.find((item) => item.value === status)!;
  const steps = ["Check", "Status", "Details", "Confirm"];
  const final = ctx.costings.find((record) => record.stage === "FINAL_COSTING");
  const portalUrl = /^https?:\/\//i.test(ctx.portalRef) ? ctx.portalRef : "";

  return (
    <BoundForm className="form-grid wizard">
      <input type="hidden" name="tenderId" value={tenderId} />
      <input type="hidden" name="taskId" value={taskId} />
      <ol className="wiz-steps wide">
        {steps.map((label, index) => (
          <li key={label} className={index < step ? "done" : index === step ? "current" : ""}>
            <span>{index < step ? "✓" : index + 1}</span>
            {label}
          </li>
        ))}
      </ol>
      <div className="wiz-progress wide">
        <i style={{ width: `${(step / (steps.length - 1)) * 100}%` }} />
      </div>

      {/* Step 1: everything in place */}
      <section className="wiz-pane wide" hidden={step !== 0}>
        <div className="deadline-banner">
          <span>Portal deadline</span>
          <b>{ctx.deadlineText}</b>
          <TimeLeft deadline={ctx.deadline} />
        </div>
        <ul className="checklist ready-list">
          {["Relevance approved", "Final costing approved by the Department Head", "EMD prepared and verified", "You are the assigned bid submitter"].map((item) => (
            <li key={item} className="ok">
              <span className="check-mark">✓</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
        {ctx.noticeId || final?.documentId || ctx.emdEvidenceId || portalUrl ? <p className="muted">Keep these open while you submit on the portal:</p> : null}
        <div className="actions">
          {ctx.noticeId ? (
            <a className="btn ghost" href={documentUrl(ctx.noticeId)} target="_blank" rel="noreferrer">
              Tender notice ↗
            </a>
          ) : null}
          {final?.documentId ? (
            <a className="btn ghost" href={documentUrl(final.documentId)} target="_blank" rel="noreferrer">
              Final costing {final.amountText ? `(${final.amountText})` : ""} ↗
            </a>
          ) : null}
          {ctx.emdEvidenceId ? (
            <a className="btn ghost" href={documentUrl(ctx.emdEvidenceId)} target="_blank" rel="noreferrer">
              EMD evidence ↗
            </a>
          ) : null}
          {portalUrl ? (
            <a className="btn ghost" href={portalUrl} target="_blank" rel="noreferrer">
              Go to the portal ↗
            </a>
          ) : null}
        </div>
      </section>

      {/* Step 2: what happened on the portal */}
      <section className="wiz-pane wide" hidden={step !== 1}>
        <h3 className="step-q">What happened on the portal?</h3>
        <DecisionCards name="bidStatusChoice" value={status} onChange={setStatus} choices={BID_STATUS.map((item) => ({ ...item }))} />
        <input type="hidden" name="bidStatus" value={status} />
      </section>

      {/* Step 3: details */}
      <section className="wiz-pane wide form-grid" hidden={step !== 2}>
        <label>
          Portal submission date and time{submitted ? " (required)" : ""}
          <span className="input-row">
            <input name="submittedAt" type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} />
            <button type="button" className="btn ghost" onClick={() => setWhen(localNow())}>
              Use now
            </button>
          </span>
          {late ? <small className="text-bad">That is after the bid deadline. A late submission can't be recorded as a bid.</small> : null}
        </label>
        <label>
          Submission reference / bid ID
          <input name="referenceNumber" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="As shown on the acknowledgement" />
        </label>
        <FilePick
          name="file"
          label={status === "BID_SUBMITTED_EVIDENCE_RECORDED" ? "Portal acknowledgement (required)" : "Portal acknowledgement (optional)"}
          hint="Screenshot or PDF of the portal receipt"
          onPicked={(names) => setFileName(names[0] ?? "")}
        />
        <label className="wide">
          Notes
          <textarea name="notes" rows={2} placeholder="Anything unusual about the submission" />
        </label>
        {canAuthorize ? (
          <details className="wide glance-more">
            <summary>No portal file? Record an authorized exception</summary>
            <label>
              Exception reason (Department Head or administrator)
              <textarea name="exceptionReason" rows={2} value={exception} onChange={(event) => setException(event.target.value)} />
            </label>
          </details>
        ) : null}
      </section>

      {/* Step 4: confirm */}
      <section className="wiz-pane wide" hidden={step !== 3}>
        <h3 className="step-q">Check and record</h3>
        <dl className="kv summary">
          <dt>Status</dt>
          <dd>
            {statusInfo.icon} {statusInfo.title}
          </dd>
          <dt>Submitted at</dt>
          <dd>{when ? new Date(when).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—"}</dd>
          <dt>Reference</dt>
          <dd>{reference || "—"}</dd>
          <dt>Acknowledgement</dt>
          <dd>{fileName || (exception ? `Exception: ${exception}` : "None attached")}</dd>
          <dt>Deadline</dt>
          <dd>{ctx.deadlineText}</dd>
        </dl>
      </section>

      <div className="wiz-nav wide">
        {step > 0 ? (
          <button type="button" className="btn ghost" onClick={() => setStep(step - 1)}>
            ← Back
          </button>
        ) : (
          <span />
        )}
        {step < 3 ? (
          <button
            type="button"
            className="btn"
            disabled={step === 2 && !detailsOk}
            onClick={() => {
              if (step === 1 && submitted && !when && now != null) setWhen(localNow());
              setStep(step + 1);
            }}
          >
            {step === 0 ? "I'm ready, record the submission →" : "Next →"}
          </button>
        ) : (
          <Submit name="intent" value="bid">
            ✓ Record submission
          </Submit>
        )}
      </div>
      {step === 2 && !detailsOk ? (
        <p className="muted wide wiz-hint">
          {missingTime ? "Add the portal submission time. " : ""}
          {missingProof ? "Attach the acknowledgement, or go back and choose “proof comes later”." : ""}
        </p>
      ) : null}
    </BoundForm>
  );
}
