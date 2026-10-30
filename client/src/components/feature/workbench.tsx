import type { CSSProperties } from "react";
import { ROLES, STAGE_HELP, TASK } from "@client/lib/labels";
import { BidWizard, DeptReview, RelevanceReview } from "./review-forms";
import { AmountInput, BoundForm, FilePick, type TaskContext } from "./task-kit";
import { Status } from "@client/components/base/pill";
import { Submit } from "@client/components/base/submit";
import { documentUrl } from "@client/lib/api";

export type WorkTask = {
  id: string;
  stage: string;
  title: string;
  status: string;
  mine: boolean;
  late: boolean;
  due: string;
  remaining: string;
  comments: string;
  assignees: string;
};

type EmdDraft = {
  amount: string;
  beneficiary: string;
  referenceNumber: string;
  exemptionBasis: string;
  notes: string;
  authorityNote: string;
  submitted: boolean;
};

export function TaskCards({
  tenderId,
  tasks,
  emd,
  canAuthorize,
  bgRequiresBoth,
  ctx,
}: {
  tenderId: string;
  tasks: WorkTask[];
  emd: EmdDraft | null;
  canAuthorize: boolean;
  bgRequiresBoth: boolean;
  ctx: TaskContext;
}) {
  if (!tasks.length) return <p className="panel empty">No open tasks on this tender.</p>;
  return (
    <div className="stack">
      {tasks.map((task, index) => (
        <article key={task.id} className={`panel task ${task.mine ? "mine" : ""}`} style={{ "--r": index } as CSSProperties}>
          <header className="panel-head">
            <div>
              <div className="chips">
                {task.mine ? <span className="pill info">Your action</span> : null}
                <Status map={TASK} value={task.status} />
                {task.late ? <span className="pill bad">Overdue</span> : null}
              </div>
              <h2 className="task-title">{task.title}</h2>
              <p className="muted">
                {task.assignees}
                {task.due && task.due !== "—" ? ` · due ${task.due}` : ""} {task.remaining}
              </p>
            </div>
          </header>
          {STAGE_HELP[task.stage] ? <p className="task-help">{STAGE_HELP[task.stage]}</p> : null}
          {task.comments ? (
            <p className="task-note">
              <b>Latest note:</b> {task.comments}
            </p>
          ) : null}
          {task.mine ? (
            <TaskForm task={task} tenderId={tenderId} emd={emd} canAuthorize={canAuthorize} bgRequiresBoth={bgRequiresBoth} ctx={ctx} />
          ) : (
            <p className="muted">Waiting on {task.assignees}.</p>
          )}
        </article>
      ))}
    </div>
  );
}

export function ManagePanel({
  tenderId,
  users,
  submitterId,
  bidSubmitted,
}: {
  tenderId: string;
  users: { id: string; name: string; role: string }[];
  submitterId: string | null;
  bidSubmitted: boolean;
}) {
  const current = users.find((user) => user.id === submitterId);
  return (
    <details className="panel manage">
      <summary>
        <span>
          <strong>Manage this tender</strong>
          <small>Bid submitter{current ? `: ${current.name}` : " not assigned"} · close without bidding{bidSubmitted ? " · record outcome" : ""}</small>
        </span>
      </summary>
      <div className="split-2">
        <AssignForm tenderId={tenderId} users={users} submitterId={submitterId} />
        {bidSubmitted ? <OutcomeForm tenderId={tenderId} /> : <CloseForm tenderId={tenderId} />}
        {bidSubmitted ? <CloseForm tenderId={tenderId} /> : null}
      </div>
    </details>
  );
}

function TaskForm({
  task,
  tenderId,
  emd,
  canAuthorize,
  bgRequiresBoth,
  ctx,
}: {
  task: WorkTask;
  tenderId: string;
  emd: EmdDraft | null;
  canAuthorize: boolean;
  bgRequiresBoth: boolean;
  ctx: TaskContext;
}) {
  if (task.stage === "DATA_VALIDATION") {
    return (
      <div className="form-grid">
        <div className={`next-box wide ${ctx.attention ? "warn" : "good"}`}>
          {ctx.attention ? (
            <>
              <b>
                {ctx.attention} field{ctx.attention === 1 ? "" : "s"} need a look.
              </b>{" "}
              Open the verify screen to check what was read and send it for review.
            </>
          ) : (
            <>
              <b>All 44 fields were read.</b> Give them a quick look and send them for review.
            </>
          )}
        </div>
        <div className="actions wide">
          <a className="btn" href={`/tenders/${tenderId}?tab=details`}>
            Verify extracted data →
          </a>
        </div>
      </div>
    );
  }
  if (task.stage === "RELEVANCE") return <RelevanceReview taskId={task.id} tenderId={tenderId} ctx={ctx} />;
  if (task.stage === "DRAFT_COSTING" || task.stage === "SALES_INPUT" || task.stage === "FINAL_COSTING") {
    return (
      <BoundForm>
        <input type="hidden" name="tenderId" value={tenderId} />
        <input type="hidden" name="taskId" value={task.id} />
        <PreviousCosting stage={task.stage} ctx={ctx} />
        <label className="wide">
          Assumptions (or the reason, if you are returning it)
          <textarea name="notes" rows={3} required placeholder="Rates, quantities, margins, anything the next person should know" />
        </label>
        <AmountInput name="amount" label={`Amount in rupees ${task.stage === "FINAL_COSTING" ? "(required)" : "(optional)"}`} required={task.stage === "FINAL_COSTING"} />
        <FilePick name="file" label="Costing sheet (required to complete)" hint="Excel exported to PDF, a scan or a text file" />
        <div className="actions wide">
          <Submit name="intent" value="cost-complete">
            ✓ Complete and hand over
          </Submit>
          <Submit name="intent" value="cost-return" variant="ghost">
            ↺ Return for revision
          </Submit>
        </div>
      </BoundForm>
    );
  }
  if (task.stage === "DEPT_APPROVAL") return <DeptReview taskId={task.id} tenderId={tenderId} ctx={ctx} />;
  if (task.stage === "EMD_CLARIFICATION") {
    return (
      <BoundForm>
        <input type="hidden" name="tenderId" value={tenderId} />
        <input type="hidden" name="taskId" value={task.id} />
        <label>
          Instrument
          <select name="choice" defaultValue="">
            <option value="" disabled>
              Choose after checking the notice
            </option>
            <option value="BG">Bank Guarantee</option>
            <option value="ISB">ISB / Surety Bond</option>
            <option value="DD">Demand Draft</option>
            <option value="ONLINE">Online Payment</option>
            <option value="EXEMPTION">Exemption</option>
            <option value="OTHER">Other</option>
          </select>
        </label>
        <label className="wide">
          Why this type
          <textarea name="notes" rows={3} required />
        </label>
        <Submit name="intent" value="emd-clarify">
          Create the EMD task
        </Submit>
      </BoundForm>
    );
  }
  if (task.stage.startsWith("EMD_")) {
    return (
      <BoundForm>
        <input type="hidden" name="tenderId" value={tenderId} />
        <input type="hidden" name="taskId" value={task.id} />
        {task.stage === "EMD_BG" && bgRequiresBoth ? <p className="muted wide">Both Krishnanath and Surya M must verify this guarantee.</p> : null}
        {task.stage === "EMD_EXEMPTION" ? (
          <label className="wide">
            Exemption basis
            <textarea name="exemptionBasis" rows={3} defaultValue={emd?.exemptionBasis} />
          </label>
        ) : (
          <>
            <AmountInput name="amount" label="EMD amount" defaultValue={emd?.amount || ctx.emdFee.replace(/[^0-9.]/g, "")} />
            <label>
              Beneficiary
              <input name="beneficiary" defaultValue={emd?.beneficiary || ctx.client} />
            </label>
            <label>
              Instrument reference
              <input name="referenceNumber" defaultValue={emd?.referenceNumber} />
            </label>
          </>
        )}
        <label>
          Progress (when saving)
          <select name="preparationStatus" defaultValue="In preparation">
            <option>In preparation</option>
            <option>Prepared</option>
          </select>
        </label>
        <FilePick name="file" label="Evidence (required to complete)" hint="Scan of the instrument, bank letter or certificate" />
        <label className="wide">
          Notes
          <textarea name="notes" rows={2} defaultValue={emd?.notes} />
        </label>
        <label className="check">
          <input type="checkbox" name="submittedToAuthority" value="yes" defaultChecked={emd?.submitted} />
          Submitted to the tendering authority
        </label>
        <label>
          Authority note
          <input name="authorityNote" defaultValue={emd?.authorityNote} />
        </label>
        <div className="actions wide">
          <Submit name="intent" value="emd-save" variant="ghost">
            Save progress
          </Submit>
          <Submit name="intent" value="emd-complete">
            Mark verified
          </Submit>
        </div>
      </BoundForm>
    );
  }
  if (task.stage === "BID_SUBMISSION") return <BidWizard taskId={task.id} tenderId={tenderId} ctx={ctx} canAuthorize={canAuthorize} />;
  if (task.stage === "OCR_EXCEPTION" || task.stage === "BUSINESS_DECISION") {
    return (
      <BoundForm>
        <input type="hidden" name="tenderId" value={tenderId} />
        <input type="hidden" name="taskId" value={task.id} />
        <label className="wide">
          Notes
          <textarea name="notes" rows={3} required />
        </label>
        {task.stage === "OCR_EXCEPTION" ? (
          <Submit name="intent" value="exception">
            Close exception
          </Submit>
        ) : (
          <Submit name="intent" value="close">
            Close without bidding
          </Submit>
        )}
      </BoundForm>
    );
  }
  return null;
}

function AssignForm({
  tenderId,
  users,
  submitterId,
}: {
  tenderId: string;
  users: { id: string; name: string; role: string }[];
  submitterId: string | null;
}) {
  return (
    <BoundForm>
      <h3 className="wide">Bid submitter</h3>
      <p className="muted wide">The submitter gets the bid task once costing and EMD are complete.</p>
      <input type="hidden" name="tenderId" value={tenderId} />
      <label className="wide">
        Person
        <select name="submitterId" defaultValue={submitterId ?? ""}>
          <option value="" disabled>
            Choose a person
          </option>
          {users.map((user) => (
            <option key={user.id} value={user.id}>
              {user.name} · {ROLES[user.role] ?? user.role}
            </option>
          ))}
        </select>
      </label>
      <Submit name="intent" value="assign-submitter">
        {submitterId ? "Change submitter" : "Assign submitter"}
      </Submit>
    </BoundForm>
  );
}

function CloseForm({ tenderId }: { tenderId: string }) {
  return (
    <BoundForm>
      <h3 className="wide">Do not bid</h3>
      <p className="muted wide">Ends the workflow and cancels open tasks. The record and its history are kept.</p>
      <input type="hidden" name="tenderId" value={tenderId} />
      <label className="wide">
        Business reason
        <textarea name="notes" rows={3} required minLength={3} />
      </label>
      <Submit name="intent" value="close" variant="danger">
        Close without bidding
      </Submit>
    </BoundForm>
  );
}

function OutcomeForm({ tenderId }: { tenderId: string }) {
  return (
    <BoundForm>
      <h3 className="wide">Tender outcome</h3>
      <p className="muted wide">Record the result once the authority announces it.</p>
      <input type="hidden" name="tenderId" value={tenderId} />
      <label>
        Result
        <select name="outcome" defaultValue="WON">
          <option value="WON">Won</option>
          <option value="LOST">Lost</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </label>
      <label>
        Notes
        <input name="notes" />
      </label>
      <Submit name="intent" value="outcome">
        Record outcome
      </Submit>
    </BoundForm>
  );
}

export function UploadForm({ tenderId }: { tenderId: string }) {
  return (
    <BoundForm>
      <h3 className="wide">Add documents</h3>
      <p className="muted wide">A corrigendum is read again; changed values are flagged as conflicts and a deadline change notifies the team.</p>
      <input type="hidden" name="tenderId" value={tenderId} />
      <label>
        Type
        <select name="docType" defaultValue="SUPPORTING">
          <option value="SUPPORTING">Supporting</option>
          <option value="NOTICE">Notice / corrigendum</option>
        </select>
      </label>
      <FilePick name="files" label="Choose files" multiple required />
      <Submit name="intent" value="add-docs" variant="ghost">
        Upload
      </Submit>
    </BoundForm>
  );
}

const PREVIOUS: Record<string, string[]> = {
  SALES_INPUT: ["DRAFT_COSTING"],
  FINAL_COSTING: ["DRAFT_COSTING", "SALES_INPUT"],
};

/** Shows the earlier costing steps' notes and sheets, so each owner builds on them. */
function PreviousCosting({ stage, ctx }: { stage: string; ctx: TaskContext }) {
  const earlier = (PREVIOUS[stage] ?? [])
    .map((key) => ctx.costings.find((record) => record.stage === key))
    .filter((record): record is TaskContext["costings"][number] => Boolean(record));
  if (!earlier.length) return null;
  return (
    <div className="prev-steps wide">
      {earlier.map((record) => (
        <div key={record.stage} className="prev-step">
          <span className="prev-tag">{record.label}</span>
          <strong>
            {record.by}
            {record.amountText ? ` · ${record.amountText}` : ""}
          </strong>
          <p>{record.assumptions}</p>
          {record.documentId ? (
            <a href={documentUrl(record.documentId)} target="_blank" rel="noreferrer">
              Open sheet ↗
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}
