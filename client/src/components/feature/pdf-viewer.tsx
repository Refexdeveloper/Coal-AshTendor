import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GlobalWorkerOptions, TextLayer, getDocument, type PDFDocumentProxy, type PDFPageProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import "pdfjs-dist/web/pdf_viewer.css";

GlobalWorkerOptions.workerSrc = workerUrl;

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
const GAP = 14;

type Size = { width: number; height: number };

/** Reader for the tender notice: one scrolling column, fit-to-width, page jump, zoom, search and a full-screen mode. */
export default function PdfViewer({ src, name }: { src: string; name: string }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
  const [sizes, setSizes] = useState<Size[]>([]);
  const [failed, setFailed] = useState(false);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(1);
  const [width, setWidth] = useState(0);
  const [rotation, setRotation] = useState(0);
  const [page, setPage] = useState(1);
  const [pageDraft, setPageDraft] = useState("1");
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [texts, setTexts] = useState<string[] | null>(null);
  const [hit, setHit] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const searchBox = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    const task = getDocument({ url: src, withCredentials: true });
    setPdf(null);
    setFailed(false);
    setTexts(null);
    task.promise
      .then(async (doc) => {
        const pages = await Promise.all(Array.from({ length: doc.numPages }, (_, i) => doc.getPage(i + 1)));
        if (cancelled) return;
        setSizes(pages.map((p) => p.getViewport({ scale: 1 })).map(({ width, height }) => ({ width, height })));
        setPdf(doc);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      void task.destroy();
    };
  }, [src]);

  useLayoutEffect(() => {
    const box = scroller.current;
    if (!box) return;
    const observer = new ResizeObserver(() => setWidth(box.clientWidth));
    observer.observe(box);
    setWidth(box.clientWidth);
    return () => {
      observer.disconnect();
    };
  }, [pdf, expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [expanded]);

  const turned = rotation % 180 !== 0;
  const widest = Math.max(1, ...sizes.map((s) => (turned ? s.height : s.width)));
  const scale = fit ? Math.max(0.25, (width - 32) / widest) : zoom;

  // Search reads every page's text once, the first time someone types.
  useEffect(() => {
    if (!pdf || texts || !query.trim()) return;
    let cancelled = false;
    Promise.all(
      Array.from({ length: pdf.numPages }, (_, i) =>
        pdf
          .getPage(i + 1)
          .then((p) => p.getTextContent())
          .then((content) => content.items.map((item) => ("str" in item ? item.str : "")).join(" ")),
      ),
    ).then((all) => {
      if (!cancelled) setTexts(all);
    });
    return () => {
      cancelled = true;
    };
  }, [pdf, texts, query]);

  const needle = query.trim().toLowerCase();
  const hitPages = needle && texts ? texts.flatMap((text, i) => (text.toLowerCase().includes(needle) ? [i + 1] : [])) : [];

  const goTo = useCallback((target: number) => {
    const box = scroller.current;
    const node = box?.querySelector<HTMLElement>(`[data-page="${target}"]`);
    if (box && node) box.scrollTo({ top: node.offsetTop - GAP, behavior: "smooth" });
  }, []);

  useEffect(() => {
    setHit(0);
    if (hitPages.length) goTo(hitPages[0]);
    // Jump only when the query or the loaded text changes, not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needle, texts]);

  const onScroll = () => {
    const box = scroller.current;
    if (!box) return;
    const mark = box.scrollTop + box.clientHeight * 0.35;
    let current = 1;
    for (const node of box.querySelectorAll<HTMLElement>("[data-page]")) {
      if (node.offsetTop <= mark) current = Number(node.dataset.page);
      else break;
    }
    if (current !== page) {
      setPage(current);
      setPageDraft(String(current));
    }
  };

  // Keep the reading position when the zoom changes.
  const zoomTo = (next: number) => {
    const box = scroller.current;
    const ratio = box ? box.scrollTop / Math.max(1, box.scrollHeight) : 0;
    setFit(false);
    setZoom(next);
    requestAnimationFrame(() => {
      if (box) box.scrollTop = ratio * box.scrollHeight;
    });
  };
  const stepZoom = (direction: 1 | -1) => {
    const next = direction > 0 ? ZOOMS.find((z) => z > scale + 0.01) : [...ZOOMS].reverse().find((z) => z < scale - 0.01);
    if (next) zoomTo(next);
  };

  const jumpHit = (direction: 1 | -1) => {
    if (!hitPages.length) return;
    const next = (hit + direction + hitPages.length) % hitPages.length;
    setHit(next);
    goTo(hitPages[next]);
  };

  const total = pdf?.numPages ?? 0;
  const commitPage = () => {
    const target = Math.min(total, Math.max(1, Number(pageDraft) || page));
    setPageDraft(String(target));
    goTo(target);
  };

  const view = (
    <div className={`pdfv${expanded ? " is-expanded" : ""}`}>
      {expanded ? <div className="pdfv-backdrop" onClick={() => setExpanded(false)} /> : null}
      <div className="pdfv-shell">
        <div className="pdfv-bar" role="toolbar" aria-label="Document controls">
          <div className="pdfv-group">
            <Tool label="Previous page" onClick={() => goTo(page - 1)} disabled={page <= 1}>
              <path d="M15 18l-6-6 6-6" />
            </Tool>
            <span className="pdfv-page">
              <input
                aria-label="Page number"
                inputMode="numeric"
                value={pageDraft}
                onChange={(event) => setPageDraft(event.target.value.replace(/\D/g, ""))}
                onBlur={commitPage}
                onKeyDown={(event) => {
                  if (event.key === "Enter") commitPage();
                }}
              />
              <span>of {total || "–"}</span>
            </span>
            <Tool label="Next page" onClick={() => goTo(page + 1)} disabled={page >= total}>
              <path d="M9 18l6-6-6-6" />
            </Tool>
          </div>

          <div className="pdfv-group">
            <Tool label="Zoom out" onClick={() => stepZoom(-1)} disabled={scale <= ZOOMS[0] + 0.01}>
              <path d="M5 12h14" />
            </Tool>
            <button type="button" className={`pdfv-zoom${fit ? " is-on" : ""}`} onClick={() => setFit(true)} title="Fit the page to the width">
              {fit ? "Fit width" : `${Math.round(scale * 100)}%`}
            </button>
            <Tool label="Zoom in" onClick={() => stepZoom(1)} disabled={scale >= ZOOMS[ZOOMS.length - 1] - 0.01}>
              <path d="M12 5v14M5 12h14" />
            </Tool>
          </div>

          <label className="pdfv-search">
            <svg viewBox="0 0 24 24" aria-hidden>
              <circle cx="11" cy="11" r="7" />
              <path d="M20 20l-3.5-3.5" />
            </svg>
            <input
              ref={searchBox}
              type="search"
              placeholder="Find in document"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") jumpHit(event.shiftKey ? -1 : 1);
              }}
            />
            {needle ? (
              <span className="pdfv-hits">
                {texts === null ? "…" : hitPages.length ? `${hit + 1}/${hitPages.length}` : "0"}
              </span>
            ) : null}
            {hitPages.length > 1 ? (
              <>
                <Tool label="Previous match" onClick={() => jumpHit(-1)}>
                  <path d="M18 15l-6-6-6 6" />
                </Tool>
                <Tool label="Next match" onClick={() => jumpHit(1)}>
                  <path d="M6 9l6 6 6-6" />
                </Tool>
              </>
            ) : null}
          </label>

          <div className="pdfv-group pdfv-end">
            <Tool label="Rotate" onClick={() => setRotation((r) => (r + 90) % 360)}>
              <path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7" />
            </Tool>
            <a className="pdfv-tool" href={src} download={name} title="Download" aria-label="Download">
              <svg viewBox="0 0 24 24" aria-hidden>
                <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
              </svg>
            </a>
            <Tool label={expanded ? "Close full screen (Esc)" : "Full screen"} onClick={() => setExpanded((v) => !v)}>
              {expanded ? <path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" /> : <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />}
            </Tool>
          </div>
        </div>

        <div className="pdfv-scroll" ref={scroller} onScroll={onScroll}>
          {failed ? (
            <div className="pdfv-state">
              <p>This PDF could not be shown here.</p>
              <a className="btn ghost" href={src} target="_blank" rel="noreferrer">
                Open it in a new tab
              </a>
            </div>
          ) : !pdf ? (
            <div className="pdfv-state">
              <span className="pdfv-spinner" aria-hidden />
              <p>Loading the document…</p>
            </div>
          ) : width ? (
            sizes.map((size, i) => (
              <PdfPage
                key={i}
                pdf={pdf}
                number={i + 1}
                size={size}
                scale={scale}
                rotation={rotation}
                needle={needle}
                active={hitPages[hit] === i + 1}
                root={scroller}
              />
            ))
          ) : null}
        </div>
      </div>
    </div>
  );
  // Full screen escapes the sticky, animated pane so position: fixed covers the window.
  return expanded ? (
    <>
      <div className="pdfv-spacer" />
      {createPortal(view, document.body)}
    </>
  ) : (
    view
  );
}

function Tool({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button type="button" className="pdfv-tool" onClick={onClick} disabled={disabled} title={label} aria-label={label}>
      <svg viewBox="0 0 24 24" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

/** One page: a sized placeholder that draws itself (canvas plus selectable text) once it nears the viewport. */
function PdfPage({
  pdf,
  number,
  size,
  scale,
  rotation,
  needle,
  active,
  root,
}: {
  pdf: PDFDocumentProxy;
  number: number;
  size: Size;
  scale: number;
  rotation: number;
  needle: string;
  active: boolean;
  root: React.RefObject<HTMLDivElement | null>;
}) {
  const holder = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const textBox = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);
  const [drawn, setDrawn] = useState("");

  useEffect(() => {
    const node = holder.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: root.current, rootMargin: "800px 0px" });
    observer.observe(node);
    return () => {
      observer.disconnect();
    };
  }, [root]);

  const key = `${scale.toFixed(3)}:${rotation}`;
  useEffect(() => {
    if (!near || drawn === key) return;
    let cancelled = false;
    let renderTask: ReturnType<PDFPageProxy["render"]> | null = null;
    let textLayer: TextLayer | null = null;
    pdf.getPage(number).then(async (p) => {
      if (cancelled || !canvas.current || !textBox.current) return;
      const viewport = p.getViewport({ scale, rotation: (p.rotate + rotation) % 360 });
      const ratio = window.devicePixelRatio || 1;
      const target = canvas.current;
      target.width = Math.floor(viewport.width * ratio);
      target.height = Math.floor(viewport.height * ratio);
      const context = target.getContext("2d")!;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      renderTask = p.render({ canvasContext: context, viewport });
      try {
        await renderTask.promise;
      } catch {
        return;
      }
      if (cancelled) return;
      textBox.current.replaceChildren();
      textLayer = new TextLayer({ textContentSource: p.streamTextContent(), container: textBox.current, viewport });
      await textLayer.render().catch(() => undefined);
      if (!cancelled) setDrawn(key);
    });
    return () => {
      cancelled = true;
      renderTask?.cancel();
      textLayer?.cancel();
    };
  }, [near, key, drawn, pdf, number, scale, rotation]);

  // Highlight matching text runs on this page.
  useEffect(() => {
    const box = textBox.current;
    if (!box) return;
    for (const span of box.querySelectorAll("span")) {
      span.classList.toggle("pdfv-hit", Boolean(needle) && (span.textContent ?? "").toLowerCase().includes(needle));
    }
  }, [needle, drawn]);

  const turned = rotation % 180 !== 0;
  const width = (turned ? size.height : size.width) * scale;
  const height = (turned ? size.width : size.height) * scale;
  return (
    <div
      ref={holder}
      className={`pdfv-page-sheet${active ? " is-active" : ""}`}
      data-page={number}
      style={{ width, height, "--scale-factor": scale } as CSSProperties}
    >
      <canvas ref={canvas} style={{ width, height }} />
      <div ref={textBox} className="textLayer" />
      {drawn ? null : <span className="pdfv-page-loading">Page {number}</span>}
      <span className="pdfv-page-no">{number}</span>
    </div>
  );
}
