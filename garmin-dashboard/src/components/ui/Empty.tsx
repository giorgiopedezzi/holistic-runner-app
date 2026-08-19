export function Empty({ message = "No data in this range." }: { message?: string }) {
  return (
    <div className="hra-text-muted" style={{ padding: "40px 0", textAlign: "center", fontSize: 14 }}>
      {message}
    </div>
  );
}
