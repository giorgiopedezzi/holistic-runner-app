interface BadgeProps { label: string; color: string; }

export function Badge({ label, color }: BadgeProps) {
  return (
    <span style={{
      display:       "inline-block",
      fontSize:      11,
      fontWeight:    600,
      padding:       "2px 9px",
      borderRadius:  20,
      background:    `${color}22`,
      color,
      letterSpacing: "0.04em",
      textTransform: "uppercase",
    }}>
      {label}
    </span>
  );
}
