/** Copy of server/src/utils/money.ts (no server dependencies). Keep the two in step. */
export function inr(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const amount = Math.abs(value);
  const short = (n: number) => String(Number(n.toFixed(2)));
  // Indian short form: ₹30 L, ₹1.25 Cr. Amounts under a lakh stay in full (₹94,500).
  if (amount >= 1e7) return `${sign}₹${short(amount / 1e7)} Cr`;
  if (amount >= 1e5) return `${sign}₹${short(amount / 1e5)} L`;
  return `${sign}${inrFull(amount)}`;
}

/** Exact rupees with Indian grouping, for forms and tooltips: ₹30,00,000. */
export function inrFull(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return "—";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}
