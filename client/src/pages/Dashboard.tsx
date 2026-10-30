import { Link, useSearchParams } from "react-router-dom";
import type { CSSProperties } from "react";
import { formatWhen } from "@client/utils/calendar";
import { CREATOR_ROLES, OVERALL, ROLES, STAGE } from "@client/lib/labels";
import { inr } from "@client/utils/money";
import { useApi } from "@client/api/client";
import { useActor } from "@client/api/session";
import type { CalendarJson, Tender, WorkflowTask } from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { Status } from "@client/components/base/pill";
import { CountUp } from "@client/components/feature/count-up";
import { KpiCard } from "@client/components/feature/kpi-card";
import { ExecutiveView, type ExecutiveData } from "@client/pages/executive/ExecutiveView";

type PipelineData = {
  kind: "pipeline";
  calendar: CalendarJson;
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  inProgress: number;
  ready: number;
  submitted: number;
  missed: number;
  estimated: number;
  finalCost: number;
  emd: number;
  won: number;
  lost: number;
  cancelled: number;
  overdueCount: number;
  all: Tender[];
  mine: (WorkflowTask & { tender: Tender })[];
};

const VIEWS: { key: string; label: string; match: (tender: Tender) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "pending", label: "Pending relevance", match: (t) => t.overallStatus === "PENDING_RELEVANCE" },
  { key: "progress", label: "In progress", match: (t) => t.overallStatus === "APPROVED_IN_PROGRESS" },
  { key: "ready", label: "Ready to bid", match: (t) => t.overallStatus === "READY_TO_BID" },
  { key: "submitted", label: "Submitted", match: (t) => t.overallStatus === "BID_EVIDENCE_PENDING" || t.overallStatus === "BID_EVIDENCE_RECORDED" },
  { key: "closed", label: "Rejected / missed", match: (t) => ["REJECTED_CLOSED", "NOT_BID_DEADLINE_MISSED", "LOST", "CANCELLED"].includes(t.overallStatus) },
];

/** Colour of the row's left accent, by overall status. */
function rowTone(status: string) {
  const tone = OVERALL[status]?.tone;
  if (tone === "bad") return "red";
  if (tone === "warn") return "orange";
  if (tone === "good") return "green";
  if (status === "UPLOADED" || status === "OCR_PROCESSING") return "violet";
  return "";
}

/** Upcoming bid deadlines first (soonest first), then past deadlines, then tenders with no end time. */
function compareDeadline(a: Tender, b: Tender, now: number) {
  const rank = (tender: Tender) => {
    const end = tender.bidSubmissionEnd?.getTime();
    if (end == null || Number.isNaN(end)) return [2, 0] as const;
    if (end >= now) return [0, end] as const;
    return [1, end] as const;
  };
  const [groupA, timeA] = rank(a);
  const [groupB, timeB] = rank(b);
  if (groupA !== groupB) return groupA - groupB;
  return timeA - timeB;
}

function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone }).format(new Date()));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function DashboardPage() {
  const user = useActor();
  const [search] = useSearchParams();
  const params = { view: search.get("view") ?? undefined, group: search.get("group") ?? undefined };
  const { data, error, reload } = useApi<PipelineData | ExecutiveData>("/dashboard");
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;
  if (data.kind === "executive") return <ExecutiveView user={user} group={params.group} data={data} />;
  const mine = data.mine;
  const tz = data.calendar.timeZone;
  const now = new Date();
  const view = VIEWS.find((item) => item.key === params.view) ?? VIEWS[0];
  const rows = data.all
    .filter(view.match)
    .slice()
    .sort((a, b) => compareDeadline(a, b, now.getTime()))
    .slice(0, 10);
  const kpis = [
    { title: "Total tenders", subtitle: data.total ? "In the register" : "None yet", value: data.total, tone: "teal", icon: "doc", fx: "docs", href: "/#tenders", view: "all" },
    { title: "Pending relevance", subtitle: data.pending ? "Awaiting decision" : "Nothing to review", value: data.pending, tone: "blue", icon: "clock", fx: "pending", href: "/?view=pending#tenders", view: "pending", live: true },
    { title: "In progress", subtitle: "Costing and EMD", value: data.inProgress, tone: "violet", icon: "doc", fx: "gears", href: "/?view=progress#tenders", view: "progress" },
    { title: "Ready to bid", subtitle: data.submitted ? `${data.submitted} bid with proof` : "Cleared to submit", value: data.ready, tone: "green", icon: "check", fx: "ready", href: "/?view=ready#tenders", view: "ready" },
    { title: "Overdue tasks", subtitle: data.overdueCount ? "Needs attention" : "All on time", value: data.overdueCount, tone: "red", icon: "alarm", fx: "overdue", href: "/register?overdue=yes", view: "" },
  ] as const;

  return (
    <div className="dash">
      <section className="hero">
        <div className="bubbles" aria-hidden>
          <i /><i /><i /><i /><i /><i /><i />
        </div>
        <div className="hero-content">
          <div className="hero-hi">
            {greeting(tz)}, <span className="wave">👋</span>
          </div>
          <h1>
            <span className="shimmer">{user.name}</span>
          </h1>
          <p>
            Here&apos;s where every tender stands today
            <span className="hero-role"> · {ROLES[user.role] ?? user.role}</span>
          </p>
        </div>
        <aside className="hero-side">
          <p className="hero-side-lbl">Outcomes</p>
          <dl>
            <dt>Won</dt>
            <dd>
              <CountUp value={data.won} duration={900} delay={500} />
            </dd>
            <dt>Lost</dt>
            <dd>
              <CountUp value={data.lost} duration={900} delay={580} />
            </dd>
            <dt>Cancelled</dt>
            <dd>
              <CountUp value={data.cancelled} duration={900} delay={660} />
            </dd>
            <dt>Not bid before deadline</dt>
            <dd>
              <CountUp value={data.missed} duration={900} delay={740} />
            </dd>
          </dl>
        </aside>
      </section>

      <section className="kpis">
        {kpis.map(({ view: kpiView, ...kpi }, index) => (
          <KpiCard key={kpi.title} {...kpi} total={data.total} index={index} selected={Boolean(params.view) && kpiView === view.key} />
        ))}
      </section>

      <div className="dash-body">
        <div className="cta-row">
          {CREATOR_ROLES.includes(user.role) ? (
            <Link className="btn" to="/tenders/new">
              + New tender
            </Link>
          ) : null}
          <Link className="btn ghost" to="/worklist">
            My worklist &amp; SLAs
          </Link>
          <Link className="btn ghost" to="/register">
            Open the register
          </Link>
          <Link className="btn ghost" to="/reports">
            Reports
          </Link>
        </div>

        <div className="stack">
            <section className="panel">
              <header className="panel-head fancy">
                <span className="chip" aria-hidden>
                  ✎
                </span>
                <div>
                  <h2>Waiting on you</h2>
                  <p className="muted">Tasks assigned to you, soonest due first</p>
                </div>
                <span className={`count-badge ${mine.some((task) => task.dueAt && task.dueAt < now) ? "alert" : ""}`}>{mine.length} open</span>
              </header>
              {mine.length === 0 ? (
                <div className="all-clear">
                  <span aria-hidden>✓</span>
                  <p>
                    <b>All clear.</b> Nothing is waiting on you right now.
                  </p>
                </div>
              ) : null}
              <ul className="list-rows">
                {mine.slice(0, 5).map((task, index) => {
                  const late = Boolean(task.dueAt && task.dueAt < now);
                  return (
                    <li key={task.id} className={`list-row ${late ? "red" : "orange"}`} style={{ "--r": index } as CSSProperties}>
                      <span className="ticon" aria-hidden>
                        {late ? "!" : "→"}
                      </span>
                      <div className="grow">
                        <div className="title">
                          <b>{STAGE[task.stage] ?? task.title}</b> · {task.tender.recordId} · {task.tender.projectName || "Untitled"}
                        </div>
                        <div className="meta">
                          {late ? "Overdue · " : ""}Due {formatWhen(task.dueAt, tz)}
                        </div>
                      </div>
                      <Link className="btn" to={`/tenders/${task.tenderId}`}>
                        Open
                      </Link>
                    </li>
                  );
                })}
              </ul>
              {mine.length > 5 ? (
                <p className="fine">
                  <Link to="/worklist">See all {mine.length} in your worklist</Link>
                </p>
              ) : null}
            </section>

            <section className="panel" id="tenders">
              <header className="panel-head fancy">
                <span className="chip" aria-hidden>
                  ☰
                </span>
                <div>
                  <h2>Recent tenders</h2>
                  <p className="muted">Upcoming bid deadlines first</p>
                </div>
                <Link className="btn ghost" to="/register">
                  View all
                </Link>
              </header>
              <nav className="tabs" aria-label="Filter tenders">
                {VIEWS.map((item) => (
                  <Link key={item.key} to={item.key === "all" ? "/#tenders" : `/?view=${item.key}#tenders`} className={`tab ${item.key === view.key ? "active" : ""}`}>
                    {item.label}
                    <span className="cnt">{data.all.filter(item.match).length}</span>
                  </Link>
                ))}
              </nav>
              {rows.length === 0 ? <p className="empty">No tenders in this view.</p> : null}
              {rows.length ? (
                <div className="rt-wrap">
                  <table className="rt-table" key={view.key}>
                    <colgroup>
                      <col className="c-ref" />
                      <col className="c-title" />
                      <col className="c-client" />
                      <col className="c-value" />
                      <col className="c-status" />
                      <col className="c-time" />
                      <col className="c-time" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th>Tender</th>
                        <th>Title</th>
                        <th>Client · location</th>
                        <th className="num">Est. value</th>
                        <th>Status</th>
                        <th>Bid opening time</th>
                        <th>Bid end time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((tender, index) => (
                        <tr key={tender.id} className={`rt-row ${rowTone(tender.overallStatus)}`} style={{ "--r": index } as CSSProperties}>
                          <td>
                            <Link className="rid" to={`/tenders/${tender.id}`}>
                              {tender.recordId}
                            </Link>
                          </td>
                          <td>
                            <Link className="rt-title" to={`/tenders/${tender.id}`} title={tender.projectName}>
                              {tender.projectName || "Untitled"}
                            </Link>
                          </td>
                          <td>
                            <span className="rt-clip" title={tender.clientName}>
                              {tender.clientName || "—"}
                            </span>
                            {tender.location ? (
                              <small className="rt-clip" title={tender.location}>
                                {tender.location}
                              </small>
                            ) : null}
                          </td>
                          <td className="num">{inr(tender.estimatedValue)}</td>
                          <td>
                            <Status map={OVERALL} value={tender.overallStatus} />
                          </td>
                          <td className="rt-due">{formatWhen(tender.bidOpeningAt, tz)}</td>
                          <td className="rt-due">{formatWhen(tender.bidSubmissionEnd, tz)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}
            </section>
          </div>
      </div>
    </div>
  );
}
