import { Link, useSearchParams } from "react-router-dom";
import type { CSSProperties } from "react";
import { formatWhen } from "@client/utils/calendar";
import { effectiveValue } from "@client/utils/format";
import { NOT_FOUND, TENDER_FIELDS } from "@client/lib/fields";
import { APPROVAL, BID, COSTING, DECISION, EMD, EMD_TYPE, OVERALL, RELEVANCE, ROLES, STAGE } from "@client/lib/labels";
import { inr } from "@client/utils/money";
import type { ApprovalRecord, BidSubmission, CalendarJson, EmdRecord, PublicUser, Tender, TenderField, WorkflowTask } from "@client/lib/types";
import { Status } from "@client/components/base/pill";
import { CountUp } from "@client/components/feature/count-up";
import { FxLink } from "@client/components/feature/fx-link";
import { PeriodPicker, inPeriod, resolvePeriod } from "@client/components/feature/period-picker";

const GROUPS = [
  { key: "intake", label: "Intake & review", color: "#6f9bff", statuses: ["UPLOADED", "OCR_PROCESSING", "DATA_VALIDATION_REQUIRED", "PENDING_RELEVANCE"] },
  { key: "progress", label: "Costing & EMD", color: "#a78bfa", statuses: ["APPROVED_IN_PROGRESS"] },
  { key: "ready", label: "Ready / submitted", color: "#fb923c", statuses: ["READY_TO_BID", "BID_EVIDENCE_PENDING", "BID_EVIDENCE_RECORDED"] },
  { key: "won", label: "Won", color: "#34d399", statuses: ["WON"] },
  { key: "closed", label: "Lost / closed", color: "#a8a29e", statuses: ["REJECTED_CLOSED", "NOT_BID_DEADLINE_MISSED", "CLOSED_BUSINESS", "LOST", "CANCELLED"] },
];

const FIELD_SECTIONS = [
  [1, 6, "Identity"],
  [7, 10, "Dates"],
  [11, 16, "Commercial"],
  [17, 20, "Submission"],
  [21, 30, "Qualification"],
  [31, 44, "Contract conditions"],
] as const;

function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

/** Group CEO view: the whole pipeline with every tender's workflow, commercials and all 44 fields on one page. */
export type ExecutiveData = {
  kind: "executive";
  tenders: (Tender & { fields: TenderField[]; tasks: WorkflowTask[]; approvals: ApprovalRecord[]; emd: EmdRecord | null; bid: BidSubmission | null })[];
  users: PublicUser[];
  calendar: CalendarJson;
};

const FILTER_KEYS = ["period", "basis", "q", "client", "emd", "owner", "portal", "group"] as const;

export function ExecutiveView({ user, group, data }: { user: { name: string; role: string }; group?: string; data: ExecutiveData }) {
  const { tenders: everyTender, users, calendar } = data;
  const tz = calendar.timeZone;
  const names = new Map(users.map((item) => [item.id, item.name]));

  // Filters live in the URL so a filtered view survives a refresh and can be shared.
  const [search, setSearch] = useSearchParams();
  const filter = Object.fromEntries(FILTER_KEYS.map((key) => [key, search.get(key) ?? ""])) as Record<(typeof FILTER_KEYS)[number], string>;
  const setFilter = (key: (typeof FILTER_KEYS)[number], value: string) => {
    const next = new URLSearchParams(search);
    if (value && !(key === "period" && value === "all") && !(key === "basis" && value === "received")) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: true, preventScrollReset: true });
  };
  const resetFilters = () => setSearch(new URLSearchParams(), { replace: true, preventScrollReset: true });
  const stageHref = (key?: string) => {
    const next = new URLSearchParams(search);
    if (key) next.set("group", key);
    else next.delete("group");
    const query = next.toString();
    return `/${query ? `?${query}` : ""}#all-tenders`;
  };

  const period = resolvePeriod(filter.period || "all");
  const byDeadline = filter.basis === "deadline";
  const ownersOf = (tender: (typeof everyTender)[number]) => new Set(tender.tasks.flatMap((task) => JSON.parse(task.assigneeIds) as string[]));
  const needle = filter.q.trim().toLowerCase();
  const tenders = everyTender.filter((tender) => {
    if (!inPeriod(period, byDeadline ? tender.bidSubmissionEnd : tender.createdAt)) return false;
    if (filter.client && tender.clientName !== filter.client) return false;
    if (filter.emd && tender.emdType !== filter.emd) return false;
    if (filter.portal && (tender.portalName || tender.source) !== filter.portal) return false;
    if (filter.owner && !ownersOf(tender).has(filter.owner)) return false;
    if (needle) {
      const text = [tender.projectName, tender.recordId, tender.tenderRef, tender.externalTenderId, tender.clientName, tender.location].join(" ").toLowerCase();
      if (!text.includes(needle)) return false;
    }
    return true;
  });
  const distinct = (pick: (tender: (typeof everyTender)[number]) => string) => [...new Set(everyTender.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const clients = distinct((t) => t.clientName);
  const portals = distinct((t) => t.portalName || t.source);
  const emdTypes = distinct((t) => t.emdType);
  const ownerIds = [...new Set(everyTender.flatMap((t) => [...ownersOf(t)]))].sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? ""));
  const earliest = everyTender.reduce<Date | null>((min, t) => (!min || t.createdAt < min ? t.createdAt : min), null);
  const activeFilters = FILTER_KEYS.filter((key) => filter[key] && !(key === "period" && filter[key] === "all")).length;
  const now = Date.now();
  const closedStatuses = GROUPS.find((item) => item.key === "closed")!.statuses.concat("WON");
  const active = tenders.filter((tender) => !closedStatuses.includes(tender.overallStatus));
  const sum = (list: typeof tenders, pick: (tender: (typeof tenders)[number]) => number | null) => list.reduce((total, tender) => total + (pick(tender) ?? 0), 0);
  const won = tenders.filter((tender) => tender.overallStatus === "WON").length;
  const lost = tenders.filter((tender) => tender.overallStatus === "LOST").length;
  const overdue = tenders.flatMap((tender) => tender.tasks).filter((task) => task.dueAt && task.dueAt.getTime() < now).length;
  const dueWeek = active.filter((tender) => tender.bidSubmissionEnd && tender.bidSubmissionEnd.getTime() > now && tender.bidSubmissionEnd.getTime() - now < 7 * 864e5);
  const submitted = tenders.filter((tender) => ["BID_SUBMITTED_EVIDENCE_RECORDED", "BID_SUBMITTED_EVIDENCE_PENDING"].includes(tender.bidStatus)).length;

  const kpis = [
    { label: "Active pipeline value", value: sum(active, (t) => t.estimatedValue), money: true, tone: "ember", note: `${active.length} active tenders`, fx: "coins", href: stageHref() },
    { label: "Approved final costing", value: sum(tenders.filter((t) => t.costingStatus === "APPROVED"), (t) => t.finalCostingValue), money: true, tone: "green", note: `${tenders.filter((t) => t.costingStatus === "APPROVED").length} costings approved`, fx: "coins", href: stageHref("ready") },
    { label: "EMD exposure", value: sum(active.filter((t) => t.emdType !== "EXEMPTION"), (t) => t.emdExposure), money: true, tone: "coal", note: "Guarantees and bonds in play", fx: "shield", href: stageHref("progress") },
    { label: "Win rate", value: won + lost ? Math.round((won / (won + lost)) * 100) : 0, suffix: "%", tone: "violet", note: `${won} won · ${lost} lost`, fx: "trophy", href: stageHref("won") },
    { label: "Bids submitted", value: submitted, tone: "blue", note: `${dueWeek.length} deadline${dueWeek.length === 1 ? "" : "s"} in the next 7 days`, fx: "ready", href: stageHref("ready") },
    { label: "Overdue tasks", value: overdue, tone: overdue ? "red" : "green", note: overdue ? "Past their working-time SLA" : "Everything on time", fx: "overdue", href: "/register?overdue=yes" },
  ] as const;

  const selected = GROUPS.find((item) => item.key === group);
  const rows = selected ? tenders.filter((tender) => selected.statuses.includes(tender.overallStatus)) : tenders;
  const fieldText = (tender: (typeof tenders)[number], key: string) => {
    const row = tender.fields.find((field) => field.fieldKey === key);
    const value = row ? effectiveValue(row).trim() : "";
    return value && value !== NOT_FOUND ? value : "";
  };

  return (
    <div className="exec">
      <section className="hero exec-hero">
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
            Group view of every Coal &amp; Ash tender
            <span className="hero-role"> · {ROLES[user.role] ?? user.role}</span>
          </p>
        </div>
      </section>

      <section className="panel exec-filters" aria-label="Filters">
        <PeriodPicker value={filter.period || "all"} onChange={(key) => setFilter("period", key)} earliest={earliest} />
        <div className="exec-filter">
          <span className="period-caption">Date by</span>
          <div className="seg">
            <button type="button" className={byDeadline ? "" : "is-on"} onClick={() => setFilter("basis", "received")}>
              Received
            </button>
            <button type="button" className={byDeadline ? "is-on" : ""} onClick={() => setFilter("basis", "deadline")}>
              Bid deadline
            </button>
          </div>
        </div>
        <label className="exec-filter grow">
          <span className="period-caption">Search</span>
          <input type="search" placeholder="Project, client, reference…" value={filter.q} onChange={(event) => setFilter("q", event.target.value)} />
        </label>
        <label className="exec-filter">
          <span className="period-caption">Stage</span>
          <select value={filter.group} onChange={(event) => setFilter("group", event.target.value)}>
            <option value="">All stages</option>
            {GROUPS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="exec-filter">
          <span className="period-caption">Client</span>
          <select value={filter.client} onChange={(event) => setFilter("client", event.target.value)}>
            <option value="">All clients</option>
            {clients.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="exec-filter">
          <span className="period-caption">EMD type</span>
          <select value={filter.emd} onChange={(event) => setFilter("emd", event.target.value)}>
            <option value="">All EMD types</option>
            {emdTypes.map((item) => (
              <option key={item} value={item}>
                {EMD_TYPE[item] ?? item}
              </option>
            ))}
          </select>
        </label>
        <label className="exec-filter">
          <span className="period-caption">Now with</span>
          <select value={filter.owner} onChange={(event) => setFilter("owner", event.target.value)}>
            <option value="">Anyone</option>
            {ownerIds.map((id) => (
              <option key={id} value={id}>
                {names.get(id) ?? "Unknown"}
              </option>
            ))}
          </select>
        </label>
        {portals.length > 1 ? (
          <label className="exec-filter">
            <span className="period-caption">Portal / source</span>
            <select value={filter.portal} onChange={(event) => setFilter("portal", event.target.value)}>
              <option value="">All</option>
              {portals.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="exec-filter-foot">
          <span>
            Showing <b>{tenders.length}</b> of {everyTender.length} tenders
            {period.from ? ` · ${byDeadline ? "bid deadline" : "received"} ${period.detail}` : ""}
          </span>
          {activeFilters ? (
            <button type="button" className="btn ghost" onClick={resetFilters}>
              Clear {activeFilters} filter{activeFilters === 1 ? "" : "s"}
            </button>
          ) : null}
        </div>
      </section>

      <section className="exec-counts" aria-label="Tender counts">
        <FxLink href={stageHref()} fx="pulse" className={`count-card total${group ? "" : " on"}`} style={{ "--i": 0 } as CSSProperties}>
          <span>Total tenders</span>
          <b>
            <CountUp value={tenders.length} duration={900} />
          </b>
          <small>
            {active.length} active · {inr(sum(tenders, (t) => t.estimatedValue))}
          </small>
        </FxLink>
        {GROUPS.map((item, index) => {
          const list = tenders.filter((tender) => item.statuses.includes(tender.overallStatus));
          return (
            <FxLink
              key={item.key}
              href={stageHref(item.key)}
              fx="pulse"
              className={`count-card${group === item.key ? " on" : ""}`}
              style={{ "--c": item.color, "--i": index + 1 } as CSSProperties}
            >
              <span>{item.label}</span>
              <b>
                <CountUp value={list.length} duration={900} delay={80 * (index + 1)} />
              </b>
              <small>{inr(sum(list, (t) => t.estimatedValue))}</small>
            </FxLink>
          );
        })}
        <div className={`count-card due${dueWeek.length ? " hot" : ""}`} style={{ "--i": GROUPS.length + 1 } as CSSProperties}>
          <span>Closing in 7 days</span>
          <b>
            <CountUp value={dueWeek.length} duration={900} />
          </b>
          <small>{dueWeek.length ? "Bids due this week" : "Nothing due this week"}</small>
        </div>
      </section>

      <section className="exec-kpis">
        {kpis.map((kpi, index) => (
          <FxLink key={kpi.label} href={kpi.href} fx={kpi.fx} className={`exec-kpi ${kpi.tone}`} style={{ "--i": index } as CSSProperties}>
            <span className="exec-kpi-label">{kpi.label}</span>
            <b>
              <CountUp value={kpi.value} money={"money" in kpi && kpi.money} duration={1300} delay={250 + index * 90} />
              {"suffix" in kpi ? kpi.suffix : ""}
            </b>
            <span className="exec-kpi-note">{kpi.note}</span>
          </FxLink>
        ))}
      </section>

      <div className="dash-body">
        <section className="panel">
          <header className="panel-head fancy">
            <span className="chip" aria-hidden>
              ▤
            </span>
            <div>
              <h2>Pipeline by stage</h2>
              <p className="muted">{tenders.length} tenders · click a stage to filter the list below</p>
            </div>
          </header>
          <div className="stage-bar" role="img" aria-label="Tenders by stage">
            {GROUPS.map((item, index) => {
              const count = tenders.filter((tender) => item.statuses.includes(tender.overallStatus)).length;
              return count ? (
                <FxLink
                  key={item.key}
                  fx="pulse"
                  href={stageHref(item.key)}
                  className="stage-seg"
                  style={{ "--w": count, "--c": item.color, "--i": index } as CSSProperties}
                  title={`${item.label}: ${count}`}
                >
                  {count}
                </FxLink>
              ) : null;
            })}
          </div>
          <div className="stage-legend">
            {GROUPS.map((item) => {
              const list = tenders.filter((tender) => item.statuses.includes(tender.overallStatus));
              return (
                <FxLink key={item.key} fx="pulse" href={stageHref(item.key)} className={`stage-key ${group === item.key ? "on" : ""}`}>
                  <i style={{ background: item.color }} />
                  <span>{item.label}</span>
                  <b>{list.length}</b>
                  <small>{inr(sum(list, (t) => t.estimatedValue))}</small>
                </FxLink>
              );
            })}
          </div>
        </section>

        {dueWeek.length ? (
          <section className="panel">
            <header className="panel-head fancy">
              <span className="chip" aria-hidden>
                ⏳
              </span>
              <div>
                <h2>Bids closing this week</h2>
                <p className="muted">Where each one stands right now</p>
              </div>
            </header>
            <div className="week-cards">
              {dueWeek.map((tender, index) => {
                const hours = (tender.bidSubmissionEnd!.getTime() - now) / 36e5;
                return (
                  <FxLink key={tender.id} fx="pulse" href={`/tenders/${tender.id}`} className={`week-card ${hours < 48 ? "hot" : ""}`} style={{ "--r": index } as CSSProperties}>
                    <span className="week-left">{hours < 48 ? `${Math.floor(hours)}h left` : `${Math.floor(hours / 24)}d left`}</span>
                    <strong>{tender.projectName || tender.recordId}</strong>
                    <small>
                      {tender.recordId} · {tender.clientName} · {inr(tender.estimatedValue)}
                    </small>
                    <Status map={OVERALL} value={tender.overallStatus} />
                  </FxLink>
                );
              })}
            </div>
          </section>
        ) : null}

        <section className="panel" id="all-tenders">
          <header className="panel-head fancy">
            <span className="chip" aria-hidden>
              ☰
            </span>
            <div>
              <h2>All tenders{selected ? ` · ${selected.label}` : ""}</h2>
              <p className="muted">Soonest deadline first. Open a row to see its workflow, commercials and all 44 fields.</p>
            </div>
            {selected ? (
              <Link className="btn ghost" to={stageHref()} preventScrollReset>
                Show all
              </Link>
            ) : null}
          </header>
          <div className="exec-head" aria-hidden>
            <span>Tender</span>
            <span>Client · location</span>
            <span>Value</span>
            <span>EMD</span>
            <span>Bid deadline</span>
            <span>Status</span>
            <span>Now with</span>
          </div>
          {rows.length === 0 ? <p className="empty">No tenders in this stage.</p> : null}
          <div className="exec-rows">
            {rows.map((tender, index) => {
              const hoursLeft = tender.bidSubmissionEnd ? (tender.bidSubmissionEnd.getTime() - now) / 36e5 : null;
              const owners = [...new Set(tender.tasks.flatMap((task) => JSON.parse(task.assigneeIds) as string[]).map((id) => names.get(id) ?? "Unknown"))];
              const lateTask = tender.tasks.some((task) => task.dueAt && task.dueAt.getTime() < now);
              const filled = tender.fields.filter((field) => effectiveValue(field).trim() && effectiveValue(field) !== NOT_FOUND).length;
              return (
                <details key={tender.id} className={`exec-row ${lateTask ? "late" : ""}`} style={{ "--r": Math.min(index, 12) } as CSSProperties}>
                  <summary>
                    <span className="exec-cell main">
                      <b>{tender.projectName || "Untitled"}</b>
                      <small>
                        {tender.recordId} · {tender.tenderRef || tender.externalTenderId || "no reference"}
                      </small>
                    </span>
                    <span className="exec-cell">
                      {tender.clientName || "—"}
                      <small>{tender.location || "—"}</small>
                    </span>
                    <span className="exec-cell num">{inr(tender.estimatedValue)}</span>
                    <span className="exec-cell">
                      {inr(tender.emdExposure)}
                      <small>{EMD_TYPE[tender.emdType] ?? tender.emdType}</small>
                    </span>
                    <span className="exec-cell">
                      {formatWhen(tender.bidSubmissionEnd, tz)}
                      {hoursLeft != null && hoursLeft > 0 && !closedStatuses.includes(tender.overallStatus) ? (
                        <small className={hoursLeft < 72 ? "text-bad" : ""}>{hoursLeft < 48 ? `${Math.floor(hoursLeft)} hours left` : `${Math.floor(hoursLeft / 24)} days left`}</small>
                      ) : null}
                    </span>
                    <span className="exec-cell">
                      <Status map={OVERALL} value={tender.overallStatus} />
                      <span className="branch-dots" title="Relevance · Costing · EMD · Bid">
                        <i className={`d ${RELEVANCE[tender.relevanceStatus]?.tone ?? ""}`} />
                        <i className={`d ${COSTING[tender.costingStatus]?.tone ?? ""}`} />
                        <i className={`d ${EMD[tender.emdStatus]?.tone ?? ""}`} />
                        <i className={`d ${BID[tender.bidStatus]?.tone ?? ""}`} />
                      </span>
                    </span>
                    <span className="exec-cell">
                      {owners.join(", ") || <span className="muted">—</span>}
                      {lateTask ? <small className="text-bad">Overdue</small> : null}
                    </span>
                  </summary>

                  <div className="exec-detail">
                    <div className="exec-detail-grid">
                      <section>
                        <h3>Workflow</h3>
                        <dl className="kv">
                          <dt>Relevance</dt>
                          <dd>
                            <Status map={RELEVANCE} value={tender.relevanceStatus} />
                          </dd>
                          <dt>Costing</dt>
                          <dd>
                            <Status map={COSTING} value={tender.costingStatus} />
                          </dd>
                          <dt>Dept. approval</dt>
                          <dd>
                            <Status map={APPROVAL} value={tender.approvalStatus} />
                          </dd>
                          <dt>EMD</dt>
                          <dd>
                            <Status map={EMD} value={tender.emdStatus} />
                          </dd>
                          <dt>Bid</dt>
                          <dd>
                            <Status map={BID} value={tender.bidStatus} />
                          </dd>
                          <dt>Submitter</dt>
                          <dd>{tender.submitterId ? names.get(tender.submitterId) : "Not assigned"}</dd>
                        </dl>
                        {tender.tasks.length ? (
                          <ul className="open-tasks">
                            {tender.tasks.map((task) => (
                              <li key={task.id} className={task.dueAt && task.dueAt.getTime() < now ? "late" : ""}>
                                <b>{STAGE[task.stage] ?? task.title}</b>
                                <small>
                                  {(JSON.parse(task.assigneeIds) as string[]).map((id) => names.get(id) ?? "Unknown").join(", ")} · due {formatWhen(task.dueAt, tz)}
                                </small>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </section>
                      <section>
                        <h3>Commercials</h3>
                        <dl className="kv">
                          <dt>Estimated value</dt>
                          <dd>{inr(tender.estimatedValue)}</dd>
                          <dt>Final costing</dt>
                          <dd>{inr(tender.finalCostingValue)}</dd>
                          <dt>Final vs estimate</dt>
                          <dd>{tender.finalCostingValue && tender.estimatedValue ? `${Math.round((tender.finalCostingValue / tender.estimatedValue) * 100)}%` : "—"}</dd>
                          <dt>EMD</dt>
                          <dd>
                            {inr(tender.emdExposure)} · {EMD_TYPE[tender.emdType] ?? tender.emdType}
                          </dd>
                          <dt>EMD reference</dt>
                          <dd>{tender.emd?.referenceNumber || "—"}</dd>
                          <dt>Bid reference</dt>
                          <dd>{tender.bid?.referenceNumber || "—"}</dd>
                          <dt>Outcome</dt>
                          <dd>{tender.outcome ? (OVERALL[tender.outcome]?.label ?? tender.outcome) : tender.closureReason ? `Closed: ${tender.closureReason}` : "Open"}</dd>
                        </dl>
                      </section>
                      <section>
                        <h3>Decisions</h3>
                        {tender.approvals.length === 0 ? <p className="muted">No decisions yet.</p> : null}
                        <ul className="timeline">
                          {tender.approvals.map((approval) => (
                            <li key={approval.id} className={approval.decision === "APPROVED" ? "good" : approval.decision === "REJECTED" ? "bad" : "warn"}>
                              <strong>
                                {STAGE[approval.stage] ?? approval.stage}: {DECISION[approval.decision] ?? approval.decision}
                              </strong>
                              <small>
                                {names.get(approval.approverId)} · {formatWhen(approval.createdAt, tz)}
                              </small>
                              {approval.comments ? <p>{approval.comments}</p> : null}
                            </li>
                          ))}
                        </ul>
                      </section>
                    </div>

                    <div className="all-fields">
                      <header>
                        <h3>All tender fields</h3>
                        <span className="muted">
                          {filled} of {TENDER_FIELDS.length} filled from the notice
                        </span>
                      </header>
                      {FIELD_SECTIONS.map(([from, to, title]) => (
                        <div key={title} className="field-section">
                          <h4>{title}</h4>
                          <dl>
                            {TENDER_FIELDS.filter((field) => field.no >= from && field.no <= to).map((field) => {
                              const value = fieldText(tender, field.key);
                              return (
                                <div key={field.key} className={value ? "" : "empty-field"}>
                                  <dt>
                                    {field.no}. {field.label}
                                  </dt>
                                  <dd>{value || "Not in document"}</dd>
                                </div>
                              );
                            })}
                          </dl>
                        </div>
                      ))}
                    </div>
                    <div className="actions">
                      <Link className="btn" to={`/tenders/${tender.id}`}>
                        Open the full record →
                      </Link>
                    </div>
                  </div>
                </details>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}
