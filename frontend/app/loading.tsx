import { LoaderCircle } from "lucide-react";
export default function Loading() {
  return (
    <main className="system-state" role="status" aria-busy="true">
      <div>
        <LoaderCircle
          size={28}
          className="animate-spin motion-reduce:animate-none"
          aria-hidden="true"
        />
        <p>Opening your workspace…</p>
      </div>
    </main>
  );
}
