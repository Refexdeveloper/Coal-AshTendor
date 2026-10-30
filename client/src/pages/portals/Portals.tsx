import { formatWhen } from "@client/utils/calendar";
import { useApi } from "@client/api/client";
import { useActor } from "@client/api/session";
import type { CalendarJson, CrawlerException, Portal } from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { useNoticeAction } from "@client/components/feature/notice-action";
import { IngestForm } from "@client/components/feature/ingest-form";

const KINDS = [
  "Portal unavailable",
  "Authentication required",
  "CAPTCHA or access restriction",
  "Document download failure",
  "Unsupported file format",
  "OCR failure",
  "Duplicate tender",
  "Missing tender ID",
  "Revised tender or corrigendum",
  "Changed bid submission deadline",
];

type Data = { portals: Portal[]; exceptions: CrawlerException[]; calendar: CalendarJson };

export default function PortalsPage() {
  const actor = useActor();
  const { query, run } = useNoticeAction("/portals");
  const { data, error, reload } = useApi<Data>("/portals");
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;
  const { portals, exceptions, calendar } = data;
  const admin = actor.role === "ADMIN" || actor.role === "COORDINATOR";
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Portals</h1>
          <p>
            Phase 2 keeps the same tender record and the same workflow. Automatic scanning is not run from here: each portal’s access, permissions and document download still have to be confirmed. Failures stay in the exception queue instead of disappearing.
          </p>
        </div>
      </header>
      {query.notice ? <p className="banner good">{query.notice}</p> : null}
      {query.error ? <p className="banner bad">{query.error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Portal</th>
              <th>Keywords</th>
              <th>Frequency</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {portals.map((portal) => (
              <tr key={portal.id}>
                <td>
                  {portal.name}
                  <div className="muted">{portal.url}</div>
                </td>
                <td>{portal.keywords || "—"}</td>
                <td>{portal.frequencyHours}h</td>
                <td>
                  {portal.enabled ? "Enabled" : "Disabled"} · {portal.accessMethod}
                  <div className="muted">{portal.lastStatus}{portal.lastScanAt ? ` · ${formatWhen(portal.lastScanAt, calendar.timeZone)}` : ""}</div>
                  {portal.lastError ? <div>{portal.lastError}</div> : null}
                </td>
                <td>
                  {actor.role === "ADMIN" ? (
                    <form action={run("toggle-portal")}>
                      <input type="hidden" name="id" value={portal.id} />
                      <button className="btn ghost" type="submit">
                        {portal.enabled ? "Disable" : "Enable"}
                      </button>
                    </form>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {actor.role === "ADMIN" ? (
        <form action={run("save-portal")} className="panel form-grid">
          <h2 className="wide">Add a portal</h2>
          <label>
            Name
            <input name="name" required />
          </label>
          <label>
            URL
            <input name="url" type="url" required />
          </label>
          <label>
            Category
            <input name="category" />
          </label>
          <label>
            Keywords
            <input name="keywords" placeholder="pond ash, fly ash" />
          </label>
          <label>
            Search frequency (hours)
            <input name="frequencyHours" type="number" min={1} defaultValue={24} />
          </label>
          <label className="check">
            <input type="checkbox" name="enabled" value="yes" />
            Enabled for a future scan
          </label>
          <button className="btn" type="submit">
            Save portal
          </button>
        </form>
      ) : null}
      {admin ? <IngestForm portals={portals} /> : null}
      {actor.role === "ADMIN" && portals[0] ? (
        <form action={run("log-exception")} className="panel form-grid">
          <h2 className="wide">Record an access exception</h2>
          <label>
            Portal
            <select name="portalId" defaultValue={portals[0].id}>
              {portals.map((portal) => (
                <option key={portal.id} value={portal.id}>
                  {portal.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Type
            <select name="kind">
              {KINDS.map((kind) => (
                <option key={kind}>{kind}</option>
              ))}
            </select>
          </label>
          <label className="wide">
            What happened
            <textarea name="detail" rows={3} required />
          </label>
          <label className="wide">
            Tender hint, if one was visible
            <input name="tenderHint" />
          </label>
          <button className="btn ghost" type="submit">
            Record exception
          </button>
        </form>
      ) : null}
      <section className="panel stack">
        <h2>Exception queue</h2>
        {exceptions.length === 0 ? <p className="muted">No exceptions recorded.</p> : null}
        {exceptions.map((item) => (
          <p key={item.id}>
            {item.kind}
            <br />
            <span className="muted">
              {item.detail} · {formatWhen(item.createdAt, calendar.timeZone)}
            </span>
          </p>
        ))}
      </section>
    </>
  );
}
