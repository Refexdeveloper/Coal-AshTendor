import { createHash, randomBytes } from "node:crypto";
import { db } from "../db";
import { addDocuments, createTender, type Actor } from "./domain";
import { allowedUpload } from "./files";
import { GEM_EXCLUDES, GEM_KEYWORDS } from "./gem-keywords";
import { SITE_SEEDS } from "./site-list";

/**
 * Tender sites watch. Reads the open tenders on the websites from the "Master Classification - Direct Website Links"
 * sheet and keeps the ones whose title holds a keyword from the "Tender Sourcing Keywords" sheet.
 *
 * NIC GePNIC portals (Coal India and its subsidiaries, NTPC, IOCL, CPPP and most state portals) list every
 * organisation's open tenders on "Tenders by Organisation" without a CAPTCHA, so each organisation's list is read
 * and the titles are matched here. Pages that need a CAPTCHA (keyword search, document download) are never touched.
 * A few company sites publish a plain HTML tender page; its rows and links are matched the same way. The rest of the
 * sheet's sites have no readable list and are shown as links to check by hand.
 */

const UA = "Mozilla/5.0 (compatible; CoalAshTenderWatch/1.0; +https://refex.co.in)";
const PAUSE_MS = 500;
const SITES_AT_ONCE = 4;
const FETCH_TIMEOUT_MS = 45_000;

export const SITE_WATCH_NAME = "Tender sites watch";

/** The sheet's first name for a site that is a name, not a web address. */
export const siteName = (name: string) => {
  const parts = name.split(" / ").map((part) => part.trim()).filter(Boolean);
  return parts.find((part) => !/^[\w-]+(\.[\w-]+)+$/.test(part)) ?? parts[0] ?? name;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const splitList = (value: string) =>
  value
    .split(/[,\n;]+/)
    .map((item) => item.trim())
    .filter(Boolean);

function decode(value: string) {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

const STOPWORDS = new Set(["of", "and", "from", "to", "by", "for", "the", "in", "on", "with", "at", "through", "into", "between", "a", "an"]);
const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const tokensOf = (text: string) => text.toLowerCase().split(/[^a-z0-9&]+/).filter(Boolean);
const sameWord = (token: string, word: string) =>
  token === word || token === `${word}s` || token === `${word}es` || (word.length > 3 && word.endsWith("s") && token === word.slice(0, -1));

/**
 * A title matches when it holds the keyword as a whole phrase (a plural is fine), or holds the keyword's meaningful
 * words (not "of", "and", "by"…) as whole words within a few words of each other, in any order: "Transportation of
 * fly ash" matches "fly ash transportation". Whole words only, so "Ashok OCP" never counts as "ash".
 * Tender titles on these portals are long sentences, which is why the words must sit close together.
 */
export function siteMatches(title: string, keyword: string) {
  const text = title.toLowerCase();
  const phrase = keyword.toLowerCase().trim();
  if (!phrase) return false;
  if (new RegExp(`(^|[^a-z0-9])${escape(phrase)}(s|es)?($|[^a-z0-9])`).test(text)) return true;
  const words = tokensOf(phrase).filter((word) => word.length > 1 && !STOPWORDS.has(word)).slice(0, 3);
  if (words.length < 2) return false;
  const tokens = tokensOf(text);
  const places = words.map((word) => tokens.flatMap((token, index) => (sameWord(token, word) ? [index] : [])));
  if (places.some((list) => !list.length)) return false;
  return places[0].some((at) => places.slice(1).every((list) => list.some((other) => Math.abs(other - at) <= 8)));
}

export function siteExcludedBy(title: string, excludes: string[]) {
  const text = title.toLowerCase();
  return excludes.find((word) => new RegExp(`(^|[^a-z0-9])${escape(word.toLowerCase())}($|[^a-z0-9])`).test(text)) ?? null;
}

/** "27-Nov-2026 05:00 PM" (India time) → the date, and the dd/mm/yyyy HH:MM text the tender form reads. */
const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
export function nicTime(value: string) {
  const match = /(\d{1,2})-([A-Za-z]{3})-(\d{4})\s+(\d{1,2}):(\d{2})\s*([AP]M)?/i.exec(value);
  if (!match) return { date: null as Date | null, text: "" };
  const month = MONTHS[match[2].toLowerCase()];
  if (!month) return { date: null as Date | null, text: "" };
  let hour = Number(match[4]);
  const ampm = match[6]?.toUpperCase();
  if (ampm === "PM" && hour < 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  const pad = (number: number) => String(number).padStart(2, "0");
  const day = pad(Number(match[1]));
  const iso = `${match[3]}-${pad(month)}-${day}T${pad(hour)}:${match[5]}:00+05:30`;
  return { date: new Date(iso), text: `${day}/${pad(month)}/${match[3]} ${pad(hour)}:${match[5]}` };
}

/** One browsing session on a site: keeps its cookies (NIC links only work inside the session that showed them). */
function session(base: string) {
  const jar = new Map<string, string>();
  return async (path: string) => {
    const url = new URL(path, base).toString();
    const response = await fetch(url, {
      // NIC portals fail with a 500 on the "Accept-Language: *" that Node sends by default, so a real one is given.
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml", "Accept-Language": "en-IN,en;q=0.9", ...(jar.size ? { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") } : {}) },
      redirect: "follow",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    for (const line of response.headers.getSetCookie?.() ?? []) {
      const [pair] = line.split(";");
      const at = pair.indexOf("=");
      if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
    }
    if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}.`);
    return response.text();
  };
}

export type FoundTender = { key: string; tenderId: string; refNo: string; title: string; organisation: string; link: string; published: string; closing: string; opening: string };

/** The organisations listed on a NIC portal's "Tenders by Organisation" page, with their open-tender counts. */
export function nicOrganisations(html: string) {
  const out: { name: string; count: number; href: string }[] = [];
  for (const row of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<tr class="(?:even|odd)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]);
    const href = /href="([^"]*FrontEndTendersByOrganisation[^"]*)"/.exec(row[1])?.[1];
    if (cells.length < 3 || !href) continue;
    out.push({ name: decode(cells[1]), count: Number(decode(cells[2]).replace(/\D/g, "")) || 0, href: href.replace(/&amp;/g, "&") });
  }
  return out;
}

/** The tender rows of one organisation's list: dates, title, reference number, tender ID and the organisation chain. */
export function nicTenders(html: string, host: string): FoundTender[] {
  const out: FoundTender[] = [];
  // The rows carry a commented-out reference-number cell; left in, it would shift every column.
  for (const row of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<tr class="(?:even|odd)"[^>]*>([\s\S]*?)<\/tr>/g)) {
    const cells = [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => cell[1]);
    if (cells.length < 6) continue;
    const titleCell = cells[4];
    const title = decode(/<a[^>]*>([\s\S]*?)<\/a>/.exec(titleCell)?.[1] ?? "").replace(/^\[|\]$/g, "").trim();
    const rest = decode(titleCell.replace(/<a[^>]*>[\s\S]*?<\/a>/, ""));
    const brackets = [...rest.matchAll(/\[([^\]]*)\]/g)].map((part) => part[1].trim());
    const tenderId = brackets.at(-1) ?? "";
    const refNo = brackets.length > 1 ? brackets.slice(0, -1).join(" ") : "";
    if (!title || !tenderId) continue;
    out.push({
      key: `${host}:${tenderId}`,
      tenderId,
      refNo,
      title,
      organisation: decode(cells[5]).replace(/\|\|/g, " › "),
      link: "",
      published: decode(cells[1]),
      closing: decode(cells[2]),
      opening: decode(cells[3]),
    });
  }
  return out;
}

/** A plain company tender page: each table row, list item or link whose text reads like a tender. */
const PAGE_TENDERISH = /tender|\bnit\b|notice inviting|\beoi\b|expression of interest|\brf[qp]\b|auction|\bbids?\b|enquiry|quotation|e-?procure/i;
const PAGE_MONTHS = "jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec";
/** Every date written in a row ("14.10.2026", "14-Oct-2026", "14 Oct, 2026", "2026-10-14"), as IST midnight. */
export function pageDates(text: string) {
  const out: Date[] = [];
  const add = (year: number, month: number, day: number) => {
    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > new Date().getFullYear() + 2) return;
    out.push(new Date(`${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T00:00:00+05:30`));
  };
  for (const m of text.matchAll(/\b(\d{1,2})\s*[-./]\s*(\d{1,2})\s*[-./]\s*(\d{4}|\d{2})\b/g)) add(Number(m[3]), Number(m[2]), Number(m[1]));
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?[\\s\\-./,]*(${PAGE_MONTHS})[a-z]*[\\s\\-./,]*(\\d{4})\\b`, "gi"))) add(Number(m[3]), MONTHS[m[2].toLowerCase()], Number(m[1]));
  for (const m of text.matchAll(new RegExp(`\\b(${PAGE_MONTHS})[a-z]*\\s+(\\d{1,2}),?\\s+(\\d{4})\\b`, "gi"))) add(Number(m[3]), MONTHS[m[1].toLowerCase()], Number(m[2]));
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) add(Number(m[1]), Number(m[2]), Number(m[3]));
  return out;
}
const asNicTime = (date: Date) => {
  const ist = new Date(date.getTime() + 5.5 * 3600_000);
  const month = Object.keys(MONTHS)[ist.getUTCMonth()];
  return `${String(ist.getUTCDate()).padStart(2, "0")}-${month[0].toUpperCase()}${month.slice(1)}-${ist.getUTCFullYear()} 12:00 AM`;
};
/** How old a dated row may be and still count: company pages keep years of past tenders below the open ones. */
const PAGE_MAX_AGE_MS = 120 * 86400_000;

/**
 * Tender rows on a company's own tender page: table rows and list items that read like a tender (a tender word or a
 * date), plus stand-alone links not already inside such a row. Rows whose dates are all older than four months are
 * past tenders and are left out. The first date is kept as the published date, a later one as the closing date.
 */
export function pageTenders(html: string, base: string): FoundTender[] {
  const clean = html.replace(/<(script|style|noscript|svg|nav|header|footer)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const host = new URL(base).host;
  const cutoff = Date.now() - PAGE_MAX_AGE_MS;
  const seen = new Set<string>();
  const rows: string[] = [];
  const out: FoundTender[] = [];
  const take = (block: string, standalone: boolean) => {
    const text = decode(block);
    if (text.length < 15 || text.length > 900 || seen.has(text)) return;
    seen.add(text);
    // A link inside a table row or list item belongs to that row, kept or left out with it.
    if (standalone && rows.some((row) => row.includes(text))) return;
    if (!standalone) rows.push(text);
    const dates = pageDates(text);
    if (!PAGE_TENDERISH.test(text) && !dates.length) return;
    if (dates.length && Math.max(...dates.map((date) => date.getTime())) < cutoff) return;
    let link = "";
    const href = /href\s*=\s*["']([^"'#][^"']*)["']/i.exec(block)?.[1];
    if (href && !/^(javascript|mailto|tel):/i.test(href)) {
      try {
        const url = new URL(href.replace(/&amp;/g, "&"), base);
        if (url.protocol === "https:" || url.protocol === "http:") link = url.toString();
      } catch {
        /* no usable link */
      }
    }
    const sorted = [...dates].sort((a, b) => a.getTime() - b.getTime());
    const digest = createHash("sha1").update(text.toLowerCase()).digest("hex").slice(0, 20);
    out.push({
      key: `${host}:${digest}`,
      tenderId: "",
      refNo: "",
      title: text.slice(0, 2000),
      organisation: "",
      link,
      published: sorted.length ? asNicTime(sorted[0]) : "",
      closing: sorted.length > 1 ? asNicTime(sorted.at(-1)!) : "",
      opening: "",
    });
  };
  for (const match of clean.matchAll(/<tr[\s>][\s\S]*?<\/tr>/gi)) take(match[0], false);
  for (const match of clean.matchAll(/<li[\s>][\s\S]*?<\/li>/gi)) take(match[0], false);
  for (const match of clean.matchAll(/<a\s[^>]*>[\s\S]*?<\/a>/gi)) take(match[0], true);
  return out;
}

/** The settings row (keywords, exclude words, frequency) and the site list, created from the sheets the first time. */
export async function siteWatchPortal() {
  let portal = await db.portal.findFirst({ where: { accessMethod: "SITE_WATCH" } });
  if (!portal) {
    portal = await db.portal.create({
      data: {
        name: SITE_WATCH_NAME,
        url: "",
        category: "Tender websites",
        keywords: GEM_KEYWORDS.join(", "),
        excludeWords: GEM_EXCLUDES.join(", "),
        frequencyHours: 12,
        enabled: true,
        autoImport: false,
        maxPages: 1,
        maxImports: 0,
        accessMethod: "SITE_WATCH",
        lastStatus: "NOT_SCANNED",
      },
    });
  }
  const have = new Map(
    ((await db.watchSite.findMany({ select: { id: true, host: true, method: true, url: true, note: true } })) as { id: string; host: string; method: string; url: string; note: string | null }[]).map((site) => [site.host, site]),
  );
  for (const seed of SITE_SEEDS) {
    const note = seed.note ?? "";
    const known = have.get(seed.host);
    if (!known) {
      await db.watchSite.create({ data: { ...seed, note, enabled: seed.method !== "MANUAL" } }).catch(() => undefined);
      continue;
    }
    // The list changed (a site that is now read automatically, a new page address, or why it is checked by hand).
    if (known.method !== seed.method || known.url !== seed.url || (known.note ?? "") !== note) {
      const nowAutomatic = known.method === "MANUAL" && seed.method !== "MANUAL";
      await db.watchSite
        .update({ where: { id: known.id }, data: { method: seed.method, url: seed.url, note, ...(nowAutomatic ? { enabled: true, lastStatus: "NOT_SCANNED" } : {}) } })
        .catch(() => undefined);
    }
  }
  return portal;
}

let running: Promise<unknown> | null = null;
type Progress = { startedAt: Date; sites: number; done: number; active: string[]; organisations: number; checked: number; matched: number };
let progress: Progress | null = null;

export const siteWatchRunning = () => Boolean(running);
export const siteWatchProgress = () => (running ? progress : null);

/**
 * A pass cut off by a restart is marked interrupted: after 45 minutes when the page loads (another server may still
 * be running it), and straight away when a new pass starts here.
 */
export async function clearStaleSiteRuns(starting = false) {
  if (running && !starting) return;
  const portal = await db.portal.findFirst({ where: { accessMethod: "SITE_WATCH" } });
  if (!portal) return;
  const cutoff = starting ? Date.now() : Date.now() - 45 * 60 * 1000;
  const stale = (await db.crawlerRun.findMany({ where: { portalId: portal.id, status: "RUNNING" } })).filter((run: { startedAt: Date }) => new Date(run.startedAt).getTime() <= cutoff);
  for (const run of stale) {
    await db.crawlerRun.update({ where: { id: run.id }, data: { status: "INTERRUPTED", finishedAt: new Date(), errorSummary: "Stopped part-way (the server restarted)." } });
  }
  if (stale.length && portal.lastStatus === "RUNNING") await db.portal.update({ where: { id: portal.id }, data: { lastStatus: "INTERRUPTED" } });
  if (!stale.length) return;
  for (const site of await db.watchSite.findMany({ where: { lastStatus: "RUNNING" } })) {
    await db.watchSite.update({ where: { id: site.id }, data: { lastStatus: "INTERRUPTED" } });
  }
}

/** One pass over every enabled site, or only `onlySiteId`. Only one pass runs at a time. */
export function runSiteWatch(onlySiteId?: string) {
  if (running) return running as Promise<Awaited<ReturnType<typeof scan>>>;
  running = scan(onlySiteId).finally(() => {
    running = null;
    progress = null;
  });
  return running as Promise<Awaited<ReturnType<typeof scan>>>;
}

type Site = { id: string; host: string; name: string; url: string; method: string };

async function scan(onlySiteId?: string) {
  await clearStaleSiteRuns(true).catch(() => undefined);
  const portal = await siteWatchPortal();
  const keywords = splitList(portal.keywords || "");
  const excludes = splitList(portal.excludeWords || "");
  const sites = ((await db.watchSite.findMany({ where: { enabled: true }, orderBy: { host: "asc" } })) as Site[]).filter(
    (site) => site.method !== "MANUAL" && (!onlySiteId || site.id === onlySiteId),
  );
  const run = await db.crawlerRun.create({ data: { portalId: portal.id, status: "RUNNING" } });
  await db.portal.update({ where: { id: portal.id }, data: { lastStatus: "RUNNING", lastError: "" } });
  const summary = { sites: sites.length, organisations: 0, checked: 0, matched: 0, newMatches: 0, excluded: 0, errors: [] as string[] };
  progress = { startedAt: new Date(), sites: sites.length, done: 0, active: [], organisations: 0, checked: 0, matched: 0 };

  const keep = async (site: Site, found: FoundTender) => {
    summary.checked += 1;
    progress!.checked = summary.checked;
    const keyword = keywords.find((word) => siteMatches(found.title, word));
    if (!keyword) return false;
    const exclude = siteExcludedBy(found.title, excludes);
    if (exclude) summary.excluded += 1;
    else summary.matched += 1;
    progress!.matched = summary.matched;
    const fields = {
      siteId: site.id,
      portalTenderId: found.tenderId.slice(0, 190),
      refNo: found.refNo.slice(0, 2000),
      title: found.title.slice(0, 4000),
      organisation: found.organisation.slice(0, 2000),
      link: found.link.slice(0, 1000),
      publishedAt: nicTime(found.published).date,
      closingAt: nicTime(found.closing).date,
      openingAt: nicTime(found.opening).date,
      lastSeenAt: new Date(),
    };
    const known = await db.siteTender.findFirst({ where: { tenderKey: found.key } });
    if (known) {
      await db.siteTender.update({ where: { id: known.id }, data: fields });
      return !exclude;
    }
    const created = await db.siteTender
      .create({ data: { ...fields, tenderKey: found.key.slice(0, 250), keyword, status: exclude ? "EXCLUDED" : "NEW", error: exclude ? `Title mentions "${exclude}".` : "" } })
      .catch(() => null);
    if (created && !exclude) summary.newMatches += 1;
    return !exclude;
  };

  const scanSite = async (site: Site) => {
    progress!.active.push(siteName(site.name));
    let organisations = 0;
    let checked = 0;
    let matched = 0;
    const errors: string[] = [];
    await db.watchSite.update({ where: { id: site.id }, data: { lastStatus: "RUNNING", lastError: "" } });
    try {
      const get = session(site.url.endsWith("/") ? site.url : `${site.url}/`);
      if (site.method === "NIC") {
        const listPath = `${new URL(site.url).pathname}?page=FrontEndTendersByOrganisation&service=page`;
        const orgs = nicOrganisations(await get(listPath)).filter((org) => org.count > 0);
        if (!orgs.length) throw new Error("No organisation list on the page (the portal may have changed or be down).");
        for (const org of orgs) {
          await sleep(PAUSE_MS);
          try {
            const rows = nicTenders(await get(org.href), site.host);
            organisations += 1;
            summary.organisations += 1;
            progress!.organisations = summary.organisations;
            for (const row of rows) {
              checked += 1;
              if (await keep(site, { ...row, organisation: row.organisation || org.name })) matched += 1;
            }
          } catch (error) {
            errors.push(`${org.name}: ${error instanceof Error ? error.message : error}`);
          }
        }
      } else {
        const rows = pageTenders(await get(site.url), site.url);
        organisations = 1;
        for (const row of rows) {
          checked += 1;
          if (await keep(site, { ...row, organisation: siteName(site.name) })) matched += 1;
        }
      }
      await db.watchSite.update({
        where: { id: site.id },
        data: { lastStatus: errors.length ? "PARTIAL" : "SUCCESS", lastScanAt: new Date(), lastError: errors.slice(0, 5).join("\n").slice(0, 2000), organisations, checked, matched },
      });
      if (errors.length) summary.errors.push(`${site.host}: ${errors.length} organisation list(s) not read`);
    } catch (error) {
      const message = error instanceof Error ? (error.name === "TimeoutError" ? "The site did not answer in time." : error.message) : String(error);
      summary.errors.push(`${site.host}: ${message}`);
      await db.watchSite.update({ where: { id: site.id }, data: { lastStatus: "FAILED", lastScanAt: new Date(), lastError: message.slice(0, 2000), organisations, checked, matched } });
      await db.crawlerException.create({ data: { runId: run.id, portalId: portal.id, kind: "Portal unavailable", detail: `${site.name} (${site.host}): ${message}`.slice(0, 1000) } });
    } finally {
      progress!.active = progress!.active.filter((name) => name !== siteName(site.name));
      progress!.done += 1;
    }
  };

  try {
    // A few sites side by side; each site is read one page at a time with a pause, so no portal sees a burst.
    const queue = [...sites];
    await Promise.all(
      Array.from({ length: Math.min(SITES_AT_ONCE, queue.length) }, async () => {
        while (queue.length) await scanSite(queue.shift()!);
      }),
    );
    const status = summary.errors.length ? "PARTIAL" : "SUCCESS";
    const errorSummary = [
      `${summary.sites} sites · ${summary.organisations} organisation lists · ${summary.checked} tenders checked · ${summary.matched} matching (${summary.newMatches} new)${summary.excluded ? ` · ${summary.excluded} excluded` : ""}`,
      ...summary.errors,
    ].join("\n");
    await db.crawlerRun.update({ where: { id: run.id }, data: { status, finishedAt: new Date(), discovered: summary.newMatches, errorSummary } });
    await db.portal.update({ where: { id: portal.id }, data: { lastStatus: status, lastScanAt: new Date(), lastError: summary.errors.join("\n").slice(0, 2000) } });
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.crawlerRun.update({ where: { id: run.id }, data: { status: "FAILED", finishedAt: new Date(), discovered: summary.newMatches, errorSummary: message } });
    await db.portal.update({ where: { id: portal.id }, data: { lastStatus: "FAILED", lastScanAt: new Date(), lastError: message } });
    throw error;
  }
}

type Upload = { name: string; type: string; buffer: Buffer };

/** The files of an unlocked portal document session that can go on a tender (PDF, image, Excel, text; not ZIP), at most 20 MB each. */
async function sessionFiles(id: string, token: string) {
  const session = docSession(token, id);
  if (!session.unlocked) throw new Error("Type the portal's code first, then import.");
  const files: Upload[] = [];
  const skipped: string[] = [];
  for (let index = 0; index < session.documents.length; index += 1) {
    try {
      const file = await tenderDocument(id, token, index);
      const name = file.name.replace(/\s*\(zip\)$/i, "");
      if (file.body.length > 20 * 1024 * 1024 || !allowedUpload(name, file.type.split(";")[0])) {
        skipped.push(name);
        continue;
      }
      files.push({ name, type: file.type.split(";")[0], buffer: file.body });
    } catch {
      skipped.push(session.documents[index].name);
    }
  }
  return { files, skipped };
}

/**
 * Creates a tender from a found listing. Its documents come from an upload, or from the portal documents a person
 * opened here with the portal's code (`docToken`); they are sent to Unfyd OCR like any tender upload. With no
 * documents the tender is created from the listing alone. A tender already imported gets the new documents added.
 */
export async function importSiteTender(actor: Actor, id: string, uploads: Upload[] = [], docToken = "") {
  const found = await db.siteTender.findUnique({ where: { id } });
  if (!found) throw new Error("That tender is not in the list.");
  const fromPortal = docToken ? await sessionFiles(id, docToken) : { files: [], skipped: [] as string[] };
  const files = [...uploads, ...fromPortal.files];
  if (docToken && !files.length) throw new Error(`None of the portal's documents can be read for extraction${fromPortal.skipped.length ? ` (${fromPortal.skipped.join(", ")})` : ""}. Download them and upload the PDF instead.`);
  if (found.status === "IMPORTED" && found.tenderId) {
    if (files.length) {
      await addDocuments(actor, found.tenderId as string, files, "NOTICE");
      await db.siteTender.update({ where: { id }, data: { error: "" } });
    }
    return { tenderId: found.tenderId as string, recordId: "", already: true, files: files.length, skipped: fromPortal.skipped, sourceUrl: "" };
  }
  const site = await db.watchSite.findUnique({ where: { id: found.siteId } });
  const buyer = String(found.organisation || site?.name || "").split(" › ")[0];
  const closing = found.closingAt ? new Date(found.closingAt) : null;
  const closingText = closing
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(closing).replace(",", "")
    : "";
  const sourceUrl = site ? (site.method === "NIC" ? `${site.url}?page=FrontEndTendersByOrganisation&service=page` : String(found.link || site.url)) : String(found.link || "");
  try {
    const result = await createTender(actor, {
      sourceUrl,
      projectName: String(found.title).slice(0, 250),
      clientName: buyer.slice(0, 190),
      portalName: site ? `${siteName(site.name)} (${site.host})` : "Tender website",
      tenderRef: String(found.refNo || found.portalTenderId).slice(0, 190),
      externalTenderId: String(found.portalTenderId || found.tenderKey).slice(0, 190),
      source: "CRAWLER",
      files,
      known: {
        work_description: String(found.title),
        submission_mode: "Electronic",
        ...(site ? { portal_registration: site.host } : {}),
        ...(closingText ? { bid_submission_end: closingText } : {}),
      },
    });
    const note = result.duplicate ? `Already on tender ${result.recordId}.` : files.length ? "" : site?.method === "NIC" ? "No documents fetched: the website asks for a security code (or open them here with the code)." : "No documents fetched: this website only lists its tenders.";
    await db.siteTender.update({ where: { id }, data: { status: "IMPORTED", tenderId: result.tenderId, error: note } });
    return { tenderId: result.tenderId as string, recordId: result.recordId as string, already: result.duplicate, files: files.length, skipped: fromPortal.skipped, sourceUrl };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.siteTender.update({ where: { id }, data: { status: "FAILED", error: message.slice(0, 1000) } });
    throw error;
  }
}

export type SiteTenderDocument = { name: string; description: string; sizeKb: string; type: string };
export type SiteTenderDetails = {
  fetchedAt: string;
  /** Every "label: value" pair from the portal's tender page, in page order. */
  fields: [string, string][];
  documents: { section: string; items: SiteTenderDocument[] }[];
  corrigenda: { title: string; type: string; date: string }[];
  /** Why there is nothing more to show, or a message the portal gave (e.g. the download window has not opened). */
  note: string;
  /** Where a person opens the tender to download its files (NIC asks for a CAPTCHA there). */
  portalUrl: string;
};
const DETAILS_FRESH_MS = 6 * 3600_000;

/** The label/value pairs, document tables and corrigenda on an NIC "View Tender" page. */
export function nicTenderView(html: string) {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/gi, "");
  const fields: [string, string][] = [];
  const seen = new Set<string>();
  for (const match of clean.matchAll(/<td\b[^>]*class="td_caption"[^>]*>((?:(?!<\/?td\b)[\s\S])*)<\/td>\s*<td\b[^>]*class="td_field"[^>]*>((?:(?!<\/td>)[\s\S])*)<\/td>/g)) {
    if (/<table/i.test(match[2])) continue;
    // A caption cell can hold a nested table; it is skipped by the guard below.
    let label = decode(match[1]).replace(/\s*\*$/, "").replace(/ in ₹$/, " (₹)");
    const value = decode(match[2]);
    if (label === "Name" && fields.length) label = "Inviting authority";
    else if (label === "Address" && fields.at(-1)?.[0] === "Inviting authority") label = "Inviting authority address";
    if (!label || !value || seen.has(label)) continue;
    seen.add(label);
    fields.push([label, value]);
  }
  const documents: SiteTenderDetails["documents"] = [];
  const corrigenda: SiteTenderDetails["corrigenda"] = [];
  for (const table of clean.matchAll(/<table[^>]*class="list_table"[^>]*>([\s\S]*?)<\/table>/g)) {
    const header = /<tr class="list_header"[^>]*>([\s\S]*?)<\/tr>/.exec(table[1]);
    if (!header) continue;
    const heads = [...header[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decode(cell[1]).toLowerCase());
    const rows = [...table[1].matchAll(/<tr(?! class="list_header")[^>]*>([\s\S]*?)<\/tr>/g)]
      .map((row) => [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => decode(cell[1])))
      .filter((cells) => cells.length === heads.length && cells.some(Boolean));
    const col = (cells: string[], name: string) => cells[heads.findIndex((head) => head.includes(name))] ?? "";
    if (heads.some((head) => head.includes("corrigendum title"))) {
      for (const cells of rows) corrigenda.push({ title: col(cells, "title"), type: col(cells, "type"), date: col(cells, "date") });
      continue;
    }
    if (!heads.some((head) => head.includes("document name"))) continue;
    const before = clean.slice(0, table.index);
    const captions = [...before.matchAll(/class="(?:td_caption|section_head|textbold1)"[^>]*>\s*(?:<b>)?([^<]{3,60})/g)];
    const section = decode(captions.at(-1)?.[1] ?? "Documents");
    const items = rows
      .map((cells) => ({ name: col(cells, "document name"), description: col(cells, "description"), sizeKb: col(cells, "size"), type: col(cells, "document type") }))
      .filter((item) => item.name);
    if (items.length) documents.push({ section, items });
  }
  const notice = /(Document download date is not begun yet[^<]*|Document download date is over[^<]*)/i.exec(clean)?.[1] ?? "";
  return { fields, documents, corrigenda, note: decode(notice) };
}

/**
 * The full tender as the portal shows it: value, EMD, fee, dates, location, inviting authority and the names of its
 * documents. NIC pages only open inside the session that listed them, so this walks Tenders by Organisation → the
 * organisation → the tender, the same pages the watch reads. The files themselves need the portal's CAPTCHA, so they
 * are listed with a link to open the tender there. Kept on the row for a few hours.
 */
export async function siteTenderDetails(id: string, refresh = false): Promise<SiteTenderDetails> {
  const found = await db.siteTender.findUnique({ where: { id } });
  if (!found) throw new Error("That tender is not in the list.");
  if (!refresh && found.details && found.detailsAt && Date.now() - new Date(found.detailsAt).getTime() < DETAILS_FRESH_MS) {
    try {
      return JSON.parse(String(found.details)) as SiteTenderDetails;
    } catch {
      /* read again below */
    }
  }
  const site = await db.watchSite.findUnique({ where: { id: found.siteId } });
  if (!site) throw new Error("The website for this tender is no longer in the list.");
  const portalUrl = site.method === "NIC" ? `${site.url}?page=FrontEndTendersByOrganisation&service=page` : String(found.link || site.url);
  const empty = { fetchedAt: new Date().toISOString(), fields: [], documents: [], corrigenda: [], portalUrl };
  if (site.method !== "NIC") {
    return { ...empty, note: "This website shows its tenders as a plain list, so there is no detail page to read. Open the tender on the website for its documents." };
  }
  const get = session(String(site.url));
  const orgName = String(found.organisation || "").split(" › ")[0].trim().toLowerCase();
  const organisations = nicOrganisations(await get(`${site.url}?page=FrontEndTendersByOrganisation&service=page`));
  const organisation = organisations.find((item) => item.name.trim().toLowerCase() === orgName) ?? organisations.find((item) => orgName && item.name.toLowerCase().includes(orgName));
  if (!organisation) throw new Error("The organisation no longer lists open tenders on the portal; the tender may have closed.");
  await sleep(PAUSE_MS);
  const list = (await get(organisation.href)).replace(/<!--[\s\S]*?-->/g, "");
  const row = [...list.matchAll(/<tr class="(?:even|odd)"[^>]*>([\s\S]*?)<\/tr>/g)].find((item) => item[1].includes(`[${found.portalTenderId}]`));
  const href = row && /href="([^"]*FrontEndViewTender[^"]*)"/.exec(row[1])?.[1]?.replace(/&amp;/g, "&");
  if (!href) throw new Error("The tender is no longer in the organisation's open list; it may have closed or been withdrawn.");
  await sleep(PAUSE_MS);
  const view = nicTenderView(await get(href));
  const details: SiteTenderDetails = { ...empty, ...view, fetchedAt: new Date().toISOString(), portalUrl };
  await db.siteTender.update({ where: { id }, data: { details: JSON.stringify(details), detailsAt: new Date() } });
  return details;
}

// ---- Tender documents: the portal asks a person for its security code (CAPTCHA) before a file downloads. ----
// The code image is shown in the app, the person types it, and the server sends it in the same portal session, then
// fetches the file. Nothing here reads or guesses the code; a wrong code just shows a new image.

type Reply = { status: number; type: string; disposition: string; body: Buffer; url: string };
/** A portal session that can also POST and receive files; follows redirects itself so no cookie is lost on the way. */
function browser(base: string) {
  const jar = new Map<string, string>();
  return async (path: string, form?: Record<string, string>): Promise<Reply> => {
    let url = new URL(path, base).toString();
    let method = form ? "POST" : "GET";
    let body: string | undefined = form ? new URLSearchParams(form).toString() : undefined;
    for (let hop = 0; hop < 6; hop += 1) {
      const response = await fetch(url, {
        method,
        body,
        headers: {
          "User-Agent": UA,
          Accept: "text/html,application/pdf,*/*",
          "Accept-Language": "en-IN,en;q=0.9",
          ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
          ...(jar.size ? { Cookie: [...jar].map(([key, value]) => `${key}=${value}`).join("; ") } : {}),
        },
        redirect: "manual",
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      for (const line of response.headers.getSetCookie?.() ?? []) {
        const [pair] = line.split(";");
        const at = pair.indexOf("=");
        if (at > 0) jar.set(pair.slice(0, at).trim(), pair.slice(at + 1).trim());
      }
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url).toString();
        method = "GET";
        body = undefined;
        continue;
      }
      if (!response.ok) throw new Error(`${new URL(url).host} answered ${response.status}.`);
      return {
        status: response.status,
        type: (response.headers.get("content-type") || "").toLowerCase(),
        disposition: response.headers.get("content-disposition") || "",
        body: Buffer.from(await response.arrayBuffer()),
        url,
      };
    }
    throw new Error("The portal redirected too many times.");
  };
}
type Send = ReturnType<typeof browser>;
const isFile = (reply: Reply) => !/text\/html|xhtml/.test(reply.type) || reply.body.subarray(0, 5).toString() === "%PDF-";
const fileName = (reply: Reply, fallback: string) =>
  decodeURIComponent(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(reply.disposition)?.[1] ?? "") || fallback;

/** Opens the tender's page on an NIC portal inside `send`'s session: Tenders by Organisation → organisation → tender. */
async function openNicTender(send: Send, site: { url: string }, found: { organisation: string; portalTenderId: string }) {
  const text = async (path: string) => (await send(path)).body.toString("utf8");
  const orgName = String(found.organisation || "").split(" › ")[0].trim().toLowerCase();
  const organisations = nicOrganisations(await text(`${site.url}?page=FrontEndTendersByOrganisation&service=page`));
  const organisation = organisations.find((item) => item.name.trim().toLowerCase() === orgName) ?? organisations.find((item) => orgName && item.name.toLowerCase().includes(orgName));
  if (!organisation) throw new Error("The organisation no longer lists open tenders on the portal; the tender may have closed.");
  await sleep(PAUSE_MS);
  const list = (await text(organisation.href)).replace(/<!--[\s\S]*?-->/g, "");
  const row = [...list.matchAll(/<tr class="(?:even|odd)"[^>]*>([\s\S]*?)<\/tr>/g)].find((item) => item[1].includes(`[${found.portalTenderId}]`));
  const href = row && /href="([^"]*FrontEndViewTender[^"]*)"/.exec(row[1])?.[1]?.replace(/&amp;/g, "&");
  if (!href) throw new Error("The tender is no longer in the organisation's open list; it may have closed or been withdrawn.");
  await sleep(PAUSE_MS);
  return text(href);
}

/** The document links on a tender page (each NIT file, and the portal's "Download as zip file"). */
function documentLinks(html: string) {
  const out: { name: string; href: string }[] = [];
  for (const match of html.replace(/<!--[\s\S]*?-->/g, "").matchAll(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const name = decode(match[2]);
    const href = match[1].replace(/&amp;/g, "&");
    if (/component=docDownoad/i.test(href) || /\.(pdf|xlsx?|docx?|zip|rar)$/i.test(name)) out.push({ name, href });
    else if (/download as zip/i.test(name)) out.push({ name: "All documents (zip)", href });
  }
  return out;
}

/** The portal's code form: where it posts, its hidden fields, and the code image as a data: URL. */
async function captchaForm(html: string, send: Send) {
  const form = /<form[^>]*id="frmCaptcha"[^>]*>([\s\S]*?)<\/form>/i.exec(html) ?? /<form[^>]*>((?:(?!<\/form>)[\s\S])*captchaText[\s\S]*?)<\/form>/i.exec(html);
  if (!form) return null;
  const action = /action="([^"]*)"/i.exec(form[0])?.[1] ?? "";
  const fields: Record<string, string> = {};
  for (const input of form[1].matchAll(/<input\b[^>]*>/gi)) {
    const name = /\bname="([^"]*)"/i.exec(input[0])?.[1];
    if (!name || /type="(submit|button|image)"/i.test(input[0])) continue;
    fields[name] = decode(/\bvalue="([^"]*)"/i.exec(input[0])?.[1] ?? "");
  }
  const submit = /<input\b[^>]*type="submit"[^>]*>/i.exec(form[1])?.[0];
  const submitName = submit && /\bname="([^"]*)"/i.exec(submit)?.[1];
  if (submitName) fields[submitName] = /\bvalue="([^"]*)"/i.exec(submit!)?.[1] ?? "Submit";
  let image = /<img[^>]*id="captchaImage"[^>]*src="([^"]+)"/i.exec(html)?.[1] ?? /<img[^>]*src="([^"]+)"[^>]*id="captchaImage"/i.exec(html)?.[1] ?? "";
  image = image.replace(/\s+/g, "");
  if (image && !image.startsWith("data:")) {
    const reply = await send(image.replace(/&amp;/g, "&"));
    image = `data:${reply.type || "image/png"};base64,${reply.body.toString("base64")}`;
  }
  if (!image || !("captchaText" in fields)) return null;
  return { action, fields, image };
}

type DocSession = {
  siteTenderId: string;
  send: Send;
  documents: { name: string; href: string }[];
  form: { action: string; fields: Record<string, string>; image: string } | null;
  files: Map<number, { name: string; type: string; body: Buffer }>;
  unlocked: boolean;
  at: number;
};
const docSessions = new Map<string, DocSession>();
const DOC_SESSION_MS = 15 * 60_000;
const docSession = (token: string, siteTenderId: string) => {
  for (const [key, value] of docSessions) if (Date.now() - value.at > DOC_SESSION_MS) docSessions.delete(key);
  const session = docSessions.get(token);
  if (!session || session.siteTenderId !== siteTenderId) throw new Error("The portal session has ended. Open the documents again to get a new code.");
  session.at = Date.now();
  return session;
};

/** Opens the tender on its portal and asks for the first document, which brings up the portal's code image. */
export async function startTenderDocuments(id: string) {
  const found = await db.siteTender.findUnique({ where: { id } });
  if (!found) throw new Error("That tender is not in the list.");
  const site = await db.watchSite.findUnique({ where: { id: found.siteId } });
  if (!site || site.method !== "NIC") throw new Error("Documents can only be opened here for tenders on NIC portals.");
  const send = browser(String(site.url));
  const view = await openNicTender(send, site as { url: string }, found as { organisation: string; portalTenderId: string });
  const documents = documentLinks(view);
  if (!documents.length) {
    const notice = /(Document download date is not begun yet[^<]*|Document download date is over[^<]*)/i.exec(view)?.[1];
    throw new Error(notice ? decode(notice) : "The portal shows no document to download for this tender.");
  }
  const token = randomBytes(16).toString("hex");
  const session: DocSession = { siteTenderId: id, send, documents, form: null, files: new Map(), unlocked: false, at: Date.now() };
  docSessions.set(token, session);
  await sleep(PAUSE_MS);
  const first = await send(documents[0].href);
  if (isFile(first)) {
    session.unlocked = true;
    session.files.set(0, { name: fileName(first, documents[0].name), type: first.type || "application/octet-stream", body: first.body });
  } else {
    session.form = await captchaForm(first.body.toString("utf8"), send);
    if (!session.form) throw new Error("The portal did not show its document page as expected; open the tender on the portal instead.");
  }
  return { token, unlocked: session.unlocked, captcha: session.form?.image ?? "", documents: documents.map((doc, index) => ({ index, name: doc.name })) };
}

/** Sends the code the person typed. A wrong code gives a fresh image; a right one unlocks the files for this session. */
export async function unlockTenderDocuments(id: string, token: string, code: string) {
  const session = docSession(token, id);
  if (session.unlocked) return { unlocked: true, captcha: "", documents: session.documents.map((doc, index) => ({ index, name: doc.name })) };
  if (!session.form) throw new Error("There is no code to enter for this session. Open the documents again.");
  const reply = await session.send(session.form.action || "/", { ...session.form.fields, captchaText: code.trim() });
  if (isFile(reply)) {
    session.unlocked = true;
    session.files.set(0, { name: fileName(reply, session.documents[0].name), type: reply.type || "application/octet-stream", body: reply.body });
  } else {
    const html = reply.body.toString("utf8");
    const again = await captchaForm(html, session.send);
    if (again) {
      session.form = again;
      return { unlocked: false, error: "The portal did not accept that code. Type the new one.", captcha: again.image, documents: [] };
    }
    session.unlocked = true;
    session.form = null;
    // The page after the code may carry its own document links; use them when it does.
    const links = documentLinks(html);
    if (links.length) session.documents = links;
  }
  return { unlocked: true, captcha: "", documents: session.documents.map((doc, index) => ({ index, name: doc.name })) };
}

/** One document from an unlocked session, as the portal sends it. */
export async function tenderDocument(id: string, token: string, index: number) {
  const session = docSession(token, id);
  const cached = session.files.get(index);
  if (cached) return cached;
  if (!session.unlocked) throw new Error("Type the portal's code first.");
  const doc = session.documents[index];
  if (!doc) throw new Error("That document is not on the tender.");
  const reply = await session.send(doc.href);
  if (!isFile(reply)) {
    const again = await captchaForm(reply.body.toString("utf8"), session.send);
    if (again) {
      session.unlocked = false;
      session.form = again;
      throw Object.assign(new Error("The portal asks for its code again."), { captcha: again.image });
    }
    throw new Error("The portal sent a page instead of the file; open the tender on the portal instead.");
  }
  const file = { name: fileName(reply, doc.name), type: reply.type || "application/octet-stream", body: reply.body };
  session.files.set(index, file);
  return file;
}

/** Called as people use the app: starts a pass when the watch is on and the last one is older than its frequency. */
export async function maybeScheduledSiteScan() {
  if (running) return;
  const portal = await db.portal.findFirst({ where: { accessMethod: "SITE_WATCH" } });
  if (!portal || !portal.enabled) return;
  const due = !portal.lastScanAt || Date.now() - new Date(portal.lastScanAt).getTime() >= portal.frequencyHours * 36e5;
  if (!due || portal.lastStatus === "NOT_SCANNED") return;
  void runSiteWatch().catch((error) => console.error("Tender sites watch failed", error));
}
