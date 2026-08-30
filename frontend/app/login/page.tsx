"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { LoginPage } from "@/components/pages/login-page";
import { hasToken, login } from "@/lib/auth";

export default function Page() {
  const router = useRouter();

  useEffect(() => {
    void hasToken().then((loggedIn) => {
      if (loggedIn) router.replace("/");
    });
  }, [router]);

  async function handleSubmit(username: string, password: string) {
    await login(username, password);
    router.replace("/");
  }

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-canvas-fog)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "32px 24px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <LoginPage onSubmit={handleSubmit} />
    </main>
  );
}
