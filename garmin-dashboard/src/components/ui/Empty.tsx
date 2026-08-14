export function Empty({ message = "No data in this range." }: { message?: string }) {
  return (
    <div style={{ padding: "40px 0", textAlign: "center", color: "var(--text-muted)", fontSize: 14 }}>
      {message}
    </div>
  );
}
