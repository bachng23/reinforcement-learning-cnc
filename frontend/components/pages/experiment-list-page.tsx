"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, FlaskConical, Plus, RefreshCw, UserRound } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { StatusBadge } from "@/components/research/status-badge";
import { getProductApiClient, productApiErrorMessage } from "@/lib/product-api";
import type {
  ExperimentListItem,
  PaginatedResponse,
  ProductApiClient,
} from "@/types/product-api";

const PAGE_SIZE = 8;

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function errorMessage(error: unknown) {
  return productApiErrorMessage(error, "Unable to load experiments.");
}

function ownerLabel(experiment: ExperimentListItem) {
  return experiment.owner?.display_name || experiment.owner?.username || "Not available";
}

function EpisodeCounts({ experiment }: { experiment: ExperimentListItem }) {
  const counts = experiment.episode_counts;
  const total = counts?.total ?? experiment.number_of_episodes;

  if (total === undefined) {
    return <span className="text-xs text-[var(--color-ash-gray)]">Episode counts unavailable</span>;
  }

  const entries = [
    ["COMPLETED", counts?.completed],
    ["RUNNING", counts?.running],
    ["PENDING", counts?.pending],
    ["FAILED", counts?.failed],
    ["CANCELLED", counts?.cancelled],
  ] as const;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
      <span className="font-semibold text-[var(--color-slate-text)]">{total} total</span>
      {entries.map(([label, value]) =>
        value === undefined ? null : (
          <span key={label} className="text-[var(--color-ash-gray)]">
            {value} {label.toLowerCase()}
          </span>
        ),
      )}
    </div>
  );
}

function ExperimentCard({ experiment }: { experiment: ExperimentListItem }) {
  return (
    <article className="group rounded-lg border border-[var(--color-stone-border)] bg-white p-4 shadow-[var(--shadow-subtle)] transition-shadow hover:shadow-[var(--shadow-md)] sm:p-5">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="break-words text-base font-semibold text-[var(--color-slate-text)]">
              {experiment.name}
            </h3>
            <StatusBadge status={experiment.status} />
          </div>
          {experiment.description ? (
            <p className="mt-2 line-clamp-2 text-sm text-[var(--color-ash-gray)]">
              {experiment.description}
            </p>
          ) : null}
        </div>
        <Link
          href={`/experiments/${encodeURIComponent(experiment.id)}`}
          aria-label={`Open ${experiment.name}`}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--color-stone-border)] text-[var(--color-ash-gray)] transition-colors group-hover:border-sky-200 group-hover:bg-sky-50 group-hover:text-sky-700"
        >
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      <dl className="mt-5 grid gap-3 border-t border-[var(--color-stone-border)] pt-4 sm:grid-cols-3">
        <div className="min-w-0">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ash-gray)]">Policy</dt>
          <dd className="mt-1 truncate text-sm text-[var(--color-slate-text)]" title={`${experiment.policy.name} ${experiment.policy.version}`}>
            {experiment.policy.name} <span className="font-mono text-xs text-[var(--color-ash-gray)]">v{experiment.policy.version}</span>
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ash-gray)]">
            <UserRound className="h-3 w-3" aria-hidden="true" /> Owner
          </dt>
          <dd className="mt-1 truncate text-sm text-[var(--color-slate-text)]" title={ownerLabel(experiment)}>
            {ownerLabel(experiment)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--color-ash-gray)]">
            <CalendarDays className="h-3 w-3" aria-hidden="true" /> Created
          </dt>
          <dd className="mt-1 truncate text-sm text-[var(--color-slate-text)]" title={experiment.created_at}>
            {formatDate(experiment.created_at)}
          </dd>
        </div>
      </dl>

      <div className="mt-4 rounded-md bg-[var(--color-canvas-fog)] px-3 py-2.5">
        <EpisodeCounts experiment={experiment} />
      </div>
    </article>
  );
}

type ListState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; response: PaginatedResponse<ExperimentListItem> };

export function ExperimentListPage({ api }: { api?: ProductApiClient } = {}) {
  const client = useMemo(() => api ?? getProductApiClient(), [api]);
  const [page, setPage] = useState(1);
  const [requestKey, setRequestKey] = useState(0);
  const [state, setState] = useState<ListState>({ kind: "loading" });

  const load = useCallback(() => setRequestKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });

    void client
      .listExperiments({ page, pageSize: PAGE_SIZE }, { signal: controller.signal })
      .then((response) => setState({ kind: "ready", response }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: errorMessage(error) });
      });

    return () => controller.abort();
  }, [client, page, requestKey]);

  return (
    <AppShell title="Experiments">
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-[var(--color-stone-border)] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--color-ash-gray)]">CNC contract v2.0</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-slate-text)]">Experiment workspace</h2>
            <p className="mt-2 max-w-2xl text-sm text-[var(--color-ash-gray)]">
              Create research runs, monitor their episodes, and inspect persisted engine outputs.
            </p>
          </div>
          <Link
            href="/experiments/new"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md bg-[var(--color-slate-text)] px-4 text-sm font-medium text-white transition-colors hover:bg-stone-800"
          >
            <Plus className="h-4 w-4" aria-hidden="true" /> New experiment
          </Link>
        </header>

        {state.kind === "loading" ? (
          <section aria-label="Loading experiments" aria-busy="true" className="grid gap-4 py-6 md:grid-cols-2">
            {[0, 1, 2, 3].map((item) => (
              <div key={item} className="h-48 animate-pulse rounded-lg border border-[var(--color-stone-border)] bg-white p-5">
                <div className="h-4 w-2/3 rounded bg-stone-200" />
                <div className="mt-4 h-3 w-full rounded bg-stone-100" />
                <div className="mt-12 h-12 rounded bg-stone-100" />
              </div>
            ))}
          </section>
        ) : state.kind === "error" ? (
          <section role="alert" className="my-8 rounded-lg border border-rose-200 bg-rose-50 p-6 text-center">
            <h3 className="font-semibold text-rose-900">Experiments could not be loaded</h3>
            <p className="mt-1 text-sm text-rose-700">{state.message}</p>
            <button type="button" onClick={load} className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-medium text-rose-800">
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
            </button>
          </section>
        ) : state.response.items.length === 0 ? (
          <section className="my-8 rounded-lg border border-dashed border-[var(--color-platinum-outline)] bg-white px-6 py-16 text-center">
            <FlaskConical className="mx-auto h-8 w-8 text-[var(--color-steel-gray)]" aria-hidden="true" />
            <h3 className="mt-4 font-semibold text-[var(--color-slate-text)]">No experiments yet</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-[var(--color-ash-gray)]">Create the first experiment to configure a policy and CNC environment.</p>
            <Link href="/experiments/new" className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-[var(--color-slate-text)] px-3 text-sm font-medium text-white">
              <Plus className="h-4 w-4" aria-hidden="true" /> Create experiment
            </Link>
          </section>
        ) : (
          <>
            <section className="grid gap-4 py-6 md:grid-cols-2" aria-label="Experiment results">
              {state.response.items.map((experiment) => (
                <ExperimentCard key={experiment.id} experiment={experiment} />
              ))}
            </section>
            <nav className="flex flex-col gap-3 border-t border-[var(--color-stone-border)] pt-5 text-sm sm:flex-row sm:items-center sm:justify-between" aria-label="Experiment pagination">
              <p className="text-[var(--color-ash-gray)]">
                Page <span className="font-medium text-[var(--color-slate-text)]">{state.response.page}</span> of {Math.max(1, state.response.total_pages)} · {state.response.total_items} experiments
              </p>
              <div className="flex gap-2">
                <button type="button" disabled={!state.response.has_previous} onClick={() => setPage((value) => Math.max(1, value - 1))} className="h-9 rounded-md border border-[var(--color-stone-border)] bg-white px-3 font-medium disabled:cursor-not-allowed disabled:opacity-45">Previous</button>
                <button type="button" disabled={!state.response.has_next} onClick={() => setPage((value) => value + 1)} className="h-9 rounded-md border border-[var(--color-stone-border)] bg-white px-3 font-medium disabled:cursor-not-allowed disabled:opacity-45">Next</button>
              </div>
            </nav>
          </>
        )}
      </main>
    </AppShell>
  );
}
