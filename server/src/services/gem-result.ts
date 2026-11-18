import { db } from "../db";

/**
 * GeM bid results for a tender already in the pipeline. The tender's GeM bid number (GEM/2026/B/…) is looked up on
 * GeM's public "Bid/RA Status" search, and when the buyer has published results, the public result page is read:
 * bid details, the technical evaluation (sellers that took part and whether they qualified) and the financial
 * evaluation (prices and L1, L2… ranks, or the L1 seller of each schedule). A reverse auction run on the bid is read too.
 */

const BASE = "https://bidplus.gem.gov.in";
const UA = "Mozilla/5.0 (compatible; CoalAshTenderWatch/1.0; +https://refex.co.in)";
const CACHE_MS = 6 * 60 * 60 * 1000;
export const GEM_NUMBER = /GEM\/\d{4}\/[BR]\/\d+/i;

export type GemTable = { title: string; columns: string[]; rows: string[][] };
export type GemSection = { title: string; fields: { label: string; value: string }[]; tables: GemTable[] };
export type GemResultPage = { kind: "Bid" | "Reverse auction"; bidNumber: string; url: string; sections: GemSection[] };
export type GemResult = {
  bidNumber: string;
  found: boolean;
  published: boolean;
  status: string;
  endsAt: string;
  statusUrl: string;
  pages: GemResultPage[];
  note: string;
  checkedAt: string;
};

type Doc = Record<string, unknown[]>;
const one = (doc: Doc, key: string) => (Array.isArray(doc[key]) ? doc[key][0] : undefined) as string | number | undefined;

const cache = new Map<string, GemResult>();

const decode = (text: string) =>
  text
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'");

/** Visible text of a cell: hidden labels ("Under PMA"), comments and tags go; GeM prints the rupee sign as a backtick. */
function cellText(html: string) {
  const text = decode(
    html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<span[^>]*display:\s*none[^>]*>[\s\S]*?<\/span>/gi, "")
      .replace(/<\/p>|<br\s*\/?>/gi, " · ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/`\s*/g, "₹ ")
    .replace(/\s+/g, " ")
    .replace(/^(\s*·\s*)+|(\s*·\s*)+$/g, "")
    .replace(/(\s*·\s*){2,}/g, " · ")
    .trim();
  return text;
}

function tablesOf(html: string): GemTable[] {
  const tables: GemTable[] = [];
  let last = 0;
  for (const match of html.matchAll(/<table[\s\S]*?<\/table>/gi)) {
    const before = html.slice(last, match.index);
    last = (match.index ?? 0) + match[0].length;
    if (/'\s*\+/.test(match[0])) continue; // a template GeM fills in with script
    const rows = [...match[0].matchAll(/<tr[\s\S]*?<\/tr>/gi)].map((row) => [...row[0].matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi)].map((cell) => cellText(cell[1])));
    const head = /<th/i.test(match[0]) ? rows.shift() ?? [] : [];
    const body = rows.filter((row) => row.some(Boolean));
    if (!body.length && !head.length) continue;
    const labels = [...before.matchAll(/<label[^>]*>([\s\S]*?)<\/label>/gi)];
    const loose = cellText(before.replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")).split(" · ").pop() ?? "";
    const title = labels.length ? cellText(labels[labels.length - 1][1]) : loose.length < 80 ? loose : "";
    tables.push({ title, columns: head, rows: body });
  }
  return tables;
}

function fieldsOf(html: string) {
  const fields: { label: string; value: string }[] = [];
  for (const match of html.matchAll(/<strong>([\s\S]*?)<\/strong>\s*<span>([\s\S]*?)<\/span>/gi)) {
    const label = cellText(match[1]).replace(/:\s*$/, "");
    const value = cellText(match[2]);
    if (label && value && !fields.some((field) => field.label === label)) fields.push({ label, value });
  }
  return fields;
}

/** The accordion panels of a result page: "1. BID DETAILS", "2. TECHNICAL EVALUATION", "3. FINANCIAL EVALUATION". */
export function parseResultPage(html: string): GemSection[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style)[\s\S]*?<\/\1>/gi, "");
  const heads = [...clean.matchAll(/<div class="panel-heading">[\s\S]*?<h4[^>]*>([\s\S]*?)<\/h4>/gi)];
  return heads.map((head, index) => {
    const start = (head.index ?? 0) + head[0].length;
    const end = heads[index + 1]?.index ?? clean.length;
    const body = clean.slice(start, end);
    const title = cellText(head[1]).replace(/^\d+\.\s*/, "");
    return { title, fields: fieldsOf(body), tables: tablesOf(body) };
  });
}

async function session() {
  const response = await fetch(`${BASE}/all-bids`, { headers: { "User-Agent": UA } });
  if (!response.ok) throw new Error(`GeM answered ${response.status}.`);
  const html = await response.text();
  const token = /'csrf_bd_gem_nk':\s*'([a-f0-9]+)'/.exec(html)?.[1];
  if (!token) throw new Error("GeM changed its bid search page: the form token was not found.");
  const cookies = (response.headers.getSetCookie?.() ?? []).map((line) => line.split(";")[0]).join("; ");
  return { token, cookies };
}

/** Closed bids are under "Bid/RA Status"; a bid still open is only under "Ongoing Bids". */
async function statusSearch(bidNumber: string) {
  const open = await session();
  const closed = await searchAs(open, bidNumber, "bidrastatus");
  return closed.length ? closed : searchAs(open, bidNumber, "ongoing_bids");
}

async function searchAs({ token, cookies }: { token: string; cookies: string }, bidNumber: string, bidStatusType: string) {
  const payload = {
    page: 1,
    param: { searchBid: bidNumber, searchType: "fullText" },
    filter: { bidStatusType, byType: "all", highBidValue: "", byEndDate: { from: "", to: "" }, sort: "Bid-Start-Date-Latest" },
  };
  const response = await fetch(`${BASE}/all-bids-data`, {
    method: "POST",
    headers: { "User-Agent": UA, "X-Requested-With": "XMLHttpRequest", "Content-Type": "application/x-www-form-urlencoded", Cookie: cookies },
    body: new URLSearchParams({ payload: JSON.stringify(payload), csrf_bd_gem_nk: token }),
  });
  if (response.status === 404) return []; // GeM's answer when nothing matches
  if (!response.ok) throw new Error(`GeM bid status search answered ${response.status}.`);
  const data = (await response.json()) as { code?: number; response?: { response?: { docs: Doc[] } } };
  return data.code === 200 ? (data.response?.response?.docs ?? []) : [];
}

function resultPath(doc: Doc) {
  const id = one(doc, "b_id");
  if (Number(one(doc, "b_eval_type") ?? 0) > 0) return `/bidding/bid/getBidResultViewSchedule/${id}`;
  return `/bidding/bid/${Number(one(doc, "ba_is_single_packet") ?? 0) === 1 ? "getSinglePacketResultView" : "getBidResultView"}/${id}`;
}

async function readPage(doc: Doc, kind: GemResultPage["kind"]): Promise<GemResultPage> {
  const url = `${BASE}${resultPath(doc)}`;
  const response = await fetch(url, { headers: { "User-Agent": UA } });
  if (!response.ok) throw new Error(`GeM result page answered ${response.status}.`);
  return { kind, bidNumber: String(one(doc, "b_bid_number") ?? ""), url, sections: parseResultPage(await response.text()) };
}

const endText = (value: unknown) => {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(String(value ?? ""));
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : "";
};

/** Fields most likely to hold the GeM bid number come first; any other field holding one also counts. */
const NUMBER_FIELDS = ["gem_ref", "tender_ref", "tender_id"];

/** The GeM bid number of a tender: from the GeM watch import, else from its fields (GeM ref, reference, ID, then any). */
export async function gemNumberOf(tenderId: string) {
  const bid = await db.gemBid.findFirst({ where: { tenderId } });
  if (bid?.bidNumber && GEM_NUMBER.test(bid.bidNumber)) return bid.bidNumber.toUpperCase();
  const rank = (key: string) => (NUMBER_FIELDS.includes(key) ? NUMBER_FIELDS.indexOf(key) : NUMBER_FIELDS.length);
  const fields = (await db.tenderField.findMany({ where: { tenderId } })).sort((a: { fieldKey: string }, b: { fieldKey: string }) => rank(a.fieldKey) - rank(b.fieldKey));
  for (const field of fields) {
    const match = GEM_NUMBER.exec(`${field.correctedValue ?? ""} ${field.extractedValue ?? ""}`);
    if (match) return match[0].toUpperCase();
  }
  const tender = await db.tender.findUnique({ where: { id: tenderId } });
  const match = GEM_NUMBER.exec(`${tender?.projectName ?? ""}`);
  return match ? match[0].toUpperCase() : "";
}

export async function gemResultFor(tenderId: string, refresh = false): Promise<GemResult | null> {
  const bidNumber = await gemNumberOf(tenderId);
  return bidNumber ? gemResultForNumber(bidNumber, refresh) : null;
}

/** What the published pages hold: GeM shows the technical list first, then prices and ranks once the financial bids open. */
function stageOf(pages: GemResultPage[]) {
  const tables = (pattern: RegExp) => pages.some((page) => page.sections.some((section) => pattern.test(section.title) && section.tables.some((table) => table.rows.length)));
  if (tables(/financial/i)) return "Financial results published";
  if (tables(/technical/i)) return "Technical results published";
  return "Bids opened, evaluation in progress";
}

export async function gemResultForNumber(number: string, refresh = false): Promise<GemResult> {
  const bidNumber = number.toUpperCase();
  const kept = cache.get(bidNumber);
  if (kept && !refresh && Date.now() - new Date(kept.checkedAt).getTime() < CACHE_MS) return kept;

  const docs = await statusSearch(bidNumber);
  const bid = docs.find((doc) => String(one(doc, "b_bid_number") ?? "").toUpperCase() === bidNumber);
  const result: GemResult = {
    bidNumber,
    found: Boolean(bid),
    published: false,
    status: "",
    endsAt: "",
    statusUrl: `${BASE}/all-bids`,
    pages: [],
    note: "",
    checkedAt: new Date().toISOString(),
  };
  if (!bid) {
    result.status = "Not on GeM's status list";
    result.note = "GeM's bid search does not list this bid number now. It may have been cancelled or withdrawn by the buyer.";
  } else {
    result.endsAt = endText(one(bid, "final_end_date_sort"));
    const ended = Date.now() > new Date(String(one(bid, "final_end_date_sort") ?? "").replace("Z", "+05:30")).getTime();
    const opened = Number(one(bid, "b_buyer_status") ?? 0) > 0;
    if (opened) result.pages.push(await readPage(bid, "Bid"));
    // A reverse auction held on this bid has its own result page.
    for (const ra of docs.filter((doc) => String(one(doc, "b_bid_number_parent") ?? "").toUpperCase() === bidNumber)) {
      if (Number(one(ra, "b_buyer_status") ?? 0) > 0) result.pages.push(await readPage(ra, "Reverse auction"));
    }
    result.status = opened ? stageOf(result.pages) : ended ? "Closed, bids not opened yet" : "Bid still open";
    result.published = /published/.test(result.status);
    if (!result.published)
      result.note = !ended
        ? `Bidding closes on ${result.endsAt}. Results appear after that.`
        : opened
          ? "The buyer has opened the bids. GeM lists the sellers and their status once the technical evaluation is done."
          : "The bid has closed; GeM shows results once the buyer opens and evaluates the bids.";
  }
  cache.set(bidNumber, result);
  return result;
}
