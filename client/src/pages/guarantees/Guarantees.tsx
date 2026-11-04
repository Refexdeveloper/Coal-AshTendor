import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useApi } from "@client/api/client";
import { importGuaranteesAction } from "@client/api/actions";
import type { BankGuarantee, BgAmendment } from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { CountUp } from "@client/components/feature/count-up";
import { FxLink } from "@client/components/feature/fx-link";
import type { CardFx } from "@client/components/feature/fx";
import { PeriodPicker, inPeriod, resolvePeriod } from "@client/components/feature/period-picker";
import { Icon, PlantArt } from "@client/pages/executive/ExecutiveView";
import { BarList, Glyph, HEALTH, ImportPanel, SelectFilter, SplitBar, day, type Health } from "@client/pages/bonds/Bonds";
import { BgDocUploader } from "./BgDocuments";
import { AddGuaranteeForm } from "./AddGuarantee";
import { inr, inrFull } from "@client/utils/money";

type Data = { guarantees: BankGuarantee[]; docCounts: Record<string, number>; canImport: boolean; canAdd?: boolean; importedAt: Date | null };

const DAY = 864e5;
export const TYPE_TONE: Record<string, string> = { PBG: "violet", APBG: "blue", EMD: "amber" };
export const TYPE_LABEL: Record<string, string> = { PBG: "Performance BG", APBG: "APBG", EMD: "EMD BG" };
export const asDate = (value: string | null | undefined) => (value ? new Date(value) : null);

/** Current figures come from the latest amendment that changed them; the issuance values otherwise. */
export function enrich(bg: BankGuarantee, today: Date) {
  let amendments: BgAmendment[] = [];
  try {
    amendments = (JSON.parse(bg.amendments || "[]") as BgAmendment[]).sort((a, b) => a.no - b.no);
  } catch {
    amendments = [];
  }
  let extra: Record<string, string> = {};
  try {
    extra = bg.extra ? (JSON.parse(bg.extra) as Record<string, string>) : {};
  } catch {
    extra = {};
  }
  const lastWith = <K extends keyof BgAmendment>(field: K) => [...amendments].reverse().find((item) => item[field] != null && item[field] !== "")?.[field] ?? null;
  const amount = (lastWith("amount") as number | null) ?? bg.amount;
  const expiry = asDate(lastWith("expiry") as string | null) ?? bg.expiryDate;
  const claim = asDate(lastWith("claim") as string | null) ?? bg.claimDate ?? expiry;
  const chargesTotal = (bg.charges ?? 0) + amendments.reduce((total, item) => total + (item.charges ?? 0), 0);
  const stampTotal = (bg.stampDuty ?? 0) + amendments.reduce((total, item) => total + (item.stampDuty ?? 0), 0);
  const days = expiry ? Math.ceil((expiry.getTime() - today.getTime()) / DAY) : null;
  const health: Health =
    !expiry ? "unknown" : expiry < today ? (claim && claim >= today ? "claim" : "expired") : days! <= 30 ? "soon" : days! <= 90 ? "watch" : "active";
  return { ...bg, amendmentList: amendments, extraFields: extra, current: { amount, expiry, claim }, chargesTotal, stampTotal, days, health };
}
export type Row = ReturnType<typeof enrich>;

const sum = (rows: Row[], pick: (row: Row) => number | null) => rows.reduce((total, row) => total + (pick(row) ?? 0), 0);

const CARD_ROWS: Record<string, { label: string; match: (row: Row) => boolean; sort?: "charges" | "stamp" }> = {
  total: { label: "All guarantees", match: () => true },
  pbg: { label: "PBG", match: (row) => row.bgType === "PBG" },
  abg: { label: "APBG", match: (row) => row.bgType === "APBG" },
  emd: { label: "EMD bank guarantees", match: (row) => row.bgType === "EMD" },
  active: { label: "Active guarantees", match: (row) => row.health === "active" || row.health === "watch" || row.health === "soon" },
  soon: { label: "Expiring in 30 days", match: (row) => row.health === "soon" },
  watch: { label: "Expiring in 31–90 days", match: (row) => row.health === "watch" },
  claim: { label: "Expired, claim still open", match: (row) => row.health === "claim" },
  amended: { label: "Amended guarantees", match: (row) => row.amendmentList.length > 0 },
  charges: { label: "Charges", match: () => true, sort: "charges" },
  stamp: { label: "Stamp duty", match: () => true, sort: "stamp" },
};

/**
 * The bank guarantee register. `embedded` shows it inside the Group CEO dashboard (at /?board=bg);
 * `toggle` is the Tender | EMD | BG switch for the banner.
 */
export default function GuaranteesPage({ embedded = false, toggle, onlyType }: { embedded?: boolean; toggle?: ReactNode; onlyType?: string } = {}) {
  const path = embedded ? "/" : "/guarantees";
  const boardKey = onlyType === "EMD" ? "emd" : "bg";
  const fixed = embedded ? [`board=${boardKey}`] : [];
  const { data, error, reload } = useApi<Data>("/guarantees");
  const [params, setParams] = useSearchParams();
  const [importing, setImporting] = useState(false);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const [allRows, setAllRows] = useState(false);
  const [draft, setDraft] = useState(params.get("q") ?? "");
  const today = useMemo(() => new Date(), []);
  const everyBg = useMemo(() => {
    const rows = (data?.guarantees ?? []).map((bg) => enrich(bg, today));
    return onlyType ? rows.filter((row) => row.bgType === onlyType) : rows;
  }, [data, today, onlyType]);
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;

  const get = (key: string) => params.get(key) ?? "";
  const filter = { period: get("period"), basis: get("basis"), card: get("card"), type: onlyType ? "" : get("type"), bank: get("bank"), margin: get("margin"), beneficiary: get("beneficiary"), health: get("health"), q: get("q") };
  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value && !(key === "period" && value === "all") && !(key === "basis" && value === "issued")) next.set(key, value);
    else next.delete(key);
    setParams(next, { preventScrollReset: true });
  };
  const resetFilters = () => {
    setDraft("");
    setParams(embedded ? { board: boardKey } : {}, { preventScrollReset: true });
  };

  const byExpiry = filter.basis === "expiry";
  const period = resolvePeriod(filter.period || "all", undefined, { future: byExpiry });
  const rows = everyBg.filter((row) => inPeriod(period, byExpiry ? row.current.expiry : row.issueDate));
  const earliest = everyBg.reduce<Date | null>((min, row) => (row.issueDate && (!min || row.issueDate < min) ? row.issueDate : min), null);
  const keep = [...fixed, ...["period", "basis"].filter((key) => params.get(key)).map((key) => `${key}=${encodeURIComponent(params.get(key)!)}`)];
  const cardHref = (key: string) => `${path}?${[...keep, `card=${key}`].join("&")}#bg-list`;
  const allHref = `${path}${keep.length ? `?${keep.join("&")}` : ""}#bg-list`;

  const pbg = rows.filter((row) => CARD_ROWS.pbg.match(row));
  const abg = rows.filter((row) => CARD_ROWS.abg.match(row));
  const emd = rows.filter((row) => CARD_ROWS.emd.match(row));
  const live = rows.filter((row) => CARD_ROWS.active.match(row));
  const soon = rows.filter((row) => row.health === "soon");
  const watch = rows.filter((row) => row.health === "watch");
  const claim = rows.filter((row) => row.health === "claim");

  const cards = [
    { key: "total", label: "Total", fx: "docs" as CardFx, value: sum(rows, (row) => row.current.amount), money: true, note: `${rows.length} guarantees`, icon: "doc", tone: "teal" },
    { key: "pbg", label: "PBG", fx: "award" as CardFx, value: sum(pbg, (row) => row.amount), money: true, note: `${pbg.length} performance guarantees`, icon: "trophy", tone: "violet" },
    { key: "abg", label: "APBG", fx: "trophy" as CardFx, value: sum(abg, (row) => row.current.amount), money: true, note: `${abg.length} advance guarantees`, icon: "target", tone: "blue" },
    { key: "emd", label: "EMD BGs", fx: "shield" as CardFx, value: sum(emd, (row) => row.current.amount), money: true, note: `${emd.length} guarantees`, icon: "shield", tone: "orange" },
    { key: "active", label: "Active guarantees", fx: "ready" as CardFx, value: live.length, note: inr(sum(live, (row) => row.current.amount)), icon: "check", tone: "green" },
    { key: "soon", label: "Expiring in 30 days", fx: "hourglass" as CardFx, value: soon.length, note: soon.length ? inr(sum(soon, (row) => row.current.amount)) : "Nothing due", icon: "hourglass", tone: "red", hot: soon.length > 0 },
    { key: "watch", label: "Expiring in 90 days", fx: "pending" as CardFx, value: watch.length, note: watch.length ? inr(sum(watch, (row) => row.current.amount)) : "None", icon: "calendar", tone: "sky" },
    { key: "claim", label: "Claim window open", fx: "overdue" as CardFx, value: claim.length, note: claim.length ? inr(sum(claim, (row) => row.current.amount)) : "None open", icon: "clock", tone: "rose", hot: claim.length > 0 },
    { key: "amended", label: "Amended guarantees", fx: "gears" as CardFx, value: rows.filter((row) => row.amendmentList.length).length, note: `${rows.reduce((total, row) => total + row.amendmentList.length, 0)} amendments in all`, icon: "doc", tone: "teal" },
    { key: "charges", label: "Charges", fx: "coins" as CardFx, value: sum(rows, (row) => row.charges), money: true, note: "Issuance charges", icon: "rupee", tone: "blue" },
    { key: "stamp", label: "Stamp duty", fx: "docs" as CardFx, value: sum(rows, (row) => row.stampDuty), money: true, note: "Issuance stamp duty", icon: "doc", tone: "sky" },
  ];

  const card = CARD_ROWS[filter.card];
  const needle = filter.q.trim().toLowerCase();
  const distinct = (pick: (row: Row) => string) => [...new Set(everyBg.map(pick).filter(Boolean))].sort().map((value) => ({ value, label: value }));
  const listed = rows
    .filter((row) => !card || card.match(row))
    .filter((row) => !filter.type || row.bgType === filter.type)
    .filter((row) => !filter.bank || row.bank === filter.bank)
    .filter((row) => !filter.margin || row.marginMoney === filter.margin)
    .filter((row) => !filter.beneficiary || row.beneficiary === filter.beneficiary)
    .filter((row) => !filter.health || row.health === filter.health)
    .filter((row) => !needle || [row.bgNumber, row.beneficiary, row.site, row.loiLoa, row.bank, row.bgType].join(" ").toLowerCase().includes(needle))
    .sort((a, b) =>
      card?.sort === "charges"
        ? (b.charges ?? 0) - (a.charges ?? 0)
        : card?.sort === "stamp"
          ? (b.stampDuty ?? 0) - (a.stampDuty ?? 0)
          : (a.current.expiry && a.current.expiry >= today ? a.current.expiry.getTime() : Infinity) - (b.current.expiry && b.current.expiry >= today ? b.current.expiry.getTime() : Infinity) ||
            (b.current.amount ?? 0) - (a.current.amount ?? 0),
    );
  const shown = listed.slice(0, allRows ? listed.length : 12);

  const chips = [
    filter.period && filter.period !== "all" ? { key: "period", text: `${byExpiry ? "Expiring" : "Issued"}: ${period.label}` } : null,
    filter.basis ? { key: "basis", text: "Date by: Expiry" } : null,
    card ? { key: "card", text: `Card: ${card.label}` } : null,
    filter.type ? { key: "type", text: `Type: ${filter.type}` } : null,
    filter.bank ? { key: "bank", text: `Bank: ${filter.bank}` } : null,
    filter.margin ? { key: "margin", text: `Margin: ${filter.margin}` } : null,
    filter.beneficiary ? { key: "beneficiary", text: `Beneficiary: ${filter.beneficiary}` } : null,
    filter.health ? { key: "health", text: `Expiry: ${HEALTH[filter.health as Health]?.label ?? filter.health}` } : null,
    filter.q ? { key: "q", text: `Search: “${filter.q}”` } : null,
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

  return (
    <div className="dk bonds">
      <section className="dk-hero">
        <PlantArt />
        <div className="dk-hero-text">
          <div className="dk-hi">
            {onlyType === "EMD" ? "EMD from the BG register" : "Bank guarantee register"} <span className="wave">{onlyType === "EMD" ? "🛡️" : "🏦"}</span>
          </div>
          <h1>{onlyType === "EMD" ? "EMD bank guarantees" : "Bank guarantees"}</h1>
        </div>
        <div className="dk-hero-tools">
          {toggle}
          <PeriodPicker key={byExpiry ? "expiry" : "issued"} value={filter.period || "all"} onChange={(value) => setFilter("period", value)} earliest={earliest} compact align="right" future={byExpiry} />
          {data.canAdd || data.canImport ? (
            <button type="button" className={`dk-btn${adding ? " is-on" : ""}`} onClick={() => setAdding((value) => !value)}>
              {adding ? "Close" : "Add BG"}
            </button>
          ) : null}
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

      {adding ? (
        <AddGuaranteeForm
          defaultType={onlyType}
          onDone={() => {
            setAdding(false);
            void reload();
          }}
        />
      ) : null}

      {importing ? (
        <ImportPanel
          onDone={() => void reload()}
          run={importGuaranteesAction}
          title="Import the BG workbook"
          note="Upload the BG register .xlsx (the “BG Template” sheet). It replaces every bank guarantee in the register, amendments included."
          hint=".xlsx with a sheet whose header has “BG Type” and “BG Number”"
        />
      ) : null}

      {uploadingDocs ? (
        <section className="dk-panel">
          <header className="dk-panel-head">
            <span className="dk-panel-icon">
              <Icon name="doc" />
            </span>
            <div>
              <h2>Upload BG documents</h2>
              <p>Choose the scans or a whole folder (like “RIL BG - dump”). Each file goes to the BG whose number starts its name; files already stored are skipped.</p>
            </div>
          </header>
          <BgDocUploader onDone={() => void reload()} />
        </section>
      ) : null}

      <section className="dk-cards" aria-label="Bank guarantee figures">
        {cards.filter((item) => onlyType !== "EMD" || (item.key !== "pbg" && item.key !== "abg")).map((item, index) => (
          <FxLink
            key={item.key}
            href={filter.card === item.key ? allHref : cardHref(item.key)}
            fx={item.fx}
            className={`dk-card ${item.tone}${item.hot ? " hot" : ""}${filter.card === item.key ? " is-on" : ""}`}
            style={{ "--i": index } as CSSProperties}
            title={filter.card === item.key ? "Click again to show every guarantee" : `Show ${CARD_ROWS[item.key].label.toLowerCase()} below`}
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
            <button type="button" className={byExpiry ? "" : "is-on"} onClick={() => removeChip("basis")}>
              Issued
            </button>
            <button type="button" className={byExpiry ? "is-on" : ""} onClick={() => setFilter("basis", "expiry")}>
              Expiry
            </button>
          </div>
        </div>
        {onlyType ? null : (
        <div className="dk-filter">
          <span>BG type</span>
          <div className="seg">
            {["", "PBG", "APBG", "EMD"].map((value) => (
              <button key={value || "all"} type="button" className={filter.type === value ? "is-on" : ""} onClick={() => setFilter("type", value)}>
                {value || "All"}
              </button>
            ))}
          </div>
        </div>
        )}
        <SelectFilter label="Bank" value={filter.bank} allLabel="All banks" options={distinct((row) => row.bank)} onChange={(value) => setFilter("bank", value)} />
        <SelectFilter label="Margin money" value={filter.margin} allLabel="Any margin" options={distinct((row) => row.marginMoney)} onChange={(value) => setFilter("margin", value)} />
        <SelectFilter label="Beneficiary" value={filter.beneficiary} allLabel="All beneficiaries" options={distinct((row) => row.beneficiary)} onChange={(value) => setFilter("beneficiary", value)} />
        <SelectFilter
          label="Expiry"
          value={filter.health}
          allLabel="Any expiry"
          options={(Object.keys(HEALTH) as Health[]).map((key) => ({ value: key, label: HEALTH[key].label }))}
          onChange={(value) => setFilter("health", value)}
        />
        <label className="dk-filter dk-search">
          <span>Search</span>
          <span className="dk-search-box">
            <Icon name="search" />
            <input
              type="search"
              placeholder="BG number, beneficiary, site, LOI/LOA…"
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
            Showing <b>{listed.length}</b> of {everyBg.length} guarantees · {inr(sum(listed, (row) => row.current.amount))}
            {period.from ? ` · ${byExpiry ? "expiring" : "issued"} ${period.detail}` : ""}
          </p>
          <button type="button" className="dk-link" onClick={resetFilters} disabled={!chips.length && !draft}>
            <Icon name="reset" />
            Clear all{chips.length ? ` (${chips.length})` : ""}
          </button>
        </div>
      </form>

      <div className="dk-main">
        <section className="dk-panel" id="bg-list">
          <header className="dk-panel-head">
            <span className="dk-panel-icon">
              <Icon name="shield" />
            </span>
            <div>
              <h2>{card?.label ?? (onlyType === "EMD" ? "EMD bank guarantees" : "All bank guarantees")}</h2>
              <p>
                {listed.length} guarantee{listed.length === 1 ? "" : "s"} · {card?.sort === "charges" ? "highest charges first" : card?.sort === "stamp" ? "highest stamp duty first" : "soonest expiry first"} · click a row to open its full details
              </p>
            </div>
            {card ? (
              <Link className="dk-ghost" to={allHref} preventScrollReset>
                All guarantees
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
                  <th>Beneficiary / site</th>
                  <th>Bank</th>
                  <th className="num">Current amount</th>
                  <th>BG number</th>
                  <th>Expiry</th>
                  <th>Status</th>
                  <th className="act">Open</th>
                </tr>
              </thead>
              <tbody>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="dk-empty">
                      No guarantees match these filters.
                    </td>
                  </tr>
                ) : null}
                {shown.map((row, index) => {
                  // The detail page gets the board's address so Back returns to the same filters.
                  const open = () => navigate(`/guarantees/${row.id}`, { state: { from: `${location.pathname}${location.search}` } });
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
                          <span className={`dk-pill ${TYPE_TONE[row.bgType] ?? ""}`}>{row.bgType || "—"}</span>
                        </td>
                        <td className="dk-title">
                          {row.beneficiary || "—"}
                          <small className="muted bonds-ref" title={row.site}>
                            {row.site}
                          </small>
                        </td>
                        <td>
                          {row.bank || "—"}
                          <small className="muted bonds-ref">{row.marginMoney}</small>
                        </td>
                        <td className="num">
                          <b title={inrFull(row.current.amount)}>{inr(row.current.amount)}</b>
                          {row.amendmentList.length ? <small className="muted bonds-ref">{row.amendmentList.length} amendment{row.amendmentList.length === 1 ? "" : "s"}</small> : null}
                        </td>
                        <td>
                          <span className="bonds-number">{row.bgNumber || "—"}</span>
                          {data.docCounts[row.bgNumber.replace(/\s+/g, "").toUpperCase()] ? (
                            <small className="bgdoc-count" title="Scanned documents for this BG">
                              ▤ {data.docCounts[row.bgNumber.replace(/\s+/g, "").toUpperCase()]} document{data.docCounts[row.bgNumber.replace(/\s+/g, "").toUpperCase()] === 1 ? "" : "s"}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          {day(row.current.expiry)}
                          {row.days != null && row.days >= 0 && row.days <= 90 ? <small className={row.days <= 30 ? "text-bad" : "muted"}> · {row.days}d</small> : null}
                        </td>
                        <td>
                          <span className={`dk-pill ${HEALTH[row.health].tone}`}>{HEALTH[row.health].label}</span>
                        </td>
                        <td className="act">
                          <span className="dk-icon-btn" title="Open the full details" aria-hidden>
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
          <NextToExpire rows={rows} today={today} search={(query) => `${path}?${[...fixed, `q=${encodeURIComponent(query)}`].join("&")}#bg-list`} />
          <section className="dk-panel">
            <header className="dk-panel-head">
              <span className="dk-panel-icon">
                <Icon name="target" />
              </span>
              <div>
                <h2>By BG type</h2>
                <p>Current value of each kind of guarantee</p>
              </div>
            </header>
            <SplitBar rows={group(rows, (row) => TYPE_LABEL[row.bgType] ?? row.bgType)} />
            <h3 className="bonds-sub">By margin money</h3>
            <SplitBar rows={group(rows, (row) => row.marginMoney)} />
          </section>
        </aside>
      </div>

      <div className="bonds-grid">
        <BarList title="Exposure by bank" note="Current value of guarantees with each bank" icon="rupee" rows={group(rows, (row) => row.bank)} tone="pb" onPick={(value) => pick("bank", value)} />
        <BarList title="Exposure by beneficiary" note="Who the guarantees are in favour of" icon="shield" rows={group(rows, (row) => row.beneficiary)} tone="emd" onPick={(value) => pick("beneficiary", value)} />
      </div>
    </div>
  );

  function pick(key: string, value: string) {
    setFilter(key, value);
    document.getElementById("bg-list")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function group(list: Row[], pick: (row: Row) => string) {
  const map = new Map<string, { value: number; count: number }>();
  for (const row of list) {
    const key = pick(row) || "Not given";
    const entry = map.get(key) ?? { value: 0, count: 0 };
    entry.value += row.current.amount ?? 0;
    entry.count += 1;
    map.set(key, entry);
  }
  return [...map.entries()].map(([label, value]) => ({ label, ...value })).sort((a, b) => b.value - a.value);
}

export const pct = (value: number | null) => (value == null ? "—" : `${value}%`);

function NextToExpire({ rows, today, search }: { rows: Row[]; today: Date; search: (query: string) => string }) {
  const upcoming = rows.filter((row) => row.current.expiry && row.current.expiry >= today).sort((a, b) => a.current.expiry!.getTime() - b.current.expiry!.getTime()).slice(0, 6);
  return (
    <section className="dk-panel">
      <header className="dk-panel-head">
        <span className="dk-panel-icon">
          <Icon name="hourglass" />
        </span>
        <div>
          <h2>Next to expire</h2>
          <p>The guarantees expiring soonest</p>
        </div>
      </header>
      {upcoming.length === 0 ? <p className="dk-empty">No upcoming expiries.</p> : null}
      <ul className="dk-deadlines">
        {upcoming.map((row) => (
          <li key={row.id}>
            <Link to={search(row.bgNumber)} className={`dk-deadline ${row.days! <= 30 ? "hot" : row.days! <= 60 ? "warm" : ""}`}>
              <span className="dk-date">
                <b>{row.days}</b>
                <small>days</small>
              </span>
              <span className="dk-deadline-main">
                <strong>{row.beneficiary}</strong>
                <small>
                  {row.bgType} · {row.bank} · {inr(row.current.amount)}
                </small>
              </span>
              <span className="dk-deadline-end">{day(row.current.expiry)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
