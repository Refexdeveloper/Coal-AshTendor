import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useActionState } from "react";
import { documentUrl, useApi } from "@client/api/client";
import { updateEmdRegisterAction } from "@client/api/actions";
import type { ActionState } from "@client/api/action-state";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { Submit } from "@client/components/base/submit";
import { CountUp } from "@client/components/feature/count-up";
import { Icon, PlantArt } from "@client/pages/executive/ExecutiveView";
import { day } from "@client/pages/bonds/Bonds";
import { inr } from "@client/utils/money";

type Doc = { id: string; fileName: string };
type Row = {
  tenderId: string;
  recordId: string;
  project: string;
  customer: string;
  portal: string;
  location: string;
  tenderRef: string;
  method: string;
  amount: number | null;
  bank: string;
  instrument: string;
  issueDate: Date | null;
  expiryDate: Date | null;
  result: "WON" | "LOST" | "CANCELLED" | "EVALUATION";
  refundRequested: number | null;
  refundReceived: number | null;
  pending: number;
  convertedToSd: boolean;
  sdAmount: number | null;
  documents: Doc[];
};
type Instrument = {
  id: string;
  kind: "BG" | "ISB";
  number: string;
  title: string;
  party: string;
  bank: string;
  amount: number | null;
  issueDate: Date | null;
  expiryDate: Date | null;
};
type Data = { rows: Row[]; instruments: Instrument[]; canEdit: boolean };

const METHOD: Record<string, string> = {
  BG: "Bank Guarantee",
  ISB: "Insurance Surety Bond",
  ONLINE: "NEFT/RTGS",
  DD: "Demand Draft",
  EXEMPTION: "Exemption",
  OTHER: "Other",
  UNCLEAR: "Not set",
};
const RESULT: Record<Row["result"], { label: string; tone: string }> = {
  EVALUATION: { label: "Under evaluation", tone: "blue" },
  WON: { label: "Won", tone: "green" },
  LOST: { label: "Lost", tone: "red" },
  CANCELLED: { label: "Cancelled", tone: "amber" },
};

const dateInput = (value: Date | null) => (value && !Number.isNaN(value.getTime()) ? value.toISOString().slice(0, 10) : "");
const numInput = (value: number | null) => (value == null || Number.isNaN(value) ? "" : String(value));

function EditRow({ row, onDone }: { row: Row; onDone: () => void }) {
  const [state, action] = useActionState(async (previous: ActionState, formData: FormData) => {
    const result = await updateEmdRegisterAction(previous, formData);
    if (result?.ok) onDone();
    return result;
  }, null as ActionState);
  return (
    <form action={action} className="form-grid bg-add">
      <input type="hidden" name="tenderId" value={row.tenderId} />
      <label>
        Payment method
        <select name="method" defaultValue={METHOD[row.method] ? row.method : "UNCLEAR"}>
          <option value="BG">Bank Guarantee</option>
          <option value="ISB">Insurance Surety Bond</option>
          <option value="ONLINE">NEFT/RTGS</option>
          <option value="DD">Demand Draft</option>
          <option value="EXEMPTION">Exemption</option>
          <option value="UNCLEAR">Not set</option>
        </select>
      </label>
      <label>
        EMD amount
        <input name="amount" inputMode="decimal" defaultValue={numInput(row.amount)} />
      </label>
      <label>
        Bank details
        <input name="bank" defaultValue={row.bank} />
      </label>
      <label>
        Instrument number
        <input name="instrument" defaultValue={row.instrument} />
      </label>
      <label>
        Issue date
        <input name="issueDate" type="date" defaultValue={dateInput(row.issueDate)} />
      </label>
      <label>
        Expiry date
        <input name="expiryDate" type="date" defaultValue={dateInput(row.expiryDate)} />
      </label>
      {row.result === "LOST" ? (
        <>
          <label>
            Refund requested
            <input name="refundRequested" inputMode="decimal" defaultValue={numInput(row.refundRequested)} />
          </label>
          <label>
            Refund received
            <input name="refundReceived" inputMode="decimal" defaultValue={numInput(row.refundReceived)} />
          </label>
          <p className="muted wide">Pending recovery {inr(row.pending)}. This is the requested amount, or the EMD if no request is recorded, minus what has come back.</p>
        </>
      ) : (
        <>
          <input type="hidden" name="refundRequested" value={numInput(row.refundRequested)} />
          <input type="hidden" name="refundReceived" value={numInput(row.refundReceived)} />
        </>
      )}
      {row.result === "WON" ? (
        <>
          <label className="wide">
            <span>
              <input type="checkbox" name="convertedToSd" value="1" defaultChecked={row.convertedToSd} /> Convert this EMD into a security deposit
            </span>
          </label>
          <label>
            Security deposit amount
            <input name="sdAmount" inputMode="decimal" defaultValue={numInput(row.sdAmount ?? row.amount)} />
          </label>
        </>
      ) : (
        <>
          <input type="hidden" name="convertedToSd" value={row.convertedToSd ? "1" : ""} />
          <input type="hidden" name="sdAmount" value={numInput(row.sdAmount)} />
        </>
      )}
      {state?.error ? <p className="banner bad wide">{state.error}</p> : null}
      <div className="actions wide">
        <Submit>Save EMD</Submit>
      </div>
    </form>
  );
}

/** EMD while a tender is open: how it was paid, where the tender stands, and what happens to the money afterwards. */
export default function EmdBoard({ toggle }: { toggle?: ReactNode }) {
  const { data, error, reload } = useApi<Data>("/emd-board");
  const [card, setCard] = useState("");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const rows = data?.rows ?? [];
  const instruments = data?.instruments ?? [];
  const needle = query.trim().toLowerCase();
  const instrumentView = card === "BG" || card === "ISB";
  const listed = useMemo(() => {
    return rows.filter((row) => {
      if (card === "ONLINE" || card === "DD" || card === "EXEMPTION") {
        if (row.method !== card) return false;
      } else if (card === "WON" || card === "LOST" || card === "CANCELLED" || card === "EVALUATION") {
        if (row.result !== card) return false;
      }
      if (!needle) return true;
      return [row.recordId, row.project, row.customer, row.bank, row.instrument, row.tenderRef, row.portal].join(" ").toLowerCase().includes(needle);
    });
  }, [rows, card, needle]);
  const listedInstruments = useMemo(() => {
    return instruments.filter((row) => {
      if (row.kind !== card) return false;
      if (!needle) return true;
      return [row.number, row.title, row.party, row.bank].join(" ").toLowerCase().includes(needle);
    });
  }, [instruments, card, needle]);

  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;

  const sum = (match: (row: Row) => boolean, pick: (row: Row) => number = (row) => row.amount ?? 0) =>
    rows.filter(match).reduce((total, row) => total + pick(row), 0);
  const count = (match: (row: Row) => boolean) => rows.filter(match).length;
  const instrumentSum = (kind: Instrument["kind"]) => instruments.filter((row) => row.kind === kind).reduce((total, row) => total + (row.amount ?? 0), 0);
  const instrumentCount = (kind: Instrument["kind"]) => instruments.filter((row) => row.kind === kind).length;
  const cards: { key: string; label: string; value: number; money?: boolean; note: string; tone: string; icon: string }[] = [
    { key: "BG", label: "BG", value: instrumentSum("BG"), money: true, note: `(${instrumentCount("BG")})`, tone: "violet", icon: "doc" },
    { key: "ISB", label: "ISB", value: instrumentSum("ISB"), money: true, note: `(${instrumentCount("ISB")})`, tone: "sky", icon: "shield" },
    { key: "ONLINE", label: "NEFT/RTGS", value: sum((row) => row.method === "ONLINE"), money: true, note: `(${count((row) => row.method === "ONLINE")})`, tone: "teal", icon: "doc" },
    { key: "DD", label: "Demand Draft", value: sum((row) => row.method === "DD"), money: true, note: `(${count((row) => row.method === "DD")})`, tone: "orange", icon: "doc" },
    { key: "", label: "Total", value: sum((row) => row.method !== "EXEMPTION"), money: true, note: `(${rows.length})`, tone: "", icon: "shield" },
    { key: "EXEMPTION", label: "Exemption", value: count((row) => row.method === "EXEMPTION"), note: "Count", tone: "green", icon: "check" },
    { key: "EVALUATION", label: "Under evaluation", value: count((row) => row.result === "EVALUATION"), note: "Result not in", tone: "", icon: "clock" },
    { key: "WON", label: "Won", value: count((row) => row.result === "WON"), note: `${count((row) => row.result === "WON" && row.convertedToSd)} converted to SD`, tone: "green", icon: "check" },
    { key: "LOST", label: "Lost", value: count((row) => row.result === "LOST"), note: `${inr(sum((row) => row.result === "LOST", (row) => row.pending))} pending`, tone: "red", icon: "rupee" },
  ];

  return (
    <div className="dk emd-board">
      <section className="dk-hero">
        <PlantArt />
        <div className="dk-hero-text">
          <h1>EMD management</h1>
          <p>Earnest money during tendering: bank guarantee, surety bond, NEFT/RTGS, demand draft or exemption. Lost tenders track the refund. Won tenders can convert the EMD into a security deposit.</p>
        </div>
        <div className="dk-hero-tools">{toggle}</div>
      </section>

      <section className="dk-cards" aria-label="EMD figures">
        {cards.map((item, index) => (
          <button
            key={item.label}
            type="button"
            className={`dk-card ${item.tone}${card === item.key ? " is-on" : ""}`}
            style={{ "--i": index } as CSSProperties}
            onClick={() => setCard((current) => (current === item.key ? "" : item.key))}
          >
            <span className="dk-card-icon">
              <Icon name={item.icon} />
            </span>
            <span className="dk-card-body">
              <span className="dk-card-label">{item.label}</span>
              <b>
                <CountUp value={item.value} money={item.money} duration={900} delay={80 + index * 40} />
              </b>
              <small>{item.note}</small>
            </span>
          </button>
        ))}
      </section>

      <section className="dk-panel">
        <header className="dk-panel-head">
          <span className="dk-panel-icon">
            <Icon name="shield" />
          </span>
          <div>
            <h2>Tender EMD register</h2>
            <p>
              {instrumentView
                ? `${listedInstruments.length} ${card === "BG" ? "EMD bank guarantees" : "EMD surety bonds"}`
                : `${listed.length} of ${rows.length} · tender, customer, instrument and what happens to the money`}
            </p>
          </div>
          <label className="dk-search-box">
            <Icon name="search" />
            <input type="search" placeholder="Tender, customer, instrument…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </header>
        {instrumentView ? (
          listedInstruments.length === 0 ? (
            <p className="dk-empty">No EMD {card === "BG" ? "bank guarantees" : "surety bonds"} match this view.</p>
          ) : (
            listedInstruments.map((row) => (
              <article key={row.id} className="emd-row">
                <header>
                  <div>
                    <Link to={row.kind === "BG" ? `/guarantees/${row.id}` : `/bonds/${row.id}`} state={{ from: "/?board=emd" }}>
                      {row.number || "No number"}
                    </Link>
                    <strong>{row.title}</strong>
                    <small>{row.party || "No customer"}</small>
                  </div>
                  <span className={`dk-pill ${row.kind === "BG" ? "violet" : "blue"}`}>{row.kind === "BG" ? "EMD BG" : "EMD ISB"}</span>
                </header>
                <dl>
                  <div>
                    <dt>Amount</dt>
                    <dd>{inr(row.amount)}</dd>
                  </div>
                  <div>
                    <dt>{row.kind === "BG" ? "Bank" : "Insurer"}</dt>
                    <dd>{row.bank || "—"}</dd>
                  </div>
                  <div>
                    <dt>Issue</dt>
                    <dd>{day(row.issueDate)}</dd>
                  </div>
                  <div>
                    <dt>Expiry</dt>
                    <dd>{day(row.expiryDate)}</dd>
                  </div>
                </dl>
              </article>
            ))
          )
        ) : null}
        {!instrumentView && listed.length === 0 ? <p className="dk-empty">No EMD submissions match this view.</p> : null}
        {!instrumentView
          ? listed.map((row) => (
          <article key={row.tenderId} className="emd-row">
            <header>
              <div>
                <Link to={`/tenders/${row.tenderId}?tab=emd`}>{row.recordId}</Link>
                <strong>{row.project || "Untitled tender"}</strong>
                <small>{[row.customer || "No customer", row.portal, row.location].filter(Boolean).join(" · ")}</small>
              </div>
              <span className={`dk-pill ${RESULT[row.result].tone}`}>{RESULT[row.result].label}</span>
              {data.canEdit ? (
                <button type="button" className={`dk-ghost${editing === row.tenderId ? " is-on" : ""}`} onClick={() => setEditing((current) => (current === row.tenderId ? null : row.tenderId))}>
                  {editing === row.tenderId ? "Close" : "Edit"}
                </button>
              ) : null}
            </header>
            <dl>
              <div>
                <dt>Method</dt>
                <dd>{METHOD[row.method] ?? row.method}</dd>
              </div>
              <div>
                <dt>EMD amount</dt>
                <dd>{inr(row.amount)}</dd>
              </div>
              <div>
                <dt>Bank</dt>
                <dd>{row.bank || "—"}</dd>
              </div>
              <div>
                <dt>Instrument no.</dt>
                <dd>{row.instrument || "—"}</dd>
              </div>
              <div>
                <dt>Issue</dt>
                <dd>{day(row.issueDate)}</dd>
              </div>
              <div>
                <dt>Expiry</dt>
                <dd>{day(row.expiryDate)}</dd>
              </div>
              <div>
                <dt>Documents</dt>
                <dd>
                  {row.documents.length ? (
                    row.documents.map((doc) => (
                      <a key={doc.id} href={documentUrl(doc.id)} target="_blank" rel="noreferrer">
                        {doc.fileName}
                      </a>
                    ))
                  ) : (
                    <Link to={`/tenders/${row.tenderId}?tab=emd`}>Add on the tender</Link>
                  )}
                </dd>
              </div>
              {row.result === "LOST" ? (
                <div>
                  <dt>Refund</dt>
                  <dd>
                    Requested {inr(row.refundRequested)} · received {inr(row.refundReceived)} · pending {inr(row.pending)}
                  </dd>
                </div>
              ) : null}
              {row.result === "WON" ? (
                <div>
                  <dt>Security deposit</dt>
                  <dd>{row.convertedToSd ? `Converted · ${inr(row.sdAmount ?? row.amount)}` : "Not converted"}</dd>
                </div>
              ) : null}
            </dl>
            {editing === row.tenderId ? (
              <EditRow
                row={row}
                onDone={() => {
                  setEditing(null);
                  void reload();
                }}
              />
            ) : null}
          </article>
        ))
          : null}
      </section>
    </div>
  );
}
