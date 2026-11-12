import { Fragment, lazy, Suspense, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { apiUrl } from "@client/api/client";
import { formatWhen } from "@client/utils/calendar";
import type { Portal } from "@client/lib/types";

const PdfViewer = lazy(() => import("@client/components/feature/pdf-viewer"));

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
  /** JSON list of the documents the bid PDF links to, once read. */
  links?: string | null;
};
type GemLink = { url: string; label: string; ext: string; v?: number };
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

const EXT_TONE: Record<string, string> = { pdf: "pdf", csv: "sheet", xls: "sheet", xlsx: "sheet", doc: "word", docx: "word" };

/** Prefer the name printed in the bid ("Scope of Work") over "Buyer document 3". */
function linkName(link: GemLink) {
  if (link.label && !/^Buyer document\b/.test(link.label) && link.label !== "Linked document") return link.label;
  try {
    const file = decodeURIComponent(new URL(link.url).pathname).split("/").filter(Boolean).pop() ?? "";
    if (/\.[a-z0-9]{2,5}$/i.test(file)) return file;
  } catch {
    /* keep the stored label */
  }
  return link.label;
}

function unnamed(links: GemLink[]) {
  return links.some((link) => /^Buyer document\b/.test(link.label) || link.label === "Linked document");
}

function sameFile(a: string, b: string) {
  if (a === b) return true;
  try {
    const left = new URL(a);
    const right = new URL(b);
    if (left.href === right.href) return true;
    const name = (url: URL) => decodeURIComponent(url.pathname).split("/").filter(Boolean).pop() ?? "";
    const file = name(left);
    return Boolean(file) && file === name(right);
  } catch {
    return false;
  }
}

/**
 * The bid PDF plus the documents it links to (ATC, BOQ, specification, buyer uploads). PDFs open in the viewer,
 * other files download. The links are read from the bid PDF on first open and kept on the bid.
 */
function BidDocuments({ bid }: { bid: GemBid }) {
  const stored = (() => {
    try {
      const list = bid.links ? (JSON.parse(bid.links) as GemLink[]) : null;
      // A list saved before the bid's own document names were read is fetched again.
      return list && list.every((link) => link.v === 2) ? list : null;
    } catch {
      return null;
    }
  })();
  const [links, setLinks] = useState<GemLink[] | null>(stored);
  const [error, setError] = useState("");
  const [shown, setShown] = useState(-1); // -1 = the bid document itself
  const pending = useRef("");
  const refreshed = useRef(false);
  const base = `/gem-bids/${encodeURIComponent(bid.id)}`;

  useEffect(() => {
    if (links && !unnamed(links)) return;
    if (links && refreshed.current) return;
    refreshed.current = true;
    let live = true;
    fetch(apiUrl(`${base}/links`), { credentials: "include" })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as { links?: GemLink[]; error?: string };
        if (!live) return;
        if (!response.ok) setError(body.error ?? "Could not read the linked documents.");
        else setLinks(body.links ?? []);
      })
      .catch(() => live && setError("Could not reach the server for the linked documents."));
    return () => {
      live = false;
    };
  }, [base, links]);

  const current = shown >= 0 && links ? links[shown] : null;
  const openLinked = (url: string) => {
    if (!links) {
      pending.current = url;
      return;
    }
    const index = links.findIndex((link) => sameFile(link.url, url));
    if (index < 0) return;
    const link = links[index];
    if (link.ext === "pdf") {
      setShown(index);
      return;
    }
    const save = document.createElement("a");
    save.href = apiUrl(`${base}/linked/${index}?download=1`);
    save.rel = "noreferrer";
    save.click();
  };
  useEffect(() => {
    if (!pending.current || !links) return;
    const url = pending.current;
    pending.current = "";
    const index = links.findIndex((link) => sameFile(link.url, url));
    if (index >= 0 && links[index].ext === "pdf") setShown(index);
  }, [links]);
  return (
    <div className="gem-docs">
      <div className="gem-links" role="list">
        <button type="button" role="listitem" className={`gem-link pdf${shown === -1 ? " is-on" : ""}`} onClick={() => setShown(-1)}>
          <span className="gem-link-ext">PDF</span>
          <span>Bid document</span>
        </button>
        {links === null && !error ? <span className="gem-links-note">Reading linked documents…</span> : null}
        {error ? <span className="gem-links-note text-bad">{error}</span> : null}
        {links && !links.length ? <span className="gem-links-note">No linked documents in this bid.</span> : null}
        {links?.map((link, index) =>
          link.ext === "pdf" ? (
            <button key={link.url} type="button" role="listitem" className={`gem-link pdf${shown === index ? " is-on" : ""}`} onClick={() => setShown(index)} title={link.label}>
              <span className="gem-link-ext">PDF</span>
              <span className="gem-link-name">{linkName(link)}</span>
            </button>
          ) : (
            <a key={link.url} role="listitem" className={`gem-link ${EXT_TONE[link.ext] ?? "other"}`} href={apiUrl(`${base}/linked/${index}?download=1`)} title={`Download · ${linkName(link)}`}>
              <span className="gem-link-ext">{link.ext.toUpperCase()}</span>
              <span className="gem-link-name">{linkName(link)}</span>
              <span className="gem-link-dl" aria-hidden="true">↓</span>
            </a>
          ),
        )}
      </div>
      <div className="preview gem-doc">
        <Suspense fallback={<div className="pdfv-state">Loading the document…</div>}>
          {current ? (
            <PdfViewer key={current.url} src={apiUrl(`${base}/linked/${shown}`)} name={`${linkName(current)} - ${bid.bidNumber}.pdf`} onLink={openLinked} />
          ) : (
            <PdfViewer key="bid" src={apiUrl(`${base}/document`)} name={`${bid.bidNumber}.pdf`} onLink={openLinked} />
          )}
        </Suspense>
      </div>
    </div>
  );
}

/**
 * The GeM bid watch for administrators: settings, a manual pass, run history and the bids found,
 * with Import / Ignore for each. While a pass runs the page refreshes itself.
 */
export function GemWatch({ gem, timeZone, run, reload, canEdit, canKeywords, canRun }: { gem: GemData; timeZone: string; run: (name: string) => (formData: FormData) => Promise<void>; reload: () => void; canEdit: boolean; canKeywords: boolean; canRun: boolean }) {
  const [tab, setTab] = useState("NEW");
  const [editing, setEditing] = useState(false);
  const [query, setQuery] = useState("");
  const [keyword, setKeyword] = useState("");
  const [allKeywords, setAllKeywords] = useState(false);
  const [openId, setOpenId] = useState("");
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
                {running ? "Running…" : portal.lastScanAt ? "Re-run" : "Run now"}
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
        <span className="gem-chip-label">Keywords ({keywords.length})</span>
        {/* Over 250 keywords: the first few show, the rest on request. */}
        {(allKeywords ? keywords : keywords.slice(0, 20)).map((word) => (
          <span key={word} className="gem-chip">
            {word}
            {canKeywords ? (
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
        {keywords.length > 20 ? (
          <button type="button" className="gem-chip more" onClick={() => setAllKeywords((value) => !value)}>
            {allKeywords ? "Show fewer" : `Show all ${keywords.length}`}
          </button>
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
        <div className="gem-toolbar-end">
          {canKeywords ? (
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
                Add keyword
              </button>
            </form>
          ) : null}
          {canRun ? (
            <form action={run("gem")}>
              <input type="hidden" name="intent" value="run" />
              <button className="btn" type="submit" disabled={running}>
                {running ? "Running…" : portal.lastScanAt ? "Re-run" : "Run now"}
              </button>
            </form>
          ) : null}
          <input type="search" placeholder="Search bid number, title, buyer…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
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
              <th>Actions</th>
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
              const open = openId === bid.id;
              return (
                <Fragment key={bid.id}>
                <tr className={open ? "is-open" : ""}>
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
                    <button type="button" className={`btn ghost${open ? " is-on" : ""}`} onClick={() => setOpenId(open ? "" : bid.id)}>
                      {open ? "Hide document" : "View document"}
                    </button>
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
                          {bid.status === "FAILED" ? "Retry import" : "Import as tender"}
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
                {open ? (
                  <tr className="gem-doc-row">
                    <td colSpan={7}>
                      <BidDocuments bid={bid} />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
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
