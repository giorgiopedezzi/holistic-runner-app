import { Card } from "./Card";
import { Label } from "./Label";

interface StatProps {
  label:  string;
  value:  string | number;
  sub?:   string;
  accent?: string;
}

export function Stat({ label, value, sub, accent }: StatProps) {
  return (
    <Card>
      <Label style={{ marginBottom: 6 }}>{label}</Label>
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
