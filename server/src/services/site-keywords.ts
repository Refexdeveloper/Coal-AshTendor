/** Which copy of the "Tender Sourcing Keywords" sheet the list below comes from; a new one clears the earlier results. */
export const SITE_KEYWORD_SHEET = "sheet-4";

/**
 * Tender-website search keywords from the "Tender Sourcing Keywords" sheet (its Coal tab, then the Ash and AHP O&M
 * headings of its Keywords tab), each heading with the sheet's minimum tender value in crore: a tender found by the
 * heading's keywords is kept only when its value on the portal is above that amount.
 */
/** The sheet's two kinds of work: its Coal tab, and the Ash headings of its Keywords tab. */
export const KEYWORD_TYPES = ["Coal", "Ash"] as const;

export const SITE_KEYWORD_HEADINGS: { heading: string; type: string; minCrore: number; keywords: string[] }[] = [
  { heading: "Coal Transportation", type: "Coal", minCrore: 10, keywords: ["Coal Transportation", "Transportation of Coal by Road", "Road Transportation of Coal", "Transportation of ROM Coal", "Transportation of Crushed Coal", "Transportation of Raw Coal", "Coal Transportation from Mines to Power Plant", "Coal Transportation from Mines to Railway Siding", "Coal Transportation from Stockyard to CHP", "Coal Transportation from Mine to Mine", "Internal Transportation of Coal", "Surface Transportation of Coal", "Mechanical Transportation of Coal", "Evacuation of Coal", "Coal Logistics", "Coal Lifting and Transportation", "Transportation of Coal by Tippers", "Hiring of Tippers for Coal Transportation", "Transportation of Coal from Pit Head", "Coal Transportation and Delivery"] },
  { heading: "Coal Loading & Handling", type: "Coal", minCrore: 10, keywords: ["Loading and Transportation of Coal", "Coal Loading and Unloading", "Coal Handling Service", "Coal Handling and Transportation", "Payloader and Transportation of Coal", "Hiring of Payloader and Tippers", "Hiring of Payloader for Coal Loading", "Mechanical Loading of Coal", "Loading of Coal into Tippers", "Loading of Coal into Wagons", "Wagon Loading of Coal", "Wagon Unloading of Coal", "Loading, Transportation and Unloading of Coal", "Rehandling of Coal", "Coal Stockyard Management", "Coal Handling at Railway Siding", "Coal Handling and Liaisoning", "Coal Loading and Stacking"] },
  { heading: "Coal Crushing", type: "Coal", minCrore: 10, keywords: ["Crusher and Transportation of Coal", "Crushing and Transportation of Coal", "Crushing, Loading and Transportation of Coal", "Crushing of ROM Coal", "Crushing of Coal by Mobile Crusher"] },
  { heading: "RCR, RSR & Railway", type: "Coal", minCrore: 10, keywords: ["Road Cum Rail (RCR) Mode", "Road-cum-Rail Transportation of Coal", "Rail-Sea-Rail (RSR) Mode", "Rail Cum Road Transportation of Coal", "Transportation of Coal by Rail", "Coal Transportation through RCR Mode", "Coal Transportation through RSR Mode", "Coal Transportation through Rail Mode", "Coal Transportation through Alternate Mode", "Coal Transportation from Mines to Private Siding", "Coal Transportation to Railway Goods Shed", "Coal Transportation and Wagon Loading", "Railway Rake Loading", "Coal Rake Handling", "Coal Rake Management", "Coal Dispatch through Railway", "Multimodal Transportation of Coal", "End-to-End Coal Transportation", "Coal Transportation through MGR System"] },
  { heading: "OB Removal & Mining", type: "Coal", minCrore: 10, keywords: ["OB Removal", "Overburden Removal", "Overburden Transportation", "OB Removal, Handling & Transport Service", "Composite Work for OB Removal, Handling, Transport and Other Mining Services", "Coal Extraction and Handover of Excavated Coal", "Removal of Overburden and Extraction of Coal", "Excavation and Transportation of Overburden", "Excavation, Loading and Transportation of Coal", "Hiring of Excavators and Tippers", "Outsourcing of Mining Operations", "Outsourcing of Coal Production", "Composite Mining Work", "Surface Miner and Transportation of Coal", "Coal Extraction by Surface Miner", "Mining Development and Operation", "Mine Developer and Operator (MDO)", "Rehandling of Overburden", "Removal and Transportation of Earth", "Excavation of Coal and Overburden", "Drilling, Excavation and Transportation"] },
  { heading: "Coal Supply & Fuel Management", type: "Coal", minCrore: 5, keywords: ["Supply of Coal", "Supply of Domestic Coal", "Supply of Imported Coal", "Supply and Transportation of Coal", "Supply of Non-Coking Coal", "Supply of Washed Coal", "Supply of Raw Coal", "Coal Procurement and Transportation", "Coal Beneficiation", "Coal Washing Services", "Washery Reject Transportation", "Fuel Management Services", "Coal Aggregation and Supply"] },
  { heading: "Ash", type: "Ash", minCrore: 2, keywords: ["fly ash", "dry fly ash", "bottom ash", "pond ash", "lagoon ash", "ash slurry", "ash water", "ash mix", "conditioned fly ash", "unutilized fly ash", "legacy ash", "ash from thermal power plants", "ash transportation", "fly ash transportation", "bottom ash transportation", "pond ash transportation", "ash evacuation", "fly ash evacuation", "ash handling", "ash loading", "ash unloading", "ash lifting", "ash shifting", "ash disposal", "ash management", "ash utilization", "ash collection", "ash removal", "ash slurry transportation", "ash slurry disposal", "ash dyke management", "ash pond management", "ash bund", "ash filling", "ash embankment", "ash pipeline", "dry fly ash handling", "ash silo operation", "ash loading into bulkers", "fly ash bulk transportation", "ash logistics", "ash disposal transportation", "ash-to-cement plant transportation", "ash transportation by road", "ash transportation by bulkers", "ash transportation by tankers", "ash transportation by trucks", "fly ash sale", "fly ash auction", "dry fly ash auction", "bottom ash auction", "pond ash auction", "ash sale", "ash e-auction", "ash purchase", "purchase of fly ash", "procurement of fly ash", "sale of pond ash", "sale of bottom ash", "unutilized fly ash sale", "ash lifting contract", "ash lifting and transportation", "ash buyers", "ash disposal through sale", "ash auction quantity", "dry fly ash supply"] },
  { heading: "AHP O&M", type: "Ash", minCrore: 1, keywords: ["AHP", "Ash Handling Plant", "AHP O&M", "operation and maintenance of AHP", "ash handling plant operation", "ash handling plant maintenance", "bottom ash handling system", "fly ash handling system", "pneumatic ash handling", "ash water recirculation system", "ash silo operation", "ash dyke operation and maintenance", "O&M contract"] },
];

/** Heading → keywords, for the page's filters. */
export const SITE_KEYWORD_GROUPS: Record<string, string[]> = Object.fromEntries(SITE_KEYWORD_HEADINGS.map((group) => [group.heading, group.keywords]));

/** Every searched keyword once, in sheet order. */
export const SITE_KEYWORDS = [...new Map(SITE_KEYWORD_HEADINGS.flatMap((group) => group.keywords).map((word) => [word.toLowerCase(), word])).values()];

/** A heading of the saved keyword list, with the tender value (crore) its tenders must be above (0: any value). */
export type KeywordHeading = { heading: string; type: string; minCrore: number; keywords: string[] };

/**
 * A heading's type when its saved line gives none: the sheet's heading of that name, "Other" for Other keywords, else
 * Ash when the name says ash (or AHP), else Coal.
 */
export function headingType(heading: string) {
  const sheet = SITE_KEYWORD_HEADINGS.find((group) => group.heading.toLowerCase() === heading.toLowerCase());
  if (sheet) return sheet.type;
  if (heading.toLowerCase() === OTHER_HEADING.toLowerCase()) return "Other";
  return /\bash\b|\bahp\b/i.test(heading) ? "Ash" : "Coal";
}

/** Where a keyword without a heading goes. */
export const OTHER_HEADING = "Other keywords";

/**
 * The saved keyword list, read into headings. It is saved one keyword per line, each heading on a line of its own as
 * "# Heading | 10" (the minimum in crore). A list saved before headings (one per line, or comma-separated) is read
 * with the sheet's headings, and a keyword the sheet does not have goes under "Other keywords".
 */
export function parseKeywordHeadings(value: string): KeywordHeading[] {
  const text = String(value || "");
  const lines = text.split(text.includes("\n") ? /\n+/ : /[,;]+/).map((line) => line.trim()).filter(Boolean);
  const groups: KeywordHeading[] = [];
  const seen = new Set<string>();
  const groupOf = (heading: string, minCrore = 0, type = "") => {
    let group = groups.find((item) => item.heading.toLowerCase() === heading.toLowerCase());
    if (!group) groups.push((group = { heading, type: type || headingType(heading), minCrore, keywords: [] }));
    return group;
  };
  const sheetHeading = (word: string) => SITE_KEYWORD_HEADINGS.find((group) => group.keywords.some((item) => item.toLowerCase() === word.toLowerCase()));
  const withHeadings = lines.some((line) => line.startsWith("#"));
  let current: KeywordHeading | null = null;
  for (const line of lines) {
    if (line.startsWith("#")) {
      const [name, amount, type] = line.replace(/^#+\s*/, "").split("|").map((part) => part.trim());
      current = name ? groupOf(name, Math.max(0, Number(amount) || 0), type) : null;
      continue;
    }
    if (seen.has(line.toLowerCase())) continue;
    seen.add(line.toLowerCase());
    const sheet = withHeadings ? null : sheetHeading(line);
    const group = current ?? (sheet ? groupOf(sheet.heading, sheet.minCrore, sheet.type) : groupOf(OTHER_HEADING));
    group.keywords.push(line);
  }
  // A list read without headings keeps the sheet's heading order.
  if (!withHeadings) groups.sort((a, b) => order(a.heading) - order(b.heading));
  return groups;
}
const order = (heading: string) => {
  const at = SITE_KEYWORD_HEADINGS.findIndex((group) => group.heading === heading);
  return at < 0 ? SITE_KEYWORD_HEADINGS.length : at;
};

/** The keyword list as it is saved: each heading line, then its keywords. */
export const formatKeywordHeadings = (groups: KeywordHeading[]) =>
  groups
    .filter((group) => group.keywords.length)
    .map((group) => [`# ${group.heading.replace(/[|\n#]/g, " ").trim()} | ${group.minCrore} | ${group.type}`, ...group.keywords].join("\n"))
    .join("\n");

/** Every keyword of a saved list. */
export const keywordList = (value: string) => parseKeywordHeadings(value).flatMap((group) => group.keywords);

/**
 * The smallest tender value (in rupees) a keyword asks for: a keyword under two headings takes the lower amount, and
 * one under a heading with no amount asks for none.
 */
export function minimumRupees(groups: KeywordHeading[], keyword: string) {
  const word = keyword.trim().toLowerCase();
  const amounts = groups.filter((group) => group.keywords.some((item) => item.toLowerCase() === word)).map((group) => group.minCrore);
  return amounts.length ? Math.min(...amounts) * 1e7 : 0;
}

/** The sheet's list, as first saved. */
export const SHEET_KEYWORD_TEXT = () => formatKeywordHeadings(SITE_KEYWORD_HEADINGS.map((group) => ({ ...group, keywords: [...group.keywords] })));

/** The earlier sheet's yellow rows: never searched, on the websites or on GeM. */
export const SHEET_YELLOW_KEYWORDS = [
  "annual maintenance contract",
  "belt conveyor",
  "breakdown maintenance",
  "CHP",
  "CHP O&M",
  "coal bunker filling",
  "coal conveying",
  "coal crusher",
  "coal crushing",
  "coal crushing and screening",
  "coal feeder",
  "coal feeding",
  "Coal Handling Plant",
  "coal handling plant",
  "coal handling plant maintenance",
  "coal handling plant operation",
  "coal handling plant operation and maintenance",
  "coal handling system",
  "coal loading system",
  "coal plant material handling",
  "coal processing",
  "coal reclaiming",
  "coal screening",
  "coal sizing",
  "coal stacking",
  "coal stockyard management",
  "coal stockyard operation",
  "coal transfer system",
  "coal yard management",
  "conveyor belt operation",
  "conveyor maintenance",
  "conveyor system",
  "crusher house",
  "crusher maintenance",
  "electrical maintenance",
  "feeder maintenance",
  "housekeeping of ash handling plant",
  "instrumentation maintenance",
  "manpower for plant operation",
  "mechanical maintenance",
  "operation and maintenance of CHP",
  "operation and maintenance services",
  "plant equipment operation",
  "plant operation and maintenance",
  "power plant material handling",
  "preventive maintenance",
  "rapid loading system",
  "reclaim feeder",
  "track hopper maintenance",
  "track hopper unloading",
  "vibrating screen",
  "wagon tippler maintenance",
  "wagon tippler operation and maintenance",
];

/** The sheet's regional organisations: a filter on the tender's organisation, not a title keyword (every CCL tender would match). */
export const SITE_ORGANISATION_FILTERS = ["TVNL", "JUUNL", "JUSNL", "JUVNL", "CCL", "NTPC North Karanpura", "Patratu"];

const yellow = new Set(SHEET_YELLOW_KEYWORDS.map((word) => word.toLowerCase()));
export const isYellowKeyword = (word: string) => yellow.has(word.trim().toLowerCase());
