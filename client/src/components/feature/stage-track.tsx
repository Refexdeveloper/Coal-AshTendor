import type { CSSProperties } from "react";
import { BID, COSTING, EMD, labelOf } from "@client/lib/labels";
import type { ApprovalRecord, PublicUser, WorkflowTask } from "@client/lib/types";

type StepState = "done" | "current" | "failed" | "todo" | "skipped";
type SubStep = { title: string; who: string; state: StepState };
type Step = { key: string; title: string; note: string; state: StepState; subs?: SubStep[] };

type Crew = {
  names: Map<string, string>;
  keyName: (key: string) => string;
  roleNames: (role: string) => string;
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

function crewFrom(users: PublicUser[], tender: { tasks: WorkflowTask[]; approvals: ApprovalRecord[]; costings: { stage: string; createdById: string }[]; createdById: string; submitterId: string | null; emdType: string }): Crew {
  const active = users.filter((user) => user.active);
  return {
    names: new Map(users.map((user) => [user.id, user.name])),
    keyName: (key) => active.find((user) => user.personKey === key)?.name ?? "",
    roleNames: (role) => join(active.filter((user) => user.role === role).map((user) => user.name)),
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
  const submitter = (crew.submitterId && crew.names.get(crew.submitterId)) || crew.roleNames("BID_SUBMITTER");
  const instrument = crew.emdType === "ISB" ? crew.keyName("sanjeev") : crew.emdType === "UNCLEAR" ? crew.keyName("vishesh") : join([crew.keyName("krishnanath"), crew.keyName("surya")]);

  return [
    { key: "upload", title: "Uploaded", note: creator ? `By ${creator}` : "Record created", state: "done" },
    {
      key: "validate",
      title: "Data validation",
      note: mention(validateState, actorsFor(crew, ["DATA_VALIDATION"]), crew.keyName("coordinator"), false) || (validated ? "Fields confirmed" : "Check the 44 fields"),
      state: validateState,
    },
    {
      key: "relevance",
      title: "Relevance review",
      note: mention(relevanceState, actorsFor(crew, ["RELEVANCE"]), join([crew.keyName("vishesh"), crew.keyName("ranjana")]), true) || "Vishesh or Ranjana",
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
            { title: "Draft costing", stages: ["DRAFT_COSTING"], planned: crew.keyName("sundarlingam") },
            { title: "Sales input", stages: ["SALES_INPUT"], planned: crew.roleNames("SALES") },
            { title: "Final costing", stages: ["FINAL_COSTING"], planned: crew.keyName("vishesh") },
            { title: "Department Head approval", stages: ["DEPT_APPROVAL"], planned: crew.roleNames("DEPT_HEAD"), approval: true },
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
            { title: "Requirement check", stages: ["EMD_CLARIFICATION"], planned: crew.keyName("vishesh") },
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

const reached = (state: StepState) => state === "done" || state === "current" || state === "failed";

const MARK: Record<StepState, string> = { done: "✓", current: "●", failed: "✕", todo: "", skipped: "–" };

const SUB_LIST: CSSProperties = { display: "grid", gap: 3, marginTop: 6 };
const SUB_ROW: CSSProperties = { display: "flex", alignItems: "flex-start", gap: 6, fontSize: "0.7rem", color: "var(--muted)", whiteSpace: "normal" };
const SUB_DOT: CSSProperties = {
  width: 16,
  height: 16,
  borderRadius: "50%",
  flex: "none",
  display: "grid",
  placeItems: "center",
  fontSize: "0.6rem",
  fontWeight: 700,
  background: "#f0eeeb",
  color: "var(--muted)",
  border: "1px solid var(--line)",
};
const SUB_TONE: Record<StepState, { row: CSSProperties; dot: CSSProperties }> = {
  done: { row: { color: "inherit" }, dot: { background: "var(--moss)", borderColor: "var(--moss)", color: "#fff" } },
  current: { row: { color: "var(--ember)", fontWeight: 700 }, dot: { background: "var(--ember-bright)", borderColor: "var(--ember-bright)", color: "#fff" } },
  failed: { row: { color: "var(--wine)", fontWeight: 700 }, dot: { background: "var(--wine)", borderColor: "var(--wine)", color: "#fff" } },
  todo: { row: {}, dot: {} },
  skipped: { row: { opacity: 0.45 }, dot: {} },
};

function StepView({ step, index }: { step: Step; index: number | string }) {
  return (
    <div className={`step ${step.state}`} style={step.subs?.length ? { alignItems: "flex-start" } : undefined}>
      <span className="step-dot">{MARK[step.state] || index}</span>
      <span className="step-copy">
        <strong>{step.title}</strong>
        <small>{step.note}</small>
        {step.subs?.length ? (
          <span style={SUB_LIST} aria-label={`${step.title} stages`}>
            {step.subs.map((sub, i) => (
              <span key={sub.title} style={{ ...SUB_ROW, ...SUB_TONE[sub.state].row }}>
                <span style={{ ...SUB_DOT, ...SUB_TONE[sub.state].dot }}>{MARK[sub.state] || i + 1}</span>
                <span>
                  {sub.title}
                  {sub.who ? <small style={{ display: "block", fontWeight: sub.state === "current" ? 700 : 500 }}>{sub.who}</small> : null}
                </span>
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function StageTrack({
  tender,
  users,
}: {
  tender: TrackInput & { tasks: WorkflowTask[]; approvals: ApprovalRecord[]; costings: { stage: string; createdById: string }[]; createdById: string; submitterId: string | null; emdType: string };
  users: PublicUser[];
}) {
  const steps = stagesFor(tender, crewFrom(users, tender));
  return (
    <ol className="track" aria-label="Workflow progress">
      {steps.map((step, index) =>
        Array.isArray(step) ? (
          <li
            key="parallel"
            className={`track-item parallel ${reached(step[0].state) || reached(step[1].state) ? "reached" : ""}`}
            style={{ "--s": index, flex: 1.8, minWidth: 280 } as CSSProperties}
          >
            <span className="parallel-tag">In parallel</span>
            <StepView step={step[0]} index={`${index + 1}a`} />
            <StepView step={step[1]} index={`${index + 1}b`} />
          </li>
        ) : (
          <li key={step.key} className={`track-item ${reached(step.state) ? "reached" : ""}`} style={{ "--s": index } as CSSProperties}>
            <StepView step={step} index={index + 1} />
          </li>
        ),
      )}
    </ol>
  );
}
