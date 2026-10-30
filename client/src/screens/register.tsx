import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { formatWhen } from "@client/lib/calendar";
import { useApi } from "@client/lib/api";
import { useActor } from "@client/lib/session";
import type { BidSubmission, CalendarJson, PublicUser, Tender, WorkflowTask } from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { APPROVAL, BID, CLOSED_OVERALL, COSTING, CREATOR_ROLES, EMD, EMD_TYPE, OVERALL, RELEVANCE } from "@client/lib/labels";
import { Status } from "@client/components/base/pill";
import { documentUrl } from "@client/lib/api";

type Data = { tenders: (Tender & { tasks: WorkflowTask[]; bid: BidSubmission | null })[]; users: PublicUser[]; calendar: CalendarJson };

export default function RegisterPage() {
  const actor = useActor();
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const params = { q: search.get("q") ?? undefined, status: search.get("status") ?? undefined, overdue: search.get("overdue") ?? undefined };
  const { data, error, reload } = useApi<Data>("/register");
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;
  const { tenders, users, calendar } = data;
  const names = new Map(users.map((user) => [user.id, user.name]));
  const q = (params.q ?? "").trim().toLowerCase();
  const rows = tenders.filter((tender) => {
    if (params.status && tender.overallStatus !== params.status) return false;
    const overdue = tender.relevanceOverdue || tender.tasks.some((task) => task.status === "OVERDUE");
    if (params.overdue === "yes" && !overdue) return false;
    if (!q) return true;
    return [tender.recordId, tender.projectName, tender.clientName, tender.tenderRef, tender.externalTenderId, tender.location]
      .join(" ")
      .toLowerCase()
      .includes(q);
  });
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Tender register</h1>
          <p>{rows.length} records</p>
        </div>
        {CREATOR_ROLES.includes(actor.role) ? (
          <Link className="btn" to="/tenders/new">
            + New tender
          </Link>
        ) : null}
      </header>
      <form
        key={search.toString()}
        className="actions"
        method="get"
        onSubmit={(event) => {
          event.preventDefault();
          const query = new URLSearchParams();
          for (const [key, value] of new FormData(event.currentTarget)) if (String(value).trim()) query.set(key, String(value).trim());
          navigate(query.size ? `/register?${query}` : "/register");
        }}
      >
        <input name="q" defaultValue={params.q} placeholder="Search project, client, reference" />
        <select name="status" defaultValue={params.status ?? ""}>
          <option value="">All statuses</option>
          {Object.entries(OVERALL).map(([value, item]) => (
            <option key={value} value={value}>
              {item.label}
            </option>
          ))}
        </select>
        <select name="overdue" defaultValue={params.overdue ?? ""}>
          <option value="">Any SLA</option>
          <option value="yes">Overdue only</option>
        </select>
        <button className="btn" type="submit">
          Filter
        </button>
        {params.q || params.status || params.overdue ? (
          <Link className="btn ghost" to="/register">
            Clear
          </Link>
        ) : null}
      </form>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Tender</th>
              <th>Client</th>
              <th>Deadline</th>
              <th>Status</th>
              <th>Current stage · SLA due</th>
              <th>Relevance</th>
              <th>Costing · Dept. approval</th>
              <th>EMD</th>
              <th>Bid</th>
              <th>Owner</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((tender) => {
              const overdue = tender.relevanceOverdue || tender.tasks.some((task) => task.status === "OVERDUE" || (task.dueAt && task.dueAt < new Date()));
              const owners = [
                ...new Set(tender.tasks.flatMap((task) => JSON.parse(task.assigneeIds) as string[]).map((id) => names.get(id) ?? "Unknown")),
              ];
              return (
                <tr key={tender.id} className={overdue && !CLOSED_OVERALL.includes(tender.overallStatus) ? "late" : ""}>
                  <td>
                    <Link to={`/tenders/${tender.id}`}>{tender.recordId}</Link>
                    <div>{tender.projectName || "Untitled"}</div>
                    <div className="muted">{tender.location}</div>
                  </td>
                  <td>
                    {tender.clientName || "—"}
                    <div className="muted">{tender.tenderRef || tender.externalTenderId}</div>
                  </td>
                  <td>
                    {formatWhen(tender.bidSubmissionEnd, calendar.timeZone)}
                    {overdue ? <div className="pill bad">Overdue</div> : null}
                  </td>
                  <td>
                    <Status map={OVERALL} value={tender.overallStatus} />
                  </td>
                  <td>
                    {tender.tasks.length ? (
                      tender.tasks.map((task) => (
                        <div key={task.id}>
                          {task.title}
                          <div className={task.dueAt && task.dueAt < new Date() ? "text-bad" : "muted"}>{formatWhen(task.dueAt, calendar.timeZone)}</div>
                        </div>
                      ))
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <Status map={RELEVANCE} value={tender.relevanceStatus} />
                  </td>
                  <td>
                    <Status map={COSTING} value={tender.costingStatus} />
                    <div>
                      <Status map={APPROVAL} value={tender.approvalStatus} />
                    </div>
                  </td>
                  <td>
                    <Status map={EMD} value={tender.emdStatus} />
                    <div className="muted">{EMD_TYPE[tender.emdType] ?? tender.emdType}</div>
                  </td>
                  <td>
                    <Status map={BID} value={tender.bidStatus} />
                    {tender.bid?.referenceNumber ? <div className="muted">Ref {tender.bid.referenceNumber}</div> : null}
                    {tender.bid?.evidenceDocumentId ? (
                      <div>
                        <a href={documentUrl(tender.bid.evidenceDocumentId)} target="_blank" rel="noreferrer">
                          Evidence
                        </a>
                      </div>
                    ) : null}
                  </td>
                  <td>{owners.join(", ") || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
