"use client";

import React, { useEffect, useState } from "react";
import {
  Search,
  Plus,
  X,
  Eye,
  EyeOff,
  Pencil,
  Check,
  Power,
} from "lucide-react";
import { useRouter } from "next/navigation";

import { PageHeader } from "@/components/research/page-header";
import { ReviewDialog } from "@/components/research/review-dialog";
import { authFetch, endpoint, getUserFromToken } from "@/lib/auth";

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}
function Avatar({ name }: { name: string }) {
  return (
    <span className="admin-avatar" aria-hidden="true">
      {initials(name)}
    </span>
  );
}

type Role = "ADMIN" | "ENGINEER" | "OPERATOR" | "VIEWER";

function RolePill({ role }: { role: Role }) {
  return <span className="subtle-status">{role}</span>;
}
function ActiveDot({ active }: { active: boolean }) {
  return (
    <span className={`user-status ${active ? "user-active" : ""}`}>
      <span aria-hidden="true" />
      {active ? "Active" : "Inactive"}
    </span>
  );
}
function Switch({
  on,
  onChange,
  label,
}: {
  on: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="user-switch"
    >
      <span className={on ? "switch-on" : ""} aria-hidden="true">
        <span />
      </span>
      {label}
    </button>
  );
}

function FormField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="admin-field">
      <span>{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
function FormInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className="dss-input" />;
}
function FormSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="dss-input"
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}
function PasswordInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <span className="password-field">
      <FormInput
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete="new-password"
      />
      <button
        type="button"
        aria-label={show ? "Hide password" : "Show password"}
        title={show ? "Hide password" : "Show password"}
        onClick={() => setShow((value) => !value)}
      >
        {show ? (
          <EyeOff size={17} aria-hidden="true" />
        ) : (
          <Eye size={17} aria-hidden="true" />
        )}
      </button>
    </span>
  );
}

type User = {
  id: string;
  name: string;
  username: string;
  email: string;
  role: Role;
  active: boolean;
  lastLogin: string;
  lastLoginFull: string;
};

type RawUser = {
  id?: string;
  username?: string;
  fullName?: string | null;
  email?: string | null;
  role?: string;
  active?: boolean;
  lastLoginAt?: string | null;
};

function asRole(value: unknown): Role {
  return value === "ADMIN" ||
    value === "ENGINEER" ||
    value === "OPERATOR" ||
    value === "VIEWER"
    ? value
    : "VIEWER";
}

function formatLastLogin(value?: string | null) {
  if (!value) return { lastLogin: "Never", lastLoginFull: "-" };

  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    return { lastLogin: "Unknown", lastLoginFull: value };

  return {
    lastLogin: new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date),
    lastLoginFull: date.toLocaleString("en-US"),
  };
}

function normalizeUser(user: RawUser): User {
  const name = user.fullName?.trim() || user.username || "Unnamed user";
  const login = formatLastLogin(user.lastLoginAt);

  return {
    id: user.id ?? user.username ?? "",
    name,
    username: user.username ?? "",
    email: user.email ?? "",
    role: asRole(user.role),
    active: Boolean(user.active),
    lastLogin: login.lastLogin,
    lastLoginFull: login.lastLoginFull,
  };
}

function unwrapUsers(payload: unknown): RawUser[] {
  if (Array.isArray(payload)) return payload as RawUser[];
  if (
    payload &&
    typeof payload === "object" &&
    Array.isArray((payload as { data?: unknown }).data)
  ) {
    return (payload as { data: RawUser[] }).data;
  }
  return [];
}

async function readError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as {
    error?: { message?: string };
    message?: string;
  } | null;
  return payload?.error?.message ?? payload?.message ?? fallback;
}

export function AdminPage() {
  const router = useRouter();
  const [authReady, setAuthReady] = useState(false);
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deactivationUser, setDeactivationUser] = useState<User | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("All roles");

  // Avoid rendering admin controls before role verification.
  useEffect(() => {
    let cancelled = false;
    getUserFromToken().then((user) => {
      if (cancelled) return;
      if (!user || user.role !== "ADMIN") {
        router.replace("/");
        return;
      }
      setAuthReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [router]);

  const [addForm, setAddForm] = useState({
    name: "",
    username: "",
    email: "",
    password: "",
    role: "OPERATOR" as Role,
  });
  const [editForm, setEditForm] = useState<{
    name: string;
    email: string;
    role: Role;
    active: boolean;
    password: string;
  } | null>(null);

  async function loadUsers(signal?: AbortSignal) {
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(endpoint("/api/v1/users"), {
        cache: "no-store",
        headers: { Accept: "application/json" },
        signal,
      });
      if (!response.ok) {
        throw new Error(
          await readError(
            response,
            `Failed to load users (${response.status})`,
          ),
        );
      }
      const payload = await response.json();
      setUsers(
        unwrapUsers(payload)
          .map(normalizeUser)
          .filter((user) => user.id),
      );
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError")
        return;
      setError(
        caught instanceof Error ? caught.message : "Unable to load users.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!authReady) return;
    const controller = new AbortController();
    void loadUsers(controller.signal);
    return () => controller.abort();
  }, [authReady]);

  function openEdit(u: User) {
    setShowAdd(false);
    setEditingId(u.id);
    setEditForm({
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active,
      password: "",
    });
  }
  function cancelEdit() {
    setEditingId(null);
    setEditForm(null);
  }
  async function saveEdit() {
    if (!editForm || !editingId) return;
    setSavingId(editingId);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        role: editForm.role,
        active: editForm.active,
        fullName: editForm.name.trim() || null,
        email: editForm.email.trim() || null,
      };
      if (editForm.password.trim()) {
        body.password = editForm.password;
      }
      const response = await authFetch(
        endpoint(`/api/v1/users/${encodeURIComponent(editingId)}`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      if (!response.ok) {
        throw new Error(
          await readError(
            response,
            `Failed to update user (${response.status})`,
          ),
        );
      }
      const payload = await response.json();
      const updated = normalizeUser((payload as { data?: RawUser }).data ?? {});
      setUsers((current) =>
        current.map((user) => (user.id === updated.id ? updated : user)),
      );
      cancelEdit();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to update user.",
      );
    } finally {
      setSavingId(null);
    }
  }
  async function toggleActive(u: User) {
    setSavingId(u.id);
    setError(null);
    try {
      const response = await authFetch(
        endpoint(`/api/v1/users/${encodeURIComponent(u.id)}`),
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({ active: !u.active }),
        },
      );
      if (!response.ok) {
        throw new Error(
          await readError(
            response,
            `Failed to update user (${response.status})`,
          ),
        );
      }
      const payload = await response.json();
      const updated = normalizeUser((payload as { data?: RawUser }).data ?? {});
      setUsers((current) =>
        current.map((user) => (user.id === updated.id ? updated : user)),
      );
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Unable to update user status.",
      );
    } finally {
      setSavingId(null);
    }
  }
  async function submitAdd() {
    if (creating) return;
    if (
      !addForm.name.trim() ||
      !addForm.username.trim() ||
      addForm.password.length < 8
    ) {
      setError("Enter a name, username and password of at least 8 characters.");
      return;
    }
    setCreating(true);
    setError(null);
    try {
      const trimmedEmail = addForm.email.trim();
      const response = await authFetch(endpoint("/api/v1/users"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          username: addForm.username,
          password: addForm.password,
          fullName: addForm.name,
          ...(trimmedEmail ? { email: trimmedEmail } : {}),
          role: addForm.role,
        }),
      });
      if (!response.ok) {
        throw new Error(
          await readError(
            response,
            `Failed to create user (${response.status})`,
          ),
        );
      }
      const payload = await response.json();
      const created = normalizeUser((payload as { data?: RawUser }).data ?? {});
      if (!created.id) throw new Error("Backend returned a user without an id");
      setUsers((current) => [created, ...current]);
      setAddForm({
        name: "",
        username: "",
        email: "",
        password: "",
        role: "OPERATOR",
      });
      setShowAdd(false);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to create user.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function deleteUser(u: User) {
    if (savingId) return;
    setSavingId(u.id);
    setError(null);
    try {
      const response = await authFetch(
        endpoint(`/api/v1/users/${encodeURIComponent(u.id)}`),
        {
          method: "DELETE",
          headers: { Accept: "application/json" },
        },
      );
      if (!response.ok) {
        throw new Error(
          await readError(
            response,
            `Failed to delete user (${response.status})`,
          ),
        );
      }
      // Keep soft-deleted users visible so an admin can reactivate them.
      setUsers((current) =>
        current.map((user) =>
          user.id === u.id ? { ...user, active: false } : user,
        ),
      );
      setDeactivationUser(null);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Unable to delete user.",
      );
    } finally {
      setSavingId(null);
    }
  }

  if (!authReady)
    return (
      <div className="dss-page" role="status">
        Verifying administrator access…
      </div>
    );
  const filtered = users.filter(
    (user) =>
      (roleFilter === "All roles" || user.role === roleFilter) &&
      (!search.trim() ||
        `${user.name} ${user.username}`
          .toLowerCase()
          .includes(search.toLowerCase())),
  );
  const roles = ["ADMIN", "ENGINEER", "OPERATOR", "VIEWER"];
  return (
    <main className="dss-page">
      <PageHeader
        title="User management"
        description="Manage workspace access for operators, engineers and reviewers."
        actions={
          <button
            type="button"
            disabled={loading}
            className="primary-action"
            onClick={() => {
              setShowAdd((value) => !value);
              setEditingId(null);
            }}
          >
            <Plus size={17} aria-hidden="true" />
            Add user
          </button>
        }
      />
      <div className="admin-summary">
        <span>
          <strong>{users.length}</strong> accounts
        </span>
        <span>
          <strong>{users.filter((user) => user.active).length}</strong> active
        </span>
        <span>Administrator access required</span>
      </div>
      {error && (
        <div className="data-notice notice-danger" role="alert">
          <p>{error}</p>
          <button
            type="button"
            onClick={() => void loadUsers()}
            className="text-action"
          >
            Retry loading
          </button>
        </div>
      )}
      {showAdd && (
        <section
          className="dss-panel admin-form-panel"
          aria-labelledby="add-user-heading"
        >
          <div className="section-heading">
            <div>
              <h2 id="add-user-heading">Create new user</h2>
              <p>Set credentials and assign the appropriate role.</p>
            </div>
            <button
              type="button"
              className="secondary-action"
              disabled={creating}
              aria-label="Close new user form"
              onClick={() => setShowAdd(false)}
            >
              <X size={17} aria-hidden="true" />
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitAdd();
            }}
          >
            <div className="admin-form-grid">
              <FormField label="Full name">
                <FormInput
                  value={addForm.name}
                  required
                  onChange={(event) =>
                    setAddForm({ ...addForm, name: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Username">
                <FormInput
                  value={addForm.username}
                  required
                  autoComplete="off"
                  onChange={(event) =>
                    setAddForm({ ...addForm, username: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Email" hint="Optional">
                <FormInput
                  type="email"
                  value={addForm.email}
                  onChange={(event) =>
                    setAddForm({ ...addForm, email: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Password" hint="At least 8 characters">
                <PasswordInput
                  value={addForm.password}
                  onChange={(event) =>
                    setAddForm({ ...addForm, password: event.target.value })
                  }
                />
              </FormField>
              <FormField label="Role">
                <FormSelect
                  value={addForm.role}
                  onChange={(value) =>
                    setAddForm({ ...addForm, role: value as Role })
                  }
                  options={roles}
                />
              </FormField>
            </div>
            <div className="form-actions">
              <button
                type="submit"
                className="primary-action"
                disabled={creating}
              >
                {creating ? "Creating…" : "Create user"}
              </button>
              <button
                type="button"
                className="secondary-action"
                disabled={creating}
                onClick={() => setShowAdd(false)}
              >
                Cancel
              </button>
              <p>
                Share sign-in credentials through your organization’s approved
                channel.
              </p>
            </div>
          </form>
        </section>
      )}
      <section className="dss-panel user-register" aria-label="User directory">
        <div className="user-filters">
          <label className="search-field">
            <Search size={17} aria-hidden="true" />
            <input
              aria-label="Search users"
              placeholder="Search name or username"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label>
            Role
            <select
              aria-label="Filter users by role"
              value={roleFilter}
              onChange={(event) => setRoleFilter(event.target.value)}
              className="dss-input"
            >
              <option>All roles</option>
              {roles.map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
          </label>
          <span>{filtered.length} accounts shown</span>
        </div>
        <div
          className="table-scroll"
          tabIndex={0}
          role="region"
          aria-label="User directory data"
        >
          <table className="dss-table">
            <thead>
              <tr>
                <th scope="col">User</th>
                <th scope="col">Username</th>
                <th scope="col">Role</th>
                <th scope="col" className="status-cell">
                  Status
                </th>
                <th scope="col">Last login</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan={6}>
                    <p className="directory-state" role="status">
                      Loading users…
                    </p>
                  </td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <p className="directory-state">
                      No users match the current filters.
                    </p>
                  </td>
                </tr>
              )}
              {!loading &&
                filtered.map((user) => (
                  <React.Fragment key={user.id}>
                    <tr>
                      <th scope="row">
                        <span className="user-name">
                          <Avatar name={user.name} />
                          <span>
                            <strong>{user.name}</strong>
                            <span>{user.email || "No email provided"}</span>
                          </span>
                        </span>
                      </th>
                      <td>{user.username}</td>
                      <td>
                        <RolePill role={user.role} />
                      </td>
                      <td className="status-cell">
                        <ActiveDot active={user.active} />
                      </td>
                      <td>
                        <time title={user.lastLoginFull}>{user.lastLogin}</time>
                      </td>
                      <td>
                        <div className="user-actions">
                          <button
                            type="button"
                            disabled={savingId !== null}
                            className="secondary-action"
                            aria-label={`Edit ${user.name}`}
                            onClick={() =>
                              editingId === user.id
                                ? cancelEdit()
                                : openEdit(user)
                            }
                          >
                            <Pencil size={15} aria-hidden="true" />
                            Edit
                          </button>
                          <button
                            type="button"
                            disabled={savingId !== null}
                            className="secondary-action"
                            aria-label={`${user.active ? "Deactivate" : "Activate"} ${user.name}`}
                            onClick={() =>
                              user.active
                                ? setDeactivationUser(user)
                                : void toggleActive(user)
                            }
                          >
                            <Power size={15} aria-hidden="true" />
                          </button>
                        </div>
                      </td>
                    </tr>
                    {editingId === user.id && editForm && (
                      <tr>
                        <td colSpan={6} className="user-edit-cell">
                          <form
                            onSubmit={(event) => {
                              event.preventDefault();
                              void saveEdit();
                            }}
                          >
                            <h3>Edit {user.name}</h3>
                            <div className="admin-form-grid">
                              <FormField label="Full name">
                                <FormInput
                                  value={editForm.name}
                                  onChange={(event) =>
                                    setEditForm({
                                      ...editForm,
                                      name: event.target.value,
                                    })
                                  }
                                />
                              </FormField>
                              <FormField label="Email">
                                <FormInput
                                  type="email"
                                  value={editForm.email}
                                  onChange={(event) =>
                                    setEditForm({
                                      ...editForm,
                                      email: event.target.value,
                                    })
                                  }
                                />
                              </FormField>
                              <FormField label="Role">
                                <FormSelect
                                  value={editForm.role}
                                  onChange={(value) =>
                                    setEditForm({
                                      ...editForm,
                                      role: value as Role,
                                    })
                                  }
                                  options={roles}
                                />
                              </FormField>
                              <FormField
                                label="New password"
                                hint="Leave blank to keep current password"
                              >
                                <PasswordInput
                                  value={editForm.password}
                                  onChange={(event) =>
                                    setEditForm({
                                      ...editForm,
                                      password: event.target.value,
                                    })
                                  }
                                />
                              </FormField>
                            </div>
                            <div className="form-actions">
                              <Switch
                                on={editForm.active}
                                onChange={(active) =>
                                  setEditForm({ ...editForm, active })
                                }
                                label="Account active"
                              />
                              <button
                                type="submit"
                                className="primary-action"
                                disabled={savingId !== null}
                              >
                                <Check size={16} aria-hidden="true" />
                                {savingId ? "Saving…" : "Save changes"}
                              </button>
                              <button
                                type="button"
                                className="secondary-action"
                                disabled={savingId !== null}
                                onClick={cancelEdit}
                              >
                                Cancel
                              </button>
                            </div>
                          </form>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
            </tbody>
          </table>
        </div>
      </section>
      <p className="page-footnote">
        Role and account changes are saved by the connected backend.
      </p>
      {deactivationUser && (
        <ReviewDialog
          labelledBy="deactivate-title"
          busy={savingId !== null}
          onClose={() => setDeactivationUser(null)}
        >
          <h2 id="deactivate-title">Deactivate {deactivationUser.name}?</h2>
          <p>
            This account will lose sign-in access. The record remains available
            for reactivation.
          </p>
          <div className="form-actions">
            <button
              type="button"
              className="secondary-action"
              disabled={savingId !== null}
              onClick={() => setDeactivationUser(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="danger-action"
              disabled={savingId !== null}
              onClick={() => void deleteUser(deactivationUser)}
            >
              {savingId ? "Deactivating…" : "Deactivate account"}
            </button>
          </div>
        </ReviewDialog>
      )}
    </main>
  );
}
