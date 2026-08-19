export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="hra-error-banner">
      {message}
    </div>
  );
}
