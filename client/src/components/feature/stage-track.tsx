import type { CSSProperties } from "react";
import { BID, COSTING, EMD, labelOf } from "@client/lib/labels";
import type { ApprovalRecord, PublicUser, WorkflowTask } from "@client/lib/types";

export type StepState = "done" | "current" | "failed" | "todo" | "skipped";
type SubStep = { title: string; who: string; state: StepState };
type Step = { key: string; title: string; note: string; state: StepState; subs?: SubStep[] };

type Crew = {
  names: Map<string, string>;
  /** Who owns a stage for this tender, from the server's routing (business line, state). */
  planned: (stage: string) => string;
  tasks: WorkflowTask[];
  approvals: ApprovalRecord[];
  costings: { stage: string; createdById: string }[];
  createdById: string;
  submitterId: string | null;
  emdType: string;
};

const OPEN = new Set(["NOT_STARTED", "IN_PROGRESS", "OVERDUE", "RETURNED_FOR_REVISION", "BLOCKED"]);

function parseIds(raw: string) {
  try {
    const value = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function join(parts: string[]) {
  return [...new Set(parts.map((part) => part.trim()).filter(Boolean))].join(", ");
}

/** Stage owners per tender, as /tenders/:id sends them. */
export type StagePlan = { line: string; state: string | null; stages: Record<string, string[]> };

function crewFrom(users: PublicUser[], tender: { tasks: WorkflowTask[]; approvals: ApprovalRecord[]; costings: { stage: string; createdById: string }[]; createdById: string; submitterId: string | null; emdType: string }, plan?: StagePlan): Crew {
  return {
    names: new Map(users.map((user) => [user.id, user.name])),
    planned: (stage) => join(plan?.stages[stage] ?? []),
    tasks: tender.tasks,
    approvals: tender.approvals,
    costings: tender.costings,
    createdById: tender.createdById,
    submitterId: tender.submitterId,
    emdType: tender.emdType,
  };
}

function actorsFor(crew: Crew, stages: string[]) {
  const tasks = crew.tasks.filter((task) => stages.includes(task.stage) && task.status !== "CANCELLED");
  const open = tasks.filter((task) => OPEN.has(task.status));
  const finished = tasks
    .filter((task) => task.completedById)
    .sort((a, b) => (b.completedAt?.getTime() ?? 0) - (a.completedAt?.getTime() ?? 0));
  const sheet = [...crew.costings].reverse().find((row) => stages.includes(row.stage));
  const decision = (kind: string) =>
    crew.approvals
      .filter((row) => stages.includes(row.stage) && row.decision === kind)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const approved = decision("APPROVED");
  const rejected = decision("REJECTED");
  return {
    with: join(open.flatMap((task) => parseIds(task.assigneeIds).map((id) => crew.names.get(id) ?? ""))),
    doneBy: finished[0] ? crew.names.get(finished[0].completedById) ?? "" : sheet ? crew.names.get(sheet.createdById) ?? "" : "",
    approvedBy: approved ? crew.names.get(approved.approverId) ?? "" : "",
    rejectedBy: rejected ? crew.names.get(rejected.approverId) ?? "" : "",
  };
}

/** Approved stages name who approved. The open stage names who has it now. Later stages name who will take them. */
function mention(state: StepState, actors: ReturnType<typeof actorsFor>, planned: string, approval: boolean) {
  if (state === "failed") {
    const who = actors.rejectedBy || actors.with || planned;
    return who ? `Rejected by ${actors.rejectedBy || who}` : "";
  }
  if (state === "done") {
    if (actors.approvedBy) return `Approved by ${actors.approvedBy}`;
    if (actors.doneBy) return approval ? `Approved by ${actors.doneBy}` : `By ${actors.doneBy}`;
    return "";
  }
  if (state === "current") {
    const who = actors.with || planned;
    return who ? `With ${who}` : "";
  }
  if (state === "skipped") return "";
  return planned;
}

const COSTING_AT: Record<string, { done: number; failed?: boolean }> = {
  DRAFT_COMPLETED: { done: 1 },
  SALES_PENDING: { done: 1 },
  SALES_COMPLETED: { done: 2 },
  FINAL_IN_PROGRESS: { done: 2 },
  RETURNED: { done: 2 },
  PENDING_DEPT: { done: 3 },
  APPROVED: { done: 4 },
  REJECTED: { done: 3, failed: true },
};

const EMD_AT: Record<string, { done: number; failed?: boolean }> = {
  NOT_STARTED: { done: 0 },
  REQUIREMENT_VALIDATION: { done: 0 },
  CLARIFICATION_REQUIRED: { done: 0 },
  PENDING_BG: { done: 1 },
  PENDING_ISB: { done: 1 },
  EXEMPTION_VERIFICATION: { done: 1 },
  IN_PROGRESS: { done: 1 },
  PREPARED: { done: 2 },
  VERIFICATION_PENDING: { done: 2 },
  COMPLETED: { done: 4 },
  SUBMITTED_EVIDENCE: { done: 4 },
  OVERDUE: { done: 1, failed: true },
};

function subStepsFor(
  rows: { title: string; stages: string[]; planned: string; approval?: boolean }[],
  at: { done: number; failed?: boolean } | undefined,
  active: boolean,
  halted: boolean,
  crew: Crew,
): SubStep[] {
  const done = at?.done ?? 0;
  return rows.map((row, i) => {
    const state: StepState =
      i < done ? "done" : i === done && active ? (at?.failed ? "failed" : "current") : halted ? "skipped" : "todo";
    return { title: row.title, state, who: mention(state, actorsFor(crew, row.stages), row.planned, Boolean(row.approval)) };
  });
}

type TrackInput = {
  overallStatus: string;
  relevanceStatus: string;
  costingStatus: string;
  emdStatus: string;
  bidStatus: string;
};

const SUBMITTED = ["BID_EVIDENCE_PENDING", "BID_EVIDENCE_RECORDED", "WON", "LOST"];

/** Works out where a tender sits in the BRD lifecycle; costing and EMD are returned as one parallel pair. */
export function stagesFor(t: TrackInput, crew: Crew): (Step | [Step, Step])[] {
  const validated = !["UPLOADED", "OCR_PROCESSING", "DATA_VALIDATION_REQUIRED"].includes(t.overallStatus);
  const rejected = t.relevanceStatus === "REJECTED";
  const approved = t.relevanceStatus === "APPROVED";
  const halted = rejected || t.overallStatus === "CLOSED_BUSINESS";
  const after = (cond: boolean, done: boolean, failed = false): StepState =>
    failed ? "failed" : done ? "done" : halted ? "skipped" : cond ? "current" : "todo";

  const costingDone = t.costingStatus === "APPROVED";
  const emdDone = ["COMPLETED", "SUBMITTED_EVIDENCE"].includes(t.emdStatus);
  const submitted = SUBMITTED.includes(t.overallStatus);
  const ready = t.overallStatus === "READY_TO_BID" || submitted;
  const missed = t.overallStatus === "NOT_BID_DEADLINE_MISSED";
  const creator = crew.names.get(crew.createdById) ?? "";
  const validateState: StepState = validated ? "done" : "current";
  const relevanceState: StepState = rejected ? "failed" : approved ? "done" : validated && !halted ? "current" : halted ? "skipped" : "todo";
  const readyState: StepState = missed && !ready ? "failed" : after(false, ready);
  const bidState: StepState = missed
    ? "failed"
    : submitted && t.overallStatus !== "BID_EVIDENCE_PENDING"
      ? "done"
      : ["READY_TO_BID", "BID_EVIDENCE_PENDING"].includes(t.overallStatus)
        ? "current"
        : halted
          ? "skipped"
          : "todo";
  const submitter = (crew.submitterId && crew.names.get(crew.submitterId)) || crew.planned("BID_SUBMISSION");
  const instrument = crew.planned("EMD_INSTRUMENT");

  return [
    { key: "upload", title: "Uploaded", note: creator ? `By ${creator}` : "Record created", state: "done" },
    {
      key: "validate",
      title: "Data validation",
      note: mention(validateState, actorsFor(crew, ["DATA_VALIDATION"]), crew.planned("DATA_VALIDATION"), false) || (validated ? "Fields confirmed" : "Check the 44 fields"),
      state: validateState,
    },
    {
      key: "relevance",
      title: "Relevance review",
      note: mention(relevanceState, actorsFor(crew, ["RELEVANCE"]), crew.planned("RELEVANCE"), true) || "Relevance reviewers",
      state: relevanceState,
    },
    [
      {
        key: "costing",
        title: "Costing",
        note: approved ? labelOf(COSTING, t.costingStatus) : "Starts after approval",
        state: after(approved, costingDone, t.costingStatus === "REJECTED"),
        subs: subStepsFor(
          [
            { title: "Draft costing", stages: ["DRAFT_COSTING"], planned: crew.planned("DRAFT_COSTING") },
            { title: "Sales input", stages: ["SALES_INPUT"], planned: crew.planned("SALES_INPUT") },
            { title: "Final costing", stages: ["FINAL_COSTING"], planned: crew.planned("FINAL_COSTING") },
            { title: "Department Head approval", stages: ["DEPT_APPROVAL"], planned: crew.planned("DEPT_APPROVAL"), approval: true },
          ],
          COSTING_AT[t.costingStatus],
          approved && !halted,
          halted,
          crew,
        ),
      },
      {
        key: "emd",
        title: "EMD",
        note: approved ? labelOf(EMD, t.emdStatus) : "Starts after approval",
        state: after(approved, emdDone, t.emdStatus === "OVERDUE"),
        subs: subStepsFor(
          [
            { title: "Requirement check", stages: ["EMD_CLARIFICATION"], planned: crew.planned("EMD_CLARIFICATION") },
            { title: "Instrument preparation", stages: ["EMD_BG", "EMD_ISB", "EMD_EXEMPTION", "EMD_OTHER"], planned: instrument },
            { title: "Second verification", stages: ["EMD_BG", "EMD_ISB", "EMD_EXEMPTION", "EMD_OTHER"], planned: instrument },
            { title: "Completed", stages: ["EMD_BG", "EMD_ISB", "EMD_EXEMPTION", "EMD_OTHER"], planned: instrument },
          ],
          EMD_AT[t.emdStatus],
          approved && !halted,
          halted,
          crew,
        ),
      },
    ],
    {
      key: "ready",
      title: "Ready to bid",
      note: mention(readyState, actorsFor(crew, ["BID_SUBMISSION"]), submitter, false) || (ready ? "All checks passed" : "Costing + EMD + submitter"),
      state: readyState,
    },
    {
      key: "bid",
      title: "Bid submitted",
      note: missed ? "Deadline missed" : mention(bidState, actorsFor(crew, ["BID_SUBMISSION"]), submitter, false) || (submitted ? labelOf(BID, t.bidStatus) : "Evidence required"),
      state: bidState,
    },
  ];
}

/** State of each lifecycle step by key (upload, validate, relevance, costing, emd, ready, bid), using the same rules as the track. */
export function stepStates(tender: Parameters<typeof StageTrack>[0]["tender"], users: PublicUser[], plan?: StagePlan): Record<string, StepState> {
  const out: Record<string, StepState> = {};
  for (const step of stagesFor(tender, crewFrom(users, tender, plan)).flat()) out[step.key] = step.state;
  return out;
}

const MARK: Record<StepState, string> = { done: "✓", current: "●", failed: "✕", todo: "", skipped: "–" };

const BRANCH_ICON: Record<string, string> = { costing: "∑", emd: "⛨" };

/** Folds the costing/EMD pair into one rail node so the main line reads as six steps. */
function mergePair([a, b]: [Step, Step]): Step {
  const states = [a.state, b.state];
  const state: StepState = states.includes("failed")
    ? "failed"
    : states.every((s) => s === "done")
      ? "done"
      : states.some((s) => s === "current" || s === "done")
        ? "current"
        : states.every((s) => s === "skipped")
          ? "skipped"
          : "todo";
  const subs = [...(a.subs ?? []), ...(b.subs ?? [])];
  const done = subs.filter((sub) => sub.state === "done").length;
  const note = state === "todo" || state === "skipped" ? a.note : `${done} of ${subs.length} sub-steps done`;
  return { key: "branches", title: "Costing & EMD", note, state };
}

function BranchCard({ step }: { step: Step }) {
  const subs = step.subs ?? [];
  const done = subs.filter((sub) => sub.state === "done").length;
  return (
    <section className={`branch ${step.state}`} style={{ "--p": subs.length ? done / subs.length : 0 } as CSSProperties}>
      <header className="branch-head">
        <span className="branch-icon" aria-hidden>
          {BRANCH_ICON[step.key] ?? "•"}
        </span>
        <span className="branch-copy">
          <strong>{step.title}</strong>
          <small>{step.note}</small>
        </span>
        <span className="branch-count">
          {done}/{subs.length}
        </span>
      </header>
      <span className="branch-bar" aria-hidden>
        <i />
      </span>
      <ol className="mini-steps" aria-label={`${step.title} stages`}>
        {subs.map((sub, i) => (
          <li key={sub.title} className={`sub-step ${sub.state}`} style={{ "--s": i } as CSSProperties}>
            <span className="mini-dot">{MARK[sub.state] || i + 1}</span>
            <span className="mini-copy">
              <b>{sub.title}</b>
              {sub.who ? <small>{sub.who}</small> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function StageTrack({
  tender,
  users,
  plan,
}: {
  tender: TrackInput & { tasks: WorkflowTask[]; approvals: ApprovalRecord[]; costings: { stage: string; createdById: string }[]; createdById: string; submitterId: string | null; emdType: string };
  users: PublicUser[];
  plan?: StagePlan;
}) {
  const steps = stagesFor(tender, crewFrom(users, tender, plan));
  const pair = steps.find((step): step is [Step, Step] => Array.isArray(step));
  const rail = steps.map((step) => (Array.isArray(step) ? mergePair(step) : step));
  const subs = pair ? pair.flatMap((step) => step.subs ?? []) : [];
  const score = rail.reduce((sum, step) => {
    if (step.key === "branches") return sum + (subs.length ? subs.filter((sub) => sub.state === "done").length / subs.length : 0);
    return sum + (step.state === "done" ? 1 : 0);
  }, 0);
  const pct = Math.round((score / rail.length) * 100);
  const lastReached = rail.reduce((at, step, i) => (step.state === "done" || step.state === "current" || step.state === "failed" ? i : at), 0);
  const focus = rail.find((step) => step.state === "failed") ?? rail.find((step) => step.state === "current") ?? rail[rail.length - 1];
  const finished = rail.every((step) => step.state === "done");

  return (
    <div className="journey">
      <header className="journey-head">
        <div className="journey-now">
          <span className="eyebrow">{finished ? "Workflow complete" : focus.state === "failed" ? "Workflow stopped at" : "Now at"}</span>
          <h2>{focus.title}</h2>
          {focus.note ? <p>{focus.note}</p> : null}
        </div>
        <div className="journey-meter" style={{ "--p": pct / 100 } as CSSProperties} aria-label={`${pct}% of the workflow complete`}>
          <span className="journey-meter-top">
            <b>{pct}%</b>
            <small>complete</small>
          </span>
          <span className="journey-meter-bar" aria-hidden>
            <i />
          </span>
        </div>
      </header>

      <ol className="rail" aria-label="Workflow progress" style={{ "--n": rail.length, "--fill": rail.length > 1 ? lastReached / (rail.length - 1) : 0 } as CSSProperties}>
        {rail.map((step, index) => (
          <li key={step.key} className={`rail-step ${step.state}${step === focus && !finished ? " focus" : ""}`} style={{ "--s": index } as CSSProperties}>
            <span className="rail-dot">{MARK[step.state] || index + 1}</span>
            <strong>{step.title}</strong>
            {step.note ? <small>{step.note}</small> : null}
          </li>
        ))}
      </ol>

      {pair ? (
        <div className="branches">
          <span className="branches-tag">Running in parallel</span>
          <BranchCard step={pair[0]} />
          <BranchCard step={pair[1]} />
        </div>
      ) : null}
    </div>
  );
}
