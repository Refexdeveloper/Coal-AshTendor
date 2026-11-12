import { db } from "../db";
import { attachSourceDocuments, createTender, type Actor } from "./domain";
import { FIRST_EXCLUDES, FIRST_KEYWORDS, GEM_EXCLUDES, GEM_KEYWORDS } from "./gem-keywords";

/**
 * GeM bid watch. Searches the open bids on bidplus.gem.gov.in ("All Bids") for each keyword, keeps the bids whose
 * title holds the keyword and none of the exclude words, and, when auto-import is on, downloads each new bid's PDF
 * and creates a tender from it (source CRAWLER, so it goes through OCR and data validation like any upload).
 *
 * GeM's own search matches the words anywhere ("ash transportation" also finds water tanks), so the title check
 * here is what decides relevance. Requests are spaced out and stop once a page holds only bids already seen.
 */

const BASE = "https://bidplus.gem.gov.in";
const UA = "Mozilla/5.0 (compatible; CoalAshTenderWatch/1.0; +https://refex.co.in)";
const PAUSE_MS = 400;

export const GEM_PORTAL_NAME = "GeM — All Bids";
export const DEFAULT_KEYWORDS = GEM_KEYWORDS;
/** Product purchases that only mention ash, and road toll work that only mentions NHAI. */
export const DEFAULT_EXCLUDES = GEM_EXCLUDES;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const splitList = (value: string) =>
  value
    .split(/[,\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

type GemDoc = Record<string, unknown[]> & { id: string };
const first = (doc: GemDoc, key: string) => (Array.isArray(doc[key]) ? doc[key][0] : undefined) as string | number | undefined;

/**
 * GeM stamps its times with "Z" but they are India times ("…T13:00:00Z" is 1:00 PM IST), so the clock is read as IST.
 */
export function gemTime(value: unknown) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value ?? ""));
  if (!match) return { date: null as Date | null, text: "" };
  const [, year, month, day, hour, minute] = match;
  return { date: new Date(`${year}-${month}-${day}T${hour}:${minute}:00+05:30`), text: `${day}/${month}/${year} ${hour}:${minute}` };
}

export function bidTitle(doc: GemDoc) {
  return [first(doc, "bd_category_name") ?? first(doc, "b_category_name") ?? "", first(doc, "bbt_title") ?? ""].filter(Boolean).join(" · ");
}

const STOPWORDS = new Set(["of", "and", "from", "to", "by", "for", "the", "in", "on", "with", "at", "through", "into", "between", "a", "an"]);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A bid matches when its title holds the keyword as a whole phrase, or holds its meaningful words (not "of", "and",
 * "by"…) as words in any order: all of them for keywords of up to three such words, the first three for longer ones.
 * "Transportation of ash" matches "Ash transportation"; a plural matches its singular ("tippers" ~ "tipper").
 * Short acronyms such as CHP or AHP only match as whole words.
 */
export function matches(title: string, keyword: string) {
  const text = title.toLowerCase();
  const phrase = keyword.toLowerCase().trim();
  if (!phrase) return false;
  if (new RegExp(`(^|[^a-z0-9])${escape(phrase)}($|[^a-z0-9])`).test(text)) return true;
  const words = phrase.split(/\s+/).filter((word) => word.length > 1 && !STOPWORDS.has(word));
  if (words.length < 2) return false;
  return words.slice(0, 3).every((word) => {
    const stem = word.length > 4 && word.endsWith("s") ? word.slice(0, -1) : word;
    return new RegExp(`(^|[^a-z0-9])${escape(stem)}`).test(text);
  });
}

export function excludedBy(title: string, excludes: string[]) {
  const text = title.toLowerCase();
  return excludes.find((word) => new RegExp(`\\b${word.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text)) ?? null;
}

/** A GeM session: the listing page sets the cookies and carries the form token the data call needs. */
async function openSession() {
  const response = await fetch(`${BASE}/all-bids`, { headers: { "User-Agent": UA } });
  if (!response.ok) throw new Error(`GeM All Bids page answered ${response.status}.`);
  const html = await response.text();
  const token = /'csrf_bd_gem_nk':\s*'([a-f0-9]+)'/.exec(html)?.[1];
  if (!token) throw new Error("GeM changed its All Bids page: the form token was not found.");
  const cookies = (response.headers.getSetCookie?.() ?? [])
    .map((line) => line.split(";")[0])
    .filter(Boolean)
    .join("; ");
  return { token, cookies };
}

async function searchPage(session: { token: string; cookies: string }, keyword: string, page: number) {
  const payload = {
    page,
    param: { searchBid: keyword, searchType: "fullText" },
    filter: { bidStatusType: "ongoing_bids", byType: "all", highBidValue: "", byEndDate: { from: "", to: "" }, sort: "Bid-Start-Date-Latest" },
  };
  const response = await fetch(`${BASE}/all-bids-data`, {
    method: "POST",
    headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded", Cookie: session.cookies },
    body: new URLSearchParams({ payload: JSON.stringify(payload), csrf_bd_gem_nk: session.token }),
  });
  if (!response.ok) throw new Error(`GeM search answered ${response.status}.`);
  const data = (await response.json()) as { code?: number; message?: string; response?: { response?: { numFound: number; docs: GemDoc[] } } };
  if (data.code === 404) return { total: 0, docs: [] as GemDoc[] };
  if (data.code !== 200 || !data.response?.response) throw new Error(`GeM search failed: ${data.message ?? "unexpected reply"}.`);
  return { total: data.response.response.numFound, docs: data.response.response.docs };
}

/** The bid's PDF. Reverse auctions use their own document path. */
async function downloadBidDocument(doc: GemDoc) {
  const id = String(first(doc, "b_id") ?? doc.id);
  const type = Number(first(doc, "b_bid_type") ?? 1);
  const evalType = Number(first(doc, "b_eval_type") ?? 0);
  const path = type === 5 ? "showdirectradocumentPdf" : type === 2 && evalType > 0 ? "showradocumentPdf" : "showbidDocument";
  const response = await fetch(`${BASE}/${path}/${id}`, { headers: { "User-Agent": UA } });
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!response.ok || bytes.subarray(0, 4).toString() !== "%PDF") throw new Error(`The bid document did not download (GeM answered ${response.status}).`);
  const number = String(first(doc, "b_bid_number") ?? id).replace(/[^A-Za-z0-9-]+/g, "-");
  return { name: `${number}.pdf`, type: "application/pdf", buffer: bytes };
}

/** A document the bid PDF links to: the buyer's uploads, the ATC, the BOQ and the technical specification. */
export type GemLink = { url: string; label: string; ext: string; v?: number };
/** Bumped when the naming changes, so lists stored earlier are read again. */
const LINK_NAMING = 2;

/** Hosts GeM keeps bid attachments on. Only these are fetched, so a link in a PDF can never point the server elsewhere. */
const LINK_HOSTS = ["bidplus.gem.gov.in", "fulfilment.gem.gov.in", "mkp.gem.gov.in"];
const MAX_LINKED_BYTES = 20 * 1024 * 1024;

function linkLabel(url: URL) {
  const path = decodeURIComponent(url.pathname + url.search).toLowerCase();
  if (/atc_/.test(path)) return "ATC (additional terms)";
  if (/technical_specification|specification/.test(path)) return "Technical specification";
  if (/boq_item|boqlineitems|\/excel\//.test(path)) return "BOQ";
  if (/biddoc/.test(path)) return "Buyer document";
  if (/corrigendum/.test(path)) return "Corrigendum";
  // The bid prints this one as "Buyer uploaded ATC document Click here to view the file".
  if (url.hostname === "fulfilment.gem.gov.in") return "Buyer uploaded ATC document";
  return "Linked document";
}

/**
 * Titles printed in the bid next to each file, such as "Scope of Work:1794466546.pdf" or "PRICE SCHEDULE - 1793273784.xlsx".
 * A title that wraps ("…as per their" / "requirement:1793944326.pdf") is joined back from the lines above it.
 */
async function documentTitles(pdf: Buffer) {
  const titles = new Map<string, string>();
  try {
    const { extractText } = await import("unpdf");
    const result = await extractText(new Uint8Array(pdf), { mergePages: true });
    const text = Array.isArray(result.text) ? result.text.join("\n") : String(result.text ?? "");
    const lines = text.split(/\n/).map((line) => line.trim());
    // A line above ends the title when it is a finished entry, a section heading, a page number or Hindi text.
    const stops = (line: string) =>
      !line || /\d{6,}\.(?:pdf|xlsx?|csv|docx?|zip)$/i.test(line) || /required\s*:?$/i.test(line) || /^\d+\s*\/\s*\d+$/.test(line) || /[:.]$/.test(line) || /[^\x20-\x7e]/.test(line);
    lines.forEach((line, index) => {
      const match = /^(.*?)\s*(?:[:\-–]\s*)?(\d{6,}\.(?:pdf|xlsx?|csv|docx?|zip))\s*$/i.exec(line);
      if (!match) return;
      const own = match[1].replace(/\s*[:\-–]\s*$/, "").trim();
      if (!own) return; // a bare file name under the work title: the generic label is clearer
      const parts = [own];
      // Only a title that starts mid-sentence ("requirement", "download …") carries on from the line above.
      for (let up = index - 1; up >= Math.max(0, index - 3) && /^[a-z]/.test(parts[0]) && !stops(lines[up]); up -= 1) parts.unshift(lines[up]);
      const title = parts.join(" ").replace(/\s+/g, " ").trim();
      if (!title || /https?:/i.test(title) || title.length > 220) return;
      const file = match[2].toLowerCase();
      if (!titles.has(file)) titles.set(file, title);
    });
  } catch {
    /* keep the generic label when the bid text cannot be read */
  }
  return titles;
}

function fileNameOf(url: string) {
  try {
    return decodeURIComponent(new URL(url).pathname).split("/").filter(Boolean).pop()?.toLowerCase() ?? "";
  } catch {
    return "";
  }
}

/** A stored list still using "Buyer document" has not picked up the names printed in the bid. */
function unnamed(links: GemLink[]) {
  return links.some((link) => link.v !== LINK_NAMING);
}

/** The attachment links written into a bid PDF, in order, without repeats. GeM's generic GTC and web pages are left out. */
export async function bidLinks(pdf: Buffer): Promise<GemLink[]> {
  const text = pdf.toString("latin1");
  const seen = new Set<string>();
  const links: GemLink[] = [];
  for (const match of text.matchAll(/\/URI\s*\(((?:\\.|[^\\)])*)\)/g)) {
    const raw = match[1].replace(/\\(.)/g, "$1").trim();
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" || !LINK_HOSTS.includes(url.hostname)) continue;
    const full = decodeURIComponent(url.pathname + url.search);
    const ext = (full.match(/\.(pdf|xlsx?|csv|docx?|zip|jpe?g|png)$/i)?.[1] ?? "").toLowerCase();
    if (!ext) continue; // bid pages and download forms, not files
    if (seen.has(url.href)) continue;
    seen.add(url.href);
    links.push({ url: url.href, label: linkLabel(url), ext, v: LINK_NAMING });
  }
  const titles = await documentTitles(pdf);
  for (const link of links) {
    const title = titles.get(fileNameOf(link.url));
    if (title) link.label = title;
  }
  // Number repeated labels: Buyer document 1, Buyer document 2.
  const counts = new Map<string, number>();
  for (const link of links) counts.set(link.label, (counts.get(link.label) ?? 0) + 1);
  const index = new Map<string, number>();
  for (const link of links) {
    if ((counts.get(link.label) ?? 0) < 2) continue;
    const n = (index.get(link.label) ?? 0) + 1;
    index.set(link.label, n);
    link.label = `${link.label} ${n}`;
  }
  return links;
}

/** The links of a stored bid. Read from its PDF the first time and kept on the row. */
export async function readGemBidLinks(id: string): Promise<GemLink[]> {
  const bid = await db.gemBid.findUnique({ where: { id } });
  if (!bid) throw new Error("That GeM bid is not in the list.");
  if (bid.links) {
    try {
      const stored = JSON.parse(bid.links) as GemLink[];
      if (!unnamed(stored)) return stored;
    } catch {
      /* read again below */
    }
  }
  const doc = JSON.parse(bid.raw || "{}") as GemDoc;
  if (!doc.id && !first(doc, "b_id")) return [];
  const file = await downloadBidDocument(doc);
  const links = await bidLinks(file.buffer);
  await db.gemBid.update({ where: { id }, data: { links: JSON.stringify(links) } });
  return links;
}

const LINK_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  zip: "application/zip",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
};

/** Downloads one linked document. Only GeM hosts, at most 20 MB. */
export async function downloadLinked(link: GemLink, bidNumber: string) {
  const url = new URL(link.url);
  if (url.protocol !== "https:" || !LINK_HOSTS.includes(url.hostname)) throw new Error("That link is not a GeM document.");
  const response = await fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" });
  if (!response.ok) throw new Error(`GeM answered ${response.status} for ${link.label}.`);
  if (/text\/html/i.test(response.headers.get("content-type") ?? "")) throw new Error(`${link.label} is a web page, not a file.`);
  const size = Number(response.headers.get("content-length") ?? 0);
  if (size > MAX_LINKED_BYTES) throw new Error(`${link.label} is larger than 20 MB.`);
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_LINKED_BYTES) throw new Error(`${link.label} is larger than 20 MB.`);
  const number = bidNumber.replace(/[^A-Za-z0-9-]+/g, "-");
  return { name: `${link.label} - ${number}.${link.ext}`, type: LINK_TYPES[link.ext] ?? "application/octet-stream", buffer };
}

/** One linked document of a stored bid, picked by its place in the list (never by a URL from the request). */
export async function readGemLinked(id: string, index: number) {
  const bid = await db.gemBid.findUnique({ where: { id } });
  if (!bid) throw new Error("That GeM bid is not in the list.");
  const links = await readGemBidLinks(id);
  const link = links[index];
  if (!link) throw new Error("That linked document is not on this bid.");
  return downloadLinked(link, bid.bidNumber);
}

/** The stored bid's PDF, fetched from GeM for the row's document view. */
export async function readGemBidPdf(id: string) {
  const bid = await db.gemBid.findUnique({ where: { id } });
  if (!bid) throw new Error("That GeM bid is not in the list.");
  const doc = JSON.parse(bid.raw || "{}") as GemDoc;
  if (!doc.id && !first(doc, "b_id")) throw new Error("This bid has no document to open.");
  return downloadBidDocument(doc);
}

/** The GeM portal row, created with the default keywords the first time. */
export async function gemPortal() {
  const existing = await db.portal.findFirst({ where: { accessMethod: "GEM_API" } });
  if (existing) {
    // A watch still on the first seven keywords (or the first exclude words) moves to the full lists; edited lists stay.
    const same = (value: string, list: string[]) => value.split(/[,\n;]+/).map((item) => item.trim().toLowerCase()).filter(Boolean).sort().join("|") === list.map((item) => item.toLowerCase()).sort().join("|");
    const data: Record<string, unknown> = {};
    if (same(existing.keywords || "", FIRST_KEYWORDS)) data.keywords = GEM_KEYWORDS.join(", ");
    if (same(existing.excludeWords || "", FIRST_EXCLUDES)) data.excludeWords = GEM_EXCLUDES.join(", ");
    if (data.keywords && existing.maxPages > 5) data.maxPages = 5;
    return Object.keys(data).length ? db.portal.update({ where: { id: existing.id }, data }) : existing;
  }
  return db.portal.create({
    data: {
      name: GEM_PORTAL_NAME,
      url: `${BASE}/all-bids`,
      category: "Government e-Marketplace",
      keywords: DEFAULT_KEYWORDS.join(", "),
      excludeWords: DEFAULT_EXCLUDES.join(", "),
      frequencyHours: 6,
      enabled: true,
      autoImport: false,
      // Over 250 keywords: five pages each on the first pass; later passes stop at bids already seen.
      maxPages: 5,
      maxImports: 25,
      accessMethod: "GEM_API",
      lastStatus: "NOT_SCANNED",
    },
  });
}

/** Creates the tender for one stored GeM bid. Used by auto-import and by the admin's Import button. */
export async function importGemBid(actor: Actor, gemBidId: string) {
  const bid = await db.gemBid.findUnique({ where: { id: gemBidId } });
  if (!bid) throw new Error("That GeM bid is not in the list.");
  if (bid.status === "IMPORTED" && bid.tenderId) return { tenderId: bid.tenderId, recordId: "", already: true };
  const doc = JSON.parse(bid.raw || "{}") as GemDoc;
  try {
    const file = await downloadBidDocument(doc);
    const buyer = bid.department && bid.department !== "NA" ? bid.department : bid.ministry;
    const end = gemTime(first(doc, "final_end_date_sort"));
    const result = await createTender(actor, {
      projectName: bid.title.slice(0, 250),
      clientName: buyer,
      portalName: "GeM",
      tenderRef: bid.bidNumber,
      externalTenderId: bid.bidNumber,
      source: "CRAWLER",
      files: [file],
      // What the GeM listing already states; OCR fills the rest from the bid document.
      known: {
        work_description: bid.title,
        gem_ref: bid.bidNumber,
        submission_mode: "Electronic",
        portal_registration: "GeM",
        ...(end.text ? { bid_submission_end: end.text } : {}),
      },
    });
    // The documents the bid PDF links to (ATC, BOQ, specification, buyer uploads) go on the tender too.
    let linkNote = "";
    if (!result.duplicate) {
      const links = await bidLinks(file.buffer);
      await db.gemBid.update({ where: { id: bid.id }, data: { links: JSON.stringify(links) } });
      const fetched: { name: string; type: string; buffer: Buffer }[] = [];
      const failed: string[] = [];
      for (const link of links) {
        await sleep(PAUSE_MS);
        try {
          fetched.push(await downloadLinked(link, bid.bidNumber));
        } catch {
          failed.push(link.label);
        }
      }
      if (fetched.length) await attachSourceDocuments(actor, result.tenderId, fetched, "GEM_LINKED");
      if (failed.length) linkNote = `Linked documents not fetched: ${failed.join(", ")}.`;
    }
    await db.gemBid.update({ where: { id: bid.id }, data: { status: "IMPORTED", tenderId: result.tenderId, error: result.duplicate ? `Already on tender ${result.recordId}.` : linkNote } });
    return { tenderId: result.tenderId, recordId: result.recordId, already: result.duplicate };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.gemBid.update({ where: { id: bid.id }, data: { status: "FAILED", error: message.slice(0, 1000) } });
    throw error;
  }
}

let running: Promise<unknown> | null = null;

/** What the pass in progress has done so far, for the Portals page. */
type Progress = { startedAt: Date; keywords: number; done: number; active: string[]; pages: number; checked: number; matched: number; imported: number };
let progress: Progress | null = null;

export function gemRunning() {
  return Boolean(running);
}

/**
 * A pass cut off by a server restart stays "RUNNING" in the history. Any not running here and older than
 * 15 minutes (a pass takes a few) is marked interrupted, and the portal shows its last finished pass again.
 */
export async function clearStaleRuns() {
  if (running) return;
  const portal = await db.portal.findFirst({ where: { accessMethod: "GEM_API" } });
  if (!portal) return;
  // The db layer has no "less than" filter, so the age check is done here.
  const cutoff = Date.now() - 15 * 60 * 1000;
  const stale = (await db.crawlerRun.findMany({ where: { portalId: portal.id, status: "RUNNING" } })).filter((run: { startedAt: Date }) => new Date(run.startedAt).getTime() <= cutoff);
  for (const run of stale) {
    await db.crawlerRun.update({
      where: { id: run.id },
      data: { status: "INTERRUPTED", finishedAt: new Date(), errorSummary: "Stopped part-way (the server restarted). The next pass picks up from here." },
    });
  }
  if (stale.length && portal.lastStatus === "RUNNING") await db.portal.update({ where: { id: portal.id }, data: { lastStatus: "INTERRUPTED" } });
}

export function gemProgress() {
  return running ? progress : null;
}

/**
 * One full pass over every keyword. Returns what was found. Only one pass runs at a time.
 * `actor` is the person who pressed Run now, or the first administrator for a scheduled pass.
 */
export function runGemWatch(actor?: Actor) {
  if (running) return running as Promise<Awaited<ReturnType<typeof scan>>>;
  running = scan(actor).finally(() => {
    running = null;
    progress = null;
  });
  return running as Promise<Awaited<ReturnType<typeof scan>>>;
}

async function scan(actorInput?: Actor) {
  await clearStaleRuns().catch(() => undefined);
  const portal = await gemPortal();
  const actor = actorInput ?? ((await db.user.findFirst({ where: { role: "ADMIN", active: true } })) as Actor | null);
  if (!actor) throw new Error("No active administrator to record the GeM import.");
  const keywords = splitList(portal.keywords || "");
  const excludes = splitList(portal.excludeWords || "");
  const run = await db.crawlerRun.create({ data: { portalId: portal.id, status: "RUNNING" } });
  await db.portal.update({ where: { id: portal.id }, data: { lastStatus: "RUNNING", lastError: "" } });
  const summary = { checked: 0, matched: 0, newMatches: 0, excluded: 0, imported: 0, failed: 0, errors: [] as string[] };
  let imports = 0;
  try {
    const session = await openSession();
    // Bids come newest first, so a pass can stop at bids published before the last good pass (a day of overlap
    // covers late listings). The very first pass has no cutoff and reads up to the page limit.
    const lastGood = await db.crawlerRun.findFirst({ where: { portalId: portal.id, status: { in: ["SUCCESS", "PARTIAL"] } }, orderBy: { startedAt: "desc" } });
    const since = lastGood ? new Date(new Date(lastGood.startedAt).getTime() - 864e5) : null;
    progress = { startedAt: new Date(), keywords: keywords.length, done: 0, active: [], pages: 0, checked: 0, matched: 0, imported: 0 };

    const scanKeyword = async (keyword: string) => {
      progress!.active.push(keyword);
      try {
        for (let page = 1; page <= Math.max(1, portal.maxPages); page += 1) {
          await sleep(PAUSE_MS);
          let result: Awaited<ReturnType<typeof searchPage>>;
          try {
            result = await searchPage(session, keyword, page);
          } catch (error) {
            summary.errors.push(`${keyword}: ${error instanceof Error ? error.message : error}`);
            break;
          }
          progress!.pages += 1;
          for (const doc of result.docs) {
            summary.checked += 1;
            progress!.checked = summary.checked;
            const title = bidTitle(doc);
            if (!matches(title, keyword)) continue;
            const bidId = String(first(doc, "b_id") ?? doc.id);
            const known = await db.gemBid.findFirst({ where: { bidId } });
            const exclude = excludedBy(title, excludes);
            if (exclude) summary.excluded += 1;
            else summary.matched += 1;
            const end = gemTime(first(doc, "final_end_date_sort")).date;
            const start = gemTime(first(doc, "final_start_date_sort")).date;
            const fields = {
              portalId: portal.id,
              bidNumber: String(first(doc, "b_bid_number") ?? ""),
              title: title.slice(0, 2000),
              ministry: String(first(doc, "ba_official_details_minName") ?? ""),
              department: String(first(doc, "ba_official_details_deptName") ?? ""),
              bidType: Number(first(doc, "b_bid_type") ?? 0) || null,
              quantity: Number(first(doc, "b_total_quantity") ?? 0) || null,
              startAt: start,
              endAt: end,
              raw: JSON.stringify(doc),
              lastSeenAt: new Date(),
            };
            if (known) {
              await db.gemBid.update({ where: { id: known.id }, data: fields });
              continue;
            }
            // Two keywords searched side by side can find the same bid; the second one simply skips it.
            const created = await db.gemBid
              .create({ data: { ...fields, bidId, keyword, status: exclude ? "EXCLUDED" : "NEW", error: exclude ? `Title mentions "${exclude}".` : "" } })
              .catch(() => null);
            if (!created) continue;
            if (exclude) continue;
            summary.newMatches += 1;
            if (portal.autoImport && imports < portal.maxImports) {
              imports += 1;
              await sleep(PAUSE_MS);
              try {
                await importGemBid(actor, created.id);
                summary.imported += 1;
              } catch (error) {
                summary.failed += 1;
                const message = error instanceof Error ? error.message : String(error);
                await db.crawlerException.create({ data: { runId: run.id, portalId: portal.id, kind: "Document download failure", detail: message.slice(0, 1000), tenderHint: fields.bidNumber } });
              }
            }
          }
          progress!.matched = summary.matched;
          progress!.imported = summary.imported;
          const oldest = result.docs.reduce<Date | null>((min, doc) => {
            const at = gemTime(first(doc, "final_start_date_sort")).date;
            return at && (!min || at < min) ? at : min;
          }, null);
          if (!result.docs.length || page * 10 >= result.total || (since && oldest && oldest < since)) break;
        }
      } finally {
        progress!.active = progress!.active.filter((item) => item !== keyword);
        progress!.done += 1;
      }
    };

    // Three keywords at a time: quick enough for Run now, gentle enough on GeM.
    const queue = [...keywords];
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length) await scanKeyword(queue.shift()!);
      }),
    );
    // With auto-import on, bids still waiting from earlier passes (e.g. found while it was off) are imported too.
    if (portal.autoImport) {
      const waiting = await db.gemBid.findMany({ where: { status: "NEW" }, orderBy: { firstSeenAt: "asc" } });
      for (const bid of waiting) {
        if (imports >= portal.maxImports) break;
        if (bid.endAt && new Date(bid.endAt).getTime() < Date.now()) continue;
        imports += 1;
        await sleep(PAUSE_MS);
        try {
          await importGemBid(actor, bid.id);
          summary.imported += 1;
          if (progress) progress.imported = summary.imported;
        } catch (error) {
          summary.failed += 1;
          const message = error instanceof Error ? error.message : String(error);
          await db.crawlerException.create({ data: { runId: run.id, portalId: portal.id, kind: "Document download failure", detail: message.slice(0, 1000), tenderHint: bid.bidNumber } });
        }
      }
    }
    const status = summary.errors.length ? "PARTIAL" : "SUCCESS";
    const errorSummary = [
      `${summary.checked} bids checked · ${summary.matched} matching (${summary.newMatches} new) · ${summary.imported} imported${summary.failed ? ` · ${summary.failed} failed` : ""}${summary.excluded ? ` · ${summary.excluded} excluded` : ""}`,
      ...summary.errors,
    ].join("\n");
    await db.crawlerRun.update({ where: { id: run.id }, data: { status, finishedAt: new Date(), discovered: summary.newMatches, errorSummary } });
    await db.portal.update({ where: { id: portal.id }, data: { lastStatus: status, lastScanAt: new Date(), lastError: summary.errors.join("\n").slice(0, 2000) } });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.crawlerRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), discovered: summary.newMatches, errorSummary: message } });
    await db.portal.update({ where: { id: portal.id }, data: { lastStatus: "FAILED", lastScanAt: new Date(), lastError: message } });
    await db.crawlerException.create({ data: { runId: run.id, portalId: portal.id, kind: "Portal unavailable", detail: message.slice(0, 1000) } });
    throw error;
  }
}

/** Called as people use the app: starts a pass when the watch is on and the last one is older than its frequency. */
export async function maybeScheduledGemScan() {
  if (running) return;
  const portal = await db.portal.findFirst({ where: { accessMethod: "GEM_API" } });
  if (!portal || !portal.enabled) return;
  const due = !portal.lastScanAt || Date.now() - new Date(portal.lastScanAt).getTime() >= portal.frequencyHours * 36e5;
  if (!due) return;
  void runGemWatch().catch((error) => console.error("GeM watch failed", error));
}
