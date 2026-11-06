"use client";
import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app/error] uncaught:", error);
  }, [error]);
  return (
    <main className="system-state">
      <div>
        <AlertTriangle size={32} aria-hidden="true" />
        <h1>Unable to open this page</h1>
        <p>An unexpected error occurred. Try loading the page again.</p>
        {error.digest && (
          <p className="page-footnote">
            Reference <code>{error.digest}</code>
          </p>
        )}
        <button type="button" onClick={reset} className="primary-action">
          Try again
        </button>
      </div>
    </main>
  );
}
