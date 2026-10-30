import { useEffect, useRef, useState } from "react";

/**
 * Period filter: a dropdown with quick picks (Today, MTD, QTD, This FY) and lists of weeks, months and
 * Indian financial years (1 April to 31 March), plus a custom range.
 * The selection is a short key so it fits in the URL: all, today, mtd, qtd, fy, w:2026-10-26, m:2026-10, y:2026, c:2026-01-01:2026-03-31.
 */
export type Period = { key: string; from: Date | null; to: Date | null; label: string; detail: string };

const fmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });
const fmtShort = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });
const fmtMonth = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" });

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const iso = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const fromIso = (value: string) => {
  const [y, m, d] = value.split("-").map(Number);
  return y && m ? new Date(y, m - 1, d || 1) : null;
};

/** First year of the Indian financial year that contains the date (FY 2026–27 → 2026). */
export const fyStartYear = (date: Date) => (date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1);
const fyName = (year: number) => `FY ${year}–${String(year + 1).slice(2)}`;
const monday = (date: Date) => addDays(startOfDay(date), -((date.getDay() + 6) % 7));

/** Range for a key. `to` is exclusive; open periods run to the end of today. */
export function resolvePeriod(key: string, now = new Date()): Period {
  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const range = (from: Date, end: Date) => {
    const to = end > tomorrow ? tomorrow : end;
    const open = end > tomorrow;
    return { from, to, detail: `${fmt.format(from)} → ${open ? "Today" : fmt.format(addDays(to, -1))}` };
  };
  const [kind, a, b] = key.split(":");
  if (kind === "today") return { key, from: today, to: tomorrow, label: "Today", detail: fmt.format(today) };
  if (kind === "mtd") return { key, ...range(new Date(today.getFullYear(), today.getMonth(), 1), tomorrow), label: "Month to date" };
  if (kind === "qtd") {
    const offset = (today.getMonth() - 3 + 12) % 12;
    const from = new Date(fyStartYear(today), 3 + offset - (offset % 3), 1);
    return { key, ...range(from, tomorrow), label: "Quarter to date" };
  }
  if (kind === "fy") {
    const year = fyStartYear(today);
    return { key, ...range(new Date(year, 3, 1), new Date(year + 1, 3, 1)), label: `This FY · ${fyName(year)}` };
  }
  if (kind === "w" && a) {
    const from = fromIso(a);
    if (from) {
      const end = addDays(from, 7);
      return { key, ...range(from, end), label: `Week of ${fmtShort.format(from)}` };
    }
  }
  if (kind === "m" && a) {
    const from = fromIso(a);
    if (from) return { key, ...range(from, new Date(from.getFullYear(), from.getMonth() + 1, 1)), label: fmtMonth.format(from) };
  }
  if (kind === "y" && a) {
    const year = Number(a);
    if (year) return { key, ...range(new Date(year, 3, 1), new Date(year + 1, 3, 1)), label: fyName(year) };
  }
  if (kind === "c" && a && b) {
    const from = fromIso(a);
    const last = fromIso(b);
    if (from && last && last >= from) {
      return { key, from, to: addDays(last, 1), label: `${fmtShort.format(from)} – ${fmt.format(last)}`, detail: "Custom range" };
    }
  }
  return { key: "all", from: null, to: null, label: "All dates", detail: "No date limit" };
}

export function inPeriod(period: Period, date: Date | null | undefined) {
  if (!period.from || !period.to) return true;
  if (!date) return false;
  return date >= period.from && date < period.to;
}

type Tab = "week" | "month" | "year" | "custom";
const TABS: { key: Tab; label: string }[] = [
  { key: "week", label: "Weekly" },
  { key: "month", label: "Monthly" },
  { key: "year", label: "Year" },
  { key: "custom", label: "Custom" },
];
const QUICK = [
  { key: "today", label: "Today" },
  { key: "mtd", label: "MTD" },
  { key: "qtd", label: "QTD" },
  { key: "fy", label: "This FY" },
];

export function PeriodPicker({ value, onChange, earliest }: { value: string; onChange: (key: string) => void; earliest?: Date | null }) {
  const period = resolvePeriod(value);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<Tab>(value.startsWith("w:") ? "week" : value.startsWith("m:") ? "month" : value.startsWith("c:") ? "custom" : "year");
  const [customFrom, setCustomFrom] = useState(period.from ? iso(period.from) : "");
  const [customTo, setCustomTo] = useState(period.to ? iso(addDays(period.to, -1)) : "");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = (key: string) => {
    onChange(key);
    setOpen(false);
  };

  const now = new Date();
  const thisWeek = monday(now);
  const weeks = Array.from({ length: 12 }, (_, i) => addDays(thisWeek, -7 * i));
  const months = Array.from({ length: 12 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - i, 1));
  const currentFy = fyStartYear(now);
  const oldestFy = Math.min(currentFy - 4, earliest ? fyStartYear(earliest) : currentFy);
  const years = Array.from({ length: currentFy - oldestFy + 1 }, (_, i) => currentFy - i);

  const option = (key: string, title: string, badge?: string) => {
    const resolved = resolvePeriod(key);
    return (
      <button type="button" key={key} className={`period-option${value === key ? " is-on" : ""}`} onClick={() => pick(key)}>
        <b>{title}</b>
        <small>{resolved.detail}</small>
        {badge ? <span className="period-badge">{badge}</span> : null}
      </button>
    );
  };

  return (
    <div className="period" ref={box}>
      <span className="period-caption">Period</span>
      <button type="button" className={`period-trigger${open ? " is-open" : ""}`} onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className="period-icon" aria-hidden>
          <svg viewBox="0 0 24 24">
            <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
            <path d="M3.5 10h17M8 3v4M16 3v4" />
          </svg>
        </span>
        <span className="period-value">
          <b>{period.label}</b>
          {period.from ? <small>{period.detail}</small> : null}
        </span>
        <svg className="period-chevron" viewBox="0 0 24 24" aria-hidden>
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open ? (
        <div className="period-panel" role="dialog" aria-label="Choose a period">
          <div className="period-head">
            <span className="period-caption">Choose period type</span>
            {value !== "all" ? (
              <button type="button" className="period-clear" onClick={() => pick("all")}>
                All dates
              </button>
            ) : null}
          </div>
          <div className="period-quick">
            {QUICK.map((item) => (
              <button type="button" key={item.key} className={value === item.key ? "is-on" : ""} onClick={() => pick(item.key)}>
                {item.label}
              </button>
            ))}
          </div>
          <div className="period-tabs" role="tablist">
            {TABS.map((item) => (
              <button type="button" role="tab" aria-selected={tab === item.key} key={item.key} className={tab === item.key ? "is-on" : ""} onClick={() => setTab(item.key)}>
                {item.label}
              </button>
            ))}
          </div>

          {tab === "week" ? (
            <>
              <p className="period-hint">Monday to Sunday · last 12 weeks</p>
              <div className="period-list">
                {weeks.map((start, i) => option(`w:${iso(start)}`, `${fmtShort.format(start)} – ${fmtShort.format(addDays(start, 6))}`, i === 0 ? "This week" : undefined))}
              </div>
            </>
          ) : null}
          {tab === "month" ? (
            <>
              <p className="period-hint">Calendar months · last 12 months</p>
              <div className="period-list">
                {months.map((start, i) => option(`m:${iso(start).slice(0, 7)}`, fmtMonth.format(start), i === 0 ? "Current month" : undefined))}
              </div>
            </>
          ) : null}
          {tab === "year" ? (
            <>
              <p className="period-hint">Indian financial year · 1 April → 31 March next year</p>
              <div className="period-list">{years.map((year) => option(`y:${year}`, fyName(year), year === currentFy ? "Current financial year" : undefined))}</div>
            </>
          ) : null}
          {tab === "custom" ? (
            <form
              className="period-custom"
              onSubmit={(event) => {
                event.preventDefault();
                if (customFrom && customTo && customTo >= customFrom) pick(`c:${customFrom}:${customTo}`);
              }}
            >
              <p className="period-hint">Pick any start and end date (both included)</p>
              <label>
                From
                <input type="date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} required />
              </label>
              <label>
                To
                <input type="date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} required />
              </label>
              <button className="btn" type="submit" disabled={!customFrom || !customTo || customTo < customFrom}>
                Apply range
              </button>
            </form>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
