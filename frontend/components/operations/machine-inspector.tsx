"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ChevronDown, Cpu, Search, X } from "lucide-react";
import { OperationsPanel, OperationsStatus } from "./operations-shell";
import { machineStatuses } from "@/lib/operations-api/overview";
import { operationsHref } from "@/lib/operations-ui";
import { formatDateTime, formatNumber, formatPercent } from "@/lib/operations/format";
import type { FactorySnapshot, HealthSnapshot, Machine } from "@/types/generated/operations";

function Measurement({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0 rounded-lg border border-slate-200 bg-white p-4"><dt className="text-xs text-slate-500">{label}</dt><dd className="mt-2 break-words text-xl font-semibold tabular-nums text-slate-900">{value}</dd></div>;
}

function MachineObservation({ machine, health, snapshot, demo }: { machine: Machine; health?: HealthSnapshot; snapshot: FactorySnapshot; demo: boolean }) {
  return <div className="space-y-5">
    <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Machine measurements">
      <Measurement label="Health index" value={health ? formatPercent(health.health_index) : "Chưa có dữ liệu"} />
      <Measurement label="Failure probability" value={health ? formatPercent(health.failure_probability) : "Chưa có dữ liệu"} />
      <Measurement label="Observed wear" value={health?.observed_wear_um === undefined || health.observed_wear_um === null ? "Chưa có dữ liệu" : formatNumber(health.observed_wear_um, " µm")} />
      <Measurement label="Model confidence" value={health?.confidence ?? "Chưa có dữ liệu"} />
    </dl>
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-xs leading-6 text-slate-600" aria-label="Measurement provenance">
      <p className="break-all"><strong>Factory / snapshot:</strong> {snapshot.factory_id} / {snapshot.snapshot_id}</p>
      <p><strong>Snapshot captured:</strong> {formatDateTime(snapshot.captured_at)}</p>
      {health ? <><p className="break-all"><strong>Observation / source:</strong> {health.health_snapshot_id} / {health.source_model_version}</p><p><strong>Observed at:</strong> {formatDateTime(health.observed_at)} · <strong>Failure horizon:</strong> {health.failure_probability_horizon_minutes} min (provided by source)</p></> : <p>No health observation was supplied for this machine. Unknown is not healthy, zero risk or zero wear.</p>}
    </div>
    {health?.rul_distribution ? <div className="overflow-x-auto rounded-lg border border-slate-200" role="region" aria-label="Returned RUL distribution" tabIndex={0}>
      <table className="w-full text-sm"><caption className="p-4 text-left text-xs text-slate-600">Returned RUL distribution · {health.rul_distribution.model_version}. No expected RUL is calculated.</caption><thead className="bg-slate-50"><tr><th className="p-3 text-right font-medium">RUL support (min)</th><th className="p-3 text-right font-medium">Probability mass</th></tr></thead><tbody>{health.rul_distribution.support_minutes.map((minutes, index) => <tr key={`${minutes}:${index}`} className="border-t"><td className="p-3 text-right font-mono tabular-nums">{minutes}</td><td className="p-3 text-right font-mono tabular-nums">{formatPercent(health.rul_distribution!.probability_mass[index])}</td></tr>)}</tbody></table><p className="border-t p-3 text-xs text-slate-600">Survival beyond horizon: {formatPercent(health.rul_distribution.survival_beyond_horizon)}</p>
    </div> : null}
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-slate-300 p-4"><p className="max-w-2xl text-xs leading-5 text-slate-500">No sensor history API is available. These are snapshot measurements, not a trend, utilization series or inferred risk classification. The API does not confirm a machine-to-case relationship.</p><Link href={operationsHref("/operations/cases", snapshot.factory_id, { demo })} className="dss-secondary">Browse factory cases</Link></div>
    <div className="overflow-x-auto rounded-lg border border-slate-200" role="region" aria-label="Machine capabilities" tabIndex={0}><table className="w-full min-w-[400px] text-sm"><caption className="p-4 text-left font-medium">Capabilities · {machine.machine_family}</caption><thead className="bg-slate-50 text-xs text-slate-500"><tr><th className="p-3 text-left font-medium">Operation</th><th className="p-3 text-right font-medium">Nominal processing time (min)</th></tr></thead><tbody>{machine.capabilities.map((capability, index) => <tr key={`${capability.operation_type}:${index}`} className="border-t"><td className="p-3">{capability.operation_type}</td><td className="p-3 text-right font-mono tabular-nums">{capability.nominal_processing_minutes}</td></tr>)}</tbody></table></div>
  </div>;
}

/** Pure canonical snapshot presentation. No fixture/replay imports, M03 special
 * case, API request, inferred health/risk threshold or machine-to-case mapping.
 */
export function MachineInspector({ snapshot, demo = false }: { snapshot: FactorySnapshot; demo?: boolean }) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const detail = useRef<HTMLHeadingElement>(null);
  const previousFactory = useRef(snapshot.factory_id);
  const selected = snapshot.machines.find(machine => machine.machine_id === selectedId);
  const health = selected ? snapshot.health_snapshots?.find(item => item.machine_id === selected.machine_id) : undefined;
  const groups = useMemo(() => machineStatuses.map(status => ({ status, machines: snapshot.machines.filter(machine => machine.status === status && `${machine.machine_id} ${machine.display_name} ${machine.machine_family}`.toLowerCase().includes(search.trim().toLowerCase())) })), [snapshot.machines, search]);
  const options = groups.flatMap(group => group.machines);
  const activeId = options[Math.min(activeIndex, options.length - 1)]?.machine_id;
  useEffect(() => {
    if (previousFactory.current !== snapshot.factory_id || (selectedId && !selected)) { setSelectedId(null); setOpen(false); }
    previousFactory.current = snapshot.factory_id;
  }, [snapshot.factory_id, selected, selectedId]);
  useEffect(() => {
    if (open && dialog.current) {
      if (typeof dialog.current.showModal === "function" && !dialog.current.open) dialog.current.showModal();
      else dialog.current.setAttribute("open", "");
      searchInput.current?.focus();
    }
  }, [open]);
  useEffect(() => { if (selectedId) detail.current?.focus(); }, [selectedId]);
  useEffect(() => {
    if (open && activeId) document.getElementById(`machine-option-${activeId}`)?.scrollIntoView?.({ block: "nearest" });
  }, [open, activeId]);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const choose = (machine: Machine) => { setSelectedId(machine.machine_id); setOpen(false); requestAnimationFrame(() => detail.current?.focus()); };
  function keyboard(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); setActiveIndex(index => options.length ? (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length : 0); }
    if (event.key === "Home" || event.key === "End") { event.preventDefault(); setActiveIndex(event.key === "Home" ? 0 : Math.max(0, options.length - 1)); }
    if (event.key === "Enter" && options[activeIndex]) { event.preventDefault(); choose(options[activeIndex]); }
  }
  return <OperationsPanel title="Machine investigation" description="Choose a machine to inspect the current observation. No automatic or priority-based machine selection.">
    <div className="space-y-5 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-sm text-slate-500">{snapshot.machines.length} machines in this returned snapshot · six canonical status groups</p><button ref={trigger} type="button" className="dss-primary" aria-haspopup="dialog" aria-expanded={open} onClick={() => { setSearch(""); setActiveIndex(0); setOpen(true); }}><Cpu className="h-4 w-4" />Choose machine<ChevronDown className="h-4 w-4" /></button></div>
      {selected ? <section aria-label="Selected machine detail" className="space-y-5"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><h3 ref={detail} tabIndex={-1} className="break-words text-lg font-semibold outline-none">{selected.display_name}</h3><p className="mt-1 break-all font-mono text-xs text-slate-500">{selected.machine_id} · {selected.machine_family}</p><div className="mt-2"><OperationsStatus value={selected.status} /></div></div><button type="button" className="dss-secondary" onClick={() => { setSelectedId(null); trigger.current?.focus(); }}>Close machine detail</button></div><MachineObservation machine={selected} health={health} snapshot={snapshot} demo={demo} /></section> : <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-5 py-8 text-sm text-slate-500">Select a machine to see measurements, observation provenance and available capabilities.</div>}
    </div>
    {open ? <dialog ref={dialog} aria-labelledby="machine-picker-title" className="fixed inset-0 z-50 m-auto max-h-[85dvh] w-[calc(100%-3rem)] max-w-2xl overflow-y-auto rounded-xl border border-slate-200 bg-white p-0 shadow-2xl backdrop:bg-slate-950/40" onCancel={event => { event.preventDefault(); close(); }}>
      <div className="sticky top-0 z-10 space-y-4 border-b bg-white p-5"><div className="flex items-center justify-between gap-3"><h2 id="machine-picker-title" className="text-lg font-semibold">Choose machine</h2><button type="button" aria-label="Close machine picker" className="dss-secondary" onClick={close}><X className="h-4 w-4" /></button></div><label className="flex items-center gap-2 rounded-lg border px-3"><Search className="h-4 w-4 text-slate-400" /><input ref={searchInput} role="combobox" aria-label="Search machines" aria-autocomplete="list" aria-expanded={true} aria-controls="machine-options" aria-activedescendant={activeId ? `machine-option-${activeId}` : undefined} value={search} onKeyDown={keyboard} onChange={event => { setSearch(event.target.value); setActiveIndex(0); }} className="min-h-11 w-full bg-transparent text-sm outline-none" placeholder="Name, ID or machine family" /></label></div>
      <div id="machine-options" role="listbox" aria-label="Machines by status" className="space-y-4 p-5">{groups.map(group => <div role="group" aria-label={`${group.status} (${group.machines.length})`} key={group.status}><p className="mb-2 text-xs font-semibold text-slate-500">{group.status} <span className="font-mono tabular-nums">({group.machines.length})</span></p>{group.machines.map(machine => <button type="button" role="option" aria-selected={machine.machine_id === activeId} id={`machine-option-${machine.machine_id}`} key={machine.machine_id} onClick={() => choose(machine)} className={`flex w-full items-center justify-between gap-4 rounded-lg border px-3 py-3 text-left ${machine.machine_id === activeId ? "border-blue-400 bg-blue-50" : "border-transparent hover:bg-slate-50"}`}><span className="min-w-0"><span className="block break-words text-sm font-medium">{machine.display_name}</span><span className="block break-all font-mono text-xs text-slate-500">{machine.machine_id}</span></span><OperationsStatus value={machine.status} /></button>)}</div>)}</div>
      {!options.length ? <p role="status" className="px-5 pb-5 text-sm text-slate-500">No machines match this search.</p> : null}
    </dialog> : null}
  </OperationsPanel>;
}
