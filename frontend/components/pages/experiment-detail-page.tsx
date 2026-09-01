"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Clock3,
  GitBranch,
  Hash,
  ListChecks,
  RefreshCw,
  UserRound,
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { AsyncState } from "@/components/research/async-state";
import { EnvironmentConfigView } from "@/components/research/environment-config-view";
import { PageHeader } from "@/components/research/page-header";
import { StatusBadge } from "@/components/research/status-badge";
import { getProductApiClient } from "@/lib/product-api";
import type {
  EpisodeListItem,
  EpisodeStatus,
  ExperimentDetail,
  ExperimentOwner,
  ProductApiClient,
} from "@/types/product-api";

const DEFAULT_POLL_INTERVAL_MS = 4_000;
const TERMINAL_EPISODE_STATUSES: ReadonlySet<EpisodeStatus> = new Set<EpisodeStatus>([
  "COMPLETED",
  "FAILED",
  "CANCELLED",
]);

export function isTerminalEpisodeStatus(status: EpisodeStatus): boolean {
  return TERMINAL_EPISODE_STATUSES.has(status);
}

function shouldPollEpisodes(episodes: EpisodeListItem[]): boolean {
  return episodes.some(
    (episode) => episode.status === "PENDING" || episode.status === "RUNNING",
  );
}

function normalizeRouteParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function requestErrorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "The experiment could not be loaded.";
}

function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Not provided";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function Timestamp({ value }: { value: string | null | undefined }) {
  if (!value) return <span className="text-[var(--color-ash-gray)]">Not provided</span>;
  return (
    <time dateTime={value} title={value}>
      {formatTimestamp(value)}
    </time>
  );
}

function ownerLabel(owner: ExperimentOwner | null | undefined): string {
  return owner?.display_name || owner?.username || owner?.id || "Not provided";
}

function MetadataItem({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--color-stone-border)] bg-[var(--color-canvas-fog)] px-3 py-3">
      <dt className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ash-gray)]">
        {icon}
        {label}
      </dt>
      <dd className="mt-1.5 min-w-0 break-words text-sm text-[var(--color-slate-text)]">
        {children}
      </dd>
    </div>
  );
}

function PolicyReferenceView({ episode }: { episode: EpisodeListItem }) {
  return (
    <div className="min-w-0">
      <p className="break-words text-sm font-medium text-[var(--color-slate-text)]">
        {episode.policy.name}
      </p>
      <p className="mt-0.5 break-all font-mono text-xs text-[var(--color-ash-gray)]">
        {episode.policy.id} · {episode.policy.version}
      </p>
    </div>
  );
}

function FailureInformation({ episode }: { episode: EpisodeListItem }) {
  if (episode.status !== "FAILED" && !episode.failure) return null;

  if (!episode.failure) {
    return (
      <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-800">
        <p className="font-medium">No failure information was returned.</p>
      </div>
    );
  }

  const details =
    episode.failure.details === undefined
      ? null
      : JSON.stringify(episode.failure.details, null, 2);

  return (
    <div className="mt-4 min-w-0 rounded-md border border-rose-200 bg-rose-50 px-3 py-3 text-rose-900">
      <div className="flex items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
        <div className="min-w-0">
          <p className="break-words text-sm font-semibold">{episode.failure.message}</p>
          <dl className="mt-2 space-y-1 text-xs text-rose-800">
            {episode.failure.code ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-semibold">Code</dt>
                <dd className="break-all font-mono">{episode.failure.code}</dd>
              </div>
            ) : null}
            {episode.failure.occurred_at ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="font-semibold">Occurred</dt>
                <dd><Timestamp value={episode.failure.occurred_at} /></dd>
              </div>
            ) : null}
          </dl>
          {details ? (
            <pre className="mt-2 max-h-48 max-w-full overflow-auto whitespace-pre-wrap break-all rounded border border-rose-200 bg-white/70 p-2 text-[11px] leading-5 text-rose-900">
              {details}
            </pre>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function EpisodeCard({ episode }: { episode: EpisodeListItem }) {
  return (
    <article className="min-w-0 rounded-lg border border-[var(--color-stone-border)] bg-white p-4 shadow-[var(--shadow-subtle)] sm:p-5">
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 className="break-all font-mono text-sm font-semibold text-[var(--color-slate-text)]">
              {episode.id}
            </h3>
            <StatusBadge status={episode.status} />
          </div>
          {episode.key ? (
            <p className="mt-1 break-all text-xs text-[var(--color-ash-gray)]">
              Key: <span className="font-mono">{episode.key}</span>
            </p>
          ) : null}
        </div>

        <Link
          href={`/episodes/${encodeURIComponent(episode.id)}`}
          className="inline-flex min-h-9 shrink-0 items-center justify-center gap-2 self-start rounded-md border border-[var(--color-stone-border)] bg-white px-3 text-sm font-medium text-[var(--color-slate-text)] transition-colors hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-chartwell-blue)]"
          aria-label={`Open episode ${episode.id}`}
        >
          Open episode
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <dl className="mt-4 grid min-w-0 gap-3 border-t border-[var(--color-stone-border)] pt-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetadataItem label="Seed" icon={<Hash className="h-3.5 w-3.5" aria-hidden="true" />}>
          <span className="font-mono tabular-nums">{episode.seed}</span>
        </MetadataItem>
        <MetadataItem label="Policy" icon={<GitBranch className="h-3.5 w-3.5" aria-hidden="true" />}>
          <PolicyReferenceView episode={episode} />
        </MetadataItem>
        <MetadataItem label="Steps completed" icon={<ListChecks className="h-3.5 w-3.5" aria-hidden="true" />}>
          {episode.steps_completed === undefined ? (
            <span className="text-[var(--color-ash-gray)]">Not provided</span>
          ) : (
            <span className="font-mono tabular-nums">{episode.steps_completed}</span>
          )}
        </MetadataItem>
        <MetadataItem label="Total cost">
          {episode.total_cost === undefined || episode.total_cost === null ? (
            <span className="text-[var(--color-ash-gray)]">Not provided</span>
          ) : (
            <span className="font-mono tabular-nums">{episode.total_cost}</span>
          )}
        </MetadataItem>
      </dl>

      <dl className="mt-3 grid min-w-0 gap-x-5 gap-y-2 text-xs sm:grid-cols-2 lg:grid-cols-4">
        <div className="min-w-0">
          <dt className="font-semibold text-[var(--color-ash-gray)]">Created</dt>
          <dd className="mt-0.5 break-words text-[var(--color-slate-text)]"><Timestamp value={episode.created_at} /></dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-[var(--color-ash-gray)]">Started</dt>
          <dd className="mt-0.5 break-words text-[var(--color-slate-text)]"><Timestamp value={episode.started_at} /></dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-[var(--color-ash-gray)]">Completed</dt>
          <dd className="mt-0.5 break-words text-[var(--color-slate-text)]"><Timestamp value={episode.completed_at} /></dd>
        </div>
        <div className="min-w-0">
          <dt className="font-semibold text-[var(--color-ash-gray)]">Updated</dt>
          <dd className="mt-0.5 break-words text-[var(--color-slate-text)]"><Timestamp value={episode.updated_at} /></dd>
        </div>
      </dl>

      <FailureInformation episode={episode} />
    </article>
  );
}

function ExperimentContent({
  experiment,
  isRefreshing,
  pollingError,
  lastRefreshedAt,
  pollIntervalMs,
}: {
  experiment: ExperimentDetail;
  isRefreshing: boolean;
  pollingError: string | null;
  lastRefreshedAt: Date | null;
  pollIntervalMs: number;
}) {
  const pollingActive = shouldPollEpisodes(experiment.episodes);
  const allEpisodesTerminal =
    experiment.episodes.length > 0 &&
    experiment.episodes.every((episode) => isTerminalEpisodeStatus(episode.status));

  const countEntries: ReadonlyArray<readonly [string, number | undefined]> = experiment.episode_counts
    ? [
        ["Total", experiment.episode_counts.total],
        ["PENDING", experiment.episode_counts.pending],
        ["RUNNING", experiment.episode_counts.running],
        ["COMPLETED", experiment.episode_counts.completed],
        ["FAILED", experiment.episode_counts.failed],
        ["CANCELLED", experiment.episode_counts.cancelled],
      ] as const
    : [];

  return (
    <>
      <PageHeader
        title={experiment.name}
        description={experiment.description || "No description was provided for this experiment."}
        breadcrumbs={[
          { label: "Experiments", href: "/experiments" },
          { label: experiment.name },
        ]}
        eyebrow={<StatusBadge status={experiment.status} />}
      />

      <section className="mt-6 min-w-0 rounded-lg border border-[var(--color-stone-border)] bg-white p-4 sm:p-5" aria-labelledby="experiment-metadata-heading">
        <h2 id="experiment-metadata-heading" className="text-sm font-semibold text-[var(--color-slate-text)]">
          Experiment metadata
        </h2>
        <dl className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <MetadataItem label="Experiment ID" icon={<Hash className="h-3.5 w-3.5" aria-hidden="true" />}>
            <span className="break-all font-mono text-xs">{experiment.id}</span>
          </MetadataItem>
          <MetadataItem label="Owner" icon={<UserRound className="h-3.5 w-3.5" aria-hidden="true" />}>
            <span title={experiment.owner?.id}>{ownerLabel(experiment.owner)}</span>
          </MetadataItem>
          <MetadataItem label="Created" icon={<CalendarDays className="h-3.5 w-3.5" aria-hidden="true" />}>
            <Timestamp value={experiment.created_at} />
          </MetadataItem>
          <MetadataItem label="Updated" icon={<Clock3 className="h-3.5 w-3.5" aria-hidden="true" />}>
            <Timestamp value={experiment.updated_at} />
          </MetadataItem>
          <MetadataItem label="Policy" icon={<GitBranch className="h-3.5 w-3.5" aria-hidden="true" />}>
            <div className="min-w-0">
              <p className="break-words font-medium">{experiment.policy.name}</p>
              <p className="mt-0.5 break-all font-mono text-xs text-[var(--color-ash-gray)]">
                ID: {experiment.policy.id}
              </p>
            </div>
          </MetadataItem>
          <MetadataItem label="Policy version">
            <span className="break-all font-mono">{experiment.policy.version}</span>
          </MetadataItem>
          <MetadataItem label="Requested episodes">
            {experiment.number_of_episodes === undefined ? (
              <span className="text-[var(--color-ash-gray)]">Not provided</span>
            ) : (
              <span className="font-mono tabular-nums">{experiment.number_of_episodes}</span>
            )}
          </MetadataItem>
          <MetadataItem label="Experiment key">
            {experiment.key ? (
              <span className="break-all font-mono text-xs">{experiment.key}</span>
            ) : (
              <span className="text-[var(--color-ash-gray)]">Not provided</span>
            )}
          </MetadataItem>
        </dl>

        {countEntries.length ? (
          <div className="mt-4 flex flex-wrap gap-2 border-t border-[var(--color-stone-border)] pt-4" aria-label="Episode counts returned by the Product API">
            {countEntries.map(([label, value]) =>
              value === undefined ? null : (
                <span key={label} className="rounded-full border border-[var(--color-stone-border)] bg-[var(--color-canvas-fog)] px-2.5 py-1 text-xs text-[var(--color-ash-gray)]">
                  <span className="font-mono font-semibold tabular-nums text-[var(--color-slate-text)]">{value}</span>{" "}{label}
                </span>
              ),
            )}
          </div>
        ) : null}
      </section>

      <EnvironmentConfigView config={experiment.environment_config} className="mt-6" />

      <section className="mt-6 min-w-0" aria-labelledby="experiment-episodes-heading">
        <div className="flex min-w-0 flex-col gap-3 border-b border-[var(--color-stone-border)] pb-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <h2 id="experiment-episodes-heading" className="text-lg font-semibold text-[var(--color-slate-text)]">
              Episodes
            </h2>
            <p className="mt-1 text-sm text-[var(--color-ash-gray)]">
              {experiment.episodes.length} episode{experiment.episodes.length === 1 ? "" : "s"} returned by the Product API.
            </p>
          </div>

          <div className="min-w-0 text-xs text-[var(--color-ash-gray)]" aria-live="polite">
            {pollingActive ? (
              <p className="flex items-center gap-1.5">
                <RefreshCw className={`h-3.5 w-3.5 ${isRefreshing ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
                {isRefreshing
                  ? "Refreshing episode statuses…"
                  : `Polling every ${Math.round(pollIntervalMs / 1_000)}s while work is unfinished.`}
              </p>
            ) : allEpisodesTerminal ? (
              <p>All listed episodes are terminal. Automatic polling is stopped.</p>
            ) : null}
            {lastRefreshedAt ? (
              <p className="mt-1">
                Last refreshed: <time dateTime={lastRefreshedAt.toISOString()}>{formatTimestamp(lastRefreshedAt.toISOString())}</time>
              </p>
            ) : null}
          </div>
        </div>

        {pollingError ? (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900" role="status">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <p className="break-words">
              Live refresh failed: {pollingError} Existing experiment data remains available; polling will retry automatically.
            </p>
          </div>
        ) : null}

        {experiment.episodes.length === 0 ? (
          <AsyncState
            kind="empty"
            compact
            className="mt-4"
            title="No episodes returned"
            description="The Product API did not return any episodes for this experiment. No episode state has been inferred."
          />
        ) : (
          <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-2" aria-label="Experiment episodes">
            {experiment.episodes.map((episode) => (
              <EpisodeCard key={episode.id} episode={episode} />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

export type ExperimentDetailPageProps = {
  api?: ProductApiClient;
  pollIntervalMs?: number;
};

export function ExperimentDetailPage({
  api,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
}: ExperimentDetailPageProps = {}) {
  const params = useParams<{ experimentId: string | string[] }>();
  const experimentId = normalizeRouteParam(params?.experimentId);
  const client = useMemo(() => api ?? getProductApiClient(), [api]);
  const effectivePollInterval =
    Number.isFinite(pollIntervalMs) && pollIntervalMs > 0
      ? pollIntervalMs
      : DEFAULT_POLL_INTERVAL_MS;

  const [experiment, setExperiment] = useState<ExperimentDetail | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [initialError, setInitialError] = useState<string | null>(null);
  const [pollingError, setPollingError] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  const [requestVersion, setRequestVersion] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setExperiment(null);
    setInitialError(null);
    setPollingError(null);
    setLastRefreshedAt(null);

    if (!experimentId) {
      setInitialLoading(false);
      setInitialError("The experiment identifier is missing from the route.");
      return () => controller.abort();
    }

    setInitialLoading(true);
    void client
      .getExperiment(experimentId, { signal: controller.signal })
      .then((response) => {
        if (controller.signal.aborted) return;
        setExperiment(response);
        setLastRefreshedAt(new Date());
        setInitialLoading(false);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setInitialError(requestErrorMessage(error));
        setInitialLoading(false);
      });

    return () => controller.abort();
  }, [client, experimentId, requestVersion]);

  const pollingActive = Boolean(
    experiment && shouldPollEpisodes(experiment.episodes),
  );

  useEffect(() => {
    if (!experimentId || !pollingActive) {
      setIsRefreshing(false);
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeController: AbortController | null = null;

    const schedule = () => {
      timer = setTimeout(() => void poll(), effectivePollInterval);
    };

    const poll = async () => {
      const controller = new AbortController();
      activeController = controller;
      setIsRefreshing(true);

      let continuePolling = true;
      try {
        const response = await client.getExperiment(experimentId, {
          signal: controller.signal,
        });
        if (disposed || controller.signal.aborted) return;

        setExperiment(response);
        setPollingError(null);
        setLastRefreshedAt(new Date());
        continuePolling = shouldPollEpisodes(response.episodes);
      } catch (error: unknown) {
        if (disposed || controller.signal.aborted) return;
        setPollingError(requestErrorMessage(error));
      } finally {
        if (activeController === controller) activeController = null;
        if (!disposed) {
          setIsRefreshing(false);
          if (continuePolling) schedule();
        }
      }
    };

    schedule();

    return () => {
      disposed = true;
      if (timer !== undefined) clearTimeout(timer);
      activeController?.abort();
    };
  }, [client, effectivePollInterval, experimentId, pollingActive]);

  return (
    <AppShell title="Experiment details">
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {initialLoading ? (
          <AsyncState
            kind="loading"
            title="Loading experiment"
            description="Requesting experiment metadata, configuration, and episodes from the Product API."
          />
        ) : initialError || !experiment ? (
          <AsyncState
            kind="error"
            title="Experiment could not be loaded"
            description={initialError ?? "The Product API returned no experiment data."}
            onRetry={() => setRequestVersion((value) => value + 1)}
            retryLabel="Retry"
            action={
              <Link
                href="/experiments"
                className="inline-flex min-h-10 items-center justify-center rounded-md border border-[var(--color-stone-border)] bg-white px-4 py-2 text-sm font-medium text-[var(--color-slate-text)]"
              >
                Back to experiments
              </Link>
            }
          />
        ) : (
          <ExperimentContent
            experiment={experiment}
            isRefreshing={isRefreshing}
            pollingError={pollingError}
            lastRefreshedAt={lastRefreshedAt}
            pollIntervalMs={effectivePollInterval}
          />
        )}
      </main>
    </AppShell>
  );
}
