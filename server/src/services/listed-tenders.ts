import { addGemBidByNumber } from "./gem";
import { addSiteTenderByNumber } from "./site-watch";

/**
 * Tenders the team asked to have in the search results by number, whether or not a keyword finds them. On each start
 * the server adds the ones that are still open and not yet in the list, so a push puts them on the live site too.
 * One already in the list is left as it is (an ignore or import stays). Past `until` an entry is skipped.
 */
export const LISTED_TENDERS: { number: string; website?: string; line: "Ash" | "Coal"; keyword: string; until: string }[] = [
  { number: "GEM/2026/B/8218205", line: "Coal", keyword: "Mine Developer and Operator (MDO)", until: "2027-01-27T21:00:00+05:30" },
  { number: "GEM/2026/B/8261452", line: "Coal", keyword: "Coal Handling Service", until: "2026-11-26T17:00:00+05:30" },
  {
    number: "2026_RRVUN_594878_1",
    website: "https://eproc.rajasthan.gov.in/nicgep/app",
    line: "Coal",
    keyword: "Supply of Coal",
    until: "2026-11-28T14:00:00+05:30",
  },
];

export async function addListedTenders() {
  for (const entry of LISTED_TENDERS) {
    if (Date.now() > new Date(entry.until).getTime()) continue;
    try {
      const result = entry.website
        ? await addSiteTenderByNumber(entry.website, entry.number, entry.line, entry.keyword, { keepLine: true })
        : await addGemBidByNumber(entry.number, entry.line, entry.keyword, { keepLine: true });
      if (!result.already) console.log(`[tenders] ${entry.number} added to the ${entry.line} list.`);
    } catch (error) {
      console.error(`[tenders] ${entry.number} was not added:`, error instanceof Error ? error.message : error);
    }
  }
}
