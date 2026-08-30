import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Sign in | CNC Research Console" };

export default function LoginLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
