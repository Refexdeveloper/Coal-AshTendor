import { Fragment, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { apiGet, postAction, useApi } from "@client/api/client";
import { useActor } from "@client/api/session";
import { LoadFailed, Loading } from "@client/components/base/loading";

type Attachment = { filename: string; size: number; documentId?: string };
type LogRow = {
  id: string;
  tenderId: string | null;
  eventType: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  status: string;
  deliveredTo: string;
  messageId: string;
  errorMessage: string | null;
  attachments: Attachment[];
  note: string | null;
  sentAt: Date | null;
  createdAt: Date;
  tender: { id: string; recordId: string; projectName: string } | null;
};
type Data = {
  items: LogRow[];
  total: number;
  page: number;
  size: number;
  counts: Record<string, number>;
  types: string[];
  mail: { ready: boolean; from: string; testInbox: string };
};

const STATUS: Record<string, { label: string; tone: string }> = {
  SENT: { label: "Sent", tone: "good" },
  FAILED: { label: "Failed", tone: "bad" },
  LOGGED: { label: "Not sent", tone: "warn" },
  QUEUED: { label: "Queued", tone: "info" },
};

const TYPE_LABEL: Record<string, string> = {
  WORKFLOW_STEP: "Step update",
  TASK_ASSIGNED: "Task assigned",
  TASK_COMPLETED: "Task completed",
  RELEVANCE_DECISION: "Relevance decision",
  APPROVAL_DECISION: "Costing decision",
  EMD_COMPLETED: "EMD",
  SLA_REMINDER_50: "SLA 50%",
  SLA_REMINDER_75: "SLA 75%",
  SLA_BREACH: "SLA breach",
  SLA_BREACH_LEVEL2: "SLA escalation",
  BID_DEADLINE: "Bid deadline",
  BID_READY: "Ready to bid",
  SUBMISSION_EVIDENCE_MISSING: "Evidence missing",
  DEADLINE_MISSED: "Deadline missed",
  OCR_FAILED: "Extraction failed",
  OCR_RESULT: "OCR result",
  TENDER_AMENDMENT: "Deadline changed",
  DAILY_REPORT: "Today's report",
  SIGN_IN_DETAILS: "Sign-in details",
};

const when = (date: Date | null) => (date ? date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—");
const size = (bytes: number) => (bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);
const canResend = (status: string) => status === "FAILED" || status === "LOGGED" || status === "QUEUED";

/** Every email the app sent or tried to send, like P2P's email log: filter, inspect, preview and resend. */
export default function EmailLogsPage() {
  const actor = useActor();
  const [search, setSearch] = useSearchParams();
  const status = search.get("status") ?? "";
  const type = search.get("type") ?? "";
  const q = search.get("q") ?? "";
  const page = Number(search.get("page") || 1);
  const [draft, setDraft] = useState(q);
  const [open, setOpen] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<{ ok?: string; error?: string } | null>(null);
  const query = new URLSearchParams({ ...(status && { status }), ...(type && { type }), ...(q && { q }), page: String(page) });
  const { data: fresh, error, reload } = useApi<Data>(`/email-logs?${query}`);
  // Keep the last result on screen while a new filter loads.
  const last = useRef<Data | undefined>(undefined);
  if (fresh) last.current = fresh;
  const data = fresh ?? last.current;

  if (actor.role !== "ADMIN") return <p className="panel">The email log is limited to the system administrator.</p>;
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;

  const set = (key: string, value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== "page") next.delete("page");
    setSearch(next, { replace: true });
  };
  const all = Object.values(data.counts).reduce((sum, n) => sum + n, 0);
  const pages = Math.max(1, Math.ceil(data.total / data.size));
  const sendReport = async () => {
    setSending(true);
    setNotice(null);
    const form = new FormData();
    form.set("to", "sathishkumar.r@refex.co.in, gowtham.s@refex.co.in");
    const answer = await postAction("send-today-report", form);
    setSending(false);
    setNotice(answer?.error ? { error: answer.error } : { ok: answer?.ok ?? "Today's report sent to sathishkumar.r@refex.co.in and gowtham.s@refex.co.in." });
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Email log</h1>
          <p>
            Every email Coal &amp; Ash sends or tries to send: who it was for, where it went, attachments, and why it failed. Open a row to preview it or send it
            again.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn" onClick={() => void sendReport()} disabled={sending}>
            {sending ? "Sending…" : "Send today's report"}
          </button>
          <button type="button" className="btn ghost" onClick={() => void reload()}>
            Refresh
          </button>
        </div>
      </header>
      {notice?.ok ? <p className="banner good">{notice.ok}</p> : null}
      {notice?.error ? <p className="banner bad">{notice.error}</p> : null}

      <section className={`banner ${data.mail.ready ? (data.mail.testInbox ? "warn" : "good") : "bad"}`}>
        {data.mail.ready ? `Sending from ${data.mail.from}.` : "Mail is not set up (no SMTP password), so emails are logged but not sent."}
        {data.mail.testInbox ? ` Test mode: every email goes only to ${data.mail.testInbox}.` : ""}
      </section>

      <div className="mail-counts">
        <button type="button" className={`mail-count ${status === "" ? "on" : ""}`} onClick={() => set("status", "")}>
          <span>All</span>
          <b>{all}</b>
        </button>
        {Object.entries(STATUS).map(([key, item]) => (
          <button key={key} type="button" className={`mail-count ${item.tone} ${status === key ? "on" : ""}`} onClick={() => set("status", status === key ? "" : key)}>
            <span>{item.label}</span>
            <b>{data.counts[key] ?? 0}</b>
          </button>
        ))}
      </div>

      <form
        className="panel mail-filters"
        onSubmit={(event) => {
          event.preventDefault();
          set("q", draft.trim());
        }}
      >
        <input type="search" placeholder="Search subject, recipient or tender" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Search the email log" />
        <select value={type} onChange={(event) => set("type", event.target.value)} aria-label="Type">
          <option value="">All types</option>
          {data.types.map((item) => (
            <option key={item} value={item}>
              {TYPE_LABEL[item] ?? item}
            </option>
          ))}
        </select>
        <button className="btn" type="submit">
          Search
        </button>
        {status || type || q ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setDraft("");
              setSearch(new URLSearchParams(), { replace: true });
            }}
          >
            Clear
          </button>
        ) : null}
      </form>

      <section className="panel">
        <div className="table-wrap flat">
          <table className="mail-table">
            <thead>
              <tr>
                <th>When</th>
                <th>Status</th>
                <th>Type</th>
                <th>Tender</th>
                <th>For → delivered to</th>
                <th>Subject</th>
                <th>Files</th>
              </tr>
            </thead>
            <tbody>
              {data.items.length === 0 ? (
                <tr>
                  <td colSpan={7} className="muted">
                    No emails match.
                  </td>
                </tr>
              ) : null}
              {data.items.map((row) => {
                const item = STATUS[row.status] ?? { label: row.status, tone: "" };
                const expanded = open === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr className={`mail-row ${expanded ? "is-open" : ""}`} onClick={() => setOpen(expanded ? null : row.id)}>
                      <td className="nowrap">{when(row.createdAt)}</td>
                      <td>
                        <span className={`pill ${item.tone}`}>{item.label}</span>
                      </td>
                      <td className="nowrap">{TYPE_LABEL[row.eventType] ?? row.eventType}</td>
                      <td>{row.tender ? <Link to={`/tenders/${row.tender.id}`} onClick={(event) => event.stopPropagation()}>{row.tender.recordId}</Link> : "—"}</td>
                      <td>
                        <div>{row.recipientName || row.recipientEmail}</div>
                        <small className="muted">
                          {row.recipientEmail}
                          {row.deliveredTo && row.deliveredTo.toLowerCase() !== row.recipientEmail.toLowerCase() ? ` → ${row.deliveredTo}` : ""}
                        </small>
                      </td>
                      <td className="mail-subject">{row.subject}</td>
                      <td className="nowrap">{row.attachments.length ? `📎 ${row.attachments.length}` : "—"}</td>
                    </tr>
                    {expanded ? (
                      <tr className="mail-detail-row">
                        <td colSpan={7}>
                          <LogDetail row={row} />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {pages > 1 ? (
          <div className="mail-pages">
            <button type="button" className="btn ghost" disabled={page <= 1} onClick={() => set("page", String(page - 1))}>
              ← Newer
            </button>
            <span>
              Page {page} of {pages} · {data.total} emails
            </span>
            <button type="button" className="btn ghost" disabled={page >= pages} onClick={() => set("page", String(page + 1))}>
              Older →
            </button>
          </div>
        ) : (
          <p className="muted mail-total">{data.total} emails</p>
        )}
      </section>
    </>
  );
}

function LogDetail({ row }: { row: LogRow }) {
  const [html, setHtml] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [extraTo, setExtraTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok?: string; error?: string } | null>(null);

  const preview = async () => {
    if (html !== null) {
      setHtml(null);
      return;
    }
    setLoading(true);
    try {
      const full = await apiGet<{ html: string | null }>(`/email-logs/${row.id}`);
      setHtml(full.html || "<p style='font-family:sans-serif'>This email was logged before previews were kept.</p>");
    } finally {
      setLoading(false);
    }
  };
  const resend = async () => {
    setBusy(true);
    setResult(null);
    const form = new FormData();
    form.set("id", row.id);
    form.set("extraTo", extraTo);
    const answer = await postAction("resend-email", form);
    setBusy(false);
    setResult(answer?.error ? { error: answer.error } : { ok: answer?.ok ?? "Sent." });
  };

  return (
    <div className="mail-detail">
      <dl className="mail-facts">
        <dt>For</dt>
        <dd>
          {row.recipientName} &lt;{row.recipientEmail}&gt;
        </dd>
        <dt>Delivered to</dt>
        <dd>{row.deliveredTo || row.recipientEmail}</dd>
        <dt>Queued</dt>
        <dd>{when(row.createdAt)}</dd>
        <dt>Sent</dt>
        <dd>{when(row.sentAt)}</dd>
        {row.messageId ? (
          <>
            <dt>Message ID</dt>
            <dd>
              <code>{row.messageId}</code>
            </dd>
          </>
        ) : null}
        {row.errorMessage ? (
          <>
            <dt>Reason</dt>
            <dd className="text-bad">{row.errorMessage}</dd>
          </>
        ) : null}
        {row.note ? (
          <>
            <dt>Note</dt>
            <dd>{row.note}</dd>
          </>
        ) : null}
        <dt>Attachments</dt>
        <dd>{row.attachments.length ? row.attachments.map((file) => `${file.filename} (${size(file.size)})`).join(", ") : "None"}</dd>
      </dl>
      <div className="mail-actions">
        <button type="button" className="btn ghost" onClick={() => void preview()} disabled={loading}>
          {loading ? "Loading…" : html !== null ? "Hide preview" : "Preview email"}
        </button>
        <input type="text" placeholder="Also send to (optional), e.g. name@refex.co.in" value={extraTo} onChange={(event) => setExtraTo(event.target.value)} aria-label="Extra recipients" />
        <button type="button" className="btn" onClick={() => void resend()} disabled={busy}>
          {busy ? "Sending…" : canResend(row.status) ? "Retrigger" : "Send again"}
        </button>
      </div>
      {result?.ok ? <p className="banner good">{result.ok}</p> : null}
      {result?.error ? <p className="banner bad">{result.error}</p> : null}
      {html !== null ? <iframe className="mail-preview" title={`Preview: ${row.subject}`} srcDoc={html} sandbox="" /> : null}
    </div>
  );
}
