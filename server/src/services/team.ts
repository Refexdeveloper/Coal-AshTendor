import { db } from "../db";

/**
 * Who owns each workflow stage, by business line (Ash or Coal) and, for sales input, by state.
 * People are matched by email, so a renamed account or a changed role does not break routing.
 */

export type BusinessLine = "ASH" | "COAL";
export const BUSINESS_LINES: BusinessLine[] = ["ASH", "COAL"];

/** The roster. `key` keeps the legacy personKey for people the app already knew by key. */
export const TEAM = [
  { email: "prasanth.p@refex.co.in", name: "Prasanth P", role: "COORDINATOR" },
  { email: "lokesh.b@refex.co.in", name: "Lokesh B", role: "COORDINATOR", key: "lokesh" },
  { email: "ranjana.s@refex.co.in", name: "Ranjana S", role: "REVIEWER", key: "ranjana" },
  { email: "sundaralingam.g@refex.co.in", name: "Sundaralingam G", role: "COSTING", key: "sundarlingam" },
  { email: "aditya.ks@refex.co.in", name: "Aditya K S", role: "REVIEWER" },
  { email: "vishesh.h@refex.co.in", name: "Vishesh H", role: "DEPT_HEAD", key: "vishesh" },
  { email: "susmitha.s@refex.co.in", name: "Susmitha S", role: "DEPT_HEAD" },
  { email: "krishna.s@refex.co.in", name: "Krishnananth S", role: "ACCOUNTS", key: "krishnanath" },
  { email: "surya.m@refex.co.in", name: "Surya M", role: "ACCOUNTS", key: "surya" },
  { email: "sanjeev.ks@refex.co.in", name: "Sanjeev Sharma", role: "EMD_ISB", key: "sanjeev" },
  { email: "waseem@refex.co.in", name: "Mohammad Wasim Farooque", role: "SALES" },
  { email: "yash.gupta@refex.co.in", name: "Yash Gupta", role: "SALES" },
  { email: "rajsanjay.k@refex.co.in", name: "Raj Sanjay Khopkar", role: "SALES" },
  { email: "shohal.khare@refex.co.in", name: "Sohal Brijesh Khare", role: "SALES" },
  { email: "udit.b@refex.co.in", name: "Udit Bondia", role: "SALES" },
  { email: "chandankumar.s@refex.co.in", name: "Chandan Kumar Sharma", role: "SALES" },
  { email: "suyash.shubam@refex.co.in", name: "Suyash Shubham", role: "SALES" },
  { email: "jagjeet.s@refex.co.in", name: "Jagjeet Singh Malhari", role: "SALES" },
  { email: "gaurav.l@refex.co.in", name: "Gaurav Lakhotia", role: "SALES" },
  { email: "shatadal.dm@refex.co.in", name: "Shatadal Mahapatra", role: "SALES" },
  { email: "vimalkumar.v@refex.co.in", name: "Vimal Kumar Vyas", role: "SALES" },
  { email: "babu.sathiyavelu@refex.co.in", name: "Babu Sathiyavelu", role: "SALES" },
  { email: "ashishkumar.m@refex.co.in", name: "Aashish Kumar Mukherji", role: "SALES" },
  { email: "harshit.saxena@refex.co.in", name: "Harshit Saxena", role: "SALES" },
  { email: "srivaths.varadharajan@refex.co.in", name: "Srivaths Varadharajan", role: "GROUP_CEO" },
] as const;

const PRASANTH = "prasanth.p@refex.co.in";
const LOKESH = "lokesh.b@refex.co.in";
const RANJANA = "ranjana.s@refex.co.in";
const SUNDAR = "sundaralingam.g@refex.co.in";
const ADITYA = "aditya.ks@refex.co.in";
const VISHESH = "vishesh.h@refex.co.in";
const SUSMITHA = "susmitha.s@refex.co.in";
const KRISHNA = "krishna.s@refex.co.in";
const SURYA = "surya.m@refex.co.in";
const SANJEEV = "sanjeev.ks@refex.co.in";
const WASEEM = "waseem@refex.co.in";

type Route = string[] | Record<BusinessLine, string[]>;

/** Stage owners from the responsibility list. Sales input is routed by state below. */
const ROUTES: Record<string, Route> = {
  DATA_VALIDATION: { ASH: [PRASANTH, LOKESH, RANJANA, SUNDAR], COAL: [ADITYA] },
  RELEVANCE: { ASH: [RANJANA, VISHESH], COAL: [ADITYA] },
  EMD_CLARIFICATION: [RANJANA],
  EMD_BG: [KRISHNA, SURYA],
  EMD_EXEMPTION: [KRISHNA, SURYA],
  EMD_OTHER: [KRISHNA, SURYA],
  EMD_ISB: [SANJEEV],
  DRAFT_COSTING: [SUNDAR],
  FINAL_COSTING: { ASH: [SUNDAR, WASEEM], COAL: [ADITYA] },
  DEPT_APPROVAL: [VISHESH, SUSMITHA],
  BUSINESS_DECISION: [VISHESH],
  BID_SUBMISSION: { ASH: [RANJANA], COAL: [ADITYA] },
};

/** Sales costing input by state. Order matters only for display. */
export const SALES_BY_STATE: { state: string; match: RegExp; emails: string[] }[] = [
  { state: "Maharashtra", match: /maharashtra|\bMH\b|mumbai|nagpur|chandrapur|nashik|pune/i, emails: ["yash.gupta@refex.co.in", "rajsanjay.k@refex.co.in", "shohal.khare@refex.co.in"] },
  { state: "Odisha", match: /odisha|orissa|\bOD\b|bhubaneswar|talcher|angul|jharsuguda/i, emails: ["udit.b@refex.co.in"] },
  { state: "Jharkhand", match: /jharkhand|\bJH\b|ranchi|dhanbad|bokaro|jamshedpur/i, emails: ["chandankumar.s@refex.co.in"] },
  { state: "Bihar", match: /bihar|\bBR\b|patna|barh|kahalgaon|nabinagar/i, emails: ["suyash.shubam@refex.co.in", "shohal.khare@refex.co.in"] },
  { state: "Chhattisgarh", match: /chhattisgarh|chattisgarh|\bCG\b|korba|raipur|bilaspur|sipat|raigarh/i, emails: [WASEEM, "jagjeet.s@refex.co.in"] },
  { state: "West Bengal", match: /west bengal|\bWB\b|kolkata|durgapur|farakka|bandel|sagardighi/i, emails: ["gaurav.l@refex.co.in", "shatadal.dm@refex.co.in"] },
  { state: "Madhya Pradesh", match: /madhya pradesh|\bMP\b|bhopal|singrauli|vindhyachal|satpura|khandwa|jabalpur/i, emails: [WASEEM, "vimalkumar.v@refex.co.in"] },
  { state: "Tamil Nadu", match: /tamil ?nadu|\bTN\b|chennai|tuticorin|thoothukudi|mettur|neyveli|ennore/i, emails: ["babu.sathiyavelu@refex.co.in"] },
  { state: "Rajasthan", match: /rajasthan|jaipur|kota|suratgarh|chhabra|kalisindh/i, emails: ["ashishkumar.m@refex.co.in"] },
  { state: "Haryana", match: /haryana|panipat|yamunanagar|hisar|jhajjar/i, emails: ["ashishkumar.m@refex.co.in"] },
  { state: "Delhi", match: /\bdelhi\b|\bNCR\b/i, emails: ["harshit.saxena@refex.co.in"] },
  { state: "Assam", match: /assam|guwahati|bongaigaon/i, emails: ["shohal.khare@refex.co.in"] },
];

const ALL_SALES = [...new Set(SALES_BY_STATE.flatMap((row) => row.emails))];

/** Reads Ash or Coal from the notice text. Coal wins only when it is mentioned more often than ash. */
export function detectLine(text: string): BusinessLine {
  const coal = (text.match(/\bcoal\b/gi) ?? []).length;
  const ash = (text.match(/\bash\b|fly ?ash|pond ?ash|bottom ?ash/gi) ?? []).length;
  return coal > ash ? "COAL" : "ASH";
}

/** The first state named in the text, checked in the order given (location first). */
export function detectState(...texts: string[]) {
  for (const text of texts) {
    if (!text) continue;
    const hit = SALES_BY_STATE.find((row) => row.match.test(text));
    if (hit) return hit.state;
  }
  return null;
}

export function lineOf(value: string | null | undefined): BusinessLine {
  return value === "COAL" ? "COAL" : "ASH";
}

export type RoutingTender = { businessLine?: string | null; location?: string | null; clientName?: string | null; projectName?: string | null };

/** Emails that own a stage for this tender. EMD_* stages and SALES_INPUT included. */
export function ownerEmails(stage: string, tender: RoutingTender) {
  if (stage === "SALES_INPUT") {
    const state = detectState(tender.location ?? "", tender.clientName ?? "", tender.projectName ?? "");
    return SALES_BY_STATE.find((row) => row.state === state)?.emails ?? ALL_SALES;
  }
  const route = ROUTES[stage];
  if (!route) return [];
  return Array.isArray(route) ? route : route[lineOf(tender.businessLine)];
}

/** Active user ids that own a stage. Falls back to `fallbackRole` holders when nobody on the list can sign in. */
export async function ownersFor(stage: string, tender: RoutingTender, fallbackRole?: string) {
  const emails = ownerEmails(stage, tender);
  const users = emails.length ? await db.user.findMany({ where: { email: { in: emails }, active: true } }) : [];
  if (users.length) return emails.map((email) => users.find((user: { email: string }) => user.email.toLowerCase() === email)?.id).filter((id): id is string => Boolean(id));
  if (!fallbackRole) return [];
  return (await db.user.findMany({ where: { role: fallbackRole, active: true } })).map((user: { id: string }) => user.id);
}

/** Names per stage for the progress track, so later steps show who will take them. */
export async function plannedOwners(tender: RoutingTender & { emdType?: string | null }) {
  const stages = ["DATA_VALIDATION", "RELEVANCE", "DRAFT_COSTING", "SALES_INPUT", "FINAL_COSTING", "DEPT_APPROVAL", "EMD_CLARIFICATION", "BID_SUBMISSION"];
  // Until the EMD type is known, either the BG team or the ISB owner may prepare it.
  const instrument =
    tender.emdType === "ISB" ? ownerEmails("EMD_ISB", tender) : tender.emdType === "UNCLEAR" || !tender.emdType ? [...ownerEmails("EMD_BG", tender), ...ownerEmails("EMD_ISB", tender)] : ownerEmails("EMD_BG", tender);
  const wanted = new Map([...stages.map((stage) => [stage, ownerEmails(stage, tender)] as const), ["EMD_INSTRUMENT", instrument] as const]);
  const emails = [...new Set([...wanted.values()].flat())];
  const users = emails.length ? await db.user.findMany({ where: { email: { in: emails } } }) : [];
  const nameOf = (email: string) => users.find((user: { email: string }) => user.email.toLowerCase() === email)?.name ?? TEAM.find((person) => person.email === email)?.name ?? email;
  return {
    line: lineOf(tender.businessLine),
    state: detectState(tender.location ?? "", tender.clientName ?? "", tender.projectName ?? ""),
    stages: Object.fromEntries([...wanted.entries()].map(([stage, list]) => [stage, list.map(nameOf)])) as Record<string, string[]>,
  };
}
