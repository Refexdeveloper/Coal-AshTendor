import { useActionState, useEffect, useState } from "react";
import { addGuaranteeAction, updateGuaranteeAction } from "@client/api/actions";
import type { ActionState } from "@client/api/action-state";
import { Submit } from "@client/components/base/submit";
import type { BankGuarantee, BgAmendment } from "@client/lib/types";
import { Icon } from "@client/pages/executive/ExecutiveView";

/** A blank amendment row. The key only keeps React from reusing the inputs after one is removed. */
let nextRow = 1;

type AmendDraft = {
  key: number;
  no: string;
  amount: string;
  charges: string;
  chargesPercent: string;
  stamp: string;
  date: string;
  expiry: string;
  claim: string;
};

const blankAmend = (): AmendDraft => ({ key: nextRow++, no: "", amount: "", charges: "", chargesPercent: "", stamp: "", date: "", expiry: "", claim: "" });

/** Noon-UTC dates from the register become the calendar day the date input expects. */
function dateInput(value: Date | string | null | undefined) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function numInput(value: number | null | undefined) {
  return value == null || Number.isNaN(value) ? "" : String(value);
}

function draftsFrom(guarantee?: BankGuarantee): AmendDraft[] {
  if (!guarantee?.amendments) return [];
  let list: BgAmendment[] = [];
  try {
    list = JSON.parse(guarantee.amendments) as BgAmendment[];
  } catch {
    return [];
  }
  return [...list]
    .sort((a, b) => a.no - b.no)
    .map((item) => ({
      key: nextRow++,
      no: String(item.no ?? ""),
      amount: numInput(item.amount),
      charges: numInput(item.charges),
      chargesPercent: numInput(item.chargesPercent),
      stamp: numInput(item.stampDuty),
      date: dateInput(item.date),
      expiry: dateInput(item.expiry),
      claim: dateInput(item.claim),
    }));
}

/**
 * Enter one bank guarantee, or edit one already in the register.
 * Issuance fields, extra scans, and each amendment (kept by its existing number) are saved together.
 */
export function AddGuaranteeForm({ onDone, defaultType = "PBG", guarantee }: { onDone: () => void; defaultType?: string; guarantee?: BankGuarantee }) {
  const editing = Boolean(guarantee);
  const [amendments, setAmendments] = useState<AmendDraft[]>(() => draftsFrom(guarantee));
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await (editing ? updateGuaranteeAction : addGuaranteeAction)(previous, formData);
    if (result?.ok) onDone();
    return result;
  }, null as ActionState);
  const known = guarantee?.bgType === "APBG" || guarantee?.bgType === "EMD" || guarantee?.bgType === "PBG";
  const type = known ? guarantee?.bgType : defaultType === "APBG" || defaultType === "EMD" ? defaultType : "PBG";

  useEffect(() => {
    if (editing) document.getElementById("edit-bg")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [editing]);

  return (
    <section className="dk-panel" id={editing ? "edit-bg" : undefined}>
      <header className="dk-panel-head">
        <span className="dk-panel-icon">
          <Icon name="doc" />
        </span>
        <div>
          <h2>{editing ? "Edit bank guarantee" : "Add a bank guarantee"}</h2>
          <p>
            {editing
              ? "Change the issuance or any amendment. Leave a file empty to keep the scan already stored. Removing an amendment takes it off this guarantee."
              : "Enter the issuance, upload its document, and add each amendment with its own details and scan."}
          </p>
        </div>
      </header>
      <form action={action} className="form-grid bg-add">
        {guarantee ? <input type="hidden" name="id" value={guarantee.id} /> : null}
        <label>
          BG type
          <select name="bgType" defaultValue={type}>
            <option value="PBG">PBG</option>
            <option value="APBG">APBG</option>
            <option value="EMD">EMD</option>
            {guarantee && !known && guarantee.bgType ? <option value={guarantee.bgType}>{guarantee.bgType}</option> : null}
          </select>
        </label>
        <label>
          BG number
          <input name="bgNumber" required defaultValue={guarantee?.bgNumber ?? ""} placeholder="004GT02242830012" />
        </label>
        <label>
          Issuing bank
          <input name="bank" defaultValue={guarantee?.bank ?? ""} placeholder="Bank name" />
        </label>
        <label>
          Beneficiary
          <input name="beneficiary" defaultValue={guarantee?.beneficiary ?? ""} placeholder="In whose favour" />
        </label>
        <label>
          Site / plant / project
          <input name="site" defaultValue={guarantee?.site ?? ""} />
        </label>
        <label>
          LOI / LOA
          <input name="loiLoa" defaultValue={guarantee?.loiLoa ?? ""} />
        </label>
        <label>
          Margin money
          <input name="marginMoney" defaultValue={guarantee?.marginMoney ?? ""} />
        </label>
        <label>
          BG amount
          <input name="amount" inputMode="decimal" defaultValue={numInput(guarantee?.amount)} placeholder="0" />
        </label>
        <label>
          Issue date
          <input name="issueDate" type="date" defaultValue={dateInput(guarantee?.issueDate)} />
        </label>
        <label>
          Expiry date
          <input name="expiryDate" type="date" defaultValue={dateInput(guarantee?.expiryDate)} />
        </label>
        <label>
          Claim date
          <input name="claimDate" type="date" defaultValue={dateInput(guarantee?.claimDate)} />
        </label>
        <label>
          Charges
          <input name="charges" inputMode="decimal" defaultValue={numInput(guarantee?.charges)} placeholder="0" />
        </label>
        <label>
          Charges %
          <input name="chargesPercent" inputMode="decimal" defaultValue={numInput(guarantee?.chargesPercent)} placeholder="0.5" />
        </label>
        <label>
          Stamp duty
          <input name="stampDuty" inputMode="decimal" defaultValue={numInput(guarantee?.stampDuty)} placeholder="0" />
        </label>
        <label className="wide">
          Details
          <input name="details" defaultValue={guarantee?.details ?? ""} />
        </label>
        <label className="wide">
          {editing ? "Add issuance documents" : "Issuance documents"}
          <input name="files" type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp" />
        </label>

        <div className="wide bg-add-amendments">
          <div className="bg-add-amend-head">
            <strong>Amendments</strong>
            <button type="button" className="dk-ghost" onClick={() => setAmendments((rows) => [...rows, blankAmend()])}>
              Add amendment
            </button>
          </div>
          {amendments.length === 0 ? <p className="muted">No amendments yet. Add one if this guarantee was extended or its amount changed.</p> : null}
          {amendments.map((row, index) => (
            <fieldset key={row.key} className="bg-add-amend">
              <legend>Amendment {row.no || index + 1}</legend>
              <input type="hidden" name="amendmentNo" value={row.no} />
              <label>
                Amount
                <input name="amendmentAmount" inputMode="decimal" defaultValue={row.amount} />
              </label>
              <label>
                Charges
                <input name="amendmentCharges" inputMode="decimal" defaultValue={row.charges} />
              </label>
              <label>
                Charges %
                <input name="amendmentChargesPercent" inputMode="decimal" defaultValue={row.chargesPercent} />
              </label>
              <label>
                Stamp duty
                <input name="amendmentStamp" inputMode="decimal" defaultValue={row.stamp} />
              </label>
              <label>
                Date
                <input name="amendmentDate" type="date" defaultValue={row.date} />
              </label>
              <label>
                Expiry
                <input name="amendmentExpiry" type="date" defaultValue={row.expiry} />
              </label>
              <label>
                Claim date
                <input name="amendmentClaim" type="date" defaultValue={row.claim} />
              </label>
              <label>
                {editing ? "Add document" : "Document"}
                <input name={`amendmentFile_${index}`} type="file" accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp" />
              </label>
              <button type="button" className="dk-ghost" onClick={() => setAmendments((rows) => rows.filter((item) => item.key !== row.key))}>
                Remove
              </button>
            </fieldset>
          ))}
        </div>

        {state?.error ? <p className="banner bad wide">{state.error}</p> : null}
        {state?.ok ? <p className="banner good wide">{state.ok}</p> : null}
        <div className="actions wide">
          <Submit>{editing ? "Save changes" : "Save bank guarantee"}</Submit>
        </div>
      </form>
    </section>
  );
}
