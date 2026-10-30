export function LoadingState({
  message = 'Preparing your workspace',
  detail = 'Bringing your code into focus.',
}: {
  message?: string;
  detail?: string;
}) {
  return (
    <main className="loading-screen" role="status" aria-live="polite">
      <div className="loading-content">
        <div className="loading-orbit" aria-hidden="true">
          <div className="loading-mark">
            <span />
            <span />
            <span />
            <span />
          </div>
        </div>
        <p className="loading-eyebrow">CODEDNA</p>
        <h1>{message}</h1>
        <p className="loading-detail">{detail}</p>
        <div className="loading-progress" aria-hidden="true">
          <span />
        </div>
      </div>
    </main>
  );
}
