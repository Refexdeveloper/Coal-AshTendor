/**
 * Click effects for dashboard cards, after the P2P dashboard: each KPI card plays a short
 * animation that matches what it counts, and buttons and tabs get a ripple.
 * Styles live in globals.css under "click effects".
 */

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const EMBER_COLORS = ["#ea580c", "#fb923c", "#fbbf24", "#34d399", "#0c9f68", "#f472b6", "#44403c", "#fde68a"];

/** Restartable CSS class on the card itself. */
function pulseClass(el: HTMLElement, cls: string, ms: number) {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

/** Fixed overlay positioned over `el` that removes itself after `ms`. */
function overlayOn(el: HTMLElement, className: string, html: string, ms: number) {
  const r = el.getBoundingClientRect();
  const o = document.createElement("div");
  o.className = `fx-ov ${className}`;
  o.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
  o.innerHTML = html;
  document.body.appendChild(o);
  window.setTimeout(() => o.remove(), ms);
  return r;
}

/** Burst of ember-coloured confetti from the centre of `el`. */
export function confetti(el: Element, pieces = 60) {
  if (reducedMotion()) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < pieces; i++) {
    const c = document.createElement("i");
    c.className = "fx-confetti";
    c.style.background = EMBER_COLORS[i % EMBER_COLORS.length];
    if (i % 3 === 0) c.style.borderRadius = "50%";
    document.body.appendChild(c);
    const a = Math.random() * Math.PI * 2;
    const v = 120 + Math.random() * 220;
    const dx = Math.cos(a) * v;
    const dy = Math.sin(a) * v - 160;
    const rot = Math.random() * 720 - 360;
    c.animate(
      [
        { transform: `translate(${cx}px,${cy}px) rotate(0)`, opacity: 1 },
        { transform: `translate(${cx + dx}px,${cy + dy}px) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${cx + dx * 1.2}px,${cy + dy + 360}px) rotate(${rot}deg)`, opacity: 0 },
      ],
      { duration: 1300 + Math.random() * 700, easing: "cubic-bezier(.2,.7,.4,1)" },
    ).onfinish = () => c.remove();
  }
}

const DOC_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2.5H7A2.5 2.5 0 0 0 4.5 5v14A2.5 2.5 0 0 0 7 21.5h10a2.5 2.5 0 0 0 2.5-2.5V8z"/><path d="M14 2.5V8h5.5M8.5 13h7M8.5 17h5"/></svg>';

/** Total tenders: a deck of tender notices fans out of the card and settles back. */
export function docsFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-bounce", 700);
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const n = 9;
  for (let i = 0; i < n; i++) {
    const d = document.createElement("div");
    d.className = "fx-doc";
    d.innerHTML = DOC_SVG;
    document.body.appendChild(d);
    const ang = (-150 + (120 / (n - 1)) * i) * (Math.PI / 180);
    const dist = 120 + (i % 2) * 40;
    const x = Math.cos(ang) * dist;
    const y = Math.sin(ang) * dist;
    const rot = (i - (n - 1) / 2) * 12;
    d.animate(
      [
        { transform: `translate(${cx}px,${cy}px) translate(-50%,-50%) scale(.3) rotate(0)`, opacity: 0 },
        { transform: `translate(${cx + x}px,${cy + y}px) translate(-50%,-50%) scale(1) rotate(${rot}deg)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${cx + x * 1.05}px,${cy + y * 1.05}px) translate(-50%,-50%) scale(1) rotate(${rot}deg)`, opacity: 1, offset: 0.7 },
        { transform: `translate(${cx}px,${cy}px) translate(-50%,-50%) scale(.2) rotate(${rot * 2}deg)`, opacity: 0 },
      ],
      { duration: 1400, delay: i * 35, easing: "cubic-bezier(.3,1.3,.5,1)", fill: "backwards" },
    ).onfinish = () => d.remove();
  }
  overlayOn(el, "fx-glow-ring", "<i></i>", 1300);
}

/** Pending relevance: a clock with racing hands over expanding "waiting" radar rings. */
export function pendingFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-breathe", 1400);
  overlayOn(
    el,
    "fx-pending",
    `<i class="fx-ring r1"></i><i class="fx-ring r2"></i><i class="fx-ring r3"></i>
     <div class="fx-clock">
       <svg viewBox="0 0 48 48">
         <circle cx="24" cy="24" r="20" class="face"/>
         ${Array.from({ length: 12 }, (_, i) => `<line class="tick" x1="24" y1="6.5" x2="24" y2="${i % 3 === 0 ? 10 : 8.5}" transform="rotate(${i * 30} 24 24)"/>`).join("")}
         <line class="hand h" x1="24" y1="24" x2="24" y2="14"/>
         <line class="hand m" x1="24" y1="24" x2="24" y2="9"/>
         <circle cx="24" cy="24" r="2.2" class="pin"/>
       </svg>
       <span class="fx-dots"><b></b><b></b><b></b></span>
     </div>`,
    1600,
  );
}

/** In progress: two meshed gears (costing and EMD) spin up together. */
export function gearsFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-bounce", 700);
  overlayOn(
    el,
    "fx-gears",
    `<div class="fx-gear-pair">
       <svg class="g g1" viewBox="0 0 48 48"><circle cx="24" cy="24" r="15" class="teeth"/><circle cx="24" cy="24" r="10" class="body"/><circle cx="24" cy="24" r="4" class="hub"/></svg>
       <svg class="g g2" viewBox="0 0 48 48"><circle cx="24" cy="24" r="15" class="teeth"/><circle cx="24" cy="24" r="10" class="body"/><circle cx="24" cy="24" r="4" class="hub"/></svg>
       <span class="fx-gear-lbl l1">Costing</span><span class="fx-gear-lbl l2">EMD</span>
     </div>`,
    1600,
  );
}

/** Overdue: an alarm clock rings with warning waves while the card shakes. */
export function overdueFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-shake", 700);
  overlayOn(
    el,
    "fx-overdue",
    `<i class="fx-wave v1"></i><i class="fx-wave v2"></i><i class="fx-wave v3"></i>
     <div class="fx-alarm">
       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.5 1.5M4 5l3-2.5M20 5l-3-2.5M7 20l-1.5 1.8M17 20l1.5 1.8"/></svg>
     </div>`,
    1500,
  );
}

/** Ready to bid: a check stamp lands and ember confetti bursts. */
export function readyFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-bounce", 700);
  overlayOn(
    el,
    "fx-ready",
    `<div class="fx-check"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg></div>`,
    1300,
  );
  confetti(el, 44);
}

/** Money cards: gold rupee coins burst out of the card and tumble down. */
export function coinsFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-bounce", 700);
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < 22; i++) {
    const coin = document.createElement("i");
    coin.className = "fx-coin";
    coin.textContent = "₹";
    document.body.appendChild(coin);
    const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
    const speed = 110 + Math.random() * 150;
    const dx = Math.cos(angle) * speed;
    const dy = Math.sin(angle) * speed;
    const spin = (Math.random() - 0.5) * 720;
    coin.animate(
      [
        { transform: `translate(${cx}px,${cy}px) scale(.4) rotateY(0)`, opacity: 0 },
        { transform: `translate(${cx + dx}px,${cy + dy}px) scale(1) rotateY(${spin / 2}deg)`, opacity: 1, offset: 0.4 },
        { transform: `translate(${cx + dx * 1.3}px,${cy + dy + 260}px) scale(.8) rotateY(${spin}deg)`, opacity: 0 },
      ],
      { duration: 1200 + Math.random() * 500, delay: i * 18, easing: "cubic-bezier(.2,.7,.4,1)", fill: "backwards" },
    ).onfinish = () => coin.remove();
  }
  overlayOn(el, "fx-glow-ring", "<i></i>", 1200);
}

/** EMD exposure: a shield pops up with protective rings. */
export function shieldFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-breathe", 1400);
  overlayOn(
    el,
    "fx-shield",
    `<i class="fx-ring r1"></i><i class="fx-ring r2"></i>
     <div class="fx-shield-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6z"/><path class="tick" d="m8.5 12 2.5 2.5 4.5-5"/></svg></div>`,
    1500,
  );
}

/** Win rate: a trophy lifts up and confetti bursts. */
export function trophyFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-bounce", 700);
  overlayOn(el, "fx-trophy", `<div class="fx-trophy-badge" aria-hidden>🏆</div>`, 1400);
  confetti(el, 50);
}

/** Small cards: a quick bounce and a glow ring. */
export function pulseFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-bounce", 700);
  overlayOn(el, "fx-glow-ring", "<i></i>", 1100);
}

export type CardFx = "docs" | "pending" | "gears" | "ready" | "overdue" | "coins" | "shield" | "trophy" | "pulse";

const CARD_FX: Record<CardFx, (el: HTMLElement) => void> = {
  docs: docsFx,
  pending: pendingFx,
  gears: gearsFx,
  ready: readyFx,
  overdue: overdueFx,
  coins: coinsFx,
  shield: shieldFx,
  trophy: trophyFx,
  pulse: pulseFx,
};

/** Plays the card's effect; returns how long to wait before navigating so it can be seen. */
export function playCardFx(kind: CardFx, el: HTMLElement) {
  if (reducedMotion()) return 0;
  CARD_FX[kind](el);
  return kind === "pulse" ? 380 : kind === "ready" || kind === "trophy" ? 500 : 750;
}

let rippleInstalled = false;

/** Adds a click ripple to any `.btn`, `.tab` or `.kpi` on the page. Installs once. */
export function installRipple() {
  if (rippleInstalled || typeof document === "undefined") return;
  rippleInstalled = true;
  document.addEventListener("pointerdown", (event) => {
    const el = (event.target as Element | null)?.closest<HTMLElement>(".btn, .tab, .kpi, .exec-kpi, .stage-key, .week-card");
    if (!el || (el as HTMLButtonElement).disabled || reducedMotion()) return;
    const r = el.getBoundingClientRect();
    const d = Math.max(r.width, r.height);
    const sp = document.createElement("span");
    sp.className = "fx-ripple";
    sp.style.cssText = `width:${d}px;height:${d}px;left:${event.clientX - r.left - d / 2}px;top:${event.clientY - r.top - d / 2}px`;
    el.appendChild(sp);
    window.setTimeout(() => sp.remove(), 650);
  });
}

/**
 * Smoothly scrolls `el` to the top of the viewport (respecting its scroll-margin-top).
 * Timer-driven rather than `behavior: "smooth"`, which some embedded browsers ignore.
 */
export function scrollToElement(el: HTMLElement, duration = 600) {
  const margin = parseFloat(getComputedStyle(el).scrollMarginTop) || 0;
  const start = window.scrollY;
  const maxY = document.documentElement.scrollHeight - window.innerHeight;
  const target = Math.max(0, Math.min(maxY, start + el.getBoundingClientRect().top - margin));
  if (reducedMotion() || Math.abs(target - start) < 2) {
    window.scrollTo(0, target);
    return;
  }
  const begin = Date.now();
  const step = () => {
    const t = Math.min(1, (Date.now() - begin) / duration);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    window.scrollTo(0, start + (target - start) * eased);
    if (t < 1) window.setTimeout(step, 16);
  };
  step();
}

const TOAST_ICONS = {
  ok: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  error: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg>',
};

/** Small dark toast in the bottom-right that dismisses itself. */
export function fxToast(message: string, type: "ok" | "error" = "ok") {
  let box = document.querySelector<HTMLDivElement>(".fx-toasts");
  if (!box) {
    box = document.createElement("div");
    box.className = "fx-toasts";
    box.setAttribute("role", "status");
    document.body.appendChild(box);
  }
  const toast = document.createElement("div");
  toast.className = `fx-toast ${type}`;
  const icon = document.createElement("span");
  icon.className = "fx-toast-ic";
  icon.innerHTML = TOAST_ICONS[type];
  const text = document.createElement("span");
  text.textContent = message;
  toast.append(icon, text);
  box.appendChild(toast);
  window.setTimeout(() => {
    toast.classList.add("out");
    window.setTimeout(() => toast.remove(), 300);
  }, 3600);
}
