import { useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@client/api/client";
import { LoadFailed, Loading } from "@client/components/base/loading";

type Row = {
  id: string;
  tenderId: string;
  recordId: string;
  toName: string;
  toPhone: string;
  deliveredTo: string;
  stage: string;
  status: "QUEUED" | "SENT" | "FAILED" | "SKIPPED";
  parameters: string | null;
  messageId: string;
  error: string | null;
  createdAt: string | Date;
};
type Data = { rows: Row[]; status: { enabled: boolean; configured: boolean; live: boolean; testTo: string }; people: { active: number; withPhone: number } };

const STATUS: Record<Row["status"], { label: string; tone: string }> = {
  SENT: { label: "Sent", tone: "good" },
  FAILED: { label: "Failed", tone: "bad" },
  SKIPPED: { label: "Not sent", tone: "neutral" },
  QUEUED: { label: "Queued", tone: "info" },
};
const masked = (phone: string) => (phone.length > 4 ? `${"•".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : phone || "—");
const when = (value: string | Date) => new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** The six template values, for the message preview: name, app, reference, status, step, link. */
function values(row: Row): string[] {
  try {
    const parsed = JSON.parse(row.parameters ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** WhatsApp notices sent when a tender step moves: setup state and every attempt, laid out like the Email log. Administrator only. */
export default function WhatsAppLogsPage() {
  const { data, error, reload } = useApi<Data>("/whatsapp-logs");
  const [status, setStatus] = useState<"" | Row["status"]>("");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;

  const setup = data.status;
  const count = (key: Row["status"]) => data.rows.filter((row) => row.status === key).length;
  const needle = query.trim().toLowerCase();
  const rows = data.rows.filter(
    (row) =>
      (!status || row.status === status) &&
      (!needle || [row.toName, row.toPhone, row.recordId, row.stage, row.error ?? ""].join(" ").toLowerCase().includes(needle)),
  );
  const banner = !setup.enabled
    ? { tone: "bad", text: "WhatsApp is switched off (WHATSAPP_ENABLED=false)." }
    : !setup.configured
      ? { tone: "bad", text: "WhatsApp is not set up: the Unfyd key and secret are missing." }
      : setup.live
        ? { tone: "good", text: "WhatsApp is on. Each new owner of a tender step gets a notice on their mobile." }
        : setup.testTo
          ? { tone: "warn", text: `Test mode on this machine: every notice goes to the test number ending ${setup.testTo.slice(-4)}, not to the real person.` }
          : { tone: "warn", text: "Not sent from this machine. Notices are logged here; set WHATSAPP_TEST_TO to try a real message locally." };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>WhatsApp log</h1>
          <p>Every WhatsApp notice Coal &amp; Ash sends or tries to send when a tender moves to a new step: who it was for, the tender, the step, and why it failed. Open a row to see the message.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={() => void reload()}>
            Refresh
          </button>
        </div>
      </header>

      <section className={`banner ${banner.tone}`}>
        {banner.text}{" "}
        {data.people.withPhone < data.people.active ? (
          <>
            {data.people.withPhone} of {data.people.active} people have a mobile number. <Link to="/admin">Add the missing numbers in Administration →</Link>
          </>
        ) : (
          `Everyone (${data.people.active}) has a mobile number.`
        )}
      </section>

      <div className="mail-counts">
        <button type="button" className={`mail-count ${status === "" ? "on" : ""}`} onClick={() => setStatus("")}>
          <span>All</span>
          <b>{data.rows.length}</b>
        </button>
        {(Object.keys(STATUS) as Row["status"][]).map((key) => (
          <button key={key} type="button" className={`mail-count ${STATUS[key].tone} ${status === key ? "on" : ""}`} onClick={() => setStatus(status === key ? "" : key)}>
            <span>{STATUS[key].label}</span>
            <b>{count(key)}</b>
          </button>
        ))}
      </div>

      <form
        className="panel mail-filters"
        onSubmit={(event) => {
          event.preventDefault();
          setQuery(draft);
        }}
      >
        <input type="search" placeholder="Search person, mobile, tender or step" value={draft} onChange={(event) => setDraft(event.target.value)} aria-label="Search the WhatsApp log" />
        <button className="btn" type="submit">
          Search
        </button>
        {status || query ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              setDraft("");
              setQuery("");
              setStatus("");
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
                <th>To</th>
                <th>Tender</th>
                <th>Step</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="muted">
                    {data.rows.length ? "No notices match this view." : "No notices yet. They appear here when a tender step moves to someone."}
                  </td>
                </tr>
              ) : null}
              {rows.map((row) => {
                const isOpen = open === row.id;
                const message = values(row);
                return [
                  <tr key={row.id} className="mail-row" onClick={() => setOpen(isOpen ? null : row.id)} style={{ cursor: "pointer" }} aria-expanded={isOpen}>
                    <td>{when(row.createdAt)}</td>
                    <td>
                      {row.toName}
                      <small className="muted" style={{ display: "block" }}>
                        {masked(row.toPhone)}
                        {row.deliveredTo && row.deliveredTo !== row.toPhone ? ` → test ${masked(row.deliveredTo)}` : ""}
                      </small>
                    </td>
                    <td onClick={(event) => event.stopPropagation()}>
                      {row.tenderId ? <Link to={`/tenders/${row.tenderId}`}>{row.recordId || "Open"}</Link> : row.recordId}
                    </td>
                    <td>{row.stage}</td>
                    <td>
                      <span className={`pill ${STATUS[row.status]?.tone ?? "neutral"}`}>{STATUS[row.status]?.label ?? row.status}</span>
                      {row.error ? (
                        <small className="muted" style={{ display: "block", maxWidth: 360 }}>
                          {row.error}
                        </small>
                      ) : null}
                    </td>
                  </tr>,
                  isOpen ? (
                    <tr key={`${row.id}-open`} className="mail-preview-row">
                      <td colSpan={5}>
                        {message.length ? (
                          <div className="wa-message">
                            <p>Dear {message[0]},</p>
                            <p>
                              <b>Application:</b> {message[1]}
                              <br />
                              <b>Reference ID:</b> {message[2]}
                              <br />
                              <b>Status:</b> {message[3]}
                              <br />
                              <b>Workflow:</b> {message[4]}
                            </p>
                            <p>{message[5]}</p>
                            {row.messageId ? <small className="muted">WhatsApp message id {row.messageId}</small> : null}
                          </div>
                        ) : (
                          <p className="muted">No message text was kept for this notice.</p>
                        )}
                      </td>
                    </tr>
                  ) : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
