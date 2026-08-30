"use client";

import { Eye, EyeOff, FlaskConical, LogIn } from "lucide-react";
import { useState, type FormEvent } from "react";

type LoginState = "idle" | "loading" | "error";

export function LoginPage({
  onSubmit,
}: {
  onSubmit: (username: string, password: string) => Promise<void>;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [state, setState] = useState<LoginState>("idle");
  const [error, setError] = useState("Invalid username or password.");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!username.trim() || !password) {
      setError("Username and password are required.");
      setState("error");
      return;
    }

    setState("loading");
    try {
      await onSubmit(username.trim(), password);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to sign in.");
      setState("error");
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="mb-6 flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-md bg-[var(--color-slate-text)] text-white">
          <FlaskConical className="h-5 w-5" aria-hidden="true" />
        </span>
        <div>
          <p className="text-base font-semibold text-[var(--color-slate-text)]">CNC Research Console</p>
          <p className="text-xs text-[var(--color-ash-gray)]">Tool replacement experiments</p>
        </div>
      </div>

      <div className="rounded-md border bg-white p-6 shadow-sm" style={{ borderColor: "var(--color-stone-border)" }}>
        <h1 className="text-lg font-semibold text-[var(--color-slate-text)]">Sign in</h1>
        <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
          {state === "error" && (
            <p role="alert" className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
              {error}
            </p>
          )}

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-slate-text)]">Username</span>
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => {
                setUsername(event.target.value);
                if (state === "error") setState("idle");
              }}
              className="h-10 w-full rounded-md border bg-white px-3 text-sm outline-none focus:ring-2 focus:ring-sky-200"
              style={{ borderColor: "var(--color-platinum-outline)" }}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-xs font-medium text-[var(--color-slate-text)]">Password</span>
            <span className="relative block">
              <input
                type={showPassword ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(event) => {
                  setPassword(event.target.value);
                  if (state === "error") setState("idle");
                }}
                className="h-10 w-full rounded-md border bg-white px-3 pr-10 text-sm outline-none focus:ring-2 focus:ring-sky-200"
                style={{ borderColor: "var(--color-platinum-outline)" }}
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide password" : "Show password"}
                title={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute right-1 top-1 grid h-8 w-8 place-items-center rounded-md text-[var(--color-ash-gray)]"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </span>
          </label>

          <button
            type="submit"
            disabled={state === "loading"}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-[var(--color-slate-text)] px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            <LogIn className="h-4 w-4" aria-hidden="true" />
            {state === "loading" ? "Signing in..." : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
