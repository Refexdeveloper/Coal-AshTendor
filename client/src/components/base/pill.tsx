import type { Tone } from "@client/lib/labels";

export function Pill({ label, tone = "neutral" }: { label: string; tone?: Tone }) {
  return <span className={`pill ${tone}`}>{label}</span>;
}

export function Status({
  map,
  value,
}: {
  map: Record<string, { label: string; tone: Tone }>;
  value: string;
}) {
  const item = map[value] ?? { label: value || "—", tone: "neutral" as Tone };
  return <Pill label={item.label} tone={item.tone} />;
}
