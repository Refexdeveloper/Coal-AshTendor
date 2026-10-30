import { useState } from "react";
import { ROLES } from "@client/lib/labels";
import { useApi } from "@client/api/client";
import { useActor } from "@client/api/session";
import type { PublicUser } from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { useFormPending } from "@client/components/base/submit";
import { useNoticeAction } from "@client/components/feature/notice-action";

type Data = {
  calendar: { workStart: string; workEnd: string; workingDays: string } | null;
  holidays: { id: string; date: string; name: string }[];
  policies: { id: string; stage: string; durationValue: number; durationUnit: string; targetValue: number | null; targetUnit: string | null }[];
  settings: { bgRequiresBoth: boolean; revisionResetsSla: boolean; bidReminderHours: string; level2AfterMinutes: number } | null;
  escalations: { id: string; level: number; label: string; email: string }[];
  templates: { id: string; event: string; subject: string; body: string }[];
  users: PublicUser[];
  tenderCount: number;
  tenders: { id: string; recordId: string; projectName: string; clientName: string }[];
  refexone: {
    configured: boolean;
    lastSync: { at: Date; by: string; summary: SyncSummary | null } | null;
    schedule: { everyHours: number; nextAt: Date | null; failed: { at: Date; message: string } | null };
  };
};

type SyncSummary = { total: number; created: number; renamed: number; deactivated: number; unchanged: number; skippedAdmins: string[] };
type Run = (name: string) => (formData: FormData) => Promise<void>;

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
  const { calendar, holidays, policies, settings, escalations, templates, users, tenderCount, tenders, refexone } = data;
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
      <TenderData tenders={tenders} count={tenderCount} run={run} />
      <RefexOnePanel refexone={refexone} users={users} run={run} error={query.error} />
      <section className="panel stack" id="people">
        <h2>People</h2>
        <p className="muted">
          A person who signs in with Refex One is listed here and cannot enter until you allow it. Tick Can sign in, choose a role, and save. Only those people can sign in. Their password is CoalAsh@2026.
        </p>
        <form action={run("add-user")} className="form-grid">
          <label>
            Name
            <input name="name" required placeholder="Lokesh B" />
          </label>
          <label>
            Email
            <input name="email" type="email" required placeholder="lokesh.b@refex.co.in" />
          </label>
          <label>
            Role
            <select name="role" required defaultValue="BID_SUBMITTER">
              {Object.entries(ROLES).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <button className="btn" type="submit">
            Add user
          </button>
        </form>
        <PeopleTable users={users} run={run} />
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

function TenderData({
  tenders,
  count,
  run,
}: {
  tenders: { id: string; recordId: string; projectName: string; clientName: string }[];
  count: number;
  run: (name: string) => (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="panel stack">
      <h2>Tender data</h2>
      <p className="muted">Remove one tender, or every tender. Files, fields, tasks, costing, EMD, bids, emails, and history tied to it go with it. People, the calendar, SLAs, and portals stay.</p>
      {tenders.length === 0 ? <p className="empty">No tenders stored.</p> : null}
      {tenders.map((tender) => (
        <form
          key={tender.id}
          className="actions"
          action={async (formData) => {
            const label = tender.projectName || tender.recordId;
            if (!window.confirm(`Remove ${tender.recordId}${label && label !== tender.recordId ? ` (${label})` : ""} and the records tied to it?`)) return;
            await run("delete-tender")(formData);
          }}
        >
          <input type="hidden" name="tenderId" value={tender.id} />
          <span>
            <b>{tender.recordId}</b>
            {tender.projectName ? ` · ${tender.projectName}` : ""}
            {tender.clientName ? <span className="muted"> · {tender.clientName}</span> : null}
          </span>
          <button className="btn ghost" type="submit">
            Remove
          </button>
        </form>
      ))}
      <ClearTenders count={count} run={run} />
    </section>
  );
}

function ClearTenders({ count, run }: { count: number; run: (name: string) => (formData: FormData) => Promise<void> }) {
  const [phrase, setPhrase] = useState("");
  return (
    <form action={run("clear-tenders")} className="stack">
      <h2>Remove all tender data</h2>
      <p>{count === 1 ? "1 tender is stored." : `${count} tenders are stored.`} This cannot be undone.</p>
      <label>
        Type REMOVE to confirm
        <input name="confirm" value={phrase} onChange={(event) => setPhrase(event.target.value)} autoComplete="off" />
      </label>
      <button className="btn danger" type="submit" disabled={phrase !== "REMOVE" || count === 0}>
        Remove all tender data
      </button>
    </form>
  );
}

function SyncButton() {
  const { pending } = useFormPending();
  return (
    <button className="btn" type="submit" disabled={pending}>
      {pending ? "Syncing with Refex One…" : "Sync users from Refex One"}
    </button>
  );
}

/** Pulls the Refex One directory into People, as in the P2P app. */
function RefexOnePanel({ refexone, users, run, error }: { refexone: Data["refexone"]; users: PublicUser[]; run: Run; error?: string }) {
  const last = refexone.lastSync;
  const waiting = users.filter((user) => !user.active).length;
  const syncError = error && /refex one/i.test(error) ? error : "";
  const { schedule } = refexone;
  const when = (date: Date) => date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
  const every = schedule.everyHours === 24 ? "once a day" : `every ${schedule.everyHours} hours`;
  return (
    <section className="panel stack refex-sync">
      <header className="refex-sync-head">
        <div>
          <h2>Refex One users</h2>
          <p className="muted">
            Brings everyone in the Refex One directory into People. New people wait for access until you allow them below, names are kept up to date, and
            people Refex One marks inactive lose sign-in. The sync never gives anyone access and never switches off an administrator.
          </p>
        </div>
        <span className={`pill ${refexone.configured ? "good" : "warn"}`}>{refexone.configured ? "Connected" : "Not set up"}</span>
      </header>
      {refexone.configured ? null : (
        <p className="banner warn">
          Set <code>REFEXONE_API_TOKEN</code> (an org-admin token from Refex One) in <code>server/.env</code> and restart the server. <code>REFEXONE_API_URL</code> defaults to
          https://refexone.com/api.
        </p>
      )}
      {syncError ? <p className="banner bad">{syncError}</p> : null}
      {schedule.failed && !syncError ? (
        <p className="banner bad">
          The automatic sync on {when(schedule.failed.at)} failed: {schedule.failed.message} It tries again within the hour.
        </p>
      ) : null}
      <p className="refex-sync-schedule">
        <span className={`dot ${schedule.everyHours && refexone.configured ? "on" : ""}`} aria-hidden />
        {!schedule.everyHours
          ? "Automatic sync is off (REFEXONE_SYNC_HOURS=0). Use the button to sync."
          : !refexone.configured
            ? `Automatic sync runs ${every} once the token is set.`
            : `Automatic sync runs ${every}${schedule.nextAt ? `; next around ${when(schedule.nextAt)}` : ""}. The button syncs right away.`}
      </p>
      <div className="refex-sync-stats">
        <div>
          <span>Last sync</span>
          <b>{last ? last.at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "Never"}</b>
          <small>{last ? `by ${last.by}` : "Run the first sync below"}</small>
        </div>
        <div>
          <span>In Refex One</span>
          <b>{last?.summary?.total ?? "—"}</b>
          <small>{last?.summary ? `${last.summary.created} added last time` : "people in the directory"}</small>
        </div>
        <div>
          <span>Updated last time</span>
          <b>{last?.summary ? last.summary.renamed + last.summary.deactivated : "—"}</b>
          <small>{last?.summary ? `${last.summary.renamed} renamed · ${last.summary.deactivated} switched off` : "names and status"}</small>
        </div>
        <a href="#people" className={waiting ? "warn" : ""}>
          <span>Waiting for access</span>
          <b>{waiting}</b>
          <small>{waiting ? "Allow them in People below" : "Nobody waiting"}</small>
        </a>
      </div>
      <form action={run("sync-refexone-users")} className="actions">
        <SyncButton />
      </form>
    </section>
  );
}

/** The people list with a search and an access filter, since a synced directory is long. */
function PeopleTable({ users, run }: { users: PublicUser[]; run: Run }) {
  const [query, setQuery] = useState("");
  const [show, setShow] = useState<"all" | "allowed" | "waiting">("all");
  const needle = query.trim().toLowerCase();
  const rows = users.filter((user) => {
    if (show === "allowed" && !user.active) return false;
    if (show === "waiting" && user.active) return false;
    return !needle || `${user.name} ${user.email} ${ROLES[user.role] ?? ""}`.toLowerCase().includes(needle);
  });
  const shown = rows.slice(0, 200);
  return (
    <>
      <div className="people-tools">
        <input type="search" placeholder="Search by name, email or role" value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search people" />
        <div className="seg">
          {(
            [
              ["all", `All ${users.length}`],
              ["allowed", `Can sign in ${users.filter((user) => user.active).length}`],
              ["waiting", `Waiting ${users.filter((user) => !user.active).length}`],
            ] as const
          ).map(([key, label]) => (
            <button key={key} type="button" className={show === key ? "is-on" : ""} onClick={() => setShow(key)}>
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="table-wrap flat">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Sign-in and role</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={3} className="muted">
                  Nobody matches.
                </td>
              </tr>
            ) : null}
            {shown.map((user) => (
              <tr key={user.id}>
                <td>
                  {user.name}
                  {user.active ? null : <div className="reg-meta">Waiting for access</div>}
                </td>
                <td>{user.email}</td>
                <td>
                  <form action={run("update-user-access")} className="user-access">
                    <input type="hidden" name="userId" value={user.id} />
                    <label className="check">
                      <input type="checkbox" name="allow" value="yes" defaultChecked={user.active} />
                      Can sign in
                    </label>
                    <select name="role" defaultValue={ROLES[user.role] ? user.role : ""}>
                      <option value="">Choose a role</option>
                      {Object.entries(ROLES).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <button className="btn" type="submit">
                      Save
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > shown.length ? <p className="muted">Showing the first {shown.length} of {rows.length}. Search to narrow the list.</p> : null}
    </>
  );
}
