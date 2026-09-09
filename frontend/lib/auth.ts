const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/+$/, "") ?? "";

/** Signals that authFetch already started a login redirect. */
export class AuthRedirectError extends Error {
  constructor() {
    super("Authentication required. Redirecting to sign in.");
    this.name = "AuthRedirectError";
  }
}

export type TokenUser = {
  id: string;
  role: string;
  username?: string;
  fullName?: string;
};

export function endpoint(path: string) {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return API_BASE_URL ? `${API_BASE_URL}${normalized}` : normalized;
}

/** @deprecated Authentication uses an httpOnly cookie. */
export function getToken(): null { return null; }

/** @deprecated Authentication uses an httpOnly cookie. */
export function setToken(_token: string): void {}

/** @deprecated Use logout(). */
export function clearToken(): void {}

export async function hasToken(): Promise<boolean> {
  try {
    const res = await fetch(endpoint("/api/v1/auth/me"), {
      credentials: "include",
      cache: "no-store",
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function getUserFromToken(): Promise<TokenUser | null> {
  try {
    const res = await fetch(endpoint("/api/v1/auth/me"), {
      credentials: "include",
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = await res.json() as { success?: boolean; user?: TokenUser };
    const u = body.user;
    if (!u?.id || !u?.role) return null;
    return { id: u.id, role: u.role, username: u.username, fullName: u.fullName };
  } catch {
    return null;
  }
}

export function redirectToLogin() {
  if (typeof window === "undefined") return;
  if (window.location.pathname !== "/login") {
    window.location.assign("/login");
  }
}

export async function withAuthHeaders(headers?: HeadersInit): Promise<Headers> {
  const nextHeaders = new Headers(headers);
  return nextHeaders;
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const response = await fetch(input, {
    ...init,
    credentials: "include",
  });

  if (response.status === 401 || response.status === 403) {
    redirectToLogin();
    // Stop callers from parsing a response while the redirect is in flight.
    throw new AuthRedirectError();
  }

  return response;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function getErrorMessage(payload: unknown, fallback: string) {
  const record = asRecord(payload);
  const error = asRecord(record.error);
  const message = record.message ?? error.message;
  return typeof message === "string" && message.trim() ? message : fallback;
}

export async function login(username: string, password: string): Promise<TokenUser> {
  const response = await fetch(endpoint("/api/v1/auth/login"), {
    method: "POST",
    credentials: "include",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ username, password }),
  });

  let payload: Record<string, unknown> | null = null;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new Error(getErrorMessage(payload, "Invalid username or password."));
  }

  const user = asRecord(payload?.user);
  return {
    id: String(user.id ?? ""),
    role: String(user.role ?? ""),
    username: typeof user.username === "string" ? user.username : undefined,
    fullName: typeof user.fullName === "string" ? user.fullName : undefined,
  };
}

export async function logout(): Promise<void> {
  try {
    await fetch(endpoint("/api/v1/auth/logout"), {
      method: "POST",
      credentials: "include",
    });
  } catch {
    // Logout must still return the user to login when offline.
  }
  redirectToLogin();
}
