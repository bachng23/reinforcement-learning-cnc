import { BookOpenCheck, FlaskConical, GitBranch, ListChecks } from "lucide-react";

import { AppShell } from "@/components/app-shell";

const counters = [
  { label: "Experiments", value: 0, icon: FlaskConical },
  { label: "Episodes", value: 0, icon: ListChecks },
  { label: "Policies", value: 0, icon: GitBranch },
];

export function DashboardPage() {
  return (
    <AppShell title="Research overview">
      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <section className="border-b pb-6" style={{ borderColor: "var(--color-stone-border)" }}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase text-[var(--color-ash-gray)]">CNC tool replacement</p>
              <h2 className="mt-1 text-2xl font-semibold text-[var(--color-slate-text)]">Experiment workspace</h2>
            </div>
            <span className="rounded-md border bg-white px-2.5 py-1 text-xs font-medium text-[var(--color-ash-gray)]" style={{ borderColor: "var(--color-stone-border)" }}>
              Contract v2.0
            </span>
          </div>
        </section>

        <section className="grid gap-3 py-6 sm:grid-cols-3" aria-label="Workspace totals">
          {counters.map(({ label, value, icon: Icon }) => (
            <article key={label} className="rounded-md border bg-white p-4" style={{ borderColor: "var(--color-stone-border)" }}>
              <div className="flex items-center justify-between">
                <p className="text-sm text-[var(--color-ash-gray)]">{label}</p>
                <Icon className="h-4 w-4 text-[var(--color-chartwell-blue)]" aria-hidden="true" />
              </div>
              <p className="mt-3 text-2xl font-semibold text-[var(--color-slate-text)]">{value}</p>
            </article>
          ))}
        </section>

        <section className="border-t py-12 text-center" style={{ borderColor: "var(--color-stone-border)" }}>
          <BookOpenCheck className="mx-auto h-7 w-7 text-[var(--color-ash-gray)]" aria-hidden="true" />
          <h3 className="mt-3 text-sm font-semibold text-[var(--color-slate-text)]">No experiments yet</h3>
          <p className="mt-1 text-sm text-[var(--color-ash-gray)]">The workspace is ready for the first research adapter.</p>
        </section>
      </main>
    </AppShell>
  );
}
