import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { taskAction } from "@client/api/actions";
import type { ActionState } from "@client/api/action-state";
import { confetti, fxToast } from "./fx";
import { inr } from "@client/utils/money";

/** Facts about the tender that task forms show so people can act without leaving the card. */
export type TaskContext = {
  deadline: string | null;
  deadlineText: string;
  client: string;
  location: string;
  estimatedText: string;
  estimatedValue: number | null;
  emdFee: string;
  emdTypeText: string;
  workDescription: string;
  scope: string;
  pqTechnical: string;
  pqFinancial: string;
  contractPeriod: string;
  portalRef: string;
  noticeId: string | null;
  finalCostingValue: number | null;
  emdEvidenceId: string | null;
  attention: number;
  costings: { stage: string; label: string; amountText: string; assumptions: string; documentId: string; by: string; when: string }[];
};

const SUCCESS: Record<string, { message: string; celebrate?: boolean }> = {
  validate: { message: "Sent for relevance review. Vishesh and Ranjana have been notified." },
  "approve-relevance": { message: "Tender approved. Costing and EMD have both started.", celebrate: true },
  "reject-relevance": { message: "Tender rejected and closed. The reason is in the history." },
  "cost-complete": { message: "Costing step completed and handed to the next owner." },
  "cost-return": { message: "Returned for revision with your note." },
  "dept-approve": { message: "Final costing approved.", celebrate: true },
  "dept-return": { message: "Costing returned for revision." },
  "dept-reject": { message: "Final costing rejected. A business decision task was created." },
  "emd-save": { message: "EMD progress saved." },
  "emd-complete": { message: "EMD marked prepared and verified.", celebrate: true },
  "emd-clarify": { message: "EMD type chosen. The right EMD task was created." },
  bid: { message: "Bid submission recorded.", celebrate: true },
  exception: { message: "Exception closed." },
  "assign-submitter": { message: "Bid submitter assigned." },
  close: { message: "Tender closed without bidding." },
  outcome: { message: "Outcome recorded." },
  "add-docs": { message: "Documents uploaded." },
};

/** Form bound to the task action; shows a toast (and confetti for approvals) when it succeeds. */
export function BoundForm({ children, className = "form-grid" }: { children: ReactNode; className?: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await taskAction(previous, formData);
    if (result?.ok) {
      const done = SUCCESS[String(formData.get("intent") || "")] ?? { message: "Saved." };
      fxToast(done.message);
      if (done.celebrate && formRef.current?.isConnected) confetti(formRef.current, 50);
    } else if (result?.error) {
      fxToast("That didn't go through. See the message on the card.", "error");
    }
    return result;
  }, null as ActionState);
  return (
    <form ref={formRef} action={action} className={className}>
      {state?.error ? <p className="banner bad wide">{state.error}</p> : null}
      {children}
    </form>
  );
}

/** File input with a friendly drop area that shows the chosen file's name. */
export function FilePick({
  name,
  label,
  hint,
  required = false,
  multiple = false,
  onPicked,
}: {
  name: string;
  label: string;
  hint?: string;
  required?: boolean;
  multiple?: boolean;
  onPicked?: (names: string[]) => void;
}) {
  const [names, setNames] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  return (
    <label
      className={`filepick wide ${names.length ? "has-file" : ""} ${over ? "over" : ""}`}
      onDragOver={() => setOver(true)}
      onDragLeave={() => setOver(false)}
      onDrop={() => setOver(false)}
    >
      <span className="filepick-icon" aria-hidden>
        {names.length ? "✓" : "⇪"}
      </span>
      <span className="filepick-copy">
        <strong>{names.length ? names.join(", ") : label}</strong>
        <small>{names.length ? "Click to choose a different file" : hint ?? "Click to choose, or drop a file here. PDF, image or text."}</small>
      </span>
      <input
        name={name}
        type="file"
        multiple={multiple}
        required={required}
        accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,.tif,.tiff"
        onChange={(event) => {
          const picked = [...(event.target.files ?? [])].map((file) => file.name);
          setNames(picked);
          onPicked?.(picked);
        }}
      />
    </label>
  );
}

export type Choice = { value: string; title: string; detail: string; tone: "good" | "warn" | "bad" | "info"; icon: string };

/** Large radio cards for a decision. */
export function DecisionCards({ name, choices, value, onChange }: { name: string; choices: Choice[]; value: string; onChange: (value: string) => void }) {
  return (
    <div className="decision wide" role="radiogroup">
      {choices.map((choice) => (
        <label key={choice.value} className={`decision-card ${choice.tone} ${value === choice.value ? "on" : ""}`}>
          <input type="radio" name={name} value={choice.value} checked={value === choice.value} onChange={() => onChange(choice.value)} />
          <span className="decision-icon" aria-hidden>
            {choice.icon}
          </span>
          <span className="decision-copy">
            <strong>{choice.title}</strong>
            <small>{choice.detail}</small>
          </span>
        </label>
      ))}
    </div>
  );
}

/** One-click phrases that fill a comment box. */
export function ReasonChips({ reasons, onPick }: { reasons: string[]; onPick: (reason: string) => void }) {
  return (
    <div className="reason-chips wide">
      {reasons.map((reason) => (
        <button key={reason} type="button" className="reason-chip" onClick={() => onPick(reason)}>
          + {reason}
        </button>
      ))}
    </div>
  );
}

function timeLeft(deadline: string | null, now: number) {
  if (!deadline) return "Deadline not confirmed";
  const hours = (new Date(deadline).getTime() - now) / 36e5;
  if (hours <= 0) return "Deadline has passed";
  if (hours < 48) return `${Math.floor(hours)} h ${Math.floor((hours % 1) * 60)} min left`;
  return `${Math.floor(hours / 24)} days ${Math.floor(hours % 24)} h left`;
}

/** "3 days 4 h left", refreshed every minute; filled in after mount so server and browser render the same HTML. */
export function TimeLeft({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  if (now == null) return <span className="time-left">…</span>;
  const hours = deadline ? (new Date(deadline).getTime() - now) / 36e5 : null;
  return <span className={`time-left ${hours != null && hours < 72 ? "urgent" : ""}`}>{timeLeft(deadline, now)}</span>;
}

/** True once the browser clock is known, for checks that compare against "now". */
export function useNow() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
  }, []);
  return now;
}

const RUPEES = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });

/** "9.72 crore" / "48 lakh" so a mistyped number of zeros is obvious. */
function inWords(amount: number) {
  if (amount >= 1e7) return `${+(amount / 1e7).toFixed(2)} crore`;
  if (amount >= 1e5) return `${+(amount / 1e5).toFixed(2)} lakh`;
  if (amount >= 1e3) return `${+(amount / 1e3).toFixed(1)} thousand`;
  return "";
}

/** Rupee amount box with a live formatted preview underneath. */
export function AmountInput({ name, label, required = false, defaultValue = "" }: { name: string; label: string; required?: boolean; defaultValue?: string }) {
  const [raw, setRaw] = useState(defaultValue);
  const amount = Number(raw.replace(/,/g, ""));
  const valid = raw.trim() !== "" && Number.isFinite(amount);
  return (
    <label>
      {label}
      <input name={name} inputMode="decimal" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="Digits only, e.g. 97200000" required={required} />
      {raw.trim() ? (
        valid ? (
          <small className="amount-preview">
            = {inr(amount)}{amount >= 1e5 ? ` (${RUPEES.format(amount)})` : ""}
            {inWords(amount) ? ` · ${inWords(amount)}` : ""}
          </small>
        ) : (
          <small className="text-bad">Use digits only, without “crore” or “lakh”.</small>
        )
      ) : null}
    </label>
  );
}
