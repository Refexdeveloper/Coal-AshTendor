/** Small display helpers that used to live in server modules. */

export function effectiveValue(field: { extractedValue: string; correctedValue: string; correctedAt: Date | null }) {
  if (field.correctedAt) return field.correctedValue;
  return field.extractedValue;
}

export function percent(part: number, total: number) {
  if (!total) return "—";
  return `${Math.round((part / total) * 100)}%`;
}
