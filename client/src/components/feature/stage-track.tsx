import type { CSSProperties } from "react";
import { BID, COSTING, EMD, labelOf } from "@client/lib/labels";

type StepState = "done" | "current" | "failed" | "todo" | "skipped";
type SubStep = { title: string; state: StepState };
type Step = { key: string; title: string; note: string; state: StepState; subs?: SubStep[] };

const COSTING_SUBS = ["Draft costing", "Sales input", "Final costing", "Department Head approval"];
const EMD_SUBS = ["Requirement check", "Instrument preparation", "Second verification", "Completed"];

/** Index of the costing sub-stage in progress (0-based), how many are done, and whether it failed. */
const COSTING_AT: Record<string, { done: number; failed?: boolean }> = {
  NOT_STARTED: { done: 0 },
  DRAFT_IN_PROGRESS: { done: 0 },
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

function subStepsFor(titles: string[], at: { done: number; failed?: boolean } | undefined, active: boolean, halted: boolean): SubStep[] {
  const done = at?.done ?? 0;
  return titles.map((title, i) => ({
    title,
    state:
      i < done
        ? "done"
        : i === done && active
          ? at?.failed
            ? "failed"
            : "current"
          : halted
            ? "skipped"
            : "todo",
  }));
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
export function stagesFor(t: TrackInput): (Step | [Step, Step])[] {
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

  return [
    { key: "upload", title: "Uploaded", note: "Record created", state: "done" },
    {
      key: "validate",
      title: "Data validation",
      note: validated ? "Fields confirmed" : "Check the 44 fields",
      state: validated ? "done" : "current",
    },
    {
      key: "relevance",
      title: "Relevance review",
      note: rejected ? "Rejected" : approved ? "Approved" : "Vishesh or Ranjana",
      state: rejected ? "failed" : approved ? "done" : validated && !halted ? "current" : halted ? "skipped" : "todo",
    },
    [
      {
        key: "costing",
        title: "Costing",
        note: approved ? labelOf(COSTING, t.costingStatus) : "Starts after approval",
        state: after(approved, costingDone, t.costingStatus === "REJECTED"),
        subs: subStepsFor(COSTING_SUBS, COSTING_AT[t.costingStatus], approved && !halted, halted),
      },
      {
        key: "emd",
        title: "EMD",
        note: approved ? labelOf(EMD, t.emdStatus) : "Starts after approval",
        state: after(approved, emdDone, t.emdStatus === "OVERDUE"),
        subs: subStepsFor(EMD_SUBS, EMD_AT[t.emdStatus], approved && !halted, halted),
      },
    ],
    {
      key: "ready",
      title: "Ready to bid",
      note: ready ? "All checks passed" : "Costing + EMD + submitter",
      state: missed && !ready ? "failed" : after(false, ready),
    },
    {
      key: "bid",
      title: "Bid submitted",
      note: missed ? "Deadline missed" : submitted ? labelOf(BID, t.bidStatus) : "Evidence required",
      state: missed
        ? "failed"
        : submitted && t.overallStatus !== "BID_EVIDENCE_PENDING"
          ? "done"
          : ["READY_TO_BID", "BID_EVIDENCE_PENDING"].includes(t.overallStatus)
            ? "current"
            : halted
              ? "skipped"
              : "todo",
    },
  ];
}

const reached = (state: StepState) => state === "done" || state === "current" || state === "failed";

const MARK: Record<StepState, string> = { done: "✓", current: "●", failed: "✕", todo: "", skipped: "–" };

const SUB_LIST: CSSProperties = { display: "grid", gap: 3, marginTop: 6 };
const SUB_ROW: CSSProperties = { display: "flex", alignItems: "center", gap: 6, fontSize: "0.7rem", color: "var(--muted)", whiteSpace: "nowrap" };
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
                {sub.title}
              </span>
            ))}
          </span>
        ) : null}
      </span>
    </div>
  );
}

export function StageTrack({ tender }: { tender: TrackInput }) {
  const steps = stagesFor(tender);
  return (
    <ol className="track" aria-label="Workflow progress">
      {steps.map((step, index) =>
        Array.isArray(step) ? (
          <li
            key="parallel"
            className={`track-item parallel ${reached(step[0].state) || reached(step[1].state) ? "reached" : ""}`}
            style={{ "--s": index, flex: 1.8, minWidth: 220 } as CSSProperties}
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
