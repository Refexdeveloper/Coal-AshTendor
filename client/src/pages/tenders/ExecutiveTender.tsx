import type { CSSProperties } from "react";
import { documentUrl } from "@client/api/client";
import type {
  ApprovalRecord,
  AuditLog,
  BidSubmission,
  CostingRecord,
  EmdRecord,
  PublicUser,
  Tender,
  TenderDocument,
  TenderField,
  WorkflowTask,
} from "@client/lib/types";
import { NOT_FOUND, TENDER_FIELDS } from "@client/lib/fields";
import { BID, DECISION, DOC_TYPE, EMD_TYPE, ROLES, STAGE, TASK } from "@client/lib/labels";
import { businessMinutesBetween, dayLengthMinutes, formatDay, formatDuration, formatWhen, type Calendar } from "@client/utils/calendar";
import { effectiveValue } from "@client/utils/format";
import { inr, parseInr } from "@client/utils/money";
import { stepStates, type StagePlan, type StepState } from "@client/components/feature/stage-track";

export type ExecTender = Tender & {
  fields: TenderField[];
  documents: TenderDocument[];
  tasks: WorkflowTask[];
  costings: CostingRecord[];
  approvals: ApprovalRecord[];
  emd: EmdRecord | null;
  bid: BidSubmission | null;
  audits: AuditLog[];
};

type Props = { tender: ExecTender; users: PublicUser[]; calendar: Calendar; plan?: StagePlan };

const OPEN = new Set(["NOT_STARTED", "IN_PROGRESS", "OVERDUE", "RETURNED_FOR_REVISION", "BLOCKED"]);

/** The lifecycle as the Group CEO reads it: five stages, each owning the workflow stages that feed it. */
const STAGE_GROUPS = [
  { key: "intake", step: "validate", icon: "⇪", title: "Upload & data validation", stages: ["DATA_VALIDATION", "OCR_EXCEPTION"] },
  { key: "relevance", step: "relevance", icon: "◎", title: "Relevance review", stages: ["RELEVANCE"] },
  { key: "costing", step: "costing", icon: "∑", title: "Costing", stages: ["DRAFT_COSTING", "SALES_INPUT", "FINAL_COSTING", "DEPT_APPROVAL", "BUSINESS_DECISION"] },
  { key: "emd", step: "emd", icon: "⛨", title: "EMD", stages: ["EMD_CLARIFICATION", "EMD_BG", "EMD_ISB", "EMD_EXEMPTION", "EMD_OTHER"] },
  { key: "bid", step: "bid", icon: "➤", title: "Bid submission", stages: ["BID_SUBMISSION"] },
] as const;

const STATE_LABEL: Record<StepState, { label: string; tone: string }> = {
  done: { label: "Completed", tone: "good" },
  current: { label: "In progress", tone: "progress" },
  failed: { label: "Stopped", tone: "bad" },
  todo: { label: "Not started", tone: "neutral" },
  skipped: { label: "Skipped", tone: "neutral" },
};

/** Tender fields grouped the way a reader scans a bid: money, dates, scope, risk, then contacts. */
const FIELD_GROUPS: { title: string; icon: string; keys: string[] }[] = [
  { title: "Commercials", icon: "₹", keys: ["estimated_cost", "tender_fee", "emd_fee", "emd_form", "emd_exemption", "performance_bg", "security_deposit", "price_type", "price_variation", "gst", "payment_terms"] },
  { title: "Key dates & terms", icon: "◷", keys: ["bid_submission_end", "bid_opening", "prebid_conference", "hardcopy_submission", "contract_period", "bid_validity", "mobilization"] },
  { title: "Scope & eligibility", icon: "◈", keys: ["work_description", "scope", "pq_technical", "pq_financial", "jv_allowed", "l1_acceptance", "reverse_auction"] },
  { title: "Risk & obligations", icon: "⚠", keys: ["penalties", "liquidated_damages", "penalty_recovery", "defect_liability", "quantity_deviation", "measurement_mode", "load_measurement"] },
  { title: "Portal & contacts", icon: "☏", keys: ["gem_ref", "portal_registration", "submission_mode", "hardcopy_required", "envelope_count", "contact_person", "contact_details"] },
];

function ids(raw: string) {
  try {
    const value = JSON.parse(raw || "[]") as unknown;
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function useTenderMaths({ tender, users, calendar }: Props) {
  const names = new Map(users.map((user) => [user.id, user.name]));
  const roles = new Map(users.map((user) => [user.id, user.role]));
  const name = (id: string | null | undefined) => (id ? names.get(id) ?? "Unknown" : "");
  const day = dayLengthMinutes(calendar);
  const tz = calendar.timeZone;
  const now = new Date();
  const fieldText = (key: string) => {
    const row = tender.fields.find((field) => field.fieldKey === key);
    const value = row ? effectiveValue(row).trim() : "";
    return value === NOT_FOUND ? "" : value;
  };
  return { names, roles, name, day, tz, now, fieldText };
}

/* ---------------- Executive brief ---------------- */

export function ExecutiveBrief(props: Props) {
  const { tender, calendar } = props;
  const { name, roles, day, tz, now, fieldText } = useTenderMaths(props);
  const tasks = tender.tasks.filter((task) => task.status !== "CANCELLED");
  const finished = tasks.filter((task) => task.completedAt);
  const breaches = tasks.filter((task) => task.wasOverdue || (OPEN.has(task.status) && task.dueAt && task.dueAt < now)).length;
  const emd = parseInr(fieldText("emd_fee")) ?? tender.emdExposure;
  const variance = tender.finalCostingValue != null && tender.estimatedValue ? ((tender.finalCostingValue - tender.estimatedValue) / tender.estimatedValue) * 100 : null;
  const ageDays = Math.max(0, Math.floor((now.getTime() - tender.createdAt.getTime()) / 864e5));
  const workingAge = businessMinutesBetween(tender.createdAt, tender.closedAt ?? now, calendar);
  const daysLeft = tender.bidSubmissionEnd ? Math.ceil((tender.bidSubmissionEnd.getTime() - now.getTime()) / 864e5) : null;

  const metrics = [
    { tone: "coal", icon: "₹", label: "Estimated value", value: inr(tender.estimatedValue), note: fieldText("contract_period") ? `Contract ${fieldText("contract_period")}` : "From the tender notice" },
    {
      tone: "ember",
      icon: "∑",
      label: "Final costing",
      value: inr(tender.finalCostingValue),
      note: variance == null ? "Not costed yet" : `${variance >= 0 ? "+" : ""}${variance.toFixed(1)}% vs estimate`,
      trend: variance == null ? "" : variance >= 0 ? "up" : "down",
    },
    { tone: "green", icon: "⛨", label: "EMD exposure", value: inr(emd), note: EMD_TYPE[tender.emd?.instrumentType ?? tender.emdType] ?? (tender.emdType || "Instrument not set") },
    {
      tone: daysLeft != null && daysLeft <= 3 ? "red" : "blue",
      icon: "◷",
      label: "Days to deadline",
      value: daysLeft == null ? "—" : daysLeft < 0 ? "Passed" : String(daysLeft),
      note: formatWhen(tender.bidSubmissionEnd, tz),
    },
    { tone: "violet", icon: "⧗", label: "Time in pipeline", value: `${ageDays}d`, note: `${formatDuration(workingAge, day)} working time` },
    {
      tone: breaches ? "red" : "green",
      icon: "✓",
      label: "Steps · SLA",
      value: `${finished.length}/${tasks.length}`,
      note: breaches ? `${breaches} SLA breach${breaches > 1 ? "es" : ""}` : "All within SLA",
    },
  ];

  // Everyone who has touched the tender, with what they did.
  const people = new Map<string, { role: string; parts: Set<string> }>();
  const credit = (id: string | null | undefined, part: string) => {
    if (!id) return;
    const row = people.get(id) ?? { role: roles.get(id) ?? "", parts: new Set<string>() };
    row.parts.add(part);
    people.set(id, row);
  };
  credit(tender.createdById, "Uploaded");
  for (const task of tasks) {
    if (task.completedById) credit(task.completedById, STAGE[task.stage] ?? task.stage);
    else if (OPEN.has(task.status)) for (const id of ids(task.assigneeIds)) credit(id, `${STAGE[task.stage] ?? task.stage} (now)`);
  }
  for (const approval of tender.approvals) credit(approval.approverId, `${DECISION[approval.decision] ?? approval.decision} ${STAGE[approval.stage] ?? approval.stage}`);
  credit(tender.submitterId, "Bid submitter");

  const costings = [...tender.costings].filter((row) => row.amount != null).sort((a, b) => a.version - b.version);
  const peak = Math.max(1, ...costings.map((row) => row.amount ?? 0), tender.estimatedValue ?? 0);
  const groups = FIELD_GROUPS.map((group) => ({
    ...group,
    rows: group.keys
      .map((key) => TENDER_FIELDS.find((field) => field.key === key))
      .filter((field): field is (typeof TENDER_FIELDS)[number] => Boolean(field))
      .map((field) => ({ ...field, value: fieldText(field.key) })),
  }));
  const shown = new Set(FIELD_GROUPS.flatMap((group) => group.keys));
  const filled = TENDER_FIELDS.filter((field) => fieldText(field.key)).length;

  return (
    <div className="exec-brief">
      <section className="exec-metrics">
        {metrics.map((metric, index) => (
          <article key={metric.label} className={`exec-metric ${metric.tone}`} style={{ "--i": index } as CSSProperties}>
            <span className="exec-metric-icon" aria-hidden>
              {metric.icon}
            </span>
            <span className="exec-metric-label">{metric.label}</span>
            <b>{metric.value}</b>
            <small className={metric.trend ? `trend ${metric.trend}` : undefined}>{metric.note}</small>
          </article>
        ))}
      </section>

      <div className="exec-columns">
        <div className="stack">
          {fieldText("work_description") || fieldText("scope") ? (
            <section className="panel exec-scope">
              <span className="eyebrow">What this tender is</span>
              <p>{fieldText("work_description") || fieldText("scope")}</p>
            </section>
          ) : null}
          <section className="panel">
            <header className="panel-head">
              <div>
                <h2>Tender details</h2>
                <p className="muted">
                  {filled} of {TENDER_FIELDS.length} fields captured from the notice
                </p>
              </div>
              <span className="exec-fill" style={{ "--p": filled / TENDER_FIELDS.length } as CSSProperties}>
                <i />
              </span>
            </header>
            <div className="exec-field-groups">
              {groups.map((group) => (
                <section key={group.title} className="exec-field-group">
                  <h3>
                    <span aria-hidden>{group.icon}</span>
                    {group.title}
                  </h3>
                  <dl>
                    {group.rows.map((row) => (
                      <div key={row.key} className={`${row.type === "long" ? "long" : ""} ${row.value ? "" : "missing"}`}>
                        <dt>{row.label}</dt>
                        <dd>{row.value ? (row.type === "money" && parseInr(row.value) != null ? inr(parseInr(row.value)) : row.value) : "Not in notice"}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
              <details className="exec-field-group more">
                <summary>All other fields</summary>
                <dl>
                  {TENDER_FIELDS.filter((field) => !shown.has(field.key)).map((field) => (
                    <div key={field.key} className={fieldText(field.key) ? "" : "missing"}>
                      <dt>{field.label}</dt>
                      <dd>{fieldText(field.key) || "Not in notice"}</dd>
                    </div>
                  ))}
                </dl>
              </details>
            </div>
          </section>
        </div>

        <aside className="stack">
          <section className="panel">
            <h2>Costing evolution</h2>
            {costings.length === 0 && tender.estimatedValue == null ? <p className="empty">No costing yet.</p> : null}
            <ul className="exec-bars">
              {tender.estimatedValue != null ? (
                <li className="estimate">
                  <span>Tender estimate</span>
                  <i style={{ "--w": (tender.estimatedValue ?? 0) / peak } as CSSProperties} />
                  <b>{inr(tender.estimatedValue)}</b>
                </li>
              ) : null}
              {costings.map((row, index) => (
                <li key={row.id} style={{ "--r": index } as CSSProperties}>
                  <span>
                    v{row.version} · {STAGE[row.stage] ?? row.stage}
                    <small>
                      {name(row.createdById)} · {formatDay(row.createdAt, tz)}
                    </small>
                  </span>
                  <i style={{ "--w": (row.amount ?? 0) / peak } as CSSProperties} />
                  <b>{inr(row.amount)}</b>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>Decisions</h2>
            {tender.approvals.length === 0 ? <p className="empty">No decisions recorded yet.</p> : null}
            <ul className="exec-decisions">
              {tender.approvals.map((approval) => (
                <li key={approval.id} className={approval.decision === "APPROVED" ? "good" : approval.decision === "REJECTED" ? "bad" : "warn"}>
                  <span className="exec-decision-mark" aria-hidden>
                    {approval.decision === "APPROVED" ? "✓" : approval.decision === "REJECTED" ? "✕" : "↺"}
                  </span>
                  <span>
                    <strong>
                      {DECISION[approval.decision] ?? approval.decision} · {STAGE[approval.stage] ?? approval.stage}
                    </strong>
                    <small>
                      {name(approval.approverId)} · {formatWhen(approval.createdAt, tz)}
                    </small>
                    {approval.comments ? <q>{approval.comments}</q> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel">
            <h2>People on this tender</h2>
            <ul className="exec-people">
              {[...people.entries()].map(([id, row]) => (
                <li key={id}>
                  <span className="exec-avatar" aria-hidden>
                    {name(id)
                      .split(/\s+/)
                      .map((part) => part[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                  <span>
                    <strong>{name(id)}</strong>
                    <small>{ROLES[row.role] ?? row.role}</small>
                    <em>{[...row.parts].join(" · ")}</em>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

/* ---------------- Stage-wise history ---------------- */

type Event = { at: Date; kind: "open" | "done" | "late" | "good" | "bad" | "warn" | "doc" | "money" | "info"; title: string; who?: string; note?: string; extra?: string; link?: string };

export function StageHistory(props: Props) {
  const { tender, users, calendar } = props;
  const { name, day, tz, now } = useTenderMaths(props);
  const states = stepStates(tender, users, props.plan);

  const groups = STAGE_GROUPS.map((group) => {
    const stages: readonly string[] = group.stages;
    const tasks = tender.tasks.filter((task) => stages.includes(task.stage) && task.status !== "CANCELLED");
    const events: Event[] = [];
    if (group.key === "intake") {
      events.push({ at: tender.createdAt, kind: "info", title: "Tender record created", who: name(tender.createdById), note: tender.source === "CRAWLER" ? "Discovered on the portal" : "Uploaded by hand" });
      for (const document of tender.documents)
        events.push({ at: document.uploadedAt, kind: "doc", title: `${DOC_TYPE[document.docType] ?? document.docType} uploaded`, who: name(document.uploadedById) || "System", note: document.fileName, link: documentUrl(document.id) });
    }
    for (const task of tasks) {
      const assignees = ids(task.assigneeIds).map((id) => name(id)).join(", ");
      events.push({ at: task.createdAt, kind: "open", title: `${task.title} assigned`, who: assignees, note: task.dueAt ? `Due ${formatWhen(task.dueAt, tz)}` : undefined });
      if (task.completedAt) {
        const took = businessMinutesBetween(task.createdAt, task.completedAt, calendar);
        const late = Boolean(task.wasOverdue || (task.dueAt && task.completedAt > task.dueAt));
        events.push({
          at: task.completedAt,
          kind: late ? "late" : "done",
          title: `${task.title} — ${TASK[task.status]?.label ?? task.status}`,
          who: name(task.completedById),
          note: task.comments || undefined,
          extra: `Took ${formatDuration(took, day)}${late ? " · SLA breached" : " · on time"}`,
        });
      } else if (OPEN.has(task.status) && task.dueAt && task.dueAt < now) {
        events.push({ at: task.dueAt, kind: "late", title: `${task.title} went overdue`, who: assignees, extra: `Overdue by ${formatDuration(businessMinutesBetween(task.dueAt, now, calendar), day)}` });
      }
    }
    for (const approval of tender.approvals.filter((row) => stages.includes(row.stage)))
      events.push({
        at: approval.createdAt,
        kind: approval.decision === "APPROVED" ? "good" : approval.decision === "REJECTED" ? "bad" : "warn",
        title: `${DECISION[approval.decision] ?? approval.decision}`,
        who: name(approval.approverId),
        note: approval.comments || undefined,
      });
    for (const costing of tender.costings.filter((row) => stages.includes(row.stage)))
      events.push({
        at: costing.createdAt,
        kind: "money",
        title: `Costing v${costing.version} saved${costing.amount != null ? ` · ${inr(costing.amount)}` : ""}`,
        who: name(costing.createdById),
        note: costing.assumptions || undefined,
        link: costing.documentId ? documentUrl(costing.documentId) : undefined,
      });
    if (group.key === "emd" && tender.emd) {
      if (tender.emd.verifiedAt) events.push({ at: tender.emd.verifiedAt, kind: "good", title: "EMD instrument verified", note: [tender.emd.referenceNumber, tender.emd.beneficiary].filter(Boolean).join(" · ") || undefined });
      if (tender.emd.completedAt)
        events.push({ at: tender.emd.completedAt, kind: "done", title: "EMD completed", note: tender.emd.submittedToAuthority ? `Submitted to authority. ${tender.emd.authorityNote}` : undefined, link: tender.emd.documentId ? documentUrl(tender.emd.documentId) : undefined });
    }
    if (group.key === "bid" && tender.bid?.submittedAt)
      events.push({
        at: tender.bid.submittedAt,
        kind: "good",
        title: `Bid submitted on portal · ${BID[tender.bid.status]?.label ?? tender.bid.status}`,
        who: name(tender.bid.submitterId),
        note: tender.bid.referenceNumber ? `Reference ${tender.bid.referenceNumber}` : tender.bid.exceptionReason ? `Authorized exception: ${tender.bid.exceptionReason}` : undefined,
        link: tender.bid.evidenceDocumentId ? documentUrl(tender.bid.evidenceDocumentId) : undefined,
      });
    events.sort((a, b) => a.at.getTime() - b.at.getTime());

    const state = states[group.step] ?? "todo";
    const start = events[0]?.at ?? null;
    const end = state === "done" ? events[events.length - 1]?.at ?? null : null;
    const minutes = start ? businessMinutesBetween(start, end ?? (state === "current" ? now : events[events.length - 1].at), calendar) : 0;
    const done = tasks.filter((task) => task.completedAt);
    const late = tasks.filter((task) => task.wasOverdue || (task.dueAt && (task.completedAt ?? now) > task.dueAt)).length;
    const owners = [
      ...new Set([
        ...tasks.flatMap((task) => (task.completedById ? [name(task.completedById)] : ids(task.assigneeIds).map((id) => name(id)))),
        ...events.filter((event) => event.kind !== "open" && event.kind !== "doc").flatMap((event) => (event.who ?? "").split(", ")),
      ]),
    ].filter(Boolean);
    return { ...group, state, events, start, end, minutes, done: done.length, total: tasks.length, late, owners };
  });

  const longest = Math.max(1, ...groups.map((group) => group.minutes));
  const totalMinutes = groups.reduce((sum, group) => sum + group.minutes, 0);

  return (
    <div className="exec-history">
      <section className="panel exec-durations">
        <header className="panel-head">
          <div>
            <h2>Where the time went</h2>
            <p className="muted">Working time spent in each stage (business hours only). Costing and EMD run side by side.</p>
          </div>
          <span className="exec-total">
            <b>{formatDuration(totalMinutes, day)}</b>
            <small>total stage time</small>
          </span>
        </header>
        <ul>
          {groups.map((group, index) => (
            <li key={group.key} className={group.state} style={{ "--w": group.minutes / longest, "--r": index } as CSSProperties}>
              <span className="exec-duration-label">
                <span aria-hidden>{group.icon}</span>
                {group.title}
              </span>
              <span className="exec-duration-bar">
                <i />
              </span>
              <b>{group.start ? formatDuration(group.minutes, day) : "—"}</b>
            </li>
          ))}
        </ul>
      </section>

      <ol className="exec-stages">
        {groups.map((group, index) => (
          <li key={group.key} className={`exec-stage ${group.state}`} style={{ "--r": index } as CSSProperties}>
            <span className="exec-stage-node" aria-hidden>
              {group.state === "done" ? "✓" : group.state === "failed" ? "✕" : index + 1}
            </span>
            <details className="exec-stage-card" open={group.state !== "todo" && group.state !== "skipped"}>
              <summary>
                <span className="exec-stage-icon" aria-hidden>
                  {group.icon}
                </span>
                <span className="exec-stage-title">
                  <strong>{group.title}</strong>
                  <small>
                    {group.start ? `${formatWhen(group.start, tz)} → ${group.end ? formatWhen(group.end, tz) : group.state === "current" ? "ongoing" : "—"}` : group.state === "done" ? "Completed — no step records kept" : "Not started yet"}
                  </small>
                </span>
                <span className={`pill ${STATE_LABEL[group.state].tone}`}>{STATE_LABEL[group.state].label}</span>
              </summary>
              <div className="exec-stage-stats">
                <span>
                  <small>Working time</small>
                  <b>{group.start ? formatDuration(group.minutes, day) : "—"}</b>
                </span>
                <span>
                  <small>Steps done</small>
                  <b>
                    {group.done}/{group.total}
                  </b>
                </span>
                <span className={group.late ? "bad" : ""}>
                  <small>SLA</small>
                  <b>{group.total === 0 ? "—" : group.late ? `${group.late} breached` : "On time"}</b>
                </span>
                <span className="exec-owners">
                  <small>Handled by</small>
                  <b>{group.owners.join(", ") || "—"}</b>
                </span>
              </div>
              {group.events.length ? (
                <ul className="exec-events">
                  {group.events.map((event, i) => (
                    <li key={`${event.at.getTime()}-${i}`} className={event.kind}>
                      <time>{formatWhen(event.at, tz)}</time>
                      <span className="exec-event-body">
                        <strong>{event.title}</strong>
                        {event.who ? <small>{event.who}</small> : null}
                        {event.note ? <p>{event.note}</p> : null}
                        {event.extra || event.link ? (
                          <span className="exec-event-extra">
                            {event.extra}
                            {event.link ? (
                              <a href={event.link} target="_blank" rel="noreferrer">
                                Open file
                              </a>
                            ) : null}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">{group.state === "done" ? "This stage is complete, but no step-by-step records were kept for it." : "Nothing has happened in this stage yet."}</p>
              )}
            </details>
          </li>
        ))}
      </ol>

      <section className="panel">
        <h2>Full activity log</h2>
        <p className="muted">Every action recorded on this tender, newest first.</p>
        {tender.audits.length === 0 ? <p className="empty">No actions recorded yet.</p> : null}
        <ul className="timeline">
          {tender.audits.map((entry, index) => (
            <li key={entry.id} style={{ "--r": Math.min(index, 12) } as CSSProperties}>
              <strong>{entry.action}</strong>
              <small>
                {entry.actorName || "System"} · {formatWhen(entry.createdAt, tz)}
              </small>
              {entry.detail ? <p>{entry.detail}</p> : null}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

