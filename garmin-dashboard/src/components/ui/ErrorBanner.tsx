export function ErrorBanner({ message }: { message: string }) {
  return (
    <div style={{
      background:   "#e85a2a18",
      border:       "1px solid #e85a2a44",
      borderRadius: "var(--radius-md)",
      padding:      "14px 16px",
      color:        "#e85a2a",
      fontSize:     13,
    }}>
      {message}
    </div>
  );
}
