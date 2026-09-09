"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertCircle, ArrowLeft, Check, ChevronDown, FlaskConical, LoaderCircle, RefreshCw } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { AppShell } from "@/components/app-shell";
import { getProductApiClient, productApiErrorMessage } from "@/lib/product-api";
import type {
  CreateExperimentRequest,
  FieldErrors,
  PolicyCatalogItem,
  ProductApiClient,
} from "@/types/product-api";

export type CreateExperimentFormValues = {
  name: string;
  description: string;
  policy_id: string;
  number_of_episodes: string;
  environment_id: string;
  number_of_machines: string;
  spare_capacity: string;
  initial_spares: string;
  horizon_steps: string;
  failure_threshold_um: string;
  seed: string;
  replacement_cost: string;
  failure_cost: string;
  waiting_cost_per_step: string;
  unused_life_cost_per_step: string;
  risk_objective: "EXPECTED_COST" | "CVAR";
  cvar_alpha: string;
};

const INITIAL_VALUES: CreateExperimentFormValues = {
  name: "",
  description: "",
  policy_id: "",
  number_of_episodes: "10",
  environment_id: "cnc-shared-spares",
  number_of_machines: "3",
  spare_capacity: "2",
  initial_spares: "2",
  horizon_steps: "100",
  failure_threshold_um: "300",
  seed: "42",
  replacement_cost: "25",
  failure_cost: "500",
  waiting_cost_per_step: "10",
  unused_life_cost_per_step: "0.5",
  risk_objective: "CVAR",
  cvar_alpha: "0.95",
};

const IDENTIFIER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function addError(errors: FieldErrors, field: string, message: string) {
  errors[field] = [...(errors[field] ?? []), message];
}

function finiteNumber(
  values: CreateExperimentFormValues,
  errors: FieldErrors,
  field: keyof CreateExperimentFormValues,
  label: string,
  options: { integer?: boolean; minimum?: number; exclusiveMinimum?: number } = {},
) {
  const raw = values[field];
  const value = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(value)) {
    addError(errors, String(field), `${label} must be a number.`);
    return undefined;
  }
  if (options.integer && !Number.isInteger(value)) {
    addError(errors, String(field), `${label} must be a whole number.`);
  }
  if (options.minimum !== undefined && value < options.minimum) {
    addError(errors, String(field), `${label} must be at least ${options.minimum}.`);
  }
  if (options.exclusiveMinimum !== undefined && value <= options.exclusiveMinimum) {
    addError(errors, String(field), `${label} must be greater than ${options.exclusiveMinimum}.`);
  }
  return value;
}

export function validateCreateExperimentForm(values: CreateExperimentFormValues): FieldErrors {
  const errors: FieldErrors = {};

  if (!values.name.trim()) addError(errors, "name", "Experiment name is required.");
  if (!values.policy_id) addError(errors, "policy_id", "Select an available policy.");

  if (!values.environment_id.trim()) {
    addError(errors, "environment_id", "Environment ID is required.");
  } else if (
    values.environment_id.length > 128 ||
    !IDENTIFIER_PATTERN.test(values.environment_id)
  ) {
    addError(errors, "environment_id", "Use 1–128 letters, numbers, dots, underscores, colons, or hyphens; begin with a letter or number.");
  }

  finiteNumber(values, errors, "number_of_episodes", "Number of episodes", { integer: true, minimum: 1 });
  finiteNumber(values, errors, "number_of_machines", "Number of machines", { integer: true, minimum: 1 });
  const spareCapacity = finiteNumber(values, errors, "spare_capacity", "Spare capacity", { integer: true, minimum: 0 });
  const initialSpares = finiteNumber(values, errors, "initial_spares", "Initial spares", { integer: true, minimum: 0 });
  finiteNumber(values, errors, "horizon_steps", "Simulation horizon", { integer: true, minimum: 1 });
  finiteNumber(values, errors, "failure_threshold_um", "Failure threshold", { exclusiveMinimum: 0 });
  finiteNumber(values, errors, "seed", "Seed", { integer: true, minimum: 0 });
  finiteNumber(values, errors, "replacement_cost", "Replacement cost", { minimum: 0 });
  finiteNumber(values, errors, "failure_cost", "Failure cost", { minimum: 0 });
  finiteNumber(values, errors, "waiting_cost_per_step", "Waiting cost", { minimum: 0 });
  finiteNumber(values, errors, "unused_life_cost_per_step", "Unused-life cost", { minimum: 0 });

  if (
    spareCapacity !== undefined &&
    initialSpares !== undefined &&
    initialSpares > spareCapacity
  ) {
    addError(errors, "initial_spares", "Initial spares cannot exceed spare capacity.");
  }

  if (values.risk_objective === "CVAR") {
    const alpha = finiteNumber(values, errors, "cvar_alpha", "CVaR alpha");
    if (alpha !== undefined && (alpha <= 0 || alpha >= 1)) {
      addError(errors, "cvar_alpha", "CVaR alpha must be greater than 0 and less than 1.");
    }
  }

  return errors;
}

function toRequest(
  values: CreateExperimentFormValues,
  policy: PolicyCatalogItem,
): CreateExperimentRequest {
  return {
    name: values.name.trim(),
    description: values.description.trim() || null,
    policyKey: policy.key ?? policy.id,
    policyVersion: policy.version,
    episodeCount: Number(values.number_of_episodes),
    environmentConfig: {
      schema_version: "2.0",
      environment_id: values.environment_id.trim(),
      number_of_machines: Number(values.number_of_machines),
      spare_capacity: Number(values.spare_capacity),
      initial_spares: Number(values.initial_spares),
      horizon_steps: Number(values.horizon_steps),
      failure_threshold_um: Number(values.failure_threshold_um),
      seed: Number(values.seed),
      costs: {
        replacement_cost: Number(values.replacement_cost),
        failure_cost: Number(values.failure_cost),
        waiting_cost_per_step: Number(values.waiting_cost_per_step),
        unused_life_cost_per_step: Number(values.unused_life_cost_per_step),
      },
      risk: {
        objective: values.risk_objective,
        cvar_alpha: Number(values.cvar_alpha),
      },
    },
  };
}

function backendErrors(error: unknown): FieldErrors {
  if (!error || typeof error !== "object") return {};
  const candidate = error as { fieldErrors?: unknown; field_errors?: unknown };
  const value = candidate.fieldErrors ?? candidate.field_errors;
  if (!value || typeof value !== "object") return {};

  const normalized: FieldErrors = {};
  for (const [field, messages] of Object.entries(value as Record<string, unknown>)) {
    const key = field
      .replace(/^environmentConfig\./, "")
      .replace(/^environment_config\./, "")
      .replace(/^costs\./, "")
      .replace(/^risk\./, "risk_")
      .replace("episodeCount", "number_of_episodes")
      .replace("policyKey", "policy_id")
      .replace("policyVersion", "policy_id")
      .replace("risk_objective", "risk_objective")
      .replace("risk_cvar_alpha", "cvar_alpha");
    normalized[key] = Array.isArray(messages)
      ? messages.map(String)
      : [String(messages)];
  }
  return normalized;
}

function requestErrorMessage(error: unknown) {
  return productApiErrorMessage(error, "The experiment could not be created.");
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string[];
  children: ReactNode;
}) {
  const errorId = `${htmlFor}-error`;
  const hintId = `${htmlFor}-hint`;
  return (
    <div className="min-w-0">
      <label htmlFor={htmlFor} className="block text-xs font-semibold text-[var(--color-slate-text)]">
        {label}
      </label>
      {hint ? <p id={hintId} className="mt-0.5 text-xs text-[var(--color-ash-gray)]">{hint}</p> : null}
      <div className="mt-1.5">{children}</div>
      {error?.map((message, index) => (
        <p key={`${message}-${index}`} id={index === 0 ? errorId : undefined} role="alert" className="mt-1 text-xs text-rose-700">
          {message}
        </p>
      ))}
    </div>
  );
}

const inputClass = "h-10 w-full rounded-md border border-[var(--color-platinum-outline)] bg-white px-3 text-sm text-[var(--color-slate-text)] outline-none transition-shadow placeholder:text-stone-400 focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:bg-stone-100";

type CreateExperimentFormProps = {
  api: ProductApiClient;
  onCreated: (experimentId: string) => void;
};

export function CreateExperimentForm({ api, onCreated }: CreateExperimentFormProps) {
  const [values, setValues] = useState<CreateExperimentFormValues>(INITIAL_VALUES);
  const [policies, setPolicies] = useState<PolicyCatalogItem[]>([]);
  const [policiesState, setPoliciesState] = useState<"loading" | "ready" | "error">("loading");
  const [policiesError, setPoliciesError] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [requestError, setRequestError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [policyRequestKey, setPolicyRequestKey] = useState(0);
  const submittingRef = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    setPoliciesState("loading");
    void api
      .listPolicies({ signal: controller.signal })
      .then((items) => {
        const available = items.filter((policy) => policy.available !== false);
        setPolicies(available);
        setValues((current) => ({
          ...current,
          policy_id: current.policy_id || available[0]?.id || "",
        }));
        setPoliciesState("ready");
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setPoliciesError(requestErrorMessage(error));
        setPoliciesState("error");
      });
    return () => controller.abort();
  }, [api, policyRequestKey]);

  function update<K extends keyof CreateExperimentFormValues>(field: K, value: CreateExperimentFormValues[K]) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
    setRequestError("");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;

    const nextErrors = validateCreateExperimentForm(values);
    setErrors(nextErrors);
    setRequestError("");
    if (Object.keys(nextErrors).length > 0) {
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>("[aria-invalid='true']")?.focus();
      });
      return;
    }

    const selectedPolicy = policies.find((policy) => policy.id === values.policy_id);
    if (!selectedPolicy) {
      setErrors({ policy_id: ["The selected policy is no longer available."] });
      return;
    }

    submittingRef.current = true;
    setSubmitting(true);
    try {
      const experiment = await api.createExperiment(toRequest(values, selectedPolicy));
      onCreated(experiment.id);
    } catch (error) {
      const fieldErrors = backendErrors(error);
      if (Object.keys(fieldErrors).length > 0) setErrors(fieldErrors);
      setRequestError(requestErrorMessage(error));
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const field = <K extends keyof CreateExperimentFormValues>(name: K) => ({
    id: name,
    name,
    value: values[name],
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => update(name, event.target.value as CreateExperimentFormValues[K]),
    "aria-invalid": Boolean(errors[name]),
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {requestError ? (
        <div role="alert" className="flex gap-3 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div><p className="font-medium">Request failed</p><p className="mt-0.5">{requestError}</p></div>
        </div>
      ) : null}

      <section className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4 sm:p-6" aria-labelledby="experiment-basics-heading">
        <div className="border-b border-[var(--color-stone-border)] pb-4">
          <h3 id="experiment-basics-heading" className="font-semibold text-[var(--color-slate-text)]">Experiment and policy</h3>
          <p className="mt-1 text-sm text-[var(--color-ash-gray)]">Name the run, choose a versioned policy, and set the episode count.</p>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field label="Experiment name" htmlFor="name" error={errors.name}>
            <input {...field("name")} autoFocus placeholder="e.g. CVaR shared-spare baseline" className={inputClass} />
          </Field>
          <Field label="Number of episodes" htmlFor="number_of_episodes" hint="Whole number, at least 1" error={errors.number_of_episodes}>
            <input {...field("number_of_episodes")} type="number" min="1" step="1" inputMode="numeric" className={inputClass} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Description (optional)" htmlFor="description" error={errors.description}>
              <textarea id="description" name="description" rows={3} value={values.description} onChange={(event) => update("description", event.target.value)} className={`${inputClass} h-auto min-h-20 resize-y py-2`} placeholder="Purpose, comparison, or run notes" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Policy and version" htmlFor="policy_id" hint="Loaded from the Product API policy catalog" error={errors.policy_id}>
              {policiesState === "error" ? (
                <div className="flex flex-col gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between">
                  <span>{policiesError || "Policy catalog could not be loaded."}</span>
                  <button type="button" onClick={() => setPolicyRequestKey((value) => value + 1)} className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-amber-300 bg-white px-3 font-medium">
                    <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Retry
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <select id="policy_id" name="policy_id" disabled={policiesState === "loading" || submitting} value={values.policy_id} onChange={(event) => update("policy_id", event.target.value)} aria-invalid={Boolean(errors.policy_id)} aria-describedby={errors.policy_id ? "policy_id-error" : undefined} className={`${inputClass} appearance-none pr-10`}>
                    {policiesState === "loading" ? <option value="">Loading policies…</option> : null}
                    {policiesState === "ready" && policies.length === 0 ? <option value="">No policies available</option> : null}
                    {policies.map((policy) => <option key={`${policy.id}:${policy.version}`} value={policy.id}>{policy.name} · v{policy.version}</option>)}
                  </select>
                  {policiesState === "loading" ? <LoaderCircle className="pointer-events-none absolute right-3 top-3 h-4 w-4 animate-spin text-[var(--color-ash-gray)]" aria-hidden="true" /> : <ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-[var(--color-ash-gray)]" aria-hidden="true" />}
                </div>
              )}
            </Field>
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4 sm:p-6" aria-labelledby="environment-heading">
        <div className="border-b border-[var(--color-stone-border)] pb-4">
          <h3 id="environment-heading" className="font-semibold text-[var(--color-slate-text)]">CNC environment · contract v2.0</h3>
          <p className="mt-1 text-sm text-[var(--color-ash-gray)]">All required environment fields are submitted without deriving research values in the browser.</p>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Environment ID" htmlFor="environment_id" hint="Stable machine-readable identifier" error={errors.environment_id}><input {...field("environment_id")} className={inputClass} /></Field>
          <Field label="Machines" htmlFor="number_of_machines" hint="Whole number, at least 1" error={errors.number_of_machines}><input {...field("number_of_machines")} type="number" min="1" step="1" className={inputClass} /></Field>
          <Field label="Simulation horizon (steps)" htmlFor="horizon_steps" hint="Whole number, at least 1" error={errors.horizon_steps}><input {...field("horizon_steps")} type="number" min="1" step="1" className={inputClass} /></Field>
          <Field label="Spare capacity" htmlFor="spare_capacity" hint="Zero is a valid baseline" error={errors.spare_capacity}><input {...field("spare_capacity")} type="number" min="0" step="1" className={inputClass} /></Field>
          <Field label="Initial spares" htmlFor="initial_spares" hint="Cannot exceed capacity" error={errors.initial_spares}><input {...field("initial_spares")} type="number" min="0" step="1" className={inputClass} /></Field>
          <Field label="Seed" htmlFor="seed" hint="Whole number, zero or greater" error={errors.seed}><input {...field("seed")} type="number" min="0" step="1" className={inputClass} /></Field>
          <Field label="Failure threshold (µm)" htmlFor="failure_threshold_um" hint="Must be greater than zero" error={errors.failure_threshold_um}><input {...field("failure_threshold_um")} type="number" min="0" step="any" className={inputClass} /></Field>
        </div>
      </section>

      <section className="rounded-lg border border-[var(--color-stone-border)] bg-white p-4 sm:p-6" aria-labelledby="cost-heading">
        <div className="border-b border-[var(--color-stone-border)] pb-4">
          <h3 id="cost-heading" className="font-semibold text-[var(--color-slate-text)]">Cost and risk configuration</h3>
          <p className="mt-1 text-sm text-[var(--color-ash-gray)]">Values use the experiment-configured currency unit; the UI does not recalculate them.</p>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Replacement cost" htmlFor="replacement_cost" error={errors.replacement_cost}><input {...field("replacement_cost")} type="number" min="0" step="any" className={inputClass} /></Field>
          <Field label="Failure cost" htmlFor="failure_cost" error={errors.failure_cost}><input {...field("failure_cost")} type="number" min="0" step="any" className={inputClass} /></Field>
          <Field label="Waiting cost / step" htmlFor="waiting_cost_per_step" error={errors.waiting_cost_per_step}><input {...field("waiting_cost_per_step")} type="number" min="0" step="any" className={inputClass} /></Field>
          <Field label="Unused-life cost / step" htmlFor="unused_life_cost_per_step" error={errors.unused_life_cost_per_step}><input {...field("unused_life_cost_per_step")} type="number" min="0" step="any" className={inputClass} /></Field>
        </div>
        <div className="mt-5 grid gap-5 border-t border-[var(--color-stone-border)] pt-5 sm:grid-cols-2">
          <Field label="Risk objective" htmlFor="risk_objective" error={errors.risk_objective}>
            <div className="relative"><select id="risk_objective" name="risk_objective" value={values.risk_objective} onChange={(event) => update("risk_objective", event.target.value as CreateExperimentFormValues["risk_objective"])} className={`${inputClass} appearance-none pr-10`}><option value="EXPECTED_COST">EXPECTED_COST</option><option value="CVAR">CVAR</option></select><ChevronDown className="pointer-events-none absolute right-3 top-3 h-4 w-4 text-[var(--color-ash-gray)]" aria-hidden="true" /></div>
          </Field>
          <Field label="CVaR alpha" htmlFor="cvar_alpha" hint="Greater than 0 and less than 1" error={errors.cvar_alpha}><input {...field("cvar_alpha")} type="number" min="0" max="1" step="any" disabled={values.risk_objective !== "CVAR"} className={inputClass} /></Field>
        </div>
      </section>

      <div className="sticky bottom-0 z-20 flex flex-col-reverse gap-3 border-t border-[var(--color-stone-border)] bg-[color:rgba(250,250,249,0.96)] py-4 backdrop-blur sm:flex-row sm:items-center sm:justify-end">
        <Link href="/experiments" className="inline-flex h-10 items-center justify-center rounded-md border border-[var(--color-stone-border)] bg-white px-4 text-sm font-medium text-[var(--color-slate-text)]">Cancel</Link>
        <button type="submit" disabled={submitting || policiesState !== "ready" || policies.length === 0} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-[var(--color-slate-text)] px-5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-55">
          {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
          {submitting ? "Creating experiment…" : "Create experiment"}
        </button>
      </div>
    </form>
  );
}

export function CreateExperimentPage({ api }: { api?: ProductApiClient } = {}) {
  const router = useRouter();
  const client = useMemo(() => api ?? getProductApiClient(), [api]);
  return (
    <AppShell title="Create experiment">
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <header className="mb-6 flex items-start gap-3 border-b border-[var(--color-stone-border)] pb-6">
          <Link href="/experiments" aria-label="Back to experiments" className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[var(--color-stone-border)] bg-white text-[var(--color-ash-gray)]"><ArrowLeft className="h-4 w-4" aria-hidden="true" /></Link>
          <div className="min-w-0">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--color-ash-gray)]"><FlaskConical className="h-3.5 w-3.5" aria-hidden="true" /> New research run</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight text-[var(--color-slate-text)]">Create experiment</h2>
            <p className="mt-2 text-sm text-[var(--color-ash-gray)]">Configure a versioned policy and the complete CNC environment contract.</p>
          </div>
        </header>
        <CreateExperimentForm api={client} onCreated={(id) => router.push(`/experiments/${encodeURIComponent(id)}`)} />
      </main>
    </AppShell>
  );
}
