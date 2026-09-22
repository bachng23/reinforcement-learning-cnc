"use client";

import { Beaker, Bot, CalendarRange, Factory, GitCompareArrows } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell";
import { PageHeader } from "@/components/research/page-header";
import { cn } from "@/lib/utils";

const screens = [
  { href: "/operations", label: "Overview", icon: Factory },
  { href: "/operations/schedule", label: "Integrated Schedule", icon: CalendarRange },
  { href: "/operations/recommendations", label: "Recommendations", icon: GitCompareArrows },
  { href: "/operations/agents", label: "Agent Control Room", icon: Bot },
  { href: "/operations/what-if", label: "What-if", icon: Beaker },
] as const;

export function OperationsShell({
  title,
  description,
  children,
  actions,
  dataSource = "fixture",
}: {
  title: string;
  description: string;
  children: ReactNode;
  actions?: ReactNode;
  dataSource?: "fixture" | "live";
}) {
  const pathname = usePathname();

  return (
    <AppShell title={title}>
      <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <PageHeader
          title={title}
          description={description}
          eyebrow={`Operations contract v3 · ${dataSource === "live" ? "live API" : "fixture preview"}`}
          actions={actions}
        />

        <div className={`rounded-md border px-4 py-3 text-sm ${dataSource === "live" ? "border-sky-200 bg-sky-50 text-sky-900" : "border-amber-200 bg-amber-50 text-amber-900"}`} role="note">
          {dataSource === "live"
            ? "Live Operations API mode. Snapshot and current schedule values are rendered exactly as returned by the backend."
            : "First-pass UI rendered from a contract-shaped fixture. Values are illustrative and no decision is sent to an API."}
        </div>

        <nav className="overflow-x-auto rounded-lg border border-[var(--color-stone-border)] bg-white p-1" aria-label="Operations screens">
          <div className="flex min-w-max gap-1">
            {screens.map(({ href, label, icon: Icon }) => {
              const active = href === "/operations" ? pathname === href : pathname.startsWith(href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors",
                    active ? "bg-[var(--color-sky-tint)] text-[var(--color-slate-text)]" : "text-[var(--color-ash-gray)] hover:bg-stone-50",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </Link>
              );
            })}
          </div>
        </nav>

        {children}
      </main>
    </AppShell>
  );
}

export function OperationsStatus({ value }: { value: string }) {
  const tone = value === "FAILED" || value === "CRITICAL" || value === "INVALID"
    ? "border-rose-200 bg-rose-50 text-rose-800"
    : value === "WARNING" || value === "HIGH" || value === "AWAITING_APPROVAL" || value === "WAITING_FOR_DEPENDENCY"
      ? "border-amber-200 bg-amber-50 text-amber-800"
      : value === "RUNNING" || value === "ASSIGNED" || value === "PROPOSED"
        ? "border-sky-200 bg-sky-50 text-sky-800"
        : value === "COMPLETED" || value === "SUCCEEDED" || value === "VALID" || value === "AVAILABLE"
          ? "border-emerald-200 bg-emerald-50 text-emerald-800"
          : "border-stone-200 bg-stone-50 text-stone-700";
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${tone}`}>{value}</span>;
}

export function OperationsPanel({ title, description, children, className }: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-lg border border-[var(--color-stone-border)] bg-white", className)}>
      <div className="border-b border-[var(--color-stone-border)] px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold text-[var(--color-slate-text)]">{title}</h2>
        {description ? <p className="mt-1 text-xs leading-5 text-[var(--color-ash-gray)]">{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
