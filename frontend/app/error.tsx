"use client";

import { useEffect } from "react";

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
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--color-canvas-fog)",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 480,
          width: "100%",
          background: "var(--color-cloud-white)",
          border: "1px solid var(--color-stone-border)",
          borderRadius: 12,
          padding: "32px 28px",
          textAlign: "center",
          boxShadow: "var(--shadow-md)",
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            margin: "0 auto 16px",
            borderRadius: "50%",
            background: "var(--color-rose-tint)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
          }}
        >
          ⚠️
        </div>
        <h1 style={{ fontSize: 18, fontWeight: 600, color: "var(--color-slate-text)", margin: "0 0 8px" }}>
          Something went wrong
        </h1>
        <p style={{ fontSize: 13, color: "var(--color-ash-gray)", margin: "0 0 20px", lineHeight: 1.5 }}>
          An unexpected error occurred while loading this page.
          {error.digest && (
            <>
              <br />
              <code style={{ fontSize: 11, color: "var(--color-steel-gray)" }}>ref: {error.digest}</code>
            </>
          )}
        </p>
        <button
          onClick={reset}
          style={{
            padding: "8px 20px",
            borderRadius: 8,
            border: "none",
            background: "var(--color-chartwell-blue)",
            color: "white",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
