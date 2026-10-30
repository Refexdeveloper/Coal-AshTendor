import { useEffect, useState } from "react";

/** Live countdown to the bid deadline; ticks every second once mounted. */
export function Countdown({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  if (!deadline) return <p className="countdown-note">Deadline not confirmed</p>;
  const left = now == null ? null : new Date(deadline).getTime() - now;
  if (left != null && left <= 0) return <p className="countdown-note late">Deadline passed</p>;
  const total = Math.max(0, Math.floor((left ?? 0) / 1000));
  const parts = [
    ["days", Math.floor(total / 86400)],
    ["hrs", Math.floor((total % 86400) / 3600)],
    ["min", Math.floor((total % 3600) / 60)],
    ["sec", total % 60],
  ] as const;
  const urgent = left != null && left < 72 * 36e5;
  return (
    <div className={`countdown ${urgent ? "urgent" : ""}`} aria-label="Time left until the bid deadline">
      {parts.map(([unit, value]) => (
        <span key={unit} className="cd-cell">
          <b key={now == null ? "x" : value}>{now == null ? "–" : String(value).padStart(2, "0")}</b>
          <small>{unit}</small>
        </span>
      ))}
    </div>
  );
}
