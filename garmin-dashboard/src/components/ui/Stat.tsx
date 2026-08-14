import { Card } from "./Card";

interface StatProps {
  label:  string;
  value:  string | number;
  sub?:   string;
  accent?: string;
}

export function Stat({ label, value, sub, accent }: StatProps) {
  return (
    <Card>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        {label}
      </div>
      <div style={{ fontSize: 18, fontWeight: 600, color: accent ?? "var(--text-primary)", lineHeight: 1 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 4 }}>
          {sub}
        </div>
      )}
    </Card>
  );
}
