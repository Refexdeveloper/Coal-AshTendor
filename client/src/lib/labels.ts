/** Copy of server/src/lib/labels.ts (no server dependencies). Keep the two in step. */
export type Tone = "neutral" | "progress" | "good" | "bad" | "warn" | "info";

export const OVERALL: Record<string, { label: string; tone: Tone }> = {
  UPLOADED: { label: "Uploaded", tone: "neutral" },
  OCR_PROCESSING: { label: "OCR Processing", tone: "progress" },
  DATA_VALIDATION_REQUIRED: { label: "Data Validation Required", tone: "warn" },
  PENDING_RELEVANCE: { label: "Pending Relevance Review", tone: "progress" },
  REJECTED_CLOSED: { label: "Rejected / Closed", tone: "bad" },
  APPROVED_IN_PROGRESS: { label: "Approved — In Progress", tone: "progress" },
  READY_TO_BID: { label: "Ready to Bid", tone: "good" },
  BID_EVIDENCE_PENDING: { label: "Bid Submitted — Evidence Pending", tone: "warn" },
  BID_EVIDENCE_RECORDED: { label: "Bid Submitted — Evidence Recorded", tone: "good" },
  NOT_BID_DEADLINE_MISSED: { label: "Not Bid — Deadline Missed", tone: "bad" },
  CLOSED_BUSINESS: { label: "Closed — Business Decision", tone: "neutral" },
  WON: { label: "Won", tone: "good" },
  LOST: { label: "Lost", tone: "bad" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const COSTING: Record<string, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: "Not Started", tone: "neutral" },
  DRAFT_IN_PROGRESS: { label: "Draft Costing In Progress", tone: "progress" },
  DRAFT_COMPLETED: { label: "Draft Costing Completed", tone: "info" },
  SALES_PENDING: { label: "Sales Input Pending", tone: "progress" },
  SALES_COMPLETED: { label: "Sales Input Completed", tone: "info" },
  FINAL_IN_PROGRESS: { label: "Final Costing In Progress", tone: "progress" },
  PENDING_DEPT: { label: "Pending Department Head Approval", tone: "warn" },
  RETURNED: { label: "Returned for Revision", tone: "warn" },
  APPROVED: { label: "Approved", tone: "good" },
  REJECTED: { label: "Rejected", tone: "bad" },
};

export const EMD: Record<string, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: "Not Started", tone: "neutral" },
  REQUIREMENT_VALIDATION: { label: "Requirement Validation", tone: "progress" },
  PENDING_BG: { label: "Pending BG", tone: "progress" },
  PENDING_ISB: { label: "Pending ISB / Surety Bond", tone: "progress" },
  EXEMPTION_VERIFICATION: { label: "Exemption Verification", tone: "progress" },
  IN_PROGRESS: { label: "In Progress", tone: "progress" },
  PREPARED: { label: "Prepared", tone: "info" },
  VERIFICATION_PENDING: { label: "Verification Pending", tone: "warn" },
  COMPLETED: { label: "Completed", tone: "good" },
  SUBMITTED_EVIDENCE: { label: "Submitted / Evidence Recorded", tone: "good" },
  CLARIFICATION_REQUIRED: { label: "Clarification Required", tone: "warn" },
  OVERDUE: { label: "Overdue", tone: "bad" },
};

export const TASK: Record<string, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: "Not Started", tone: "neutral" },
  IN_PROGRESS: { label: "In Progress", tone: "progress" },
  COMPLETED: { label: "Completed", tone: "good" },
  RETURNED_FOR_REVISION: { label: "Returned for Revision", tone: "warn" },
  REJECTED: { label: "Rejected", tone: "bad" },
  BLOCKED: { label: "Blocked", tone: "warn" },
  OVERDUE: { label: "Overdue", tone: "bad" },
  CANCELLED: { label: "Cancelled", tone: "neutral" },
};

export const BID: Record<string, { label: string; tone: Tone }> = {
  NOT_YET_SUBMITTED: { label: "Not Yet Submitted", tone: "neutral" },
  SUBMISSION_IN_PROGRESS: { label: "Submission In Progress", tone: "progress" },
  BID_SUBMITTED_EVIDENCE_PENDING: { label: "Bid Submitted — Evidence Pending", tone: "warn" },
  BID_SUBMITTED_EVIDENCE_RECORDED: { label: "Bid Submitted — Evidence Recorded", tone: "good" },
  SUBMISSION_FAILED: { label: "Submission Failed", tone: "bad" },
  NOT_BID_DEADLINE_MISSED: { label: "Not Bid — Deadline Missed", tone: "bad" },
};

export const RELEVANCE: Record<string, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: "Not started", tone: "neutral" },
  PENDING: { label: "Pending", tone: "progress" },
  APPROVED: { label: "Approved", tone: "good" },
  REJECTED: { label: "Rejected", tone: "bad" },
};

export const EMD_TYPE: Record<string, string> = {
  BG: "Bank Guarantee",
  ISB: "ISB / Surety Bond",
  EXEMPTION: "Exemption",
  DD: "Demand Draft",
  ONLINE: "Online Payment",
  OTHER: "Other instrument",
  UNCLEAR: "Unclear",
  NONE: "Not set",
};

export const APPROVAL: Record<string, { label: string; tone: Tone }> = {
  NOT_STARTED: { label: "Not started", tone: "neutral" },
  PENDING: { label: "Pending", tone: "progress" },
  APPROVED: { label: "Approved", tone: "good" },
  RETURNED: { label: "Returned", tone: "warn" },
  REJECTED: { label: "Rejected", tone: "bad" },
};

/** Plain names for workflow stages, as people say them. */
export const STAGE: Record<string, string> = {
  DATA_VALIDATION: "Data validation",
  OCR_EXCEPTION: "Extraction exception",
  RELEVANCE: "Relevance review",
  DRAFT_COSTING: "Draft costing",
  SALES_INPUT: "Sales costing input",
  FINAL_COSTING: "Final costing",
  DEPT_APPROVAL: "Department Head approval",
  BUSINESS_DECISION: "Business decision",
  EMD_BG: "Bank guarantee",
  EMD_ISB: "ISB / surety bond",
  EMD_EXEMPTION: "EMD exemption",
  EMD_OTHER: "EMD instrument",
  EMD_CLARIFICATION: "EMD clarification",
  BID_SUBMISSION: "Bid submission",
};

/** What the owner of an open task is expected to do, shown on the task card. */
export const STAGE_HELP: Record<string, string> = {
  DATA_VALIDATION: "Check the extracted fields in the Tender details tab and save any corrections. Then tick the box below and submit for relevance review.",
  OCR_EXCEPTION: "Text could not be read from the upload. Enter the fields by hand or upload a readable copy, then close the exception.",
  RELEVANCE: "Decide whether the business should pursue this tender. Either reviewer's decision is final. Rejection needs a reason.",
  DRAFT_COSTING: "Review scope and quantities, prepare the draft costing and attach the sheet with your assumptions.",
  SALES_INPUT: "Review the draft costing, add commercial and pricing inputs, and attach the completed input sheet.",
  FINAL_COSTING: "Validate the draft and sales inputs, prepare the final costing and enter the final amount for approval.",
  DEPT_APPROVAL: "Approve the final costing, return it for revision with comments, or reject it.",
  BUSINESS_DECISION: "Costing was rejected. Record the business decision. Closing here ends the workflow without a bid.",
  EMD_BG: "Prepare the bank guarantee, record its reference and beneficiary, attach evidence and mark it verified.",
  EMD_ISB: "Prepare the ISB / surety bond, record its reference, attach evidence and mark it verified.",
  EMD_EXEMPTION: "Record why the exemption applies, attach the supporting certificate and mark it verified.",
  EMD_OTHER: "Prepare the EMD instrument, record its reference, attach evidence and mark it verified.",
  EMD_CLARIFICATION: "The notice does not make the EMD type clear. Check it and choose the instrument; nothing is assumed.",
  BID_SUBMISSION: "Submit on the portal before the deadline, then record the time, reference and acknowledgement here.",
};

export const DOC_TYPE: Record<string, string> = {
  NOTICE: "Tender notice",
  SUPPORTING: "Supporting document",
  COSTING_DRAFT: "Draft costing sheet",
  COSTING_SALES: "Sales input sheet",
  COSTING_FINAL: "Final costing sheet",
  EMD_EVIDENCE: "EMD evidence",
  SUBMISSION_EVIDENCE: "Submission acknowledgement",
};

export const DECISION: Record<string, string> = {
  APPROVED: "Approved",
  REJECTED: "Rejected",
  RETURNED: "Returned for revision",
};

export const EMD_PREP: Record<string, string> = {
  NOT_STARTED: "Not started",
  IN_PROGRESS: "In preparation",
  "In preparation": "In preparation",
  Prepared: "Prepared",
  VERIFICATION_PENDING: "Waiting for second verifier",
  VERIFIED: "Prepared and verified",
};

/** Roles allowed to correct extracted fields on any tender. */
export const EDITOR_ROLES = ["ADMIN", "COORDINATOR", "REVIEWER"];
/** Roles allowed to register tenders. The uploader can then correct that tender's fields while validating it. */
export const CREATOR_ROLES = [...EDITOR_ROLES, "BID_SUBMITTER"];
/** Roles allowed to assign the submitter, close a tender or record its outcome. */
export const MANAGER_ROLES = ["ADMIN", "COORDINATOR", "REVIEWER", "DEPT_HEAD"];

export const ROLES: Record<string, string> = {
  ADMIN: "System Administrator",
  COORDINATOR: "Tender Coordinator",
  REVIEWER: "Relevance Reviewer",
  COSTING: "Costing",
  SALES: "Sales Team",
  ACCOUNTS: "Accounts",
  EMD_ISB: "ISB / Surety Bond",
  DEPT_HEAD: "Department Head",
  BID_SUBMITTER: "Bid Submitter",
  GROUP_CEO: "Group CEO",
};

export const CLOSED_OVERALL = [
  "REJECTED_CLOSED",
  "NOT_BID_DEADLINE_MISSED",
  "CLOSED_BUSINESS",
  "WON",
  "LOST",
  "CANCELLED",
];

export const OPEN_TASK = ["NOT_STARTED", "IN_PROGRESS", "OVERDUE", "RETURNED_FOR_REVISION", "BLOCKED"];

export function labelOf(map: Record<string, { label: string }>, key: string) {
  return map[key]?.label ?? key;
}