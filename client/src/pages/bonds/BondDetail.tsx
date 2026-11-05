import { useMemo, type CSSProperties } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { useApi } from "@client/api/client";
import type { SuretyBond } from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { PlantArt } from "@client/pages/executive/ExecutiveView";
import { inr, inrFull } from "@client/utils/money";
import { HEALTH, day, enrich } from "./Bonds";
import { BondDocumentsPanel, bondDocUrl, type BondDocument } from "./BondDocuments";

/** One surety bond (EMD or PBG ISB) on its own page: every field, its validity steps and its ISB copies. */
export default function BondDetailPage() {
  const { id = "" } = useParams();
  const location = useLocation();
  const back = (location.state as { from?: string } | null)?.from ?? "/bonds";
  const backLabel = back.includes("board=emd") ? "Back to EMD" : "Back to ISB register";
  const { data, error, reload } = useApi<{ bond: SuretyBond; documents: BondDocument[]; canUpload: boolean }>(`/bonds/${encodeURIComponent(id)}`);
  const today = useMemo(() => new Date(), []);
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;
  const row = enrich(data.bond, today);
  const health = HEALTH[row.health];
  const isEmd = row.kind === "EMD";
  const docFor = (kind: "ISSUANCE" | "EXTENSION", no?: number) => data.documents.find((doc) => doc.kind === kind && (kind === "ISSUANCE" || doc.extensionNo === no));

  const steps = [
    { label: "Issued", date: row.issueDate, start: row.startDate, expiry: row.expiryDate, claim: row.claimExpiryDate, doc: docFor("ISSUANCE") },
    ...(row.ext1IssueDate || row.ext1ExpiryDate
      ? [{ label: "Extension 1", date: row.ext1IssueDate, start: row.ext1StartDate, expiry: row.ext1ExpiryDate, claim: row.ext1ClaimDate, doc: docFor("EXTENSION", 1) }]
      : []),
    ...(row.ext2Date || row.ext2ClaimDate ? [{ label: "Extension 2", date: null, start: null, expiry: row.ext2Date, claim: row.ext2ClaimDate, doc: docFor("EXTENSION", 2) }] : []),
  ];

  const figures = [
    { tone: isEmd ? "ember" : "violet", icon: "₹", label: isEmd ? "EMD amount" : "Bond value", value: inr(row.amount), note: row.onlineAmount ? `+ ${inr(row.onlineAmount)} paid online` : isEmd ? "Insurance surety bond" : row.usedFor === "APS" ? "Additional performance security" : "Performance security" },
    { tone: row.health === "soon" || row.health === "claim" ? "red" : "blue", icon: "◷", label: "Expiry", value: day(row.expiry), note: row.days == null ? "No expiry date" : row.days >= 0 ? `${row.days} days left` : `Expired ${-row.days} days ago` },
    { tone: "ember", icon: "⚑", label: "Claim expiry", value: day(row.claim), note: row.health === "claim" ? "Claim window still open" : "Last date to claim" },
    { tone: "green", icon: "%", label: "Premium", value: inr(row.premium), note: row.premiumPercent != null ? `${row.premiumPercent}% of the bond` : "Premium paid" },
    { tone: "coal", icon: "⎙", label: "Stamp duty", value: inr(row.stampDuty), note: row.extended ? "Extended" : "No extension" },
    { tone: "blue", icon: "▤", label: "ISB copies", value: String(data.documents.length), note: data.documents.length ? `${data.documents.filter((doc) => doc.kind === "EXTENSION").length} extension copies` : "None uploaded yet" },
  ];

  const groups: { title: string; icon: string; rows: [string, string][] }[] = [
    {
      title: "Bond",
      icon: "⛨",
      rows: [
        ["Type", isEmd ? "EMD · insurance surety bond" : `PBG · ${row.usedFor === "APS" ? "APS (additional performance security)" : row.usedFor === "PS" ? "PS (performance security)" : "performance bond"}`],
        ["Bond number", row.bondNumber || "—"],
        ["Insurer", row.insurer || "—"],
        ["Insurance broker", row.broker || "—"],
        ...(isEmd
          ? ([
              ["Mode", row.mode || "—"],
              ["Type of transfer", row.transferType || "—"],
              ["Tender status", row.status || "—"],
            ] as [string, string][])
          : []),
      ],
    },
    {
      title: isEmd ? "Tender" : "Contract",
      icon: "◈",
      rows: [
        [isEmd ? "Customer" : "Company", row.customer || "—"],
        ...(isEmd ? ([["Thermal plant", row.plant || "—"]] as [string, string][]) : []),
        [isEmd ? "Tender ID" : "Tender / award reference", row.tenderRef || "—"],
        ...(isEmd
          ? ([
              ["State", row.state || "—"],
              ["Business line", row.line === "COAL" ? "Coal" : row.line === "ASH" ? "Ash" : "—"],
            ] as [string, string][])
          : []),
      ],
    },
    {
      title: "Money",
      icon: "₹",
      rows: [
        [isEmd ? "EMD amount" : "Bond value", inrFull(row.amount)],
        ...(isEmd
          ? ([
              ["Paid online", inrFull(row.onlineAmount)],
              ["ISB amount", inrFull(row.isbAmount)],
            ] as [string, string][])
          : []),
        ["Premium", inrFull(row.premium)],
        ["Premium %", row.premiumPercent != null ? `${row.premiumPercent}%` : "—"],
        ["Stamp duty", inrFull(row.stampDuty)],
      ],
    },
  ];

  return (
    <div className="dk bonds bg-detail">
      <section className="dk-hero">
        <PlantArt />
        <div className="dk-hero-text">
          <Link className="bg-back" to={back}>
            ← {backLabel}
          </Link>
          <div className="bg-chips">
            <span className={`dk-pill ${isEmd ? "amber" : "violet"}`}>{isEmd ? "EMD" : row.usedFor ? `PBG · ${row.usedFor}` : "PBG"}</span>
            <span className={`dk-pill ${health.tone}`}>{health.label}</span>
            <span className="bonds-number">{row.bondNumber}</span>
          </div>
          <h1>{row.name || "Surety bond"}</h1>
          <p>{[row.customer !== row.name ? row.customer : "", row.state, row.insurer].filter(Boolean).join(" · ")}</p>
        </div>
      </section>

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
          {row.tenderDetails ? (
            <section className="panel exec-scope">
              <span className="eyebrow">Tender details</span>
              <p>{row.tenderDetails}</p>
            </section>
          ) : null}
          <section className="panel">
            <header className="panel-head">
              <div>
                <h2>Bond details</h2>
                <p className="muted">Every field stored from the ISB register</p>
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
            <h2>Validity</h2>
            <p className="muted">Issue and each extension, with its copy</p>
            <ol className="bg-steps">
              {steps.map((step, index) => {
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
                      <small>{step.date ? `Issued ${day(step.date)}` : step.start ? `From ${day(step.start)}` : "—"}</small>
                      <span className="bg-step-facts">
                        <span>
                          Expiry <b>{day(step.expiry)}</b>
                        </span>
                        <span>
                          Claim <b>{day(step.claim)}</b>
                        </span>
                        {step.doc ? (
                          <a className="bgdoc-link" href={bondDocUrl(step.doc.id)} target="_blank" rel="noreferrer">
                            View copy
                          </a>
                        ) : null}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>
        </aside>
      </div>

      <BondDocumentsPanel documents={data.documents} bondId={row.id} bondNumber={row.bondNumber} canUpload={data.canUpload} onChange={() => void reload()} />
    </div>
  );
}
