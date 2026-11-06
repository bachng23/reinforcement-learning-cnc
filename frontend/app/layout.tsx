import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";
import "./research.css";
import "./simulation.css";

export const metadata: Metadata = {
  title: "MCC Workspace",
  description:
    "Maintenance demand and technician capacity coordination: research evidence, comparisons and simulation review",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-body">{children}</body>
    </html>
  );
}
