import Link from "next/link";
import { FileQuestion } from "lucide-react";
export default function NotFound() {
  return (
    <main className="system-state">
      <div>
        <FileQuestion size={32} aria-hidden="true" />
        <h1>Page not found</h1>
        <p>The page may have moved or the address may be incomplete.</p>
        <Link href="/overview" className="primary-action">
          Open overview
        </Link>
      </div>
    </main>
  );
}
