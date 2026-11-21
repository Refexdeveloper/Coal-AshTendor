import { useState, type CSSProperties } from "react";
import { Link } from "react-router-dom";
import { useApi } from "@client/api/client";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { roleTitle, STAGE, TASK } from "@client/lib/labels";
import { downloadXlsx } from "@client/utils/xlsx";

type Task = { id: string; tenderId: string; recordId: string; project: string; client: string; stage: string; title: string; status: string; dueAt: string | Date | null; overdue: boolean };
type Person = {
  id: string;
  name: string;
  email: string;
  role: string;
  loggedIn: boolean;
  firstSeenAt: string | Date | null;
  lastSeenAt: string | Date | null;
  requests: number;
  signIns: number;
  method: string;
  lastSeenEver: string | Date | null;
  week: { day: string; active: boolean }[];
  counts: { assignedTotal: number; open: number; overdue: number; dueOnDay: number; assignedOnDay: number; doneOnDay: number; completedTotal: number };
  tasks: Task[];
};
type Report = {
  day: string;
  today: string;
  timeZone: string;
  week: string[];
  trackingSince: string | null;
  totals: { users: number; loggedIn: number; notLoggedIn: number; openTasks: number; overdue: number; doneOnDay: number; dueOnDay: number };
  people: Person[];
};

const FILTERS = [
  ["ALL", "Everyone"],
  ["IN", "Used the app"],
  ["OUT", "Not used"],
  ["OPEN", "Has open tasks"],
  ["LATE", "Has overdue tasks"],
] as const;

export default function UserReportPage() {
  const [day, setDay] = useState("");
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>("ALL");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState("");
  const { data, error, reload } = useApi<Report>(`/reports/users${day ? `?day=${day}` : ""}`);
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;

  const tz = data.timeZone;
  const time = (value: string | Date | null) => (value ? new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: tz }) : "—");
  const when = (value: string | Date | null) =>
    value ? new Date(value).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", timeZone: tz }) : "Never in this report";
  const dayLabel = (key: string) => new Date(`${key}T12:00:00Z`).toLocaleDateString("en-IN", { weekday: "short", day: "2-digit", month: "short", timeZone: "UTC" });
  const isToday = data.day === data.today;
  const needle = query.trim().toLowerCase();
  const people = data.people
    .filter((person) =>
      filter === "IN" ? person.loggedIn : filter === "OUT" ? !person.loggedIn : filter === "OPEN" ? person.counts.open > 0 : filter === "LATE" ? person.counts.overdue > 0 : true,
    )
    .filter((person) => !needle || [person.name, person.email, roleTitle(person)].join(" ").toLowerCase().includes(needle))
    .sort((a, b) => b.counts.overdue - a.counts.overdue || b.counts.open - a.counts.open || Number(b.loggedIn) - Number(a.loggedIn) || a.name.localeCompare(b.name));
  const count = (key: (typeof FILTERS)[number][0]) =>
    data.people.filter((person) =>
      key === "IN" ? person.loggedIn : key === "OUT" ? !person.loggedIn : key === "OPEN" ? person.counts.open > 0 : key === "LATE" ? person.counts.overdue > 0 : true,
    ).length;

  const download = () => {
    const header = ["#", "Name", "Role", "Email", `Used the app on ${data.day}`, "First seen", "Last seen", "Sign-ins", "Requests", "Last seen ever", "Open tasks", "Overdue", "Due that day", "Assigned that day", "Done that day", "Completed (all time)", "Assigned (all time)", ...data.week.map((key) => dayLabel(key))];
    const userRows = data.people.map((person, index) => [
      index + 1,
      person.name,
      roleTitle(person),
      person.email,
      person.loggedIn ? "Yes" : "No",
      person.loggedIn ? time(person.firstSeenAt) : "",
      person.loggedIn ? time(person.lastSeenAt) : "",
      person.signIns,
      person.requests,
      person.lastSeenEver ? when(person.lastSeenEver) : "Not seen",
      person.counts.open,
      person.counts.overdue,
      person.counts.dueOnDay,
      person.counts.assignedOnDay,
      person.counts.doneOnDay,
      person.counts.completedTotal,
      person.counts.assignedTotal,
      ...person.week.map((item) => (item.active ? "Used" : "—")),
    ]);
    const taskRows = data.people.flatMap((person) =>
      person.tasks.map((task) => [person.name, roleTitle(person), task.recordId, task.project, task.client, STAGE[task.stage] ?? task.title, TASK[task.status]?.label ?? task.status, task.dueAt ? when(task.dueAt) : "Portal deadline", task.overdue ? "Overdue" : ""]),
    );
    const t = data.totals;
    downloadXlsx(`user-usage-report-${data.day}.xlsx`, [
      {
        name: "Summary",
        rows: [
          [`User usage and task report · ${dayLabel(data.day)}`],
          [`Time zone ${tz} · usage recorded since ${data.trackingSince ? dayLabel(data.trackingSince) : "today"}`],
          [],
          ["Count", "People"],
          ["Active users", t.users],
          ["Used the app", t.loggedIn],
          ["Did not use the app", t.notLoggedIn],
          ["People with open tasks", count("OPEN")],
          ["People with overdue tasks", count("LATE")],
          [],
          ["Tasks", "Count"],
          ["Open tasks (all people)", t.openTasks],
          ["Overdue", t.overdue],
          ["Due that day", t.dueOnDay],
          ["Done that day", t.doneOnDay],
        ],
        styles: ["t", "", "", "h", "", "", "", "", "", "", "h"],
      },
      { name: "Users", rows: [header, ...userRows], styles: ["h"], freezeHeader: true },
      { name: "Not used the app", rows: [header, ...userRows.filter((row) => row[4] === "No")], styles: ["h"], freezeHeader: true },
      { name: "Open tasks", rows: [["Person", "Role", "Tender", "Project", "Client", "Step", "Status", "Due", "Overdue"], ...taskRows], styles: ["h"], freezeHeader: true },
    ]);
  };

  const cards = [
    { key: "ALL", icon: "👥", tone: "blue", value: data.totals.users, label: "Active users", sub: `${count("OPEN")} have open tasks` },
    { key: "IN", icon: "✅", tone: "green", value: data.totals.loggedIn, label: isToday ? "Used the app today" : "Used the app that day", sub: `${data.totals.users ? Math.round((data.totals.loggedIn / data.totals.users) * 100) : 0}% of users` },
    { key: "OUT", icon: "💤", tone: "slate", value: data.totals.notLoggedIn, label: isToday ? "Not used today" : "Did not use the app", sub: "no sign-in or activity" },
    { key: "OPEN", icon: "📋", tone: "violet", value: data.totals.openTasks, label: "Open tasks", sub: `${data.totals.dueOnDay} due ${isToday ? "today" : "that day"}` },
    { key: "LATE", icon: "⏰", tone: "red", value: data.totals.overdue, label: "Overdue tasks", sub: `${count("LATE")} people behind` },
    { key: "DONE", icon: "🏁", tone: "ember", value: data.totals.doneOnDay, label: isToday ? "Done today" : "Done that day", sub: "tasks completed" },
  ] as const;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>User usage report</h1>
          <p>
            Who used the app on the day and each person's tender tasks. A sign-in lasts a week, so "used the app" means they opened it that day. Usage is recorded from{" "}
            {data.trackingSince ? dayLabel(data.trackingSince) : "today"}; days before that show as not used.
          </p>
        </div>
        <div className="ur-tools">
          <label className="ur-day">
            <span>Day</span>
            <input type="date" value={day || data.day} max={data.today} onChange={(event) => setDay(event.target.value)} />
          </label>
          {!isToday ? (
            <button type="button" className="btn ghost" onClick={() => setDay("")}>
              Today
            </button>
          ) : null}
          <button type="button" className="sk-download" onClick={download} title="Excel: summary, every user, people who did not use the app, and all open tasks">
            <span aria-hidden>⬇</span>
            <span>
              <b>Download Excel</b>
              <small>Summary + users + open tasks</small>
            </span>
          </button>
        </div>
      </header>

      <div className="sk-grid ur-cards">
        {cards.map((card) => {
          const active = card.key !== "DONE" && filter === card.key;
          return (
            <div
              key={card.key}
              role="button"
              tabIndex={0}
              className={`sk-card tone-${card.tone}${active ? " is-active" : ""}`}
              aria-pressed={active}
              onClick={() => card.key !== "DONE" && setFilter(card.key)}
              onKeyDown={(event) => {
                if ((event.key === "Enter" || event.key === " ") && card.key !== "DONE") {
                  event.preventDefault();
                  setFilter(card.key);
                }
              }}
            >
              <span className="sk-icon" aria-hidden>
                {card.icon}
              </span>
              <b className="sk-value">{card.value}</b>
              <span className="sk-label">{card.label}</span>
              <small className="sk-sub">{card.sub}</small>
              {card.key !== "DONE" ? <span className="sk-go">Show people →</span> : null}
            </div>
          );
        })}
      </div>

      <div className="ur-bar">
        <div className="tabs gem-tabs" role="tablist" aria-label="People">
          {FILTERS.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={filter === key} className={`tab ${filter === key ? "active" : ""}`} onClick={() => setFilter(key)}>
              {label}
              <span className="cnt">{count(key)}</span>
            </button>
          ))}
        </div>
        <input type="search" placeholder="Search name, email or role…" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search people" />
      </div>

      {people.length === 0 ? <p className="panel empty">Nobody matches this filter.</p> : null}
      <ul className="ur-grid">
        {people.map((person, index) => {
          const tone = person.counts.overdue ? "red" : person.loggedIn ? "green" : "gray";
          const expanded = open === person.id;
          const initials = person.name
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map((word) => word[0]?.toUpperCase())
            .join("");
          return (
            <li key={person.id} className={`ur-card tone-${tone}${expanded ? " is-open" : ""}`} style={{ "--r": Math.min(index, 14) } as CSSProperties}>
              <div className="ur-top">
                <span className={`ur-avatar${person.loggedIn ? " on" : ""}`} aria-hidden>
                  {initials || "?"}
                </span>
                <span className="ur-who">
                  <b>{person.name}</b>
                  <small>{roleTitle(person)}</small>
                </span>
                <span className={`ur-state ${person.loggedIn ? "on" : "off"}`}>{person.loggedIn ? "● Used the app" : "○ Not used"}</span>
              </div>
              <p className="ur-seen">
                {person.loggedIn ? (
                  <>
                    {time(person.firstSeenAt)} – {time(person.lastSeenAt)}
                    {person.signIns ? ` · ${person.signIns} sign-in${person.signIns === 1 ? "" : "s"}${person.method ? ` (${person.method === "REFEXONE" ? "Refex One" : "password"})` : ""}` : " · already signed in"}
                  </>
                ) : (
                  <>Last seen: {person.lastSeenEver ? when(person.lastSeenEver) : "not since usage recording began"}</>
                )}
              </p>
              <span className="ur-week" aria-label="Last 7 days">
                {person.week.map((item) => (
                  <i key={item.day} className={item.active ? "on" : ""} title={`${dayLabel(item.day)}: ${item.active ? "used the app" : "not used"}`}>
                    {dayLabel(item.day).slice(0, 2)}
                  </i>
                ))}
              </span>
              <span className="ur-stats">
                <span className={person.counts.open ? "warm" : ""}>
                  <b>{person.counts.open}</b>
                  <small>Open</small>
                </span>
                <span className={person.counts.overdue ? "hot" : ""}>
                  <b>{person.counts.overdue}</b>
                  <small>Overdue</small>
                </span>
                <span>
                  <b>{person.counts.dueOnDay}</b>
                  <small>Due {isToday ? "today" : "that day"}</small>
                </span>
                <span className={person.counts.doneOnDay ? "good" : ""}>
                  <b>{person.counts.doneOnDay}</b>
                  <small>Done</small>
                </span>
              </span>
              <span className="ur-total">
                {person.counts.assignedTotal} assigned in all · {person.counts.completedTotal} completed
              </span>
              {person.tasks.length ? (
                <button type="button" className="ws-btn primary ur-toggle" onClick={() => setOpen(expanded ? "" : person.id)} aria-expanded={expanded}>
                  {expanded ? "Hide tasks" : `Show ${person.tasks.length} open task${person.tasks.length === 1 ? "" : "s"}`}
                </button>
              ) : (
                <span className="ur-none">No open tasks</span>
              )}
              {expanded ? (
                <ul className="ur-tasks">
                  {person.tasks.map((task) => (
                    <li key={task.id} className={task.overdue ? "late" : ""}>
                      <Link to={`/tenders/${task.tenderId}?tab=overview&task=${task.id}`}>
                        <b>{task.recordId}</b> · {STAGE[task.stage] ?? task.title}
                      </Link>
                      <small>{task.project || task.client || "Untitled"}</small>
                      <small className={task.overdue ? "text-bad" : "muted"}>{task.dueAt ? `${task.overdue ? "Overdue since" : "Due"} ${when(task.dueAt)}` : "Uses the portal deadline"}</small>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </>
  );
}
