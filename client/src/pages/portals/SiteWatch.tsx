import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatWhen } from "@client/utils/calendar";
import type { Portal } from "@client/lib/types";

export type WatchSite = {
  id: string;
  host: string;
  name: string;
  url: string;
  category: string;
  method: "NIC" | "PAGE" | "MANUAL";
  enabled: boolean;
  lastScanAt: Date | null;
  lastStatus: string;
  lastError: string;
  organisations: number;
  checked: number;
  matched: number;
};
export type SiteTender = {
  id: string;
  siteId: string;
  portalTenderId: string;
  refNo: string;
  title: string;
  organisation: string;
  link: string;
  publishedAt: Date | null;
  closingAt: Date | null;
  keyword: string;
  status: "NEW" | "IMPORTED" | "IGNORED" | "EXCLUDED" | "FAILED";
  tenderId: string;
  error: string;
  firstSeenAt: Date;
};
type Run = { id: string; startedAt: Date; finishedAt: Date | null; status: string; errorSummary: string };
export type SitesData = {
  portal: Portal & { excludeWords: string };
  sites: WatchSite[];
  tenders: SiteTender[];
  runs: Run[];
  stats?: { total: number; byStatus: Record<string, number>; keywords: { keyword: string; total: number; open: number; added: number; sites: number }[] };
  running: boolean;
  progress: { startedAt: Date; sites: number; done: number; active: string[]; organisations: number; checked: number; matched: number } | null;
};

const STATUS: Record<SiteTender["status"], { label: string; tone: string }> = {
  NEW: { label: "To review", tone: "warn" },
  IMPORTED: { label: "Added", tone: "good" },
  IGNORED: { label: "Ignored", tone: "neutral" },
  EXCLUDED: { label: "Excluded", tone: "neutral" },
  FAILED: { label: "Failed", tone: "bad" },
};
const TABS: [string, string][] = [
  ["NEW", "To review"],
  ["IMPORTED", "Added"],
  ["FAILED", "Failed"],
  ["EXCLUDED", "Excluded"],
  ["IGNORED", "Ignored"],
  ["", "All"],
];
const SITE_TABS: [string, string][] = [
  ["ALL", "All"],
  ["AUTO", "Automatic"],
  ["MANUAL", "Check by hand"],
];
const RUN_TONE: Record<string, string> = { SUCCESS: "good", PARTIAL: "warn", FAILED: "bad", RUNNING: "info", INTERRUPTED: "neutral" };
const METHOD: Record<WatchSite["method"], string> = { NIC: "Automatic · NIC portal", PAGE: "Automatic · tender page", MANUAL: "Check by hand" };
/** The sheet's first name for the site that is a name, not a web address ("Coal India eTender Portal", not "coalindiatenders.nic.in"). */
const short = (name: string) => {
  const parts = name.split(" / ").map((part) => part.trim()).filter(Boolean);
  return parts.find((part) => !/^[\w-]+(\.[\w-]+)+$/.test(part)) ?? parts[0] ?? name;
};

/** The numbers in a pass's summary line ("31 sites · 1384 organisation lists · 56117 tenders checked · 304 matching (256 new)"). */
function runNumbers(summary: string) {
  const first = summary.split("\n")[0] ?? "";
  const num = (pattern: RegExp) => {
    const found = first.match(pattern);
    return found ? Number(found[1]) : null;
  };
  return {
    sites: num(/(\d+) sites?\b/),
    organisations: num(/(\d+) organisation lists?/),
    checked: num(/(\d+) tenders checked/),
    matched: num(/(\d+) matching/),
    fresh: num(/\((\d+) new\)/),
    problems: summary.split("\n").slice(1).filter(Boolean),
    note: /\d+ sites?\b/.test(first) ? "" : first,
  };
}
const fmt = (value: number | null | undefined) => (value == null ? "—" : value.toLocaleString("en-IN"));
function duration(start: Date, end: Date | null) {
  if (!end) return "";
  const seconds = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
}

/** Where a person can see the tender: the NIC organisation list (its own links only live inside a session), or the page link. */
function portalLink(site: WatchSite | undefined, tender: SiteTender) {
  if (tender.link) return tender.link;
  if (!site) return "";
  return site.method === "NIC" ? `${site.url}?page=FrontEndTendersByOrganisation&service=page` : site.url;
}

/**
 * The tender websites from the master sheet, searched with the sourcing keywords: the matching tenders with
 * Add as tender / Ignore, and the list of sites with how each one is read.
 */
export function SiteWatch({ data, timeZone, run, reload, canEdit, canRun }: { data: SitesData; timeZone: string; run: (name: string) => (formData: FormData) => Promise<void>; reload: () => void; canEdit: boolean; canRun: boolean }) {
  const { portal, sites, tenders, runs, running, progress, stats } = data;
  const [allKeywords, setAllKeywords] = useState(false);
  const [tab, setTab] = useState("NEW");
  const [siteFilter, setSiteFilter] = useState("");
  const [query, setQuery] = useState("");
  const [siteTab, setSiteTab] = useState("ALL");
  const [siteQuery, setSiteQuery] = useState("");
  const [editing, setEditing] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    if (!running) return;
    const poll = window.setInterval(reload, 4000);
    const clock = window.setInterval(() => tick((value) => value + 1), 1000);
    return () => {
      window.clearInterval(poll);
      window.clearInterval(clock);
    };
  }, [running, reload]);
  const elapsed = progress ? Math.max(0, Math.round((Date.now() - new Date(progress.startedAt).getTime()) / 1000)) : 0;

  const siteOf = (id: string) => sites.find((site) => site.id === id);
  const counts = Object.fromEntries(TABS.map(([key]) => [key, key ? tenders.filter((item) => item.status === key).length : tenders.length]));
  const needle = query.trim().toLowerCase();
  const shown = tenders
    .filter((item) => !tab || item.status === tab)
    .filter((item) => !siteFilter || item.siteId === siteFilter)
    .filter((item) => !needle || [item.title, item.refNo, item.portalTenderId, item.organisation, item.keyword, siteOf(item.siteId)?.host].join(" ").toLowerCase().includes(needle));
  const keywords = portal.keywords.split(/[,\n;]+/).map((word) => word.trim()).filter(Boolean);
  const excludes = (portal.excludeWords || "").split(/[,\n;]+/).map((word) => word.trim()).filter(Boolean);
  const automatic = sites.filter((site) => site.method !== "MANUAL");
  const withMatches = [...new Set(tenders.map((item) => item.siteId))].map(siteOf).filter(Boolean) as WatchSite[];
  const last = runs[0];
  const read = automatic.filter((site) => site.lastScanAt);
  const readOk = read.filter((site) => site.lastStatus !== "FAILED");
  const totalChecked = read.reduce((sum, site) => sum + site.checked, 0);
  const totalOrganisations = read.reduce((sum, site) => sum + site.organisations, 0);
  const byStatus = stats?.byStatus ?? Object.fromEntries(TABS.filter(([key]) => key).map(([key]) => [key, counts[key]]));
  const found = stats?.total ?? tenders.length;
  const ranking =
    stats?.keywords ??
    Object.values(
      tenders
        .filter((item) => item.status !== "EXCLUDED")
        .reduce<Record<string, { keyword: string; total: number; open: number; added: number; sites: number }>>((acc, item) => {
          const entry = (acc[item.keyword] ??= { keyword: item.keyword, total: 0, open: 0, added: 0, sites: 0 });
          entry.total += 1;
          if (item.status === "NEW") entry.open += 1;
          if (item.status === "IMPORTED") entry.added += 1;
          return acc;
        }, {}),
    ).sort((a, b) => b.total - a.total);
  const topCount = ranking[0]?.total ?? 1;
  const unmatchedKeywords = keywords.filter((word) => !ranking.some((row) => row.keyword.toLowerCase() === word.toLowerCase()));
  const siteRanking = [...read].filter((site) => site.matched).sort((a, b) => b.matched - a.matched);
  const finished = runs.filter((item) => item.status !== "RUNNING");
  const siteNeedle = siteQuery.trim().toLowerCase();
  const listed = sites
    .filter((site) => siteTab === "ALL" || (siteTab === "AUTO" ? site.method !== "MANUAL" : site.method === "MANUAL"))
    .filter((site) => !siteNeedle || [site.name, site.host, site.category].join(" ").toLowerCase().includes(siteNeedle));

  return (
    <section className="panel gem-watch site-watch">
      <header className="gem-head">
        <span className="gem-logo site-logo" aria-hidden>
          WEB
        </span>
        <div>
          <h2>Tender sites watch</h2>
          <p className="muted">
            Searches the open tenders on the {sites.length} websites from the master list with the {keywords.length} sourcing keywords. {automatic.length} sites are read automatically (Coal India and its
            subsidiaries, NTPC, CPPP, IOCL and the state NIC portals list every organisation&apos;s tenders); the rest have no public list a program can read and are linked for checking by hand.
          </p>
        </div>
        <span className="gem-state">
          <span className={`pill ${running ? "info" : portal.enabled ? "good" : "neutral"}`}>{running ? "Running now…" : portal.enabled ? `Every ${portal.frequencyHours}h` : "Paused"}</span>
          <small className="muted">{portal.lastScanAt ? `Last pass ${formatWhen(portal.lastScanAt, timeZone)}` : "Not run yet"}</small>
        </span>
        <div className="gem-actions">
          {canRun ? (
            <form action={run("site-watch")}>
              <input type="hidden" name="intent" value="run" />
              <button className="btn" type="submit" disabled={running}>
                {running ? "Running…" : portal.lastScanAt ? "Search all sites" : "Run now"}
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

      {editing && canEdit ? (
        <form
          action={async (formData) => {
            await run("site-watch")(formData);
            setEditing(false);
          }}
          className="form-grid gem-settings"
        >
          <input type="hidden" name="intent" value="settings" />
          <label className="wide">
            Keywords (one per line or comma-separated)
            <textarea name="keywords" rows={5} defaultValue={keywords.join("\n")} required />
          </label>
          <label className="wide">
            Leave out tenders whose title has any of these words
            <textarea name="excludeWords" rows={2} defaultValue={excludes.join(", ")} />
          </label>
          <label>
            Run every (hours)
            <input name="frequencyHours" type="number" min={1} max={168} defaultValue={portal.frequencyHours} />
          </label>
          <label className="check">
            <input type="checkbox" name="enabled" value="yes" defaultChecked={portal.enabled} />
            Watch on (runs on its own as people use the app)
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
            <b>{progress.active.length ? `Reading ${progress.active.join(", ")}` : "Starting…"}</b>
            <span className="muted">
              {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, "0")}
            </span>
          </div>
          <span className="gem-progress-bar">
            <i style={{ width: `${Math.max(4, (progress.done / Math.max(1, progress.sites)) * 100)}%` }} />
          </span>
          <small className="muted">
            {progress.done} of {progress.sites} sites done · {progress.organisations} organisation lists · {progress.checked} tenders checked · {progress.matched} matching
          </small>
        </div>
      ) : null}

      {last ? (
        <p className={`gem-last ${RUN_TONE[last.status] ?? ""}`}>
          <b>Last pass {last.status.toLowerCase()}</b> · {formatWhen(last.startedAt, timeZone)} · {last.errorSummary.split("\n")[0]}
        </p>
      ) : null}

      <div className="site-cards">
        <div className="site-card">
          <small>Websites searched</small>
          <b>{fmt(readOk.length)}</b>
          <span className="muted">
            of {automatic.length} automatic · {sites.length} in the list{read.length - readOk.length ? ` · ${read.length - readOk.length} did not answer` : ""}
          </span>
        </div>
        <div className="site-card">
          <small>Organisation lists read</small>
          <b>{fmt(totalOrganisations)}</b>
          <span className="muted">departments and companies on the portals</span>
        </div>
        <div className="site-card">
          <small>Tenders checked</small>
          <b>{fmt(totalChecked)}</b>
          <span className="muted">open tenders read in the last pass of each site</span>
        </div>
        <div className="site-card accent">
          <small>Matching results</small>
          <b>{fmt(found - (byStatus.EXCLUDED ?? 0))}</b>
          <span className="muted">
            {fmt(byStatus.NEW ?? 0)} to review · {fmt(byStatus.IMPORTED ?? 0)} added · {fmt(byStatus.IGNORED ?? 0)} ignored
          </span>
        </div>
        <div className="site-card">
          <small>Keywords with results</small>
          <b>
            {ranking.length}
            <i> / {keywords.length}</i>
          </b>
          <span className="muted">{fmt(byStatus.EXCLUDED ?? 0)} left out by the exclude words</span>
        </div>
        <div className="site-card">
          <small>Passes run</small>
          <b>{fmt(finished.length)}</b>
          <span className="muted">{last ? `last ${formatWhen(last.startedAt, timeZone)}` : "none yet"}</span>
        </div>
      </div>

      {ranking.length ? (
        <div className="site-rank-grid">
          <div className="site-rank">
            <div className="site-rank-head">
              <h3>Top keywords</h3>
              <small className="muted">Matching tenders per keyword, all passes. Click one to see its tenders.</small>
            </div>
            <ol>
              {(allKeywords ? ranking : ranking.slice(0, 10)).map((row, index) => (
                <li key={row.keyword}>
                  <span className="site-rank-no">{index + 1}</span>
                  <button
                    type="button"
                    className="site-rank-bar"
                    title={`${row.total} matching · ${row.open} to review · ${row.added} added${row.sites ? ` · ${row.sites} websites` : ""}`}
                    onClick={() => {
                      setQuery(row.keyword);
                      setTab("");
                      setSiteFilter("");
                    }}
                  >
                    <span className="site-rank-label">{row.keyword}</span>
                    <span className="site-rank-track">
                      <i style={{ width: `${Math.max(3, (row.total / topCount) * 100)}%` }} />
                    </span>
                  </button>
                  <b>{row.total}</b>
                  <small className="muted">
                    {row.open} new{row.added ? ` · ${row.added} added` : ""}
                    {row.sites ? ` · ${row.sites} site${row.sites === 1 ? "" : "s"}` : ""}
                  </small>
                </li>
              ))}
            </ol>
            {ranking.length > 10 ? (
              <button type="button" className="link-btn" onClick={() => setAllKeywords((value) => !value)}>
                {allKeywords ? "Show top 10" : `Show all ${ranking.length} keywords`}
              </button>
            ) : null}
            {unmatchedKeywords.length ? (
              <details className="site-rank-none">
                <summary>{unmatchedKeywords.length} keywords with no match yet</summary>
                <p className="muted">{unmatchedKeywords.join(", ")}</p>
              </details>
            ) : null}
          </div>
          <div className="site-rank">
            <div className="site-rank-head">
              <h3>Top websites</h3>
              <small className="muted">Matching tenders per website in its last pass. Click one to filter.</small>
            </div>
            <ol>
              {siteRanking.slice(0, 10).map((site, index) => (
                <li key={site.id}>
                  <span className="site-rank-no">{index + 1}</span>
                  <button
                    type="button"
                    className="site-rank-bar"
                    title={`${site.matched} matching of ${site.checked} tenders`}
                    onClick={() => {
                      setSiteFilter(site.id);
                      setTab("");
                      setQuery("");
                    }}
                  >
                    <span className="site-rank-label">{short(site.name)}</span>
                    <span className="site-rank-track">
                      <i style={{ width: `${Math.max(3, (site.matched / (siteRanking[0]?.matched || 1)) * 100)}%` }} />
                    </span>
                  </button>
                  <b>{site.matched}</b>
                  <small className="muted">of {fmt(site.checked)}</small>
                </li>
              ))}
            </ol>
          </div>
        </div>
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
          <select value={siteFilter} onChange={(event) => setSiteFilter(event.target.value)} aria-label="Website">
            <option value="">All websites</option>
            {withMatches.map((site) => (
              <option key={site.id} value={site.id}>
                {short(site.name)} ({site.host})
              </option>
            ))}
          </select>
          <input type="search" placeholder="Search title, tender ID, organisation…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>

      <div className="table-wrap flat">
        <table className="gem-table">
          <thead>
            <tr>
              <th>Website</th>
              <th>Tender</th>
              <th>Organisation</th>
              <th>Keyword</th>
              <th>Closes</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  {tenders.length ? "No tenders in this list." : "No tenders found yet. Press Run now to search the websites."}
                </td>
              </tr>
            ) : null}
            {shown.map((item) => {
              const site = siteOf(item.siteId);
              const closed = Boolean(item.closingAt && new Date(item.closingAt).getTime() < Date.now());
              const href = portalLink(site, item);
              return (
                <tr key={item.id}>
                  <td className="gem-number">
                    {href ? (
                      <a href={href} target="_blank" rel="noopener noreferrer" title={site?.method === "NIC" ? "Open the portal's Tenders by Organisation list" : "Open on the website"}>
                        {site ? short(site.name) : "Website"}
                      </a>
                    ) : (
                      short(site?.name ?? "Website")
                    )}
                    <small className="muted">{site?.host}</small>
                  </td>
                  <td>
                    <span className="gem-title" title={item.title}>
                      {item.title}
                    </span>
                    {item.portalTenderId || item.refNo ? (
                      <small className="muted site-ids">
                        {item.portalTenderId ? <b>{item.portalTenderId}</b> : null}
                        {item.refNo ? ` · ${item.refNo}` : ""}
                      </small>
                    ) : null}
                  </td>
                  <td>{item.organisation || "—"}</td>
                  <td>
                    <span className="gem-chip small">{item.keyword}</span>
                  </td>
                  <td className={closed ? "text-bad" : ""}>
                    {item.closingAt ? formatWhen(item.closingAt, timeZone) : "—"}
                    {closed ? <small>closed</small> : null}
                  </td>
                  <td>
                    <span className={`pill ${STATUS[item.status].tone}`}>{STATUS[item.status].label}</span>
                    {item.error ? <small className="muted gem-error">{item.error}</small> : null}
                  </td>
                  <td className="gem-row-actions">
                    {item.tenderId ? (
                      <Link className="btn ghost" to={`/tenders/${item.tenderId}`}>
                        Open tender
                      </Link>
                    ) : null}
                    {canRun && (item.status === "NEW" || item.status === "FAILED" || item.status === "EXCLUDED") ? (
                      <form action={run("site-watch")}>
                        <input type="hidden" name="intent" value="import" />
                        <input type="hidden" name="siteTenderId" value={item.id} />
                        <button className="btn" type="submit">
                          {item.status === "FAILED" ? "Retry" : "Add as tender"}
                        </button>
                      </form>
                    ) : null}
                    {canRun && item.status === "NEW" ? (
                      <form action={run("site-watch")}>
                        <input type="hidden" name="intent" value="ignore" />
                        <input type="hidden" name="siteTenderId" value={item.id} />
                        <button className="btn ghost" type="submit">
                          Ignore
                        </button>
                      </form>
                    ) : null}
                    {canRun && item.status === "IGNORED" ? (
                      <form action={run("site-watch")}>
                        <input type="hidden" name="intent" value="restore" />
                        <input type="hidden" name="siteTenderId" value={item.id} />
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

      <div className="site-list">
        <div className="site-list-head">
          <div>
            <h3>All websites ({sites.length})</h3>
            <small className="muted">
              {automatic.length} searched automatically · {sites.length - automatic.length} to check by hand
            </small>
          </div>
          <div className="site-list-tools">
            <div className="tabs gem-tabs" role="tablist">
              {SITE_TABS.map(([key, label]) => (
                <button key={key} type="button" role="tab" aria-selected={siteTab === key} className={`tab ${siteTab === key ? "active" : ""}`} onClick={() => setSiteTab(key)}>
                  {label}
                  <span className="cnt">{key === "ALL" ? sites.length : key === "AUTO" ? automatic.length : sites.length - automatic.length}</span>
                </button>
              ))}
            </div>
            <input type="search" placeholder="Search website…" value={siteQuery} onChange={(event) => setSiteQuery(event.target.value)} aria-label="Search websites" />
          </div>
        </div>
        <div className="table-wrap flat site-scroll">
          <table className="gem-table">
            <thead>
              <tr>
                <th>Website</th>
                <th>Category</th>
                <th>How it is read</th>
                <th>Last pass</th>
                <th>Found</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {listed.length === 0 ? (
                <tr>
                  <td colSpan={6} className="empty">
                    No website matches that search.
                  </td>
                </tr>
              ) : null}
              {[...listed]
                .sort((a, b) => (a.method === "MANUAL" ? 1 : 0) - (b.method === "MANUAL" ? 1 : 0) || a.name.localeCompare(b.name))
                .map((site) => (
                  <tr key={site.id}>
                    <td>
                      <a href={site.method === "NIC" ? `${site.url}?page=FrontEndTendersByOrganisation&service=page` : site.url} target="_blank" rel="noopener noreferrer">
                        {short(site.name)}
                      </a>
                      <small className="muted">{site.host}</small>
                    </td>
                    <td>{site.category || "—"}</td>
                    <td>
                      {METHOD[site.method]}
                      {site.method !== "MANUAL" && !site.enabled ? <small className="muted">paused</small> : null}
                    </td>
                    <td>
                      {site.lastScanAt ? (
                        <>
                          <span className={`pill ${RUN_TONE[site.lastStatus] ?? "neutral"}`}>{site.lastStatus.toLowerCase()}</span>
                          <small className="muted">{formatWhen(site.lastScanAt, timeZone)}</small>
                        </>
                      ) : site.method === "MANUAL" ? (
                        "—"
                      ) : (
                        <span className="muted">Not read yet</span>
                      )}
                      {site.lastError ? <small className="muted gem-error">{site.lastError.split("\n")[0]}</small> : null}
                    </td>
                    <td>
                      {site.lastScanAt ? (
                        <>
                          {site.matched ? (
                            <button type="button" className="link-btn" title="Show this website's matching tenders above" onClick={() => { setSiteFilter(site.id); setTab(""); }}>
                              <b>{site.matched}</b> matching
                            </button>
                          ) : (
                            <b>0 matching</b>
                          )}{" "}
                          of {site.checked} tenders
                          {site.method === "NIC" ? <small className="muted">{site.organisations} organisations</small> : null}
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="gem-row-actions">
                      {canRun && site.method !== "MANUAL" ? (
                        <>
                          <form action={run("site-watch")}>
                            <input type="hidden" name="intent" value="run-site" />
                            <input type="hidden" name="siteId" value={site.id} />
                            <button className="btn ghost" type="submit" disabled={running || !site.enabled}>
                              Search this site
                            </button>
                          </form>
                          {canEdit ? (
                            <form action={run("site-watch")}>
                              <input type="hidden" name="intent" value="toggle-site" />
                              <input type="hidden" name="siteId" value={site.id} />
                              <button className="btn ghost" type="submit">
                                {site.enabled ? "Pause" : "Resume"}
                              </button>
                            </form>
                          ) : null}
                        </>
                      ) : null}
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="site-list site-history">
        <div className="site-list-head">
          <div>
            <h3>Search history ({runs.length})</h3>
            <small className="muted">Every pass over the websites, newest first.</small>
          </div>
        </div>
        <div className="table-wrap flat site-scroll">
          <table className="gem-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Result</th>
                <th>Took</th>
                <th>Websites</th>
                <th>Organisation lists</th>
                <th>Tenders checked</th>
                <th>Matching</th>
                <th>New</th>
                <th>Problems</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td colSpan={9} className="empty">
                    No passes yet. Press Run now to search the websites.
                  </td>
                </tr>
              ) : null}
              {runs.map((item) => {
                const numbers = runNumbers(item.errorSummary || "");
                return (
                  <tr key={item.id}>
                    <td>{formatWhen(item.startedAt, timeZone)}</td>
                    <td>
                      <span className={`pill ${RUN_TONE[item.status] ?? "neutral"}`}>{item.status.toLowerCase()}</span>
                    </td>
                    <td>{duration(item.startedAt, item.finishedAt) || (item.status === "RUNNING" ? "running…" : "—")}</td>
                    <td>{fmt(numbers.sites)}</td>
                    <td>{fmt(numbers.organisations)}</td>
                    <td>{fmt(numbers.checked)}</td>
                    <td>
                      <b>{fmt(numbers.matched)}</b>
                    </td>
                    <td>{fmt(numbers.fresh)}</td>
                    <td>
                      {numbers.note ? <small className="muted">{numbers.note}</small> : null}
                      {numbers.problems.length ? (
                        <small className="muted gem-error" title={numbers.problems.join("\n")}>
                          {numbers.problems.length === 1 ? numbers.problems[0] : `${numbers.problems.length} sites: ${numbers.problems.map((line) => line.split(":")[0]).join(", ")}`}
                        </small>
                      ) : !numbers.note ? (
                        "—"
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
