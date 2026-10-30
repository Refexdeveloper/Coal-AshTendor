export const NOT_FOUND = "Not Found in Document";

export type FieldType = "text" | "long" | "datetime" | "money" | "choice" | "integer";

export type FieldDef = {
  no: number;
  key: string;
  label: string;
  type: FieldType;
  critical?: boolean;
  options?: string[];
  synonyms?: string[];
};

export const TENDER_FIELDS: FieldDef[] = [
  { no: 1, key: "project_name", label: "Name of the Project", type: "text", critical: true, synonyms: ["Project name", "Name of work"] },
  { no: 2, key: "tender_ref", label: "Tender reference number", type: "text", critical: true, synonyms: ["Tender reference", "NIT reference"] },
  { no: 3, key: "tender_id", label: "Tender ID", type: "text", critical: true, synonyms: ["Tender no", "NIT no", "NIT number"] },
  { no: 4, key: "client_name", label: "Client name", type: "text", critical: true, synonyms: ["Name of client", "Employer"] },
  { no: 5, key: "work_description", label: "Work description", type: "long" },
  { no: 6, key: "location", label: "Location", type: "text", synonyms: ["Place of work", "Site location"] },
  { no: 7, key: "bid_submission_end", label: "Bid submission end date", type: "datetime", critical: true, synonyms: ["Bid submission deadline", "Last date of submission", "Bid end date"] },
  { no: 8, key: "bid_opening", label: "Bid opening date", type: "datetime", synonyms: ["Bid opening date and time"] },
  { no: 9, key: "prebid_conference", label: "Pre-bid conference date and time", type: "datetime", synonyms: ["Pre-bid meeting", "Pre bid conference"] },
  { no: 10, key: "hardcopy_submission", label: "Hard copy submission date", type: "datetime" },
  { no: 11, key: "estimated_cost", label: "Estimated cost", type: "money", synonyms: ["Estimated value"] },
  { no: 12, key: "tender_fee", label: "Tender fee", type: "money", synonyms: ["Cost of tender", "Tender document fee"] },
  { no: 13, key: "emd_fee", label: "EMD fee", type: "money", critical: true, synonyms: ["EMD amount", "Earnest money deposit", "Earnest money"] },
  {
    no: 14,
    key: "emd_form",
    label: "EMD form process",
    type: "choice",
    critical: true,
    options: ["Bank Guarantee", "ISB / Surety Bond", "Demand Draft", "Online Payment", "Exemption", "Other"],
    synonyms: ["EMD form", "Form of EMD"],
  },
  {
    no: 15,
    key: "emd_exemption",
    label: "EMD exemption",
    type: "choice",
    critical: true,
    options: ["Yes", "No", "Clarification Required"],
  },
  { no: 16, key: "performance_bg", label: "Performance fee starting (PBG)", type: "text", synonyms: ["Performance bank guarantee", "PBG"] },
  {
    no: 17,
    key: "submission_mode",
    label: "Mode of submission",
    type: "choice",
    options: ["Electronic", "Physical", "Both", "Other"],
  },
  {
    no: 18,
    key: "hardcopy_required",
    label: "Hard copy required",
    type: "choice",
    options: ["Yes", "No", "Clarification Required"],
  },
  { no: 19, key: "contract_period", label: "Contract period", type: "text" },
  { no: 20, key: "envelope_count", label: "Number of envelopes", type: "integer" },
  { no: 21, key: "pq_technical", label: "Pre-qualification criteria — technical", type: "long", synonyms: ["Pre-qualification criteria - technical", "Technical eligibility"] },
  { no: 22, key: "pq_financial", label: "Pre-qualification criteria — financial", type: "long", synonyms: ["Pre-qualification criteria - financial", "Financial eligibility"] },
  {
    no: 23,
    key: "jv_allowed",
    label: "Consortium / JV allowed",
    type: "choice",
    options: ["Yes", "No", "Conditional"],
    synonyms: ["JV allowed", "Consortium allowed"],
  },
  { no: 24, key: "bid_validity", label: "Bid validity", type: "text" },
  { no: 25, key: "contact_person", label: "Contact person", type: "text" },
  { no: 26, key: "contact_details", label: "Contact details", type: "text" },
  { no: 27, key: "gem_ref", label: "GeM/e-procurement Ref", type: "text", synonyms: ["GeM ref", "e-procurement reference"] },
  { no: 28, key: "portal_registration", label: "Registration on tender portal", type: "text" },
  {
    no: 29,
    key: "reverse_auction",
    label: "Reverse auction — Yes/No",
    type: "choice",
    options: ["Yes", "No", "Clarification Required"],
    synonyms: ["Reverse auction"],
  },
  { no: 30, key: "l1_acceptance", label: "Acceptance of L1 rates parameters", type: "long", synonyms: ["L1 rates"] },
  { no: 31, key: "scope", label: "Scope of work", type: "long" },
  { no: 32, key: "gst", label: "GST", type: "text" },
  { no: 33, key: "penalties", label: "Penalties", type: "long" },
  { no: 34, key: "mobilization", label: "Mobilization period", type: "text", synonyms: ["Mobilisation period"] },
  { no: 35, key: "measurement_mode", label: "Mode of measurement", type: "text" },
  { no: 36, key: "load_measurement", label: "Measurement of load", type: "text" },
  {
    no: 37,
    key: "price_type",
    label: "Contract price type",
    type: "choice",
    options: ["Fixed", "Variable", "Other"],
  },
  { no: 38, key: "price_variation", label: "Price variation", type: "text" },
  { no: 39, key: "security_deposit", label: "Security deposit", type: "text" },
  { no: 40, key: "liquidated_damages", label: "Liquidated damages", type: "text" },
  { no: 41, key: "payment_terms", label: "Payment terms", type: "long" },
  { no: 42, key: "penalty_recovery", label: "Penalty recovery", type: "long" },
  { no: 43, key: "quantity_deviation", label: "Quantity deviation", type: "text" },
  { no: 44, key: "defect_liability", label: "Defect liability", type: "text" },
];

export const FIELD_BY_KEY = Object.fromEntries(TENDER_FIELDS.map((field) => [field.key, field]));

export function fieldLabels(field: FieldDef) {
  return [field.label, ...(field.synonyms ?? [])];
}
