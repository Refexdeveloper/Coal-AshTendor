import { ROLES } from "@client/lib/labels";
import { useApi } from "@client/api/client";
import { useActor } from "@client/api/session";
import type { PublicUser } from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { useNoticeAction } from "@client/components/feature/notice-action";

type Data = {
  calendar: { workStart: string; workEnd: string; workingDays: string } | null;
  holidays: { id: string; date: string; name: string }[];
  policies: { id: string; stage: string; durationValue: number; durationUnit: string; targetValue: number | null; targetUnit: string | null }[];
  settings: { bgRequiresBoth: boolean; revisionResetsSla: boolean; bidReminderHours: string; level2AfterMinutes: number } | null;
  escalations: { id: string; level: number; label: string; email: string }[];
  templates: { id: string; event: string; subject: string; body: string }[];
  users: PublicUser[];
};

const DECISIONS = [
  "Official working hours and the holiday calendar are still to be confirmed. The default is 09:00–18:00, Monday to Friday, Asia/Kolkata.",
  "Escalation mailboxes below are placeholders until the business owner confirms them.",
  "Bank guarantee tasks go to both Krishnanath and Surya M. Either can complete the task unless “both must verify” is turned on.",
  "EMD completion means the instrument is prepared and internally verified. Submission to the authority is recorded separately.",
  "Exemption still needs a written basis and evidence. It is verified by Accounts.",
  "Department Head is the seeded role. Delegation is a second active Department Head user.",
  "The bid submitter is assigned per tender. The seeded Bid Submitter is the usual owner.",
  "An approved tender that will not be bid is closed with a business reason. That is separate from a missed deadline.",
  "Portal scanning is not running. Access method, permissions and download rights have to be confirmed portal by portal.",
  "This copy stores files and the database on the application server. Hosting, backup and retention are still open.",
];

export default function AdminPage() {
  const actor = useActor();
  const { query, run } = useNoticeAction("/admin");
  const { data, error, reload } = useApi<Data>("/admin");
  if (actor.role !== "ADMIN") return <p className="panel">Administration is limited to the system administrator.</p>;
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;
  const { calendar, holidays, policies, settings, escalations, templates, users } = data;
  const days = new Set((calendar?.workingDays ?? "1,2,3,4,5").split(","));
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Administration</h1>
          <p>Working time, SLAs, escalation and the decisions still open with the business team.</p>
        </div>
      </header>
      {query.notice ? <p className="banner good">{query.notice}</p> : null}
      {query.error ? <p className="banner bad">{query.error}</p> : null}
      <section className="panel">
        <h2>Still to confirm</h2>
        <ul>
          {DECISIONS.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      </section>
      <form action={run("save-calendar")} className="panel form-grid">
        <h2 className="wide">Working calendar</h2>
        <label>
          Start
          <input name="workStart" type="time" defaultValue={calendar?.workStart ?? "09:00"} />
        </label>
        <label>
          End
          <input name="workEnd" type="time" defaultValue={calendar?.workEnd ?? "18:00"} />
        </label>
        <div className="wide actions">
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label, index) => (
            <label key={label} className="check">
              <input type="checkbox" name="days" value={String(index + 1)} defaultChecked={days.has(String(index + 1))} />
              {label}
            </label>
          ))}
        </div>
        <button className="btn" type="submit">
          Save calendar
        </button>
      </form>
      <section className="panel stack">
        <h2>Holidays</h2>
        {holidays.map((holiday) => (
          <form key={holiday.id} action={run("delete-holiday")} className="actions">
            <input type="hidden" name="id" value={holiday.id} />
            <span>
              {holiday.date} · {holiday.name}
            </span>
            <button className="btn ghost" type="submit">
              Remove
            </button>
          </form>
        ))}
        <form action={run("add-holiday")} className="form-grid">
          <label>
            Date
            <input name="date" type="date" required />
          </label>
          <label>
            Name
            <input name="name" required />
          </label>
          <button className="btn" type="submit">
            Add holiday
          </button>
        </form>
      </section>
      <form action={run("save-sla")} className="panel stack">
        <h2>Stage SLAs</h2>
        <p className="muted">Hours are business hours. Days are working days on the calendar above. Draft costing defaults to a 2-day maximum.</p>
        {policies.map((policy) => (
          <div key={policy.id} className="form-grid">
            <strong>
              {policy.stage}
              {policy.targetValue ? ` · target ${policy.targetValue} ${policy.targetUnit?.toLowerCase()}` : ""}
            </strong>
            <label>
              Duration
              <input name={`value_${policy.stage}`} type="number" min={1} defaultValue={policy.durationValue} />
            </label>
            <label>
              Unit
              <select name={`unit_${policy.stage}`} defaultValue={policy.durationUnit}>
                <option value="HOURS">Business hours</option>
                <option value="DAYS">Working days</option>
              </select>
            </label>
          </div>
        ))}
        <button className="btn" type="submit">
          Save SLAs
        </button>
      </form>
      <form action={run("save-settings")} className="panel form-grid">
        <h2 className="wide">Assignments and escalation</h2>
        <label className="check wide">
          <input type="checkbox" name="bgRequiresBoth" value="yes" defaultChecked={settings?.bgRequiresBoth} />
          Both Accounts users must verify a bank guarantee
        </label>
        <label className="check wide">
          <input type="checkbox" name="revisionResetsSla" value="yes" defaultChecked={settings?.revisionResetsSla ?? true} />
          Returned tasks start a new SLA
        </label>
        <label>
          Bid reminder hours before the portal deadline
          <input name="bidReminderHours" defaultValue={settings?.bidReminderHours ?? "72,24,4"} />
        </label>
        <label>
          Second escalation after overdue business minutes
          <input name="level2AfterMinutes" type="number" defaultValue={settings?.level2AfterMinutes ?? 240} />
        </label>
        <label>
          First escalation email
          <input name="escalation_1" type="email" defaultValue={escalations.find((item) => item.level === 1)?.email ?? ""} />
        </label>
        <label>
          Second escalation email
          <input name="escalation_2" type="email" defaultValue={escalations.find((item) => item.level === 2)?.email ?? ""} />
        </label>
        <button className="btn" type="submit">
          Save settings
        </button>
      </form>
      <section className="panel">
        <h2>People</h2>
        <table>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{ROLES[user.role] ?? user.role}</td>
                <td>{user.email}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="stack">
        {templates.map((template) => (
          <form key={template.id} action={run("save-template")} className="panel stack">
            <h2>{template.event}</h2>
            <input type="hidden" name="event" value={template.event} />
            <label>
              Subject
              <input name="subject" defaultValue={template.subject} />
            </label>
            <label>
              Body
              <textarea name="body" rows={4} defaultValue={template.body} />
            </label>
            <button className="btn ghost" type="submit">
              Save template
            </button>
          </form>
        ))}
      </section>
    </>
  );
}
