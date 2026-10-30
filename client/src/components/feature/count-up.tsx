import { useLayoutEffect, useState } from "react";

const RUPEES = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
const PLAIN = new Intl.NumberFormat("en-IN");

/**
 * Counts from zero up to `value` with an ease-out curve, starting `delay` ms after mount.
 * The server renders the final number; the layout effect resets it to zero before the first paint.
 * Each effect run starts its own animation and cleans it up, so React's double-run in development is harmless.
 */
export function CountUp({
  value,
  money = false,
  duration = 1400,
  delay = 0,
}: {
  value: number;
  money?: boolean;
  duration?: number;
  delay?: number;
}) {
  const [shown, setShown] = useState(value);
  useLayoutEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || value === 0) {
      setShown(value);
      return;
    }
    setShown(0);
    // Timers rather than requestAnimationFrame: rAF is paused in background tabs, which left the numbers stuck at 0.
    // Progress is time-based, so a throttled timer still lands on the real value.
    let timer: ReturnType<typeof setTimeout>;
    const begin = Date.now() + delay;
    const step = () => {
      const t = Math.min(1, Math.max(0, (Date.now() - begin) / duration));
      setShown(Math.round(value * (1 - Math.pow(1 - t, 3))));
      if (t < 1) timer = setTimeout(step, 16);
    };
    timer = setTimeout(step, delay);
    return () => clearTimeout(timer);
  }, [value, duration, delay]);
  return <>{money ? RUPEES.format(shown) : PLAIN.format(shown)}</>;
}
