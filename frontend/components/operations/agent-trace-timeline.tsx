"use client";

import { ArrowRight, Bot, Braces, Clock3, MessageSquareText, Wrench } from "lucide-react";
import { useMemo, useState } from "react";

import { OperationsStatus } from "@/components/operations/operations-shell";
import { formatDateTime, formatTime } from "@/lib/operations/format";
import type { AgentDefinition, AgentMessage, AgentRunTrace, ToolCallTrace } from "@/types/operations";

export function AgentRunGrid({ definitions, runs, toolCalls }: { definitions: AgentDefinition[]; runs: AgentRunTrace[]; toolCalls: ToolCallTrace[] }) {
  return (
    <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3 sm:p-5">
      {runs.map((run) => {
        const definition = definitions.find((item) => item.agent_id === run.agent_id);
        const lastToolId = run.tool_call_ids.at(-1);
        const lastTool = toolCalls.find((item) => item.tool_call_id === lastToolId);
        return <article key={run.agent_run_id} className="rounded-lg border border-[var(--color-stone-border)] bg-stone-50 p-4"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" /><div><h3 className="text-sm font-semibold">{definition?.display_name ?? run.role}</h3><p className="font-mono text-[11px] text-[var(--color-ash-gray)]">{run.agent_id} · {run.agent_version}</p></div></div><OperationsStatus value={run.status} /></div><dl className="mt-4 space-y-2 text-xs"><div><dt className="text-[var(--color-ash-gray)]">Current task</dt><dd className="mt-0.5 font-mono">{run.task_id}</dd></div><div><dt className="text-[var(--color-ash-gray)]">Last tool call</dt><dd className="mt-0.5 font-mono">{lastTool?.tool_id ?? "None returned"}</dd></div><div><dt className="text-[var(--color-ash-gray)]">Execution window</dt><dd className="mt-0.5">{run.started_at ? formatTime(run.started_at) : "Not started"}{run.completed_at ? `–${formatTime(run.completed_at)}` : ""}</dd></div></dl></article>;
      })}
    </div>
  );
}

export interface AgentTraceTimelineProps {
  runs: AgentRunTrace[];
  toolCalls: ToolCallTrace[];
  messages: AgentMessage[];
}

export function AgentTraceTimeline({ runs, toolCalls, messages }: AgentTraceTimelineProps) {
  const ordered = useMemo(() => [...toolCalls].sort((a, b) => a.started_at.localeCompare(b.started_at)), [toolCalls]);
  const [selectedId, setSelectedId] = useState(ordered[0]?.tool_call_id ?? "");
  const selected = toolCalls.find((item) => item.tool_call_id === selectedId) ?? null;
  const selectedRun = selected ? runs.find((run) => run.agent_run_id === selected.agent_run_id) : null;
  return (
    <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] sm:p-5">
      <div>
        <ol className="relative space-y-3 border-l border-[var(--color-stone-border)] pl-5">
          {ordered.map((call) => {
            const run = runs.find((item) => item.agent_run_id === call.agent_run_id);
            return <li key={call.tool_call_id} className="relative"><span className="absolute -left-[25px] top-3 h-2 w-2 rounded-full bg-sky-500 ring-4 ring-white" /><button type="button" onClick={() => setSelectedId(call.tool_call_id)} aria-pressed={selectedId === call.tool_call_id} className={`w-full rounded-md border p-3 text-left ${selectedId === call.tool_call_id ? "border-sky-300 bg-sky-50" : "border-[var(--color-stone-border)] bg-white hover:bg-stone-50"}`}><div className="flex flex-wrap items-center justify-between gap-2"><span className="font-mono text-xs text-[var(--color-ash-gray)]">{formatTime(call.started_at)}</span><OperationsStatus value={call.status} /></div><p className="mt-2 flex items-center gap-2 text-sm font-semibold"><Wrench className="h-3.5 w-3.5" />{call.tool_id} <span className="font-normal text-[var(--color-ash-gray)]">by {run?.role ?? call.agent_run_id}</span></p><p className="mt-1 font-mono text-[11px] text-[var(--color-ash-gray)]">{call.tool_call_id}</p></button></li>;
          })}
        </ol>
      </div>
      <aside className="self-start rounded-lg border border-[var(--color-stone-border)] bg-stone-50 p-4 lg:sticky lg:top-24" aria-label="Tool call detail">
        {selected ? <><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase text-[var(--color-ash-gray)]">Sanitized tool trace</p><h3 className="mt-1 font-mono text-sm font-semibold">{selected.tool_id}@{selected.tool_version}</h3></div><OperationsStatus value={selected.status} /></div><dl className="mt-4 grid gap-2 text-xs sm:grid-cols-2"><div><dt className="text-[var(--color-ash-gray)]">Calling agent</dt><dd className="font-semibold">{selectedRun?.role ?? "Not provided"}</dd></div><div><dt className="text-[var(--color-ash-gray)]">Retry count</dt><dd className="font-semibold">{selected.retry_count}</dd></div><div><dt className="text-[var(--color-ash-gray)]">Started</dt><dd>{formatDateTime(selected.started_at)}</dd></div><div><dt className="text-[var(--color-ash-gray)]">Completed</dt><dd>{formatDateTime(selected.completed_at)}</dd></div><div><dt className="text-[var(--color-ash-gray)]">Latency</dt><dd>Not supplied by v3</dd></div><div><dt className="text-[var(--color-ash-gray)]">Error code</dt><dd>{selected.error_code ?? "None"}</dd></div></dl><div className="mt-4"><p className="flex items-center gap-1.5 text-xs font-semibold"><Braces className="h-3.5 w-3.5" />Sanitized input</p><pre className="mt-2 max-h-40 overflow-auto rounded-md bg-white p-3 text-[11px]">{JSON.stringify(selected.input_summary, null, 2)}</pre></div><div className="mt-4"><p className="flex items-center gap-1.5 text-xs font-semibold"><Braces className="h-3.5 w-3.5" />Output summary</p><pre className="mt-2 max-h-40 overflow-auto rounded-md bg-white p-3 text-[11px]">{JSON.stringify(selected.output_summary ?? null, null, 2)}</pre></div><p className="mt-4 text-[11px] text-[var(--color-ash-gray)]">Evidence: {selected.evidence_refs.join(", ") || "None returned"}</p></> : <p className="text-sm text-[var(--color-ash-gray)]">Select a tool call to inspect its public trace.</p>}
      </aside>

      <div className="lg:col-span-2">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><MessageSquareText className="h-4 w-4" />Structured agent messages</h3>
        <div className="space-y-2">{messages.map((message) => { const from = runs.find((run) => run.agent_run_id === message.from_agent_run_id)?.role ?? message.from_agent_run_id; return <article key={message.message_id} className="rounded-md border border-[var(--color-stone-border)] bg-white p-3"><div className="flex flex-wrap items-center gap-2 text-xs"><strong>{from}</strong><ArrowRight className="h-3.5 w-3.5" /><strong>{message.to_agent_role}</strong><span className="ml-auto text-[var(--color-ash-gray)]">{formatTime(message.created_at)}</span></div><p className="mt-2 text-sm font-semibold">{message.subject}</p><pre className="mt-2 overflow-auto rounded bg-stone-50 p-2 text-[11px]">{JSON.stringify(message.payload, null, 2)}</pre></article>; })}</div>
      </div>
    </div>
  );
}
