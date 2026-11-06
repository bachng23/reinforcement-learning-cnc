import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkOrderAccess } from "@/components/work-orders/work-orders-frame";
import { createWorkOrdersClient, WorkOrdersError, type WorkOrdersClient } from "@/lib/work-orders/client";
import { clearWorkOrderMemory, useWorkOrderIntent } from "@/lib/work-orders/use-work-order-intent";
import type { TokenUser } from "@/lib/auth";
import { workOrderActor } from "./work-order-fixtures";

beforeEach(() => clearWorkOrderMemory());
function RecoveryProbe({ api, actor }: { api: WorkOrdersClient; actor: TokenUser }) {
  const intent = useWorkOrderIntent({ api, actor, scope: "gate-test", send: async () => { throw new TypeError("Lost response"); }, onAccepted: vi.fn() });
  return <section aria-label="Protected form"><button onClick={() => intent.start({ reason: "Private in-memory reason" })}>Send test intent</button><p>{intent.state.kind}</p><p>{intent.original ? "Original intent retained" : "No original intent"}</p></section>;
}
describe("access revalidation and uncertain intent retention", () => {
  it.each([0, 401] as const)("hides old data on identity failure %s; only definite access loss clears the original intent", async status => {
    const user = userEvent.setup(); const api = createWorkOrdersClient();
    const identity = vi.spyOn(api, "identity").mockResolvedValue(workOrderActor);
    render(<WorkOrderAccess api={api} factoryId="factory-A">{actor => <RecoveryProbe api={api} actor={actor} />}</WorkOrderAccess>);
    await user.click(await screen.findByRole("button", { name: "Send test intent" }));
    await screen.findByText("uncertain");
    expect(screen.getByText("Original intent retained")).toBeInTheDocument();
    identity.mockRejectedValueOnce(new WorkOrdersError(status, status ? "UNAUTHORIZED" : "NETWORK_ERROR"));
    fireEvent.focus(window);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Protected form" })).not.toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText(status ? "No original intent" : "Original intent retained")).toBeInTheDocument();
  });
});
