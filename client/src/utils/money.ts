/** Copy of server/src/utils/money.ts (no server dependencies). Keep the two in step. */

/** Reads a rupee amount from a tender field such as "5000000" or "Rs. 50,00,000". */
export function parseInr(value: string) {
  if (!value || value === "Not Found in Document") return null;
  const letters = value.replace(/rs\.?|inr|₹/gi, "").replace(/[0-9.,\s]/g, "");
  if (letters.length) return null;
  const match = value.replace(/,/g, "").match(/(\d+(?:\.\d+)?)/);
  if (!match) return null;
  const amount = Number(match[1]);
  return Number.isFinite(amount) ? amount : null;
}

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
