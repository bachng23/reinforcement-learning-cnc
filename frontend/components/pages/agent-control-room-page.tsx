import { AgentRunGrid, AgentTraceTimeline } from "@/components/operations/agent-trace-timeline";
import { OperationsPanel, OperationsShell } from "@/components/operations/operations-shell";
import { getOperationsFixture } from "@/lib/operations/fixtures";

export function AgentControlRoomPage() {
  const fixture = getOperationsFixture();
  return (
    <OperationsShell title="Agent Control Room" description="Public agent status, structured messages and sanitized tool-call traces for one Decision Case.">
      <OperationsPanel title="Agent graph" description="First-pass node grid. Status, task, version and tool references come from AgentRunTrace and AgentDefinition.">
        <AgentRunGrid definitions={fixture.agent_definitions} runs={fixture.agent_runs} toolCalls={fixture.tool_calls} />
      </OperationsPanel>
      <OperationsPanel title="Agent trace timeline" description="Select a tool call to inspect sanitized input/output summaries, evidence and retry metadata. Private reasoning is never rendered.">
        <AgentTraceTimeline runs={fixture.agent_runs} toolCalls={fixture.tool_calls} messages={fixture.messages} />
      </OperationsPanel>
    </OperationsShell>
  );
}
