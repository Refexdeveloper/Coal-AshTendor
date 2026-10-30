/**
 * Cards lean toward the pointer and carry a spotlight under it.
 * One delegated listener feeds --rx/--ry (tilt) and --mx/--my (spotlight) to whichever card is hovered; CSS does the rest.
 */
const CARDS = ".kpi, .exec-kpi, .count-card, .dk-card, .fact, .week-card";
const MAX_TILT = 7;

export function installCardTilt() {
  if (typeof window === "undefined" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  let current: HTMLElement | null = null;

  const reset = (card: HTMLElement) => {
    card.style.removeProperty("--rx");
    card.style.removeProperty("--ry");
    card.style.removeProperty("--mx");
    card.style.removeProperty("--my");
  };

  document.addEventListener(
    "pointermove",
    (event) => {
      if (event.pointerType === "touch") return;
      const card = (event.target as Element | null)?.closest?.(CARDS) as HTMLElement | null;
      if (current && current !== card) reset(current);
      current = card;
      if (!card) return;
      const box = card.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      card.style.setProperty("--ry", `${((x - 0.5) * 2 * MAX_TILT).toFixed(2)}deg`);
      card.style.setProperty("--rx", `${((0.5 - y) * 2 * MAX_TILT).toFixed(2)}deg`);
      card.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
      card.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
    },
    { passive: true },
  );
  document.addEventListener("pointerleave", () => {
    if (current) reset(current);
    current = null;
  });
}
