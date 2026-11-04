/** Shapes of the records the API sends. Dates arrive as ISO strings and are revived to Date by api.ts. */

export type PublicUser = { id: string; name: string; email: string; role: string; personKey: string; active: boolean };

export type Tender = {
  id: string;
  recordId: string;
  projectName: string;
  tenderRef: string;
  externalTenderId: string;
  clientName: string;
  portalName: string;
  location: string;
  bidSubmissionEnd: Date | null;
  bidOpeningAt: Date | null;
  estimatedValue: number | null;
  finalCostingValue: number | null;
  emdExposure: number | null;
  emdType: string;
  businessLine: string;
  overallStatus: string;
  relevanceStatus: string;
  costingStatus: string;
  emdStatus: string;
  bidStatus: string;
  approvalStatus: string;
  source: string;
  ocrStatus: string;
  duplicateOfId: string | null;
  duplicateWarning: string;
  relevanceOverdue: boolean;
  deadlineMissed: boolean;
  closureReason: string;
  outcome: string;
  outcomeNotes: string;
  createdById: string;
  submitterId: string | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type TenderDocument = {
  id: string;
  tenderId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  docType: string;
  version: number;
  uploadedById: string;
  uploadedAt: Date;
  pageCount: number;
  ocrJson?: string;
};

export type TenderField = {
  id: string;
  tenderId: string;
  fieldNo: number;
  fieldKey: string;
  label: string;
  extractedValue: string;
  correctedValue: string;
  correctedAt: Date | null;
  sourceDocumentId: string;
  sourcePage: string;
  confidence: number | null;
  validationStatus: string;
  conflictNote: string;
  correctedById: string;
  critical: boolean;
};

export type WorkflowTask = {
  id: string;
  tenderId: string;
  branch: string;
  stage: string;
  title: string;
  status: string;
  assigneeIds: string;
  dueAt: Date | null;
  slaMinutes: number;
  baseAt: Date;
  wasOverdue: boolean;
  decision: string;
  comments: string;
  completedById: string;
  completedAt: Date | null;
  createdAt: Date;
};

export type CostingRecord = {
  id: string;
  tenderId: string;
  version: number;
  stage: string;
  assumptions: string;
  amount: number | null;
  documentId: string;
  createdById: string;
  createdAt: Date;
};

export type EmdRecord = {
  id: string;
  tenderId: string;
  instrumentType: string;
  amount: string;
  beneficiary: string;
  referenceNumber: string;
  preparationStatus: string;
  exemptionBasis: string;
  documentId: string;
  verifiedAt: Date | null;
  completedAt: Date | null;
  submittedToAuthority: boolean;
  authorityNote: string;
  notes: string;
  bgRequest?: string | null;
};

export type ApprovalRecord = {
  id: string;
  tenderId: string;
  taskId: string;
  stage: string;
  decision: string;
  approverId: string;
  comments: string;
  createdAt: Date;
};

export type BidSubmission = {
  id: string;
  tenderId: string;
  submitterId: string;
  status: string;
  submittedAt: Date | null;
  referenceNumber: string;
  evidenceDocumentId: string;
  exceptionReason: string;
  exceptionAuthorizedById: string;
  notes: string;
  updatedAt: Date;
};

export type NotificationLog = {
  id: string;
  tenderId: string | null;
  taskId: string;
  eventType: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  body: string;
  status: string;
  createdAt: Date;
};

export type AuditLog = {
  id: string;
  tenderId: string | null;
  actorId: string;
  actorName: string;
  action: string;
  entity: string;
  detail: string;
  createdAt: Date;
};

export type Portal = {
  id: string;
  name: string;
  url: string;
  category: string;
  keywords: string;
  frequencyHours: number;
  enabled: boolean;
  accessMethod: string;
  lastScanAt: Date | null;
  lastStatus: string;
  lastError: string;
  createdAt: Date;
};

export type CrawlerException = {
  id: string;
  runId: string | null;
  portalId: string;
  kind: string;
  detail: string;
  tenderHint: string;
  resolved: boolean;
  createdAt: Date;
};

export type ChecklistItem = { label: string; gap: string; ok: boolean; owner: string };

/** Calendar as sent over JSON; toCalendar() turns it back into the Calendar the helpers expect. */
export type CalendarJson = { timeZone: string; startMin: number; endMin: number; workingDays: number[]; holidays: string[] };

/** A row of the EMD / performance bond register, imported from the bond workbook. */
export type SuretyBond = {
  id: string;
  kind: "EMD" | "PERFORMANCE";
  serialNo: number | null;
  state: string;
  line: string;
  tenderRef: string;
  tenderDetails: string;
  plant: string;
  customer: string;
  amount: number | null;
  onlineAmount: number | null;
  isbAmount: number | null;
  broker: string;
  insurer: string;
  bondNumber: string;
  issueDate: Date | null;
  startDate: Date | null;
  expiryDate: Date | null;
  claimExpiryDate: Date | null;
  ext1IssueDate: Date | null;
  ext1StartDate: Date | null;
  ext1ExpiryDate: Date | null;
  ext1ClaimDate: Date | null;
  ext2Date: Date | null;
  ext2ClaimDate: Date | null;
  premium: number | null;
  premiumPercent: number | null;
  stampDuty: number | null;
  mode: string;
  transferType: string;
  status: string;
  usedFor: string;
  sourceFile: string;
  importedAt: Date;
};

/** One amendment block of a bank guarantee; dates are ISO strings. */
export type BgAmendment = {
  no: number;
  amount: number | null;
  charges: number | null;
  chargesPercent: number | null;
  date: string | null;
  expiry: string | null;
  claim: string | null;
  stampDuty: number | null;
};

/** A bank guarantee from the BG register workbook. `amendments` and `extra` are JSON text. */
export type BankGuarantee = {
  id: string;
  serialNo: number | null;
  bgType: string;
  bank: string;
  marginMoney: string;
  beneficiary: string;
  site: string;
  loiLoa: string;
  bgNumber: string;
  amount: number | null;
  issueDate: Date | null;
  charges: number | null;
  chargesPercent: number | null;
  details: string;
  amendmentNumber: string;
  amendmentDate: Date | null;
  expiryDate: Date | null;
  claimDate: Date | null;
  stampDuty: number | null;
  amendments: string | null;
  extra: string | null;
  sourceFile: string;
  importedAt: Date;
};

/** A scanned BG or amendment document, linked to its guarantee by BG number. */
export type BgDocument = {
  id: string;
  bgNumber: string;
  kind: "ISSUANCE" | "AMENDMENT";
  amendmentNo: number | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date;
};
