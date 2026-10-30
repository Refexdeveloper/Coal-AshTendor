import type { CSSProperties } from "react";
import { BID, COSTING, EMD, labelOf } from "@client/lib/labels";

type StepState = "done" | "current" | "failed" | "todo" | "skipped";
type Step = { key: string; title: string; note: string; state: StepState };

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
      },
      {
        key: "emd",
        title: "EMD",
        note: approved ? labelOf(EMD, t.emdStatus) : "Starts after approval",
        state: after(approved, emdDone, t.emdStatus === "OVERDUE"),
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

function StepView({ step, index }: { step: Step; index: number | string }) {
  return (
    <div className={`step ${step.state}`}>
      <span className="step-dot">{MARK[step.state] || index}</span>
      <span className="step-copy">
        <strong>{step.title}</strong>
        <small>{step.note}</small>
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
            style={{ "--s": index } as CSSProperties}
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
