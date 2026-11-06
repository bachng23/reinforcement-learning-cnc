import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { MachineInspector } from "@/components/operations/machine-inspector";
import scenario from "../../contracts/v3/examples/demo-scenario.json";
import type { FactorySnapshot } from "@/types/generated/operations";
import { machineStatuses } from "@/lib/operations-api/overview";

function observation() {
  const snapshot = structuredClone(scenario.factory_snapshot) as unknown as FactorySnapshot;
  return { ...snapshot, machines: snapshot.machines.map((machine, index) => ({ ...machine, status: machineStatuses[index] })) as typeof snapshot.machines };
}

describe("canonical machine inspector", () => {
  it("groups all six source statuses and searches by name/ID without selecting by priority", async () => {
    const user = userEvent.setup();
    render(<MachineInspector snapshot={observation()} />);
    expect(screen.queryByRole("region", { name: "Selected machine detail" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose machine" }));
    for (const status of machineStatuses) expect(screen.getByRole("group", { name: `${status} (1)` })).toBeInTheDocument();
    await user.type(screen.getByRole("combobox", { name: "Search machines" }), "m06");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("group", { name: "UNAVAILABLE (1)" })).toHaveTextContent("CNC M06");
    await user.keyboard("{Enter}");
    expect(screen.getByRole("region", { name: "Selected machine detail" })).toHaveTextContent("UNAVAILABLE");
    expect(screen.getByRole("link", { name: "Browse factory cases" })).toHaveAttribute("href", `/operations/cases?factory_id=${observation().factory_id}`);
    expect(screen.queryByText(/case of M06/)).not.toBeInTheDocument();
  });

  it("supports keyboard movement/selection/Escape and restores focus on close", async () => {
    const user = userEvent.setup();
    render(<MachineInspector snapshot={observation()} />);
    const trigger = screen.getByRole("button", { name: "Choose machine" });
    trigger.focus();
    await user.keyboard("{Enter}");
    expect(screen.getByRole("combobox")).toHaveFocus();
    await user.keyboard("{ArrowDown}{Enter}");
    await waitFor(() => expect(screen.getByRole("heading", { name: "CNC M02" })).toHaveFocus());
    await user.click(screen.getByRole("button", { name: "Close machine detail" }));
    expect(trigger).toHaveFocus();
    await user.keyboard("{Enter}{End}{Home}{Escape}");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("renders only returned measurements/provenance and resets on factory/removed machine", async () => {
    const user = userEvent.setup();
    const snapshot = observation();
    const view = render(<MachineInspector snapshot={snapshot} />);
    await user.click(screen.getByRole("button", { name: "Choose machine" }));
    await user.type(screen.getByRole("combobox"), "m03");
    await user.keyboard("{Enter}");
    const health = snapshot.health_snapshots!.find(item => item.machine_id === "M03")!;
    const measurements = within(screen.getByRole("region", { name: "Selected machine detail" }));
    expect(measurements.getByText(health.confidence)).toBeInTheDocument();
    expect(measurements.getByLabelText("Measurement provenance")).toHaveTextContent(health.source_model_version);
    expect(measurements.getByText(/No sensor history API is available/)).toBeInTheDocument();
    view.rerender(<MachineInspector snapshot={{ ...snapshot, factory_id: "another-factory" }} />);
    expect(screen.queryByRole("region", { name: "Selected machine detail" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Choose machine" }));
    await user.keyboard("{Enter}");
    view.rerender(<MachineInspector snapshot={{ ...snapshot, factory_id: "another-factory", machines: snapshot.machines.slice(1) as typeof snapshot.machines }} />);
    expect(screen.queryByRole("region", { name: "Selected machine detail" })).not.toBeInTheDocument();
  });
});
