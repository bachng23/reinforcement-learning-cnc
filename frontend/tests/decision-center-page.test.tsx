import type { ReactNode } from "react";

import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DecisionCenterPage } from "@/components/pages/decision-center-page";
import { AuthRedirectError } from "@/lib/auth";
import { MockDecisionApiClient } from "@/lib/decision-api/mock";
import { ProductApiError } from "@/lib/product-api/errors";
import { deferred } from "@/tests/product-api-test-utils";
import type { DecisionQueueItem } from "@/types/decision";

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

async function openPending(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", {
      name: "Open decision detail for machine-01 at step 1",
    }),
  );
  expect(
    await screen.findByRole("heading", { name: "Why this recommendation?" }),
  ).toBeInTheDocument();
}

describe("DecisionCenterPage", () => {
  it("keeps inspection read-only and allows explicit review of an unlinked recommendation", async () => {
    const user = userEvent.setup();
    const api = new MockDecisionApiClient();
    const originalList = api.listQueue.bind(api);
    vi.spyOn(api, "listQueue").mockImplementation(async () =>
      (await originalList()).map((item) =>
        item.status === "PENDING_REVIEW"
          ? { ...item, status: "NOT_OPENED" }
          : item,
      ),
    );
    const open = vi.spyOn(api, "openReview");
    const submit = vi.spyOn(api, "submitReview");
    render(
      <DecisionCenterPage api={api} canReview initialMachine="machine-01" />,
    );
    expect(
      await screen.findByText("2 of 4 machine recommendations"),
    ).toBeInTheDocument();
    await openPending(user);
    expect(open).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Approve" }));
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("heading", {
        name: "Joint action under review",
      }),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("machine-02")).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(open).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Approve" })).toHaveFocus();
  });

  it("retries failed evidence loading without creating a review", async () => {
    const user = userEvent.setup();
    const api = new MockDecisionApiClient();
    vi.spyOn(api, "getContext").mockRejectedValueOnce(
      new Error("Evidence request failed."),
    );
    const open = vi.spyOn(api, "openReview");
    render(<DecisionCenterPage api={api} canReview />);
    await user.click(
      await screen.findByRole("button", {
        name: "Open decision detail for machine-01 at step 1",
      }),
    );
    expect(
      await screen.findByText("Evidence request failed."),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(
      await screen.findByRole("heading", { name: "Why this recommendation?" }),
    ).toBeInTheDocument();
    expect(open).not.toHaveBeenCalled();
  });

  it("renders the queue, filters it, and opens policy / RUL context", async () => {
    const user = userEvent.setup();
    render(<DecisionCenterPage api={new MockDecisionApiClient()} canReview />);

    expect(
      await screen.findByText("4 of 4 machine recommendations", {
        exact: false,
      }),
    ).toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by workflow status" }),
      "APPROVED",
    );
    expect(
      screen.getByText("2 of 4 machine recommendations", { exact: false }),
    ).toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Filter by workflow status" }),
      "",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Open decision detail for machine-01 at step 1",
      }),
    );
    expect(
      await screen.findByRole("heading", { name: "Why this recommendation?" }),
    ).toBeInTheDocument();

    expect(
      screen.getByText("Policy recommendation and defer consequence"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Returned RUL distribution · machine-01"),
    ).toBeInTheDocument();
    expect(screen.getByText("Review not opened")).toBeInTheDocument();
  });

  it.each(["approve", "reject"] as const)(
    "submits %s once and refreshes status/history",
    async (action) => {
      const user = userEvent.setup();
      const api = new MockDecisionApiClient();
      const submitReview = vi.spyOn(api, "submitReview");
      render(<DecisionCenterPage api={api} canReview />);
      await openPending(user);

      await user.click(
        screen.getByRole("button", {
          name: action === "approve" ? "Approve" : "Reject",
        }),
      );
      await user.click(
        screen.getByRole("button", { name: `Confirm ${action}` }),
      );

      await waitFor(() => expect(submitReview).toHaveBeenCalledTimes(1));
      expect(
        await screen.findByText(
          action === "approve"
            ? "PENDING_REVIEW → APPROVED"
            : "PENDING_REVIEW → REJECTED",
        ),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Override" }),
      ).not.toBeInTheDocument();
    },
  );

  it("requires a reason and changed full joint action for override", async () => {
    const user = userEvent.setup();
    const api = new MockDecisionApiClient();
    const submitReview = vi.spyOn(api, "submitReview");
    render(<DecisionCenterPage api={api} canReview />);
    await openPending(user);

    await user.click(screen.getByRole("button", { name: "Override" }));
    await user.click(screen.getByRole("button", { name: "Confirm override" }));
    expect(
      screen.getByText("Override reason is required."),
    ).toBeInTheDocument();
    expect(submitReview).not.toHaveBeenCalled();

    await user.type(
      screen.getByRole("textbox", { name: "Reason (required)" }),
      "Inspection found different wear.",
    );
    await user.click(screen.getByRole("button", { name: "Confirm override" }));
    expect(
      screen.getByText(
        "Change at least one machine action to override the policy.",
      ),
    ).toBeInTheDocument();
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Action for machine-01" }),
      "CONTINUE",
    );
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
    expect(
      await screen.findByText("PENDING_REVIEW → OVERRIDDEN"),
    ).toBeInTheDocument();
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
    const view = render(<DecisionCenterPage api={api} canReview />);
    expect(screen.getByText("Loading decision queue")).toBeInTheDocument();
    pending.resolve([]);
    expect(
      await screen.findByText("No recommendations returned"),
    ).toBeInTheDocument();
    view.unmount();

    render(
      <DecisionCenterPage
        api={{
          ...api,
          listQueue: vi.fn(async () => {
            throw new ProductApiError("Unable to reach the Product API.", {
              status: 0,
              code: "NETWORK_ERROR",
            });
          }),
        }}
        canReview
      />,
    );
    expect(
      await screen.findByText(/Network error: Unable to reach/),
    ).toBeInTheDocument();
  });

  it("reconciles a 409 conflict and never resubmits automatically", async () => {
    const user = userEvent.setup();
    const api = new MockDecisionApiClient();
    const submitReview = vi
      .spyOn(api, "submitReview")
      .mockRejectedValueOnce(
        new ProductApiError("Decision is no longer pending.", {
          status: 409,
          code: "INVALID_DECISION_TRANSITION",
        }),
      );
    render(<DecisionCenterPage api={api} canReview />);
    await openPending(user);
    await user.click(screen.getByRole("button", { name: "Approve" }));
    await user.click(screen.getByRole("button", { name: "Confirm approve" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Conflict: Decision is no longer pending.",
    );
    await waitFor(() => expect(submitReview).toHaveBeenCalledTimes(1));
  });

  it("shows an expired-session state without replacing it with mock rows", async () => {
    const base = new MockDecisionApiClient();
    render(
      <DecisionCenterPage
        api={{
          listQueue: vi.fn(async () => {
            throw new AuthRedirectError();
          }),
          getContext: base.getContext.bind(base),
          openReview: base.openReview.bind(base),
          getHistory: base.getHistory.bind(base),
          submitReview: base.submitReview.bind(base),
        }}
        canReview
      />,
    );

    expect(
      await screen.findByText(
        "Your session has expired. Redirecting to sign in.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText("Priority queue")).not.toBeInTheDocument();
  });
});
