import type { ReactNode } from "react";

import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DecisionCenterPage } from "@/components/pages/decision-center-page";
import { DecisionDetailPage } from "@/components/pages/decision-detail-page";
import { AuthRedirectError } from "@/lib/auth";
import { MockDecisionApiClient } from "@/lib/decision-api/mock";
import { ProductApiError } from "@/lib/product-api/errors";
import { deferred } from "@/tests/product-api-test-utils";
import type { DecisionQueueItem } from "@/types/decision";

vi.mock("next/navigation", () => ({
  useParams: () => ({}),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

async function renderPending(api: MockDecisionApiClient) {
  const row = (await api.listQueue()).find((item) => item.machineId === "machine-01" && item.step === 1);
  if (!row) throw new Error("Pending decision fixture was not found.");
  render(<DecisionDetailPage api={api} canReview rowId={row.rowId} />);
  expect(await screen.findByRole("heading", { name: "Why this recommendation?" }))
    .toBeInTheDocument();
}

describe("Decision Center", () => {
  it("renders and filters the queue, then links View to a dedicated detail route", async () => {
    const user = userEvent.setup();
    render(<DecisionCenterPage api={new MockDecisionApiClient()} />);

    expect(await screen.findByText("4 of 4 machine recommendations", { exact: false }))
      .toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by workflow status" }), "APPROVED");
    expect(screen.getByText("2 of 4 machine recommendations", { exact: false }))
      .toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Filter by workflow status" }), "");

    const link = screen.getByRole("link", { name: "View decision detail for machine-01 at step 1" });
    expect(link.getAttribute("href")).toMatch(/^\/decisions\//);
    expect(screen.queryByRole("heading", { name: "Why this recommendation?" }))
      .not.toBeInTheDocument();
  });

  it("loads policy, RUL context and audit state on the dedicated detail page", async () => {
    await renderPending(new MockDecisionApiClient());
    expect(screen.getByText("Policy recommendation and defer consequence")).toBeInTheDocument();
    expect(screen.getByText("Returned RUL distribution · machine-01")).toBeInTheDocument();
    expect(screen.getByText("Review not opened")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to queue" })).toHaveAttribute("href", "/decisions");
  });

  it.each(["approve", "reject"] as const)("submits %s once and refreshes status/history", async (action) => {
    const user = userEvent.setup();
    const api = new MockDecisionApiClient();
    const submitReview = vi.spyOn(api, "submitReview");
    await renderPending(api);

    await user.click(screen.getByRole("button", { name: action === "approve" ? "Approve" : "Reject" }));
    await user.click(screen.getByRole("button", { name: `Confirm ${action}` }));

    await waitFor(() => expect(submitReview).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(action === "approve" ? "PENDING_REVIEW → APPROVED" : "PENDING_REVIEW → REJECTED"))
      .toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Override" })).not.toBeInTheDocument();
  });

  it("requires a reason and changed full joint action for override", async () => {
    const user = userEvent.setup();
    const api = new MockDecisionApiClient();
    const submitReview = vi.spyOn(api, "submitReview");
    await renderPending(api);

    await user.click(screen.getByRole("button", { name: "Override" }));
    await user.click(screen.getByRole("button", { name: "Confirm override" }));
    expect(screen.getByText("Override reason is required.")).toBeInTheDocument();
    expect(submitReview).not.toHaveBeenCalled();

    await user.type(screen.getByRole("textbox", { name: "Reason (required)" }), "Inspection found different wear.");
    await user.click(screen.getByRole("button", { name: "Confirm override" }));
    expect(screen.getByText("Change at least one machine action to override the policy."))
      .toBeInTheDocument();
    await user.selectOptions(screen.getByRole("combobox", { name: "Action for machine-01" }), "CONTINUE");
    await user.click(screen.getByRole("button", { name: "Confirm override" }));

    await waitFor(() => expect(submitReview).toHaveBeenCalledTimes(1));
    expect(submitReview).toHaveBeenCalledWith(
      expect.any(String),
      "override",
      expect.objectContaining({
        reason: "Inspection found different wear.",
        replacementAction: expect.objectContaining({
          actions: [
            { machine_id: "machine-01", action: "CONTINUE" },
            { machine_id: "machine-02", action: "REPLACE" },
          ],
        }),
      }),
    );
    expect(await screen.findByText("PENDING_REVIEW → OVERRIDDEN")).toBeInTheDocument();
  });

  it("shows loading, empty and network-error states without mock fallback", async () => {
    const pending = deferred<DecisionQueueItem[]>();
    const base = new MockDecisionApiClient();
    const api = {
      listQueue: vi.fn(() => pending.promise),
      getContext: base.getContext.bind(base),
      openReview: base.openReview.bind(base),
      getHistory: base.getHistory.bind(base),
      submitReview: base.submitReview.bind(base),
    };
    const view = render(<DecisionCenterPage api={api} />);
    expect(screen.getByText("Loading decision queue")).toBeInTheDocument();
    pending.resolve([]);
    expect(await screen.findByText("No recommendations returned")).toBeInTheDocument();
    view.unmount();

    render(<DecisionCenterPage api={{
      ...api,
      listQueue: vi.fn(async () => {
        throw new ProductApiError("Unable to reach the Product API.", { status: 0, code: "NETWORK_ERROR" });
      }),
    }} />);
    expect(await screen.findByText(/Network error: Unable to reach/)).toBeInTheDocument();
  });

  it("reconciles a 409 conflict and never resubmits automatically", async () => {
    const user = userEvent.setup();
    const api = new MockDecisionApiClient();
    const submitReview = vi.spyOn(api, "submitReview").mockRejectedValueOnce(
      new ProductApiError("Decision is no longer pending.", { status: 409, code: "INVALID_DECISION_TRANSITION" }),
    );
    await renderPending(api);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Confirm approve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Conflict: Decision is no longer pending.");
    await waitFor(() => expect(submitReview).toHaveBeenCalledTimes(1));
  });

  it("shows an expired-session state without replacing it with mock rows", async () => {
    const base = new MockDecisionApiClient();
    render(<DecisionCenterPage api={{
      listQueue: vi.fn(async () => { throw new AuthRedirectError(); }),
      getContext: base.getContext.bind(base),
      openReview: base.openReview.bind(base),
      getHistory: base.getHistory.bind(base),
      submitReview: base.submitReview.bind(base),
    }} />);

    expect(await screen.findByText("Your session has expired. Redirecting to sign in."))
      .toBeInTheDocument();
    expect(screen.queryByText("Priority queue")).not.toBeInTheDocument();
  });
});
