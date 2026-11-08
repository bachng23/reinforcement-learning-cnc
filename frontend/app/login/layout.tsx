import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Sign in | MCC Workspace" };

export default function LoginLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
