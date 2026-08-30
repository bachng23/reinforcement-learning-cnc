import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: "CNC Research Console",
  description: "Risk-aware multi-agent CNC tool replacement research platform",
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
