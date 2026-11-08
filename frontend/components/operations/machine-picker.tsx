"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import type { FactoryMachineStatus } from "@/lib/operations-ui/factory-replay";

export type MachinePickerItem = {
  id: string;
  name: string;
  status: FactoryMachineStatus | "UNKNOWN";
};
const groups: { status: MachinePickerItem["status"]; label: string }[] = [
  { status: "RISK", label: "At risk" },
  { status: "FAULTED", label: "Faulted" },
  { status: "OPERATING", label: "Operating normally" },
  { status: "MAINTENANCE", label: "Under maintenance" },
  { status: "UNKNOWN", label: "Status not reported" },
];

export function MachinePicker({
  items,
  selectedId,
  onSelect,
}: {
  items: readonly MachinePickerItem[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const wrapper = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, [open]);
  const matching = items.filter((item) =>
    `${item.id} ${item.name}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  );
  return (
    <div
      className="machine-picker"
      ref={wrapper}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        type="button"
        ref={trigger}
        className="secondary-action machine-picker-trigger"
        aria-label="Select machine"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => {
          setOpen(!open);
          setSearch("");
        }}
      >
        Select machine <span>{selectedId}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          className="machine-picker-popover"
          role="dialog"
          aria-label="Machine directory"
          id={id}
        >
          <div className="machine-picker-heading">
            <strong>Machines</strong>
            <span>{items.length} recorded</span>
          </div>
          <label className="table-search machine-picker-search">
            <Search size={16} aria-hidden="true" />
            <span className="sr-only">Search machines</span>
            <input
              ref={input}
              type="search"
              placeholder="Search machine ID or name"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <div className="machine-picker-groups">
            {groups.map((group) => {
              const all = items.filter((item) => item.status === group.status);
              const visible = matching.filter(
                (item) => item.status === group.status,
              );
              if (search && visible.length === 0) return null;
              if (group.status === "UNKNOWN" && all.length === 0) return null;
              return (
                <section
                  key={group.status}
                  aria-label={group.label}
                  className="machine-picker-group"
                >
                  <h3>
                    <span
                      className={`status-dot status-${group.status.toLowerCase()}`}
                    />
                    {group.label}
                    <span>{search ? visible.length : all.length}</span>
                  </h3>
                  {visible.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={`Inspect ${item.id} ${item.name}`}
                      aria-pressed={item.id === selectedId}
                      onClick={() => {
                        setOpen(false);
                        setSearch("");
                        onSelect(item.id);
                      }}
                    >
                      <span>
                        <strong>{item.id}</strong>
                        <span>{item.name}</span>
                      </span>
                      {item.id === selectedId && (
                        <Check size={16} aria-hidden="true" />
                      )}
                    </button>
                  ))}
                  {all.length === 0 && <p>No recorded machines</p>}
                </section>
              );
            })}
            {matching.length === 0 && (
              <p className="machine-picker-empty">
                No machines match this search.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
