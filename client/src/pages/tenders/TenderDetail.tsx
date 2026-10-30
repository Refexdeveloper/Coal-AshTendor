import { Link, useParams, useSearchParams } from "react-router-dom";
import { lazy, Suspense, type CSSProperties } from "react";
import { documentUrl, toCalendar, useApi } from "@client/api/client";
import { useActor } from "@client/api/session";
import type {
  ApprovalRecord,
  AuditLog,
  BidSubmission,
  CalendarJson,
  ChecklistItem,
  CostingRecord,
  EmdRecord,
  NotificationLog,
  PublicUser,
  Tender,
  TenderDocument,
  TenderField,
  WorkflowTask,
} from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { businessMinutesBetween, dayLengthMinutes, formatDuration, formatWhen } from "@client/utils/calendar";
import { effectiveValue } from "@client/utils/format";
import { NOT_FOUND, TENDER_FIELDS } from "@client/lib/fields";
import {
  APPROVAL,
  BID,
  CLOSED_OVERALL,
  COSTING,
  DECISION,
  DOC_TYPE,
  EDITOR_ROLES,
  EMD,
  EMD_PREP,
  EMD_TYPE,
  MANAGER_ROLES,
  OPEN_TASK,
  OVERALL,
  RELEVANCE,
  STAGE,
  TASK,
} from "@client/lib/labels";
import { inr, parseInr } from "@client/utils/money";
import { Status } from "@client/components/base/pill";
import { FieldEditor } from "@client/components/feature/field-editor";
import { Countdown } from "@client/components/feature/countdown";
import { StageTrack } from "@client/components/feature/stage-track";
import type { TaskContext } from "@client/components/feature/task-kit";
import { ManagePanel, TaskCards, UploadForm } from "@client/components/feature/workbench";

const PdfViewer = lazy(() => import("@client/components/feature/pdf-viewer"));

const TABS = [
  ["overview", "Overview"],
  ["details", "Tender details"],
  ["documents", "Documents"],
  ["costing", "Costing, EMD & bid"],
  ["history", "History"],
] as const;

type Data = {
  tender: Tender & {
    fields: TenderField[];
    documents: TenderDocument[];
    tasks: WorkflowTask[];
    costings: CostingRecord[];
    approvals: ApprovalRecord[];
    emd: EmdRecord | null;
    bid: BidSubmission | null;
    audits: AuditLog[];
    notifications: NotificationLog[];
  };
  users: PublicUser[];
  calendar: CalendarJson;
  bgRequiresBoth: boolean;
  fieldEditor: boolean;
  checklist: ChecklistItem[];
};

export default function TenderPage() {
  const { id = "" } = useParams();
  const [search] = useSearchParams();
  const actor = useActor();
  const { data, error, reload } = useApi<Data>(`/tenders/${encodeURIComponent(id)}`);
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;
  const query = { notice: search.get("notice"), error: search.get("error"), tab: search.get("tab"), new: search.get("new") };
  const { tender, users, fieldEditor } = data;
  const calendar = toCalendar(data.calendar);
  const tab = TABS.find(([key]) => key === query.tab)?.[0] ?? "overview";
  const names = new Map(users.map((user) => [user.id, user.name]));
  const now = new Date();
  const day = dayLengthMinutes(calendar);
  const tz = calendar.timeZone;
  const closed = CLOSED_OVERALL.includes(tender.overallStatus);
  const checklist = data.checklist;
  const notice = tender.documents.find((document) => document.docType === "NOTICE");
  const bidSubmitted = ["BID_SUBMITTED_EVIDENCE_PENDING", "BID_SUBMITTED_EVIDENCE_RECORDED"].includes(tender.bidStatus);
  const assigned = (ids: string) => JSON.parse(ids) as string[];
  const openTasks = tender.tasks
    .filter((task) => OPEN_TASK.includes(task.status))
    .map((task) => ({
      id: task.id,
      stage: task.stage,
      title: task.title,
      status: task.status,
      mine: assigned(task.assigneeIds).includes(actor.id),
      late: Boolean(task.dueAt && task.dueAt < now),
      due: formatWhen(task.dueAt, tz),
      remaining: !task.dueAt
        ? ""
        : task.dueAt < now
          ? `· overdue by ${formatDuration(businessMinutesBetween(task.dueAt, now, calendar), day)}`
          : `· ${formatDuration(businessMinutesBetween(now, task.dueAt, calendar), day)} working time left`,
      comments: task.comments,
      assignees: assigned(task.assigneeIds).map((userId) => names.get(userId) ?? "Unknown").join(", "),
    }))
    .sort((a, b) => Number(b.mine) - Number(a.mine));
  const mineCount = openTasks.filter((task) => task.mine).length;
  const attention = tender.fields.filter((field) => ["MISSING", "LOW_CONFIDENCE", "CONFLICT"].includes(field.validationStatus)).length;
  const editorFields = TENDER_FIELDS.map((definition) => {
    const row = tender.fields.find((field) => field.fieldKey === definition.key);
    return {
      ...definition,
      value: row ? effectiveValue(row) : "",
      extracted: row?.extractedValue ?? "",
      status: row?.validationStatus ?? "MISSING",
      confidence: row?.confidence ?? null,
      page: row?.sourcePage ?? "",
      conflict: row?.conflictNote ?? "",
    };
  });
  const fieldText = (key: string) => {
    const row = tender.fields.find((field) => field.fieldKey === key);
    const value = row ? effectiveValue(row).trim() : "";
    return value === NOT_FOUND ? "" : value;
  };
  const ctx: TaskContext = {
    deadline: tender.bidSubmissionEnd?.toISOString() ?? null,
    deadlineText: formatWhen(tender.bidSubmissionEnd, tz),
    client: tender.clientName || fieldText("client_name"),
    location: tender.location,
    estimatedText: inr(tender.estimatedValue),
    estimatedValue: tender.estimatedValue,
    emdFee: inr(parseInr(fieldText("emd_fee")) ?? tender.emdExposure),
    emdTypeText: EMD_TYPE[tender.emdType] ?? tender.emdType,
    workDescription: fieldText("work_description"),
    scope: fieldText("scope"),
    pqTechnical: fieldText("pq_technical"),
    pqFinancial: fieldText("pq_financial"),
    contractPeriod: fieldText("contract_period"),
    portalRef: fieldText("gem_ref"),
    noticeId: notice?.id ?? null,
    finalCostingValue: tender.finalCostingValue,
    emdEvidenceId: tender.emd?.documentId || null,
    attention,
    costings: tender.costings.map((record) => ({
      stage: record.stage,
      label: STAGE[record.stage] ?? record.stage,
      amountText: record.amount != null ? inr(record.amount) : "",
      assumptions: record.assumptions,
      documentId: record.documentId,
      by: names.get(record.createdById) ?? "Unknown",
      when: formatWhen(record.createdAt, tz),
    })),
  };
  const tabBadge: Record<string, number> = { overview: mineCount, details: attention, documents: tender.documents.length };

  return (
    <>
      <section className="tender-hero">
        <div className="embers" aria-hidden>
          <i /><i /><i /><i /><i /><i /><i /><i /><i />
        </div>
        <div className="tender-hero-main">
          <p className="crumb">
            <Link to="/register">Tender register</Link> <span>/</span> {tender.recordId}
          </p>
          <div className="hero-chips">
            <span className="id-chip">{tender.recordId}</span>
            <Status map={OVERALL} value={tender.overallStatus} />
            {tender.source === "CRAWLER" ? <span className="pill info">Discovered on portal</span> : null}
          </div>
          <h1>
            <span className="ember-text">{tender.projectName || "Untitled tender"}</span>
          </h1>
          <p className="hero-meta">
            {[tender.clientName || "Client not set", tender.location, tender.portalName, tender.tenderRef || tender.externalTenderId].filter(Boolean).join("  ·  ")}
          </p>
        </div>
        <aside className="tender-hero-side">
          <p className="hero-side-lbl">{closed ? "Bid deadline" : "Time to bid deadline"}</p>
          {closed ? <p className="countdown-note">{formatWhen(tender.bidSubmissionEnd, tz)}</p> : <Countdown deadline={tender.bidSubmissionEnd?.toISOString() ?? null} />}
          <p className="hero-deadline">{formatWhen(tender.bidSubmissionEnd, tz)}</p>
        </aside>
      </section>
      {query.error ? <p className="banner bad">{query.error}</p> : null}
      {query.notice ? <p className="banner good">{query.notice}</p> : null}
      {tender.duplicateWarning ? <p className="banner warn">{tender.duplicateWarning}</p> : null}
      {tender.ocrStatus === "FAILED" ? (
        <p className="banner bad">Text could not be read from the upload. Enter the fields in Tender details, or upload a readable copy. The workflow stays open.</p>
      ) : null}
      {closed ? (
        <p className="banner neutral">
          <b>Closed — {OVERALL[tender.overallStatus]?.label ?? tender.overallStatus}.</b> {tender.closureReason || tender.outcomeNotes}
        </p>
      ) : null}

      <section className="panel track-panel">
        <StageTrack tender={tender} />
      </section>

      <section className="facts">
        {[
          { icon: "₹", tone: "coal", label: "Estimated value", value: inr(tender.estimatedValue), extra: tender.bidOpeningAt ? `Opens ${formatWhen(tender.bidOpeningAt, tz)}` : null },
          { icon: "∑", tone: "ember", label: "Final costing", value: inr(tender.finalCostingValue), extra: <Status map={APPROVAL} value={tender.approvalStatus} /> },
          { icon: "⛨", tone: "green", label: "EMD Value", value: inr(parseInr(fieldText("emd_fee")) ?? tender.emdExposure), extra: <Status map={EMD} value={tender.emdStatus} /> },
          { icon: "✎", tone: "blue", label: "Open tasks", value: String(openTasks.length), extra: mineCount ? <span className="pill info">{mineCount} for you</span> : <span className="muted">none for you</span> },
        ].map((fact, index) => (
          <article key={fact.label} className={`fact ${fact.tone}`} style={{ "--i": index } as CSSProperties}>
            <span className="fact-icon" aria-hidden>
              {fact.icon}
            </span>
            <div>
              <span className="fact-label">{fact.label}</span>
              <b>{fact.value}</b>
              <span className="fact-extra">{fact.extra}</span>
            </div>
          </article>
        ))}
      </section>

      <nav className="tabs" aria-label="Tender sections">
        {TABS.map(([key, label]) => (
          <Link key={key} to={`/tenders/${tender.id}?tab=${key}`} className={`tab ${tab === key ? "active" : ""}`}>
            {label}
            {tabBadge[key] ? <span className="cnt">{tabBadge[key]}</span> : null}
          </Link>
        ))}
      </nav>

      <div key={tab} className="tab-body">
      {tab === "overview" ? (
        <div className="overview">
          <div className="stack">
            <h2 className="section-title">
              Open tasks {mineCount ? <span className="count-badge">{mineCount} for you</span> : null}
            </h2>
            <TaskCards
              tenderId={tender.id}
              tasks={openTasks}
              bgRequiresBoth={data.bgRequiresBoth}
              canAuthorize={actor.role === "ADMIN" || actor.role === "DEPT_HEAD"}
              ctx={ctx}
              emd={
                tender.emd
                  ? {
                      amount: tender.emd.amount,
                      beneficiary: tender.emd.beneficiary,
                      referenceNumber: tender.emd.referenceNumber,
                      exemptionBasis: tender.emd.exemptionBasis,
                      notes: tender.emd.notes,
                      authorityNote: tender.emd.authorityNote,
                      submitted: tender.emd.submittedToAuthority,
                    }
                  : null
              }
            />
            {!closed && MANAGER_ROLES.includes(actor.role) ? (
              <ManagePanel
                tenderId={tender.id}
                users={users.map((user) => ({ id: user.id, name: user.name, role: user.role }))}
                submitterId={tender.submitterId}
                bidSubmitted={bidSubmitted}
              />
            ) : null}
          </div>
          <aside className="stack">
            <section className="panel">
              <header className="panel-head">
                <div>
                  <h2>Bid readiness</h2>
                  <p className="muted">{checklist.every((item) => item.ok) ? "Everything is in place" : "Outstanding items and who owns them"}</p>
                </div>
                <Ring done={checklist.filter((item) => item.ok).length} total={checklist.length} />
              </header>
              <ul className="checklist">
                {checklist.map((item, index) => (
                  <li key={item.label} className={item.ok ? "ok" : "no"} style={{ "--r": index } as CSSProperties}>
                    <span className="check-mark" aria-hidden>
                      {item.ok ? "✓" : "!"}
                    </span>
                    <span>
                      {item.label}
                      {item.ok ? null : <small>{item.gap} Owner: {item.owner}</small>}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="muted fine">Ready to bid is an internal check. Only the recorded portal submission counts as a bid.</p>
            </section>
            <section className="panel">
              <h2>Branch status</h2>
              <dl className="kv">
                <dt>Relevance</dt>
                <dd>
                  <Status map={RELEVANCE} value={tender.relevanceStatus} />
                  {tender.relevanceOverdue ? <span className="pill bad">Overdue</span> : null}
                </dd>
                <dt>Costing</dt>
                <dd>
                  <Status map={COSTING} value={tender.costingStatus} />
                </dd>
                <dt>EMD</dt>
                <dd>
                  <Status map={EMD} value={tender.emdStatus} />
                </dd>
                <dt>Bid</dt>
                <dd>
                  <Status map={BID} value={tender.bidStatus} />
                </dd>
                <dt>Submitter</dt>
                <dd>{tender.submitterId ? names.get(tender.submitterId) : <span className="muted">Not assigned</span>}</dd>
              </dl>
            </section>
          </aside>
        </div>
      ) : null}

      {tab === "details" ? (
        <>
          <div className="detail-split">
            <NoticePane document={notice ?? tender.documents[0] ?? null} />
            <FieldEditor
              tenderId={tender.id}
              fields={editorFields}
              locked={closed || !fieldEditor}
              validationTaskId={openTasks.find((task) => task.mine && task.stage === "DATA_VALIDATION")?.id ?? null}
              justUploaded={query.new === "1"}
            />
          </div>
          <OcrResults documents={tender.documents} />
        </>
      ) : null}

      {tab === "documents" ? (
        <div className="overview">
          <div className="stack">
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>File</th>
                    <th>Type</th>
                    <th>Pages</th>
                    <th>Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {tender.documents.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="empty">
                        No files stored.
                      </td>
                    </tr>
                  ) : null}
                  {tender.documents.map((document) => (
                    <tr key={document.id}>
                      <td>
                        <a href={documentUrl(document.id)} target="_blank" rel="noreferrer">
                          {document.fileName}
                        </a>
                      </td>
                      <td>
                        {DOC_TYPE[document.docType] ?? document.docType}
                        {document.version > 1 ? <span className="muted"> · v{document.version}</span> : null}
                      </td>
                      <td>{document.pageCount || "—"}</td>
                      <td>
                        {formatWhen(document.uploadedAt, tz)}
                        <div className="muted">{names.get(document.uploadedById) ?? "System"}</div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {notice && (notice.mimeType === "application/pdf" || notice.fileName.toLowerCase().endsWith(".pdf")) ? (
              <section className="panel">
                <h2>Tender notice preview</h2>
                <div className="preview">
                  <Suspense fallback={<Loading />}>
                    <PdfViewer src={documentUrl(notice.id)} name={notice.fileName} />
                  </Suspense>
                </div>
              </section>
            ) : null}
            <OcrResults documents={tender.documents} />
          </div>
          <aside>
            {!closed && (EDITOR_ROLES.includes(actor.role) || actor.id === tender.createdById) ? (
              <section className="panel">
                <UploadForm tenderId={tender.id} />
              </section>
            ) : null}
          </aside>
        </div>
      ) : null}

      {tab === "costing" ? (
        <div className="split-2">
          <section className="panel">
            <h2>Costing versions</h2>
            {tender.costings.length === 0 ? <p className="empty">No costing sheet yet.</p> : null}
            <ul className="timeline">
              {tender.costings.map((record, index) => (
                <li key={record.id} style={{ "--r": index } as CSSProperties}>
                  <strong>
                    v{record.version} · {STAGE[record.stage] ?? record.stage}
                    {record.amount != null ? ` · ${inr(record.amount)}` : ""}
                  </strong>
                  <small>
                    {names.get(record.createdById)} · {formatWhen(record.createdAt, tz)}
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
            </ul>
          </section>
          <div className="stack">
            <section className="panel">
              <h2>EMD</h2>
              {tender.emd ? (
                <dl className="kv">
                  <dt>Instrument</dt>
                  <dd>{EMD_TYPE[tender.emd.instrumentType] ?? tender.emd.instrumentType}</dd>
                  <dt>Preparation</dt>
                  <dd>{EMD_PREP[tender.emd.preparationStatus] ?? tender.emd.preparationStatus}</dd>
                  <dt>Amount</dt>
                  <dd>{tender.emd.amount || "—"}</dd>
                  <dt>Reference</dt>
                  <dd>{tender.emd.referenceNumber || "—"}</dd>
                  <dt>Beneficiary</dt>
                  <dd>{tender.emd.beneficiary || "—"}</dd>
                  {tender.emd.exemptionBasis ? (
                    <>
                      <dt>Exemption basis</dt>
                      <dd>{tender.emd.exemptionBasis}</dd>
                    </>
                  ) : null}
                  <dt>To authority</dt>
                  <dd>{tender.emd.submittedToAuthority ? `Submitted. ${tender.emd.authorityNote}` : "Not recorded"}</dd>
                  {tender.emd.documentId ? (
                    <>
                      <dt>Evidence</dt>
                      <dd>
                        <a href={documentUrl(tender.emd.documentId)} target="_blank" rel="noreferrer">
                          Open
                        </a>
                      </dd>
                    </>
                  ) : null}
                </dl>
              ) : (
                <p className="empty">EMD starts when relevance is approved.</p>
              )}
            </section>
            <section className="panel">
              <h2>Bid submission</h2>
              {tender.bid && tender.bid.status !== "NOT_YET_SUBMITTED" ? (
                <dl className="kv">
                  <dt>Status</dt>
                  <dd>
                    <Status map={BID} value={tender.bid.status} />
                  </dd>
                  <dt>Submitted</dt>
                  <dd>{formatWhen(tender.bid.submittedAt, tz)}</dd>
                  <dt>Reference</dt>
                  <dd>{tender.bid.referenceNumber || "—"}</dd>
                  <dt>Evidence</dt>
                  <dd>
                    {tender.bid.evidenceDocumentId ? (
                      <a href={documentUrl(tender.bid.evidenceDocumentId)} target="_blank" rel="noreferrer">
                        Open acknowledgement
                      </a>
                    ) : tender.bid.exceptionReason ? (
                      `Authorized exception: ${tender.bid.exceptionReason}`
                    ) : (
                      "Not uploaded"
                    )}
                  </dd>
                </dl>
              ) : (
                <p className="empty">Nothing recorded yet.</p>
              )}
            </section>
          </div>
        </div>
      ) : null}

      {tab === "history" ? (
        <div className="split-2">
          <div className="stack">
            <section className="panel">
              <h2>Decisions</h2>
              {tender.approvals.length === 0 ? <p className="empty">No decisions yet.</p> : null}
              <ul className="timeline">
                {tender.approvals.map((approval, index) => (
                  <li key={approval.id} style={{ "--r": index } as CSSProperties} className={approval.decision === "APPROVED" ? "good" : approval.decision === "REJECTED" ? "bad" : "warn"}>
                    <strong>
                      {STAGE[approval.stage] ?? approval.stage}: {DECISION[approval.decision] ?? approval.decision}
                    </strong>
                    <small>
                      {names.get(approval.approverId)} · {formatWhen(approval.createdAt, tz)}
                    </small>
                    {approval.comments ? <p>{approval.comments}</p> : null}
                  </li>
                ))}
              </ul>
            </section>
            <section className="panel">
              <h2>Tasks</h2>
              <div className="table-wrap flat">
                <table>
                  <thead>
                    <tr>
                      <th>Task</th>
                      <th>Status</th>
                      <th>Due / done</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tender.tasks.map((task) => (
                      <tr key={task.id}>
                        <td>
                          {task.title}
                          <div className="muted">{assigned(task.assigneeIds).map((userId) => names.get(userId) ?? "Unknown").join(", ")}</div>
                        </td>
                        <td>
                          <Status map={TASK} value={task.status} />
                          {task.wasOverdue ? <div className="muted">Breached SLA</div> : null}
                        </td>
                        <td>{formatWhen(task.completedAt ?? task.dueAt, tz)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
          <div className="stack">
            <section className="panel">
              <h2>Audit trail</h2>
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
            <section className="panel">
              <h2>Emails sent</h2>
              {tender.notifications.length === 0 ? <p className="empty">No emails yet.</p> : null}
              <ul className="timeline">
                {tender.notifications.map((note, index) => (
                  <li key={note.id} style={{ "--r": Math.min(index, 12) } as CSSProperties} className={note.status === "FAILED" ? "bad" : ""}>
                    <strong>{note.subject}</strong>
                    <small>
                      {note.recipientName || note.recipientEmail} · {note.status.toLowerCase()} · {formatWhen(note.createdAt, tz)}
                    </small>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      ) : null}
      </div>
    </>
  );
}

function formatOcr(raw: string) {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function OcrResults({ documents }: { documents: TenderDocument[] }) {
  const shown = documents.filter((document) => document.ocrJson?.trim());
  if (!shown.length) return null;
  return (
    <section className="panel stack">
      <h2>OCR result</h2>
      <p className="muted">This JSON is also emailed to sathishkumar.r@refex.co.in.</p>
      {shown.map((document) => (
        <div key={document.id}>
          <p className="muted">{document.fileName}</p>
          <pre className="ocr-json">{formatOcr(document.ocrJson || "")}</pre>
        </div>
      ))}
    </section>
  );
}

function NoticePane({ document }: { document: TenderDocument | null }) {
  const name = document?.fileName ?? "";
  const mime = (document?.mimeType ?? "").toLowerCase();
  const lower = name.toLowerCase();
  const pdf = mime === "application/pdf" || lower.endsWith(".pdf");
  const image = mime.startsWith("image/") || /\.(png|jpe?g|gif|webp)$/.test(lower);
  const src = document ? documentUrl(document.id) : "";
  const preview = Boolean(document && (pdf || image));
  return (
    <aside className={`panel notice-pane${preview ? "" : " is-empty"}`}>
      <header className="panel-head">
        <div>
          <h2>Tender file</h2>
          <p className="muted">{document ? name : "No file stored"}</p>
        </div>
        {document ? (
          <a className="btn ghost" href={src} target="_blank" rel="noreferrer">
            Open
          </a>
        ) : null}
      </header>
      {document && pdf ? (
        <Suspense fallback={<div className="notice-frame pdfv-state">Loading the viewer…</div>}>
          <PdfViewer src={src} name={name} />
        </Suspense>
      ) : null}
      {document && image ? <img className="notice-frame" alt={name} src={src} /> : null}
      {document && !pdf && !image ? <p className="empty">This file cannot be shown here. Use Open to view it.</p> : null}
      {document ? null : <p className="empty">Upload the tender notice on the Documents tab to see it beside these fields.</p>}
    </aside>
  );
}

function Ring({ done, total }: { done: number; total: number }) {
  const share = total ? done / total : 0;
  return (
    <span className={`ring ${share === 1 ? "full" : ""}`} style={{ "--p": share } as CSSProperties} aria-label={`${done} of ${total} checks passed`}>
      <svg viewBox="0 0 44 44" aria-hidden>
        <circle className="ring-track" cx="22" cy="22" r="18" />
        <circle className="ring-fill" cx="22" cy="22" r="18" />
      </svg>
      <b>
        {done}/{total}
      </b>
    </span>
  );
}
