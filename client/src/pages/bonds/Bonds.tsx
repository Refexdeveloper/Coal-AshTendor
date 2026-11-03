import { Fragment, useActionState, useMemo, useState, type CSSProperties } from "react";
import { Link, useSearchParams } from "react-router-dom";
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

type Data = { bonds: SuretyBond[]; canImport: boolean; importedAt: Date | null };

const DAY = 864e5;

/** Health of a bond today, from its latest expiry and claim dates (extensions included). */
type Health = "expired" | "claim" | "soon" | "watch" | "active" | "unknown";
const HEALTH: Record<Health, { label: string; tone: string }> = {
  expired: { label: "Claim period over", tone: "" },
  claim: { label: "Expired · claim open", tone: "red" },
  soon: { label: "Expires ≤ 30 days", tone: "amber" },
  watch: { label: "Expires ≤ 90 days", tone: "blue" },
  active: { label: "Active", tone: "green" },
  unknown: { label: "No expiry date", tone: "" },
};

const latest = (...dates: (Date | null)[]) => dates.reduce<Date | null>((best, date) => (date && (!best || date > best) ? date : best), null);

function enrich(bond: SuretyBond, today: Date) {
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
type Row = ReturnType<typeof enrich>;

const day = (date: Date | null) =>
  date ? new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(date) : "—";
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
const monthLabel = (key: string) => {
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", { month: "short", year: "2-digit" }).format(new Date(year, month - 1, 1));
};
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

const KIND_LABEL: Record<string, string> = { EMD: "EMD", PERFORMANCE: "Performance" };

function Glyph({ name }: { name: "plus" | "x" }) {
  return (
    <svg className="bonds-glyph" viewBox="0 0 24 24" aria-hidden>
      {name === "plus" ? <path d="M12 5v14M5 12h14" /> : <path d="M6 6l12 12M18 6 6 18" />}
    </svg>
  );
}

/** A filter select with a remove button once it has a value (or always, for an added filter). */
function SelectFilter({
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
const CARD_ROWS: Record<string, { label: string; match: (row: Row) => boolean; sort?: "premium" | "amount" }> = {
  emd: { label: "EMD surety bonds", match: (row) => row.kind === "EMD" },
  pb: { label: "Performance bonds", match: (row) => row.kind === "PERFORMANCE" },
  active: { label: "Active bonds", match: (row) => row.health === "active" || row.health === "watch" || row.health === "soon" },
  soon: { label: "Expiring in 30 days", match: (row) => row.health === "soon" },
  watch: { label: "Expiring in 31–90 days", match: (row) => row.health === "watch" },
  claim: { label: "Expired, claim still open", match: (row) => row.health === "claim" },
  tech: { label: "EMD under technical evaluation", match: (row) => row.kind === "EMD" && /technical/i.test(row.status) },
  premium: { label: "Bonds by premium paid", match: () => true, sort: "premium" },
};

export default function BondsPage() {
  const { data, error, reload } = useApi<Data>("/bonds");
  const [params, setParams] = useSearchParams();
  const [importing, setImporting] = useState(false);
  const [openRow, setOpenRow] = useState<string | null>(null);
  const [allRows, setAllRows] = useState(false);
  const [draft, setDraft] = useState(params.get("q") ?? "");
  const [added, setAdded] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const today = useMemo(() => new Date(), []);
  const everyBond = useMemo(() => (data?.bonds ?? []).map((bond) => enrich(bond, today)), [data, today]);
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
    setParams({}, { preventScrollReset: true });
  };
  // The period scopes the whole page (cards, charts and table), by issue date or by expiry date.
  const byExpiry = filter.basis === "expiry";
  // Expiries lie ahead, so the expiry view offers future ranges and does not stop at today.
  const period = resolvePeriod(filter.period || "all", undefined, { future: byExpiry });
  const rows = everyBond.filter((row) => inPeriod(period, byExpiry ? row.expiry : row.issueDate));
  const earliest = everyBond.reduce<Date | null>((min, row) => (row.issueDate && (!min || row.issueDate < min) ? row.issueDate : min), null);
  const keep = ["period", "basis"].filter((key) => params.get(key)).map((key) => `${key}=${encodeURIComponent(params.get(key)!)}`);
  const cardHref = (key: string) => `/bonds?${[...keep, `card=${key}`].join("&")}#bond-list`;
  const allHref = `/bonds${keep.length ? `?${keep.join("&")}` : ""}#bond-list`;

  const emd = rows.filter((row) => row.kind === "EMD");
  const pb = rows.filter((row) => row.kind === "PERFORMANCE");
  const soon = rows.filter((row) => row.health === "soon");
  const watch = rows.filter((row) => row.health === "watch");
  const claim = rows.filter((row) => row.health === "claim");
  const live = rows.filter((row) => CARD_ROWS.active.match(row));
  const tech = emd.filter((row) => CARD_ROWS.tech.match(row));
  const checks = rows.filter((row) => row.dateCheck);

  const cards = [
    { key: "emd", label: "EMD exposure", fx: "shield" as CardFx, value: sum(emd, (row) => row.amount), money: true, note: `${emd.length} insurance surety bonds`, icon: "shield", tone: "orange" },
    { key: "pb", label: "Performance bonds", fx: "award" as CardFx, value: sum(pb, (row) => row.amount), money: true, note: `${pb.length} bonds · ${pb.filter((row) => row.usedFor === "APS").length} APS`, icon: "trophy", tone: "violet" },
    { key: "active", label: "Active bonds", fx: "ready" as CardFx, value: live.length, note: inr(sum(live, (row) => row.amount)), icon: "check", tone: "green" },
    { key: "soon", label: "Expiring in 30 days", fx: "hourglass" as CardFx, value: soon.length, note: soon.length ? inr(sum(soon, (row) => row.amount)) : "Nothing due", icon: "hourglass", tone: "red", hot: soon.length > 0 },
    { key: "watch", label: "Expiring in 90 days", fx: "pending" as CardFx, value: watch.length, note: watch.length ? inr(sum(watch, (row) => row.amount)) : "None", icon: "calendar", tone: "sky" },
    { key: "claim", label: "Claim window open", fx: "overdue" as CardFx, value: claim.length, note: claim.length ? "Expired, still claimable" : "None open", icon: "clock", tone: "rose", hot: claim.length > 0 },
    { key: "tech", label: "Technical evaluation", fx: "target" as CardFx, value: tech.length, note: `${emd.length - tech.length} other EMD bonds`, icon: "target", tone: "teal" },
    { key: "premium", label: "Premium + stamp duty", fx: "coins" as CardFx, value: sum(rows, (row) => row.premium) + sum(rows, (row) => row.stampDuty), money: true, note: "Paid across all bonds", icon: "rupee", tone: "blue" },
  ];

  const card = CARD_ROWS[filter.card];
  const needle = filter.q.trim().toLowerCase();
  const states = [...new Set(emd.map((row) => row.state).filter(Boolean))].sort();
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

  return (
    <div className="dk bonds">
      <section className="dk-hero">
        <PlantArt />
        <div className="dk-hero-text">
          <div className="dk-hi">
            EMD &amp; bond register <span className="wave">🛡️</span>
          </div>
          <h1>Surety &amp; performance bonds</h1>
          <p>
            {everyBond.length
              ? `${emd.length} EMD bonds · ${pb.length} performance bonds${period.from ? ` ${byExpiry ? "expiring" : "issued"} ${period.detail}` : ""}${data.importedAt ? ` · updated ${day(data.importedAt)} from ${everyBond[0].sourceFile || "the bond workbook"}` : ""}`
              : "No bonds yet. Import the bond workbook to fill the register."}
          </p>
        </div>
        <div className="dk-hero-tools">
          <PeriodPicker key={byExpiry ? "expiry" : "issued"} value={filter.period || "all"} onChange={(key) => setFilter("period", key)} earliest={earliest} compact align="right" future={byExpiry} />
          {data.canImport ? (
            <button type="button" className={`dk-btn${importing ? " is-on" : ""}`} onClick={() => setImporting((value) => !value)}>
              {importing ? "Close import" : "Import Excel"}
            </button>
          ) : null}
        </div>
      </section>

      {importing ? <ImportPanel onDone={() => void reload()} /> : null}

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

      {checks.length ? (
        <p className="banner warn">
          {checks.length} bond{checks.length === 1 ? " has" : "s have"} an issue date after the expiry date in the workbook ({checks.map((row) => `${row.kind === "EMD" ? "EMD" : "PB"} #${row.serialNo ?? "?"}`).join(", ")}). Check those dates in the sheet.
        </p>
      ) : null}

      <Timeline rows={rows} today={today} />

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
              ["EMD", "EMD"],
              ["PERFORMANCE", "Performance"],
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
                {listed.length} bond{listed.length === 1 ? "" : "s"} · {card?.sort === "premium" ? "highest premium first" : "soonest expiry first"} · click a row for every date and charge
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
                  <th className="act">Details</th>
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
                  const open = openRow === row.id;
                  return (
                    <Fragment key={row.id}>
                      <tr className={`dk-row${open ? " is-open" : ""}${row.health === "soon" || row.health === "claim" ? " is-late" : ""}`} onClick={() => setOpenRow(open ? null : row.id)} style={{ "--r": Math.min(index, 12) } as CSSProperties}>
                        <td className="muted">{row.serialNo ?? index + 1}</td>
                        <td>
                          <span className={`dk-pill ${row.kind === "EMD" ? "amber" : "violet"}`}>{row.kind === "EMD" ? "EMD" : row.usedFor ? `PB · ${row.usedFor}` : "PB"}</span>
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
                        </td>
                        <td>
                          {day(row.expiry)}
                          {row.days != null && row.days >= 0 && row.days <= 90 ? <small className={row.days <= 30 ? "text-bad" : "muted"}> · {row.days}d</small> : null}
                          {row.dateCheck ? <small className="text-bad"> · check dates</small> : null}
                        </td>
                        <td>
                          <span className={`dk-pill ${HEALTH[row.health].tone}`}>{HEALTH[row.health].label}</span>
                        </td>
                        <td className="act" onClick={(event) => event.stopPropagation()}>
                          <button type="button" className={`dk-icon-btn${open ? " is-on" : ""}`} onClick={() => setOpenRow(open ? null : row.id)} title={open ? "Hide details" : "Show every date and charge"} aria-expanded={open}>
                            <Icon name="chevron" />
                          </button>
                        </td>
                      </tr>
                      {open ? (
                        <tr className="dk-detail-row">
                          <td colSpan={9}>
                            <BondDetail row={row} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="dk-side">
          <NextToExpire rows={rows} today={today} />
          <section className="dk-panel">
            <header className="dk-panel-head">
              <span className="dk-panel-icon">
                <Icon name="target" />
              </span>
              <div>
                <h2>EMD by status</h2>
                <p>Where each tender's EMD bond stands</p>
              </div>
            </header>
            <SplitBar rows={group(emd, (row) => row.status)} />
            <h3 className="bonds-sub">By business line</h3>
            <SplitBar rows={group(emd, (row) => (row.line === "COAL" ? "Coal" : row.line === "ASH" ? "Ash" : ""))} />
          </section>
        </aside>
      </div>

      <div className="bonds-grid">
        <BarList title="EMD exposure by state" note="Value of EMD bonds in each state" icon="shield" rows={group(emd, (row) => row.state)} tone="emd" onPick={(value) => setFilter("state", value)} />
        <BarList title="Exposure by insurer" note="EMD and performance bonds together" icon="rupee" rows={group(rows, (row) => row.insurer)} tone="pb" onPick={(value) => setFilter("insurer", value)} />
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

function ImportPanel({ onDone }: { onDone: () => void }) {
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await importBondsAction(previous, formData);
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
          <h2>Import the bond workbook</h2>
          <p>Upload the “Performance Bond &amp; EMD ISB Data” .xlsx. Each sheet in the file replaces that part of the register.</p>
        </div>
      </header>
      <form action={action} className="bonds-import">
        <FilePick name="file" label="Choose the Excel workbook" hint=".xlsx with an “EMD” and/or “Performance Bond” sheet" accept=".xlsx" />
        <Submit>Import Excel</Submit>
        {state?.error ? <p className="banner bad">{state.error}</p> : null}
        {state?.ok ? <p className="banner good">{state.ok}</p> : null}
      </form>
    </section>
  );
}

function BondDetail({ row }: { row: Row }) {
  const facts: [string, string][] = [
    ["Customer", row.customer || "—"],
    ["Tender", row.tenderRef || "—"],
    ["Insurer", row.insurer || "—"],
    ["Broker", row.broker || "—"],
    ["Bond number", row.bondNumber || "—"],
    ["Amount", inrFull(row.amount)],
    ["Issued", day(row.issueDate)],
    ["Start", day(row.startDate)],
    ["Expiry", day(row.expiryDate)],
    ["Claim expiry", day(row.claimExpiryDate)],
    ...(row.ext1IssueDate || row.ext1ExpiryDate
      ? ([
          ["Extension 1 issued", day(row.ext1IssueDate)],
          ["Extension 1 expiry", day(row.ext1ExpiryDate)],
          ["Extension 1 claim", day(row.ext1ClaimDate)],
        ] as [string, string][])
      : []),
    ...(row.ext2Date ? ([["Extension 2", day(row.ext2Date)], ["Extension 2 claim", day(row.ext2ClaimDate)]] as [string, string][]) : []),
    ["Premium", `${inrFull(row.premium)}${row.premiumPercent != null ? ` (${row.premiumPercent}%)` : ""}`],
    ["Stamp duty", inrFull(row.stampDuty)],
    ...(row.kind === "EMD"
      ? ([
          ["Mode", row.mode || "—"],
          ["Transfer", row.transferType || "—"],
          ["Tender status", row.status || "—"],
          ["Line", row.line === "COAL" ? "Coal" : row.line === "ASH" ? "Ash" : "—"],
          ...(row.onlineAmount ? ([["Online part", inrFull(row.onlineAmount)]] as [string, string][]) : []),
        ] as [string, string][])
      : ([["Used for", row.usedFor === "APS" ? "APS (additional performance security)" : row.usedFor === "PS" ? "PS (performance security)" : row.usedFor || "—"]] as [string, string][])),
  ];
  return (
    <div className="bonds-detail-box">
      {row.tenderDetails ? <p className="bonds-detail-text">{row.tenderDetails}</p> : null}
      <dl>
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function Timeline({ rows, today }: { rows: Row[]; today: Date }) {
  if (!rows.length) return null;
  // Value expiring per month for the next 12 months, split by kind; earlier ones fold into "Expired".
  const horizon = Array.from({ length: 12 }, (_, index) => monthKey(new Date(today.getFullYear(), today.getMonth() + index, 1)));
  const buckets = new Map<string, { emd: number; pb: number; count: number }>([["expired", { emd: 0, pb: 0, count: 0 }], ...horizon.map((key) => [key, { emd: 0, pb: 0, count: 0 }] as const), ["later", { emd: 0, pb: 0, count: 0 }]]);
  for (const row of rows) {
    if (!row.expiry) continue;
    const key = row.expiry < today ? "expired" : horizon.includes(monthKey(row.expiry)) ? monthKey(row.expiry) : "later";
    const bucket = buckets.get(key)!;
    bucket[row.kind === "EMD" ? "emd" : "pb"] += row.amount ?? 0;
    bucket.count += 1;
  }
  const timeline = [...buckets.entries()].map(([key, value]) => ({ key, label: key === "expired" ? "Expired" : key === "later" ? "Later" : monthLabel(key), ...value }));
  const peak = Math.max(1, ...timeline.map((bucket) => bucket.emd + bucket.pb));
  return (
    <section className="dk-panel">
      <header className="dk-panel-head">
        <span className="dk-panel-icon">
          <Icon name="calendar" />
        </span>
        <div>
          <h2>Expiry timeline</h2>
          <p>Bond value by the month it expires, using the latest extension · hover a bar for the figures</p>
        </div>
        <span className="bonds-legend">
          <span>
            <i className="sw emd" /> EMD
          </span>
          <span>
            <i className="sw pb" /> Performance
          </span>
        </span>
      </header>
      <div className="bonds-timeline" role="table" aria-label="Bond value by expiry month">
        {timeline.map((bucket, index) => {
          const total = bucket.emd + bucket.pb;
          return (
            <div key={bucket.key} className={`bonds-col ${bucket.key === "expired" ? "past" : ""}`} role="row" tabIndex={0} style={{ "--r": index } as CSSProperties} aria-label={`${bucket.label}: EMD ${inrFull(bucket.emd)}, performance ${inrFull(bucket.pb)}`}>
              <span className="bonds-tip" role="tooltip">
                <b>{bucket.label}</b>
                <span>
                  <i className="sw emd" /> EMD {inr(bucket.emd)}
                </span>
                <span>
                  <i className="sw pb" /> Performance {inr(bucket.pb)}
                </span>
                <span>
                  {bucket.count} bond{bucket.count === 1 ? "" : "s"}
                </span>
              </span>
              <span className="bonds-value">{total ? inr(total) : ""}</span>
              <span className="bonds-stack" style={{ "--h": total / peak } as CSSProperties}>
                {bucket.pb ? <i className="pb" style={{ flexGrow: bucket.pb }} /> : null}
                {bucket.emd ? <i className="emd" style={{ flexGrow: bucket.emd }} /> : null}
              </span>
              <span className="bonds-month">{bucket.label}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function NextToExpire({ rows, today }: { rows: Row[]; today: Date }) {
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
            <Link to={`/bonds?q=${encodeURIComponent(row.bondNumber)}#bond-list`} className={`dk-deadline ${row.days! <= 30 ? "hot" : row.days! <= 60 ? "warm" : ""}`}>
              <span className="dk-date">
                <b>{row.days}</b>
                <small>days</small>
              </span>
              <span className="dk-deadline-main">
                <strong>{row.name}</strong>
                <small>
                  {row.kind === "EMD" ? "EMD" : `Performance · ${row.usedFor || "—"}`} · {inr(row.amount)}
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

function BarList({
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
function SplitBar({ rows }: { rows: { label: string; value: number; count: number }[] }) {
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
