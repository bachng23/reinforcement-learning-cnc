"use client";

import { Eye, EyeOff, LogIn } from "lucide-react";
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
    <div className="login-form">
      <h2>Sign in to your workspace</h2>
      <p>Use the credentials provided by your administrator.</p>
      <form onSubmit={handleSubmit}>
        {state === "error" && (
          <p role="alert" className="login-error">
            {error}
          </p>
        )}
        <label htmlFor="login-username">Username</label>
        <input
          id="login-username"
          autoComplete="username"
          required
          autoFocus
          value={username}
          onChange={(event) => {
            setUsername(event.target.value);
            if (state === "error") setState("idle");
          }}
          className="dss-input"
        />
        <label htmlFor="login-password">Password</label>
        <div className="password-field">
          <input
            id="login-password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            required
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (state === "error") setState("idle");
            }}
            className="dss-input"
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            title={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((value) => !value)}
          >
            {showPassword ? (
              <EyeOff size={18} aria-hidden="true" />
            ) : (
              <Eye size={18} aria-hidden="true" />
            )}
          </button>
        </div>
        <button
          type="submit"
          disabled={state === "loading"}
          className="primary-action"
        >
          <LogIn size={17} aria-hidden="true" />
          {state === "loading" ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="login-help">
        Need access? Contact your workspace administrator.
      </p>
    </div>
  );
}
