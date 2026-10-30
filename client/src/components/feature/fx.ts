/**
 * Click effects for dashboard cards, after the P2P dashboard: each KPI card plays a short
 * animation that matches what it counts, and buttons and tabs get a ripple.
 * Styles live in globals.css under "click effects".
 */

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

const EMBER_COLORS = ["#ea580c", "#fb923c", "#fbbf24", "#34d399", "#0c9f68", "#f472b6", "#44403c", "#fde68a"];

const MOTIONS: Record<string, { frames: Keyframe[]; easing: string }> = {
  "fx-bounce": {
    frames: [{ transform: "scale(1)" }, { transform: "scale(0.93)", offset: 0.25 }, { transform: "scale(1.05)", offset: 0.55 }, { transform: "scale(0.99)", offset: 0.8 }, { transform: "scale(1)" }],
    easing: "cubic-bezier(0.3, 1.4, 0.5, 1)",
  },
  "fx-breathe": {
    frames: [{ transform: "scale(1)" }, { transform: "scale(1.03)", offset: 0.25 }, { transform: "scale(0.99)", offset: 0.5 }, { transform: "scale(1.02)", offset: 0.75 }, { transform: "scale(1)" }],
    easing: "ease-in-out",
  },
  "fx-shake": {
    frames: [
      { transform: "translateX(0)" },
      { transform: "translateX(-3px)", offset: 0.1 },
      { transform: "translateX(6px) rotate(0.8deg)", offset: 0.25 },
      { transform: "translateX(-8px) rotate(-1.2deg)", offset: 0.4 },
      { transform: "translateX(8px) rotate(1.2deg)", offset: 0.55 },
      { transform: "translateX(-5px) rotate(-0.6deg)", offset: 0.7 },
      { transform: "translateX(3px)", offset: 0.85 },
      { transform: "translateX(0)" },
    ],
    easing: "cubic-bezier(0.36, 0.07, 0.19, 0.97)",
  },
};

/** Squash, breathe or shake the card itself, layered on whatever transform it already has. */
function pulseClass(el: HTMLElement, cls: string, ms: number) {
  const motion = MOTIONS[cls];
  if (!motion) return;
  el.animate(motion.frames, { duration: ms * 0.93, easing: motion.easing, composite: "add" });
}

/** Colours of the card being clicked (its --c / --c2), so effects match the card. Ember by default. */
let tint = { c: "#ea580c", c2: "#fb923c" };
function readTint(el: HTMLElement) {
  const style = getComputedStyle(el);
  const c = style.getPropertyValue("--c").trim() || style.getPropertyValue("--c1").trim();
  const c2 = style.getPropertyValue("--c2").trim();
  tint = { c: c || "#ea580c", c2: c2 || c || "#fb923c" };
}

/** Fixed overlay positioned over `el` that removes itself after `ms`. */
function overlayOn(el: HTMLElement, className: string, html: string, ms: number) {
  const r = el.getBoundingClientRect();
  const o = document.createElement("div");
  o.className = `fx-ov ${className}`;
  o.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;--fx-c:${tint.c};--fx-c2:${tint.c2}`;
  o.innerHTML = html;
  document.body.appendChild(o);
  window.setTimeout(() => o.remove(), ms);
  return r;
}

/** Burst of ember-coloured confetti from the centre of `el`. */
export function confetti(el: Element, pieces = 60, colors = EMBER_COLORS) {
  if (reducedMotion()) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  for (let i = 0; i < pieces; i++) {
    const c = document.createElement("i");
    c.className = "fx-confetti";
    c.style.background = colors[i % colors.length];
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
    d.style.cssText = `--fx-c:${tint.c};--fx-c2:${tint.c2}`;
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

/** A fixed element at a viewport point that removes itself when its animation ends. */
function burstAt(className: string, x: number, y: number, frames: Keyframe[], options: KeyframeAnimationOptions, html = "") {
  const node = document.createElement("i");
  node.className = className;
  node.style.cssText = `left:${x}px;top:${y}px;--fx-c:${tint.c};--fx-c2:${tint.c2}`;
  node.innerHTML = html;
  document.body.appendChild(node);
  node.animate(frames, { fill: "backwards", ...options }).onfinish = () => node.remove();
  return node;
}

/**
 * Shared click impact for the dashboard cards: a shockwave and sparks from the exact click point,
 * a light sweep across the card, and the icon tile and number popping.
 */
export function impactFx(el: HTMLElement, point?: { x: number; y: number }) {
  if (reducedMotion()) return;
  const r = el.getBoundingClientRect();
  const x = point && point.x ? point.x : r.left + r.width / 2;
  const y = point && point.y ? point.y : r.top + r.height / 2;
  const reach = Math.max(r.width, r.height) * 1.6;

  burstAt("fx-shock", x, y, [
    { transform: "translate(-50%,-50%) scale(0)", opacity: 0.9 },
    { transform: `translate(-50%,-50%) scale(${reach / 40})`, opacity: 0 },
  ], { duration: 750, easing: "cubic-bezier(.2,.8,.2,1)" });
  burstAt("fx-shock fill", x, y, [
    { transform: "translate(-50%,-50%) scale(0)", opacity: 0.55 },
    { transform: `translate(-50%,-50%) scale(${reach / 70})`, opacity: 0 },
  ], { duration: 600, easing: "ease-out" });

  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2 + Math.random() * 0.3;
    const distance = 46 + Math.random() * 60;
    const deg = (angle * 180) / Math.PI;
    burstAt(`fx-spark${i % 3 === 0 ? " white" : ""}`, x, y, [
      { transform: `translate(-50%,-50%) rotate(${deg}deg) translateX(0) scaleX(1.6)`, opacity: 1 },
      { transform: `translate(-50%,-50%) rotate(${deg}deg) translateX(${distance}px) scaleX(0.3)`, opacity: 0 },
    ], { duration: 520 + Math.random() * 260, delay: Math.random() * 60, easing: "cubic-bezier(.1,.8,.3,1)" });
  }

  overlayOn(el, "fx-sweep", "<i></i>", 900);

  el.querySelector<HTMLElement>(".dk-card-icon")?.animate(
    [
      { transform: "scale(1) rotate(0)" },
      { transform: "scale(1.38) rotate(-16deg)", offset: 0.3 },
      { transform: "scale(0.9) rotate(10deg)", offset: 0.6 },
      { transform: "scale(1.06) rotate(-3deg)", offset: 0.8 },
      { transform: "scale(1) rotate(0)" },
    ],
    { duration: 800, easing: "cubic-bezier(.3,1.3,.5,1)" },
  );
  el.querySelector<HTMLElement>("b")?.animate(
    [{ transform: "scale(1)", filter: "none" }, { transform: "scale(1.18)", filter: `drop-shadow(0 6px 14px ${tint.c})`, offset: 0.35 }, { transform: "scale(1)", filter: "none" }],
    { duration: 700, easing: "cubic-bezier(.3,1.4,.5,1)" },
  );
}

const PLANE_SVG =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2.5 11.2 21 3.5l-4.6 17-5.3-5.1-3.4 3.1.6-4.9 9.3-8.8-11.2 7.5z"/></svg>';

/** Bids submitted: paper planes take off from the card toward the portal, leaving a trail. */
export function sendFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-bounce", 700);
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width * 0.3;
  const cy = r.top + r.height * 0.6;
  for (let i = 0; i < 7; i++) {
    const lift = 120 + Math.random() * 140;
    const run = 220 + Math.random() * 220;
    const wobble = (Math.random() - 0.5) * 80;
    for (let ghost = 0; ghost < 3; ghost++) {
      burstAt(`fx-plane${ghost ? " ghost" : ""}`, cx, cy, [
        { transform: "translate(-50%,-50%) scale(.3) rotate(10deg)", opacity: 0 },
        { transform: `translate(calc(-50% + ${run * 0.35}px), calc(-50% - ${lift * 0.5 + wobble}px)) scale(1) rotate(-12deg)`, opacity: ghost ? 0.35 / ghost : 1, offset: 0.35 },
        { transform: `translate(calc(-50% + ${run}px), calc(-50% - ${lift}px)) scale(.7) rotate(-28deg)`, opacity: 0 },
      ], { duration: 1100, delay: i * 70 + ghost * 45, easing: "cubic-bezier(.3,.7,.3,1)" }, PLANE_SVG);
    }
  }
  overlayOn(el, "fx-glow-ring", "<i></i>", 1100);
}

/** Awarded: golden rays spin behind a rising trophy, with gold and green confetti. */
export function awardFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-bounce", 700);
  overlayOn(el, "fx-award", `<i class="fx-rays"></i><div class="fx-trophy-badge" aria-hidden>🏆</div><i class="fx-star s1">✦</i><i class="fx-star s2">✦</i><i class="fx-star s3">✦</i>`, 1600);
  confetti(el, 70, ["#fbbf24", "#f59e0b", "#10b981", "#34d399", "#fde68a", "#ffffff", "#059669"]);
}

/** Lost: the card shakes, a red stamp slams down and shards fall away. */
export function lostFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-shake", 700);
  const rect = overlayOn(
    el,
    "fx-lost",
    `<div class="fx-stamp"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M7 7l10 10M17 7 7 17"/></svg><span>Not awarded</span></div>`,
    1500,
  );
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  for (let i = 0; i < 14; i++) {
    const dx = (Math.random() - 0.5) * 220;
    const spin = (Math.random() - 0.5) * 540;
    burstAt("fx-shard", cx + (Math.random() - 0.5) * 60, cy, [
      { transform: "translate(-50%,-50%) rotate(0) scale(.4)", opacity: 0 },
      { transform: `translate(calc(-50% + ${dx * 0.4}px), calc(-50% - ${30 + Math.random() * 40}px)) rotate(${spin / 3}deg) scale(1)`, opacity: 1, offset: 0.3 },
      { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${180 + Math.random() * 120}px)) rotate(${spin}deg) scale(.8)`, opacity: 0 },
    ], { duration: 1100 + Math.random() * 400, delay: 220 + i * 15, easing: "cubic-bezier(.3,.1,.6,1)" });
  }
}

/** In evaluation: an hourglass flips with falling sand inside expanding rings. */
export function hourglassFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-breathe", 1400);
  overlayOn(
    el,
    "fx-hourglass",
    `<i class="fx-ring r1"></i><i class="fx-ring r2"></i><i class="fx-ring r3"></i>
     <div class="fx-glass">
       <svg viewBox="0 0 48 48"><path class="frame" d="M12 6h24M12 42h24M14 6c0 10 20 10 20 18S14 32 14 42M34 6c0 10-20 10-20 18s20 8 20 18"/><path class="sand top" d="M17 11h14c-2 5-12 5-14 0z"/><path class="sand bottom" d="M16 40c2-6 14-6 16 0z"/><line class="stream" x1="24" y1="22" x2="24" y2="36"/></svg>
     </div>
     <span class="fx-dots"><b></b><b></b><b></b></span>`,
    1700,
  );
}

/** Win rate: a target pops up and an arrow flies in to the bullseye. */
export function targetFx(el: HTMLElement) {
  if (reducedMotion()) return;
  pulseClass(el, "fx-bounce", 700);
  overlayOn(
    el,
    "fx-target",
    `<div class="fx-board">
       <svg viewBox="0 0 64 64"><circle cx="32" cy="32" r="28" class="o1"/><circle cx="32" cy="32" r="20" class="o2"/><circle cx="32" cy="32" r="12" class="o3"/><circle cx="32" cy="32" r="5" class="o4"/></svg>
       <svg class="fx-arrow" viewBox="0 0 64 16"><path d="M2 8h50" /><path d="M52 3l9 5-9 5z" class="tip"/><path d="M2 8l-0 0M4 3l6 5-6 5M10 3l6 5-6 5" class="fletch"/></svg>
       <i class="fx-hit"></i>
     </div>`,
    1700,
  );
  window.setTimeout(() => confetti(el, 30, [tint.c, tint.c2, "#ffffff", "#fbbf24"]), 520);
}

export type CardFx = "docs" | "pending" | "gears" | "ready" | "overdue" | "coins" | "shield" | "trophy" | "pulse" | "send" | "award" | "lost" | "hourglass" | "target";

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
  send: sendFx,
  award: awardFx,
  lost: lostFx,
  hourglass: hourglassFx,
  target: targetFx,
};

/** Plays the card's effect; returns how long to wait before navigating so it can be seen. */
export function playCardFx(kind: CardFx, el: HTMLElement, point?: { x: number; y: number }) {
  if (reducedMotion()) return 0;
  readTint(el);
  if (el.classList.contains("dk-card")) impactFx(el, point);
  CARD_FX[kind](el);
  return kind === "pulse" ? 380 : kind === "ready" || kind === "trophy" || kind === "award" ? 520 : 800;
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
