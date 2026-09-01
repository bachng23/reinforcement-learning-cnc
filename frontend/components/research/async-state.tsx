"use client";

import { AlertTriangle, Inbox, LoaderCircle, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type AsyncStateKind = "loading" | "error" | "empty";

export type AsyncStateProps = {
  kind: AsyncStateKind;
  title?: string;
  description?: string;
  onRetry?: () => void;
  retryLabel?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
};

const DEFAULT_COPY: Record<AsyncStateKind, { title: string; description: string }> = {
  loading: {
    title: "Loading",
    description: "The latest data is being requested.",
  },
  error: {
    title: "Unable to load data",
    description: "The request did not complete. Try again when you are ready.",
  },
  empty: {
    title: "Nothing to show",
    description: "No records are available for this view.",
  },
};

function StateIcon({ kind }: { kind: AsyncStateKind }) {
  const sharedClassName = "h-5 w-5";

  if (kind === "loading") {
    return <LoaderCircle className={cn(sharedClassName, "animate-spin motion-reduce:animate-none")} aria-hidden="true" />;
  }

  if (kind === "error") {
    return <AlertTriangle className={sharedClassName} aria-hidden="true" />;
  }

  return <Inbox className={sharedClassName} aria-hidden="true" />;
}

export function AsyncState({
  kind,
  title = DEFAULT_COPY[kind].title,
  description = DEFAULT_COPY[kind].description,
  onRetry,
  retryLabel = "Try again",
  action,
  className,
  compact = false,
}: AsyncStateProps) {
  const isError = kind === "error";

  return (
    <section
      className={cn(
        "flex w-full flex-col items-center justify-center rounded-lg border bg-white text-center",
        compact ? "min-h-40 px-4 py-6" : "min-h-64 px-5 py-10 sm:px-8",
        isError ? "border-rose-200" : "border-[var(--color-stone-border)]",
        className,
      )}
      role={isError ? "alert" : "status"}
      aria-live={isError ? "assertive" : "polite"}
      aria-busy={kind === "loading"}
    >
      <span
        className={cn(
          "grid h-10 w-10 place-items-center rounded-full",
          kind === "loading" && "bg-blue-50 text-blue-600",
          kind === "error" && "bg-rose-50 text-rose-600",
          kind === "empty" && "bg-stone-100 text-stone-600",
        )}
      >
        <StateIcon kind={kind} />
      </span>

      <h2 className="mt-3 text-sm font-semibold text-[var(--color-slate-text)]">{title}</h2>
      <p className="mt-1 max-w-md break-words text-sm text-[var(--color-ash-gray)]">{description}</p>

      {(onRetry || action) && kind !== "loading" ? (
        <div className="mt-5 flex max-w-full flex-wrap items-center justify-center gap-2">
          {onRetry ? (
            <button
              type="button"
              onClick={onRetry}
              className={cn(
                "inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-4 py-2",
                "bg-[var(--color-slate-text)] text-sm font-medium text-white",
                "transition-colors hover:bg-[var(--color-ghost-ink)]",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-chartwell-blue)] focus-visible:ring-offset-2",
              )}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {retryLabel}
            </button>
          ) : null}
          {action}
        </div>
      ) : null}
    </section>
  );
}

export type LoadingStateProps = Omit<AsyncStateProps, "kind" | "onRetry" | "retryLabel">;
export type EmptyStateProps = Omit<AsyncStateProps, "kind">;
export type ErrorStateProps = Omit<AsyncStateProps, "kind">;

export function LoadingState(props: LoadingStateProps) {
  return <AsyncState kind="loading" {...props} />;
}

export function EmptyState(props: EmptyStateProps) {
  return <AsyncState kind="empty" {...props} />;
}

export function ErrorState(props: ErrorStateProps) {
  return <AsyncState kind="error" {...props} />;
}
