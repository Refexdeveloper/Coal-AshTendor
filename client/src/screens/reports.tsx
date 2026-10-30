import { OVERALL, labelOf } from "@client/lib/labels";
import { formatDuration } from "@client/lib/calendar";
import { useApi } from "@client/lib/api";
import { percent } from "@client/lib/format";
import { LoadFailed, Loading } from "@client/components/base/loading";

type Row = { onTime: number; total: number };
type Report = {
  day: number;
  averageApproval: number | null;
  averageCosting: number | null;
  averageEmd: number | null;
  byStage: [string, Row][];
  byOwner: (Row & { name: string; open: number })[];
  internalMisses: number;
  missed: number;
  submitted: number;
  winRate: number | null;
  won: number;
  lost: number;
  pipeline: [string, number][];
};

export default function ReportsPage() {
  const { data, error, reload } = useApi<Report>("/reports");
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;
  const report = { ...data, format: (minutes: number | null) => (minutes == null ? "—" : formatDuration(minutes, data.day)) };
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Reports</h1>
          <p>Times are working time on the company calendar, not raw calendar hours.</p>
        </div>
      </header>
      <section className="stats">
        <article className="stat">
          <span>Average time to relevance approval</span>
          <b>{report.format(report.averageApproval)}</b>
        </article>
        <article className="stat">
          <span>Average costing cycle</span>
          <b>{report.format(report.averageCosting)}</b>
        </article>
        <article className="stat">
          <span>Average EMD turnaround</span>
          <b>{report.format(report.averageEmd)}</b>
        </article>
        <article className="stat">
          <span>Win / loss</span>
          <b>{report.winRate == null ? "—" : `${Math.round(report.winRate * 100)}%`}</b>
          <span>
            {report.won} won · {report.lost} lost
          </span>
        </article>
      </section>
      <div className="split-2">
        <section className="panel">
          <h2>Pipeline</h2>
          <div className="table-scroll">
          <table>
            <tbody>
              {report.pipeline.map(([status, count]) => (
                <tr key={status}>
                  <td>{labelOf(OVERALL, status)}</td>
                  <td>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </section>
        <section className="panel">
          <h2>Submission</h2>
          <p>Bids recorded with evidence: {report.submitted}</p>
          <p>Deadlines missed: {report.missed}</p>
          <p>Missed with an earlier internal overdue task: {report.internalMisses}</p>
        </section>
      </div>
      <section className="panel">
        <h2>SLA compliance by stage</h2>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Stage</th>
              <th>On time</th>
              <th>Judged</th>
              <th>Compliance</th>
            </tr>
          </thead>
          <tbody>
            {report.byStage.map(([stage, row]) => (
              <tr key={stage}>
                <td>{stage.replaceAll("_", " ")}</td>
                <td>{row.onTime}</td>
                <td>{row.total}</td>
                <td>{percent(row.onTime, row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
      <section className="panel">
        <h2>Workload and SLA by owner</h2>
        <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Owner</th>
              <th>Open tasks</th>
              <th>On time</th>
              <th>Judged</th>
              <th>Compliance</th>
            </tr>
          </thead>
          <tbody>
            {report.byOwner.map((row) => (
              <tr key={row.name}>
                <td>{row.name}</td>
                <td>{row.open}</td>
                <td>{row.onTime}</td>
                <td>{row.total}</td>
                <td>{percent(row.onTime, row.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </section>
    </>
  );
}
