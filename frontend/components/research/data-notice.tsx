import { Database, FlaskConical, Info } from "lucide-react";
import { getProductApiMode } from "@/lib/product-api";

export function DataNotice({
  demo = false,
  simulation = false,
}: {
  demo?: boolean;
  simulation?: boolean;
}) {
  const sample = demo || getProductApiMode() === "mock";
  const Icon = simulation ? FlaskConical : sample ? Info : Database;
  return (
    <div
      className={`data-notice ${simulation ? "notice-simulation" : ""}`}
      role="note"
    >
      <Icon size={16} aria-hidden="true" />
      <p>
        {simulation ? (
          <>
            <strong>Scenario sandbox.</strong> Recorded demo outcomes. Running a
            scenario does not change a committed schedule.
          </>
        ) : sample ? (
          <>
            <strong>Demo data.</strong> Sample records for exploring this
            workspace.
          </>
        ) : (
          <>
            <strong>Persisted records.</strong> Values come from the connected
            API. Missing values remain unavailable.
          </>
        )}
      </p>
    </div>
  );
}
