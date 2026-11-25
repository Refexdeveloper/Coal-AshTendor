import { Fragment, lazy, Suspense, useEffect, useLayoutEffect, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { formatWhen } from "@client/utils/calendar";
import type { Portal } from "@client/lib/types";
import { apiUrl, postAction } from "@client/api/client";
import { downloadXlsx } from "@client/utils/xlsx";
import { ErrorNote, IgnoreDetail, IgnoreForm, IgnoredNote } from "@client/components/feature/ignore-form";
import { BidDocuments, type GemBid, type GemData } from "@client/pages/portals/GemWatch";
import { GemResults } from "@client/components/feature/gem-results";

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
  /** Documents on the imported tender (sent only for imported rows). */
  docCount?: number;
  ignoreReason?: string;
  ignoreComment?: string | null;
  ignoredByName?: string;
  ignoredAt?: Date | string | null;
  siteId: string;
  portalTenderId: string;
  refNo: string;
  title: string;
  organisation: string;
  link: string;
  publishedAt: Date | null;
  closingAt: Date | null;
  keyword: string;
  /** Ash or Coal when this search row was sent there. Empty follows the keyword heading. */
  sentLine?: string;
  /** The tender value on the portal's tender page, in rupees (null when the portal gives none). */
  tenderValue?: number | string | null;
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
/** A heading of the "Tender Sourcing Keywords" sheet and its searched keywords (the yellow rows are left out). */
export type KeywordGroup = {
  heading: string;
  keywords: string[];
  /** Tenders found by this heading must be worth more than this. */
  minCrore?: number;
  /** Coal (the sheet's Coal tab) or Ash (its Ash headings); "Other" for keywords under no heading. */
  type?: string;
};

/** The sheet's two kinds of work, in the order the filters list them. */
const KEYWORD_TYPES = ["Coal", "Ash"];
/** The type of the heading a matched keyword is under (the first one, when it is under two); "Other" when none. */
const typeOfKeyword = (groups: KeywordGroup[], keyword: string) => groups.find((group) => group.keywords.some((word) => word.toLowerCase() === keyword.trim().toLowerCase()))?.type || "Other";

/** "₹12.5 Cr" for a tender value in rupees, or a note when the portal gives none. */
const valueText = (value: SiteTender["tenderValue"]) =>
  value == null || value === "" || !Number(value) ? "Value not given" : `₹${(Number(value) / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 2 })} Cr`;

export type SitesData = {
  keywordGroups?: KeywordGroup[];
  /** The sheet's regional organisations (TVNL, CCL, Patratu…), filtered on the tender's organisation. */
  organisationFilters?: string[];
  portal: Portal & { excludeWords: string };
  sites: WatchSite[];
  tenders: SiteTender[];
  runs: Run[];
  stats?: {
    total: number;
    byStatus: Record<string, number>;
    newToday?: number;
    today?: string;
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
  ["AUTO", "Working"],
  ["MANUAL", "Check by hand"],
];
const RUN_TONE: Record<string, string> = {
  SUCCESS: "good",
  PARTIAL: "warn",
  FAILED: "bad",
  RUNNING: "info",
  INTERRUPTED: "neutral",
};
/** Excel sheet names are limited to 31 characters, so the long reason names get a short sheet name. */
const handSheet = (kind: string) => HAND_KIND[kind]?.label ?? kind;
/** "Not working" groups two reasons: the site is not reachable, or its URL is not related to tenders. */
const NOT_MATCHING = ["DOWN", "NO_LIST"];
const kindMatches = (kind: string, filter: string) => (filter === "NOT_MATCHING" ? NOT_MATCHING.includes(kind) : kind === filter);
const HAND_KIND: Record<string, { label: string; tone: string }> = {
  COVERED: { label: "Working but no tender list", tone: "good" },
  LOGIN: { label: "Needs a login", tone: "neutral" },
  CAPTCHA: { label: "Needs a CAPTCHA", tone: "neutral" },
  SCRIPT: { label: "In pending", tone: "neutral" },
  DOWN: { label: "Site not reachable", tone: "bad" },
  NO_LIST: { label: "URL not related to tender", tone: "neutral" },
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
const gemDocUrl = (bid: Pick<GemBid, "bidType" | "bidId">) => {
  const path = bid.bidType === 5 ? "showdirectradocumentPdf" : bid.bidType === 2 ? "showradocumentPdf" : "showbidDocument";
  return `https://bidplus.gem.gov.in/${path}/${bid.bidId}`;
};
function duration(start: Date, end: Date | null) {
  if (!end) return "";
  const seconds = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)} min ${seconds % 60} s` : `${seconds} s`;
}

/** Header rows get the blue style: a list's first row, and on the summary each heading row (the row after a blank one). */
function headerRow(rows: (string | number)[][], index: number) {
  if (rows[0]?.length > 1) return index === 0;
  return index > 0 && rows[index].length > 1 && rows[index - 1].length === 0;
}

/** A real Excel workbook (.xlsx) with one worksheet per table; header rows are bold white on blue. */
function downloadExcel(fileName: string, sheets: { name: string; rows: (string | number)[][] }[]) {
  downloadXlsx(
    fileName,
    sheets.map((sheet) => ({
      name: sheet.name,
      rows: sheet.rows,
      styles: sheet.rows.map((_, index) => (headerRow(sheet.rows, index) ? "h" : index === 0 && sheet.name === "Summary" ? "t" : "")),
      freezeHeader: sheet.name !== "Summary",
    })),
  );
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

/** Puts a search row into the Ash or Coal list on this page. It does not create a pipeline tender. */
function SendLine({ action, idName, id, sent }: { action: (formData: FormData) => Promise<void>; idName: string; id: string; sent?: string }) {
  return (
    <span className="site-send">
      {(["Ash", "Coal"] as const).map((line) => (
        <form key={line} action={action}>
          <input type="hidden" name="intent" value="send-line" />
          <input type="hidden" name={idName} value={id} />
          <input type="hidden" name="line" value={line} />
          <button className={`btn ${line === "Coal" ? "ghost" : ""}`} type="submit" disabled={sent === line} title={`Show this search result under ${line}. It is not added to the pipeline.`}>
            {sent === line ? `In ${line}` : `Send for ${line}`}
          </button>
        </form>
      ))}
    </span>
  );
}

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
/** Scrolls to an element once it is on the page (the tender's portal details load after the row opens). */
function scrollWhenReady(id: string, tries = 40) {
  const element = document.getElementById(id);
  if (element) return element.scrollIntoView({ behavior: "smooth", block: "center" });
  if (tries > 0) window.setTimeout(() => scrollWhenReady(id, tries - 1), 400);
}

/** What the document panel needs from a website tender; the tender page passes the same shape. */
export type DocItem = { id: string; tenderId?: string | null; portalTenderId: string };

export function DocumentAccess({ item, onImported }: { item: DocItem; onImported?: () => void }) {
  const navigate = useNavigate();
  const [importing, setImporting] = useState(false);
  const [added, setAdded] = useState<Record<number, { status: string; note: string }>>({});
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
      if (next.unlocked) {
        setViewing(0);
        if (item.tenderId) void importWithDocuments(next.documents, next.token);
      }
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
        const firstPdf = next.documents.findIndex((doc: { name: string }) => /\.pdf$/i.test(doc.name));
        setViewing(firstPdf >= 0 ? firstPdf : null);
        // On a tender, the code is all the person has to do: the files go on the tender and Unfyd extracts them.
        if (item.tenderId) void importWithDocuments(next.documents, state.token);
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
  /** Creates the tender (or adds to it) with every document opened here; Unfyd OCR reads them, and the tender page opens. */
  /**
   * Adds the portal's files to the tender one at a time (creating the tender first when it is not added yet), so each
   * file shows its own result: added, skipped with the reason (an archive, too large), or the portal's error.
   */
  const importWithDocuments = async (documents = state?.documents, token = state?.token) => {
    if (!documents || !token) return;
    setImporting(true);
    setError("");
    let tenderId = item.tenderId ?? "";
    if (!tenderId) {
      const form = new FormData();
      form.set("intent", "import");
      form.set("siteTenderId", item.id);
      const result = await postAction("site-watch", form);
      if (result?.error || !result?.tenderId) {
        setImporting(false);
        return setError(result?.error || "The tender could not be added.");
      }
      tenderId = result.tenderId;
    }
    let addedCount = 0;
    for (const doc of documents) {
      if (added[doc.index]?.status === "ADDED" || added[doc.index]?.status === "EXISTS") continue;
      setAdded((current) => ({ ...current, [doc.index]: { status: "WORKING", note: "Downloading and adding…" } }));
      try {
        const result = (await post(`${base}/${token}/${doc.index}/attach`)) as { status: string; note: string };
        if (result.status === "ADDED") addedCount += 1;
        setAdded((current) => ({ ...current, [doc.index]: result }));
      } catch (reason) {
        setAdded((current) => ({ ...current, [doc.index]: { status: "FAILED", note: reason instanceof Error ? reason.message : String(reason) } }));
      }
    }
    setImporting(false);
    if (!addedCount) return setError("No document was added. See the reason next to each file; download those and upload them on the tender instead.");
    if (onImported) return onImported();
    navigate(`/tenders/${tenderId}?notice=${encodeURIComponent(`${addedCount} document${addedCount === 1 ? "" : "s"} added from the portal; Unfyd is extracting the tender data.`)}`);
  };
  const current = state && viewing !== null ? state.documents[viewing] : null;

  if (!state) {
    return (
      <div className="site-doc-access">
        <button type="button" className="btn" onClick={start} disabled={busy}>
          {busy ? "Opening the portal…" : item.tenderId ? "Get these documents into the tender" : "Open the documents here"}
        </button>
        <small className="muted">
          The portal asks for its security code (CAPTCHA) before any file downloads. The code is shown here; type it once{item.tenderId ? " and the documents are added to the tender automatically" : ", then view the files or import the tender with them"}. Unfyd extracts the tender data from them.
        </small>
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
        <>
        <div className="site-doc-import">
          <button type="button" className="btn" onClick={() => void importWithDocuments()} disabled={importing}>
            {importing ? "Adding the documents and extracting…" : item.tenderId ? "Add these documents to the tender" : "Import as tender with these documents"}
          </button>
          <small className="muted">The documents go on the tender and Unfyd extracts the tender data from them. The tender page opens with the documents and the extracted data.</small>
        </div>
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
              {added[doc.index] ? <small className={`site-doc-added ${added[doc.index].status.toLowerCase()}`}>{added[doc.index].note}</small> : null}
            </li>
          ))}
        </ul>
        </>
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
      <IgnoreDetail item={item} />
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
              {site?.method === "NIC" && details.documents.length ? (
                <div id={`docs-${item.id}`}>
                  <DocumentAccess item={item} />
                </div>
              ) : null}
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
/**
 * The master-sheet websites section is shown first on the Portals page: it is rendered into the page's
 * #websites-top slot (same component, so its filters still drive the lists below), or in place when there is no slot.
 */
const RESULT_VIEWS: ["found" | "approved" | "rejected" | "today", string][] = [
  ["found", "All found"],
  ["approved", "Approved"],
  ["rejected", "Rejected"],
  ["today", "New today"],
];
const RESULT_TITLE: Record<string, string> = {
  found: "Total tenders in search",
  approved: "Approved",
  conversion: "Approved",
  rejected: "Rejected",
  ignored: "Rejected on review",
  excluded: "Filtered out automatically (exclude words, below the heading's value, or closed)",
  today: "New tenders today",
};

function matchesResult(view: string, status: string, seen: Date | string, todayKey: string, zoneDay: (value: Date | string) => string) {
  // Excluded rows were filtered out by the search itself (an exclude word, or a value below the heading's amount):
  // nobody rejected them, so they are only in their own "filtered out" list, not in found, today or rejected.
  if (view === "excluded") return status === "EXCLUDED";
  if (status === "EXCLUDED") return false;
  if (view === "today") return zoneDay(seen) === todayKey;
  if (view === "approved" || view === "conversion") return status === "IMPORTED";
  if (view === "rejected") return status === "IGNORED";
  if (view === "ignored") return status === "IGNORED";
  // All found is the review list. Rejected rows stay on the Rejected tab.
  return status !== "IGNORED" && status !== "EXCLUDED";
}

/** Clicking a row opens it, except clicks on its links, buttons and forms. */
function rowToggle(toggle: () => void) {
  return (event: { target: EventTarget | null }) => {
    if (event.target instanceof Element && event.target.closest("a, button, form, input, select, textarea, label")) return;
    toggle();
  };
}

/** A GeM bid's full details in the opened row: the facts, the bid result once it has closed, and its documents. */
function GemBidDetail({ bid, timeZone }: { bid: GemBid; timeZone: string }) {
  const closed = Boolean(bid.endAt && new Date(bid.endAt).getTime() < Date.now());
  const facts: [string, ReactNode][] = [
    ["Bid number", bid.bidNumber],
    ["Item / service", bid.title],
    ["Ministry", bid.ministry || "—"],
    ["Department", bid.department && bid.department !== "NA" ? bid.department : "—"],
    ["Quantity", bid.quantity ?? "—"],
    ["Bid opens", bid.startAt ? formatWhen(bid.startAt, timeZone) : "—"],
    ["Bid closes", bid.endAt ? formatWhen(bid.endAt, timeZone) : "—"],
    ["Matched keyword", bid.keyword || "—"],
    ["Found on", formatWhen(bid.firstSeenAt, timeZone)],
    ["Status", STATUS[bid.status].label],
  ];
  return (
    <div className="mix-detail">
      <IgnoreDetail item={bid} />
      <dl className="mix-facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {bid.status === "IGNORED" ? <IgnoredNote item={bid} /> : null}
      {closed ? <GemResults gemBidId={bid.id} /> : null}
      <BidDocuments bid={bid} />
    </div>
  );
}

const lower = (value: string) => value.trim().toLowerCase();
/** The heading's keywords, or null when no heading is picked. */
const headingWords = (groups: KeywordGroup[], heading: string) => {
  const group = groups.find((item) => item.heading === heading);
  return group ? new Set(group.keywords.map(lower)) : null;
};
/** The organisation name as a whole word ("CCL" is not inside "NCCL"). */
const fromOrganisation = (text: string, name: string) =>
  !name || new RegExp(`(^|[^a-z0-9])${name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(text.toLowerCase());

/**
 * Heading, keyword and organisation filters from the sourcing sheet. Picking a heading narrows the keyword list to
 * that heading's keywords; the count beside each keyword is how many tenders in the list matched it.
 */
function SheetFilters({
  groups,
  organisations,
  found,
  rowTypes,
  type,
  setType,
  heading,
  keyword,
  organisation,
  setHeading,
  setKeyword,
  setOrganisation,
  labelled = false,
}: {
  groups: KeywordGroup[];
  organisations: string[];
  /** The matched keyword of every row in the list (before these filters). */
  found: string[];
  /** Ash or Coal for each row in `found`, when someone sent that row. Same length as `found`. */
  rowTypes?: string[];
  /** Coal / Ash (the sheet's tabs); "" for both. */
  type: string;
  setType: (value: string) => void;
  heading: string;
  keyword: string;
  organisation: string;
  setHeading: (value: string) => void;
  setKeyword: (value: string) => void;
  setOrganisation: (value: string) => void;
  labelled?: boolean;
}) {
  const counts = new Map<string, number>();
  for (const word of found) if (word) counts.set(lower(word), (counts.get(lower(word)) ?? 0) + 1);
  const inHeading = headingWords(groups, heading);
  const headingCount = (group: KeywordGroup) => group.keywords.reduce((sum, word) => sum + (counts.get(lower(word)) ?? 0), 0);
  const typeAt = (word: string, index: number) => rowTypes?.[index] || typeOfKeyword(groups, word);
  const typeCount = (name: string) => found.filter((word, index) => typeAt(word, index) === name).length;
  const types = [...KEYWORD_TYPES, ...(found.some((word, index) => typeAt(word, index) === "Other") ? ["Other"] : [])];
  const shownGroups = type ? groups.filter((group) => (group.type || "Other") === type) : groups;
  const options = inHeading
    ? (groups.find((item) => item.heading === heading)?.keywords ?? [])
    : [...new Map(found.filter((word, index) => word && (!type || typeAt(word, index) === type)).map((word) => [lower(word), word])).values()].sort((a, b) => a.localeCompare(b));
  const wrap = (label: string, control: ReactNode) => (labelled ? <label>{label}{control}</label> : control);
  return (
    <>
      {groups.length
        ? wrap(
            "Type",
            <select
              value={type}
              aria-label="Coal or Ash"
              onChange={(event) => {
                setType(event.target.value);
                setHeading("");
                setKeyword("");
              }}
            >
              <option value="">Coal and Ash</option>
              {types.map((name) => (
                <option key={name} value={name}>
                  {name} ({typeCount(name)})
                </option>
              ))}
            </select>,
          )
        : null}
      {groups.length
        ? wrap(
            "Heading",
            <select
              value={heading}
              aria-label="Keyword heading"
              onChange={(event) => {
                setHeading(event.target.value);
                setKeyword("");
              }}
            >
              <option value="">{type ? `All ${type} headings` : "All headings"}</option>
              {shownGroups.map((group) => (
                <option key={group.heading} value={group.heading}>
                  {group.heading}
                  {group.minCrore ? ` · above ₹${group.minCrore} Cr` : ""} ({headingCount(group)})
                </option>
              ))}
            </select>,
          )
        : null}
      {wrap(
        "Keyword",
        <select value={keyword} aria-label="Keyword" onChange={(event) => setKeyword(event.target.value)}>
          <option value="">{inHeading ? `All ${heading} keywords` : "All keywords"}</option>
          {options.map((word) => (
            <option key={word} value={word}>
              {word} ({counts.get(lower(word)) ?? 0})
            </option>
          ))}
        </select>,
      )}
      {organisations.length
        ? wrap(
            "Organisation",
            <select value={organisation} aria-label="Organisation" onChange={(event) => setOrganisation(event.target.value)}>
              <option value="">All organisations</option>
              {organisations.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>,
          )
        : null}
    </>
  );
}

/** Where a keyword without a heading goes (the server uses the same name). */
const OTHER_HEADING = "Other keywords";

/**
 * The words both searches use (the tender websites and GeM), under the sheet's headings: add a keyword to a heading
 * (or a new heading with its own minimum value), take one off, add or remove an exclude word, and run both searches
 * again. An exclude word applies at once to the results already found; a new keyword needs a run.
 */
function SearchWords({
  groups,
  excludes,
  running,
  canEdit,
  run,
}: {
  groups: KeywordGroup[];
  excludes: string[];
  running: boolean;
  canEdit: boolean;
  run: (formData: FormData) => Promise<void>;
}) {
  const [heading, setHeading] = useState(groups[0]?.heading ?? OTHER_HEADING);
  const [openAll, setOpenAll] = useState<boolean | null>(null);
  // The heading list and exclude chips open on demand, so the tender table stays right under the add / exclude row.
  const [manage, setManage] = useState(false);
  const total = groups.reduce((sum, group) => sum + group.keywords.length, 0);
  const headings: KeywordGroup[] = groups.some((group) => group.heading === OTHER_HEADING) ? groups : [...groups, { heading: OTHER_HEADING, keywords: [], minCrore: 0, type: "Other" }];
  const remove = (intent: string, word: string, label: string) =>
    canEdit ? (
      <form action={run} className="sw-chip-form">
        <input type="hidden" name="intent" value={intent} />
        <input type="hidden" name="word" value={word} />
        <button type="submit" className="gem-chip-x" aria-label={`${label} ${word}`} title={label}>
          ×
        </button>
      </form>
    ) : null;
  const amount = (minCrore?: number) => (minCrore ? `above ₹${minCrore} Cr` : "any value");
  // "Expand all" / "Collapse all" re-mounts every heading with that state; otherwise each opens on its own.
  const block = (key: string, title: string, sub: string, words: string[]) => (
    <details key={`${key}-${openAll}`} className="sw-group" open={openAll ?? false}>
      <summary>
        <b>{title}</b>
        <span className="sw-group-meta">
          {sub} · {words.length} keyword{words.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div className="gem-chips">
        {words.length ? (
          words.map((word) => (
            <span key={word} className="gem-chip">
              {word}
              {remove("search-unkeyword", word, "Stop searching")}
            </span>
          ))
        ) : (
          <small className="muted">No keywords yet.</small>
        )}
      </div>
    </details>
  );
  return (
    <section className="search-words" aria-label="Search keywords">
      <div className="sw-actions">
        {canEdit ? (
          <form action={run} className="sw-add sw-add-keyword">
            <input type="hidden" name="intent" value="search-keyword" />
            <input name="word" placeholder="New keyword, e.g. fly ash lifting" aria-label="New search keyword" required maxLength={120} />
            <select name="heading" aria-label="Heading for the keyword" value={heading} onChange={(event) => setHeading(event.target.value)}>
              {[...KEYWORD_TYPES, "Other"].map((name) => {
                const list = headings.filter((group) => (group.type || "Other") === name);
                return list.length ? (
                  <optgroup key={name} label={name}>
                    {list.map((group) => (
                      <option key={group.heading} value={group.heading}>
                        {group.heading} ({amount(group.minCrore)})
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
              <option value="__new">＋ New heading…</option>
            </select>
            {heading === "__new" ? (
              <>
                <input name="newHeading" placeholder="Heading name" aria-label="New heading name" required maxLength={80} />
                <input name="minCrore" type="number" min={0} step="0.5" placeholder="Min ₹ Cr" aria-label="Minimum tender value in crore" className="sw-crore" />
                <select name="type" aria-label="Coal or Ash heading" defaultValue="Coal" className="sw-type">
                  {KEYWORD_TYPES.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </>
            ) : null}
            <button type="submit" className="btn">
              Add keyword
            </button>
          </form>
        ) : null}
        {canEdit ? (
          <form action={run} className="sw-add sw-add-exclude">
            <input type="hidden" name="intent" value="search-exclude" />
            <input name="word" placeholder="Exclude word, e.g. spares" aria-label="New exclude word" required maxLength={120} />
            <button type="submit" className="btn ghost">
              Exclude word
            </button>
          </form>
        ) : null}
        <button type="button" className="btn ghost sw-manage" aria-expanded={manage} onClick={() => setManage((value) => !value)}>
          {manage ? "Hide keywords ▴" : `Keywords (${total}) · Excluding (${excludes.length}) ▾`}
        </button>
        <form action={run} className="sw-run">
          <input type="hidden" name="intent" value="search-run" />
          <button type="submit" className="btn" disabled={running}>
            {running ? "Searching…" : "↻ Re-run search"}
          </button>
        </form>
      </div>

      {manage ? (
      <div className="sw-panel">
      <div className="sw-groups-head">
        <span className="gem-chip-label">
          Searching {total} keywords under {groups.length} headings
        </span>
        <button type="button" className="link-btn" onClick={() => setOpenAll((value) => !value)}>
          {openAll ? "Collapse all" : "Expand all"}
        </button>
      </div>
      {[...KEYWORD_TYPES, "Other"].map((name) => {
        const list = groups.filter((group) => (group.type || "Other") === name);
        if (!list.length) return null;
        const words = list.reduce((sum, group) => sum + group.keywords.length, 0);
        return (
          <div key={name} className="sw-type-block">
            <h5 className="sw-type-title">
              {name}
              <small className="muted">
                {" "}
                · {list.length} heading{list.length === 1 ? "" : "s"} · {words} keywords
              </small>
            </h5>
            <div className="sw-groups">{list.map((group) => block(group.heading, group.heading, amount(group.minCrore), group.keywords))}</div>
          </div>
        );
      })}

      <div className="sw-excludes">
        <div className="gem-chips sw-chips">
          <span className="gem-chip-label">Excluding ({excludes.length})</span>
          {excludes.length ? (
            excludes.map((word) => (
              <span key={word} className="gem-chip off">
                {word}
                {remove("search-unexclude", word, "Stop excluding")}
              </span>
            ))
          ) : (
            <small className="muted">No exclude words.</small>
          )}
        </div>
      </div>
      <small className="muted">
        The websites and GeM are searched with these same headings, amounts and exclude words (a GeM bid&apos;s value is its Estimated Bid Value). A heading&apos;s tenders are kept only above its value. An exclude word hides matching results straight away; a new keyword is
        searched when you re-run.
      </small>
      </div>
      ) : null}
    </section>
  );
}

/** GeM bids and searched-website tenders in one list, filtered by the search-result card. */
function SearchMix({
  view,
  onView,
  tenders,
  bids,
  gemTenders,
  siteOf,
  timeZone,
  todayKey,
  zoneDay,
  canRun,
  run,
  groups,
  organisations,
  words,
  type,
  setType,
}: {
  /** Coal / Ash filter, kept by the page so the Total card's Coal and Ash counts can open the list on one. */
  type: string;
  setType: (value: string) => void;
  groups: KeywordGroup[];
  organisations: string[];
  /** The search-keyword row, shown between the list title and its filters. */
  words?: ReactNode;
  view: string;
  onView: (view: "found" | "approved" | "rejected" | "today") => void;
  tenders: SiteTender[];
  bids: GemBid[];
  gemTenders: { id: string; recordId: string }[];
  siteOf: (id: string) => WatchSite | undefined;
  timeZone: string;
  todayKey: string;
  zoneDay: (value: Date | string) => string;
  canRun: boolean;
  run: (name: string) => (formData: FormData) => Promise<void>;
}) {
  const statusRows = [
    ...tenders
      .filter((item) => matchesResult(view, item.status, item.firstSeenAt, todayKey, zoneDay))
      .map((item) => ({ kind: "site" as const, at: new Date(item.firstSeenAt).getTime(), item })),
    ...bids
      .filter((bid) => matchesResult(view, bid.status, bid.firstSeenAt, todayKey, zoneDay))
      .map((bid) => ({ kind: "gem" as const, at: new Date(bid.firstSeenAt).getTime(), bid })),
  ].sort((a, b) => {
    const open = (row: typeof a) => {
      const at = row.kind === "site" ? row.item.closingAt : row.bid.endAt;
      return !at || new Date(at).getTime() >= Date.now();
    };
    return Number(open(b)) - Number(open(a)) || b.at - a.at;
  });
  const [openKey, setOpenKey] = useState("");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [source, setSource] = useState<"" | "site" | "gem">("");
  const [keyword, setKeyword] = useState("");
  const [heading, setHeading] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const inHeading = headingWords(groups, heading);
  const lineOf = (row: (typeof statusRows)[number]) => {
    const sent = row.kind === "site" ? row.item.sentLine : row.bid.sentLine;
    if (sent === "Ash" || sent === "Coal") return sent;
    return typeOfKeyword(groups, row.kind === "site" ? row.item.keyword : row.bid.keyword);
  };
  const sourceRows = statusRows.filter((row) => !source || row.kind === source);
  const rows = sourceRows.filter((row) => {
    const word = row.kind === "site" ? row.item.keyword : row.bid.keyword;
    if (type && lineOf(row) !== type) return false;
    if (keyword && lower(word) !== lower(keyword)) return false;
    if (inHeading && !inHeading.has(lower(word))) return false;
    if (organisation && !fromOrganisation(row.kind === "site" ? `${row.item.organisation} ${row.item.title}` : `${row.bid.department} ${row.bid.ministry} ${row.bid.title}`, organisation)) return false;
    if (!needle) return true;
    const text =
      row.kind === "site"
        ? [row.item.title, row.item.organisation, row.item.keyword, row.item.portalTenderId, row.item.refNo, siteOf(row.item.siteId)?.name, siteOf(row.item.siteId)?.host].join(" ")
        : [row.bid.title, row.bid.department, row.bid.ministry, row.bid.keyword, row.bid.bidNumber].join(" ");
    return text.toLowerCase().includes(needle);
  });
  const gemCount = rows.filter((row) => row.kind === "gem").length;
  const siteCount = rows.length - gemCount;
  const filterOn = (key: string) => view === key || (key === "approved" && view === "conversion") || (key === "rejected" && view === "ignored");
  const activeFilters = [
    source ? { key: "source", label: source === "gem" ? "GeM" : "Websites", clear: () => setSource("") } : null,
    type ? { key: "type", label: type, clear: () => (setType(""), setHeading(""), setKeyword("")) } : null,
    heading ? { key: "heading", label: heading, clear: () => (setHeading(""), setKeyword("")) } : null,
    keyword ? { key: "keyword", label: keyword, clear: () => setKeyword("") } : null,
    organisation ? { key: "organisation", label: organisation, clear: () => setOrganisation("") } : null,
    needle ? { key: "q", label: q.trim(), clear: () => setQ("") } : null,
  ].filter((item): item is { key: string; label: string; clear: () => void } => Boolean(item));
  const clearFilters = () => {
    setSource("");
    setType("");
    setKeyword("");
    setHeading("");
    setOrganisation("");
    setQ("");
  };
  // A new filter starts again on the first page.
  useEffect(() => setPage(1), [view, source, type, keyword, heading, organisation, q]);
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  const shownRows = rows.slice((current - 1) * size, current * size);
  const goTo = (next: number) => {
    setPage(Math.min(Math.max(1, next), pages));
    setOpenKey("");
    (document.getElementById("search-results-table") || document.getElementById("search-mix"))?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };
  const pager =
    rows.length > 0 ? (
      <nav className="mix-pager" aria-label="Pages">
        <span className="muted">
          {fmt((current - 1) * size + 1)}–{fmt(Math.min(current * size, rows.length))} of {fmt(rows.length)}
        </span>
        <label>
          Rows
          <select
            value={size}
            onChange={(event) => {
              setSize(Number(event.target.value));
              setPage(1);
            }}
          >
            {[10, 25, 50, 100].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <span className="mix-pages">
          <button type="button" className="btn ghost" onClick={() => goTo(1)} disabled={current === 1} aria-label="First page">
            «
          </button>
          <button type="button" className="btn ghost" onClick={() => goTo(current - 1)} disabled={current === 1}>
            ‹ Prev
          </button>
          {Array.from({ length: pages }, (_, index) => index + 1)
            .filter((n) => n === 1 || n === pages || Math.abs(n - current) <= 1)
            .map((n, index, list) => (
              <Fragment key={n}>
                {index > 0 && n - list[index - 1] > 1 ? <span className="muted">…</span> : null}
                <button type="button" className={`btn ghost${n === current ? " is-on" : ""}`} aria-current={n === current ? "page" : undefined} onClick={() => goTo(n)}>
                  {n}
                </button>
              </Fragment>
            ))}
          <button type="button" className="btn ghost" onClick={() => goTo(current + 1)} disabled={current === pages}>
            Next ›
          </button>
          <button type="button" className="btn ghost" onClick={() => goTo(pages)} disabled={current === pages} aria-label="Last page">
            »
          </button>
        </span>
      </nav>
    ) : null;
  return (
    <div className="search-mix" id="search-mix">
      <div className="site-list-head" id="search-results-table">
        <div>
          <h3>{RESULT_TITLE[view] ?? "Tenders"}</h3>
          <small className="muted">
            {fmt(rows.length)} in this list · {fmt(siteCount)} from searched websites · {fmt(gemCount)} from GeM. Both sources are in this table.
          </small>
        </div>
      </div>
      {/* One compact row (add keyword, exclude word, re-run); the full keyword list opens only on request. */}
      {words}
      <div className="tabs gem-tabs" role="tablist" aria-label="Tender list filter">
        {RESULT_VIEWS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={filterOn(key)} className={`tab ${filterOn(key) ? "active" : ""}`} onClick={() => onView(key)}>
            {label}
          </button>
        ))}
      </div>
      <div className="gem-toolbar">
        <div className="gem-toolbar-end mix-filters-bar">
          <label>
            Source
            <select value={source} onChange={(event) => setSource(event.target.value as "" | "site" | "gem")}>
              <option value="">All sources</option>
              <option value="site">Websites</option>
              <option value="gem">GeM</option>
            </select>
          </label>
          <SheetFilters
            labelled
            groups={groups}
            organisations={organisations}
            found={sourceRows.map((row) => (row.kind === "site" ? row.item.keyword : row.bid.keyword))}
            rowTypes={sourceRows.map((row) => lineOf(row))}
            type={type}
            setType={setType}
            heading={heading}
            keyword={keyword}
            organisation={organisation}
            setHeading={setHeading}
            setKeyword={setKeyword}
            setOrganisation={setOrganisation}
          />
          <label className="mix-search">
            Search
            <input type="search" placeholder="Title, organisation, number…" value={q} onChange={(event) => setQ(event.target.value)} />
            {q ? (
              <button type="button" className="mix-search-x" aria-label="Clear search" onClick={() => setQ("")}>
                ×
              </button>
            ) : null}
          </label>
        </div>
      </div>
      {activeFilters.length ? (
        <div className="gem-chips mix-active">
          <span className="gem-chip-label">Showing</span>
          {activeFilters.map((item) => (
            <span key={item.key} className="gem-chip">
              {item.label}
              <button type="button" className="gem-chip-x" aria-label={`Remove ${item.label}`} onClick={item.clear}>
                ×
              </button>
            </span>
          ))}
          <button type="button" className="link-btn" onClick={clearFilters}>
            Clear all
          </button>
        </div>
      ) : null}
      <div className="table-wrap flat">
        <table className="gem-table">
          <thead>
            <tr>
              <th>Source</th>
              <th>Tender</th>
              <th>Organisation</th>
              <th>Keyword · value</th>
              <th>Closes</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  No tenders in this filter.
                </td>
              </tr>
            ) : null}
            {shownRows.map((row) => {
              if (row.kind === "site") {
                const item = row.item;
                const site = siteOf(item.siteId);
                const closed = Boolean(item.closingAt && new Date(item.closingAt).getTime() < Date.now());
                const href = portalLink(site, item);
                const key = `site-${item.id}`;
                const open = openKey === key;
                return (
                  <Fragment key={key}>
                  <tr className={`mix-row${open ? " site-row-open" : ""}`} onClick={rowToggle(() => setOpenKey(open ? "" : key))} title={open ? "Click to hide the details" : "Click to see the full details and documents"}>
                    <td className="gem-number">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer">
                          {site ? short(site.name) : "Website"}
                        </a>
                      ) : (
                        short(site?.name ?? "Website")
                      )}
                      <small className="muted">{site?.host}</small>
                    </td>
                    <td>
                      <span className="gem-title">
                        <span className="site-caret" aria-hidden>
                          {open ? "▾ " : "▸ "}
                        </span>
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
                      <small className={`site-value ${item.tenderValue ? "" : "muted"}`}>{valueText(item.tenderValue)}</small>
                    </td>
                    <td className={closed ? "text-bad" : ""}>
                      {item.closingAt ? formatWhen(item.closingAt, timeZone) : "—"}
                      {closed ? <small>closed</small> : null}
                    </td>
                    <td>
                      <span className={`pill ${STATUS[item.status].tone}`}>{STATUS[item.status].label}</span>
                      {item.error ? <ErrorNote text={item.error} href={item.status === "IMPORTED" ? portalLink(siteOf(item.siteId), item) : ""} /> : null}
                      {item.status === "IGNORED" ? <IgnoredNote item={item} /> : null}
                    </td>
                    <td className="gem-row-actions">
                      {item.tenderId ? (
                        <Link className="btn ghost" to={`/tenders/${item.tenderId}`}>
                          Open tender
                        </Link>
                      ) : null}
                      {canRun && item.status === "IMPORTED" && item.docCount === 0 && site?.method !== "NIC" ? (
                        <Link className="btn" to={`/tenders/${item.tenderId}`} onClick={(event) => event.stopPropagation()}>
                          Upload documents
                        </Link>
                      ) : null}
                      {canRun && item.status === "IMPORTED" && item.docCount === 0 && site?.method === "NIC" ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenKey(key);
                            scrollWhenReady(`docs-${item.id}`);
                          }}
                        >
                          Get documents
                        </button>
                      ) : null}
                      {canRun && item.status !== "IMPORTED" ? (
                        <form action={run("site-watch")} className="site-import-form">
                          <input type="hidden" name="intent" value="import" />
                          <input type="hidden" name="siteTenderId" value={item.id} />
                          <input type="hidden" name="openTender" value="1" />
                          <label className="btn ghost site-import-files" title="Tender file. No portal code is needed. It is stored as the tender document." data-count="">
                            Tender file
                            <input
                              type="file"
                              name="files"
                              multiple
                              accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.xlsx,.xls,.txt"
                              onChange={(event) => {
                                const count = event.currentTarget.files?.length ?? 0;
                                event.currentTarget.parentElement!.dataset.count = count ? ` (${count})` : "";
                              }}
                            />
                          </label>
                          <button className="btn" type="submit">
                            {item.status === "FAILED" ? "Retry" : "Import as tender"}
                          </button>
                        </form>
                      ) : null}
                      {canRun && item.status !== "IGNORED" && item.status !== "EXCLUDED" ? <SendLine action={run("site-watch")} idName="siteTenderId" id={item.id} sent={item.sentLine} /> : null}
                      {canRun && item.status === "NEW" ? <IgnoreForm action={run("site-watch")} idName="siteTenderId" id={item.id} /> : null}
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
              }
              const bid = row.bid;
              const closed = Boolean(bid.endAt && new Date(bid.endAt).getTime() < Date.now());
              const tender = gemTenders.find((item) => item.id === bid.tenderId);
              const key = `gem-${bid.id}`;
              const open = openKey === key;
              return (
                <Fragment key={key}>
                <tr className={`mix-row${open ? " site-row-open" : ""}`} onClick={rowToggle(() => setOpenKey(open ? "" : key))} title={open ? "Click to hide the details" : "Click to see the full details and documents"}>
                  <td className="gem-number">
                    <a href={gemDocUrl(bid)} target="_blank" rel="noreferrer">
                      GeM
                    </a>
                    <small className="muted">{bid.bidNumber}</small>
                  </td>
                  <td>
                    <span className="gem-title" title={bid.title}>
                      <span className="site-caret" aria-hidden>
                        {open ? "▾ " : "▸ "}
                      </span>
                      {bid.title}
                    </span>
                  </td>
                  <td>
                    {bid.department && bid.department !== "NA" ? bid.department : "—"}
                    <small className="muted">{bid.ministry}</small>
                  </td>
                  <td>
                    <span className="gem-chip small">{bid.keyword}</span>
                    <small className={`site-value ${bid.bidValue ? "" : "muted"}`}>{valueText(bid.bidValue)}</small>
                  </td>
                  <td className={closed ? "text-bad" : ""}>
                    {bid.endAt ? formatWhen(bid.endAt, timeZone) : "—"}
                    {closed ? <small>closed</small> : null}
                  </td>
                  <td>
                    <span className={`pill ${STATUS[bid.status].tone}`}>{STATUS[bid.status].label}</span>
                    {bid.error ? <ErrorNote text={bid.error} /> : null}
                    {bid.status === "IGNORED" ? <IgnoredNote item={bid} /> : null}
                  </td>
                  <td className="gem-row-actions">
                    {tender ? (
                      <Link className="btn ghost" to={`/tenders/${tender.id}`}>
                        {tender.recordId}
                      </Link>
                    ) : null}
                    {canRun && bid.status !== "IMPORTED" ? (
                      <form action={run("gem")} className="site-import-form">
                        <input type="hidden" name="intent" value="import" />
                        <input type="hidden" name="bidId" value={bid.id} />
                        <input type="hidden" name="openTender" value="1" />
                        <label className="btn ghost site-import-files" title="Tender file. No portal code is needed. It is stored as the tender document." data-count="">
                          Tender file
                          <input
                            type="file"
                            name="files"
                            accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.doc,.docx,.txt"
                            onChange={(event) => {
                              const count = event.currentTarget.files?.length ?? 0;
                              event.currentTarget.parentElement!.dataset.count = count ? ` (${count})` : "";
                            }}
                          />
                        </label>
                        <button className="btn" type="submit">
                          {bid.status === "FAILED" ? "Retry import" : "Import as tender"}
                        </button>
                      </form>
                    ) : null}
                    {canRun && bid.status !== "IGNORED" && bid.status !== "EXCLUDED" ? <SendLine action={run("gem")} idName="bidId" id={bid.id} sent={bid.sentLine} /> : null}
                    {canRun && bid.status === "NEW" ? <IgnoreForm action={run("gem")} idName="bidId" id={bid.id} /> : null}
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
                      <GemBidDetail bid={bid} timeZone={timeZone} />
                    </td>
                  </tr>
                ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {pager}
    </div>
  );
}

function TopSlot({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => setSlot(document.getElementById("websites-top")), []);
  // Stay unmounted until the top slot exists, so a refresh never paints this block further down the page.
  return slot ? createPortal(children, slot) : null;
}

export function SiteWatch({
  data,
  gem,
  timeZone,
  run,
  reload,
  canEdit,
  canRun,
}: {
  data: SitesData;
  /** The GeM bid watch, shown with the websites since gem.gov.in is one of the sheet's websites. */
  gem?: GemData;
  timeZone: string;
  run: (name: string) => (formData: FormData) => Promise<void>;
  reload: () => void;
  canEdit: boolean;
  canRun: boolean;
}) {
  const { portal, sites, tenders, runs, running, progress, stats } = data;
  const keywordGroups = data.keywordGroups ?? [];
  const organisationFilters = data.organisationFilters ?? [];
  const [heading, setHeading] = useState("");
  const [siteType, setSiteType] = useState("");
  // The Coal / Ash filter of the search-result list (the Total card's Coal and Ash counts set it).
  const [mixType, setMixType] = useState("");
  const [keywordFilter, setKeywordFilter] = useState("");
  const [organisation, setOrganisation] = useState("");
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
  // ?results=found|approved|rejected|conversion|today (from the Pipeline's search-result cards) opens that list.
  const [params] = useSearchParams();
  const RESULT_KEYS = ["found", "approved", "conversion", "rejected", "ignored", "excluded", "today"] as const;
  const askedView = RESULT_KEYS.find((key) => key === params.get("results")) ?? "";
  const [resultView, setResultView] = useState<"" | (typeof RESULT_KEYS)[number]>(askedView || "found");
  const [, tick] = useState(0);

  useEffect(() => {
    if (!askedView) return;
    const go = () =>
      (document.getElementById("search-results-table") || document.getElementById("search-mix"))?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    const later = window.setTimeout(go, 700);
    return () => window.clearTimeout(later);
  }, [askedView]);

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
  const inHeading = headingWords(keywordGroups, heading);
  const tabbed = tenders.filter((item) => !tab || item.status === tab).filter((item) => !siteFilter || item.siteId === siteFilter);
  const shown = tabbed
    .filter((item) => !siteType || (item.sentLine === "Ash" || item.sentLine === "Coal" ? item.sentLine : typeOfKeyword(keywordGroups, item.keyword)) === siteType)
    .filter((item) => !inHeading || inHeading.has(lower(item.keyword)))
    .filter((item) => !keywordFilter || lower(item.keyword) === lower(keywordFilter))
    .filter((item) => !organisation || fromOrganisation(`${item.organisation} ${item.title}`, organisation))
    .filter((item) => !needle || [item.title, item.refNo, item.portalTenderId, item.organisation, item.keyword, siteOf(item.siteId)?.host].join(" ").toLowerCase().includes(needle));
  // One keyword per line under "# Heading | min crore" lines (sheet keywords can hold commas); an older list is comma-separated.
  const keywords = portal.keywords
    .split(portal.keywords.includes("\n") ? /\n+/ : /[,;]+/)
    .map((word) => word.trim())
    .filter((word) => word && !word.startsWith("#"));
  const excludes = (portal.excludeWords || "")
    .split(/[,\n;]+/)
    .map((word) => word.trim())
    .filter(Boolean);
  const automatic = sites.filter((site) => site.method !== "MANUAL");
  // Websites that need a login or a CAPTCHA are counted with the keyword-searched ones (they can be searched once access
  // is given), not with "check by hand".
  const ACCESS_KINDS = ["LOGIN", "CAPTCHA", "COVERED"];
  const ACCESS_TEXT: Record<string, [string, string, string]> = { LOGIN: ["🔑", "login", "Need login credentials"], CAPTCHA: ["🧩", "CAPTCHA", "Need a CAPTCHA"], COVERED: ["🔁", "no tender list", "Working but no tender list"] };
  const needsAccess = (site?: WatchSite) => Boolean(site && site.method === "MANUAL" && ACCESS_KINDS.includes(handReason(site.note)?.kind ?? ""));
  const inKeywordGroup = (site: WatchSite) => site.method !== "MANUAL" || needsAccess(site);
  const keywordSites = sites.filter(inKeywordGroup);
  const handSites = sites.filter((site) => !inKeywordGroup(site));
  const accessCount = keywordSites.length - automatic.length;
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
    if (key === "AUTO") return keywordSites.length;
    return handSites.length;
  };
  const siteNeedle = siteQuery.trim().toLowerCase();
  const inSiteTab = (site: WatchSite | undefined, key: string) => {
    if (!site) return key === "ALL" || key === "MANUAL";
    if (key === "FAILED") return site.method !== "MANUAL" && site.lastStatus === "FAILED";
    if (key === "EMPTY") return site.method !== "MANUAL" && Boolean(site.lastScanAt) && site.lastStatus !== "FAILED" && site.matched === 0;
    if (key === "AUTO") return inKeywordGroup(site);
    if (key === "MANUAL") return !inKeywordGroup(site);
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
  // GeM's own search (the GeM bid watch): its last finished pass and the bids it keeps.
  const gemLast = gem?.runs.find((item) => item.status !== "RUNNING");
  const gemLine = gemLast?.errorSummary.split("\n")[0] ?? "";
  const gemChecked = Number(/([\d,]+) bids checked/.exec(gemLine)?.[1]?.replace(/,/g, "") ?? 0);
  const gemMatched = Number(/([\d,]+) matching/.exec(gemLine)?.[1]?.replace(/,/g, "") ?? 0);
  const gemReview = gem?.bids.filter((bid) => bid.status === "NEW").length ?? 0;
  const gemImported = gem?.bids.filter((bid) => bid.status === "IMPORTED").length ?? 0;
  const isGemSite = (site: WatchSite) => bare(site.host) === "gem.gov.in";
  const toGem = () => document.getElementById("gem-watch")?.scrollIntoView({ behavior: "smooth", block: "start" });
  const autoLinks = links.filter((link) => inSiteTab(linkSite(link.host), "AUTO"));
  const matchedNow = read.reduce((sum, site) => sum + site.matched, 0);
  const categories = [...new Set([...links.map((link) => link.category), ...sites.map((site) => site.category)].filter(Boolean))]
    .map((name) => {
      const inCategory = sites.filter((site) => site.category === name);
      return {
        name,
        links: links.filter((link) => link.category === name).length,
        sites: inCategory.length,
        auto: inCategory.filter(inKeywordGroup).length,
        matched: inCategory.reduce((sum, site) => sum + (site.lastScanAt ? site.matched : 0), 0),
      };
    })
    .sort((a, b) => b.links - a.links);
  // Under "Check by hand": narrow to one reason (not reachable, need clarification, working but no tender list, …).
  const handFilter = siteTab === "MANUAL" || (siteTab === "AUTO" && ACCESS_KINDS.includes(handKind)) ? handKind : "";
  const kindOf = (site: WatchSite | undefined) => (!site || site.method === "MANUAL" ? (handReason(site?.note)?.kind ?? "OTHER") : "");
  const handTabs = Object.keys(HAND_KIND)
    .filter((kind) => (siteTab === "AUTO" ? ACCESS_KINDS.includes(kind) : !ACCESS_KINDS.includes(kind)))
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
    .filter((link) => !handFilter || kindMatches(kindOf(linkSite(link.host)), handFilter))
    .filter((link) => !category || link.category === category)
    .filter((link) => !siteNeedle || [link.title, link.url, link.category].join(" ").toLowerCase().includes(siteNeedle));
  const listed = sites
    .filter((site) => !repeatOnly || sheetRows(site.host).length > 1)
    .filter((site) => inSiteTab(site, siteTab))
    .filter((site) => !handFilter || kindMatches(kindOf(site), handFilter))
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
  const siteStanding = (site: WatchSite) => {
    if (site.method !== "MANUAL" && site.lastScanAt && site.lastStatus !== "FAILED") {
      return { standing: "Working", reason: site.matched ? "Searched, keywords matched" : "Searched, no keyword match" };
    }
    if (site.method !== "MANUAL" && site.lastStatus === "FAILED") return { standing: "Non-working", reason: "Search failed" };
    if (site.method !== "MANUAL") return { standing: "Non-working", reason: "Not searched yet" };
    return { standing: "Non-working", reason: handReason(site.note)?.label ?? "Check by hand" };
  };
  const workingSites = sites.filter((site) => siteStanding(site).standing === "Working");
  const stamp = () => new Date().toISOString().slice(0, 10);
  const siteLink = (site: WatchSite) => (site.method === "NIC" ? `${site.url}?page=FrontEndTendersByOrganisation&service=page` : site.url);
  const SITE_HEAD = ["#", "Website", "Link", "Classification", "Working", "Status / reason", "How it is read", "Last search", "Matching tenders", "Tenders checked", "Organisation lists", "Sheet rows", "Detail"];
  const siteRows = (list: WatchSite[]) =>
    list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((site, index) => {
        const standing = siteStanding(site);
        const reason = handReason(site.note);
        const searched = site.lastScanAt && site.method !== "MANUAL";
        return [
          index + 1,
          short(site.name),
          siteLink(site),
          site.category,
          standing.standing,
          standing.reason,
          METHOD[site.method],
          site.lastScanAt ? formatWhen(site.lastScanAt, timeZone) : "",
          searched ? site.matched : "",
          searched ? site.checked : "",
          site.method === "NIC" && site.lastScanAt ? site.organisations : "",
          sheetRows(site.host).join(" "),
          site.method === "MANUAL" ? (reason?.text ?? "") : (site.lastError || "").split("\n")[0],
        ] as (string | number)[];
      });
  const HAND_HEAD = ["#", "Website", "Link", "Classification", "Reason", "Detail"];
  const handRows = (list: WatchSite[]) =>
    list
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((site, index) => {
        const reason = handReason(site.note);
        return [index + 1, short(site.name), site.url, site.category, reason?.label ?? "Check by hand", reason?.text ?? ""] as (string | number)[];
      });
  /** The summary sheet: counts by status, by reason and by classification for the websites given. */
  const pct = (part: number, whole: number) => (whole ? `${Math.round((part / whole) * 100)}%` : "");
  const GEM_STATUS: Record<string, string> = { NEW: "To review", IMPORTED: "Imported", IGNORED: "Ignored", EXCLUDED: "Excluded", FAILED: "Failed" };
  /** The summary sheet: total websites, automated and their outcome, check by hand with server not reachable first, GeM, and classification. */
  const summarySheet = (title: string, list: WatchSite[], filters: string[] = [], withGem = false) => {
    const keyword = list.filter(inKeywordGroup);
    const auto = list.filter((site) => site.method !== "MANUAL");
    const hand = list.filter((site) => !inKeywordGroup(site));
    const access = list.filter(needsAccess);
    const total = list.length;
    const working = list.filter((site) => siteStanding(site).standing === "Working").length;
    const failed = auto.filter((site) => site.lastStatus === "FAILED").length;
    const noMatch = auto.filter((site) => site.lastScanAt && site.lastStatus !== "FAILED" && site.matched === 0).length;
    const matched = auto.filter((site) => site.lastScanAt && site.lastStatus !== "FAILED" && site.matched > 0).length;
    const notYet = auto.filter((site) => !site.lastScanAt).length;
    const byKind = (kind: string) => hand.filter((site) => kindOf(site) === kind).length;
    const kindOrder = ["DOWN", "SCRIPT", "NO_LIST", "COVERED"];
    const cats = [...new Set(list.map((site) => site.category || "Uncategorised"))].sort().map((name) => {
      const inCat = list.filter((site) => (site.category || "Uncategorised") === name);
      return [
        name,
        inCat.length,
        inCat.filter(inKeywordGroup).length,
        inCat.filter((site) => !inKeywordGroup(site)).length,
        inCat.filter((site) => site.method === "MANUAL" && kindOf(site) === "DOWN").length,
        inCat.reduce((sum, site) => sum + (site.lastScanAt ? site.matched : 0), 0),
      ] as (string | number)[];
    });
    const gemRows: (string | number)[][] =
      withGem && gem
        ? [
            [],
            ["GeM portal search", "Count", "", "Details sheet"],
            ["GeM bids checked, last pass", gemChecked, "", ""],
            ["Matching the keywords", gemMatched, "", ""],
            ["Bids kept in the watch list", gem.bids.length, "", "GeM bids"],
            ["  – To review", gemReview, "", "GeM bids"],
            ["  – Imported as tenders", gemImported, "", "GeM bids"],
            ["  – Excluded", gem.bids.filter((bid) => bid.status === "EXCLUDED").length, "", "GeM bids"],
            ["  – Ignored", gem.bids.filter((bid) => bid.status === "IGNORED").length, "", "GeM bids"],
            ["Last GeM pass", gemLast ? formatWhen(gemLast.startedAt, timeZone) : "Not run yet", "", ""],
          ]
        : [];
    return {
      name: "Summary",
      rows: [
        [title],
        [`Downloaded ${formatWhen(new Date(), timeZone)}`],
        ...(filters.length ? [[`Filters: ${filters.join(" · ")}`]] : []),
        [],
        ["Websites", "Count", "% of total", "Details sheet"],
        ["Total websites", total, pct(total, total), "All websites"],
        ["Working (searched with keywords)", keyword.length, pct(keyword.length, total), "Searched with keywords"],
        ["  – Search answered", working, pct(working, total), "Search answered"],
        ["  – Keywords matched", matched, pct(matched, total), "Searched with keywords"],
        ["  – No keyword match", noMatch, pct(noMatch, total), "No results"],
        ["  – Search failed", failed, pct(failed, total), "Search failed"],
        ...(notYet ? [["  – Not searched yet", notYet, pct(notYet, total), "Searched with keywords"] as (string | number)[]] : []),
        ...ACCESS_KINDS.filter((kind) => access.some((site) => kindOf(site) === kind)).map((kind) => {
          const count = access.filter((site) => kindOf(site) === kind).length;
          return [`  – ${ACCESS_TEXT[kind][2]}`, count, pct(count, total), handSheet(kind)] as (string | number)[];
        }),
        ["Check by hand (not automated)", hand.length, pct(hand.length, total), "Check by hand"],
        ...kindOrder
          .filter((kind) => byKind(kind))
          .map((kind) => [`  – ${kind === "DOWN" ? "Server / site not reachable" : HAND_KIND[kind].label}`, byKind(kind), pct(byKind(kind), total), handSheet(kind)] as (string | number)[]),
        ["Matching tenders found, last pass", auto.reduce((sum, site) => sum + (site.lastScanAt ? site.matched : 0), 0), "", "Searched with keywords"],
        ...gemRows,
        [],
        ["Classification", "Websites", "Searched with keywords", "Check by hand", "Not reachable", "Matching tenders"],
        ...cats,
      ],
    };
  };
  // Search results across the website search and the GeM search: found, approved (imported), rejected, conversion, new today.
  const siteBy = stats?.byStatus ?? {};
  const gemBy = (gem?.bids ?? []).reduce<Record<string, number>>((acc, bid) => ({ ...acc, [bid.status]: (acc[bid.status] ?? 0) + 1 }), {});
  // Found counts what the searches kept; the ones they filtered out (Excluded) are counted on their own.
  const siteFound = (stats?.total ?? tenders.length) - (siteBy.EXCLUDED ?? 0);
  const gemFound = (gem?.bids.length ?? 0) - (gemBy.EXCLUDED ?? 0);
  const foundTotal = siteFound + gemFound;
  const approvedSite = siteBy.IMPORTED ?? 0;
  const approvedGem = gemBy.IMPORTED ?? 0;
  const reviewedSite = siteBy.IGNORED ?? 0;
  const reviewedGem = gemBy.IGNORED ?? 0;
  const reviewedOut = reviewedSite + reviewedGem;
  const excludedOut = (siteBy.EXCLUDED ?? 0) + (gemBy.EXCLUDED ?? 0);
  const conversion = foundTotal ? ((approvedSite + approvedGem) / foundTotal) * 100 : 0;
  const zoneDay = (value: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
  const todayKey = stats?.today ?? zoneDay(new Date());
  const gemToday = (gem?.bids ?? []).filter((bid) => bid.status !== "EXCLUDED" && zoneDay(bid.firstSeenAt) === todayKey).length;
  const siteToday = stats?.newToday ?? tenders.filter((item) => item.status !== "EXCLUDED" && zoneDay(item.firstSeenAt) === todayKey).length;
  // Total tenders in search is open on arrival. A second click on the open card hides its table.
  const showResults = (view: "found" | "approved" | "conversion" | "rejected" | "ignored" | "excluded" | "today") => {
    if (view === resultView) {
      setResultView("");
      return;
    }
    setResultView(view);
    // Wait for SearchMix to mount, then scroll to the tender table (not the keyword editor).
    window.setTimeout(() => {
      (document.getElementById("search-results-table") || document.getElementById("search-mix"))?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    }, 50);
  };
  // Found tenders (websites and GeM, not the filtered-out ones) by the type of their keyword's heading: Coal or Ash.
  const typeCounts = (() => {
    const counts = new Map<string, number>(KEYWORD_TYPES.map((name) => [name, 0]));
    const add = (keyword: string, sent?: string) => {
      const name = sent === "Ash" || sent === "Coal" ? sent : typeOfKeyword(keywordGroups, keyword);
      counts.set(name, (counts.get(name) ?? 0) + 1);
    };
    for (const item of tenders) if (item.status !== "EXCLUDED") add(item.keyword, item.sentLine);
    for (const bid of gem?.bids ?? []) if (bid.status !== "EXCLUDED") add(bid.keyword, bid.sentLine);
    return [...counts].filter(([name, count]) => KEYWORD_TYPES.includes(name) || count);
  })();
  /** Opens the found list on Coal or Ash (a second click on the same type while it is open closes the filter). */
  const openType = (name: string) => {
    setMixType((current) => (current === name && resultView === "found" ? "" : name));
    if (resultView !== "found") showResults("found");
  };
  const resultCards: { key: string; icon: string; tone: string; value: string | number; label: string; sub: string; go: string; title: string; open: () => void; chips: { label: string; open: () => void }[]; bar?: number }[] = [
    {
      key: "found",
      icon: "🔎",
      tone: "blue",
      value: fmt(foundTotal),
      label: "Total tenders in search",
      sub: `${fmt(siteFound)} from websites · ${fmt(gemFound)} from GeM`,
      go: "View tenders →",
      title: "Every tender the keyword searches found and kept",
      open: () => showResults("found"),
      chips: [
        ...typeCounts.map(([name, count]) => ({ label: `${name === "Coal" ? "⚫" : name === "Ash" ? "🔘" : "▫️"} ${name} ${fmt(count)}`, open: () => openType(name) })),
        ...(excludedOut ? [{ label: `🚫 ${excludedOut} filtered out`, open: () => showResults("excluded") }] : []),
      ],
    },
    {
      key: "approved",
      icon: "✅",
      tone: "green",
      value: approvedSite + approvedGem,
      label: "Approved",
      sub: `imported as tenders · ${approvedSite} websites + ${approvedGem} GeM`,
      go: "View approved →",
      title: "Search results imported into the tender list",
      open: () => showResults("approved"),
      chips: [],
    },
    {
      key: "rejected",
      icon: "⛔",
      tone: "red",
      value: reviewedOut,
      label: "Rejected",
      sub: `rejected on review · ${reviewedSite} websites + ${reviewedGem} GeM`,
      go: "View rejected →",
      title: "Results a person rejected on review (with the reason)",
      open: () => showResults("rejected"),
      chips: [],
    },
    {
      key: "conversion",
      icon: "📈",
      tone: "violet",
      value: `${conversion < 10 ? conversion.toFixed(1) : Math.round(conversion)}%`,
      label: "Conversion ratio",
      sub: `${approvedSite + approvedGem} approved of ${fmt(foundTotal)} found`,
      go: "View approved →",
      title: "Approved tenders as a share of all tenders found",
      open: () => showResults("conversion"),
      chips: [],
      bar: conversion,
    },
    {
      key: "today",
      icon: "🆕",
      tone: "ember",
      value: siteToday + gemToday,
      label: "New tenders today",
      sub: `${siteToday} from websites · ${gemToday} from GeM`,
      go: "View new →",
      title: "Tenders first found today",
      open: () => showResults("today"),
      chips: [],
    },
  ];
  const downloadExcelAll = () => {
    const hand = handSites;
    const reasonSheets = ["DOWN", "LOGIN", "CAPTCHA", "SCRIPT", "NO_LIST", "COVERED"]
      .map((kind) => ({ kind, list: sites.filter((site) => site.method === "MANUAL" && kindOf(site) === kind) }))
      .filter((item) => item.list.length)
      .map((item) => ({ name: handSheet(item.kind), rows: [HAND_HEAD, ...handRows(item.list)] }));
    const summary = summarySheet(`Tender websites: ${sites.length} websites from ${links.length} sheet rows`, sites, [], true);
    summary.rows.push([], ["Master sheet", "Count"], ["Rows in the sheet", links.length], ["Websites on more than one row", repeatedHosts.length], ["Extra rows from repeats", extraRows]);
    const gemSheet = gem
      ? [
          {
            name: "GeM bids",
            rows: [
              ["#", "GeM bid", "Title", "Department", "Ministry", "Keyword", "Bid ends", "Status", "Tender", "Link", "Ignore reason", "Comment", "Ignored by"],
              ...gem.bids.map((bid, index) => [
                index + 1,
                bid.bidNumber,
                bid.title,
                bid.department && bid.department !== "NA" ? bid.department : "",
                bid.ministry,
                bid.keyword,
                bid.endAt ? formatWhen(bid.endAt, timeZone) : "",
                GEM_STATUS[bid.status] ?? bid.status,
                gem.tenders.find((tender) => tender.id === bid.tenderId)?.recordId ?? "",
                `https://bidplus.gem.gov.in/showbidDocument/${bid.bidId}`,
                bid.ignoreReason ?? "",
                bid.ignoreComment ?? "",
                bid.ignoredByName ? `${bid.ignoredByName}${bid.ignoredAt ? `, ${formatWhen(new Date(bid.ignoredAt), timeZone)}` : ""}` : "",
              ] as (string | number)[]),
            ],
          },
        ]
      : [];
    downloadExcel(`websites-${sites.length}-${stamp()}.xlsx`, [
      summary,
      { name: "All websites", rows: [SITE_HEAD, ...siteRows(sites)] },
      { name: "Searched with keywords", rows: [SITE_HEAD, ...siteRows(keywordSites)] },
      { name: "Search answered", rows: [SITE_HEAD, ...siteRows(workingSites)] },
      { name: "Search failed", rows: [SITE_HEAD, ...siteRows(failedSites)] },
      { name: "No results", rows: [SITE_HEAD, ...siteRows(emptySites)] },
      { name: "Check by hand", rows: [HAND_HEAD, ...handRows(hand)] },
      ...reasonSheets,
      ...gemSheet,
      {
        name: "Sheet links",
        rows: [
          ["Sheet row", "Title", "Link", "Classification", "Website", "Rows for this website", "Search state"],
          ...links.map((link, index) => [index + 1, link.title, link.url, link.category, bare(link.host), sheetRows(link.host).join(" "), searchState(linkSite(link.host))] as (string | number)[]),
        ],
      },
    ]);
  };
  /** The list as shown (tab, reason, classification, repeats and search applied), with its own summary sheet. */
  const download = () => {
    const tabName = SITE_TABS.find(([key]) => key === siteTab)?.[1] ?? "All";
    const filters = [
      siteView === "LINKS" ? "Sheet links" : "By website",
      tabName,
      handFilter && HAND_KIND[handFilter]?.label,
      category && `Classification: ${category}`,
      repeatOnly && "Repeated websites only",
      siteNeedle && `Search: "${siteQuery.trim()}"`,
    ].filter(Boolean) as string[];
    const file = filters.join("-").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (siteView === "LINKS") {
      const shownSites = [...new Map(listedLinks.map((link) => [bare(link.host), linkSite(link.host)])).values()].filter(Boolean) as WatchSite[];
      const summary = summarySheet(`${listedLinks.length} sheet rows for ${shownSites.length} websites`, shownSites, filters);
      downloadExcel(`${file}-${stamp()}.xlsx`, [
        summary,
        {
          name: "Sheet links",
          rows: [
            ["Sheet row", "Title", "Link", "Classification", "Website", "Rows for this website", "Search state", "Matching tenders", "Tenders checked"],
            ...listedLinks.map((link) => {
              const site = linkSite(link.host);
              const searched = site && site.method !== "MANUAL" && site.lastScanAt;
              return [link.row, link.title, link.url, link.category, bare(link.host), sheetRows(link.host).join(" "), searchState(site), searched ? site.matched : "", searched ? site.checked : ""] as (string | number)[];
            }),
          ],
        },
      ]);
      return;
    }
    const summary = summarySheet(`${listed.length} websites`, listed, filters);
    // Check by hand: just the website, its link and why it is checked by hand.
    const list = siteTab === "MANUAL" ? { name: handFilter ? handSheet(handFilter) : "Check by hand", rows: [HAND_HEAD, ...handRows(listed)] } : { name: tabName === "All" ? "Websites" : tabName, rows: [SITE_HEAD, ...siteRows(listed)] };
    downloadExcel(`${file}-${stamp()}.xlsx`, [summary, list]);
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
            Keywords, one per line. A line &quot;# Heading | 10&quot; starts a heading whose tenders must be above ₹10 Cr.
            <textarea name="keywords" rows={8} defaultValue={portal.keywords.includes("\n") ? portal.keywords : keywords.join("\n")} required />
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
          <SheetFilters
            groups={keywordGroups}
            organisations={organisationFilters}
            found={tabbed.map((item) => item.keyword)}
            rowTypes={tabbed.map((item) => (item.sentLine === "Ash" || item.sentLine === "Coal" ? item.sentLine : typeOfKeyword(keywordGroups, item.keyword)))}
            type={siteType}
            setType={setSiteType}
            heading={heading}
            keyword={keywordFilter}
            organisation={organisation}
            setHeading={setHeading}
            setKeyword={setKeywordFilter}
            setOrganisation={setOrganisation}
          />
          <input type="search" placeholder="Search title, tender ID, organisation…" value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
      </div>

      <div className="table-wrap flat" id="site-results">
        <table className="gem-table">
          <thead>
            <tr>
              <th>Website</th>
              <th>Tender</th>
              <th>Organisation</th>
              <th>Keyword · value</th>
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
                    <td className="gem-number" data-label="Website">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer" title={site?.method === "NIC" ? "Open the portal's Tenders by Organisation list" : "Open on the website"}>
                          {site ? short(site.name) : "Website"}
                        </a>
                      ) : (
                        short(site?.name ?? "Website")
                      )}
                      <small className="muted">{site?.host}</small>
                    </td>
                    <td data-label="Tender">
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
                      <small className={`site-value ${item.tenderValue ? "" : "muted"}`}>{valueText(item.tenderValue)}</small>
                    </td>
                    <td className={closed ? "text-bad" : ""}>
                      {item.closingAt ? formatWhen(item.closingAt, timeZone) : "—"}
                      {closed ? <small>closed</small> : null}
                    </td>
                    <td>
                      <span className={`pill ${STATUS[item.status].tone}`}>{STATUS[item.status].label}</span>
                      {item.error ? <ErrorNote text={item.error} href={item.status === "IMPORTED" ? portalLink(siteOf(item.siteId), item) : ""} /> : null}
                      {item.status === "IGNORED" ? <IgnoredNote item={item} /> : null}
                    </td>
                    <td className="gem-row-actions">
                      {item.tenderId ? (
                        <Link className="btn ghost" to={`/tenders/${item.tenderId}`}>
                          Open tender
                        </Link>
                      ) : null}
                      {canRun && item.status === "IMPORTED" && item.docCount === 0 && site?.method !== "NIC" ? (
                        <Link className="btn" to={`/tenders/${item.tenderId}`} onClick={(event) => event.stopPropagation()}>
                          Upload documents
                        </Link>
                      ) : null}
                      {canRun && item.status === "IMPORTED" && item.docCount === 0 && site?.method === "NIC" ? (
                        <button
                          type="button"
                          className="btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            setOpenRow(item.id);
                            scrollWhenReady(`docs-${item.id}`);
                          }}
                        >
                          Get documents
                        </button>
                      ) : null}
                      {canRun && item.status !== "IMPORTED" ? (
                        <form action={run("site-watch")} className="site-import-form">
                          <input type="hidden" name="intent" value="import" />
                          <input type="hidden" name="siteTenderId" value={item.id} />
                          <input type="hidden" name="openTender" value="1" />
                          <label className="btn ghost site-import-files" title="Tender file. No portal code is needed. It is stored as the tender document." data-count="">
                            Tender file
                            <input
                              type="file"
                              name="files"
                              multiple
                              accept=".pdf,.png,.jpg,.jpeg,.webp,.tif,.tiff,.xlsx,.xls,.txt"
                              onChange={(event) => {
                                const count = event.currentTarget.files?.length ?? 0;
                                event.currentTarget.parentElement!.dataset.count = count ? ` (${count})` : "";
                              }}
                            />
                          </label>
                          <button className="btn" type="submit">
                            {item.status === "FAILED" ? "Retry" : "Import as tender"}
                          </button>
                        </form>
                      ) : null}
                      {canRun && item.status !== "IGNORED" && item.status !== "EXCLUDED" ? <SendLine action={run("site-watch")} idName="siteTenderId" id={item.id} sent={item.sentLine} /> : null}
                      {canRun && item.status === "NEW" ? (
                        <IgnoreForm action={run("site-watch")} idName="siteTenderId" id={item.id} />
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

      <TopSlot>
        <section className="panel gem-watch site-watch site-top" aria-label="Websites from the master sheet">
      <div className="site-list">
        <div className="site-list-head">
          <div>
            <h3>Websites from the master sheet</h3>
            <small className="muted">
              {links.length || sites.length} rows in the sheet point to {sites.length} separate websites: {repeatedHosts.length} websites are listed more than once under different names{" "}
              {mostRepeated ? ` (for example ${links[mostRepeated[0] - 1]?.title} is on ${mostRepeated.length} rows)` : ""}, which adds {extraRows} repeated rows. {keywordSites.length} websites are
              searched with the keywords; the rest have no list a program can read.
            </small>
          </div>
          <button type="button" className="sk-download" onClick={downloadExcelAll} title="Excel workbook: a summary of counts (total, automated, server not reachable, GeM…), then the full details of each list on its own sheet">
            <span aria-hidden>⬇</span>
            <span>
              <b>Download Excel</b>
              <small>Summary + full details · {sites.length} websites</small>
            </span>
          </button>
        </div>
        <h4 className="sk-heading">Search results</h4>
        <div className="sk-grid sk-results">
          {resultCards.map((card) => (
            <div
              key={card.key}
              role="button"
              tabIndex={0}
              className={`sk-card tone-${card.tone}${resultView === card.key ? " is-active" : ""}`}
              aria-pressed={resultView === card.key}
              title={card.title}
              onClick={card.open}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  card.open();
                }
              }}
            >
              <span className="sk-icon" aria-hidden>
                {card.icon}
              </span>
              <b className="sk-value">{card.value}</b>
              <span className="sk-label">{card.label}</span>
              <small className="sk-sub">{card.sub}</small>
              {card.chips.length ? (
                <span className="sk-chips wrap">
                  {card.chips.map((chip) => (
                    <button
                      key={chip.label}
                      type="button"
                      className="sk-chip"
                      onClick={(event) => {
                        event.stopPropagation();
                        chip.open();
                      }}
                    >
                      {chip.label}
                    </button>
                  ))}
                </span>
              ) : null}
              {card.bar != null ? (
                <span className="sk-split" aria-hidden>
                  <i style={{ width: `${Math.min(100, card.bar)}%` }} />
                </span>
              ) : null}
              <span className="sk-go" aria-hidden>
                {card.go}
              </span>
            </div>
          ))}
        </div>
        {resultView ? (
          <SearchMix
            view={resultView}
            onView={(view) => setResultView(view)}
            tenders={tenders}
            bids={gem?.bids ?? []}
            gemTenders={gem?.tenders ?? []}
            siteOf={siteOf}
            timeZone={timeZone}
            todayKey={todayKey}
            zoneDay={zoneDay}
            canRun={canRun}
            run={run}
            groups={keywordGroups}
            organisations={organisationFilters}
            type={mixType}
            setType={setMixType}
            words={
              <SearchWords
                groups={keywordGroups}
                excludes={excludes}
                running={running || Boolean(gem?.running)}
                canEdit={canEdit}
                run={run("site-watch")}
              />
            }
          />
        ) : null}
        <h4 className="sk-heading">Website results ({sites.length})</h4>
        <div className="sk-grid">
          {(
            [
              { key: "sites", icon: "🌐", tone: "blue", value: sites.length, label: "Separate websites", sub: `${repeatedHosts.length} on several rows` },
              { key: "auto", icon: "⚡", tone: "green", value: keywordSites.length, label: "Working", sub: `${automatic.length} searched with keywords${accessCount ? ` + ${accessCount} more` : ""}` },
              ...((handCounts.DOWN ?? 0) + (handCounts.NO_LIST ?? 0)
                ? [{ key: "notmatch", icon: "🚫", tone: "red", value: (handCounts.DOWN ?? 0) + (handCounts.NO_LIST ?? 0), label: "Not working", sub: "not reachable, or the URL is not about tenders" }]
                : []),
              ...(handCounts.SCRIPT
                ? [{ key: "hand-SCRIPT", icon: "⏳", tone: "amber", value: handCounts.SCRIPT, label: "In pending", sub: "site works; need clarification from the portal" }]
                : []),
            ] as { key: string; icon: string; tone: string; value: string | number; label: string; sub: string }[]
          ).map((card) => (
              <div key={card.key} className={`sk-card tone-${card.tone}`}>
                <span className="sk-icon" aria-hidden>
                  {card.icon}
                </span>
                <b className="sk-value">{card.value}</b>
                <span className="sk-label">{card.label}</span>
                <small className="sk-sub">{card.sub}</small>
                {card.key === "auto" && accessCount ? (
                  <span className="sk-chips wrap">
                    <small>Also counted:</small>
                    {ACCESS_KINDS.filter((kind) => handCounts[kind]).map((kind) => (
                      <span key={kind} className="sk-chip">
                        {ACCESS_TEXT[kind][0]} {handCounts[kind]} {ACCESS_TEXT[kind][1]}
                      </span>
                    ))}
                  </span>
                ) : null}
                {card.key === "notmatch" ? (
                  <span className="sk-chips wrap">
                    {NOT_MATCHING.filter((kind) => handCounts[kind]).map((kind) => (
                      <span key={kind} className={`sk-chip tone-${kind === "DOWN" ? "bad" : "neutral"}`}>
                        {kind === "DOWN" ? "🔌" : "📭"} {handCounts[kind]} {HAND_KIND[kind].label}
                      </span>
                    ))}
                  </span>
                ) : null}
              </div>
          ))}
        </div>
      </div>
        </section>
      </TopSlot>

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
