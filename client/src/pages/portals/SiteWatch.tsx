import { Fragment, lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { formatWhen } from "@client/utils/calendar";
import type { Portal } from "@client/lib/types";
import { apiUrl } from "@client/api/client";

const PdfViewer = lazy(() => import("@client/components/feature/pdf-viewer"));

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
  /** For a site checked by hand: "KIND:text" saying why (COVERED:<portal host>, LOGIN, CAPTCHA, SCRIPT, DOWN, NO_LIST). */
  note?: string;
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
type Run = {
  id: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: string;
  errorSummary: string;
};
export type SitesData = {
  portal: Portal & { excludeWords: string };
  sites: WatchSite[];
  tenders: SiteTender[];
  runs: Run[];
  stats?: {
    total: number;
    byStatus: Record<string, number>;
    keywords: {
      keyword: string;
      total: number;
      open: number;
      added: number;
      sites: number;
    }[];
  };
  links?: { title: string; url: string; host: string; category: string }[];
  running: boolean;
  progress: {
    startedAt: Date;
    sites: number;
    done: number;
    active: string[];
    organisations: number;
    checked: number;
    matched: number;
  } | null;
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
  ["FAILED", "Search failed"],
  ["EMPTY", "No results"],
  ["AUTO", "Automatic"],
  ["MANUAL", "Check by hand"],
];
const RUN_TONE: Record<string, string> = {
  SUCCESS: "good",
  PARTIAL: "warn",
  FAILED: "bad",
  RUNNING: "info",
  INTERRUPTED: "neutral",
};
const HAND_KIND: Record<string, { label: string; tone: string }> = {
  COVERED: { label: "Covered by a searched portal", tone: "good" },
  LOGIN: { label: "Needs a login", tone: "neutral" },
  CAPTCHA: { label: "Needs a CAPTCHA", tone: "neutral" },
  SCRIPT: { label: "List built by script", tone: "neutral" },
  DOWN: { label: "Site not reachable", tone: "bad" },
  NO_LIST: { label: "No tender list", tone: "neutral" },
};
/** Why a by-hand site is not read: its kind, the sentence, and for COVERED the portal that carries its tenders. */
function handReason(note: string | undefined) {
  const [kind, ...rest] = (note || "").split(":");
  const text = rest.join(":");
  if (!kind || !HAND_KIND[kind]) return null;
  return { kind, ...HAND_KIND[kind], text: kind === "COVERED" ? `Its tenders are published on ${text}, which is searched.` : text, portal: kind === "COVERED" ? text : "" };
}
const METHOD: Record<WatchSite["method"], string> = {
  NIC: "Automatic · NIC portal",
  PAGE: "Automatic · tender page",
  MANUAL: "Check by hand",
};
/** The sheet's first name for the site that is a name, not a web address ("Coal India eTender Portal", not "coalindiatenders.nic.in"). */
const short = (name: string) => {
  const parts = name
    .split(" / ")
    .map((part) => part.trim())
    .filter(Boolean);
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

/** Saves rows as a .csv file that Excel opens directly (the BOM keeps names like "Bhagalpur–Barauni" readable). */
function downloadCsv(fileName: string, header: string[], rows: (string | number)[][]) {
  const cell = (value: string | number) => {
    const text = String(value ?? "");
    return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = "\uFEFF" + [header, ...rows].map((row) => row.map(cell).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type TenderDetails = {
  fetchedAt: string;
  fields: [string, string][];
  documents: { section: string; items: { name: string; description: string; sizeKb: string; type: string }[] }[];
  corrigenda: { title: string; type: string; date: string }[];
  note: string;
  portalUrl: string;
};
/** The facts shown first, in this order, when the portal gives them (labels as NIC writes them). */
const KEY_FACTS: [string, string][] = [
  ["Tender Value (₹)", "Tender value (₹)"],
  ["EMD Amount (₹)", "EMD (₹)"],
  ["Tender Fee (₹)", "Tender fee (₹)"],
  ["Tender Category", "Category"],
  ["Product Category", "Product category"],
  ["Form Of Contract", "Form of contract"],
  ["Tender Type", "Tender type"],
  ["Location", "Location"],
  ["Pincode", "Pincode"],
  ["Period Of Work(Days)", "Period of work (days)"],
  ["Bid Validity(Days)", "Bid validity (days)"],
  ["Published Date", "Published"],
  ["Pre Bid Meeting Date", "Pre-bid meeting"],
  ["Document Download / Sale End Date", "Documents until"],
  ["Bid Submission End Date", "Bid submission ends"],
  ["Bid Opening Date", "Bid opening"],
  ["Inviting authority", "Inviting authority"],
  ["Payment Mode", "Payment mode"],
];
const fileTone = (name: string) => (/\.pdf$/i.test(name) ? "pdf" : /\.(xlsx?|csv)$/i.test(name) ? "sheet" : /\.docx?$/i.test(name) ? "word" : "other");

type DocState = { token: string; captcha: string; unlocked: boolean; documents: { index: number; name: string }[] };
const post = async (path: string, body?: Record<string, string>) => {
  const response = await fetch(apiUrl(path), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `The portal could not be reached (${response.status}).`);
  return json;
};

/**
 * Opens a tender's documents from its NIC portal. The portal asks a person for its security code before any file
 * downloads; its code image is shown here, the person types it, and the server passes it on in the portal session.
 */
function DocumentAccess({ item }: { item: SiteTender }) {
  const [state, setState] = useState<DocState | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewing, setViewing] = useState<number | null>(null);
  const base = `/site-tenders/${item.id}/documents`;

  const start = async () => {
    setBusy(true);
    setError("");
    setCode("");
    setViewing(null);
    try {
      const next = (await post(`${base}/start`)) as DocState;
      setState(next);
      if (next.unlocked) setViewing(0);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const unlock = async () => {
    if (!state || !code.trim()) return;
    setBusy(true);
    setError("");
    try {
      const next = await post(`${base}/unlock`, { token: state.token, code });
      if (next.unlocked) {
        setState({ ...state, unlocked: true, captcha: "", documents: next.documents });
        setViewing(next.documents.findIndex((doc: { name: string }) => /\.pdf$/i.test(doc.name)) >= 0 ? next.documents.findIndex((doc: { name: string }) => /\.pdf$/i.test(doc.name)) : null);
      } else {
        setState({ ...state, captcha: next.captcha });
        setError(next.error || "The portal did not accept that code.");
      }
      setCode("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  };
  const fileUrl = (index: number, download = false) => apiUrl(`${base}/${state?.token}/${index}${download ? "?download=1" : ""}`);
  const current = state && viewing !== null ? state.documents[viewing] : null;

  if (!state) {
    return (
      <div className="site-doc-access">
        <button type="button" className="btn" onClick={start} disabled={busy}>
          {busy ? "Opening the portal…" : "Open the documents here"}
        </button>
        <small className="muted">The portal asks for its security code (CAPTCHA) before any file downloads. You will see the code here and type it once for this tender.</small>
        {error ? <p className="gem-error">{error}</p> : null}
      </div>
    );
  }
  return (
    <div className="site-doc-access">
      {!state.unlocked ? (
        <form
          className="site-code"
          onSubmit={(event) => {
            event.preventDefault();
            void unlock();
          }}
        >
          <img src={state.captcha} alt="Security code from the portal" />
          <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Type the code" maxLength={8} autoComplete="off" aria-label="Security code" autoFocus />
          <button className="btn" type="submit" disabled={busy || !code.trim()}>
            {busy ? "Checking…" : "Open documents"}
          </button>
          <button className="btn ghost" type="button" onClick={start} disabled={busy}>
            New code
          </button>
        </form>
      ) : (
        <ul className="site-doc-files">
          {state.documents.map((doc) => (
            <li key={doc.index}>
              <span className={`site-doc-ext ${fileTone(doc.name)}`}>{/\(zip\)/.test(doc.name) ? "ZIP" : doc.name.split(".").pop()?.toUpperCase()}</span>
              <b>{doc.name}</b>
              {/\.pdf$/i.test(doc.name) ? (
                <button type="button" className="btn ghost" onClick={() => setViewing(viewing === doc.index ? null : doc.index)}>
                  {viewing === doc.index ? "Hide" : "View"}
                </button>
              ) : null}
              <a className="btn ghost" href={fileUrl(doc.index, true)}>
                Download
              </a>
            </li>
          ))}
        </ul>
      )}
      {error ? <p className="gem-error">{error}</p> : null}
      {current ? (
        <div className="site-doc-viewer">
          <Suspense fallback={<p className="muted">Loading the viewer…</p>}>
            <PdfViewer key={`${state.token}-${current.index}`} src={fileUrl(current.index)} name={`${current.name.replace(/\.pdf$/i, "")} - ${item.portalTenderId}.pdf`} />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}

/** The tender as the portal shows it, read when the row is opened: key facts, documents, corrigenda and every field. */
function TenderDetailPanel({ item, site }: { item: SiteTender; site: WatchSite | undefined }) {
  const [details, setDetails] = useState<TenderDetails | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);
  const load = (refresh = false) => {
    setLoading(true);
    setError("");
    fetch(apiUrl(`/site-tenders/${item.id}/details${refresh ? "?refresh=1" : ""}`), { credentials: "include" })
      .then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `The portal could not be read (${response.status}).`);
        setDetails(body as TenderDetails);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)))
      .finally(() => setLoading(false));
  };
  useEffect(() => load(), [item.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = (label: string) => details?.fields.find(([key]) => key === label)?.[1] ?? "";
  const facts = KEY_FACTS.map(([key, label]) => [label, value(key)]).filter(([, text]) => text && text !== "NA");
  const description = value("Work Description");
  const fileCount = details?.documents.reduce((sum, group) => sum + group.items.length, 0) ?? 0;
  const portalUrl = details?.portalUrl || (site?.method === "NIC" ? `${site.url}?page=FrontEndTendersByOrganisation&service=page` : item.link || site?.url || "");
  const copyId = () => {
    void navigator.clipboard?.writeText(item.portalTenderId).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <div className="site-detail">
      {loading && !details ? (
        <p className="muted site-detail-wait">Reading the tender from {site?.host ?? "the portal"}…</p>
      ) : error ? (
        <p className="gem-error site-detail-wait">
          {error}{" "}
          <button type="button" className="link-btn" onClick={() => load(true)}>
            Try again
          </button>
        </p>
      ) : details ? (
        <>
          {facts.length ? (
            <dl className="site-facts">
              {facts.map(([label, text]) => (
                <div key={label}>
                  <dt>{label}</dt>
                  <dd>{text}</dd>
                </div>
              ))}
            </dl>
          ) : null}
          {description && description !== item.title ? <p className="site-detail-desc">{description}</p> : null}

          <div className="site-detail-cols">
            <div>
              <h4>Documents{fileCount ? ` (${fileCount})` : ""}</h4>
              {details.documents.length ? (
                details.documents.map((group) => (
                  <div key={group.section} className="site-doc-group">
                    <small className="muted">{group.section}</small>
                    <ul className="site-docs">
                      {group.items.map((doc) => (
                        <li key={doc.name}>
                          <span className={`site-doc-ext ${fileTone(doc.name)}`}>{doc.name.split(".").pop()?.toUpperCase()}</span>
                          <span>
                            <b>{doc.name}</b>
                            <small className="muted">
                              {(doc.type && doc.type !== doc.description ? [doc.type, doc.description] : [doc.description]).filter(Boolean).join(" · ")}
                              {doc.sizeKb ? ` · ${doc.sizeKb} KB` : ""}
                            </small>
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))
              ) : (
                <p className="muted">{details.note || "The portal lists no documents for this tender."}</p>
              )}
              {details.documents.length && details.note ? <p className="gem-error">{details.note}</p> : null}
              {site?.method === "NIC" && details.documents.length ? <DocumentAccess item={item} /> : null}
              <div className="site-detail-actions">
                {portalUrl ? (
                  <a className="btn" href={portalUrl} target="_blank" rel="noopener noreferrer">
                    Open on {site?.host ?? "the website"}
                  </a>
                ) : null}
                {item.portalTenderId ? (
                  <button type="button" className="btn ghost" onClick={copyId}>
                    {copied ? "Copied" : "Copy tender ID"}
                  </button>
                ) : null}
                <button type="button" className="btn ghost" onClick={() => load(true)} disabled={loading}>
                  {loading ? "Reading…" : "Read again"}
                </button>
              </div>
            </div>
            {details.corrigenda.length ? (
              <div>
                <h4>Corrigenda ({details.corrigenda.length})</h4>
                <ul className="site-corr">
                  {details.corrigenda.map((entry, index) => (
                    <li key={`${entry.title}-${index}`}>
                      <b>{entry.title}</b>
                      <small className="muted">{[entry.type, entry.date].filter(Boolean).join(" · ")}</small>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>

          {details.fields.length ? (
            <details className="site-all-fields">
              <summary>All details from the portal ({details.fields.length})</summary>
              <dl>
                {details.fields.map(([label, text]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{text.replace(/\|\|/g, " › ")}</dd>
                  </div>
                ))}
              </dl>
            </details>
          ) : null}
          <small className="muted">Read from the portal {new Date(details.fetchedAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}.</small>
        </>
      ) : null}
    </div>
  );
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
export function SiteWatch({
  data,
  timeZone,
  run,
  reload,
  canEdit,
  canRun,
}: {
  data: SitesData;
  timeZone: string;
  run: (name: string) => (formData: FormData) => Promise<void>;
  reload: () => void;
  canEdit: boolean;
  canRun: boolean;
}) {
  const { portal, sites, tenders, runs, running, progress, stats } = data;
  const [allKeywords, setAllKeywords] = useState(false);
  const [tab, setTab] = useState("NEW");
  const [openRow, setOpenRow] = useState("");
  const [siteFilter, setSiteFilter] = useState("");
  const [query, setQuery] = useState("");
  const [siteTab, setSiteTab] = useState("ALL");
  const [siteQuery, setSiteQuery] = useState("");
  const [siteView, setSiteView] = useState<"SITES" | "LINKS">("SITES");
  const [category, setCategory] = useState("");
  const [repeatOnly, setRepeatOnly] = useState(false);
  const [handKind, setHandKind] = useState("");
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
  const keywords = portal.keywords
    .split(/[,\n;]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const excludes = (portal.excludeWords || "")
    .split(/[,\n;]+/)
    .map((word) => word.trim())
    .filter(Boolean);
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
        .reduce<
          Record<
            string,
            {
              keyword: string;
              total: number;
              open: number;
              added: number;
              sites: number;
            }
          >
        >((acc, item) => {
          const entry = (acc[item.keyword] ??= {
            keyword: item.keyword,
            total: 0,
            open: 0,
            added: 0,
            sites: 0,
          });
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
  const failedSites = sites.filter((site) => site.method !== "MANUAL" && site.lastStatus === "FAILED");
  const emptySites = sites.filter((site) => site.method !== "MANUAL" && site.lastScanAt && site.lastStatus !== "FAILED" && site.matched === 0);
  const siteCount = (key: string) => {
    if (key === "ALL") return sites.length;
    if (key === "FAILED") return failedSites.length;
    if (key === "EMPTY") return emptySites.length;
    if (key === "AUTO") return automatic.length;
    return sites.length - automatic.length;
  };
  const siteNeedle = siteQuery.trim().toLowerCase();
  const inSiteTab = (site: WatchSite | undefined, key: string) => {
    if (!site) return key === "ALL" || key === "MANUAL";
    if (key === "FAILED") return site.method !== "MANUAL" && site.lastStatus === "FAILED";
    if (key === "EMPTY") return site.method !== "MANUAL" && Boolean(site.lastScanAt) && site.lastStatus !== "FAILED" && site.matched === 0;
    if (key === "AUTO") return site.method !== "MANUAL";
    if (key === "MANUAL") return site.method === "MANUAL";
    return true;
  };
  // Every row of the master sheet (several rows can share one website), tied to the website it is searched as.
  const links = data.links ?? [];
  const bare = (host: string) => host.toLowerCase().replace(/^www\./, "");
  const siteByHost = new Map(sites.map((site) => [bare(site.host), site]));
  const linkSite = (host: string) => siteByHost.get(bare(host));
  // The sheet's row number for each link, and every row that points at the same website.
  const rowsByHost = new Map<string, number[]>();
  links.forEach((link, index) => rowsByHost.set(bare(link.host), [...(rowsByHost.get(bare(link.host)) ?? []), index + 1]));
  const sheetRows = (host: string) => rowsByHost.get(bare(host)) ?? [];
  const repeatedHosts = [...rowsByHost.values()].filter((rows) => rows.length > 1);
  const mostRepeated = [...repeatedHosts].sort((x, y) => y.length - x.length)[0];
  const extraRows = repeatedHosts.reduce((sum, rows) => sum + rows.length - 1, 0);
  const handCounts = sites
    .filter((site) => site.method === "MANUAL")
    .reduce<Record<string, number>>((acc, site) => {
      const kind = handReason(site.note)?.kind ?? "OTHER";
      acc[kind] = (acc[kind] ?? 0) + 1;
      return acc;
    }, {});
  const autoLinks = links.filter((link) => inSiteTab(linkSite(link.host), "AUTO"));
  const matchedNow = read.reduce((sum, site) => sum + site.matched, 0);
  const categories = [...new Set([...links.map((link) => link.category), ...sites.map((site) => site.category)].filter(Boolean))]
    .map((name) => {
      const inCategory = sites.filter((site) => site.category === name);
      return {
        name,
        links: links.filter((link) => link.category === name).length,
        sites: inCategory.length,
        auto: inCategory.filter((site) => site.method !== "MANUAL").length,
        matched: inCategory.reduce((sum, site) => sum + (site.lastScanAt ? site.matched : 0), 0),
      };
    })
    .sort((a, b) => b.links - a.links);
  // Under "Check by hand": narrow to one reason (not reachable, needs a login, covered by a searched portal, …).
  const handFilter = siteTab === "MANUAL" ? handKind : "";
  const kindOf = (site: WatchSite | undefined) => (!site || site.method === "MANUAL" ? (handReason(site?.note)?.kind ?? "OTHER") : "");
  const handTabs = Object.keys(HAND_KIND)
    .map((kind) => ({
      kind,
      label: HAND_KIND[kind].label,
      sites: sites.filter((site) => site.method === "MANUAL" && kindOf(site) === kind).length,
      links: links.filter((link) => kindOf(linkSite(link.host)) === kind).length,
    }))
    .filter((row) => row.sites);
  const listedLinks = links
    .map((link, index) => ({ ...link, row: index + 1 }))
    .filter((link) => !repeatOnly || sheetRows(link.host).length > 1)
    .filter((link) => inSiteTab(linkSite(link.host), siteTab))
    .filter((link) => !handFilter || kindOf(linkSite(link.host)) === handFilter)
    .filter((link) => !category || link.category === category)
    .filter((link) => !siteNeedle || [link.title, link.url, link.category].join(" ").toLowerCase().includes(siteNeedle));
  const listed = sites
    .filter((site) => !repeatOnly || sheetRows(site.host).length > 1)
    .filter((site) => inSiteTab(site, siteTab))
    .filter((site) => !handFilter || kindOf(site) === handFilter)
    .filter((site) => !category || site.category === category)
    .filter((site) => !siteNeedle || [site.name, site.host, site.category].join(" ").toLowerCase().includes(siteNeedle));

  const searchState = (site: WatchSite | undefined) =>
    !site || site.method === "MANUAL"
      ? handReason(site?.note)
        ? `Check by hand - ${handReason(site?.note)!.label}`
        : "Check by hand"
      : site.lastStatus === "FAILED"
        ? "Searched - no answer"
        : !site.lastScanAt
          ? "Not searched yet"
          : site.enabled
            ? "Searched"
            : "Paused";
  const download = () => {
    const tabName = (SITE_TABS.find(([key]) => key === siteTab)?.[1] ?? "All").toLowerCase().replace(/\s+/g, "-");
    const parts = [
      siteView === "LINKS" ? "sheet-links" : "websites",
      tabName,
      category && category.toLowerCase().replace(/\s+/g, "-"),
      repeatOnly && "repeated",
      handFilter && HAND_KIND[handFilter]?.label.toLowerCase().replace(/\s+/g, "-"),
    ]
      .filter(Boolean)
      .join("-");
    const stamp = new Date().toISOString().slice(0, 10);
    if (siteView === "LINKS") {
      downloadCsv(
        `${parts}-${stamp}.csv`,
        ["Sheet row", "Title", "Link", "Classification", "Website", "Rows for this website", "Keyword search", "Matching tenders", "Tenders checked"],
        listedLinks.map((link) => {
          const site = linkSite(link.host);
          const searched = site && site.method !== "MANUAL" && site.lastScanAt;
          return [link.row, link.title, link.url, link.category, bare(link.host), sheetRows(link.host).join(" "), searchState(site), searched ? site.matched : "", searched ? site.checked : ""];
        }),
      );
      return;
    }
    // Check by hand: just the website, its link and why it is checked by hand.
    if (siteTab === "MANUAL") {
      downloadCsv(
        `${parts}-${stamp}.csv`,
        ["Website", "Link", "Reason"],
        listed.map((site) => {
          const reason = handReason(site.note);
          return [short(site.name), site.url, reason ? `${reason.label}: ${reason.text}` : ""];
        }),
      );
      return;
    }
    downloadCsv(
      `${parts}-${stamp}.csv`,
      [
        "Website",
        "Names in the sheet",
        "Link",
        "Classification",
        "How it is read",
        "Keyword search",
        "Last search",
        "Matching tenders",
        "Tenders checked",
        "Organisation lists",
        "Sheet rows",
        "Problem / why checked by hand",
      ],
      listed.map((site) => [
        short(site.name),
        links
          .filter((link) => bare(link.host) === bare(site.host))
          .map((link) => link.title)
          .filter((title, index, all) => all.indexOf(title) === index)
          .join(" | ") || site.name,
        site.method === "NIC" ? `${site.url}?page=FrontEndTendersByOrganisation&service=page` : site.url,
        site.category,
        METHOD[site.method],
        searchState(site),
        site.lastScanAt ? formatWhen(site.lastScanAt, timeZone) : "",
        site.lastScanAt && site.method !== "MANUAL" ? site.matched : "",
        site.lastScanAt && site.method !== "MANUAL" ? site.checked : "",
        site.method === "NIC" && site.lastScanAt ? site.organisations : "",
        sheetRows(site.host).join(" "),
        site.method === "MANUAL" ? (handReason(site.note)?.text ?? "") : (site.lastError || "").split("\n")[0],
      ]),
    );
  };

  return (
    <section className="panel gem-watch site-watch">
      <header className="gem-head">
        <span className="gem-logo site-logo" aria-hidden>
          WEB
        </span>
        <div>
          <h2>Tender sites watch</h2>
          <p className="muted">
            Searches the open tenders on the {sites.length} websites from the master list with the {keywords.length} sourcing keywords. {automatic.length} sites are read automatically (Coal India and
            its subsidiaries, NTPC, CPPP, IOCL and the state NIC portals list every organisation&apos;s tenders); the rest have no public list a program can read and are linked for checking by hand.
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
            <i
              style={{
                width: `${Math.max(4, (progress.done / Math.max(1, progress.sites)) * 100)}%`,
              }}
            />
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
            of {automatic.length} automatic · {sites.length} in the list
            {read.length - readOk.length ? ` · ${read.length - readOk.length} did not answer` : ""}
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
                      <i
                        style={{
                          width: `${Math.max(3, (row.total / topCount) * 100)}%`,
                        }}
                      />
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
                      <i
                        style={{
                          width: `${Math.max(3, (site.matched / (siteRanking[0]?.matched || 1)) * 100)}%`,
                        }}
                      />
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
              const open = openRow === item.id;
              return (
                <Fragment key={item.id}>
                  <tr className={open ? "site-row-open" : ""}>
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
                      <button
                        type="button"
                        className="site-expand"
                        aria-expanded={open}
                        title={open ? "Hide the details" : "Show the tender's details and documents"}
                        onClick={() => setOpenRow(open ? "" : item.id)}
                      >
                        <span className="site-caret" aria-hidden>
                          {open ? "▾" : "▸"}
                        </span>
                        <span className="gem-title">{item.title}</span>
                      </button>
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
                  {open ? (
                    <tr className="site-detail-row">
                      <td colSpan={7}>
                        <TenderDetailPanel item={item} site={site} />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="site-list">
        <div className="site-list-head">
          <div>
            <h3>Websites from the master sheet</h3>
            <small className="muted">
              {links.length || sites.length} rows in the sheet point to {sites.length} separate websites: {repeatedHosts.length} websites are listed more than once under different names{" "}
              {mostRepeated ? ` (for example ${links[mostRepeated[0] - 1]?.title} is on ${mostRepeated.length} rows)` : ""}, which adds {extraRows} repeated rows. {automatic.length} websites are
              searched with the keywords; the rest have no list a program can read.
            </small>
          </div>
        </div>
        <div className="site-sheet-counts">
          <div className="site-count">
            <b>{links.length || "—"}</b>
            <small>Links in the sheet</small>
          </div>
          <div className="site-count">
            <b>{sites.length}</b>
            <small>Separate websites</small>
          </div>
          <div className="site-count good">
            <b>{automatic.length}</b>
            <small>Searched with keywords</small>
            <span className="muted">{autoLinks.length} sheet links</span>
          </div>
          <div className="site-count">
            <b>{sites.length - automatic.length}</b>
            <small>Check by hand</small>
            <span className="muted">
              {Object.entries(handCounts)
                .map(([kind, count]) => `${count} ${HAND_KIND[kind]?.label.toLowerCase() ?? kind}`)
                .join(" · ") || `${links.length - autoLinks.length} sheet links`}
            </span>
          </div>
          <div className="site-count">
            <b>{failedSites.length}</b>
            <small>Search failed</small>
            <span className="muted">{emptySites.length} searched, no match</span>
          </div>
          <div className="site-count accent">
            <b>{fmt(matchedNow)}</b>
            <small>Matching, last pass</small>
            <span className="muted">of {fmt(totalChecked)} tenders</span>
          </div>
        </div>
        {categories.length ? (
          <div className="table-wrap flat site-cat">
            <table className="gem-table">
              <thead>
                <tr>
                  <th>Classification</th>
                  <th>Sheet links</th>
                  <th>Websites</th>
                  <th>Searched</th>
                  <th>By hand</th>
                  <th>Matching</th>
                </tr>
              </thead>
              <tbody>
                {categories.map((row) => (
                  <tr key={row.name} className={category === row.name ? "active" : ""}>
                    <td>
                      <button type="button" className="link-btn" title="Show only this classification in the list below" onClick={() => setCategory(category === row.name ? "" : row.name)}>
                        {row.name}
                      </button>
                    </td>
                    <td>{row.links}</td>
                    <td>{row.sites}</td>
                    <td>{row.auto}</td>
                    <td>{row.sites - row.auto}</td>
                    <td>{row.matched ? <b>{row.matched}</b> : "0"}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    <b>Total</b>
                  </td>
                  <td>
                    <b>{links.length}</b>
                  </td>
                  <td>
                    <b>{sites.length}</b>
                  </td>
                  <td>
                    <b>{automatic.length}</b>
                  </td>
                  <td>
                    <b>{sites.length - automatic.length}</b>
                  </td>
                  <td>
                    <b>{matchedNow}</b>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
        <div className="tabs gem-tabs site-view-tabs" role="tablist" aria-label="List">
          <button type="button" role="tab" aria-selected={siteView === "SITES"} className={`tab ${siteView === "SITES" ? "active" : ""}`} onClick={() => setSiteView("SITES")}>
            By website<span className="cnt">{sites.length}</span>
          </button>
          {links.length ? (
            <button type="button" role="tab" aria-selected={siteView === "LINKS"} className={`tab ${siteView === "LINKS" ? "active" : ""}`} onClick={() => setSiteView("LINKS")}>
              Sheet links<span className="cnt">{links.length}</span>
            </button>
          ) : null}
          {repeatedHosts.length ? (
            <button
              type="button"
              className={`tab ${repeatOnly ? "active" : ""}`}
              aria-pressed={repeatOnly}
              title="Only the websites that appear on more than one row of the sheet"
              onClick={() => setRepeatOnly((value) => !value)}
            >
              Repeated websites<span className="cnt">{repeatedHosts.length}</span>
            </button>
          ) : null}
          {category ? (
            <button type="button" className="tab active" title="Clear the classification filter" onClick={() => setCategory("")}>
              {category} ✕
            </button>
          ) : null}
        </div>
        <div className="site-list-head">
          <div>
            <h3>
              {siteView === "LINKS"
                ? `Sheet links (${listedLinks.length})`
                : siteTab === "FAILED"
                  ? `Search failed (${failedSites.length})`
                  : siteTab === "EMPTY"
                    ? `No search results (${emptySites.length})`
                    : `All websites (${sites.length})`}
            </h3>
            <small className="muted">
              {siteTab === "FAILED"
                ? "These websites did not answer, so nothing was read."
                : siteTab === "EMPTY"
                  ? "These websites were searched and none of the keywords matched."
                  : `${automatic.length} searched automatically · ${failedSites.length} failed · ${emptySites.length} with no matches · ${sites.length - automatic.length} to check by hand`}
            </small>
          </div>
          <div className="site-list-tools">
            <div className="tabs gem-tabs" role="tablist">
              {SITE_TABS.map(([key, label]) => (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={siteTab === key}
                  className={`tab ${siteTab === key ? "active" : ""}`}
                  onClick={() => {
                    setSiteTab(key);
                    setHandKind("");
                  }}
                >
                  {label}
                  <span className="cnt">{siteView === "LINKS" ? links.filter((link) => inSiteTab(linkSite(link.host), key)).length : siteCount(key)}</span>
                </button>
              ))}
            </div>
            <input
              type="search"
              placeholder={siteView === "LINKS" ? "Search title or link…" : "Search website…"}
              value={siteQuery}
              onChange={(event) => setSiteQuery(event.target.value)}
              aria-label="Search websites"
            />
            <button
              type="button"
              className="btn ghost"
              onClick={download}
              disabled={siteView === "LINKS" ? !listedLinks.length : !listed.length}
              title="Download the list as shown, with the tabs, classification and search applied"
            >
              Download ({siteView === "LINKS" ? listedLinks.length : listed.length})
            </button>
          </div>
        </div>
        {siteTab === "MANUAL" && handTabs.length ? (
          <div className="site-reason-tabs" role="group" aria-label="Why the website is checked by hand">
            <small className="muted">Why:</small>
            <button type="button" className={`tab ${!handKind ? "active" : ""}`} aria-pressed={!handKind} onClick={() => setHandKind("")}>
              All reasons<span className="cnt">{siteView === "LINKS" ? handTabs.reduce((sum, row) => sum + row.links, 0) : handTabs.reduce((sum, row) => sum + row.sites, 0)}</span>
            </button>
            {handTabs.map((row) => (
              <button
                key={row.kind}
                type="button"
                className={`tab ${handKind === row.kind ? "active" : ""}`}
                aria-pressed={handKind === row.kind}
                title={row.kind === "DOWN" ? "The address is gone, the site refused the connection, its certificate failed, or it did not answer" : undefined}
                onClick={() => setHandKind(handKind === row.kind ? "" : row.kind)}
              >
                <span className={`site-dot ${HAND_KIND[row.kind].tone}`} aria-hidden />
                {row.label}
                <span className="cnt">{siteView === "LINKS" ? row.links : row.sites}</span>
              </button>
            ))}
          </div>
        ) : null}
        {siteView === "LINKS" ? (
          <div className="table-wrap flat site-scroll">
            <table className="gem-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Title</th>
                  <th>Link</th>
                  <th>Classification</th>
                  <th>Keyword search</th>
                  <th>Found</th>
                </tr>
              </thead>
              <tbody>
                {listedLinks.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="empty">
                      No sheet link in this list.
                    </td>
                  </tr>
                ) : null}
                {listedLinks.map((link, index) => {
                  const site = linkSite(link.host);
                  const same = sheetRows(link.host);
                  const searched = site && site.method !== "MANUAL";
                  return (
                    <tr key={`${link.url}-${index}`}>
                      <td className="muted">{link.row}</td>
                      <td>
                        <b>{link.title || "—"}</b>
                        {same.length > 1 ? (
                          <small className="site-repeat" title={`Rows ${same.join(", ")} of the sheet are the same website`}>
                            {same[0] === link.row ? `First of ${same.length} rows for this website` : `Repeat of row ${same[0]} · ${same.length} rows for this website`}
                          </small>
                        ) : null}
                      </td>
                      <td className="site-url">
                        <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.url}>
                          {link.url.replace(/^https?:\/\//, "").replace(/\/$/, "")}
                        </a>
                      </td>
                      <td>{link.category || "—"}</td>
                      <td>
                        {searched ? (
                          <span className={`pill ${site.lastStatus === "FAILED" ? "bad" : site.enabled ? "good" : "neutral"}`}>
                            {site.lastStatus === "FAILED" ? "Searched · no answer" : site.enabled ? "Searched" : "Paused"}
                          </span>
                        ) : (
                          (() => {
                            const reason = handReason(site?.note);
                            return (
                              <span className={`pill ${reason?.tone ?? "neutral"}`} title={reason?.text}>
                                {reason ? (reason.kind === "COVERED" ? `Covered · ${reason.portal}` : reason.label) : "Check by hand"}
                              </span>
                            );
                          })()
                        )}
                      </td>
                      <td>
                        {searched && site.lastScanAt ? (
                          site.matched ? (
                            <button
                              type="button"
                              className="link-btn"
                              title="Show this website's matching tenders above"
                              onClick={() => {
                                setSiteFilter(site.id);
                                setTab("");
                                setQuery("");
                              }}
                            >
                              <b>{site.matched}</b> matching
                            </button>
                          ) : (
                            "0 matching"
                          )
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
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
                      {siteTab === "FAILED" ? "No website failed its last search." : siteTab === "EMPTY" ? "Every searched website returned at least one match." : "No website matches that search."}
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
                        {sheetRows(site.host).length > 1 ? (
                          <small
                            className="site-repeat"
                            title={links
                              .filter((link) => bare(link.host) === bare(site.host))
                              .map((link) => link.title)
                              .join(" · ")}
                          >
                            On {sheetRows(site.host).length} sheet rows
                          </small>
                        ) : null}
                      </td>
                      <td>{site.category || "—"}</td>
                      <td>
                        {site.method === "MANUAL" && handReason(site.note) ? (
                          <>
                            <span className={`pill ${handReason(site.note)!.tone}`}>{handReason(site.note)!.label}</span>
                            <small className="muted site-reason">{handReason(site.note)!.text}</small>
                          </>
                        ) : (
                          METHOD[site.method]
                        )}
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
                              <button
                                type="button"
                                className="link-btn"
                                title="Show this website's matching tenders above"
                                onClick={() => {
                                  setSiteFilter(site.id);
                                  setTab("");
                                }}
                              >
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
        )}
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
