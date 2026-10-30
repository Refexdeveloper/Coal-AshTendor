import { Link } from "react-router-dom";
import { useNavigate } from "react-router-dom";
import type { CSSProperties, MouseEvent } from "react";
import { CountUp } from "./count-up";
import { playCardFx, scrollToElement, type CardFx } from "./fx";

export type KpiTone = "teal" | "blue" | "green" | "red" | "orange" | "violet";
export type KpiIcon = "doc" | "clock" | "check" | "alarm" | "send";

export function KpiCard({
  title,
  subtitle,
  value,
  total,
  tone,
  icon,
  href,
  index,
  fx,
  selected = false,
  live = false,
}: {
  title: string;
  subtitle: string;
  value: number;
  total: number;
  tone: KpiTone;
  icon: KpiIcon;
  href: string;
  index: number;
  fx: CardFx;
  selected?: boolean;
  live?: boolean;
}) {
  const navigate = useNavigate();
  const share = total ? Math.round((value / total) * 100) : 0;
  // Play the card's effect first, then navigate once it has had time to be seen.
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    const wait = playCardFx(fx, event.currentTarget);
    window.setTimeout(() => {
      navigate(href, { preventScrollReset: true });
      // Cards that filter the list on this page bring the list into view, as in P2P.
      const [, hash] = href.split("#");
      if (hash) {
        window.setTimeout(() => {
          const list = document.getElementById(hash);
          if (list) scrollToElement(list);
        }, 120);
      }
    }, wait);
  };
  return (
    <Link
      to={href}
      onClick={onClick}
      className={`kpi ${tone} ${selected ? "selected" : ""}`}
      style={{ "--i": index } as CSSProperties}
      aria-current={selected ? "true" : undefined}
    >
      <div className="kpi-head">
        <span className="kpi-icon">
          <KpiGlyph name={icon} />
        </span>
        <div className="kpi-title">
          <h3>{title}</h3>
          <span>
            {live && value > 0 ? <i className="live-dot" /> : null}
            {subtitle}
          </span>
        </div>
      </div>
      <div className="kpi-num">
        <CountUp value={value} duration={1200} delay={250 + index * 90} />
      </div>
      <div className="kpi-progress">
        <span className="track">
          <span className="fill" style={{ "--p": `${share}%` } as CSSProperties} />
        </span>
        <em>{share}%</em>
      </div>
    </Link>
  );
}

function KpiGlyph({ name }: { name: KpiIcon }) {
  const common = { width: 26, height: 26, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true as const };
  if (name === "clock") {
    return (
      <svg {...common} className="ico-clock">
        <circle cx="12" cy="12" r="9" />
        <path className="hand" d="M12 12V7" />
        <path d="M12 12h4" />
      </svg>
    );
  }
  if (name === "check") {
    return (
      <svg {...common} className="ico-check">
        <circle cx="12" cy="12" r="9" />
        <path className="tick" d="m8 12.5 2.7 2.7L16.5 9.5" />
      </svg>
    );
  }
  if (name === "alarm") {
    return (
      <svg {...common}>
        <circle cx="12" cy="13" r="7.5" />
        <path d="M12 9.5V13l2.5 1.5M4 5l3-2.5M20 5l-3-2.5" />
      </svg>
    );
  }
  if (name === "send") {
    return (
      <svg {...common}>
        <path d="M21 3 10 14M21 3l-7 18-4-7-7-4 18-7z" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5M9 13h6M9 17h4" />
    </svg>
  );
}
