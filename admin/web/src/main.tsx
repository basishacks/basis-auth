import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useParams, useLocation } from "react-router-dom";

// ---------------------------------------------------------------------------
// API client: injects the CSRF header on mutations and surfaces step-up
// challenges to the UI as a re-authentication redirect.
// ---------------------------------------------------------------------------

let csrfToken = "";

export async function api(path: string, options: RequestInit = {}): Promise<any> {
  const response = await fetch(`/api${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      ...options.headers,
    },
  });
  if (response.status === 401) {
    const body = await response.json().catch(() => undefined);
    if (body?.error === "step_up_required") {
      window.location.href = (await startLogin()).redirectTo;
      return new Promise(() => undefined);
    }
    throw new Error("unauthorized");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description ?? body.error ?? `HTTP ${response.status}`);
  return body;
}

interface Me {
  userId: string;
  email: string;
  permissions: string[];
  csrfToken: string;
  authTime: string;
}

const AuthContext = createContext<{ me: Me | null; reload: () => void }>({ me: null, reload: () => undefined });
const useAuth = () => useContext(AuthContext);

async function startLogin(): Promise<string> {
  const response = await fetch("/auth/start");
  const body = await response.json().catch(() => ({}) as any);
  if (!response.ok || typeof body.redirectTo !== "string") {
    throw new Error(body.error_description ?? "Could not start sign-in");
  }
  return body.redirectTo as string;
}

function useApi<T>(path: string | null): T | undefined {
  const [data, setData] = useState<T>();
  const { me } = useAuth();
  useEffect(() => {
    if (!me || !path) return;
    let cancelled = false;
    api(path).then((value) => !cancelled && setData(value)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [path, me]);
  return data;
}

// ---------------------------------------------------------------------------
// Shared components
// ---------------------------------------------------------------------------

function Table({ head, rows }: { head: string[]; rows: React.ReactNode[][] }) {
  return (
    <table>
      <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.length === 0 && <tr><td colSpan={head.length} className="muted">Nothing here yet.</td></tr>}
        {rows.map((row, index) => (
          <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}

function TypeToConfirm({ label, expected, onConfirm }: { label: string; expected: string; onConfirm: () => void }) {
  const [text, setText] = useState("");
  return (
    <span className="row">
      <input placeholder={expected} value={text} onChange={(event) => setText(event.target.value)} />
      <button className="danger" disabled={text !== expected} onClick={onConfirm}>{label}</button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function Login() {
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setError(null);
    startLogin()
      .then((redirectTo) => {
        if (!cancelled) window.location.href = redirectTo;
      })
      .catch((cause: Error) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);
  if (error) {
    return (
      <div className="card" style={{ maxWidth: 480, margin: "4rem auto" }}>
        <h3>Cannot start sign-in</h3>
        <p>{error}</p>
        <button onClick={() => setAttempt((n) => n + 1)}>Retry</button>
      </div>
    );
  }
  return <p>Redirecting to sign-in…</p>;
}

function Dashboard() {
  const data = useApi<{
    counters: Record<string, number>;
    recentAudit: any[];
    recentSignIns: any[];
    hygieneAlerts: any[];
  }>("/dashboard/summary");
  useEffect(() => {
    const timer = setInterval(() => useAuthContextReload(), 30_000);
    return () => clearInterval(timer);
  }, []);
  const useAuthContextReload = useAuth().reload;
  if (!data) return <p>Loading…</p>;
  return (
    <>
      <h2>Overview</h2>
      <div className="grid">
        {Object.entries(data.counters).map(([key, value]) => (
          <div className="card" key={key}><strong style={{ fontSize: "1.6rem" }}>{value}</strong><br /><span className="muted">{key.replace(/([A-Z])/g, " $1")}</span></div>
        ))}
      </div>
      <div className="card"><h3>Recent audit events</h3>
        <Table head={["When", "Actor", "Action", "Target"]} rows={(data.recentAudit ?? []).map((e) => [new Date(e.createdAt).toLocaleString(), e.actorEmail ?? "—", e.action, e.targetId])} />
      </div>
      <div className="card"><h3>Recent sign-ins</h3>
        <Table head={["When", "User", "Kind", "Result"]} rows={(data.recentSignIns ?? []).map((e) => [new Date(e.createdAt).toLocaleString(), e.email ?? "—", e.kind, e.success ? "OK" : "FAILED"])} />
      </div>
      <div className="card"><h3>Hygiene alerts</h3>
        <Table head={["Application", "Last secret use", "Next expiry"]} rows={(data.hygieneAlerts ?? []).map((c) => [c.name ?? c.clientId, c.lastUsedAt ? new Date(c.lastUsedAt).toLocaleDateString() : "never", c.nextExpiry ? new Date(c.nextExpiry).toLocaleDateString() : "—"])} />
      </div>
    </>
  );
}

function Users() {
  const [query, setQuery] = useState("");
  const data = useApi<{ users: any[] }>(`/users?query=${encodeURIComponent(query)}`);
  return (
    <>
      <h2>Users</h2>
      <input placeholder="Search…" value={query} onChange={(event) => setQuery(event.target.value)} />
      <Table
        head={["Email", "Name", "Provider", "Status"]}
        rows={(data?.users ?? []).map((u) => [
          <Link to={`/users/${u.id}`}>{u.email}</Link>,
          u.displayName ?? "—",
          u.provider,
          u.disabled ? <span className="danger">disabled</span> : "active",
        ])}
      />
    </>
  );
}

function UserDetail() {
  const { id } = useParams();
  const data = useApi<{ user: any }>(id ? `/users/${id}` : null);
  const { reload } = useAuth();
  if (!data?.user) return <p>Loading…</p>;
  const user = data.user;
  return (
    <>
      <h2>{user.email} {user.privileged && <span className="muted">(privileged)</span>}</h2>
      <div className="card">
        <div className="row">
          <span>{user.provider}</span>
          <span>{user.disabled ? "disabled" : "active"}</span>
          <button onClick={() => api(`/users/${id}/${user.disabled ? "enable" : "disable"}`, { method: "POST" }).then(reload)}>Disable/Enable</button>
          <button onClick={() => api(`/users/${id}/force-signout`, { method: "POST" }).then(() => alert("Signed out everywhere"))}>Force sign-out</button>
          <button onClick={() => api(`/users/${id}/credentials/reset`, { method: "POST" }).then((r) => alert(`New temporary password (shown once):\n\n${r.tempPassword}`))}>Reset credentials</button>
        </div>
      </div>
    </>
  );
}

function Clients() {
  const data = useApi<{ clients: any[] }>("/clients");
  return (
    <>
      <h2>Applications</h2>
      <Table
        head={["Client ID", "Name", "Type", "", ""]}
        rows={(data?.clients ?? []).map((cl) => [
          cl.clientId,
          String(cl.metadata?.name ?? ""),
          cl.metadata?.public ? "public" : "confidential",
          <button onClick={() => api(`/clients/${cl.clientId}/secrets`, { method: "POST", body: JSON.stringify({ name: `secret-${Date.now()}` }) }).then((r) => alert(`New secret (shown once):\n\n${r.secret}`))}>Add secret</button>,
          <TypeToConfirm label="Delete" expected={cl.clientId.slice(0, 8)} onConfirm={() => api(`/clients/${cl.clientId}`, { method: "DELETE" }).then(reloadGlobal)} />,
        ])}
      />
    </>
  );
}

function Resources() {
  const data = useApi<{ resources: any[] }>("/resources");
  return (
    <>
      <h2>Resources</h2>
      <Table head={["Audience", "Scopes"]} rows={(data?.resources ?? []).map((r) => [r.audience, (r.scopes ?? []).join(", ")])} />
    </>
  );
}

function SessionsTokens() {
  const sessions = useApi<{ sessions: any[] }>("/sessions");
  const tokens = useApi<{ tokens: any[] }>("/tokens");
  const { reload } = useAuth();
  return (
    <>
      <h2>Sessions &amp; Tokens</h2>
      <div className="card"><h3>Live sessions</h3>
        <Table head={["User", "Created", "Expires", ""]} rows={(sessions?.sessions ?? []).map((s) => [s.email, new Date(s.createdAt).toLocaleString(), new Date(s.expiresAt).toLocaleString(),
          <button onClick={() => api(`/sessions/${s.id}/revoke`, { method: "POST" }).then(reload)}>Revoke</button>])} />
      </div>
      <div className="card"><h3>Refresh token families</h3>
        <Table head={["User", "Client", "Created", ""]} rows={(tokens?.tokens ?? []).map((t) => [t.email ?? t.userId, t.clientId, new Date(t.createdAt).toLocaleString(),
          <button onClick={() => api(`/tokens/family/${t.familyId}/revoke`, { method: "POST" }).then(reload)}>Revoke family</button>])} />
      </div>
    </>
  );
}

function Audit() {
  const data = useApi<{ events: any[] }>("/audit");
  return (
    <>
      <h2>Audit trail</h2>
      <Table head={["When", "Actor", "Action", "Target type", "Target"]}
        rows={(data?.events ?? []).map((e) => [new Date(e.createdAt).toLocaleString(), e.actorEmail ?? "—", e.action, e.targetType, e.targetId])} />
    </>
  );
}

function SignIns() {
  const data = useApi<{ events: any[] }>("/signins");
  return (
    <>
      <h2>Sign-in activity</h2>
      <Table head={["When", "User", "Kind", "Client", "Result", "IP"]}
        rows={(data?.events ?? []).map((e) => [new Date(e.createdAt).toLocaleString(), e.email ?? "—", e.kind, e.clientId ?? "—", e.success ? "success" : "failure", e.ip ?? "—"])} />
    </>
  );
}

function Settings() {
  return (
    <>
      <h2>Settings</h2>
      <div className="card">
        <h3>Emergency lockout</h3>
        <p className="muted">Blocks every portal API for all administrators until disabled. Requires fresh sign-in.</p>
        <TypeToConfirm label="Lock the portal" expected="LOCK" onConfirm={() =>
          api("/settings/lockout", { method: "PUT", body: JSON.stringify({ locked: true, confirm: "LOCK" }) }).then(() => location.reload())} />
      </div>
    </>
  );
}

let reloadGlobal = () => undefined;

function Shell() {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const load = useCallback(() => {
    fetch("/api/me")
      .then(async (response) => {
        if (!response.ok) throw new Error("anonymous");
        const body = await response.json();
        csrfToken = body.csrfToken;
        setMe(body);
      })
      .catch(() => setFailed(true));
  }, []);
  useEffect(load, [load]);
  reloadGlobal = load;
  const location = useLocation();
  const links = [["/", "Dashboard"], ["/users", "Users"], ["/apps", "Apps"], ["/resources", "Resources"], ["/sessions", "Sessions"], ["/audit", "Audit"], ["/signins", "Sign-ins"], ["/settings", "Settings"]] as const;
  if (failed && !location.pathname.startsWith("/auth")) return <Navigate to="/auth/start-sso" replace />;
  return (
    <AuthContext.Provider value={{ me, reload: load }}>
      <div className="sidebar">
        <strong>Basis Admin</strong><br /><span className="muted">{me?.email}</span><hr />
        {links.map(([to, label]) => <Link key={to} to={to} className={location.pathname === to ? "active" : ""}>{label}</Link>)}
        <hr />
        <a href="#" onClick={() => api("/auth/logout", { method: "POST" }).then(() => location.assign("/"))}>Sign out</a>
      </div>
      <main>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/users" element={<Users />} />
          <Route path="/users/:id" element={<UserDetail />} />
          <Route path="/apps" element={<Clients />} />
          <Route path="/resources" element={<Resources />} />
          <Route path="/sessions" element={<SessionsTokens />} />
          <Route path="/audit" element={<Audit />} />
          <Route path="/signins" element={<SignIns />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </AuthContext.Provider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth/start-sso" element={<Login />} />
        <Route path="/auth/callback" element={() => { window.location.replace("/"); return null; }} />
        <Route path="/*" element={<Shell />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
