// Persistent, non-blocking notice (HRA-249) — same shape as ErrorBanner but
// the accent-orange "warning" language, not the red "error" one: this isn't
// a failure, just something the user should know while they keep working.
export function WarningBanner({ message }: { message: string }) {
  return (
    <div className="hra-warning-banner">
      {message}
    </div>
  );
}
