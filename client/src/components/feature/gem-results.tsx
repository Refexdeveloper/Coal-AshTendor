import { useEffect, useState } from "react";
import { apiGet } from "@client/api/client";

type GemTable = { title: string; columns: string[]; rows: string[][] };
type GemSection = { title: string; fields: { label: string; value: string }[]; tables: GemTable[] };
type GemResultPage = { kind: string; bidNumber: string; url: string; sections: GemSection[] };
type GemResult = {
  bidNumber: string;
  found: boolean;
  published: boolean;
  status: string;
  endsAt: string;
  statusUrl: string;
  pages: GemResultPage[];
  note: string;
  checkedAt: string | Date;
};

export const GEM_NUMBER = /GEM\/\d{4}\/[BR]\/\d+/i;

export type GemSummary = { gem: boolean; technical: boolean; financial: boolean; status: string };

/** Technical tables are the bid results. Financial tables (prices and L1, L2…) are the price matching. */
export function summariseGem(data: GemResult | null): GemSummary {
  if (!data) return { gem: false, technical: false, financial: false, status: "" };
  const has = (pattern: RegExp) => data.pages.some((page) => page.sections.some((section) => pattern.test(section.title) && section.tables.some((table) => table.rows.length)));
  const financial = has(/financial/i);
  const technical = has(/technical/i) || financial;
  return { gem: true, technical, financial, status: data.status };
}

const sectionTitle = (title: string) => {
  if (/financial/i.test(title)) return "Price matching";
  if (/technical/i.test(title)) return "Bid results";
  return title.toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
};

/** Bid facts worth showing up front; the rest of GeM's bid details stay on GeM. */
const BID_FACTS = ["Bid Status", "Quantity", "Bid Start Date / Time", "Bid End Date / Time", "Bid Opening Date / Time", "Ministry", "Department", "Organisation"];

const tone = (value: string) => {
  const text = value.toLowerCase();
  if (/^l1$|qualified$|awarded|accepted/.test(text) && !/disqualified|not qualified/.test(text)) return "good";
  if (/disqualified|not qualified|rejected|cancel/.test(text)) return "bad";
  return "";
};

function ResultTable({ table }: { table: GemTable }) {
  const statusCol = table.columns.findIndex((column) => /^(status|rank|schedule status)$/i.test(column));
  const qualified = statusCol >= 0 ? table.rows.filter((row) => tone(row[statusCol] ?? "") === "good").length : 0;
  return (
    <div className="gem-res-table">
      <h5>
        {table.title || "Sellers"} <span className="muted">({table.rows.length})</span>
        {statusCol >= 0 && /status/i.test(table.columns[statusCol]) && qualified ? <span className="gem-res-count">{qualified} qualified</span> : null}
      </h5>
      <div className="gem-res-scroll">
        <table>
          {table.columns.length ? (
            <thead>
              <tr>
                {table.columns.map((column, index) => (
                  <th key={index}>{column}</th>
                ))}
              </tr>
            </thead>
          ) : null}
          <tbody>
            {table.rows.map((row, index) => (
              <tr key={index} className={statusCol >= 0 && /^l1$/i.test(row[statusCol] ?? "") ? "is-l1" : ""}>
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={cellIndex === statusCol ? `gem-res-status ${tone(cell)}` : cell.startsWith("₹") ? "gem-res-price" : ""}>
                    {cell || "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * GeM bid results for a tender in the pipeline: the technical evaluation (sellers that took part and who qualified)
 * and the financial evaluation (prices and L1, L2… ranks), read from GeM's public result page.
 */
export function GemResults({ tenderId, gemBidId, onSummary, onlyPublished = false }: { tenderId?: string; gemBidId?: string; onSummary?: (summary: GemSummary) => void; onlyPublished?: boolean }) {
  const [state, setState] = useState<{ loading: boolean; data?: GemResult | null; error?: string }>({ loading: true });
  const load = (refresh = false) => {
    setState((current) => ({ ...current, loading: true, error: undefined }));
    apiGet<GemResult | null>(`${gemBidId ? `/gem-bids/${gemBidId}/result` : `/tenders/${tenderId}/gem-result`}${refresh ? "?refresh=1" : ""}`)
      .then((data) => {
        setState({ loading: false, data });
        onSummary?.(summariseGem(data));
      })
      .catch((error: unknown) => {
        setState({ loading: false, error: error instanceof Error ? error.message : String(error) });
        onSummary?.({ gem: false, technical: false, financial: false, status: "" });
      });
  };
  useEffect(() => load(), [tenderId, gemBidId]); // eslint-disable-line react-hooks/exhaustive-deps

  const data = state.data;
  const summary = data ? summariseGem(data) : null;
  if (onlyPublished && (state.loading || !summary?.technical)) return null;
  if (!state.loading && !state.error && data === null)
    return (
      <section className="gem-res gem-res-none">
        <h3>GeM bid results</h3>
        <span className="muted">Not a GeM tender: no GEM/… bid number on this tender, so there are no GeM results to show.</span>
      </section>
    );
  const checked = data ? new Date(data.checkedAt) : null;

  return (
    <section className="gem-res">
      <header>
        <div>
          <h3>GeM bid results</h3>
          <span className="muted">
            {data?.bidNumber ?? "Looking up the GeM bid…"}
            {checked ? ` · checked ${checked.toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}
          </span>
        </div>
        <div className="gem-res-actions">
          {data?.status ? <span className={`gem-res-pill${data.published ? " good" : ""}`}>{data.status}</span> : null}
          {data?.pages[0] ? (
            <a className="btn ghost" href={data.pages[0].url} target="_blank" rel="noreferrer">
              Open on GeM ↗
            </a>
          ) : null}
          <button type="button" className="btn ghost" onClick={() => load(true)} disabled={state.loading}>
            {state.loading ? "Checking…" : "Check again"}
          </button>
        </div>
      </header>
      {state.error ? <p className="text-bad">GeM could not be read: {state.error}</p> : null}
      {data?.note ? <p className="muted">{data.note}</p> : null}
      {data?.pages.map((page) => {
        const details = page.sections.find((section) => /bid details/i.test(section.title));
        const facts = BID_FACTS.map((label) => details?.fields.find((field) => field.label === label)).filter((field) => field && !/^(\*+|na|n\/a)$/i.test(field.value));
        return (
          <div key={page.url} className="gem-res-page">
            {data.pages.length > 1 ? <h4>{page.kind === "Bid" ? "Bid" : `Reverse auction ${page.bidNumber}`}</h4> : null}
            {facts.length ? (
              <dl className="gem-res-facts">
                {facts.map((field) => (
                  <div key={field!.label}>
                    <dt>{field!.label}</dt>
                    <dd>{field!.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {page.sections
              .filter((section) => section !== details)
              .map((section) => (
                <div key={section.title} className="gem-res-section">
                  <h4>{sectionTitle(section.title)}</h4>
                  {section.tables.length === 0 ? <p className="muted">Nothing published in this step yet.</p> : null}
                  {section.tables.map((table, index) => (
                    <ResultTable key={index} table={table} />
                  ))}
                </div>
              ))}
          </div>
        );
      })}
    </section>
  );
}
