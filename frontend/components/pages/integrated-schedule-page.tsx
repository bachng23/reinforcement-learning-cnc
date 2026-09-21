"use client";

import Link from "next/link";
import { useState } from "react";

import { OperationsPanel, OperationsShell } from "@/components/operations/operations-shell";
import { ScheduleGantt } from "@/components/operations/schedule-gantt";
import { getOperationsFixture } from "@/lib/operations/fixtures";

export function IntegratedSchedulePage() {
  const fixture = getOperationsFixture();
  const snapshot = fixture.factory_snapshot;
  const current = snapshot.current_schedule;
  const proposed = fixture.recommendation.candidate_plans.find((plan) => plan.candidate_plan_id === fixture.recommendation.recommended_plan_id)?.schedule;
  const [machine, setMachine] = useState("");
  const [type, setType] = useState("");
  return (
    <OperationsShell title="Integrated Schedule / Gantt" description="Current and proposed production, maintenance and technician assignments within the returned planning window.">
      <OperationsPanel title="Schedule filters" description="Filters change presentation only; they do not create a schedule revision.">
        <div className="grid gap-3 p-4 sm:grid-cols-2 sm:p-5">
          <label className="text-xs font-semibold">Machine<select aria-label="Filter schedule by machine" value={machine} onChange={(event) => setMachine(event.target.value)} className="mt-1 block w-full rounded-md border border-[var(--color-stone-border)] bg-white p-2 text-sm"><option value="">All machines</option>{snapshot.machines.map((item) => <option key={item.machine_id} value={item.machine_id}>{item.machine_id} · {item.display_name}</option>)}</select></label>
          <label className="text-xs font-semibold">Assignment type<select aria-label="Filter schedule by assignment type" value={type} onChange={(event) => setType(event.target.value)} className="mt-1 block w-full rounded-md border border-[var(--color-stone-border)] bg-white p-2 text-sm"><option value="">All assignment types</option><option value="PRODUCTION">Production</option><option value="MAINTENANCE">Maintenance</option><option value="BLOCKED_TIME">Blocked time</option></select></label>
        </div>
      </OperationsPanel>
      {current ? <OperationsPanel title="Current committed schedule" description="Machine lanes plus technician lanes derived from the assignment resource references."><ScheduleGantt schedule={current} snapshot={snapshot} riskReports={fixture.risk_reports} label="Current plan" machineFilter={machine} assignmentTypeFilter={type} /></OperationsPanel> : null}
      {proposed ? <OperationsPanel title="Proposed recommended schedule" description="Dashed blocks are returned PROPOSED assignments. Risk, priority and dependencies are direct joins to contract entities."><ScheduleGantt schedule={proposed} snapshot={snapshot} riskReports={fixture.risk_reports} label="Balanced candidate" machineFilter={machine} assignmentTypeFilter={type} /></OperationsPanel> : null}
      <div className="grid gap-3 sm:grid-cols-2"><button type="button" disabled className="rounded-md border border-dashed bg-white p-4 text-left text-sm text-[var(--color-ash-gray)] disabled:opacity-100"><strong className="block text-[var(--color-slate-text)]">Manual patch editor</strong><span className="mt-1 block text-xs">Interaction boundary reserved; modifications must be revalidated before commit.</span></button><Link href="/operations/what-if" className="rounded-md border border-[var(--color-stone-border)] bg-white p-4 text-left text-sm text-[var(--color-ash-gray)] transition-colors hover:bg-stone-50"><strong className="block text-[var(--color-slate-text)]">Open what-if workspace</strong><span className="mt-1 block text-xs">Compare SIMULATION_ONLY outcomes without changing the current schedule.</span></Link></div>
    </OperationsShell>
  );
}
