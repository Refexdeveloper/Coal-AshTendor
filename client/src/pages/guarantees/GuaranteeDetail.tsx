import { useMemo, useState, type CSSProperties } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { bgDocumentUrl, useApi } from "@client/api/client";
import type { BankGuarantee, BgDocument } from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { Icon, PlantArt } from "@client/pages/executive/ExecutiveView";
import { HEALTH, day } from "@client/pages/bonds/Bonds";
import { inr, inrFull } from "@client/utils/money";
import { TYPE_LABEL, TYPE_TONE, asDate, enrich, pct } from "./Guarantees";
import { BgDocumentsPanel } from "./BgDocuments";
import { AddGuaranteeForm } from "./AddGuarantee";

/** One bank guarantee on its own page: every stored field and the full issuance and amendment history. */
export default function GuaranteeDetailPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const back = (location.state as { from?: string } | null)?.from ?? "/guarantees";
  const { data, error, reload } = useApi<{ guarantee: BankGuarantee; documents: BgDocument[]; canUpload: boolean; canEdit?: boolean }>(`/guarantees/${encodeURIComponent(id)}`);
  const today = useMemo(() => new Date(), []);
  const [activeDoc, setActiveDoc] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;
  const row = enrich(data.guarantee, today);
  const health = HEALTH[row.health];

  // The scan for a step: the issuance document, or the one marked with that amendment number.
  const docFor = (index: number) =>
    index === 0 ? data.documents.find((doc) => doc.kind === "ISSUANCE") : data.documents.find((doc) => doc.kind === "AMENDMENT" && doc.amendmentNo === row.amendmentList[index - 1]?.no);
  const steps = [
    { label: "Issuance", amount: row.amount, charges: row.charges, chargesPercent: row.chargesPercent, date: row.amendmentDate ?? row.issueDate, expiry: row.expiryDate, claim: row.claimDate, stampDuty: row.stampDuty },
    ...row.amendmentList.map((item) => ({
      label: `Amendment ${item.no}`,
      amount: item.amount,
      charges: item.charges,
      chargesPercent: item.chargesPercent,
      date: asDate(item.date),
      expiry: asDate(item.expiry),
      claim: asDate(item.claim),
      stampDuty: item.stampDuty,
    })),
  ];
  const original = row.amount ?? 0;
  const change = (row.current.amount ?? 0) - original;

  const figures = [
    { tone: "violet", icon: "₹", label: "Current amount", value: inr(row.current.amount), note: change ? `${change > 0 ? "+" : ""}${inr(change)} vs issuance ${inr(original)}` : "Same as issuance" },
    { tone: row.health === "soon" || row.health === "claim" ? "red" : "blue", icon: "◷", label: "Current expiry", value: day(row.current.expiry), note: row.days == null ? "No expiry date" : row.days >= 0 ? `${row.days} days left` : `Expired ${-row.days} days ago` },
    { tone: "ember", icon: "⚑", label: "Claim date", value: day(row.current.claim), note: row.health === "claim" ? "Claim window still open" : "Last date to claim" },
    { tone: "green", icon: "↻", label: "Amendments", value: String(row.amendmentList.length), note: row.amendmentList.length ? `Latest ${day(asDate(row.amendmentList[row.amendmentList.length - 1].date))}` : "Fresh issuance only" },
    { tone: "coal", icon: "%", label: "Charges paid", value: inr(row.chargesTotal), note: `${steps.length} step${steps.length === 1 ? "" : "s"} · ${pct(row.chargesPercent)} at issuance` },
    { tone: "blue", icon: "▤", label: "Documents", value: String(data.documents.length), note: data.documents.length ? `${data.documents.filter((doc) => doc.kind === "AMENDMENT").length} amendment scans` : "None uploaded yet" },
  ];

  const groups: { title: string; icon: string; rows: [string, string][] }[] = [
    {
      title: "Guarantee",
      icon: "⛨",
      rows: [
        ["BG type", TYPE_LABEL[row.bgType] ? `${row.bgType} · ${TYPE_LABEL[row.bgType]}` : row.bgType || "—"],
        ["BG number", row.bgNumber || "—"],
        ["Issuance bank", row.bank || "—"],
        ["Margin money", row.marginMoney || "—"],
        ["BG details", row.details || "—"],
        ["Amendment number", row.amendmentNumber || "—"],
      ],
    },
    {
      title: "Beneficiary",
      icon: "◈",
      rows: [
        ["Beneficiary", row.beneficiary || "—"],
        ["Site / plant / project", row.site || "—"],
      ],
    },
    {
      title: "Issuance",
      icon: "₹",
      rows: [
        ["BG amount", inrFull(row.amount)],
        ["BG issue date", day(row.issueDate)],
        ["BG charges", inrFull(row.charges)],
        ["BG charges %", pct(row.chargesPercent)],
        ["Amendment date", day(row.amendmentDate)],
        ["Expiry date", day(row.expiryDate)],
        ["Claim date", day(row.claimDate)],
        ["Stamp duty", inrFull(row.stampDuty)],
      ],
    },
    ...(Object.keys(row.extraFields).length ? [{ title: "Other fields", icon: "＋", rows: Object.entries(row.extraFields) }] : []),
  ];

  return (
    <div className="dk bonds bg-detail">
      <section className="dk-hero">
        <PlantArt />
        <div className="dk-hero-text">
          <Link className="bg-back" to={back}>
            ← Back to bank guarantees
          </Link>
          <div className="bg-chips">
            <span className={`dk-pill ${TYPE_TONE[row.bgType] ?? ""}`}>{row.bgType || "BG"}</span>
            <span className={`dk-pill ${health.tone}`}>{health.label}</span>
            <span className="bonds-number">{row.bgNumber}</span>
          </div>
          <h1>{row.beneficiary || "Bank guarantee"}</h1>
          <p>
            {[row.site, row.bank, row.marginMoney].filter(Boolean).join(" · ")}
          </p>
        </div>
        {data.canEdit ? (
          <div className="dk-hero-tools">
            <button type="button" className={`dk-btn${editing ? " is-on" : ""}`} onClick={() => setEditing((value) => !value)}>
              {editing ? "Close" : "Edit"}
            </button>
          </div>
        ) : null}
      </section>

      {editing ? (
        <AddGuaranteeForm
          guarantee={data.guarantee}
          onDone={() => {
            setEditing(false);
            void reload();
          }}
        />
      ) : null}

      <section className="exec-metrics">
        {figures.map((figure, index) => (
          <article key={figure.label} className={`exec-metric ${figure.tone}`} style={{ "--i": index } as CSSProperties}>
            <span className="exec-metric-icon" aria-hidden>
              {figure.icon}
            </span>
            <span className="exec-metric-label">{figure.label}</span>
            <b>{figure.value}</b>
            <small>{figure.note}</small>
          </article>
        ))}
      </section>

      <div className="exec-columns">
        <div className="stack">
          {row.loiLoa ? (
            <section className="panel exec-scope">
              <span className="eyebrow">LOI / LOA</span>
              <p>{row.loiLoa}</p>
            </section>
          ) : null}
          <section className="panel">
            <header className="panel-head">
              <div>
                <h2>Guarantee details</h2>
                <p className="muted">Every field stored from the BG register</p>
              </div>
            </header>
            <div className="exec-field-groups">
              {groups.map((group) => (
                <section key={group.title} className="exec-field-group">
                  <h3>
                    <span aria-hidden>{group.icon}</span>
                    {group.title}
                  </h3>
                  <dl>
                    {group.rows.map(([label, value]) => (
                      <div key={label} className={value === "—" ? "missing" : ""}>
                        <dt>{label}</dt>
                        <dd>{value}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </div>
          </section>
        </div>

        <aside className="stack">
          <section className="panel">
            <h2>Validity history</h2>
            <p className="muted">How the amount and expiry changed at each step</p>
            <ol className="bg-steps">
              {steps.map((step, index) => {
                const previous = steps[index - 1];
                const amountChanged = previous && step.amount != null && previous.amount != null && step.amount !== previous.amount;
                const current = index === steps.length - 1;
                return (
                  <li key={step.label} className={current ? "is-current" : ""} style={{ "--r": index } as CSSProperties}>
                    <span className="bg-step-dot" aria-hidden>
                      {index === 0 ? "★" : index}
                    </span>
                    <span className="bg-step-body">
                      <strong>
                        {step.label}
                        {current && steps.length > 1 ? <em>current</em> : null}
                      </strong>
                      <small>{day(step.date)}</small>
                      <span className="bg-step-facts">
                        <span>
                          Amount <b>{inr(step.amount)}</b>
                          {amountChanged ? <i className={step.amount! > previous.amount! ? "up" : "down"}>{step.amount! > previous.amount! ? "▲" : "▼"}</i> : null}
                        </span>
                        <span>
                          Expiry <b>{day(step.expiry)}</b>
                        </span>
                        <span>
                          Claim <b>{day(step.claim)}</b>
                        </span>
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>

      <section className="dk-panel">
        <header className="dk-panel-head">
          <span className="dk-panel-icon">
            <Icon name="doc" />
          </span>
          <div>
            <h2>Issuance and amendments</h2>
            <p>Every step with its amount, charges and dates, exactly as in the register</p>
          </div>
        </header>
        <div className="dk-table-wrap">
          <table className="bg-history-table">
            <thead>
              <tr>
                <th>Step</th>
                <th>Date</th>
                <th className="num">BG amount</th>
                <th className="num">Charges</th>
                <th className="num">Charges %</th>
                <th>Expiry</th>
                <th>Claim date</th>
                <th className="num">Stamp duty</th>
                <th>Document</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((step, index) => {
                const doc = docFor(index);
                return (
                <tr
                  key={step.label}
                  className={`${index === steps.length - 1 ? "is-current" : ""}${doc ? " is-link" : ""}${doc && activeDoc === doc.id ? " is-on" : ""}`}
                  onClick={() => {
                    if (!doc) return;
                    setActiveDoc(doc.id);
                    document.getElementById("documents")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                  }}
                >
                  <td>
                    <b>{step.label}</b>
                    {index === steps.length - 1 && steps.length > 1 ? <small> · current</small> : null}
                  </td>
                  <td>{day(step.date)}</td>
                  <td className="num">{inrFull(step.amount)}</td>
                  <td className="num">{inrFull(step.charges)}</td>
                  <td className="num">{pct(step.chargesPercent)}</td>
                  <td>{day(step.expiry)}</td>
                  <td>{day(step.claim)}</td>
                  <td className="num">{inrFull(step.stampDuty)}</td>
                  <td>
                    {doc ? (
                      <a className="bgdoc-link" href={bgDocumentUrl(doc.id)} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()}>
                        View PDF
                      </a>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={3}>
                  <b>Total</b>
                </td>
                <td className="num">
                  <b>{inrFull(row.chargesTotal)}</b>
                </td>
                <td colSpan={3} />
                <td className="num">
                  <b>{inrFull(row.stampTotal)}</b>
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </section>

      <BgDocumentsPanel documents={data.documents} bgNumber={row.bgNumber} canUpload={data.canUpload} onChange={() => void reload()} selectedId={activeDoc} />
    </div>
  );
}
