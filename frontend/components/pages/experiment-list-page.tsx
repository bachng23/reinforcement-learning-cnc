"use client";

import Link from "next/link";
import {
  ArrowDownUp,
  FlaskConical,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader } from "@/components/research/page-header";
import { DataNotice } from "@/components/research/data-notice";
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
  return (
    experiment.owner?.display_name ||
    experiment.owner?.username ||
    "Not available"
  );
}

function EpisodeCounts({ experiment }: { experiment: ExperimentListItem }) {
  const counts = experiment.episode_counts;
  const total = counts?.total ?? experiment.number_of_episodes;

  if (total === undefined) {
    return (
      <span className="text-[13px] text-[var(--color-ash-gray)]">
        Episode counts unavailable
      </span>
    );
  }

  const entries = [
    ["COMPLETED", counts?.completed],
    ["RUNNING", counts?.running],
    ["PENDING", counts?.pending],
    ["FAILED", counts?.failed],
    ["CANCELLED", counts?.cancelled],
  ] as const;

  return (
    <div className="episode-counts">
      <span className="font-semibold text-[var(--color-slate-text)]">
        <span className="numeric">{total}</span> total
      </span>
      <span className="episode-count-breakdown">
        {entries.map(([label, value]) =>
          value === undefined ? null : (
            <span key={label} className="text-[var(--color-ash-gray)]">
              <span className="numeric">{value}</span> {label.toLowerCase()}
            </span>
          ),
        )}
      </span>
    </div>
  );
}

function ExperimentRow({ experiment }: { experiment: ExperimentListItem }) {
  return (
    <tr>
      <th scope="row">
        <Link
          href={`/experiments/${encodeURIComponent(experiment.id)}`}
          aria-label={`Open ${experiment.name}`}
          className="experiment-name"
        >
          {experiment.name}
        </Link>
        {experiment.description && (
          <p className="register-description">{experiment.description}</p>
        )}
      </th>
      <td className="status-cell">
        <StatusBadge status={experiment.status} />
      </td>
      <td>
        <span>{experiment.policy.name}</span>
        <span className="cell-secondary">v{experiment.policy.version}</span>
      </td>
      <td className="episode-count-cell">
        <EpisodeCounts experiment={experiment} />
      </td>
      <td>
        <span>{ownerLabel(experiment)}</span>
        <time className="cell-secondary" dateTime={experiment.created_at}>
          {formatDate(experiment.created_at)}
        </time>
      </td>
    </tr>
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
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ALL");
  const [sort, setSort] = useState<"created" | "name">("created");
  const [ascending, setAscending] = useState(false);
  const visibleItems = useMemo(
    () =>
      state.kind !== "ready"
        ? []
        : state.response.items
            .filter(
              (item) =>
                (status === "ALL" || item.status === status) &&
                `${item.name} ${item.description ?? ""} ${item.policy.name} ${ownerLabel(item)}`
                  .toLowerCase()
                  .includes(search.trim().toLowerCase()),
            )
            .sort(
              (a, b) =>
                (ascending ? 1 : -1) *
                (sort === "name"
                  ? a.name.localeCompare(b.name)
                  : a.created_at.localeCompare(b.created_at)),
            ),
    [state, search, status, sort, ascending],
  );
  const changeSort = (key: "created" | "name") => {
    setSort(key);
    setAscending(sort === key ? !ascending : key === "name");
  };

  const load = useCallback(() => setRequestKey((value) => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    setState({ kind: "loading" });

    void client
      .listExperiments(
        { page, pageSize: PAGE_SIZE },
        { signal: controller.signal },
      )
      .then((response) => setState({ kind: "ready", response }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: errorMessage(error) });
      });

    return () => controller.abort();
  }, [client, page, requestKey]);

  return (
    <AppShell title="Experiments">
      <main className="dss-page">
        <PageHeader
          title="Experiments"
          description="Configure policy runs, monitor execution and inspect the returned results."
          actions={
            <>
              <button
                type="button"
                className="secondary-action"
                onClick={load}
                disabled={state.kind === "loading"}
              >
                <RefreshCw size={16} aria-hidden="true" />
                Refresh
              </button>
              <Link href="/experiments/new" className="primary-action">
                <Plus size={17} aria-hidden="true" />
                New experiment
              </Link>
            </>
          }
        />
        <DataNotice />

        {state.kind === "loading" ? (
          <section
            aria-label="Loading experiments"
            aria-busy="true"
            className="register-loading"
          >
            {[0, 1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-48 rounded-lg border border-[var(--color-stone-border)] bg-white p-5"
              >
                <div className="h-4 w-2/3 rounded bg-stone-200" />
                <div className="mt-4 h-3 w-full rounded bg-stone-100" />
                <div className="mt-12 h-12 rounded bg-stone-100" />
              </div>
            ))}
          </section>
        ) : state.kind === "error" ? (
          <section
            role="alert"
            className="my-8 rounded-lg border border-rose-200 bg-rose-50 p-6 text-center"
          >
            <h3 className="font-semibold text-rose-900">
              Experiments could not be loaded
            </h3>
            <p className="mt-1 text-base text-rose-700">{state.message}</p>
            <button
              type="button"
              onClick={load}
              className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-medium text-rose-800"
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" /> Try again
            </button>
          </section>
        ) : state.response.items.length === 0 ? (
          <section className="my-8 rounded-lg border border-dashed border-[var(--color-platinum-outline)] bg-white px-6 py-16 text-center">
            <FlaskConical
              className="mx-auto h-8 w-8 text-[var(--color-steel-gray)]"
              aria-hidden="true"
            />
            <h3 className="mt-4 font-semibold text-[var(--color-slate-text)]">
              No experiments yet
            </h3>
            <p className="mx-auto mt-1 max-w-md text-base text-[var(--color-ash-gray)]">
              Create the first experiment to configure a policy and CNC
              environment.
            </p>
            <Link
              href="/experiments/new"
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-[var(--color-slate-text)] px-3 text-sm font-medium text-white"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Create experiment
            </Link>
          </section>
        ) : (
          <>
            <section className="dss-panel" aria-label="Experiment results">
              <div className="section-heading">
                <div>
                  <h2>Experiment register</h2>
                  <p>
                    {state.response.total_items} experiment
                    {state.response.total_items === 1 ? "" : "s"} · Showing page{" "}
                    {state.response.page}
                  </p>
                </div>
              </div>
              <div className="table-toolbar">
                <label className="table-search">
                  <Search size={16} aria-hidden="true" />
                  <span className="sr-only">
                    Search experiments on this page
                  </span>
                  <input
                    type="search"
                    placeholder="Search this page"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>
                <label className="table-filter">
                  Status{" "}
                  <select
                    value={status}
                    onChange={(event) => setStatus(event.target.value)}
                  >
                    <option value="ALL">All statuses</option>
                    {Array.from(
                      new Set([
                        ...state.response.items.map((item) => item.status),
                        ...(status === "ALL" ? [] : [status]),
                      ]),
                    )
                      .sort()
                      .map((value) => (
                        <option key={value} value={value}>
                          {value.charAt(0) +
                            value.slice(1).toLowerCase().replaceAll("_", " ")}
                        </option>
                      ))}
                  </select>
                </label>
                {(search || status !== "ALL") && (
                  <button
                    type="button"
                    className="text-action"
                    onClick={() => {
                      setSearch("");
                      setStatus("ALL");
                    }}
                  >
                    Clear filters
                  </button>
                )}
                <span role="status">
                  {visibleItems.length} of {state.response.items.length} on this
                  page
                </span>
              </div>
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Experiment register data"
              >
                <table className="dss-table experiment-register">
                  <thead>
                    <tr>
                      <th
                        scope="col"
                        aria-sort={
                          sort === "name"
                            ? ascending
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          type="button"
                          className="table-sort"
                          onClick={() => changeSort("name")}
                        >
                          Experiment{" "}
                          <ArrowDownUp size={13} aria-hidden="true" />
                        </button>
                      </th>
                      <th scope="col" className="status-cell">
                        Status
                      </th>
                      <th scope="col">Policy</th>
                      <th scope="col" className="numeric-cell">
                        Episodes
                      </th>
                      <th
                        scope="col"
                        aria-sort={
                          sort === "created"
                            ? ascending
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          type="button"
                          className="table-sort"
                          onClick={() => changeSort("created")}
                        >
                          Owner / created{" "}
                          <ArrowDownUp size={13} aria-hidden="true" />
                        </button>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((experiment) => (
                      <ExperimentRow
                        key={experiment.id}
                        experiment={experiment}
                      />
                    ))}
                    {visibleItems.length === 0 && (
                      <tr>
                        <td colSpan={5} className="table-empty">
                          No experiments on this page match these filters.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </section>
            <nav
              className="flex flex-col gap-3 pt-5 text-sm sm:flex-row sm:items-center sm:justify-between"
              aria-label="Experiment pagination"
            >
              <p className="text-[var(--color-ash-gray)]">
                Page{" "}
                <span className="font-medium text-[var(--color-slate-text)]">
                  {state.response.page}
                </span>{" "}
                of {Math.max(1, state.response.total_pages)} ·{" "}
                {state.response.total_items} experiments
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={!state.response.has_previous}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  className="h-9 rounded-md border border-[var(--color-stone-border)] bg-white px-3 font-medium disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Previous
                </button>
                <button
                  type="button"
                  disabled={!state.response.has_next}
                  onClick={() => setPage((value) => value + 1)}
                  className="h-9 rounded-md border border-[var(--color-stone-border)] bg-white px-3 font-medium disabled:cursor-not-allowed disabled:opacity-45"
                >
                  Next
                </button>
              </div>
            </nav>
          </>
        )}
      </main>
    </AppShell>
  );
}
