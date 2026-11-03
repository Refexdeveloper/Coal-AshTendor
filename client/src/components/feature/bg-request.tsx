import { useState } from "react";
import { Link } from "react-router-dom";
import { AmountInput, FilePick } from "./task-kit";

/** Details of the bank guarantee request letter: the yellow-marked parts of the bank's template. */
export type BgRequest = {
  letterDate: string;
  beneficiaryName: string;
  beneficiaryCin: string;
  beneficiaryAddress: string;
  contractSummary: string;
  bankName: string;
  bankBranch: string;
  accountNumber: string;
  accountName: string;
  ifsc: string;
  percent: string;
  amount: string;
  marginPercent: string;
  expiryDate: string;
  claimExpiryDate: string;
};

/** Fixed parts of the letter. */
export const BG_LETTER = {
  to: ["The Assistant General Manager", "Indian Overseas Bank – C & IC Branch", "Ground Floor, 98A Auras Corporate Centre", "Dr. R.K. Salai, Mylapore", "Chennai – 600004"],
  issuer: "REFEX INDUSTRIES LIMITED",
  issuingBank: "INDIAN OVERSEAS BANK LIMITED",
  signOff: "For Refex Industries Limited",
  currentAccount: "104602000001483",
};

const IN = (digits: number) => new Intl.NumberFormat("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits });

/** BG value and the FD margin worked out from it. */
export function marginOf(request: Pick<BgRequest, "amount" | "marginPercent">) {
  const value = Number(String(request.amount || "").replace(/,/g, ""));
  const percent = Number(String(request.marginPercent || "").replace(/%/g, ""));
  const ok = request.amount && Number.isFinite(value) && request.marginPercent !== "" && request.marginPercent != null && Number.isFinite(percent);
  return ok ? { value, percent, margin: Math.round(value * percent) / 100 } : null;
}

export function parseBgRequest(raw: string | null | undefined): BgRequest | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<BgRequest>;
    return value && typeof value === "object" && value.beneficiaryName ? (value as BgRequest) : null;
  } catch {
    return null;
  }
}

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function belowHundred(n: number) {
  return n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ""}`;
}

function belowThousand(n: number) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  return [hundreds ? `${ONES[hundreds]} Hundred` : "", rest ? belowHundred(rest) : ""].filter(Boolean).join(" ");
}

/** Indian-system words for whole rupees: 10000000 → "One Crore". */
export function rupeesInWords(amount: number): string {
  let n = Math.floor(Math.abs(amount));
  if (!n) return "Zero";
  const crore = Math.floor(n / 1e7);
  n %= 1e7;
  const lakh = Math.floor(n / 1e5);
  n %= 1e5;
  const thousand = Math.floor(n / 1e3);
  n %= 1e3;
  return [crore ? `${crore >= 100 ? rupeesInWords(crore) : belowHundred(crore)} Crore` : "", lakh ? `${belowHundred(lakh)} Lakh` : "", thousand ? `${belowHundred(thousand)} Thousand` : "", n ? belowThousand(n) : ""]
    .filter(Boolean)
    .join(" ");
}

/** "₹1,00,00,000/- (One Crore Only)" */
export function amountLine(raw: string) {
  const amount = Number(String(raw).replace(/,/g, ""));
  if (!raw || !Number.isFinite(amount)) return "";
  return `₹${new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(amount)}/- (${rupeesInWords(amount)} Only)`;
}

/** yyyy-mm-dd → dd/mm/yyyy, the way the bank letter writes dates. */
export function letterDay(iso: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * BG letter details and supporting documents, placed inside an EMD task's form so the task has one submit.
 * Saved values come back; empty ones start from the tender.
 */
export function BgRequestFields({
  tenderId,
  saved,
  defaults,
  bankDetails = true,
}: {
  tenderId: string;
  saved: BgRequest | null;
  /** The beneficiary's bank account; left to the BG team, so the requirement check hides it. */
  bankDetails?: boolean;
  defaults: { beneficiaryName: string; beneficiaryAddress: string; contractSummary: string; amount: string };
}) {
  const value = (key: keyof BgRequest, fallback = "") => saved?.[key] || fallback;
  const [amount, setAmount] = useState(value("amount", defaults.amount));
  return (
    <section className="bg-request wide">
      <header className="bg-request-head">
        <span className="bg-request-icon" aria-hidden>
          ✉
        </span>
        <div>
          <h3>Bank guarantee letters</h3>
          <p className="muted">Details for the BG details letter and the FD creation letter to Indian Overseas Bank, and any supporting documents. They are saved with this task.</p>
        </div>
        {saved ? (
          <Link className="btn ghost" to={`/tenders/${tenderId}/bg-letter`} target="_blank">
            Open letters ↗
          </Link>
        ) : null}
      </header>
      <div className="form-grid bg-request-form">
        <fieldset className="wide">
          <legend>Letter</legend>
          <label>
            Date
            <input type="date" name="bg_letterDate" defaultValue={value("letterDate", todayIso())} />
          </label>
        </fieldset>
        <fieldset className="wide">
          <legend>Beneficiary</legend>
          <label>
            Name of the beneficiary
            <input name="bg_beneficiaryName" defaultValue={value("beneficiaryName", defaults.beneficiaryName)} placeholder="JHABUA POWER LTD." />
          </label>
          <label>
            CIN number
            <input name="bg_beneficiaryCin" defaultValue={value("beneficiaryCin")} placeholder="U40105WB1995PLC068616" />
          </label>
          <label className="wide">
            Address and description (one line each)
            <textarea name="bg_beneficiaryAddress" rows={4} defaultValue={value("beneficiaryAddress", defaults.beneficiaryAddress)} placeholder={"(A Joint Venture of NTPC)\nP.O-Barela, Tehsil: Ghansore\nDistrict: Seoni (M.P.)\nPIN: 480997"} />
          </label>
          <label className="wide">
            Contract summary
            <textarea name="bg_contractSummary" rows={2} defaultValue={value("contractSummary", defaults.contractSummary)} placeholder="Procurement of 2.0 LMT Domestic Coal for JPL Power Station." />
          </label>
        </fieldset>
        {bankDetails ? (
          <fieldset className="wide">
            <legend>Beneficiary bank details</legend>
            <label>
              Bank name
              <input name="bg_bankName" defaultValue={value("bankName")} placeholder="Axis Bank" />
            </label>
            <label>
              Branch
              <input name="bg_bankBranch" defaultValue={value("bankBranch")} placeholder="Jabalpur Branch" />
            </label>
            <label>
              Account number
              <input name="bg_accountNumber" inputMode="numeric" defaultValue={value("accountNumber")} placeholder="128010200029698" />
            </label>
            <label>
              Beneficiary name (as in bank)
              <input name="bg_accountName" defaultValue={value("accountName", value("beneficiaryName", defaults.beneficiaryName))} placeholder="JHABUA POWER LTD" />
            </label>
            <label>
              IFSC code
              <input name="bg_ifsc" defaultValue={value("ifsc")} placeholder="UTIB0000128"  />
            </label>
          </fieldset>
        ) : null}
        <fieldset className="wide">
          <legend>Guarantee</legend>
          <AmountInput name="bg_amount" label="Amount of BG to be issued (₹)" defaultValue={value("amount", defaults.amount)} onValue={setAmount} />
          <MarginInput defaultValue={value("marginPercent", "10")} amount={amount} />
          <label>
            % of BG to be issued (optional)
            <input name="bg_percent" defaultValue={value("percent")} placeholder="e.g. 10%" />
          </label>
          <label>
            BG expiry date
            <input type="date" name="bg_expiryDate" defaultValue={value("expiryDate")} />
          </label>
          <label>
            BG claim expiry date
            <input type="date" name="bg_claimExpiryDate" defaultValue={value("claimExpiryDate")} />
          </label>
        </fieldset>
        <fieldset className="wide">
          <legend>Documents</legend>
          <div className="wide">
            <FilePick name="emdDocs" label="Upload documents (optional)" hint="Any file type, several at once, up to 20 MB each" multiple accept="" />
          </div>
        </fieldset>
      </div>
    </section>
  );
}

/** Margin % for the FD letter, with the margin amount it gives on the saved BG value. */
function MarginInput({ defaultValue, amount }: { defaultValue: string; amount: string }) {
  const [raw, setRaw] = useState(defaultValue);
  const worked = marginOf({ amount, marginPercent: raw });
  return (
    <label>
      Margin % for the FD
      <input name="bg_marginPercent" inputMode="decimal" value={raw} onChange={(event) => setRaw(event.target.value)} placeholder="10" />
      {worked ? <small className="amount-preview">Margin amount = Rs. {IN(2).format(worked.margin)}</small> : null}
    </label>
  );
}

/** The FD creation letter for the advance BG. */
export function FdLetterSheet({ request }: { request: BgRequest }) {
  const worked = marginOf(request);
  const mark = (text: string) => (text ? <mark>{text}</mark> : <span className="bg-blank">—</span>);
  return (
    <article className="bg-letter">
      <p>Date: {mark(letterDay(request.letterDate))}</p>
      <p className="bg-letter-to">
        To,
        {BG_LETTER.to.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </p>
      <p>Subject: Request for Creation of FD for Issuance of Advance Bank Guarantee (BG)</p>
      <p>
        We request you to kindly issue the Bank Guarantee in favour of M/ s {mark(request.beneficiaryName)}, as per the terms agreed for the project requirement. The details of BG Value and applicable margin are under:
      </p>
      <table className="bg-fd-table">
        <thead>
          <tr>
            <th>PARTICULARS</th>
            <th>BG VALUE</th>
            <th>MARGIN %</th>
            <th>MARGIN AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>BG UNDER LIMIT</td>
            <td>{mark(worked ? `${IN(0).format(worked.value)}/-` : "")}</td>
            <td>{mark(worked ? String(worked.percent) : "")}</td>
            <td>{mark(worked ? IN(2).format(worked.margin) : "")}</td>
          </tr>
        </tbody>
      </table>
      <p>
        We confirm that the required margin amount of {mark(worked ? `Rs. ${IN(0).format(worked.margin)}/-` : "")} shall be maintained/funded as applicable, and all bank charges, commission, stamp duty, and other applicable charges shall be borne by us.
      </p>
      <p>We request you to kindly process the BG at the earliest by debiting the applicable charges and margin money to our Current Account No. {BG_LETTER.currentAccount}.</p>
      <p>Thanking you,</p>
      <p>
        <b>For {BG_LETTER.issuer}</b>
      </p>
      <p className="bg-letter-signatory">
        <b>Authorised Signatory</b>
      </p>
    </article>
  );
}

/** The letter itself, with the values filled from the form. */
export function BgLetterSheet({ request }: { request: BgRequest }) {
  const mark = (text: string) => (text ? <mark>{text}</mark> : <span className="bg-blank">—</span>);
  const address = request.beneficiaryAddress.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return (
    <article className="bg-letter">
      <p>Date: {mark(letterDay(request.letterDate))}</p>
      <p className="bg-letter-to">
        To,
        {BG_LETTER.to.map((line) => (
          <span key={line}>{line}</span>
        ))}
      </p>
      <p>Subject: Details of the PBG to be issued in favour of M/s {mark(`${request.beneficiaryName},`)}</p>
      <table>
        <thead>
          <tr>
            <th>Particulars</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Name of the PBG Issuer</td>
            <td>{BG_LETTER.issuer}</td>
          </tr>
          <tr>
            <td>Name of the PBG Issuing Bank</td>
            <td>{BG_LETTER.issuingBank}</td>
          </tr>
          <tr>
            <td>Name of the Beneficiary</td>
            <td>
              <b>
                <mark>{request.beneficiaryName}</mark>
                {request.beneficiaryCin ? (
                  <>
                    <br />
                    <mark>CIN NO: {request.beneficiaryCin}</mark>
                  </>
                ) : null}
                {address.map((line) => (
                  <span key={line}>
                    <br />
                    <mark>{line}</mark>
                  </span>
                ))}
              </b>
            </td>
          </tr>
          <tr>
            <td>Contract Summary</td>
            <td>{request.contractSummary ? <mark>“{request.contractSummary}”</mark> : <span className="bg-blank">—</span>}</td>
          </tr>
          <tr>
            <td>Beneficiary Bank Details</td>
            <td>
              {[
                ["Bank Name", request.bankName],
                ["Branch", request.bankBranch],
                ["Account Number", request.accountNumber],
                ["Beneficiary Name", request.accountName],
                ["IFSC Code", request.ifsc],
              ].map(([label, text], index) => (
                <span key={label}>
                  {index ? <br /> : null}
                  <mark>
                    <b>{label}:</b> {text}
                  </mark>
                </span>
              ))}
            </td>
          </tr>
          <tr>
            <td>% of PBG to be issued</td>
            <td>{request.percent}</td>
          </tr>
          <tr>
            <td>Amount of PBG to be issued</td>
            <td>{mark(amountLine(request.amount))}</td>
          </tr>
          <tr>
            <td>Validity of the PBG to be issued</td>
            <td>
              <mark>BG Expiry Date: {letterDay(request.expiryDate)}</mark>
              <br />
              <mark>BG Claim Expiry Date: {letterDay(request.claimExpiryDate)}</mark>
            </td>
          </tr>
        </tbody>
      </table>
      <p className="bg-letter-sign">
        Thanking You,
        <b>{BG_LETTER.signOff}</b>
      </p>
    </article>
  );
}
