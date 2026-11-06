import { useActionState, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { BondDocUploader } from "./BondDocuments";
import { useApi } from "@client/api/client";
import { importBondsAction } from "@client/api/actions";
import type { ActionState } from "@client/api/action-state";
import type { SuretyBond } from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { Submit } from "@client/components/base/submit";
import { FilePick } from "@client/components/feature/task-kit";
import { CountUp } from "@client/components/feature/count-up";
import { FxLink } from "@client/components/feature/fx-link";
import type { CardFx } from "@client/components/feature/fx";
import { Icon, PlantArt } from "@client/pages/executive/ExecutiveView";
import { inr, inrFull } from "@client/utils/money";
import { PeriodPicker, inPeriod, resolvePeriod } from "@client/components/feature/period-picker";

type Data = { bonds: SuretyBond[]; docCounts: Record<string, number>; canImport: boolean; importedAt: Date | null };

const DAY = 864e5;

/** Health of a bond today, from its latest expiry and claim dates (extensions included). */
export type Health = "expired" | "claim" | "soon" | "watch" | "active" | "unknown";
export const HEALTH: Record<Health, { label: string; tone: string }> = {
  expired: { label: "Claim period over", tone: "" },
  claim: { label: "Expired · claim open", tone: "red" },
  soon: { label: "Expires ≤ 30 days", tone: "amber" },
  watch: { label: "Expires ≤ 90 days", tone: "blue" },
  active: { label: "Active", tone: "green" },
  unknown: { label: "No expiry date", tone: "" },
};

const latest = (...dates: (Date | null)[]) => dates.reduce<Date | null>((best, date) => (date && (!best || date > best) ? date : best), null);

export function enrich(bond: SuretyBond, today: Date) {
  const expiry = latest(bond.expiryDate, bond.ext1ExpiryDate, bond.ext2Date);
  const claim = latest(bond.claimExpiryDate, bond.ext1ClaimDate, bond.ext2ClaimDate) ?? expiry;
  const days = expiry ? Math.ceil((expiry.getTime() - today.getTime()) / DAY) : null;
  const health: Health =
    !expiry ? "unknown" : expiry < today ? (claim && claim >= today ? "claim" : "expired") : days! <= 30 ? "soon" : days! <= 90 ? "watch" : "active";
  const extended = Boolean(bond.ext1ExpiryDate || bond.ext2Date);
  const dateCheck = Boolean(bond.issueDate && expiry && bond.issueDate > expiry);
  const name = bond.kind === "EMD" ? bond.plant || bond.customer : bond.customer;
  return { ...bond, expiry, claim, days, health, extended, dateCheck, name };
}
export type Row = ReturnType<typeof enrich>;

export const day = (date: Date | null) =>
  date ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(date) : "—";
const sum = (rows: Row[], pick: (row: Row) => number | null) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0);

/** Filters that can be added to the bar with "+ Add filter". Each matches one bond field exactly. */
const EXTRA_FILTERS: { key: string; label: string; pick: (row: Row) => string; show?: (value: string) => string }[] = [
  { key: "customer", label: "Customer", pick: (row) => row.customer },
  { key: "broker", label: "Broker", pick: (row) => row.broker },
  { key: "line", label: "Business line", pick: (row) => row.line, show: (value) => (value === "COAL" ? "Coal" : value === "ASH" ? "Ash" : value) },
  { key: "used", label: "Used for", pick: (row) => row.usedFor, show: (value) => (value === "PS" ? "PS · performance security" : value === "APS" ? "APS · additional security" : value) },
  { key: "status", label: "EMD status", pick: (row) => row.status },
  { key: "mode", label: "Mode", pick: (row) => row.mode },
];

const KIND_LABEL: Record<string, string> = { EMD: "EMD", PERFORMANCE: "PBG" };

export function Glyph({ name }: { name: "plus" | "x" }) {
  return (
    <svg className="bonds-glyph" viewBox="0 0 24 24" aria-hidden>
      {name === "plus" ? <path d="M12 5v14M5 12h14" /> : <path d="M6 6l12 12M18 6 6 18" />}
    </svg>
  );
}

/** A filter select with a remove button once it has a value (or always, for an added filter). */
export function SelectFilter({
  label,
  value,
  allLabel,
  options,
  onChange,
  onRemove,
  removable = false,
}: {
  label: string;
  value: string;
  allLabel: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
  onRemove?: () => void;
  removable?: boolean;
}) {
  return (
    <div className={`dk-filter bonds-filter${value ? " has-value" : ""}${removable ? " is-added" : ""}`}>
      <span>{label}</span>
      <span className="bonds-select">
        <select value={value} onChange={(event) => onChange(event.target.value)} aria-label={label}>
          <option value="">{allLabel}</option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        {value || removable ? (
          <button type="button" className="bonds-remove" onClick={onRemove ?? (() => onChange(""))} title={removable ? `Remove the ${label.toLowerCase()} filter` : `Clear ${label.toLowerCase()}`} aria-label={removable ? `Remove the ${label.toLowerCase()} filter` : `Clear ${label.toLowerCase()}`}>
            <Glyph name="x" />
          </button>
        ) : null}
      </span>
    </div>
  );
}

/** What each card narrows the table to. */
const CARD_ROWS: Record<string, { label: string; match: (row: Row) => boolean; sort?: "premium" | "stamp" | "amount" }> = {
  emd: { label: "EMD surety bonds", match: (row) => row.kind === "EMD" },
  pb: { label: "PBG (performance) bonds", match: (row) => row.kind === "PERFORMANCE" },
  active: { label: "Active bonds", match: (row) => row.health === "active" || row.health === "watch" || row.health === "soon" },
  soon: { label: "Expiring in 30 days", match: (row) => row.health === "soon" },
  watch: { label: "Expiring in 31–90 days", match: (row) => row.health === "watch" },
  claim: { label: "Expired, claim still open", match: (row) => row.health === "claim" },
  tech: { label: "EMD under technical evaluation", match: (row) => row.kind === "EMD" && /technical/i.test(row.status) },
  premium: { label: "Bonds by premium paid", match: () => true, sort: "premium" },
  stamp: { label: "Bonds by stamp duty", match: () => true, sort: "stamp" },
};

/**
 * The bond register. `embedded` shows it inside the Group CEO dashboard (at /?board=isb),
 * so its links stay on that page; `toggle` is the Tender | EMD switch for the banner.
 */
export default function BondsPage({ embedded = false, toggle }: { embedded?: boolean; toggle?: ReactNode } = {}) {
  const path = embedded ? "/" : "/bonds";
  const fixed = embedded ? ["board=isb"] : [];
  const { data, error, reload } = useApi<Data>("/bonds");
  const [params, setParams] = useSearchParams();
  const [importing, setImporting] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [allRows, setAllRows] = useState(false);
  const [draft, setDraft] = useState(params.get("q") ?? "");
  const [added, setAdded] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const today = useMemo(() => new Date(), []);
  const everyBond = useMemo(() => (data?.bonds ?? []).map((bond) => enrich(bond, today)).filter((bond) => bond.kind !== "EMD"), [data, today]);
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;

  const filter = { period: params.get("period") ?? "", basis: params.get("basis") ?? "", card: params.get("card") ?? "", kind: params.get("kind") ?? "", state: params.get("state") ?? "", insurer: params.get("insurer") ?? "", health: params.get("health") ?? "", q: params.get("q") ?? "" };
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && !(key === "period" && value === "all") && !(key === "basis" && value === "issued")) next.set(key, value);
    else next.delete(key);
    setParams(next, { preventScrollReset: true });
  };
  const resetFilters = () => {
    setDraft("");
    setAdded([]);
    setParams(embedded ? { board: "isb" } : {}, { preventScrollReset: true });
  };
  // The period scopes the whole page (cards, charts and table), by issue date or by expiry date.
  const byExpiry = filter.basis === "expiry";
  // Expiries lie ahead, so the expiry view offers future ranges and does not stop at today.
  const period = resolvePeriod(filter.period || "all", undefined, { future: byExpiry });
  // The period and the PBG / EMD switch scope the whole board: cards, charts and table.
  const rows = everyBond.filter((row) => inPeriod(period, byExpiry ? row.expiry : row.issueDate) && (!filter.kind || row.kind === filter.kind));
  const earliest = everyBond.reduce<Date | null>((min, row) => (row.issueDate && (!min || row.issueDate < min) ? row.issueDate : min), null);
  const keep = [...fixed, ...["period", "basis"].filter((key) => params.get(key)).map((key) => `${key}=${encodeURIComponent(params.get(key)!)}`)];
  const cardHref = (key: string) => `${path}?${[...keep, `card=${key}`].join("&")}#bond-list`;
  const allHref = `${path}${keep.length ? `?${keep.join("&")}` : ""}#bond-list`;

  const pb = rows.filter((row) => row.kind === "PERFORMANCE");
  const soon = rows.filter((row) => row.health === "soon");
  const watch = rows.filter((row) => row.health === "watch");
  const claim = rows.filter((row) => row.health === "claim");
  const live = rows.filter((row) => CARD_ROWS.active.match(row));

  const cards = [
    { key: "pb", label: "PBG bonds", fx: "award" as CardFx, value: sum(pb, (row) => row.amount), money: true, note: `${pb.length} bonds · ${pb.filter((row) => row.usedFor === "APS").length} APS`, icon: "trophy", tone: "violet" },
    { key: "active", label: "Active bonds", fx: "ready" as CardFx, value: live.length, note: inr(sum(live, (row) => row.amount)), icon: "check", tone: "green" },
    { key: "soon", label: "Expiring in 30 days", fx: "hourglass" as CardFx, value: soon.length, note: soon.length ? inr(sum(soon, (row) => row.amount)) : "Nothing due", icon: "hourglass", tone: "red", hot: soon.length > 0 },
    { key: "watch", label: "Expiring in 90 days", fx: "pending" as CardFx, value: watch.length, note: watch.length ? inr(sum(watch, (row) => row.amount)) : "None", icon: "calendar", tone: "sky" },
    { key: "claim", label: "Claim window open", fx: "overdue" as CardFx, value: claim.length, note: claim.length ? "Expired, still claimable" : "None open", icon: "clock", tone: "rose", hot: claim.length > 0 },
    { key: "premium", label: "Premium", fx: "coins" as CardFx, value: sum(rows, (row) => row.premium), money: true, note: "Premium paid", icon: "rupee", tone: "blue" },
    { key: "stamp", label: "Stamp duty", fx: "docs" as CardFx, value: sum(rows, (row) => row.stampDuty), money: true, note: "Stamp duty paid", icon: "doc", tone: "sky" },
  ];

  const card = filter.card === "emd" || filter.card === "tech" ? undefined : CARD_ROWS[filter.card];
  const needle = filter.q.trim().toLowerCase();
  const states = [...new Set(rows.map((row) => row.state).filter(Boolean))].sort();
  const insurers = [...new Set(rows.map((row) => row.insurer).filter(Boolean))].sort();
  const listed = rows
    .filter((row) => !card || card.match(row))
    .filter((row) => !filter.kind || row.kind === filter.kind)
    .filter((row) => !filter.state || row.state === filter.state)
    .filter((row) => !filter.insurer || row.insurer === filter.insurer)
    .filter((row) => !filter.health || row.health === filter.health)
    .filter((row) => EXTRA_FILTERS.every((extra) => !params.get(extra.key) || extra.pick(row) === params.get(extra.key)))
    .filter((row) => !needle || [row.name, row.customer, row.tenderRef, row.tenderDetails, row.bondNumber, row.insurer, row.state, row.status].join(" ").toLowerCase().includes(needle))
    .sort((a, b) =>
      card?.sort === "premium"
        ? (b.premium ?? 0) - (a.premium ?? 0)
        : card?.sort === "stamp"
          ? (b.stampDuty ?? 0) - (a.stampDuty ?? 0)
          : (a.expiry && a.expiry >= today ? a.expiry.getTime() : Infinity) - (b.expiry && b.expiry >= today ? b.expiry.getTime() : Infinity) || (b.amount ?? 0) - (a.amount ?? 0),
    );
  const shown = listed.slice(0, allRows ? listed.length : 12);
  const shownExtras = EXTRA_FILTERS.filter((extra) => added.includes(extra.key) || params.get(extra.key));
  const hiddenExtras = EXTRA_FILTERS.filter((extra) => !shownExtras.includes(extra));
  const optionsFor = (pick: (row: Row) => string, show?: (value: string) => string) =>
    [...new Set(everyBond.map(pick).filter(Boolean))].sort().map((value) => ({ value, label: show ? show(value) : value }));
  const removeExtra = (key: string) => {
    setAdded((list) => list.filter((item) => item !== key));
    setFilter(key, "");
  };
  // Every active filter as a chip with its own remove button.
  const chips = [
    filter.period && filter.period !== "all" ? { key: "period", text: `${byExpiry ? "Expiring" : "Issued"}: ${period.label}` } : null,
    filter.basis ? { key: "basis", text: "Date by: Expiry" } : null,
    card ? { key: "card", text: `Card: ${card.label}` } : null,
    filter.kind ? { key: "kind", text: `Type: ${KIND_LABEL[filter.kind] ?? filter.kind}` } : null,
    filter.state ? { key: "state", text: `State: ${filter.state}` } : null,
    filter.insurer ? { key: "insurer", text: `Insurer: ${filter.insurer}` } : null,
    filter.health ? { key: "health", text: `Expiry: ${HEALTH[filter.health as Health]?.label ?? filter.health}` } : null,
    filter.q ? { key: "q", text: `Search: “${filter.q}”` } : null,
    ...EXTRA_FILTERS.filter((extra) => params.get(extra.key)).map((extra) => ({ key: extra.key, text: `${extra.label}: ${extra.show ? extra.show(params.get(extra.key)!) : params.get(extra.key)}` })),
  ].filter((chip): chip is { key: string; text: string } => Boolean(chip));
  const removeChip = (key: string) => {
    if (key === "q") setDraft("");
    if (key === "basis" && /^(next|rfy)/.test(filter.period)) {
      const next = new URLSearchParams(params);
      next.delete("basis");
      next.delete("period");
      setParams(next, { preventScrollReset: true });
      return;
    }
    setFilter(key, "");
  };
  const activeFilters = chips.length;

  if (everyBond.length === 0) {
    return (
      <div className="dk bonds">
        <section className="dk-hero">
          <PlantArt />
          <div className="dk-hero-text">
            <div className="dk-hi">
              ISB register <span className="wave">🛡️</span>
            </div>
            <h1>Insurance surety bonds</h1>
          </div>
          <div className="dk-hero-tools">
            {toggle}
            {data.canImport ? (
              <button type="button" className={`dk-btn${importing ? " is-on" : ""}`} onClick={() => setImporting((value) => !value)}>
                {importing ? "Close import" : "Import Excel"}
              </button>
            ) : null}
          </div>
        </section>
        {importing ? <ImportPanel onDone={() => void reload()} /> : null}
        <p className="panel muted">No bonds in the register.</p>
      </div>
    );
  }

  return (
    <div className="dk bonds">
      <section className="dk-hero">
        <PlantArt />
        <div className="dk-hero-text">
          <div className="dk-hi">
            ISB register <span className="wave">🛡️</span>
          </div>
          <h1>Insurance surety bonds</h1>
          <nav className="isb-switch" aria-label="Bond type">
            {(
              [
                ["", "All", everyBond.length],
                ["PERFORMANCE", "PBG", everyBond.filter((row) => row.kind === "PERFORMANCE").length],
              ] as const
            ).map(([value, label, count]) => (
              <button key={label} type="button" className={filter.kind === value ? "is-on" : ""} onClick={() => setFilter("kind", value)}>
                {label}
                <small>{count}</small>
              </button>
            ))}
          </nav>
        </div>
        <div className="dk-hero-tools">
          {toggle}
          <PeriodPicker key={byExpiry ? "expiry" : "issued"} value={filter.period || "all"} onChange={(key) => setFilter("period", key)} earliest={earliest} compact align="right" future={byExpiry} />
          {data.canImport ? (
            <>
              <button type="button" className={`dk-btn${uploadingDocs ? " is-on" : ""}`} onClick={() => setUploadingDocs((value) => !value)}>
                {uploadingDocs ? "Close documents" : "Upload documents"}
              </button>
              <button type="button" className={`dk-btn${importing ? " is-on" : ""}`} onClick={() => setImporting((value) => !value)}>
                {importing ? "Close import" : "Import Excel"}
              </button>
            </>
          ) : null}
        </div>
      </section>

      {importing ? <ImportPanel onDone={() => void reload()} /> : null}
      {uploadingDocs ? (
        <section className="dk-panel">
          <header className="dk-panel-head">
            <span className="dk-panel-icon">
              <Icon name="doc" />
            </span>
            <div>
              <h2>Upload ISB copies</h2>
              <p>Choose the scans or a whole folder (like “ISB Copies”). Each file goes to the bond whose number is in its name; files already stored are skipped.</p>
            </div>
          </header>
          <BondDocUploader onDone={() => void reload()} />
        </section>
      ) : null}

      <section className="dk-cards" aria-label="Bond figures">
        {cards.map((item, index) => (
          <FxLink
            key={item.key}
            href={filter.card === item.key ? allHref : cardHref(item.key)}
            fx={item.fx}
            className={`dk-card ${item.tone}${item.hot ? " hot" : ""}${filter.card === item.key ? " is-on" : ""}`}
            style={{ "--i": index } as CSSProperties}
            title={filter.card === item.key ? "Click again to show every bond" : `Show ${CARD_ROWS[item.key].label.toLowerCase()} below`}
          >
            <span className="dk-card-icon">
              <Icon name={item.icon} />
            </span>
            <span className="dk-card-body">
              <span className="dk-card-label">{item.label}</span>
              <b>
                <CountUp value={item.value} money={item.money} duration={1200} delay={200 + index * 70} />
              </b>
              <small>{item.note}</small>
            </span>
            <Icon name="arrow" className="dk-card-arrow" />
            <Icon name={item.icon} className="dk-card-mark" />
          </FxLink>
        ))}
      </section>

      <form
        className="dk-filters"
        aria-label="Filters"
        onSubmit={(event) => {
          event.preventDefault();
          setFilter("q", draft.trim());
        }}
      >
        <div className="dk-filter">
          <span>Date by</span>
          <div className="seg">
            <button
              type="button"
              className={byExpiry ? "" : "is-on"}
              onClick={() => {
                // Forward-only ranges mean nothing for issue dates, so they are cleared with the switch.
                const next = new URLSearchParams(params);
                next.delete("basis");
                if (/^(next|rfy)/.test(filter.period)) next.delete("period");
                setParams(next, { preventScrollReset: true });
              }}
            >
              Issued
            </button>
            <button type="button" className={byExpiry ? "is-on" : ""} onClick={() => setFilter("basis", "expiry")}>
              Expiry
            </button>
          </div>
        </div>
        <div className="dk-filter">
          <span>Bond type</span>
          <div className="seg">
            {[
              ["", "All"],
              ["PERFORMANCE", "PBG"],
            ].map(([value, label]) => (
              <button key={label} type="button" className={filter.kind === value ? "is-on" : ""} onClick={() => setFilter("kind", value)}>
                {label}
              </button>
            ))}
          </div>
        </div>
        <SelectFilter label="State" value={filter.state} allLabel="All states" options={states.map((item) => ({ value: item, label: item }))} onChange={(value) => setFilter("state", value)} />
        <SelectFilter label="Insurer" value={filter.insurer} allLabel="All insurers" options={insurers.map((item) => ({ value: item, label: item }))} onChange={(value) => setFilter("insurer", value)} />
        <SelectFilter
          label="Expiry"
          value={filter.health}
          allLabel="Any expiry"
          options={(Object.keys(HEALTH) as Health[]).map((key) => ({ value: key, label: HEALTH[key].label }))}
          onChange={(value) => setFilter("health", value)}
        />
        {shownExtras.map((extra) => (
          <SelectFilter
            key={extra.key}
            label={extra.label}
            value={params.get(extra.key) ?? ""}
            allLabel={`Any ${extra.label.toLowerCase()}`}
            options={optionsFor(extra.pick, extra.show)}
            onChange={(value) => setFilter(extra.key, value)}
            onRemove={() => removeExtra(extra.key)}
            removable
          />
        ))}
        {hiddenExtras.length ? (
          <div className="dk-filter bonds-add">
            <span>More</span>
            <button type="button" className={`bonds-add-btn${adding ? " is-on" : ""}`} onClick={() => setAdding((value) => !value)} aria-expanded={adding}>
              <Glyph name="plus" />
              Add filter
            </button>
            {adding ? (
              <span className="bonds-add-menu" role="menu">
                {hiddenExtras.map((extra) => (
                  <button
                    key={extra.key}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setAdded((list) => [...list, extra.key]);
                      setAdding(false);
                    }}
                  >
                    <Glyph name="plus" />
                    {extra.label}
                  </button>
                ))}
              </span>
            ) : null}
          </div>
        ) : null}
        <label className="dk-filter dk-search">
          <span>Search</span>
          <span className="dk-search-box">
            <Icon name="search" />
            <input
              type="search"
              placeholder="Plant, customer, tender, bond number…"
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
        {chips.length ? (
          <div className="bonds-chips" aria-label="Active filters">
            {chips.map((chip) => (
              <span key={chip.key} className="bonds-chip">
                {chip.text}
                <button type="button" onClick={() => removeChip(chip.key)} aria-label={`Remove ${chip.text}`} title="Remove this filter">
                  <Glyph name="x" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <div className="dk-showing">
          <p>
            Showing <b>{listed.length}</b> of {everyBond.length} bonds · {inr(sum(listed, (row) => row.amount))}
            {card ? ` · ${card.label}` : ""}
            {period.from ? ` · ${byExpiry ? "expiring" : "issued"} ${period.detail}` : ""}
          </p>
          <button type="button" className="dk-link" onClick={resetFilters} disabled={!activeFilters && !draft}>
            <Icon name="reset" />
            Clear all{activeFilters ? ` (${activeFilters})` : ""}
          </button>
        </div>
      </form>

      <div className="dk-main">
        <section className="dk-panel" id="bond-list">
          <header className="dk-panel-head">
            <span className="dk-panel-icon">
              <Icon name="shield" />
            </span>
            <div>
              <h2>{card?.label ?? "All bonds"}</h2>
              <p>
                {listed.length} bond{listed.length === 1 ? "" : "s"} · {card?.sort === "premium" ? "highest premium first" : "soonest expiry first"} · click a row to open the bond and its ISB copies
              </p>
            </div>
            {card ? (
              <Link className="dk-ghost" to={allHref} preventScrollReset>
                All bonds
              </Link>
            ) : null}
            {listed.length > 12 ? (
              <button type="button" className="dk-ghost" onClick={() => setAllRows((value) => !value)}>
                {allRows ? "Show fewer" : `View all ${listed.length}`}
              </button>
            ) : null}
          </header>
          <div className="dk-table-wrap">
            <table className="dk-table bonds-dk-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Type</th>
                  <th>Plant / customer</th>
                  <th>State</th>
                  <th className="num">Amount</th>
                  <th>Bond number</th>
                  <th>Expiry</th>
                  <th>Status</th>
                  <th className="act">Open</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="dk-empty">
                      No bonds match these filters.
                    </td>
                  </tr>
                ) : null}
                {shown.map((row, index) => {
                  // The bond page gets this board's address so Back returns to the same filters.
                  const open = () => navigate(`/bonds/${row.id}`, { state: { from: `${location.pathname}${location.search}` } });
                  const docs = data.docCounts[row.bondNumber.replace(/\D+/g, "")] ?? 0;
                  return (
                      <tr
                        key={row.id}
                        className={`dk-row bg-row${row.health === "soon" || row.health === "claim" ? " is-late" : ""}`}
                        onClick={open}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") open();
                        }}
                        tabIndex={0}
                        style={{ "--r": Math.min(index, 12) } as CSSProperties}
                      >
                        <td className="muted">{row.serialNo ?? index + 1}</td>
                        <td>
                          <span className={`dk-pill ${row.kind === "EMD" ? "amber" : "violet"}`}>{row.kind === "EMD" ? "EMD" : row.usedFor ? `PBG · ${row.usedFor}` : "PBG"}</span>
                        </td>
                        <td className="dk-title">
                          {row.name || "—"}
                          <small className="muted bonds-ref" title={row.tenderRef}>{row.tenderRef}</small>
                        </td>
                        <td>{row.state || "—"}</td>
                        <td className="num">
                          <b title={inrFull(row.amount)}>{inr(row.amount)}</b>
                        </td>
                        <td>
                          <span className="bonds-number">{row.bondNumber || "—"}</span>
                          {docs ? (
                            <small className="bgdoc-count" title="ISB copies for this bond">
                              ▤ {docs} cop{docs === 1 ? "y" : "ies"}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          {day(row.expiry)}
                          {row.days != null && row.days >= 0 && row.days <= 90 ? <small className={row.days <= 30 ? "text-bad" : "muted"}> · {row.days}d</small> : null}
                          {row.dateCheck ? <small className="text-bad"> · check dates</small> : null}
                        </td>
                        <td>
                          <span className={`dk-pill ${HEALTH[row.health].tone}`}>{HEALTH[row.health].label}</span>
                        </td>
                        <td className="act">
                          <span className="dk-icon-btn" title="Open the bond page" aria-hidden>
                            <Icon name="eye" />
                          </span>
                        </td>
                      </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="dk-side">
          <NextToExpire rows={rows} today={today} search={(query) => `${path}?${[...fixed, `q=${encodeURIComponent(query)}`].join("&")}#bond-list`} />
        </aside>
      </div>

      <div className="bonds-grid">
        <BarList title="Exposure by insurer" note="Performance bonds" icon="rupee" rows={group(rows, (row) => row.insurer)} tone="pb" onPick={(value) => setFilter("insurer", value)} />
      </div>
    </div>
  );
}

function group(list: Row[], pick: (row: Row) => string) {
  const map = new Map<string, { value: number; count: number }>();
  for (const row of list) {
    const key = pick(row) || "Not given";
    const entry = map.get(key) ?? { value: 0, count: 0 };
    entry.value += row.amount ?? 0;
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.entries()].map(([label, value]) => ({ label, ...value })).sort((a, b) => b.value - a.value);
}

/** Upload panel for a register workbook; the bond import is the default. */
export function ImportPanel({
  onDone,
  run = importBondsAction,
  title = "Import the bond workbook",
  note = "Upload the “Performance Bond & EMD ISB Data” .xlsx. Each sheet in the file replaces that part of the register.",
  hint = ".xlsx with an “EMD” and/or “Performance Bond” sheet",
}: {
  onDone: () => void;
  run?: (previous: ActionState, formData: FormData) => Promise<ActionState>;
  title?: string;
  note?: string;
  hint?: string;
}) {
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await run(previous, formData);
    if (result?.ok) onDone();
    return result;
  }, null as ActionState);
  return (
    <section className="dk-panel">
      <header className="dk-panel-head">
        <span className="dk-panel-icon">
          <Icon name="doc" />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{note}</p>
        </div>
      </header>
      <form action={action} className="bonds-import">
        <FilePick name="file" label="Choose the Excel workbook" hint={hint} accept=".xlsx" />
        <Submit>Import Excel</Submit>
        {state?.error ? <p className="banner bad">{state.error}</p> : null}
        {state?.ok ? <p className="banner good">{state.ok}</p> : null}
      </form>
    </section>
  );
}


function NextToExpire({ rows, today, search }: { rows: Row[]; today: Date; search: (query: string) => string }) {
  const upcoming = rows.filter((row) => row.expiry && row.expiry >= today).sort((a, b) => a.expiry!.getTime() - b.expiry!.getTime()).slice(0, 6);
  return (
    <section className="dk-panel">
      <header className="dk-panel-head">
        <span className="dk-panel-icon">
          <Icon name="hourglass" />
        </span>
        <div>
          <h2>Next to expire</h2>
          <p>The bonds expiring soonest</p>
        </div>
      </header>
      {upcoming.length === 0 ? <p className="dk-empty">No upcoming expiries.</p> : null}
      <ul className="dk-deadlines">
        {upcoming.map((row) => (
          <li key={row.id}>
            <Link to={search(row.bondNumber)} className={`dk-deadline ${row.days! <= 30 ? "hot" : row.days! <= 60 ? "warm" : ""}`}>
              <span className="dk-date">
                <b>{row.days}</b>
                <small>days</small>
              </span>
              <span className="dk-deadline-main">
                <strong>{row.name}</strong>
                <small>
                  {row.kind === "EMD" ? "EMD" : `PBG · ${row.usedFor || "—"}`} · {inr(row.amount)}
                </small>
              </span>
              <span className="dk-deadline-end">{day(row.expiry)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function BarList({
  title,
  note,
  icon,
  rows,
  tone,
  onPick,
}: {
  title: string;
  note: string;
  icon: string;
  rows: { label: string; value: number; count: number }[];
  tone: "emd" | "pb";
  onPick: (value: string) => void;
}) {
  const peak = Math.max(1, ...rows.map((row) => row.value));
  return (
    <section className="dk-panel">
      <header className="dk-panel-head">
        <span className="dk-panel-icon">
          <Icon name={icon} />
        </span>
        <div>
          <h2>{title}</h2>
          <p>{note} · click a row to filter the table</p>
        </div>
      </header>
      <ul className="bonds-bars">
        {rows.map((row, index) => (
          <li key={row.label} style={{ "--w": row.value / peak, "--r": index } as CSSProperties}>
            <button
              type="button"
              disabled={row.label === "Not given"}
              onClick={() => {
                onPick(row.label);
                document.getElementById("bond-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
              }}
              title={`${row.label}: ${inrFull(row.value)} · ${row.count} bond${row.count === 1 ? "" : "s"}`}
            >
              <span className="bonds-bar-label">{row.label}</span>
              <span className="bonds-bar-track">
                <i className={tone} />
              </span>
              <b>{inr(row.value)}</b>
              <small>{row.count}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const SPLIT_TONES = ["emd", "violet", "pb", "green"];
export function SplitBar({ rows }: { rows: { label: string; value: number; count: number }[] }) {
  const total = rows.reduce((all, row) => all + row.value, 0) || 1;
  return (
    <div className="bonds-split">
      <span className="bonds-split-bar">
        {rows.map((row, index) => (
          <i key={row.label} className={SPLIT_TONES[index % SPLIT_TONES.length]} style={{ flexGrow: row.value }} title={`${row.label}: ${inrFull(row.value)}`} />
        ))}
      </span>
      <ul>
        {rows.map((row, index) => (
          <li key={row.label}>
            <i className={`sw ${SPLIT_TONES[index % SPLIT_TONES.length]}`} />
            <span>{row.label}</span>
            <b>{inr(row.value)}</b>
            <small>
              {row.count} · {Math.round((row.value / total) * 100)}%
            </small>
          </li>
        ))}
      </ul>
    </div>
  );
}
