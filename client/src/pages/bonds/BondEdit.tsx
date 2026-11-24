import { useActionState } from "react";
import { updateBondAction } from "@client/api/actions";
import type { ActionState } from "@client/api/action-state";
import { Submit } from "@client/components/base/submit";
import type { SuretyBond } from "@client/lib/types";

const dateValue = (value: Date | string | null) => {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const numValue = (value: number | null) => (value == null || Number.isNaN(value) ? "" : String(value));

const TEXT: [keyof SuretyBond, string][] = [
  ["bondNumber", "Bond number"],
  ["customer", "Customer"],
  ["plant", "Plant"],
  ["state", "State"],
  ["line", "Business line"],
  ["tenderRef", "Tender reference"],
  ["insurer", "Insurer"],
  ["broker", "Broker"],
  ["mode", "Mode"],
  ["transferType", "Type of transfer"],
  ["status", "Tender status"],
  ["usedFor", "Used for"],
];
const MONEY: [keyof SuretyBond, string][] = [
  ["amount", "Amount"],
  ["onlineAmount", "Online amount"],
  ["isbAmount", "ISB amount"],
  ["premium", "Premium"],
  ["premiumPercent", "Premium %"],
  ["stampDuty", "Stamp duty"],
];
const DATES: [keyof SuretyBond, string][] = [
  ["issueDate", "Issue date"],
  ["startDate", "Start date"],
  ["expiryDate", "Expiry date"],
  ["claimExpiryDate", "Claim expiry"],
  ["ext1IssueDate", "Extension 1 issue"],
  ["ext1StartDate", "Extension 1 start"],
  ["ext1ExpiryDate", "Extension 1 expiry"],
  ["ext1ClaimDate", "Extension 1 claim"],
  ["ext2Date", "Extension 2 expiry"],
  ["ext2ClaimDate", "Extension 2 claim"],
];

/** Every stored field of one surety bond, so an edit can change any of them. */
export function BondEditForm({ bond, onDone }: { bond: SuretyBond; onDone: () => void }) {
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await updateBondAction(previous, formData);
    if (result?.ok) onDone();
    return result;
  }, null as ActionState);
  return (
    <form action={action} className="form-grid bg-add">
      <input type="hidden" name="id" value={bond.id} />
      <label>
        Type
        <select name="kind" defaultValue={bond.kind === "PERFORMANCE" ? "PERFORMANCE" : "EMD"}>
          <option value="EMD">EMD</option>
          <option value="PERFORMANCE">Performance</option>
        </select>
      </label>
      <label>
        Serial number
        <input name="serialNo" inputMode="numeric" defaultValue={numValue(bond.serialNo)} />
      </label>
      {TEXT.map(([key, label]) => (
        <label key={key} className={key === "tenderRef" ? "wide" : undefined}>
          {label}
          <input name={key} defaultValue={String(bond[key] ?? "")} />
        </label>
      ))}
      <label className="wide">
        Tender details
        <textarea name="tenderDetails" rows={3} defaultValue={bond.tenderDetails} />
      </label>
      {MONEY.map(([key, label]) => (
        <label key={key}>
          {label}
          <input name={key} inputMode="decimal" defaultValue={numValue(bond[key] as number | null)} />
        </label>
      ))}
      {DATES.map(([key, label]) => (
        <label key={key}>
          {label}
          <input name={key} type="date" defaultValue={dateValue(bond[key] as Date | null)} />
        </label>
      ))}
      {state?.error ? <p className="banner bad wide">{state.error}</p> : null}
      <div className="actions wide">
        <Submit>Save ISB</Submit>
      </div>
    </form>
  );
}
