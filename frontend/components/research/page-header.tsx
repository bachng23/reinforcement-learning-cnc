import { ChevronRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type BreadcrumbItem = {
  label: string;
  href?: string;
};

export type BreadcrumbsProps = {
  items: BreadcrumbItem[];
  className?: string;
};

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  return (
    <nav className={cn("min-w-0", className)} aria-label="Breadcrumb">
      <ol className="flex min-w-0 flex-wrap items-center gap-y-1 text-[13px] text-[var(--color-ash-gray)]">
        {items.map((item, index) => {
          const current = index === items.length - 1;

          return (
            <li
              key={`${item.label}-${index}`}
              className="flex min-w-0 items-center"
            >
              {index > 0 ? (
                <ChevronRight
                  className="mx-1.5 h-3.5 w-3.5 shrink-0"
                  aria-hidden="true"
                />
              ) : null}
              {item.href && !current ? (
                <Link
                  href={item.href}
                  className="max-w-56 truncate rounded-sm transition-colors hover:text-[var(--color-slate-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-chartwell-blue)]"
                  title={item.label}
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={cn(
                    "max-w-56 truncate",
                    current && "font-medium text-[var(--color-slate-text)]",
                  )}
                  aria-current={current ? "page" : undefined}
                  title={item.label}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export type PageHeaderProps = {
  title: string;
  hideTitle?: boolean;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  eyebrow?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({
  title,
  hideTitle = false,
  description,
  breadcrumbs,
  eyebrow,
  actions,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("page-header min-w-0 pb-2", className)}>
      {breadcrumbs?.length ? <Breadcrumbs items={breadcrumbs} /> : null}

      <div
        className={cn(
          "flex min-w-0 flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
          breadcrumbs?.length && "mt-3",
        )}
      >
        <div className="min-w-0">
          {hideTitle ? (
            <h1 className="sr-only">{title}</h1>
          ) : (
            <h1 className="break-words text-[32px] font-semibold leading-tight tracking-[-0.035em] text-[var(--color-slate-text)]">
              {title}
            </h1>
          )}
          {description ? (
            <p className="mt-2 max-w-3xl break-words text-base leading-6 text-[var(--color-ash-gray)]">
              {description}
            </p>
          ) : null}
          {eyebrow ? (
            <div className="mt-3 text-sm text-[var(--color-ash-gray)]">
              {eyebrow}
            </div>
          ) : null}
        </div>

        {actions ? (
          <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">
            {actions}
          </div>
        ) : null}
      </div>
    </header>
  );
}
