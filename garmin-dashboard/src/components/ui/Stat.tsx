import { Card } from "./Card";
import { Label } from "./Label";

interface StatProps {
  label:  string;
  value:  string | number;
  sub?:   string;
  accent?: string;
}

// Splits a formatted "68.36 km" into a value/unit pair so the unit can render
// as a smaller inline span — purely presentational (the number itself is
// untouched, still whatever fmt.ts already computed), fixes the unit token
// wrapping onto its own line inside a narrow StatGrid column. Falls through
// unchanged for anything that isn't "<digits> <unit-word>" (plain counts,
// already-split values like the hero ring's "4.0 h").
export function splitUnit(value: string | number): { main: string; unit?: string } {
  if (typeof value !== "string") return { main: String(value) };
  const m = value.match(/^(.*\d)\s+([a-zA-Zµ%/]+)$/);
  if (!m) return { main: value };
  return { main: m[1], unit: m[2] };
}

export function Stat({ label, value, sub, accent }: StatProps) {
  const { main, unit } = splitUnit(value);
  return (
    <Card className="hra-lift">
      <Label style={{ marginBottom: 8 }}>{label}</Label>
      <div style={{ fontSize: 30, fontWeight: 700, letterSpacing: "-0.02em", color: accent ?? "var(--text-primary)", lineHeight: 1, whiteSpace: "nowrap" }}>
        {main}
        {unit && <span style={{ fontSize: 16, fontWeight: 500, color: "var(--text-muted)" }}> {unit}</span>}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
          {sub}
        </div>
      )}
    </Card>
  );
}
