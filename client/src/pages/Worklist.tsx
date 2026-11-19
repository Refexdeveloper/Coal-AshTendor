import { Link } from "react-router-dom";
import type { CSSProperties } from "react";
import { useApi, toCalendar } from "@client/api/client";
import { useActor } from "@client/api/session";
import type { CalendarJson, Tender, WorkflowTask } from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { businessMinutesBetween, dayLengthMinutes, formatDuration, formatWhen } from "@client/utils/calendar";
import { OVERALL, STAGE, STAGE_HELP, TASK } from "@client/lib/labels";
import { Status } from "@client/components/base/pill";

type Data = { tasks: (WorkflowTask & { tender: Tender })[]; calendar: CalendarJson };

export default function WorklistPage() {
  const actor = useActor();
  const { data, error, reload } = useApi<Data>("/worklist");
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;
  const tasks = data.tasks;
  const calendar = toCalendar(data.calendar);
  const now = new Date();
  const day = dayLengthMinutes(calendar);
  const tz = calendar.timeZone;
  const rows = tasks.map((task) => {
    const left = task.dueAt ? businessMinutesBetween(now, task.dueAt, calendar) : null;
    const late = Boolean(task.dueAt && task.dueAt < now);
    const group = late ? "overdue" : left != null && left <= day ? "today" : "later";
    return { task, late, left, group };
  });
  const groups = [
    { key: "overdue", title: "Overdue", note: "Past the working-time SLA. Escalation emails have gone out.", tone: "red" },
    { key: "today", title: "Due within a working day", note: "Finish these next.", tone: "orange" },
    { key: "later", title: "Coming up", note: "Due later, or tied to the portal deadline.", tone: "" },
  ] as const;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>My worklist</h1>
          <p>Everything waiting on {actor.name}. Times count working hours only, using the company calendar.</p>
        </div>
      </header>
      <section className="money-row">
        {groups.map((group) => (
          <article key={group.key} className="stat">
            <span>{group.title}</span>
            <b className={group.key === "overdue" && rows.some((row) => row.group === "overdue") ? "text-bad" : ""}>
              {rows.filter((row) => row.group === group.key).length}
            </b>
          </article>
        ))}
        <article className="stat">
          <span>Total open</span>
          <b>{rows.length}</b>
        </article>
      </section>
      {rows.length === 0 ? <p className="panel empty">Nothing is waiting on you. New assignments arrive here and by email.</p> : null}
      {groups.map((group) => {
        const items = rows.filter((row) => row.group === group.key);
        if (!items.length) return null;
        return (
          <section key={group.key} className="panel">
            <header className="panel-head">
              <div>
                <h2>{group.title}</h2>
                <p className="muted">{group.note}</p>
              </div>
              <span className={`count-badge ${group.key === "overdue" ? "alert" : ""}`}>{items.length}</span>
            </header>
            <ul className="tc-grid">
              {items.map(({ task, late, left }, index) => {
                const tender = task.tender;
                const [label, tone] = [OVERALL[tender.overallStatus]?.label ?? tender.overallStatus, late ? "red" : group.key === "today" ? "amber" : "blue"];
                const dueText = !task.dueAt
                  ? "Uses the portal deadline"
                  : late
                    ? `Overdue by ${formatDuration(businessMinutesBetween(task.dueAt, now, calendar), day)}`
                    : `${formatDuration(left ?? 0, day)} working time left`;
                return (
                  <li key={task.id} className={`tc-card tone-${tone}${late ? " is-late" : ""}`} style={{ "--r": index } as CSSProperties}>
                    <Link className="tc-main" to={`/tenders/${task.tenderId}?tab=overview&task=${task.id}`} title="Open the full record and the tasks overview">
                      <span className="tc-top">
                        <span className="tc-no">{index + 1}</span>
                        <span className="tc-ref">{tender.recordId}</span>
                        <span className="pill info">{STAGE[task.stage] ?? task.title}</span>
                        <span className={`dk-pill ${tone}`}>{label}</span>
                      </span>
                      <span className="tc-title">{tender.projectName || tender.clientName || "Untitled"}</span>
                      <span className="tc-client">{tender.clientName || "Client not set"}</span>
                      <span className="tc-facts">
                        <span>
                          <small>Your task</small>
                          <b><Status map={TASK} value={task.status} /></b>
                        </span>
                        <span>
                          <small>Due</small>
                          <b>{formatWhen(task.dueAt, tz)}</b>
                        </span>
                        <span>
                          <small>Bid closes</small>
                          <b>{formatWhen(tender.bidSubmissionEnd, tz)}</b>
                        </span>
                      </span>
                      {STAGE_HELP[task.stage] ? <span className="muted">{STAGE_HELP[task.stage]}</span> : null}
                      <span className="muted">{dueText}</span>
                    </Link>
                    <span className="tc-foot">
                      <span className={late ? "tc-late" : "tc-owner"}>{late ? "● Overdue" : "Open the full report"}</span>
                      <Link to={`/tenders/${task.tenderId}?tab=overview&task=${task.id}`} className="tc-open">
                        Open full report
                      </Link>
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        );
      })}
    </>
  );
}
