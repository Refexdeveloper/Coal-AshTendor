import { Link } from "react-router-dom";
import { formatWhen } from "@client/utils/calendar";
import { useApi } from "@client/api/client";
import type { CalendarJson, NotificationLog, Tender } from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";

type Data = { notes: (NotificationLog & { tender: Tender | null })[]; calendar: CalendarJson; smtpConfigured: boolean };

export default function NotificationsPage() {
  const { data, error, reload } = useApi<Data>("/notifications");
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;
  const { notes, calendar } = data;
  const failed = notes.filter((note) => note.status === "FAILED").length;
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Notifications</h1>
          <p>
            {data.smtpConfigured
              ? "Messages are sent through the configured mail server and kept here."
              : "Mail delivery is not configured, so every notice is kept in this log instead of being dropped."}
            {failed ? ` ${failed} failed to send.` : ""}
          </p>
        </div>
      </header>
      <div className="stack">
        {notes.length === 0 ? <p className="panel">No notifications yet.</p> : null}
        {notes.map((note) => (
          <article key={note.id} className="panel">
            <header className="panel-head">
              <div>
                <h2>{note.subject}</h2>
                <p className="muted">
                  {note.recipientName || note.recipientEmail} · {formatWhen(note.createdAt, calendar.timeZone)} ·{" "}
                  <span className={`pill ${note.status === "FAILED" ? "bad" : note.status === "SENT" ? "good" : ""}`}>{note.status.toLowerCase()}</span>
                </p>
              </div>
              {note.tender ? <Link to={`/tenders/${note.tenderId}`}>{note.tender.recordId}</Link> : null}
            </header>
            <details>
              <summary className="muted">Show message</summary>
              <pre>{note.body}</pre>
            </details>
          </article>
        ))}
      </div>
    </>
  );
}
