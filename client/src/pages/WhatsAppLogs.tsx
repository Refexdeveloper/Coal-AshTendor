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

const TONE: Record<Row["status"], string> = { SENT: "good", FAILED: "bad", SKIPPED: "neutral", QUEUED: "info" };
const masked = (phone: string) => (phone.length > 4 ? `${"•".repeat(Math.max(0, phone.length - 4))}${phone.slice(-4)}` : phone || "—");

/** WhatsApp notices sent when a tender step moves: setup state and every attempt. Administrator only. */
export default function WhatsAppLogsPage() {
  const { data, error, reload } = useApi<Data>("/whatsapp-logs");
  const [filter, setFilter] = useState<"" | Row["status"]>("");
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;
  const { status, people } = data;
  const count = (key: Row["status"]) => data.rows.filter((row) => row.status === key).length;
  const rows = data.rows.filter((row) => !filter || row.status === filter);
  const setup = !status.enabled
    ? { tone: "bad", text: "WhatsApp is switched off (WHATSAPP_ENABLED=false)." }
    : !status.configured
      ? { tone: "bad", text: "WhatsApp is not set up yet: add WHATSAPP_APP_KEY and WHATSAPP_APP_SECRET (the Unfyd keys used by Procure to Pay) to the server settings." }
      : status.live
        ? { tone: "good", text: "WhatsApp is on. Each new owner of a tender step gets a notice on their mobile." }
        : status.testTo
          ? { tone: "warn", text: `Test mode on this machine: every notice goes to the test number ending ${status.testTo.slice(-4)}, not to the real person.` }
          : { tone: "warn", text: "Not sent from this machine. Notices are logged here; set WHATSAPP_TEST_TO to try a real message locally." };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>WhatsApp log</h1>
          <p>When a tender moves to a new step, its new owner gets a WhatsApp notice with the tender, the step and a link, sent the same way as Procure to Pay.</p>
        </div>
        <div className="actions">
          <button type="button" className="btn ghost" onClick={() => void reload()}>
            Refresh
          </button>
        </div>
      </header>
      <p className={`banner ${setup.tone}`}>{setup.text}</p>

      <div className="sk-grid wa-cards">
        {(
          [
            ["", "💬", "blue", data.rows.length, "Notices", "latest 300"],
            ["SENT", "✅", "green", count("SENT"), "Sent", "accepted by WhatsApp"],
            ["FAILED", "⚠", "red", count("FAILED"), "Failed", "the API refused or did not answer"],
            ["SKIPPED", "⏭", "slate", count("SKIPPED"), "Not sent", "no mobile, not set up, or test mode"],
          ] as const
        ).map(([key, icon, tone, value, label, sub]) => (
          <div
            key={label}
            role="button"
            tabIndex={0}
            className={`sk-card tone-${tone}${filter === key ? " is-active" : ""}`}
            onClick={() => setFilter(key)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                setFilter(key);
              }
            }}
          >
            <span className="sk-icon" aria-hidden>
              {icon}
            </span>
            <b className="sk-value">{value}</b>
            <span className="sk-label">{label}</span>
            <small className="sk-sub">{sub}</small>
          </div>
        ))}
        <Link to="/admin" className="sk-card tone-violet wa-people">
          <span className="sk-icon" aria-hidden>
            📱
          </span>
          <b className="sk-value">
            {people.withPhone}/{people.active}
          </b>
          <span className="sk-label">People with a mobile</span>
          <small className="sk-sub">add missing numbers in Administration →</small>
        </Link>
      </div>

      <div className="table-wrap">
        <table>
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
                  No notices yet. They appear here when a tender step moves to someone.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{new Date(row.createdAt).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                <td>
                  {row.toName}
                  <small className="muted" style={{ display: "block" }}>
                    {masked(row.toPhone)}
                    {row.deliveredTo && row.deliveredTo !== row.toPhone ? ` → test ${masked(row.deliveredTo)}` : ""}
                  </small>
                </td>
                <td>{row.tenderId ? <Link to={`/tenders/${row.tenderId}`}>{row.recordId || "Open"}</Link> : row.recordId}</td>
                <td>{row.stage}</td>
                <td>
                  <span className={`pill ${TONE[row.status] ?? "neutral"}`}>{row.status === "SKIPPED" ? "Not sent" : row.status.toLowerCase()}</span>
                  {row.error ? (
                    <small className="muted" style={{ display: "block", maxWidth: 360 }}>
                      {row.error}
                    </small>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
