"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Activity,
  AlertTriangle,
  ArrowLeft,
  Ban,
  Boxes,
  CheckCircle2,
  Clock3,
  Coins,
  Cpu,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { AppShell } from "@/components/app-shell";
import { AsyncState } from "@/components/research/async-state";
import { EnvironmentConfigView } from "@/components/research/environment-config-view";
import { PageHeader } from "@/components/research/page-header";
import { RulDistributionChart } from "@/components/research/rul-distribution-chart";
import { StatusBadge } from "@/components/research/status-badge";
import {
  getProductApiClient,
  isProductApiError,
  productApiErrorMessage,
} from "@/lib/product-api";
import type { MachineObservation } from "@/types/cnc";
import type {
  EpisodeDetail,
  EpisodeFailureInformation,
  EpisodeStepRecord,
  ProductApiClient,
} from "@/types/product-api";

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(date);
}

function requestError(error: unknown) {
  return productApiErrorMessage(error, "The episode could not be loaded.");
}

function ReturnedValue({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="min-w-0 rounded-md border border-[var(--color-stone-border)] bg-white px-3 py-2.5">
      <dt className="break-all font-mono text-[11px] text-[var(--color-ash-gray)]">{label}</dt>
      <dd className="mt-1 break-all font-mono text-sm tabular-nums text-[var(--color-slate-text)]">
        {value === undefined || value === null ? <span className="font-sans text-[var(--color-ash-gray)]">Not returned</span> : String(value)}
      </dd>
    </div>
  );
}

function FailurePanel({ failure, title = "Failure information" }: { failure: EpisodeFailureInformation; title?: string }) {
  return (
    <section className="rounded-lg border border-rose-200 bg-rose-50 p-4" aria-label={title}>
      <div className="flex gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" aria-hidden="true" />
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-rose-900">{title}</h3>
          <p className="mt-1 break-words text-sm text-rose-800">{failure.message}</p>
          <dl className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-xs text-rose-800">
            {failure.code ? <div><dt className="inline font-medium">code: </dt><dd className="inline font-mono">{failure.code}</dd></div> : null}
            {failure.occurred_at ? <div><dt className="inline font-medium">occurred_at: </dt><dd className="inline">{formatDate(failure.occurred_at)}</dd></div> : null}
          </dl>
          {failure.details !== undefined ? (
            <pre className="mt-3 max-h-48 max-w-full overflow-auto rounded border border-rose-200 bg-white/70 p-3 text-xs text-rose-950">{JSON.stringify(failure.details, null, 2)}</pre>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function EpisodeSummaryView({
  episode,
  viewedAttempt,
  currentAttempt,
}: {
  episode: EpisodeDetail;
  viewedAttempt: number;
  currentAttempt: number;
}) {
  const summary = episode.summary;
  if (!summary) {
    const terminal =
      viewedAttempt === currentAttempt &&
      ["COMPLETED", "FAILED", "CANCELLED"].includes(episode.status);
    return (
      <AsyncState
        kind="empty"
        compact
        title={`Attempt ${viewedAttempt} summary not available`}
        description={viewedAttempt !== currentAttempt
          ? "The backend did not persist a final summary for this historical attempt. No values were reconstructed in the browser."
          : terminal
            ? "The backend did not return a persisted final summary for this episode. No values were reconstructed in the browser."
            : "A final summary may become available after the worker reaches a terminal state."}
      />
    );
  }

  return (
    <section className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4 sm:p-5" aria-labelledby="summary-heading">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden="true" />
        <h2 id="summary-heading" className="text-sm font-semibold text-[var(--color-slate-text)]">Attempt {viewedAttempt} final summary</h2>
      </div>
      <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <ReturnedValue label="episode_id" value={summary.episode_id} />
        <ReturnedValue label="policy_id" value={summary.policy_id} />
        <ReturnedValue label="seed" value={summary.seed} />
        <ReturnedValue label="steps_completed" value={summary.steps_completed} />
        <ReturnedValue label="total_cost" value={summary.total_cost} />
        <ReturnedValue label="failure_count" value={summary.failure_count} />
        <ReturnedValue label="replacement_count" value={summary.replacement_count} />
        <ReturnedValue label="waiting_steps" value={summary.waiting_steps} />
      </dl>
    </section>
  );
}

function MachineObservationView({ machine }: { machine: MachineObservation }) {
  const state = machine.tool_state;
  return (
    <article className="min-w-0 rounded-lg border border-[var(--color-stone-border)] bg-[var(--color-canvas-fog)] p-3 sm:p-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <h4 className="break-all font-mono text-sm font-semibold text-[var(--color-slate-text)]">{machine.machine_id}</h4>
        <span className="rounded-full border border-[var(--color-stone-border)] bg-white px-2 py-1 font-mono text-[10px] text-[var(--color-ash-gray)]">tool {machine.tool_id}</span>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <ReturnedValue label="job_id" value={machine.job_id} />
        <ReturnedValue label="condition_id" value={machine.cutting_condition.condition_id} />
        <ReturnedValue label="load_class" value={machine.cutting_condition.load_class} />
        <ReturnedValue label="tool_age_steps" value={state.tool_age_steps} />
        <ReturnedValue label="observed_wear_um" value={state.observed_wear_um} />
        <ReturnedValue label="posterior_median_wear_um" value={state.posterior_median_wear_um} />
        <ReturnedValue label="posterior_std_wear_um" value={state.posterior_std_wear_um} />
      </dl>
      <RulDistributionChart distribution={state.rul_distribution} title={`RUL distribution · ${machine.machine_id}`} className="mt-3" />
    </article>
  );
}

function PartialFragment({ name }: { name: string }) {
  return (
    <div className="rounded-md border border-dashed border-[var(--color-platinum-outline)] bg-stone-50 px-4 py-5 text-sm text-[var(--color-ash-gray)]">
      <span className="font-mono text-xs">{name}</span> has not been persisted or returned. The UI does not reconstruct it.
    </div>
  );
}

function ObservationView({ record }: { record: EpisodeStepRecord }) {
  const observation = record.observation;
  if (!observation) return <PartialFragment name="fleet_observation" />;

  return (
    <section aria-label={`Fleet observation for step ${record.step}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-slate-text)]"><Cpu className="h-4 w-4 text-sky-600" aria-hidden="true" /> Fleet observation</h3>
        <div className="flex flex-wrap gap-2 font-mono text-[10px] text-[var(--color-ash-gray)]">
          <span className="break-all">observation_id: {observation.observation_id}</span>
          <span>step: {observation.step}</span>
        </div>
      </div>
      <div className="mt-3 flex items-center gap-2 rounded-md border border-sky-100 bg-sky-50 px-3 py-2 text-xs text-sky-900">
        <Boxes className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="font-mono">inventory.spares_available: {observation.inventory.spares_available}</span>
        <span aria-hidden="true">/</span>
        <span className="font-mono">capacity: {observation.inventory.capacity}</span>
      </div>
      <div className="mt-3 space-y-3">
        {observation.machines.map((machine) => <MachineObservationView key={machine.machine_id} machine={machine} />)}
      </div>
    </section>
  );
}

function RecommendationView({ record }: { record: EpisodeStepRecord }) {
  const recommendation = record.recommendation;
  if (!recommendation) return <PartialFragment name="policy_recommendation" />;

  return (
    <section className="rounded-lg border border-[var(--color-stone-border)] bg-white p-3 sm:p-4" aria-label={`Policy recommendation for step ${record.step}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-slate-text)]"><ShieldAlert className="h-4 w-4 text-violet-600" aria-hidden="true" /> Policy recommendation</h3>
        <span className="break-all font-mono text-[10px] text-[var(--color-ash-gray)]">{recommendation.policy_id} · v{recommendation.policy_version}</span>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-2">
        <ReturnedValue label="estimated_expected_cost" value={recommendation.estimated_expected_cost} />
        <ReturnedValue label="estimated_cvar_cost" value={recommendation.estimated_cvar_cost} />
      </dl>
      <div className="mt-3 overflow-x-auto rounded-md border border-[var(--color-stone-border)]">
        <table className="w-full min-w-[420px] text-left text-sm">
          <thead className="bg-[var(--color-canvas-fog)] text-xs text-[var(--color-ash-gray)]"><tr><th className="px-3 py-2 font-medium">machine_id</th><th className="px-3 py-2 font-medium">recommended action</th></tr></thead>
          <tbody className="divide-y divide-[var(--color-stone-border)]">
            {recommendation.actions.actions.map((action) => <tr key={action.machine_id}><td className="break-all px-3 py-2 font-mono text-xs">{action.machine_id}</td><td className="px-3 py-2"><StatusBadge status={action.action} /></td></tr>)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function StepResultView({ record }: { record: EpisodeStepRecord }) {
  const result = record.result;
  if (!result) return <PartialFragment name="step_result" />;

  return (
    <section className="rounded-lg border border-[var(--color-stone-border)] bg-white p-3 sm:p-4" aria-label={`Step result for step ${record.step}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-slate-text)]"><Wrench className="h-4 w-4 text-emerald-600" aria-hidden="true" /> Selected actions and outcomes</h3>
        <span className="font-mono text-[10px] text-[var(--color-ash-gray)]">episode_terminated: {String(result.episode_terminated)}</span>
      </div>
      <div className="mt-3 overflow-x-auto rounded-md border border-[var(--color-stone-border)]">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="bg-[var(--color-canvas-fog)] text-xs text-[var(--color-ash-gray)]"><tr><th className="px-3 py-2 font-medium">machine_id</th><th className="px-3 py-2 font-medium">requested_action</th><th className="px-3 py-2 font-medium">outcome</th><th className="px-3 py-2 font-medium">tool_id_before</th><th className="px-3 py-2 font-medium">tool_id_after</th><th className="px-3 py-2 text-right font-medium">incurred_cost</th></tr></thead>
          <tbody className="divide-y divide-[var(--color-stone-border)]">
            {result.outcomes.map((outcome) => (
              <tr key={outcome.machine_id} className={outcome.outcome === "WAITING_FOR_SPARE" ? "bg-amber-50/60" : outcome.outcome === "FAILED" ? "bg-rose-50/60" : undefined}>
                <td className="break-all px-3 py-2 font-mono text-xs">{outcome.machine_id}</td>
                <td className="px-3 py-2"><StatusBadge status={outcome.requested_action} /></td>
                <td className="px-3 py-2"><StatusBadge status={outcome.outcome} /></td>
                <td className="break-all px-3 py-2 font-mono text-xs">{outcome.tool_id_before}</td>
                <td className="break-all px-3 py-2 font-mono text-xs text-[var(--color-ash-gray)]">{outcome.tool_id_after ?? "Not returned"}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">{outcome.incurred_cost}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="mt-3 grid gap-2 sm:grid-cols-3">
        <ReturnedValue label="result.total_cost" value={result.total_cost} />
        <ReturnedValue label="inventory_after.spares_available" value={result.inventory_after.spares_available} />
        <ReturnedValue label="inventory_after.capacity" value={result.inventory_after.capacity} />
      </dl>
    </section>
  );
}

function ReturnedStepMetadata({ record }: { record: EpisodeStepRecord }) {
  const risks = record.risk_values;
  const hasCosts = record.step_cost !== undefined || record.cumulative_cost !== undefined;
  if (!hasCosts && !risks && !record.failure) return null;

  return (
    <div className="space-y-3">
      {hasCosts || risks ? (
        <section className="rounded-lg border border-[var(--color-stone-border)] bg-[var(--color-canvas-fog)] p-3 sm:p-4" aria-label={`Returned cost and risk values for step ${record.step}`}>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-[var(--color-slate-text)]"><Coins className="h-4 w-4 text-amber-600" aria-hidden="true" /> Returned cost and risk values</h3>
          <dl className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {record.step_cost !== undefined ? <ReturnedValue label="step_cost" value={record.step_cost} /> : null}
            {record.cumulative_cost !== undefined ? <ReturnedValue label="cumulative_cost" value={record.cumulative_cost} /> : null}
            {risks ? Object.entries(risks).map(([name, value]) => <ReturnedValue key={name} label={name} value={value} />) : null}
          </dl>
        </section>
      ) : null}
      {record.failure ? <FailurePanel failure={record.failure} title={`Failure information · step ${record.step}`} /> : null}
    </div>
  );
}

function StepTimeline({ steps }: { steps: EpisodeStepRecord[] }) {
  const chronological = useMemo(() => [...steps].sort((left, right) => left.step - right.step), [steps]);
  if (chronological.length === 0) {
    return <AsyncState kind="empty" title="No simulation steps returned" description="The episode has no persisted step records yet. Missing research output is not reconstructed by the frontend." />;
  }

  return (
    <ol className="space-y-5" aria-label="Chronological simulation step timeline">
      {chronological.map((record, index) => (
        <li key={`${record.step}-${record.observation?.observation_id ?? index}`} className="relative pl-7 sm:pl-9">
          {index < chronological.length - 1 ? <span className="absolute bottom-[-1.25rem] left-[9px] top-5 w-px bg-[var(--color-platinum-outline)] sm:left-[13px]" aria-hidden="true" /> : null}
          <span className="absolute left-0 top-1 grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-[var(--color-chartwell-blue)] text-[9px] font-bold text-white shadow-sm sm:h-7 sm:w-7 sm:text-[10px]">{record.step}</span>
          <article className="min-w-0 rounded-lg border border-[var(--color-stone-border)] bg-white p-3 shadow-[var(--shadow-subtle)] sm:p-5">
            <header className="flex min-w-0 flex-col gap-1 border-b border-[var(--color-stone-border)] pb-3 sm:flex-row sm:items-center sm:justify-between">
              <h2 className="font-semibold text-[var(--color-slate-text)]">Simulation step {record.step}</h2>
              <p className="break-all text-xs text-[var(--color-ash-gray)]"><span className="font-mono">persisted_at</span>: {formatDate(record.persisted_at)}</p>
            </header>
            <div className="mt-4 space-y-4">
              <ReturnedStepMetadata record={record} />
              <ObservationView record={record} />
              <RecommendationView record={record} />
              <StepResultView record={record} />
            </div>
          </article>
        </li>
      ))}
    </ol>
  );
}

type PageState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; episode: EpisodeDetail };

export function EpisodeDetailPage({ api, pollIntervalMs = 4000 }: { api?: ProductApiClient; pollIntervalMs?: number } = {}) {
  const params = useParams<{ episodeId: string }>();
  const episodeId = Array.isArray(params?.episodeId) ? params.episodeId[0] : params?.episodeId;
  const client = useMemo(() => api ?? getProductApiClient(), [api]);
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [retryKey, setRetryKey] = useState(0);
  const [pollError, setPollError] = useState("");
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null);
  const [activeAction, setActiveAction] = useState<"retry" | "cancel" | null>(null);
  const [actionError, setActionError] = useState("");
  const selectedAttemptRef = useRef<number | null>(null);
  const loadedEpisodeIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!episodeId) {
      setState({ kind: "error", message: "Episode identifier is missing." });
      return;
    }

    if (loadedEpisodeIdRef.current !== episodeId) {
      loadedEpisodeIdRef.current = episodeId;
      selectedAttemptRef.current = null;
      setSelectedAttempt(null);
      setActionError("");
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | undefined;
    let shouldContinuePolling = false;

    async function load(initial: boolean) {
      controller = new AbortController();
      if (initial) setState({ kind: "loading" });
      try {
        const requestedAttempt = selectedAttemptRef.current;
        const episode = await client.getEpisode(episodeId, {
          signal: controller.signal,
          ...(requestedAttempt === null ? {} : { attempt: requestedAttempt }),
        });
        if (disposed) return;
        if (selectedAttemptRef.current === null) {
          const currentAttempt = episode.attempt ?? 1;
          selectedAttemptRef.current = currentAttempt;
          setSelectedAttempt(currentAttempt);
        }
        setState({ kind: "ready", episode });
        setPollError("");
        setLastRefreshed(new Date());
        shouldContinuePolling = episode.status === "PENDING" || episode.status === "RUNNING";
        if (shouldContinuePolling) {
          timer = setTimeout(() => void load(false), pollIntervalMs);
        }
      } catch (error) {
        if (disposed || controller.signal.aborted) return;
        if (initial) setState({ kind: "error", message: requestError(error) });
        else {
          setPollError(requestError(error));
          if (shouldContinuePolling) {
            timer = setTimeout(() => void load(false), pollIntervalMs);
          }
        }
      }
    }

    void load(true);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      controller?.abort();
    };
  }, [client, episodeId, pollIntervalMs, retryKey]);

  const selectAttempt = (attempt: number) => {
    if (!Number.isInteger(attempt) || attempt < 1 || attempt === selectedAttemptRef.current) {
      return;
    }
    selectedAttemptRef.current = attempt;
    setSelectedAttempt(attempt);
    setActionError("");
    setRetryKey((value) => value + 1);
  };

  const mutateEpisode = async (action: "retry" | "cancel") => {
    if (!episodeId || state.kind !== "ready" || activeAction) return;
    if (action === "retry" && state.episode.status !== "FAILED") return;
    if (action === "cancel" && state.episode.status !== "PENDING") return;

    setActiveAction(action);
    setActionError("");
    try {
      const result = action === "retry"
        ? await client.retryEpisode(episodeId)
        : await client.cancelEpisode(episodeId);
      selectedAttemptRef.current = result.attempt;
      setSelectedAttempt(result.attempt);
      setState((current) => current.kind === "ready"
        ? {
            kind: "ready",
            episode: {
              ...current.episode,
              status: result.status,
              attempt: result.attempt,
              ...(action === "retry" ? { summary: null, steps: [] } : {}),
            },
          }
        : current);
      setRetryKey((value) => value + 1);
    } catch (error) {
      setActionError(productApiErrorMessage(
        error,
        action === "retry"
          ? "The episode could not be retried."
          : "The episode could not be cancelled.",
      ));
      if (
        isProductApiError(error) &&
        (error.status === 409 || error.status === 0 || error.code === "NETWORK_ERROR")
      ) {
        // A lost response or a concurrent worker transition can make local state stale.
        selectedAttemptRef.current = null;
        setSelectedAttempt(null);
        setRetryKey((value) => value + 1);
      }
    } finally {
      setActiveAction(null);
    }
  };

  const currentAttempt = state.kind === "ready" ? state.episode.attempt ?? 1 : 1;
  const viewedAttempt = selectedAttempt ?? currentAttempt;
  const attemptOptions = Array.from(
    { length: currentAttempt },
    (_, index) => index + 1,
  );

  return (
    <AppShell title="Episode detail">
      <main className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        {state.kind === "loading" ? <AsyncState kind="loading" title="Loading episode" description="Requesting persisted episode state and simulation steps." /> : null}
        {state.kind === "error" ? <AsyncState kind="error" title="Episode could not be loaded" description={state.message} onRetry={() => setRetryKey((value) => value + 1)} /> : null}
        {state.kind === "ready" ? (
          <div className="space-y-6">
            <PageHeader
              title={state.episode.key || state.episode.id}
              description={`Episode identifier: ${state.episode.id}`}
              breadcrumbs={[{ label: "Experiments", href: "/experiments" }, { label: state.episode.experiment_id, href: `/experiments/${encodeURIComponent(state.episode.experiment_id)}` }, { label: state.episode.id }]}
              eyebrow="Persisted episode output"
              actions={<>
                <StatusBadge status={state.episode.status} />
                <label className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--color-stone-border)] bg-white px-3 text-xs font-medium text-[var(--color-slate-text)]">
                  <span>Attempt</span>
                  <select
                    aria-label="View attempt"
                    value={viewedAttempt}
                    onChange={(event) => selectAttempt(Number(event.target.value))}
                    disabled={activeAction !== null}
                    className="bg-transparent font-mono font-semibold outline-none disabled:cursor-not-allowed"
                  >
                    {attemptOptions.map((attempt) => (
                      <option key={attempt} value={attempt}>{attempt}</option>
                    ))}
                  </select>
                  <span className="text-[var(--color-ash-gray)]">of {currentAttempt}</span>
                </label>
                {state.episode.status === "FAILED" ? (
                  <button
                    type="button"
                    onClick={() => void mutateEpisode("retry")}
                    disabled={activeAction !== null}
                    className="inline-flex h-9 items-center gap-2 rounded-md bg-[var(--color-chartwell-blue)] px-3 text-sm font-semibold text-white hover:bg-sky-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <RotateCcw className={`h-4 w-4 ${activeAction === "retry" ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />
                    {activeAction === "retry" ? "Retrying…" : "Retry episode"}
                  </button>
                ) : null}
                {state.episode.status === "PENDING" ? (
                  <button
                    type="button"
                    onClick={() => void mutateEpisode("cancel")}
                    disabled={activeAction !== null}
                    className="inline-flex h-9 items-center gap-2 rounded-md border border-rose-200 bg-white px-3 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {activeAction === "cancel" ? <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Ban className="h-4 w-4" aria-hidden="true" />}
                    {activeAction === "cancel" ? "Cancelling…" : "Cancel episode"}
                  </button>
                ) : null}
                <Link href={`/experiments/${encodeURIComponent(state.episode.experiment_id)}`} className="inline-flex h-9 items-center gap-2 rounded-md border border-[var(--color-stone-border)] bg-white px-3 text-sm font-medium text-[var(--color-slate-text)]"><ArrowLeft className="h-4 w-4" aria-hidden="true" /> Experiment</Link>
              </>}
            />

            {actionError ? (
              <div className="flex items-start gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2.5 text-sm text-rose-900" role="alert">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <p>{actionError}</p>
              </div>
            ) : null}

            <div className="rounded-md border border-[var(--color-stone-border)] bg-[var(--color-canvas-fog)] px-3 py-2.5 text-sm text-[var(--color-slate-text)]" aria-live="polite">
              <span className="font-semibold">Attempt {viewedAttempt} of {currentAttempt}.</span>{" "}
              {viewedAttempt === currentAttempt
                ? "Showing the current attempt returned by the Product API."
                : `Viewing persisted results from historical attempt ${viewedAttempt}; status and lifecycle timestamps below describe the current attempt ${currentAttempt}.`}
            </div>

            {(state.episode.status === "PENDING" || state.episode.status === "RUNNING" || pollError) ? (
              <div className={`flex flex-col gap-2 rounded-md border px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between ${pollError ? "border-amber-200 bg-amber-50 text-amber-900" : "border-sky-200 bg-sky-50 text-sky-900"}`}>
                <span className="flex items-center gap-2">{pollError ? <AlertTriangle className="h-4 w-4" aria-hidden="true" /> : <RefreshCw className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}{pollError || `Polling the backend every ${pollIntervalMs / 1000} seconds while this episode is ${state.episode.status}.`}</span>
                <span>Last refreshed: {lastRefreshed ? formatDate(lastRefreshed.toISOString()) : "Not available"}</span>
              </div>
            ) : null}

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5" aria-label="Episode metadata">
              <div className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4"><p className="flex items-center gap-2 text-xs text-[var(--color-ash-gray)]"><Activity className="h-4 w-4" aria-hidden="true" /> Policy</p><p className="mt-2 break-words text-sm font-medium">{state.episode.policy.name}</p><p className="font-mono text-xs text-[var(--color-ash-gray)]">{state.episode.policy.id} · v{state.episode.policy.version}</p></div>
              <div className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4"><p className="flex items-center gap-2 text-xs text-[var(--color-ash-gray)]"><Cpu className="h-4 w-4" aria-hidden="true" /> Seed</p><p className="mt-2 font-mono text-lg font-semibold tabular-nums">{state.episode.seed}</p></div>
              <div className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4"><p className="flex items-center gap-2 text-xs text-[var(--color-ash-gray)]"><RotateCcw className="h-4 w-4" aria-hidden="true" /> Current attempt</p><p className="mt-2 font-mono text-lg font-semibold tabular-nums">{currentAttempt}</p></div>
              <div className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4"><p className="flex items-center gap-2 text-xs text-[var(--color-ash-gray)]"><Clock3 className="h-4 w-4" aria-hidden="true" /> Started</p><p className="mt-2 text-sm font-medium">{formatDate(state.episode.started_at)}</p></div>
              <div className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4"><p className="flex items-center gap-2 text-xs text-[var(--color-ash-gray)]"><Clock3 className="h-4 w-4" aria-hidden="true" /> Completed</p><p className="mt-2 text-sm font-medium">{formatDate(state.episode.completed_at)}</p></div>
            </section>

            {viewedAttempt === currentAttempt && state.episode.failure ? <FailurePanel failure={state.episode.failure} /> : null}
            <EpisodeSummaryView episode={state.episode} viewedAttempt={viewedAttempt} currentAttempt={currentAttempt} />
            <EnvironmentConfigView config={state.episode.environment_config} />

            <section className="space-y-4" aria-labelledby="timeline-heading">
              <div className="flex flex-col gap-1 border-b border-[var(--color-stone-border)] pb-4 sm:flex-row sm:items-end sm:justify-between">
                <div><h2 id="timeline-heading" className="text-lg font-semibold text-[var(--color-slate-text)]">Attempt {viewedAttempt} simulation step timeline</h2><p className="mt-1 text-sm text-[var(--color-ash-gray)]">Chronological observations, recommendations, selected actions, and returned results from the Product API.</p></div>
                <span className="text-xs text-[var(--color-ash-gray)]">{state.episode.steps.length} persisted records</span>
              </div>
              <StepTimeline steps={state.episode.steps} />
            </section>
          </div>
        ) : null}
      </main>
    </AppShell>
  );
}
