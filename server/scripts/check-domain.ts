import { addBusinessMinutes, businessMinutesBetween, formatWhen, istDate, type Calendar } from "../src/utils/calendar";
import { extractFields, parseDateTime, parseInr, SAMPLE_NOTICE } from "../src/services/extract";
import { fieldsFromOcrResponse } from "../src/services/ocr";
import { TENDER_FIELDS } from "../src/utils/fields";

const calendar: Calendar = {
  timeZone: "Asia/Kolkata",
  startMin: 9 * 60,
  endMin: 18 * 60,
  workingDays: new Set([1, 2, 3, 4, 5]),
  holidays: new Set<string>(),
};

function assert(condition: boolean, message: string, actual?: string) {
  if (!condition) {
    console.error(`FAIL ${message}${actual ? ` (actual ${actual})` : ""}`);
    process.exitCode = 1;
    return;
  }
  console.log(`ok ${message}`);
}

const sameMorning = addBusinessMinutes(istDate(2026, 10, 26, 10, 0), 90, calendar);
assert(formatWhen(sameMorning, "Asia/Kolkata").includes("26 Oct 2026") && formatWhen(sameMorning, "Asia/Kolkata").includes("11:30"), "90 business minutes stay inside Monday", formatWhen(sameMorning, "Asia/Kolkata"));

const overWeekend = addBusinessMinutes(istDate(2026, 10, 30, 17, 0), 120, calendar);
assert(formatWhen(overWeekend, "Asia/Kolkata") === "02 Nov 2026, 10:00", "Friday 17:00 plus 120 minutes lands Monday 10:00", formatWhen(overWeekend, "Asia/Kolkata"));

const edge = addBusinessMinutes(istDate(2026, 10, 30, 17, 30), 60, calendar);
assert(formatWhen(edge, "Asia/Kolkata") === "02 Nov 2026, 09:30", "Friday 17:30 plus 60 minutes lands Monday 09:30", formatWhen(edge, "Asia/Kolkata"));

const holidayCal: Calendar = { ...calendar, holidays: new Set(["2026-10-28"]) };
const afterHoliday = addBusinessMinutes(istDate(2026, 10, 28, 10, 0), 60, holidayCal);
assert(formatWhen(afterHoliday, "Asia/Kolkata") === "29 Oct 2026, 10:00", "A holiday is skipped", formatWhen(afterHoliday, "Asia/Kolkata"));

const elapsed = businessMinutesBetween(istDate(2026, 10, 26, 10, 0), istDate(2026, 10, 26, 12, 30), calendar);
assert(elapsed === 150, "Elapsed working minutes inside one day", String(elapsed));

const weekendElapsed = businessMinutesBetween(istDate(2026, 10, 30, 17, 0), istDate(2026, 11, 2, 10, 0), calendar);
assert(weekendElapsed === 120, "Elapsed minutes skip the weekend", String(weekendElapsed));

const hits = extractFields([{ documentId: "doc", page: 1, text: SAMPLE_NOTICE }]);
const missing = TENDER_FIELDS.filter((field) => hits[field.key]?.status === "MISSING").map((field) => field.label);
assert(missing.length === 0, "Sample notice fills all 44 fields", missing.join("; "));
assert(hits.emd_form?.value === "Bank Guarantee", "EMD form is Bank Guarantee", hits.emd_form?.value);
assert(hits.emd_exemption?.value === "No", "EMD exemption is No", hits.emd_exemption?.value);
assert(parseInr(hits.emd_fee?.value ?? "") === 2500000, "EMD amount is read only from the labelled fee", String(parseInr(hits.emd_fee?.value ?? "")));
assert(parseInr("10 percent of contract value") === null, "Prose amounts are not converted into numbers");
const deadline = parseDateTime(hits.bid_submission_end?.value ?? "", "Asia/Kolkata");
assert(formatWhen(deadline, "Asia/Kolkata") === "18 Dec 2026, 15:00", "Bid deadline keeps its time", formatWhen(deadline, "Asia/Kolkata"));
assert(parseDateTime("18/12/2026", "Asia/Kolkata") === null, "A date without a time is not guessed");

const conflict = extractFields([
  { documentId: "a", page: 1, text: "Client name: NTPC Limited" },
  { documentId: "b", page: 2, text: "Client name: MAHAGENCO" },
]);
assert(conflict.client_name?.status === "CONFLICT", "Differing values are flagged", conflict.client_name?.status);

const ocr = fieldsFromOcrResponse(
  {
    ProcessedAttachments: [
      {
        Extracted_Data: [
          {
            success: true,
            confidence: 0.86,
            Pages: [
              {
                "Page Number": 1,
                "Extracted Fields": [
                  {
                    Name_of_the_Project_: "High End Desktop",
                    Tender_ID: "NITK/DPD/OH35-MECH/2024-25/A 9-4",
                    EMD_exemption: "Yes — Firm registered with MSME/NSIC",
                    EMD_fee: "Rs. 94,500.00 (EMD Amount (2% of estimated amount))",
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
  "doc",
);
assert(ocr.project_name?.value === "High End Desktop", "OCR project name maps onto the form", ocr.project_name?.value);
assert(ocr.tender_id?.value === "NITK/DPD/OH35-MECH/2024-25/A 9-4", "OCR tender id maps onto the form", ocr.tender_id?.value);
assert(ocr.emd_exemption?.value.startsWith("Yes"), "OCR exemption maps onto the form", ocr.emd_exemption?.value);
assert(ocr.emd_fee?.value.startsWith("Rs. 94,500.00"), "OCR EMD fee maps onto the form", ocr.emd_fee?.value);
assert(ocr.emd_fee?.status === "EXTRACTED", "OCR confidence is kept", ocr.emd_fee?.status);

if (process.exitCode) process.exit(process.exitCode);
console.log("All checks passed.");
