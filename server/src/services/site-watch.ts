import { createHash } from "node:crypto";
import { db } from "../db";
import { createTender, type Actor } from "./domain";
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
export function pageTenders(html: string, base: string): FoundTender[] {
  const clean = html.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ");
  const host = new URL(base).host;
  const blocks = [
    ...[...clean.matchAll(/<tr[\s>][\s\S]*?<\/tr>/gi)].map((match) => match[0]),
    ...[...clean.matchAll(/<li[\s>][\s\S]*?<\/li>/gi)].map((match) => match[0]),
    ...[...clean.matchAll(/<a\s[^>]*>[\s\S]*?<\/a>/gi)].map((match) => match[0]),
  ];
  const seen = new Set<string>();
  const out: FoundTender[] = [];
  for (const block of blocks) {
    const text = decode(block);
    if (text.length < 15 || text.length > 900 || seen.has(text)) continue;
    seen.add(text);
    let link = "";
    const href = /href\s*=\s*["']([^"'#][^"']*)["']/i.exec(block)?.[1];
    if (href) {
      try {
        const url = new URL(href.replace(/&amp;/g, "&"), base);
        if (url.protocol === "https:" || url.protocol === "http:") link = url.toString();
      } catch {
        /* no usable link */
      }
    }
    const digest = createHash("sha1").update(text.toLowerCase()).digest("hex").slice(0, 20);
    out.push({ key: `${host}:${digest}`, tenderId: "", refNo: "", title: text.slice(0, 2000), organisation: "", link, published: "", closing: "", opening: "" });
  }
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
  const have = new Set((await db.watchSite.findMany({ select: { host: true } })).map((site: { host: string }) => site.host));
  for (const seed of SITE_SEEDS) {
    if (have.has(seed.host)) continue;
    await db.watchSite.create({ data: { ...seed, enabled: seed.method !== "MANUAL" } }).catch(() => undefined);
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

/** Creates a tender from a found listing. The documents stay on the portal (their download needs a CAPTCHA), so they are added by hand. */
export async function importSiteTender(actor: Actor, id: string) {
  const found = await db.siteTender.findUnique({ where: { id } });
  if (!found) throw new Error("That tender is not in the list.");
  if (found.status === "IMPORTED" && found.tenderId) return { tenderId: found.tenderId as string, recordId: "", already: true };
  const site = await db.watchSite.findUnique({ where: { id: found.siteId } });
  const buyer = String(found.organisation || site?.name || "").split(" › ")[0];
  const closing = found.closingAt ? new Date(found.closingAt) : null;
  const closingText = closing
    ? new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }).format(closing).replace(",", "")
    : "";
  try {
    const result = await createTender(actor, {
      projectName: String(found.title).slice(0, 250),
      clientName: buyer.slice(0, 190),
      portalName: site ? `${siteName(site.name)} (${site.host})` : "Tender website",
      tenderRef: String(found.refNo || found.portalTenderId).slice(0, 190),
      externalTenderId: String(found.portalTenderId || found.tenderKey).slice(0, 190),
      source: "CRAWLER",
      files: [],
      known: {
        work_description: String(found.title),
        submission_mode: "Electronic",
        ...(site ? { portal_registration: site.host } : {}),
        ...(closingText ? { bid_submission_end: closingText } : {}),
      },
    });
    await db.siteTender.update({ where: { id }, data: { status: "IMPORTED", tenderId: result.tenderId, error: result.duplicate ? `Already on tender ${result.recordId}.` : "" } });
    return { tenderId: result.tenderId as string, recordId: result.recordId as string, already: result.duplicate };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.siteTender.update({ where: { id }, data: { status: "FAILED", error: message.slice(0, 1000) } });
    throw error;
  }
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
