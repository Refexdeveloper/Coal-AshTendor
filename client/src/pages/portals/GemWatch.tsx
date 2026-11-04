import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatWhen } from "@client/utils/calendar";
import type { Portal } from "@client/lib/types";

export type GemBid = {
  id: string;
  bidId: string;
  bidNumber: string;
  title: string;
  ministry: string;
  department: string;
  bidType: number | null;
  quantity: number | null;
  startAt: Date | null;
  endAt: Date | null;
  keyword: string;
  status: "NEW" | "IMPORTED" | "IGNORED" | "EXCLUDED" | "FAILED";
  tenderId: string;
  error: string;
  firstSeenAt: Date;
};
type GemRun = { id: string; startedAt: Date; finishedAt: Date | null; status: string; discovered: number; errorSummary: string };
export type GemData = {
  portal: Portal & { excludeWords: string; autoImport: boolean; maxPages: number; maxImports: number };
  runs: GemRun[];
  bids: GemBid[];
  tenders: { id: string; recordId: string; overallStatus: string }[];
  running: boolean;
  progress: { startedAt: Date; keywords: number; done: number; active: string[]; pages: number; checked: number; matched: number; imported: number } | null;
};

const STATUS: Record<GemBid["status"], { label: string; tone: string }> = {
  NEW: { label: "To review", tone: "warn" },
  IMPORTED: { label: "Imported", tone: "good" },
  IGNORED: { label: "Ignored", tone: "neutral" },
  EXCLUDED: { label: "Excluded", tone: "neutral" },
  FAILED: { label: "Failed", tone: "bad" },
};
const TABS: [string, string][] = [
  ["NEW", "To review"],
  ["IMPORTED", "Imported"],
  ["FAILED", "Failed"],
  ["EXCLUDED", "Excluded"],
  ["IGNORED", "Ignored"],
  ["", "All"],
];
const RUN_TONE: Record<string, string> = { SUCCESS: "good", PARTIAL: "warn", FAILED: "bad", RUNNING: "info", INTERRUPTED: "neutral" };
const GEM = "https://bidplus.gem.gov.in";
const docPath = (bid: GemBid) => (bid.bidType === 5 ? "showdirectradocumentPdf" : bid.bidType === 2 ? "showradocumentPdf" : "showbidDocument");

/**
 * The GeM bid watch for administrators: settings, a manual pass, run history and the bids found,
 * with Import / Ignore for each. While a pass runs the page refreshes itself.
 */
export function GemWatch({ gem, timeZone, run, reload, canEdit, canRun }: { gem: GemData; timeZone: string; run: (name: string) => (formData: FormData) => Promise<void>; reload: () => void; canEdit: boolean; canRun: boolean }) {
  const [tab, setTab] = useState("NEW");
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const { portal, runs, bids, tenders, running, progress } = gem;
  const [, tick] = useState(0);

  // While a pass runs: fetch its progress every 3 seconds, and keep the elapsed time ticking.
  useEffect(() => {
    if (!running) return;
    const poll = window.setInterval(reload, 3000);
    const clock = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [running, reload]);
  const elapsed = progress ? Math.max(0, Math.round((Date.now() - new Date(progress.startedAt).getTime()) / 1000)) : 0;

  const counts = Object.fromEntries(TABS.map(([key]) => [key, key ? bids.filter((bid) => bid.status === key).length : bids.length]));
  const needle = query.trim().toLowerCase();
  const shown = bids
    .filter((bid) => !tab || bid.status === tab)
    .filter((bid) => !needle || [bid.bidNumber, bid.title, bid.department, bid.ministry, bid.keyword].join(" ").toLowerCase().includes(needle));
  const tenderOf = (id: string) => tenders.find((tender) => tender.id === id);
  const last = runs[0];
  const keywords = portal.keywords.split(/[,\n;]+/).map((word) => word.trim()).filter(Boolean);
  const excludes = (portal.excludeWords || "").split(/[,\n;]+/).map((word) => word.trim()).filter(Boolean);

  return (
    <section className="panel gem-watch">
      <header className="gem-head">
        <span className="gem-logo" aria-hidden>
          GeM
        </span>
        <div>
          <h2>GeM bid watch</h2>
          <p className="muted">
            Searches the open bids on <a href={`${GEM}/all-bids`} target="_blank" rel="noreferrer">bidplus.gem.gov.in</a> every {portal.frequencyHours} hours, keeps bids whose title holds a keyword
            {portal.autoImport ? `, and imports up to ${portal.maxImports} new ones per pass as tenders with their bid document.` : ". Auto-import is off: found bids wait here for review."}
          </p>
        </div>
        <span className="gem-state">
          <span className={`pill ${running ? "info" : portal.enabled ? "good" : "neutral"}`}>{running ? "Running now…" : portal.enabled ? "Watching" : "Paused"}</span>
          <small className="muted">{portal.lastScanAt ? `Last pass ${formatWhen(portal.lastScanAt, timeZone)}` : "Not run yet"}</small>
        </span>
        <div className="gem-actions">
          {canRun ? (
            <form action={run("gem")}>
              <input type="hidden" name="intent" value="run" />
              <button className="btn" type="submit" disabled={running}>
                {running ? "Running…" : "Run now"}
              </button>
            </form>
          ) : null}
          {canEdit ? (
            <button type="button" className="btn ghost" onClick={() => setEditing((value) => !value)}>
              {editing ? "Close settings" : "Settings"}
            </button>
          ) : null}
        </div>
      </header>

      <div className="gem-chips">
        <span className="gem-chip-label">Keywords</span>
        {keywords.map((word) => (
          <span key={word} className="gem-chip">
            {word}
            {canEdit ? (
              <form action={run("gem")}>
                <input type="hidden" name="intent" value="remove-keyword" />
                <input type="hidden" name="keyword" value={word} />
                <button type="submit" className="gem-chip-x" aria-label={`Remove ${word}`} title={`Remove ${word}`}>
                  ×
                </button>
              </form>
            ) : null}
          </span>
        ))}
        {canEdit ? (
          <form
            className="gem-add"
            action={async (formData) => {
              await run("gem")(formData);
              setKeyword("");
            }}
          >
            <input type="hidden" name="intent" value="add-keyword" />
            <input name="keyword" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="Add a keyword" aria-label="New keyword" required />
            <button className="btn" type="submit">
              Add
            </button>
          </form>
        ) : null}
        {excludes.length ? <span className="gem-chip-label">Excluding</span> : null}
        {excludes.map((word) => (
          <span key={word} className="gem-chip off">
            {word}
          </span>
        ))}
      </div>

      {editing && canEdit ? (
        <form
          action={async (formData) => {
            await run("gem")(formData);
            setEditing(false);
          }}
          className="form-grid gem-settings"
        >
          <input type="hidden" name="intent" value="settings" />
          <label className="wide">
            Keywords (one per line or comma-separated)
            <textarea name="keywords" rows={4} defaultValue={keywords.join("\n")} required />
          </label>
          <label className="wide">
            Exclude bids whose title has any of these words
            <textarea name="excludeWords" rows={2} defaultValue={excludes.join(", ")} placeholder="cement, bricks, toll" />
          </label>
          <label>
            Run every (hours)
            <input name="frequencyHours" type="number" min={1} max={168} defaultValue={portal.frequencyHours} />
          </label>
          <label>
            Pages per keyword (10 bids each)
            <input name="maxPages" type="number" min={1} max={100} defaultValue={portal.maxPages} />
          </label>
          <label>
            Most tenders imported per pass
            <input name="maxImports" type="number" min={0} max={200} defaultValue={portal.maxImports} />
          </label>
          <label className="check">
            <input type="checkbox" name="enabled" value="yes" defaultChecked={portal.enabled} />
            Watch on (runs on its own as people use the app)
          </label>
          <label className="check">
            <input type="checkbox" name="autoImport" value="yes" defaultChecked={portal.autoImport} />
            Import matching bids as tenders automatically
          </label>
          <div className="actions wide">
            <button className="btn" type="submit">
              Save settings
            </button>
          </div>
        </form>
      ) : null}

      {running && progress ? (
        <div className="gem-progress" role="status" aria-live="polite">
          <div className="gem-progress-top">
            <b>
              {progress.active.length ? `Searching ${progress.active.join(", ")}` : progress.done >= progress.keywords ? "Importing bid documents…" : "Starting…"}
            </b>
            <span className="muted">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
            </span>
          </div>
          <span className="gem-progress-bar">
            <i style={{ width: `${Math.max(4, (progress.done / Math.max(1, progress.keywords)) * 100)}%` }} />
          </span>
          <small className="muted">
            {progress.done} of {progress.keywords} keywords done · {progress.pages} pages · {progress.checked} bids checked · {progress.matched} matching · {progress.imported} imported
          </small>
        </div>
      ) : null}

      {last ? (
        <p className={`gem-last ${RUN_TONE[last.status] ?? ""}`}>
          <b>Last pass {last.status.toLowerCase()}</b> · {formatWhen(last.startedAt, timeZone)} · {last.errorSummary.split("\n")[0]}
        </p>
      ) : null}

      <div className="gem-toolbar">
        <div className="tabs gem-tabs" role="tablist">
          {TABS.map(([key, label]) => (
            <button key={label} type="button" role="tab" aria-selected={tab === key} className={`tab ${tab === key ? "active" : ""}`} onClick={() => setTab(key)}>
              {label}
              {counts[key] ? <span className="cnt">{counts[key]}</span> : null}
            </button>
          ))}
        </div>
        <input type="search" placeholder="Search bid number, title, buyer…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>

      <div className="table-wrap flat">
        <table className="gem-table">
          <thead>
            <tr>
              <th>GeM bid</th>
              <th>Title</th>
              <th>Buyer</th>
              <th>Keyword</th>
              <th>Bid ends</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  {bids.length ? "No bids in this list." : "No bids found yet. Press Run now to search GeM."}
                </td>
              </tr>
            ) : null}
            {shown.map((bid) => {
              const tender = tenderOf(bid.tenderId);
              const closed = Boolean(bid.endAt && new Date(bid.endAt).getTime() < Date.now());
              return (
                <tr key={bid.id}>
                  <td className="gem-number">
                    <a href={`${GEM}/${docPath(bid)}/${bid.bidId}`} target="_blank" rel="noreferrer" title="Open the bid document on GeM">
                      {bid.bidNumber}
                    </a>
                    {bid.quantity ? <small className="muted">Qty {bid.quantity}</small> : null}
                  </td>
                  <td>
                    <span className="gem-title" title={bid.title}>
                      {bid.title}
                    </span>
                  </td>
                  <td>
                    {bid.department && bid.department !== "NA" ? bid.department : "—"}
                    <small className="muted">{bid.ministry}</small>
                  </td>
                  <td>
                    <span className="gem-chip small">{bid.keyword}</span>
                  </td>
                  <td className={closed ? "text-bad" : ""}>
                    {formatWhen(bid.endAt, timeZone)}
                    {closed ? <small>closed</small> : null}
                  </td>
                  <td>
                    <span className={`pill ${STATUS[bid.status].tone}`}>{STATUS[bid.status].label}</span>
                    {bid.error ? <small className="muted gem-error">{bid.error}</small> : null}
                  </td>
                  <td className="gem-row-actions">
                    {tender ? (
                      <Link className="btn ghost" to={`/tenders/${tender.id}`}>
                        {tender.recordId}
                      </Link>
                    ) : null}
                    {canRun && (bid.status === "NEW" || bid.status === "FAILED" || bid.status === "EXCLUDED") ? (
                      <form action={run("gem")}>
                        <input type="hidden" name="intent" value="import" />
                        <input type="hidden" name="bidId" value={bid.id} />
                        <button className="btn" type="submit">
                          Import
                        </button>
                      </form>
                    ) : null}
                    {canRun && bid.status === "NEW" ? (
                      <form action={run("gem")}>
                        <input type="hidden" name="intent" value="ignore" />
                        <input type="hidden" name="bidId" value={bid.id} />
                        <button className="btn ghost" type="submit">
                          Ignore
                        </button>
                      </form>
                    ) : null}
                    {canRun && bid.status === "IGNORED" ? (
                      <form action={run("gem")}>
                        <input type="hidden" name="intent" value="restore" />
                        <input type="hidden" name="bidId" value={bid.id} />
                        <button className="btn ghost" type="submit">
                          Restore
                        </button>
                      </form>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {runs.length ? (
        <details className="gem-runs">
          <summary>Run history ({runs.length})</summary>
          <ul>
            {runs.map((item) => (
              <li key={item.id}>
                <span className={`pill ${RUN_TONE[item.status] ?? "neutral"}`}>{item.status}</span>
                <span>
                  {formatWhen(item.startedAt, timeZone)}
                  {item.finishedAt ? ` → ${formatWhen(item.finishedAt, timeZone)}` : ""}
                </span>
                <small className="muted">{item.errorSummary}</small>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
