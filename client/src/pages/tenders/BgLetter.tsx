import { useRef } from "react";
import { Link, useParams } from "react-router-dom";
import { useApi } from "@client/api/client";
import type { EmdRecord, Tender } from "@client/lib/types";
import { LoadFailed, Loading } from "@client/components/base/loading";
import { BgLetterSheet, FdLetterSheet, parseBgRequest } from "@client/components/feature/bg-request";

/** Styles carried into the downloaded Word file, which cannot read the app's stylesheet. */
const WORD_STYLES = `
body { font-family: Cambria, Georgia, serif; font-size: 12pt; color: #000; }
p { margin: 0 0 12pt; }
.bg-letter-to span, .bg-letter-sign b { display: block; }
table { border-collapse: collapse; width: 100%; margin-bottom: 4pt; }
th, td { border: 1px solid #000; padding: 2pt 6pt; vertical-align: top; text-align: left; }
th:first-child, td:first-child { width: 30%; }
.bg-fd-table th, .bg-fd-table td { width: 25%; }
.bg-letter-signatory { margin-top: 48pt; }
mark { background: none; color: inherit; }
`;

/** A printable copy of the BG request letter, opened from the EMD task. */
export default function BgLetterPage() {
  const { id = "" } = useParams();
  const bgSheet = useRef<HTMLDivElement>(null);
  const fdSheet = useRef<HTMLDivElement>(null);
  const { data, error, reload } = useApi<{ tender: Tender & { emd: EmdRecord | null } }>(`/tenders/${encodeURIComponent(id)}`);
  if (!data) return error ? <LoadFailed error={error} retry={reload} /> : <Loading />;
  const { tender } = data;
  const request = parseBgRequest(tender.emd?.bgRequest);

  const download = (sheet: HTMLDivElement | null, name: string) => {
    if (!sheet) return;
    const html = `<html><head><meta charset="utf-8"><style>${WORD_STYLES}</style></head><body>${sheet.innerHTML}</body></html>`;
    const url = URL.createObjectURL(new Blob(["﻿", html], { type: "application/msword" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name}-${tender.recordId}.doc`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <main className="bg-letter-page">
      <nav className="bg-letter-bar">
        <div>
          <Link to={`/tenders/${tender.id}`}>← {tender.recordId}</Link>
          <strong>Bank guarantee letters</strong>
        </div>
        {request ? (
          <div className="actions">
            <button type="button" className="btn" onClick={() => window.print()}>
              Print both / Save as PDF
            </button>
          </div>
        ) : null}
      </nav>
      {request ? (
        <>
          <section className="bg-letter-block">
            <header className="bg-letter-label">
              <span>1 · BG details letter</span>
              <button type="button" className="btn ghost" onClick={() => download(bgSheet.current, "BG-details")}>
                Download Word
              </button>
            </header>
            <div className="bg-letter-paper" ref={bgSheet}>
              <BgLetterSheet request={request} />
            </div>
          </section>
          <section className="bg-letter-block">
            <header className="bg-letter-label">
              <span>2 · FD creation letter for advance BG</span>
              <button type="button" className="btn ghost" onClick={() => download(fdSheet.current, "FD-creation")}>
                Download Word
              </button>
            </header>
            <div className="bg-letter-paper" ref={fdSheet}>
              <FdLetterSheet request={request} />
            </div>
          </section>
        </>
      ) : (
        <p className="panel empty">The letter details have not been saved yet. Fill them on the EMD task first.</p>
      )}
    </main>
  );
}
