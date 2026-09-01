import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  CreateExperimentForm,
} from "@/components/pages/create-experiment-page";
import { ProductApiError } from "@/lib/product-api/errors";
import {
  MOCK_EXPERIMENT_DETAILS,
  MOCK_POLICY_CATALOG,
} from "@/lib/product-api/fixtures";
import { createProductApiStub, deferred } from "@/tests/product-api-test-utils";
import type {
  CreateExperimentRequest,
  ExperimentDetail,
} from "@/types/product-api";

function formApi(
  createExperiment: (
    payload: CreateExperimentRequest,
  ) => Promise<ExperimentDetail>,
) {
  return createProductApiStub({
    listPolicies: vi.fn(async () => MOCK_POLICY_CATALOG),
    createExperiment,
  });
}

async function waitForPolicyCatalog() {
  await waitFor(() => {
    expect(screen.getByRole("button", { name: "Create experiment" })).toBeEnabled();
  });
}

describe("CreateExperimentForm", () => {
  it("shows required and basic numeric validation without submitting", async () => {
    const user = userEvent.setup();
    const createExperiment = vi.fn(async () => MOCK_EXPERIMENT_DETAILS[0]);

    render(
      <CreateExperimentForm
        api={formApi(createExperiment)}
        onCreated={vi.fn()}
      />,
    );
    await waitForPolicyCatalog();

    await user.clear(screen.getByLabelText("Number of episodes"));
    await user.type(screen.getByLabelText("Number of episodes"), "0");
    await user.clear(screen.getByLabelText("Spare capacity"));
    await user.type(screen.getByLabelText("Spare capacity"), "1");
    await user.clear(screen.getByLabelText("Failure threshold (µm)"));
    await user.type(screen.getByLabelText("Failure threshold (µm)"), "0");
    await user.clear(screen.getByLabelText("CVaR alpha"));
    await user.type(screen.getByLabelText("CVaR alpha"), "1");
    await user.click(screen.getByRole("button", { name: "Create experiment" }));

    expect(await screen.findByText("Experiment name is required.")).toBeInTheDocument();
    expect(screen.getByText("Number of episodes must be at least 1.")).toBeInTheDocument();
    expect(screen.getByText("Initial spares cannot exceed spare capacity.")).toBeInTheDocument();
    expect(screen.getByText("Failure threshold must be greater than 0.")).toBeInTheDocument();
    expect(screen.getByText("CVaR alpha must be greater than 0 and less than 1.")).toBeInTheDocument();
    expect(createExperiment).not.toHaveBeenCalled();
  });

  it("submits the complete contract payload once and reports success", async () => {
    const user = userEvent.setup();
    const pendingCreate = deferred<ExperimentDetail>();
    const createExperiment = vi.fn(
      (_payload: CreateExperimentRequest) => pendingCreate.promise,
    );
    const onCreated = vi.fn();
    const createdExperiment: ExperimentDetail = {
      ...MOCK_EXPERIMENT_DETAILS[0],
      id: "experiment-created-by-test",
    };

    render(
      <CreateExperimentForm
        api={formApi(createExperiment)}
        onCreated={onCreated}
      />,
    );
    await waitForPolicyCatalog();

    await user.type(screen.getByLabelText("Experiment name"), "  Week 1 validation  ");
    await user.type(
      screen.getByLabelText("Description (optional)"),
      "  Payload remains contract shaped  ",
    );
    await user.clear(screen.getByLabelText("Number of episodes"));
    await user.type(screen.getByLabelText("Number of episodes"), "3");

    const submit = screen.getByRole("button", { name: "Create experiment" });
    const form = submit.closest("form");
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    fireEvent.submit(form!);

    await waitFor(() => expect(createExperiment).toHaveBeenCalledTimes(1));
    expect(createExperiment.mock.calls[0][0]).toStrictEqual({
      name: "Week 1 validation",
      description: "Payload remains contract shaped",
      policy_id: "policy-risk-aware-v2",
      policy_version: "2.1.0",
      number_of_episodes: 3,
      environment_config: {
        schema_version: "2.0",
        environment_id: "cnc-shared-spares",
        number_of_machines: 3,
        spare_capacity: 2,
        initial_spares: 2,
        horizon_steps: 100,
        failure_threshold_um: 300,
        seed: 42,
        costs: {
          replacement_cost: 25,
          failure_cost: 500,
          waiting_cost_per_step: 10,
          unused_life_cost_per_step: 0.5,
        },
        risk: {
          objective: "CVAR",
          cvar_alpha: 0.95,
        },
      },
    });
    expect(screen.getByRole("button", { name: /Creating experiment/ })).toBeDisabled();

    await act(async () => {
      pendingCreate.resolve(createdExperiment);
      await pendingCreate.promise;
    });

    await waitFor(() => {
      expect(onCreated).toHaveBeenCalledTimes(1);
      expect(onCreated).toHaveBeenCalledWith("experiment-created-by-test");
    });
  });

  it("renders backend field and request errors without calling the success callback", async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    const createExperiment = vi.fn(async () => {
      throw new ProductApiError("Backend validation failed.", {
        status: 422,
        fieldErrors: {
          "environment_config.initial_spares": [
            "Initial inventory was rejected by the Product API.",
          ],
        },
      });
    });

    render(
      <CreateExperimentForm
        api={formApi(createExperiment)}
        onCreated={onCreated}
      />,
    );
    await waitForPolicyCatalog();

    await user.type(screen.getByLabelText("Experiment name"), "Backend validation case");
    await user.click(screen.getByRole("button", { name: "Create experiment" }));

    expect(await screen.findByText("Backend validation failed.")).toBeInTheDocument();
    expect(
      screen.getByText("Initial inventory was rejected by the Product API."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Initial spares")).toHaveAttribute("aria-invalid", "true");
    expect(createExperiment).toHaveBeenCalledTimes(1);
    expect(onCreated).not.toHaveBeenCalled();
  });
});
