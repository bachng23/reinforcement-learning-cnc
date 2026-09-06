import type { EpisodeStatus, ExperimentStatus } from "@/types/product-api";
import { cn } from "@/lib/utils";

export type ResearchStatus = EpisodeStatus | ExperimentStatus;

export type StatusBadgeProps<Status extends string = ResearchStatus> = {
  status: Status;
  className?: string;
};

const STATUS_TONES: Record<string, { badge: string; dot: string }> = {
  DRAFT: {
    badge: "border-stone-200 bg-stone-50 text-stone-700",
    dot: "bg-stone-400",
  },
  PENDING: {
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  QUEUED: {
    badge: "border-amber-200 bg-amber-50 text-amber-800",
    dot: "bg-amber-500",
  },
  READY: {
    badge: "border-sky-200 bg-sky-50 text-sky-800",
    dot: "bg-sky-500",
  },
  RUNNING: {
    badge: "border-blue-200 bg-blue-50 text-blue-800",
    dot: "bg-blue-500",
  },
  COMPLETED: {
    badge: "border-emerald-200 bg-emerald-50 text-emerald-800",
    dot: "bg-emerald-500",
  },
  FAILED: {
    badge: "border-rose-200 bg-rose-50 text-rose-800",
    dot: "bg-rose-500",
  },
  CANCELLED: {
    badge: "border-stone-300 bg-stone-100 text-stone-700",
    dot: "bg-stone-500",
  },
};

const FALLBACK_TONE = {
  badge: "border-stone-200 bg-white text-stone-700",
  dot: "bg-stone-400",
};

/**
 * Displays the wire status verbatim. Color is only a visual aid; unknown future
 * statuses intentionally fall back to a neutral treatment without changing text.
 */
export function StatusBadge<Status extends string = ResearchStatus>({
  status,
  className,
}: StatusBadgeProps<Status>) {
  const tone = STATUS_TONES[status.toUpperCase()] ?? FALLBACK_TONE;

  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1",
        "text-xs font-semibold leading-none tracking-wide",
        tone.badge,
        className,
      )}
      title={status}
    >
      <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", tone.dot)} aria-hidden="true" />
      <span className="min-w-0 break-all">{status}</span>
    </span>
  );
}
