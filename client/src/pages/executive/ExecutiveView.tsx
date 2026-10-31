import { Fragment, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { formatDay, formatWhen } from "@client/utils/calendar";
import { effectiveValue } from "@client/utils/format";
import { NOT_FOUND, TENDER_FIELDS } from "@client/lib/fields";
import { APPROVAL, BID, COSTING, DECISION, EMD, EMD_TYPE, OVERALL, RELEVANCE, ROLES, STAGE } from "@client/lib/labels";
import { inr } from "@client/utils/money";
import type { ApprovalRecord, BidSubmission, CalendarJson, EmdRecord, PublicUser, Tender, TenderField, WorkflowTask } from "@client/lib/types";
import { Status } from "@client/components/base/pill";
import { CountUp } from "@client/components/feature/count-up";
import { FxLink } from "@client/components/feature/fx-link";
import type { CardFx } from "@client/components/feature/fx";
import { PeriodPicker, inPeriod, resolvePeriod } from "@client/components/feature/period-picker";

/** Status groups for the Status filter, the stage bar and the cards. */
const GROUPS = [
  { key: "intake", label: "Intake & review", color: "#6f9bff", statuses: ["UPLOADED", "OCR_PROCESSING", "DATA_VALIDATION_REQUIRED", "PENDING_RELEVANCE"] },
  { key: "progress", label: "Costing & EMD", color: "#a78bfa", statuses: ["APPROVED_IN_PROGRESS"] },
  { key: "ready", label: "Ready to bid", color: "#f59e0b", statuses: ["READY_TO_BID"] },
  { key: "submitted", label: "Bid submitted", color: "#38bdf8", statuses: ["BID_EVIDENCE_PENDING", "BID_EVIDENCE_RECORDED"] },
  { key: "won", label: "Awarded", color: "#10b981", statuses: ["WON"] },
  { key: "lost", label: "Lost", color: "#ef4444", statuses: ["LOST"] },
  { key: "closed", label: "Closed / not bid", color: "#a8a29e", statuses: ["REJECTED_CLOSED", "NOT_BID_DEADLINE_MISSED", "CLOSED_BUSINESS", "CANCELLED"] },
];
const CLOSED = ["WON", "LOST", "REJECTED_CLOSED", "NOT_BID_DEADLINE_MISSED", "CLOSED_BUSINESS", "CANCELLED"];
const SUBMITTED = ["BID_EVIDENCE_PENDING", "BID_EVIDENCE_RECORDED"];

/** Short status pills for the table, as on the mockup. */
const SHORT: Record<string, [string, string]> = {
  UPLOADED: ["Uploaded", "gray"],
  OCR_PROCESSING: ["Reading", "violet"],
  DATA_VALIDATION_REQUIRED: ["Validation", "amber"],
  PENDING_RELEVANCE: ["Relevance review", "violet"],
  APPROVED_IN_PROGRESS: ["In progress", "blue"],
  READY_TO_BID: ["Ready to bid", "amber"],
  BID_EVIDENCE_PENDING: ["Bid submitted", "blue"],
  BID_EVIDENCE_RECORDED: ["In evaluation", "amber"],
  WON: ["Awarded", "green"],
  LOST: ["Lost", "red"],
  REJECTED_CLOSED: ["Rejected", "gray"],
  NOT_BID_DEADLINE_MISSED: ["Missed", "red"],
  CLOSED_BUSINESS: ["Closed", "gray"],
  CANCELLED: ["Cancelled", "gray"],
};

/** What a decision at each stage is about, for the activity feed ("Costing approved"). */
const DECISION_SUBJECT: Record<string, string> = { RELEVANCE: "Relevance", DEPT_APPROVAL: "Costing", FINAL_COSTING: "Final costing", EMD_CLARIFICATION: "EMD clarification" };

const FIELD_SECTIONS = [
  [1, 6, "Identity"],
  [7, 10, "Dates"],
  [11, 16, "Commercial"],
  [17, 20, "Submission"],
  [21, 30, "Qualification"],
  [31, 44, "Contract conditions"],
] as const;

const FILTER_KEYS = ["period", "basis", "q", "client", "emd", "owner", "portal", "group", "card"] as const;

/** Figure and pipeline cards. Each key is the same set the card counts, shown in the table below. */
const CARD_LABEL: Record<string, string> = {
  bids: "Bids submitted",
  won: "Awarded tenders",
  lost: "Lost tenders",
  eval: "In evaluation",
  due: "Upcoming deadlines",
  rate: "Won and lost tenders",
  active: "Active pipeline",
  costing: "Approved final costing",
  emd: "EMD exposure",
  overdue: "Overdue tasks",
};
type FilterKey = (typeof FILTER_KEYS)[number];

const ICONS: Record<string, ReactNode> = {
  doc: <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  trophy: <path d="M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20h7M10 17h4v3h-4z" />,
  cross: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  hourglass: <path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9" />,
  calendar: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2.5" />
      <path d="M4 10h16M8.5 3v4M15.5 3v4M8 14h2M12 14h2M8 17h2" />
    </>
  ),
  rupee: <path d="M7 5h10M7 9h10M7 5h3a4 4 0 0 1 0 8H7l7 6" />,
  target: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 12l6-6M15 6h3v3" />
    </>
  ),
  check: <path d="M5 12.5l4.5 4.5L19 7.5" />,
  shield: <path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />,
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  chevron: <path d="M6 9l6 6 6-6" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </>
  ),
  reset: <path d="M4 12a8 8 0 1 0 2.3-5.7M4 4v5h5" />,
};

function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg className={className ?? "dk-ico"} viewBox="0 0 24 24" aria-hidden>
      {ICONS[name]}
    </svg>
  );
}

function greeting(timeZone: string) {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hour12: false, timeZone }).format(new Date()));
  return hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
}

function ago(date: Date, now: number) {
  const minutes = Math.max(1, Math.round((now - date.getTime()) / 6e4));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.round(days / 30);
  return `${months} month${months === 1 ? "" : "s"} ago`;
}

const dayFmt = (timeZone: string) => new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", timeZone });

/** Group CEO view: the whole pipeline with every tender's workflow, commercials and all 44 fields on one page. */
export type ExecutiveData = {
  kind: "executive";
  tenders: (Tender & { fields: TenderField[]; tasks: WorkflowTask[]; approvals: ApprovalRecord[]; emd: EmdRecord | null; bid: BidSubmission | null })[];
  users: PublicUser[];
  calendar: CalendarJson;
};
type Row = ExecutiveData["tenders"][number];

export function ExecutiveView({ user, group, data }: { user: { name: string; role: string }; group?: string; data: ExecutiveData }) {
  const { tenders: everyTender, users, calendar } = data;
  const tz = calendar.timeZone;
  const names = new Map(users.map((item) => [item.id, item.name]));
  const now = Date.now();
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [allRows, setAllRows] = useState(false);
  const [allDeadlines, setAllDeadlines] = useState(false);
  const [allActivity, setAllActivity] = useState(false);

  // Filters live in the URL so a filtered view survives a refresh and can be shared.
  const [search, setSearch] = useSearchParams();
  const filter = Object.fromEntries(FILTER_KEYS.map((key) => [key, search.get(key) ?? ""])) as Record<FilterKey, string>;
  const [draft, setDraft] = useState(filter.q);
  const setFilter = (key: FilterKey, value: string) => {
    const next = new URLSearchParams(search);
    if (key === "group") next.delete("card");
    if (key === "card") next.delete("group");
    if (value && !(key === "period" && value === "all") && !(key === "basis" && value === "received")) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: true, preventScrollReset: true });
  };
  const resetFilters = () => {
    setDraft("");
    setSearch(new URLSearchParams(), { replace: true, preventScrollReset: true });
  };
  const stageHref = (key?: string, hash = "recent-tenders") => {
    const next = new URLSearchParams(search);
    next.delete("card");
    if (key) next.set("group", key);
    else next.delete("group");
    const query = next.toString();
    return `/${query ? `?${query}` : ""}#${hash}`;
  };
  const cardHref = (key: string) => {
    const next = new URLSearchParams(search);
    next.delete("group");
    if (filter.card === key) next.delete("card");
    else next.set("card", key);
    const query = next.toString();
    return `/${query ? `?${query}` : ""}#recent-tenders`;
  };

  const period = resolvePeriod(filter.period || "all");
  const byDeadline = filter.basis === "deadline";
  const ownersOf = (tender: Row) => new Set(tender.tasks.flatMap((task) => JSON.parse(task.assigneeIds) as string[]));
  const needle = filter.q.trim().toLowerCase();
  const tenders = everyTender.filter((tender) => {
    if (!inPeriod(period, byDeadline ? tender.bidSubmissionEnd : tender.createdAt)) return false;
    if (filter.client && tender.clientName !== filter.client) return false;
    if (filter.emd && tender.emdType !== filter.emd) return false;
    if (filter.portal && (tender.portalName || tender.source) !== filter.portal) return false;
    if (filter.owner && !ownersOf(tender).has(filter.owner)) return false;
    if (needle) {
      const text = [tender.projectName, tender.recordId, tender.tenderRef, tender.externalTenderId, tender.clientName, tender.location, tender.portalName].join(" ").toLowerCase();
      if (!text.includes(needle)) return false;
    }
    return true;
  });
  const distinct = (pick: (tender: Row) => string) => [...new Set(everyTender.map(pick).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const clients = distinct((t) => t.clientName);
  const portals = distinct((t) => t.portalName || t.source);
  const emdTypes = distinct((t) => t.emdType);
  const ownerIds = [...new Set(everyTender.flatMap((t) => [...ownersOf(t)]))].sort((a, b) => (names.get(a) ?? "").localeCompare(names.get(b) ?? ""));
  const earliest = everyTender.reduce<Date | null>((min, t) => (!min || t.createdAt < min ? t.createdAt : min), null);
  const activeFilters = FILTER_KEYS.filter((key) => filter[key] && !(key === "period" && filter[key] === "all")).length;

  // Figures, all on the filtered set.
  const sum = (list: Row[], pick: (tender: Row) => number | null) => list.reduce((total, tender) => total + (pick(tender) ?? 0), 0);
  const active = tenders.filter((tender) => !CLOSED.includes(tender.overallStatus));
  const won = tenders.filter((tender) => tender.overallStatus === "WON").length;
  const lost = tenders.filter((tender) => tender.overallStatus === "LOST").length;
  const bidsSubmitted = tenders.filter((tender) => tender.bidStatus.startsWith("BID_SUBMITTED")).length;
  const inEvaluation = tenders.filter((tender) => SUBMITTED.includes(tender.overallStatus)).length;
  const upcoming = active
    .filter((tender) => tender.bidSubmissionEnd && tender.bidSubmissionEnd.getTime() > now && !SUBMITTED.includes(tender.overallStatus))
    .sort((a, b) => a.bidSubmissionEnd!.getTime() - b.bidSubmissionEnd!.getTime());
  const dueWeek = upcoming.filter((tender) => tender.bidSubmissionEnd!.getTime() - now < 7 * 864e5);
  const overdue = tenders.flatMap((tender) => tender.tasks).filter((task) => task.dueAt && task.dueAt.getTime() < now).length;
  const winRate = won + lost ? Math.round((won / (won + lost)) * 100) : 0;

  const cards = [
    { key: "total", label: "Total tenders", fx: "docs" as CardFx, value: tenders.length, note: `${active.length} active tenders`, icon: "doc", tone: "blue", href: stageHref() },
    { key: "bids", label: "Bids submitted", fx: "send" as CardFx, value: bidsSubmitted, note: "Bids submitted", icon: "clock", tone: "violet", href: cardHref("bids") },
    { key: "won", label: "Awarded tenders", fx: "award" as CardFx, value: won, note: "Successfully awarded", icon: "trophy", tone: "green", href: cardHref("won") },
    { key: "lost", label: "Lost tenders", fx: "lost" as CardFx, value: lost, note: "Not awarded", icon: "cross", tone: "red", href: cardHref("lost") },
    { key: "eval", label: "In evaluation", fx: "hourglass" as CardFx, value: inEvaluation, note: "Under evaluation", icon: "hourglass", tone: "orange", href: cardHref("eval") },
    { key: "due", label: "Upcoming deadlines", fx: "pending" as CardFx, value: dueWeek.length, note: "In next 7 days", icon: "calendar", tone: "sky", href: cardHref("due") },
    { key: "value", label: "Total tender value", fx: "coins" as CardFx, value: sum(tenders, (t) => t.estimatedValue), money: true, note: "Estimated value", icon: "rupee", tone: "rose", href: stageHref() },
    { key: "rate", label: "Win rate", fx: "target" as CardFx, value: winRate, suffix: "%", note: `${won} won · ${lost} lost`, icon: "target", tone: "teal", href: cardHref("rate") },
  ];

  const cardRows = (key: string): Row[] | null => {
    if (key === "bids") return tenders.filter((tender) => tender.bidStatus.startsWith("BID_SUBMITTED"));
    if (key === "won") return tenders.filter((tender) => tender.overallStatus === "WON");
    if (key === "lost") return tenders.filter((tender) => tender.overallStatus === "LOST");
    if (key === "eval") return tenders.filter((tender) => SUBMITTED.includes(tender.overallStatus));
    if (key === "due") return dueWeek;
    if (key === "rate") return tenders.filter((tender) => tender.overallStatus === "WON" || tender.overallStatus === "LOST");
    if (key === "active") return active;
    if (key === "costing") return tenders.filter((tender) => tender.costingStatus === "APPROVED");
    if (key === "emd") return active.filter((tender) => tender.emdType !== "EXEMPTION");
    if (key === "overdue") return tenders.filter((tender) => tender.tasks.some((task) => task.dueAt && task.dueAt.getTime() < now));
    return null;
  };
  const focused = cardRows(filter.card);
  const selected = focused ? undefined : GROUPS.find((item) => item.key === group);
  const focusLabel = CARD_LABEL[filter.card] ?? "";
  const rows = (focused ?? (selected ? tenders.filter((tender) => selected.statuses.includes(tender.overallStatus)) : tenders))
    .slice()
    .sort((a, b) =>
      filter.card === "due" && a.bidSubmissionEnd && b.bidSubmissionEnd
        ? a.bidSubmissionEnd.getTime() - b.bidSubmissionEnd.getTime()
        : b.createdAt.getTime() - a.createdAt.getTime(),
    );
  const shownRows = allRows ? rows : rows.slice(0, 8);

  // Activity is assembled from what the records already carry: receipt, decisions, EMD, bids and outcomes.
  type Activity = { at: Date; title: string; by: string; icon: string; tone: string; id: string };
  const activity: Activity[] = tenders
    .flatMap((tender) => {
      const items: Activity[] = [
        { at: tender.createdAt, title: `Tender received - ${tender.recordId}`, by: names.get(tender.createdById) ?? "System", icon: "doc", tone: "blue", id: tender.id },
      ];
      for (const approval of tender.approvals) {
        const rejected = approval.decision === "REJECTED";
        items.push({
          at: approval.createdAt,
          title: `${DECISION_SUBJECT[approval.stage] ?? STAGE[approval.stage] ?? approval.stage} ${(DECISION[approval.decision] ?? approval.decision).toLowerCase()} - ${tender.recordId}`,
          by: names.get(approval.approverId) ?? "Unknown",
          icon: rejected ? "cross" : "check",
          tone: rejected ? "red" : "violet",
          id: tender.id,
        });
      }
      if (tender.emd?.completedAt) {
        items.push({ at: tender.emd.completedAt, title: `EMD ready (${EMD_TYPE[tender.emd.instrumentType] ?? tender.emd.instrumentType}) - ${tender.recordId}`, by: "Accounts", icon: "shield", tone: "orange", id: tender.id });
      }
      if (tender.bid?.submittedAt) {
        items.push({ at: tender.bid.submittedAt, title: `Bid submitted - ${tender.recordId}`, by: names.get(tender.bid.submitterId) ?? "Bid submitter", icon: "clock", tone: "sky", id: tender.id });
      }
      if (tender.closedAt && CLOSED.includes(tender.overallStatus)) {
        const outcome: Record<string, [string, string, string]> = {
          WON: ["Tender awarded", "trophy", "green"],
          LOST: ["Tender lost", "cross", "red"],
          CANCELLED: ["Tender cancelled", "cross", "gray"],
          REJECTED_CLOSED: ["Closed after review", "cross", "gray"],
          NOT_BID_DEADLINE_MISSED: ["Deadline missed", "calendar", "red"],
          CLOSED_BUSINESS: ["Closed by business decision", "cross", "gray"],
        };
        const [title, icon, tone] = outcome[tender.overallStatus];
        items.push({ at: tender.closedAt, title: `${title} - ${tender.recordId}`, by: "System", icon, tone, id: tender.id });
      }
      return items;
    })
    .filter((item) => item.at.getTime() <= now)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const shownActivity = activity.slice(0, allActivity ? 20 : 5);
  const shownDeadlines = upcoming.slice(0, allDeadlines ? 20 : 5);
  const day = dayFmt(tz);

  return (
    <div className="dk">
      <section className="dk-hero">
        <PlantArt />
        <div className="dk-hero-text">
          <div className="dk-hi">
            {greeting(tz)}, <span className="wave">👋</span>
          </div>
          <h1>{user.name}</h1>
          <p>
            Here's your Coal &amp; Ash tender pipeline overview <span className="dk-role">· {ROLES[user.role] ?? user.role}</span>
          </p>
        </div>
        <div className="dk-hero-tools">
          <PeriodPicker value={filter.period || "all"} onChange={(key) => setFilter("period", key)} earliest={earliest} compact align="right" />
        </div>
      </section>

      <section className="dk-cards" aria-label="Tender figures">
        {cards.map((card, index) => (
          <FxLink key={card.key} href={card.href} fx={card.fx} className={`dk-card ${card.tone}${card.key === "due" && dueWeek.length ? " hot" : ""}${filter.card === card.key ? " is-on" : ""}`} style={{ "--i": index } as CSSProperties}>
            <span className="dk-card-icon">
              <Icon name={card.icon} />
            </span>
            <span className="dk-card-body">
              <span className="dk-card-label">{card.label}</span>
              <b>
                <CountUp value={card.value} money={card.money} duration={1200} delay={200 + index * 70} />
                {card.suffix ?? ""}
              </b>
              <small>{card.note}</small>
            </span>
            <Icon name="arrow" className="dk-card-arrow" />
            <Icon name={card.icon} className="dk-card-mark" />
          </FxLink>
        ))}
      </section>

      <section className="dk-panel">
        <header className="dk-panel-head">
          <span className="dk-panel-icon">
            <Icon name="target" />
          </span>
          <div>
            <h2>Pipeline by stage</h2>
            <p>{tenders.length} tenders · click a card to filter the tenders below</p>
          </div>
        </header>
        <div className="stage-legend dk-legend">
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
        <div className="dk-health">
          <FxLink href={cardHref("active")} fx="pulse" className={filter.card === "active" ? "is-on" : ""}>
            <span>Active pipeline value</span>
            <b>{inr(sum(active, (t) => t.estimatedValue))}</b>
            <small>{active.length} active tenders</small>
          </FxLink>
          <FxLink href={cardHref("costing")} fx="pulse" className={filter.card === "costing" ? "is-on" : ""}>
            <span>Approved final costing</span>
            <b>{inr(sum(tenders.filter((t) => t.costingStatus === "APPROVED"), (t) => t.finalCostingValue))}</b>
            <small>{tenders.filter((t) => t.costingStatus === "APPROVED").length} costings approved</small>
          </FxLink>
          <FxLink href={cardHref("emd")} fx="pulse" className={filter.card === "emd" ? "is-on" : ""}>
            <span>EMD exposure</span>
            <b>{inr(sum(active.filter((t) => t.emdType !== "EXEMPTION"), (t) => t.emdExposure))}</b>
            <small>Guarantees and bonds in play</small>
          </FxLink>
          <FxLink href={cardHref("overdue")} fx="pulse" className={`${overdue ? "bad" : "good"}${filter.card === "overdue" ? " is-on" : ""}`}>
            <span>Overdue tasks</span>
            <b>{overdue}</b>
            <small>{overdue ? "Past their working-time SLA" : "Everything on time"}</small>
          </FxLink>
        </div>
      </section>
      <form
        className="dk-filters"
        aria-label="Filters"
        onSubmit={(event) => {
          event.preventDefault();
          setFilter("q", draft.trim());
        }}
      >
        <label className="dk-filter">
          <span>Status</span>
          <select value={filter.group} onChange={(event) => setFilter("group", event.target.value)}>
            <option value="">All statuses</option>
            {GROUPS.map((item) => (
              <option key={item.key} value={item.key}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="dk-filter">
          <span>Client</span>
          <select value={filter.client} onChange={(event) => setFilter("client", event.target.value)}>
            <option value="">All clients</option>
            {clients.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="dk-filter">
          <span>Portal / type</span>
          <select value={filter.portal} onChange={(event) => setFilter("portal", event.target.value)}>
            <option value="">All types</option>
            {portals.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="dk-filter">
          <span>EMD type</span>
          <select value={filter.emd} onChange={(event) => setFilter("emd", event.target.value)}>
            <option value="">All EMD types</option>
            {emdTypes.map((item) => (
              <option key={item} value={item}>
                {EMD_TYPE[item] ?? item}
              </option>
            ))}
          </select>
        </label>
        <label className="dk-filter">
          <span>Now with</span>
          <select value={filter.owner} onChange={(event) => setFilter("owner", event.target.value)}>
            <option value="">Anyone</option>
            {ownerIds.map((id) => (
              <option key={id} value={id}>
                {names.get(id) ?? "Unknown"}
              </option>
            ))}
          </select>
        </label>
        <div className="dk-filter">
          <span>Date by</span>
          <div className="seg">
            <button type="button" className={byDeadline ? "" : "is-on"} onClick={() => setFilter("basis", "received")}>
              Received
            </button>
            <button type="button" className={byDeadline ? "is-on" : ""} onClick={() => setFilter("basis", "deadline")}>
              Deadline
            </button>
          </div>
        </div>
        <label className="dk-filter dk-search">
          <span>Search</span>
          <span className="dk-search-box">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Project, reference, client, location…"
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                if (!event.target.value) setFilter("q", "");
              }}
            />
          </span>
        </label>
        <button className="dk-btn" type="submit">
          Search
        </button>
        <div className="dk-showing">
          <p>
            Showing <b>{filter.card || selected ? rows.length : tenders.length}</b> of {everyTender.length} tenders
            {focusLabel ? ` · ${focusLabel}` : ""}
            {period.from ? ` · ${byDeadline ? "bid deadline" : "received"} ${period.detail}` : ""}
          </p>
          <button type="button" className="dk-link" onClick={resetFilters} disabled={!activeFilters && !draft}>
            <Icon name="reset" />
            Clear filters{activeFilters ? ` (${activeFilters})` : ""}
          </button>
        </div>
      </form>

      <div className="dk-main">
        <section className="dk-panel" id="recent-tenders">
          <header className="dk-panel-head">
            <span className="dk-panel-icon">
              <Icon name="doc" />
            </span>
            <div>
              <h2>{focusLabel || (selected ? `${selected.label} tenders` : "Recent tenders")}</h2>
              <p>
                {focusLabel || selected
                  ? `${rows.length} shown · ${filter.card === "due" ? "soonest deadline first" : "newest first"}`
                  : "Latest tender activity"}
              </p>
            </div>
            {focusLabel || selected ? (
              <Link className="dk-ghost" to={stageHref()} preventScrollReset>
                All tenders
              </Link>
            ) : null}
            {rows.length > 8 ? (
              <button type="button" className="dk-ghost" onClick={() => setAllRows((v) => !v)}>
                {allRows ? "Show fewer" : `View all ${rows.length}`}
              </button>
            ) : null}
          </header>
          <div className="dk-table-wrap">
            <table className="dk-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Tender reference</th>
                  <th>Title</th>
                  <th>Client</th>
                  <th className="num">Est. value</th>
                  <th>Status</th>
                  <th>Tender start date</th>
                  <th>Tender end date</th>
                  <th className="act">Actions</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="dk-empty">
                      No tenders match these filters.
                    </td>
                  </tr>
                ) : null}
                {shownRows.map((tender, index) => {
                  const [label, tone] = SHORT[tender.overallStatus] ?? [OVERALL[tender.overallStatus]?.label ?? tender.overallStatus, "gray"];
                  const late = tender.tasks.some((task) => task.dueAt && task.dueAt.getTime() < now);
                  const open = openRow === tender.id;
                  return (
                    <Fragment key={tender.id}>
                      <tr className={`dk-row${open ? " is-open" : ""}${late ? " is-late" : ""}`} onClick={() => setOpenRow(open ? null : tender.id)} style={{ "--r": Math.min(index, 12) } as CSSProperties}>
                        <td className="muted">{index + 1}</td>
                        <td>
                          <span className="dk-ref">{tender.recordId}</span>
                        </td>
                        <td className="dk-title">
                          {tender.projectName || "Untitled"}
                          {late ? <small className="text-bad"> · overdue task</small> : null}
                        </td>
                        <td>{tender.clientName || "—"}</td>
                        <td className="num">{inr(tender.estimatedValue)}</td>
                        <td>
                          <span className={`dk-pill ${tone}`}>{label}</span>
                        </td>
                        <td>{formatDay(tender.createdAt, tz)}</td>
                        <td>{formatDay(tender.bidSubmissionEnd, tz)}</td>
                        <td className="act" onClick={(event) => event.stopPropagation()}>
                          <Link className="dk-icon-btn" to={`/tenders/${tender.id}`} title="Open the tender record" aria-label="Open the tender record">
                            <Icon name="eye" />
                          </Link>
                          <button
                            type="button"
                            className={`dk-icon-btn${open ? " is-on" : ""}`}
                            onClick={() => setOpenRow(open ? null : tender.id)}
                            title={open ? "Hide details" : "Show workflow, commercials and all 44 fields"}
                            aria-expanded={open}
                          >
                            <Icon name="chevron" />
                          </button>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="dk-detail-row">
                          <td colSpan={9}>
                            <TenderSummary tender={tender} names={names} tz={tz} now={now} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="dk-tender-cards">
            {shownRows.length === 0 ? <li className="dk-empty">No tenders match these filters.</li> : null}
            {shownRows.map((tender) => {
              const [label, tone] = SHORT[tender.overallStatus] ?? [OVERALL[tender.overallStatus]?.label ?? tender.overallStatus, "gray"];
              const late = tender.tasks.some((task) => task.dueAt && task.dueAt.getTime() < now);
              const open = openRow === tender.id;
              return (
                <li key={tender.id} className={`ceo-card${open ? " is-open" : ""}${late ? " is-late" : ""}`}>
                  <button type="button" className="ceo-card-main" onClick={() => setOpenRow(open ? null : tender.id)} aria-expanded={open}>
                    <span className="ceo-card-top">
                      <span className="dk-ref">{tender.recordId}</span>
                      <span className={`dk-pill ${tone}`}>{label}</span>
                    </span>
                    <strong>{tender.projectName || "Untitled"}</strong>
                    {late ? <small className="text-bad">Overdue task</small> : null}
                    <dl className="ceo-card-facts">
                      <div>
                        <dt>Client</dt>
                        <dd>{tender.clientName || "—"}</dd>
                      </div>
                      <div>
                        <dt>Est. value</dt>
                        <dd>{inr(tender.estimatedValue)}</dd>
                      </div>
                      <div>
                        <dt>Start date</dt>
                        <dd>{formatDay(tender.createdAt, tz)}</dd>
                      </div>
                      <div>
                        <dt>End date</dt>
                        <dd>{formatDay(tender.bidSubmissionEnd, tz)}</dd>
                      </div>
                    </dl>
                  </button>
                  <div className="ceo-card-actions">
                    <Link to={`/tenders/${tender.id}`}>Open tender</Link>
                    <button type="button" onClick={() => setOpenRow(open ? null : tender.id)}>
                      {open ? "Hide details" : "Details"}
                    </button>
                  </div>
                  {open ? <TenderSummary tender={tender} names={names} tz={tz} now={now} /> : null}
                </li>
              );
            })}
          </ul>
        </section>

        <aside className="dk-side">
          <section className="dk-panel" id="deadlines">
            <header className="dk-panel-head">
              <span className="dk-panel-icon">
                <Icon name="calendar" />
              </span>
              <div>
                <h2>Upcoming deadlines</h2>
              </div>
              {upcoming.length > 5 ? (
                <button type="button" className="dk-ghost" onClick={() => setAllDeadlines((v) => !v)}>
                  {allDeadlines ? "Fewer" : "View all"}
                </button>
              ) : null}
            </header>
            {shownDeadlines.length === 0 ? <p className="dk-empty">No open bid deadlines ahead.</p> : null}
            <ul className="dk-deadlines">
              {shownDeadlines.map((tender, index) => {
                const days = (tender.bidSubmissionEnd!.getTime() - now) / 864e5;
                const [dd, mon] = day.format(tender.bidSubmissionEnd!).split(" ");
                const task = tender.tasks[0];
                const tag = task ? (STAGE[task.stage] ?? task.title) : (SHORT[tender.overallStatus]?.[0] ?? "Open");
                const left = days < 1 ? `${Math.max(1, Math.round(days * 24))} hours left` : `${Math.floor(days)} day${Math.floor(days) === 1 ? "" : "s"} left`;
                return (
                  <li key={tender.id} style={{ "--r": index } as CSSProperties}>
                    <Link to={`/tenders/${tender.id}`} className={`dk-deadline ${days <= 3 ? "hot" : days <= 7 ? "warm" : ""}`}>
                      <span className="dk-date">
                        <b>{dd}</b>
                        <small>{mon}</small>
                      </span>
                      <span className="dk-deadline-main">
                        <b>{tender.projectName || tender.recordId}</b>
                        <small>{tender.clientName}</small>
                      </span>
                      <span className="dk-deadline-end">
                        <span className="dk-tag">{tag}</span>
                        <small>{left}</small>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="dk-panel">
            <header className="dk-panel-head">
              <span className="dk-panel-icon">
                <Icon name="clock" />
              </span>
              <div>
                <h2>Recent activities</h2>
              </div>
              {activity.length > 5 ? (
                <button type="button" className="dk-ghost" onClick={() => setAllActivity((v) => !v)}>
                  {allActivity ? "Fewer" : "View all"}
                </button>
              ) : null}
            </header>
            {shownActivity.length === 0 ? <p className="dk-empty">Nothing yet in this period.</p> : null}
            <ul className="dk-activity">
              {shownActivity.map((item, index) => (
                <li key={`${item.id}-${item.title}-${index}`} style={{ "--r": index } as CSSProperties}>
                  <Link to={`/tenders/${item.id}`}>
                    <span className={`dk-act-icon ${item.tone}`}>
                      <Icon name={item.icon} />
                    </span>
                    <span className="dk-act-main">
                      <b>{item.title}</b>
                      <small>by {item.by}</small>
                    </span>
                    <small className="dk-act-when">{ago(item.at, now)}</small>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

    </div>
  );
}

/** Expanded row: workflow, commercials, decisions and all 44 fields of one tender. */
function TenderSummary({ tender, names, tz, now }: { tender: Row; names: Map<string, string>; tz: string; now: number }) {
  const fieldText = (key: string) => {
    const row = tender.fields.find((field) => field.fieldKey === key);
    const value = row ? effectiveValue(row).trim() : "";
    return value && value !== NOT_FOUND ? value : "";
  };
  const filled = tender.fields.filter((field) => effectiveValue(field).trim() && effectiveValue(field) !== NOT_FOUND).length;
  return (
    <div className="exec-detail dk-detail">
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
            <dt>Portal</dt>
            <dd>{tender.portalName || "—"}</dd>
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
                const value = fieldText(field.key);
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
  );
}

/** Hero illustration: plant skyline with stacks, cooling tower, conveyor and coal heaps; smoke drifts. */
function PlantArt() {
  return (
    <svg className="dk-art" viewBox="0 0 900 300" preserveAspectRatio="xMaxYMax meet" aria-hidden>
      <defs>
        <linearGradient id="dkFar" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#93b4dd" />
          <stop offset="1" stopColor="#b8cde8" />
        </linearGradient>
        <linearGradient id="dkNear" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3f5f86" />
          <stop offset="1" stopColor="#2a4466" />
        </linearGradient>
        <linearGradient id="dkCoal" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#3a4250" />
          <stop offset="1" stopColor="#151a22" />
        </linearGradient>
      </defs>
      <g className="dk-smoke">
        <circle cx="610" cy="40" r="16" />
        <circle cx="628" cy="26" r="20" />
        <circle cx="652" cy="18" r="16" />
        <circle cx="745" cy="70" r="13" />
        <circle cx="760" cy="56" r="17" />
      </g>
      <path d="M380 300V230h40v-20h30v30h50v-40h60v40h40v-25h45v25h60v-35h50v35h45V300z" fill="url(#dkFar)" />
      <path d="M590 300V60h22v240zM735 300V95h18v205z" fill="#5d7ea6" />
      <path d="M588 60h26v10h-26zM733 95h22v8h-22z" fill="#c2410c" opacity="0.85" />
      <path d="M800 300c8-40 8-75-2-110h70c-10 35-10 70-2 110z" fill="#7d9cc2" />
      <path d="M520 300V210h70v90zM640 300V170h80v130zM830 300v-60h70v60z" fill="url(#dkNear)" />
      <g fill="#a8c4ea" opacity="0.8">
        <rect x="532" y="222" width="10" height="8" />
        <rect x="550" y="222" width="10" height="8" />
        <rect x="568" y="222" width="10" height="8" />
        <rect x="654" y="184" width="10" height="8" />
        <rect x="672" y="184" width="10" height="8" />
        <rect x="690" y="184" width="10" height="8" />
        <rect x="654" y="202" width="10" height="8" />
        <rect x="690" y="202" width="10" height="8" />
      </g>
      <path d="M430 300l90-105 6 4-88 101z" fill="#4a6587" />
      <path d="M520 195l14-10 6 8-14 9z" fill="#2a4466" />
      <path d="M330 300c40-55 80-80 120-80s75 30 105 80z" fill="url(#dkCoal)" />
      <path d="M560 300c30-35 60-50 90-50s55 18 80 50z" fill="url(#dkCoal)" opacity="0.92" />
      <path d="M396 254c18-14 34-20 50-20" stroke="#5b6574" strokeWidth="3" fill="none" opacity="0.6" />
    </svg>
  );
}
