import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from "react-router-dom";

// ---------------------------------------------------------------------------
// API client
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
      window.location.href = await startLogin();
      return new Promise(() => undefined);
    }
    throw new Error("Your session has expired. Please sign in again.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error_description ?? body.error ?? `Request failed (${response.status})`);
  return body;
}

async function startLogin(): Promise<string> {
  const response = await fetch("/auth/start");
  const body = await response.json().catch(() => ({}) as any);
  if (!response.ok || typeof body.redirectTo !== "string") {
    throw new Error(body.error_description ?? "Could not start sign-in");
  }
  return body.redirectTo as string;
}

function useApi<T>(path: string | null): { data?: T; loading: boolean; error?: string; reload: () => void } {
  const [state, setState] = useState<{ data?: T; loading: boolean; error?: string }>({ loading: true });
  const [nonce, setNonce] = useState(0);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    api(path)
      .then((data) => !cancelled && setState({ data, loading: false }))
      .catch((error: Error) => !cancelled && setState({ loading: false, error: error.message }));
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);
  return { ...state, reload };
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

const fmtDateTime = (value?: string | Date | null) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

const fmtDate = (value?: string | Date | null) =>
  value ? new Date(value).toLocaleDateString() : "—";

function relTime(value?: string | Date | null): string {
  if (!value) return "—";
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

function initials(name?: string | null, email?: string | null): string {
  const source = name || email || "?";
  const parts = source.replace(/@.*/, "").split(/[.\s_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

const cls = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(" ");

// ---------------------------------------------------------------------------
// Icons — inline stroke SVGs, no icon dependency
// ---------------------------------------------------------------------------

type IconProps = { size?: number; title?: string; className?: string };
function Icon({ d, size = 16, extra, title }: { d: string; size?: number; extra?: string; title?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {title ? <title>{title}</title> : null}
      <path d={d} />
      {extra ? <path d={extra} /> : null}
    </svg>
  );
}
const Icons = {
  home: (p: IconProps) => <Icon {...p} d="M3 10.5 12 3l9 7.5M5 9.5V21h14V9.5" />,
  users: (p: IconProps) => <Icon {...p} d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />,
  apps: (p: IconProps) => <Icon {...p} d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z" />,
  layers: (p: IconProps) => <Icon {...p} d="m12 2 9 5-9 5-9-5 9-5Zm9 10-9 5-9-5m18 5-9 5-9-5" />,
  sessions: (p: IconProps) => <Icon {...p} d="M21 12a9 9 0 1 1-9-9c2.5 0 4.8 1 6.4 2.6L21 8M21 3v5h-5" />,
  list: (p: IconProps) => <Icon {...p} d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />,
  fileText: (p: IconProps) => <Icon {...p} d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6ZM14 2v6h6M9 13h6M9 17h6" />,
  gear: (p: IconProps) => <Icon {...p} d="M12 15.5A3.5 3.5 0 1 0 12 8.5a3.5 3.5 0 0 0 0 7Zm7.4-3.5c0-.6-.1-1.1-.2-1.6l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.8-1.6L13.6 2h-3.2L10 4.8a7 7 0 0 0-2.8 1.6l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 3.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.8 1.6l.4 2.8h3.2l.4-2.8a7 7 0 0 0 2.8-1.6l2.4 1 2-3.4-2-1.6c.1-.5.2-1 .2-1.6Z" />,
  search: (p: IconProps) => <Icon {...p} d="m21 21-4.35-4.35M17 11a6 6 0 1 1-12 0 6 6 0 0 1 12 0Z" />,
  menu: (p: IconProps) => <Icon {...p} d="M3 6h18M3 12h18M3 18h18" />,
  sun: (p: IconProps) => <Icon {...p} d="M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Zm0-15v2m0 16v2M4.2 4.2l1.4 1.4m12.8 12.8 1.4 1.4M2 12h2m16 0h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />,
  moon: (p: IconProps) => <Icon {...p} d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />,
  logout: (p: IconProps) => <Icon {...p} d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  copy: (p: IconProps) => <Icon {...p} d="M20 9h-9a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2ZM5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />,
  shield: (p: IconProps) => <Icon {...p} d="M12 22s8-3.6 8-10V5l-8-3-8 3v7c0 6.4 8 10 8 10Z" />,
  key: (p: IconProps) => <Icon {...p} d="M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8Zm0 0L15.5 8m0 0 3 3L22 7.5l-3-3m-3.5 3.5L19 4" />,
  alert: (p: IconProps) => <Icon {...p} d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0ZM12 9v4m0 4h.01" />,
  plus: (p: IconProps) => <Icon {...p} d="M12 5v14M5 12h14" />,
  chevronR: (p: IconProps) => <Icon {...p} d="m9 18 6-6-6-6" />,
  refresh: (p: IconProps) => <Icon {...p} d="M21 12a9 9 0 1 1-2.6-6.4L21 8m0-5v5h-5" />,
};

// ---------------------------------------------------------------------------
// Toasts + modal
// ---------------------------------------------------------------------------

interface Toast { id: number; text: string; kind: "ok" | "err" }
const ToastContext = createContext<(text: string, kind?: "ok" | "err") => void>(() => {
  /* no host mounted yet */
});
const useToast = () => useContext(ToastContext);

function ToastHost({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const push = useCallback((text: string, kind: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, text, kind }]);
    setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), 5200);
  }, []);
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-stack">
        {toasts.map((toast) => (
          <div key={toast.id} className={cls("toast", toast.kind === "err" && "err")}>{toast.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);
  return (
    <div className="backdrop" onClick={onClose}>
      <div className="modal" onClick={(event) => event.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}

function SecretModal({ title, secret, onClose }: { title: string; secret: string; onClose: () => void }) {
  const toast = useToast();
  return (
    <Modal title={title} onClose={onClose}>
      <p style={{ marginTop: 0 }}>
        Copy it now — for security reasons it will never be shown again.
      </p>
      <div className="secret-box">{secret}</div>
      <div className="toolbar" style={{ marginBottom: 0 }}>
        <button
          className="btn primary"
          onClick={() => {
            navigator.clipboard?.writeText(secret).then(
              () => toast("Copied to clipboard."),
              () => toast("Clipboard unavailable in this browser.", "err"),
            );
          }}
        >
          <Icons.copy /> Copy
        </button>
        <button className="btn ghost" onClick={onClose}>Done</button>
      </div>
    </Modal>
  );
}

function ConfirmDialog({
  title, message, confirmLabel = "Confirm", danger, onConfirm, onClose,
}: {
  title: string; message: React.ReactNode; confirmLabel?: string;
  danger?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <Modal title={title} onClose={onClose}>
      <p>{message}</p>
      <div className="toolbar" style={{ marginBottom: 0, justifyContent: "flex-end" }}>
        <button className="btn ghost" onClick={onClose}>Cancel</button>
        <button
          className={cls("btn", danger ? "danger" : "primary")}
          disabled={busy}
          onClick={() => {
            setBusy(true);
            Promise.resolve(onConfirm())
              .then(onClose)
              .catch(() => setBusy(false));
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Shared table primitives
// ---------------------------------------------------------------------------

function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <tbody>
      {Array.from({ length: rows }, (_, index) => (
        <tr key={index}><td colSpan={12}><div className="skel" /></td></tr>
      ))}
    </tbody>
  );
}

function EmptyRow({ colSpan, message }: { colSpan: number; message: string }) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className="empty"><Icons.search size={22} /><br />{message}</div>
      </td>
    </tr>
  );
}

const Pill = ({ kind, children }: { kind: "ok" | "bad" | "warn" | "off"; children: React.ReactNode }) => (
  <span className={cls("pill", kind)}>{children}</span>
);

// ---------------------------------------------------------------------------
// Auth context
// ---------------------------------------------------------------------------

interface Me {
  userId: string;
  email: string;
  permissions: string[];
  csrfToken: string;
  authTime: string;
  stepUpMaxAgeSeconds: number;
}
const AuthContext = createContext<{ me: Me | null; reload: () => void }>({ me: null, reload: () => undefined });
const useAuth = () => useContext(AuthContext);

// ---------------------------------------------------------------------------
// App bar + sidebar shell (Entra-style structure)
// ---------------------------------------------------------------------------

const NAV: Array<{ group: string; items: Array<[string, string, (p: IconProps) => React.ReactElement]> }> = [
  { group: "Favorites", items: [["/", "Home", Icons.home]] },
  {
    group: "Identity",
    items: [["/users", "Users", Icons.users]],
  },
  {
    group: "Applications",
    items: [
      ["/apps", "App registrations", Icons.apps],
      ["/resources", "Resource servers", Icons.layers],
    ],
  },
  {
    group: "Monitoring",
    items: [
      ["/sessions", "Sessions & tokens", Icons.sessions],
      ["/consents", "Consent grants", Icons.shield],
      ["/signins", "Sign-in logs", Icons.list],
      ["/audit", "Audit logs", Icons.fileText],
    ],
  },
  { group: "Settings", items: [["/settings", "Portal settings", Icons.gear]] },
];

function ThemeToggle() {
  const [dark, setDark] = useState(document.documentElement.classList.contains("dark"));
  return (
    <button
      className="iconbtn"
      title="Toggle theme"
      onClick={() => {
        const next = !dark;
        setDark(next);
        document.documentElement.classList.toggle("dark", next);
        try { localStorage.setItem("basis-admin-theme", next ? "dark" : "light"); } catch {}
      }}
    >
      {dark ? <Icons.sun size={17} /> : <Icons.moon size={17} />}
    </button>
  );
}

function AccountMenu() {
  const { me } = useAuth();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [open]);
  return (
    <div className="relative">
      <button className="accountbtn" onClick={(event) => { event.stopPropagation(); setOpen((o) => !o); }}>
        <span className="avatar">{initials(me?.email)}</span>
        <span>{me?.email.split("@")[0]}</span>
      </button>
      {open && (
        <div className="menu" onClick={(event) => event.stopPropagation()}>
          <div className="who">
            <div className="em">{me?.email}</div>
            <div className="muted">Signed in {relTime(me?.authTime)}</div>
          </div>
          <div className="perms">
            {me?.permissions.map((permission) => (
              <div key={permission}><code>{permission}</code></div>
            )) ?? null}
          </div>
          <hr />
          <button className="navitem" style={{ width: "100%" }} onClick={() => api("/auth/logout", { method: "POST" }).then(() => window.location.assign("/"))}>
            <Icons.logout size={15} /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

function AppBar({ query, setQuery, collapsed, toggleCollapsed }: {
  query: string; setQuery: (value: string) => void;
  collapsed: boolean; toggleCollapsed: () => void;
}) {
  return (
    <header className="appbar">
      <button className="iconbtn" onClick={toggleCollapsed} title="Toggle navigation"><Icons.menu size={18} /></button>
      <Link to="/" className="brand" style={{ color: "var(--text)", textDecoration: "none" }}>
        <Icons.shield size={19} /> Basis Admin Center
      </Link>
      <div className="search">
        <Icons.search size={14} />
        <input placeholder="Search users…" value={query} onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className="spacer" />
      <ThemeToggle />
      <AccountMenu />
    </header>
  );
}

function Sidebar({ collapsed, closeOnNavigate }: { collapsed: boolean; closeOnNavigate?: () => void }) {
  const location = useLocation();
  return (
    <aside className={cls("sidebar", collapsed && "collapsed")}>
      {NAV.map((group) => (
        <div className="navgroup" key={group.group}>
          <div className="navlabel">{group.group}</div>
          {group.items.map(([to, label, Icon]) => (
            <Link
              key={to}
              to={to}
              className={cls("navitem", location.pathname === to && "active")}
              title={label}
              onClick={closeOnNavigate}
            >
              <Icon size={16} />
              <span>{label}</span>
            </Link>
          ))}
        </div>
      ))}
    </aside>
  );
}

function Crumbs({ trail }: { trail: string[] }) {
  return (
    <nav className="crumbs">
      <Link to="/">Basis Admin Center</Link>
      {trail.map((part) => (
        <span key={part} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Icons.chevronR size={11} /> {part}
        </span>
      ))}
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

function Dashboard() {
  const { data, loading, reload } = useApi<{
    counters: Record<string, number>;
    recentAudit: any[];
    recentSignIns: any[];
    hygieneAlerts: any[];
  }>("/dashboard/summary");
  const toast = useToast();
  useEffect(() => {
    const timer = setInterval(reload, 30_000);
    return () => clearInterval(timer);
  }, [reload]);

  const counters = data?.counters ?? {};
  const tiles: Array<{ label: string; value: number; icon: (p: IconProps) => React.ReactElement; tone?: "warn" | "bad" }> = [
    { label: "Active users", value: counters.activeUsers ?? 0, icon: Icons.users },
    { label: "Active sessions", value: counters.activeSessions ?? 0, icon: Icons.sessions },
    { label: "Live tokens", value: counters.liveTokens ?? 0, icon: Icons.key },
    { label: "Registered apps", value: counters.registeredClients ?? 0, icon: Icons.apps },
    { label: "Sign-ins · 24 h", value: counters.signIns24h ?? 0, icon: Icons.list },
    { label: "Failed events · 24 h", value: counters.failures24h ?? 0, icon: Icons.alert, tone: (counters.failures24h ?? 0) > 0 ? "warn" : undefined },
    { label: "Locked accounts", value: counters.lockedAccounts ?? 0, icon: Icons.shield, tone: (counters.lockedAccounts ?? 0) > 0 ? "bad" : undefined },
    { label: "Secrets expiring ≤ 14 d", value: counters.expiringSecrets ?? 0, icon: Icons.alert, tone: (counters.expiringSecrets ?? 0) > 0 ? "warn" : undefined },
  ];

  return (
    <>
      <Crumbs trail={["Overview"]} />
      <div className="toolbar" style={{ marginBottom: 16 }}>
        <div>
          <h1 className="page-title">Overview</h1>
          <p className="page-sub">Directory health at a glance · refreshes every 30 seconds</p>
        </div>
        <div className="grow" />
        <button className="btn ghost" onClick={() => { reload(); toast("Dashboard refreshed."); }}><Icons.refresh /> Refresh</button>
      </div>

      {loading ? (
        <div className="tiles">{Array.from({ length: 8 }, (_, i) => <div key={i} className="tile"><div className="skel" style={{ flex: 1 }} /></div>)}</div>
      ) : (
        <div className="tiles">
          {tiles.map((tile) => (
            <div key={tile.label} className={cls("tile", tile.tone)}>
              <div className="ticon"><tile.icon size={18} /></div>
              <div><div className="tnum">{tile.value.toLocaleString()}</div><div className="tlabel">{tile.label}</div></div>
            </div>
          ))}
        </div>
      )}

      <div className="two-col">
        <div className="card">
          <h3>Recent sign-ins</h3>
          <div className="tablewrap">
            <table>
              <thead><tr><th>User</th><th>Kind</th><th>Result</th><th>When</th></tr></thead>
              {loading ? <TableSkeleton rows={4} /> : (
                <tbody>
                  {(data?.recentSignIns ?? []).length === 0
                    ? <EmptyRow colSpan={4} message="No sign-in activity recorded yet." />
                    : (data?.recentSignIns ?? []).map((event: any, index: number) => (
                      <tr key={index}>
                        <td>{event.email ?? "—"}</td>
                        <td className="mono">{event.kind}</td>
                        <td>{event.success ? <Pill kind="ok">success</Pill> : <Pill kind="bad">failed</Pill>}</td>
                        <td title={fmtDateTime(event.createdAt)}>{relTime(event.createdAt)}</td>
                      </tr>
                    ))}
                </tbody>
              )}
            </table>
          </div>
        </div>
        <div className="card">
          <h3>Recent administrator actions</h3>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>When</th></tr></thead>
              {loading ? <TableSkeleton rows={4} /> : (
                <tbody>
                  {(data?.recentAudit ?? []).length === 0
                    ? <EmptyRow colSpan={4} message="Administrator actions will appear here." />
                    : (data?.recentAudit ?? []).map((event: any) => (
                      <tr key={event.id}>
                        <td className="mono">{event.action}</td>
                        <td>{event.actorEmail ?? "system"}</td>
                        <td title={event.targetId}>{String(event.targetId).slice(0, 18)}</td>
                        <td title={fmtDateTime(event.createdAt)}>{relTime(event.createdAt)}</td>
                      </tr>
                    ))}
                </tbody>
              )}
            </table>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>Hygiene alerts</h3>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Application</th><th>Last secret use</th><th>Next expiry</th></tr></thead>
            {loading ? <TableSkeleton rows={3} /> : (
              <tbody>
                {(data?.hygieneAlerts ?? []).length === 0
                  ? <EmptyRow colSpan={3} message="No hygiene issues detected." />
                  : (data?.hygieneAlerts ?? []).map((client: any) => (
                    <tr key={client.clientId}>
                      <td>{client.name ?? client.clientId}</td>
                      <td>{client.lastUsedAt ? relTime(client.lastUsedAt) : <Pill kind="warn">never used</Pill>}</td>
                      <td>{client.nextExpiry ? fmtDate(client.nextExpiry) : "—"}</td>
                    </tr>
                  ))}
              </tbody>
            )}
          </table>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

const ALL_PERMISSIONS = [
  "portal.users.read", "portal.users.write",
  "portal.clients.read", "portal.clients.write",
  "portal.resources.write", "portal.tokens.revoke", "portal.consents.revoke",
  "portal.audit.read", "portal.signins.read", "portal.privileged.read",
  "portal.admins.manage", "portal.settings.write",
];

function Users() {
  const { me } = useAuth();
  const globalQuery = useGlobalSearch();
  const [query, setQuery] = useState(globalQuery ?? "");
  useEffect(() => setQuery(globalQuery ?? ""), [globalQuery]);
  const debounced = useDebounced(query, 250);
  const { data, loading, reload } = useApi<{ users: any[] }>(`/users?query=${encodeURIComponent(debounced)}`);
  const navigate = useNavigate();
  const toast = useToast();
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ email: "", displayName: "" });
  const [secret, setSecret] = useState<string | null>(null);

  const createUser = () =>
    api("/users/local", { method: "POST", body: JSON.stringify(form) })
      .then((result: any) => {
        setCreating(false);
        setForm({ email: "", displayName: "" });
        setSecret(result.tempPassword);
        reload();
      })
      .catch((cause: Error) => toast(cause.message, "err"));

  return (
    <>
      <Crumbs trail={["Users"]} />
      <div className="page-head">
        <div className="grow">
          <h1 className="page-title">Users</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>All identities that can sign in through the directory.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Icons.plus /> New local user</button>
      </div>
      <div className="toolbar">
        <input className="input" placeholder="Filter by email or name…" style={{ width: 280 }}
          value={query} onChange={(event) => setQuery(event.target.value)} />
        <div className="grow" />
        <span className="muted">{data?.users.length ?? 0} shown</span>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap">
          <table>
            <thead><tr><th>User</th><th>Name</th><th>Provider</th><th>Status</th><th>Created</th></tr></thead>
            {loading ? <TableSkeleton /> : (
              <tbody>
                {(data?.users ?? []).length === 0
                  ? <EmptyRow colSpan={5} message="No accounts match this filter." />
                  : data!.users.map((user) => (
                    <tr key={user.id} className="clickable" onClick={() => navigate(`/users/${user.id}`)}>
                      <td>
                        <div className="usercell">
                          <span className="avatar">{initials(user.displayName, user.email)}</span>
                          <div>{user.email}</div>
                        </div>
                      </td>
                      <td>{user.displayName ?? "—"}</td>
                      <td><Pill kind={user.provider === "local" ? "off" : "ok"}>{user.provider}</Pill></td>
                      <td>{user.disabled ? <Pill kind="bad">disabled</Pill> : <Pill kind="ok">active</Pill>}</td>
                      <td title={fmtDateTime(user.createdAt)}>{fmtDate(user.createdAt)}</td>
                    </tr>
                  ))}
              </tbody>
            )}
          </table>
        </div>
      </div>

      {creating && (
        <Modal title="Create a local user" onClose={() => setCreating(false)}>
          <p style={{ marginTop: 0 }}>The account signs in with a temporary password (shown once after creation) and must reset it at first login.</p>
          <label className="field">
            <span>Email address</span>
            <input className="input" placeholder="name@example.com" value={form.email}
              onChange={(event) => setForm((f) => ({ ...f, email: event.target.value }))} />
          </label>
          <label className="field">
            <span>Display name</span>
            <input className="input" placeholder="Jordan Smith" value={form.displayName}
              onChange={(event) => setForm((f) => ({ ...f, displayName: event.target.value }))} />
          </label>
          <div className="toolbar" style={{ marginBottom: 0, justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button
              className="btn primary"
              disabled={!/.+@.+\..+/.test(form.email) || form.displayName.trim().length === 0}
              onClick={createUser}
            >
              Create user
            </button>
          </div>
        </Modal>
      )}
      {secret && <SecretModal title="Temporary password" secret={secret} onClose={() => setSecret(null)} />}
      <p className="muted" style={{ marginTop: 8 }}>
        Signed in as <strong>{me?.email}</strong>. Self-editing is blocked by policy; use another administrator for changes to your own account.
      </p>
    </>
  );
}

function UserDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { me, reload } = useAuth();
  const toast = useToast();
  const { data, loading, error } = useApi<{ user: any }>(id ? `/users/${id}` : null);
  const [chips, setChips] = useState<string[] | null>(null);
  const [addValue, setAddValue] = useState("");
  const [confirm, setConfirm] = useState<null | { kind: "disable" | "enable" | "signout" | "reset" | "delete" }>(null);
  const [typedEmail, setTypedEmail] = useState("");
  const [secret, setSecret] = useState<string | null>(null);

  const user = data?.user;
  useEffect(() => {
    setChips(user ? user.permissions.filter((p: string) => p.startsWith("portal.")) : null);
    setTypedEmail("");
  }, [user]);

  if (loading) return (<><Crumbs trail={["Users", "Loading…"]} /><div className="card"><div className="skel" /><div className="skel" style={{ width: "70%" }} /></div></>);
  if (error || !user) return (<><Crumbs trail={["Users"]} /><div className="banner locked"><Icons.alert /> {error ?? "User not found."}</div></>);

  const dirty = chips !== null && JSON.stringify(chips) !== JSON.stringify(user.permissions.filter((p: string) => p.startsWith("portal.")));
  const isSelf = user.id === me?.userId;

  const savePermissions = () =>
    api(`/users/${id}/permissions`, { method: "PUT", body: JSON.stringify({ permissions: chips }) })
      .then(() => { toast("Permissions updated."); reload(); })
      .catch((cause: Error) => toast(cause.message, "err"));

  return (
    <>
      <Crumbs trail={["Users", user.email]} />
      <div className="card" style={{ display: "flex", gap: 18, alignItems: "center", flexWrap: "wrap" }}>
        <span className="avatar lg">{initials(user.displayName, user.email)}</span>
        <div style={{ minWidth: 200 }}>
          <h1 className="page-title" style={{ marginBottom: 2 }}>{user.displayName ?? user.email}</h1>
          <div className="muted">{user.email}</div>
          <div className="chips" style={{ marginTop: 8 }}>
            <Pill kind={user.disabled ? "bad" : "ok"}>{user.disabled ? "disabled" : "active"}</Pill>
            <Pill kind="off">{user.provider}</Pill>
            {user.privileged && <Pill kind="warn">privileged account</Pill>}
          </div>
        </div>
        <div className="grow" />
        <div className="toolbar" style={{ margin: 0 }}>
          <button className="btn" disabled={isSelf}
            title={isSelf ? "You cannot change your own account state" : ""}
            onClick={() => setConfirm({ kind: user.disabled ? "enable" : "disable" })}>
            {user.disabled ? "Enable account" : "Disable account"}
          </button>
          <button className="btn" onClick={() => setConfirm({ kind: "signout" })}>Force sign-out</button>
          <button className="btn" onClick={() => setConfirm({ kind: "reset" })}>Reset credentials…</button>
          <button className="btn danger" disabled={isSelf}
            title={isSelf ? "You cannot delete your own account" : ""}
            onClick={() => setConfirm({ kind: "delete" })}>
            Delete user
          </button>
        </div>
      </div>

      <div className="two-col">
        <div className="card">
          <h3>Profile</h3>
          <dl className="kv">
            <dt>User ID</dt><dd className="mono">{user.id}</dd>
            <dt>Email verified</dt><dd>{user.emailVerified ? <Pill kind="ok">verified</Pill> : <Pill kind="warn">not verified</Pill>}</dd>
            <dt>Tokens valid after</dt><dd>{fmtDateTime(user.tokensValidAfter)}</dd>
            <dt>Created</dt><dd>{fmtDateTime(user.createdAt)}</dd>
            <dt>Last updated</dt><dd>{fmtDateTime(user.updatedAt)}</dd>
          </dl>
        </div>
        <div className="card">
          <h3>Portal permissions</h3>
          {isSelf && <div className="banner info"><Icons.alert /> Policy blocks editing your own permissions.</div>}
          <div className="chips" style={{ minHeight: 30, marginBottom: 10 }}>
            {(chips ?? []).map((permission) => (
              <span key={permission} className="chipx">
                {permission}
                {!isSelf && (
                  <button title={`Remove ${permission}`} onClick={() => setChips((list) => list!.filter((p) => p !== permission))}>
                    ✕
                  </button>
                )}
              </span>
            ))}
            {(chips ?? []).length === 0 && <span className="muted">No portal permissions granted.</span>}
          </div>
          {!isSelf && (
            <div className="toolbar" style={{ marginBottom: 0 }}>
              <select className="input" value={addValue} onChange={(event) => {
                if (!event.target.value) return;
                setChips((list) => list!.includes(event.target.value) ? list : [...list!, event.target.value]);
                setAddValue("");
              }}>
                <option value="">Add permission…</option>
                {ALL_PERMISSIONS.filter((permission) => !(chips ?? []).includes(permission)).map((permission) => (
                  <option key={permission} value={permission}>{permission}</option>
                ))}
              </select>
              <div className="grow" />
              <button className="btn ghost" disabled={!dirty} onClick={() => setChips(user.permissions.filter((p: string) => p.startsWith("portal.")))}>Discard</button>
              <button className="btn primary" disabled={!dirty} onClick={savePermissions}>Save changes</button>
            </div>
          )}
        </div>
      </div>

      {confirm?.kind === "delete" && (
        <Modal title="Delete this user permanently?" onClose={() => setConfirm(null)}>
          <p>
            This removes <strong>{user.email}</strong>, their sessions, credentials, permissions,
            consents, and refresh tokens. Audit entries are preserved. This cannot be undone.
          </p>
          <label className="field">
            <span>Type the account email to confirm</span>
            <input className="input" placeholder={user.email} value={typedEmail} onChange={(event) => setTypedEmail(event.target.value)} />
          </label>
          <div className="toolbar" style={{ marginBottom: 0, justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => setConfirm(null)}>Cancel</button>
            <button
              className="btn danger"
              disabled={typedEmail.toLowerCase() !== String(user.email).toLowerCase()}
              onClick={() =>
                api(`/users/${id}`, { method: "DELETE" })
                  .then(() => { toast("User deleted."); navigate("/users"); })
                  .catch((cause: Error) => toast(cause.message, "err"))
              }
            >
              Delete permanently
            </button>
          </div>
        </Modal>
      )}

      {confirm && confirm.kind !== "delete" && (
        <ConfirmDialog
          title={{
            disable: "Disable this account?",
            enable: "Enable this account?",
            signout: "Force sign-out everywhere?",
            reset: "Reset local credentials?",
          }[confirm.kind]}
          message={{
            disable: <>The user is signed out of every service immediately, and existing refresh tokens are revoked.</>,
            enable: <>The account regains the ability to sign in on its next attempt.</>,
            signout: <>All SSO sessions are destroyed and refresh token families are revoked.</>,
            reset: <>A new temporary password is generated (shown once), TOTP factors are cleared, and all sessions end. This only applies to locally credentialed accounts.</>,
          }[confirm.kind]}
          confirmLabel={{ disable: "Disable", enable: "Enable", signout: "Sign out everywhere", reset: "Reset credentials" }[confirm.kind]}
          danger={confirm.kind === "disable"}
          onClose={() => setConfirm(null)}
          onConfirm={() => {
            const calls: Record<string, Promise<any>> = {
              disable: api(`/users/${id}/disable`, { method: "POST" }),
              enable: api(`/users/${id}/enable`, { method: "POST" }),
              signout: api(`/users/${id}/force-signout`, { method: "POST" }),
              reset: api(`/users/${id}/credentials/reset`, { method: "POST" }).then((result: any) => setSecret(result.tempPassword)),
            };
            return calls[confirm.kind].then(() => { toast("Done."); reload(); });
          }}
        />
      )}

      {secret && <SecretModal title="Temporary password" secret={secret} onClose={() => { setSecret(null); reload(); }} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Applications
// ---------------------------------------------------------------------------

function Apps() {
  const { data, loading, reload } = useApi<{ clients: any[] }>("/clients");
  const resources = useApi<{ resources: any[] }>("/resources");
  const toast = useToast();
  const [secret, setSecret] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "",
    redirectUris: "https://localhost:5173/auth/callback",
    public: false,
    scopes: "openid profile email",
    resourceAudience: "",
    requireConsent: true,
  });

  const registerApp = () =>
    api("/clients", {
      method: "POST",
      body: JSON.stringify({
        name: form.name.trim(),
        redirectUris: form.redirectUris.split(/\s*\n\s*/).filter(Boolean),
        public: form.public,
        scopes: form.scopes.split(/[\s,]+/).filter(Boolean),
        resources: [form.resourceAudience],
        requireConsent: form.requireConsent,
        filterMode: null,
        filterContent: [],
      }),
    })
      .then((result: any) => {
        setCreating(false);
        if (result.secret) setSecret(result.secret);
        else toast(`Application ${result.clientId} registered.`);
        reload();
      })
      .catch((cause: Error) => toast(cause.message, "err"));

  return (
    <>
      <Crumbs trail={["App registrations"]} />
      <div className="page-head">
        <div className="grow">
          <h1 className="page-title">App registrations</h1>
          <p className="page-sub" style={{ marginBottom: 0 }}>Applications allowed to authenticate against the directory.</p>
        </div>
        <button className="btn primary" onClick={() => setCreating(true)}><Icons.plus /> New registration</button>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Application</th><th>Client ID</th><th>Type</th><th>Redirect URIs</th><th>Consent</th><th style={{ width: 190 }}>Actions</th></tr></thead>
            {loading ? <TableSkeleton /> : (
              <tbody>
                {(data?.clients ?? []).length === 0
                  ? <EmptyRow colSpan={6} message="No applications registered yet." />
                  : data!.clients.map((client) => (
                    <tr key={client.clientId}>
                      <td><strong>{client.metadata?.name ?? client.clientId}</strong></td>
                      <td className="mono" title={client.clientId}>{client.clientId.slice(0, 13)}…</td>
                      <td><Pill kind={client.metadata?.public ? "off" : "ok"}>{client.metadata?.public ? "public · PKCE" : "confidential"}</Pill></td>
                      <td>{client.metadata?.redirectUris?.length ?? 0}</td>
                      <td>{client.requireConsent ? <Pill kind="warn">required</Pill> : <Pill kind="ok">silent</Pill>}</td>
                      <td>
                        <div className="toolbar" style={{ margin: 0 }}>
                          <button className="btn ghost" onClick={() =>
                            api(`/clients/${client.clientId}/secrets`, { method: "POST", body: JSON.stringify({ name: `secret-${new Date().toISOString().slice(0, 10)}` }) })
                              .then((result: any) => setSecret(result.secret))
                              .catch((cause: Error) => toast(cause.message, "err"))
                          }>
                            <Icons.plus size={13} /> Secret
                          </button>
                          <button className="btn danger" onClick={() => setDeleting(client)}>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            )}
          </table>
        </div>
      </div>

      {creating && (
        <Modal title="Register an application" onClose={() => setCreating(false)}>
          <label className="field">
            <span>Display name</span>
            <input className="input" placeholder="Dev Portal" value={form.name}
              onChange={(event) => setForm((f) => ({ ...f, name: event.target.value }))} />
          </label>
          <label className="field">
            <span>Redirect URIs (one per line)</span>
            <textarea className="input" rows={3} value={form.redirectUris}
              onChange={(event) => setForm((f) => ({ ...f, redirectUris: event.target.value }))} />
          </label>
          <div className="checkline">
            <input id="pub" type="checkbox" checked={form.public}
              onChange={(event) => setForm((f) => ({ ...f, public: event.target.checked }))} />
            <label htmlFor="pub">Public client (PKCE only, no secret)</label>
          </div>
          <label className="field">
            <span>Allowed scopes (space separated)</span>
            <input className="input" value={form.scopes}
              onChange={(event) => setForm((f) => ({ ...f, scopes: event.target.value }))} />
          </label>
          <label className="field">
            <span>Resource audience</span>
            <select className="input" value={form.resourceAudience}
              onChange={(event) => setForm((f) => ({ ...f, resourceAudience: event.target.value }))}>
              <option value="">Select a resource…</option>
              {(resources.data?.resources ?? []).map((resource: any) => (
                <option key={resource.audience} value={resource.audience}>{resource.audience}</option>
              ))}
            </select>
          </label>
          <div className="checkline">
            <input id="consent" type="checkbox" checked={form.requireConsent}
              onChange={(event) => setForm((f) => ({ ...f, requireConsent: event.target.checked }))} />
            <label htmlFor="consent">Require user consent on first access</label>
          </div>
          <div className="toolbar" style={{ marginBottom: 0, justifyContent: "flex-end" }}>
            <button className="btn ghost" onClick={() => setCreating(false)}>Cancel</button>
            <button
              className="btn primary"
              disabled={!form.name.trim() || form.redirectUris.trim().length === 0 || !form.resourceAudience}
              onClick={registerApp}
            >
              Register application
            </button>
          </div>
        </Modal>
      )}

      {secret && <SecretModal title="New client secret" secret={secret} onClose={() => { setSecret(null); reload(); }} />}
      {deleting && (
        <ConfirmDialog
          title="Delete application?"
          message={<>Authorization data for <strong>{deleting.metadata?.name ?? deleting.clientId}</strong> is removed with it. This cannot be undone.</>}
          confirmLabel="Delete application"
          danger
          onClose={() => setDeleting(null)}
          onConfirm={() =>
            api(`/clients/${deleting.clientId}`, { method: "DELETE" })
              .then(() => { toast("Application deleted."); reload(); })
              .catch((cause: Error) => { toast(cause.message, "err"); throw cause; })
          }
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Resources
// ---------------------------------------------------------------------------

function Resources() {
  const { data, loading, reload } = useApi<{ resources: any[] }>("/resources");
  const toast = useToast();
  const [audience, setAudience] = useState("");
  const [scopes, setScopes] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editScopes, setEditScopes] = useState("");

  const save = () =>
    api(`/resources/${encodeURIComponent(audience.trim())}`, { method: "PUT", body: JSON.stringify({ scopes: scopes.split(/[\s,]+/).filter(Boolean) }) })
      .then(() => { toast(`Resource ${audience.trim()} saved.`); setAudience(""); setScopes(""); reload(); })
      .catch((cause: Error) => toast(cause.message, "err"));

  return (
    <>
      <Crumbs trail={["Resource servers"]} />
      <h1 className="page-title">Resource servers</h1>
      <p className="page-sub">API audiences and the scopes each one accepts.</p>
      <div className="card">
        <h3>{editing ? `Edit ${editing}` : "Register a resource"}</h3>
        <div className="toolbar">
          <input className="input" placeholder="urn:basis:api:example" style={{ width: 260 }}
            value={editing ?? audience} disabled={Boolean(editing)}
            onChange={(event) => setAudience(event.target.value)} />
          <input className="input" placeholder="scopes (space or comma separated)" style={{ flex: 1, minWidth: 220 }}
            value={editing ? editScopes : scopes}
            onChange={(event) => (editing ? setEditScopes(event.target.value) : setScopes(event.target.value))} />
          <button className="btn primary" disabled={!editing && !audience.trim()}
            onClick={() => {
              const target = editing ?? audience.trim();
              const scopeList = (editing ? editScopes : scopes).split(/[\s,]+/).filter(Boolean);
              api(`/resources/${encodeURIComponent(target)}`, { method: "PUT", body: JSON.stringify({ scopes: scopeList }) })
                .then(() => { toast("Saved."); setEditing(null); setEditScopes(""); setAudience(""); setScopes(""); reload(); })
                .catch((cause: Error) => toast(cause.message, "err"));
            }}>
            Save
          </button>
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Audience</th><th>Scopes</th><th style={{ width: 150 }}>Actions</th></tr></thead>
            {loading ? <TableSkeleton /> : (
              <tbody>
                {(data?.resources ?? []).length === 0
                  ? <EmptyRow colSpan={3} message="No resource servers registered." />
                  : data!.resources.map((resource) => (
                    <tr key={resource.audience}>
                      <td className="mono">{resource.audience}</td>
                      <td>
                        <div className="chips">
                          {(resource.scopes ?? []).length === 0
                            ? <span className="muted">none</span>
                            : resource.scopes.map((scope: string) => <span key={scope} className="chipx">{scope}</span>)}
                        </div>
                      </td>
                      <td>
                        <div className="toolbar" style={{ margin: 0 }}>
                          <button className="btn ghost" onClick={() => { setEditing(resource.audience); setEditScopes((resource.scopes ?? []).join(" ")); setAudience(resource.audience); }}>
                            Edit
                          </button>
                          <button className="btn danger" onClick={() =>
                            api(`/resources/${encodeURIComponent(resource.audience)}`, { method: "DELETE" })
                              .then(() => { toast("Deleted."); reload(); })
                              .catch((cause: Error) => toast(cause.message, "err"))
                          }>
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            )}
          </table>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sessions & tokens
// ---------------------------------------------------------------------------

function SessionsTokens() {
  const sessions = useApi<{ sessions: any[] }>("/sessions");
  const tokens = useApi<{ tokens: any[] }>("/tokens");
  const toast = useToast();
  const reloadBoth = () => { sessions.reload(); tokens.reload(); };

  return (
    <>
      <Crumbs trail={["Sessions & tokens"]} />
      <h1 className="page-title">Sessions &amp; tokens</h1>
      <p className="page-sub">Live browser sessions and refresh-token families across every application.</p>
      <div className="card" style={{ padding: 0 }}>
        <h3 style={{ padding: "14px 16px 0" }}>Active SSO sessions</h3>
        <div className="tablewrap">
          <table>
            <thead><tr><th>User</th><th>Started</th><th>Expires</th><th style={{ width: 110 }}>Action</th></tr></thead>
            {sessions.loading ? <TableSkeleton /> : (
              <tbody>
                {(sessions.data?.sessions ?? []).length === 0
                  ? <EmptyRow colSpan={4} message="No active sessions." />
                  : sessions.data!.sessions.map((session) => (
                    <tr key={session.id}>
                      <td>{session.email}</td>
                      <td title={fmtDateTime(session.createdAt)}>{relTime(session.createdAt)}</td>
                      <td>{fmtDateTime(session.expiresAt)}</td>
                      <td>
                        <button className="btn danger" onClick={() =>
                          api(`/sessions/${session.id}/revoke`, { method: "POST" })
                            .then(() => { toast("Session revoked."); reloadBoth(); })
                            .catch((cause: Error) => toast(cause.message, "err"))
                        }>
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            )}
          </table>
        </div>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <h3 style={{ padding: "14px 16px 0" }}>Refresh token families</h3>
        <div className="tablewrap">
          <table>
            <thead><tr><th>User</th><th>Client</th><th>Resource</th><th>Created</th><th style={{ width: 140 }}>Action</th></tr></thead>
            {tokens.loading ? <TableSkeleton /> : (
              <tbody>
                {(tokens.data?.tokens ?? []).length === 0
                  ? <EmptyRow colSpan={5} message="No live refresh tokens." />
                  : tokens.data!.tokens.map((token: any) => (
                    <tr key={token.familyId}>
                      <td>{token.email ?? String(token.userId).slice(0, 8)}</td>
                      <td className="mono">{String(token.clientId).slice(0, 13)}…</td>
                      <td className="mono">{token.resource}</td>
                      <td title={fmtDateTime(token.createdAt)}>{relTime(token.createdAt)}</td>
                      <td>
                        <button className="btn danger" onClick={() =>
                          api(`/tokens/family/${token.familyId}/revoke`, { method: "POST" })
                            .then((result: any) => { toast(`${result.revoked} token(s) revoked.`); reloadBoth(); })
                            .catch((cause: Error) => toast(cause.message, "err"))
                        }>
                          Revoke family
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            )}
          </table>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Consents
// ---------------------------------------------------------------------------

function Consents() {
  const { data, loading, reload } = useApi<{ consents: any[] }>("/consents");
  const toast = useToast();
  return (
    <>
      <Crumbs trail={["Consent grants"]} />
      <h1 className="page-title">Consent grants</h1>
      <p className="page-sub">What each account has allowed each application to access.</p>
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap">
          <table>
            <thead><tr><th>User</th><th>Application</th><th>Granted scopes</th><th>Updated</th><th style={{ width: 110 }}>Action</th></tr></thead>
            {loading ? <TableSkeleton /> : (
              <tbody>
                {(data?.consents ?? []).length === 0
                  ? <EmptyRow colSpan={5} message="No consents recorded." />
                  : data!.consents.map((consent: any) => (
                    <tr key={`${consent.userId}:${consent.clientId}`}>
                      <td>{consent.email}</td>
                      <td>{consent.clientName ?? consent.clientId}</td>
                      <td>
                        <div className="chips">
                          {(consent.scopes ?? []).map((scope: string) => <span key={scope} className="chipx">{scope}</span>)}
                        </div>
                      </td>
                      <td title={fmtDateTime(consent.updatedAt)}>{relTime(consent.updatedAt)}</td>
                      <td>
                        <button className="btn danger" onClick={() =>
                          api(`/consents/${consent.userId}/${consent.clientId}`, { method: "DELETE" })
                            .then(() => { toast("Consent revoked."); reload(); })
                            .catch((cause: Error) => toast(cause.message, "err"))
                        }>
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
              </tbody>
            )}
          </table>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Logs (audit + sign-ins)
// ---------------------------------------------------------------------------

function Audit() {
  const [action, setAction] = useState("");
  const filter = action ? `?action=${encodeURIComponent(action)}` : "";
  const { data, loading, error } = useApi<{ events: any[]; nextCursor: string | null }>(`/audit${filter}`);

  return (
    <>
      <Crumbs trail={["Audit logs"]} />
      <h1 className="page-title">Audit logs</h1>
      <p className="page-sub">Append-only record of every administrator action. Entries cannot be edited or deleted.</p>
      <div className="toolbar">
        <input className="input" placeholder="Filter by action…" style={{ width: 260 }} value={action} onChange={(event) => setAction(event.target.value)} />
      </div>
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap">
          <table>
            <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target type</th><th>Target ID</th></tr></thead>
            {loading ? <TableSkeleton /> : (
              <tbody>
                {error ? <EmptyRow colSpan={5} message={error} />
                  : (data?.events ?? []).length === 0
                    ? <EmptyRow colSpan={5} message="Nothing audited yet." />
                    : data!.events.map((event: any) => (
                      <tr key={event.id}>
                        <td title={fmtDateTime(event.createdAt)}>{relTime(event.createdAt)}</td>
                        <td>{event.actorEmail ?? "system"}</td>
                        <td><span className="chipx">{event.action}</span></td>
                        <td>{event.targetType}</td>
                        <td className="mono" title={event.targetId}>{String(event.targetId).slice(0, 24)}</td>
                      </tr>
                    ))}
              </tbody>
            )}
          </table>
        </div>
      </div>
    </>
  );
}

function SignIns() {
  const { data, loading } = useApi<{ events: any[] }>("/signins");
  return (
    <>
      <Crumbs trail={["Sign-in logs"]} />
      <h1 className="page-title">Sign-in logs</h1>
      <p className="page-sub">Every authentication attempt against the directory.</p>
      <div className="card" style={{ padding: 0 }}>
        <div className="tablewrap">
          <table>
            <thead><tr><th>When</th><th>User</th><th>Kind</th><th>Client</th><th>Result</th><th>IP address</th></tr></thead>
            {loading ? <TableSkeleton rows={8} /> : (
              <tbody>
                {(data?.events ?? []).length === 0
                  ? <EmptyRow colSpan={6} message="No sign-in activity recorded yet." />
                  : data!.events.map((event: any) => (
                    <tr key={event.id}>
                      <td title={fmtDateTime(event.createdAt)}>{relTime(event.createdAt)}</td>
                      <td>{event.email ?? "—"}</td>
                      <td className="mono">{event.kind}</td>
                      <td className="mono">{event.clientId ? String(event.clientId).slice(0, 13) : "—"}</td>
                      <td>{event.success ? <Pill kind="ok">success</Pill> : <Pill kind="bad">failed</Pill>}</td>
                      <td className="mono">{event.ip ?? "—"}</td>
                    </tr>
                  ))}
              </tbody>
            )}
          </table>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function Settings() {
  const { me } = useAuth();
  const toast = useToast();
  const [locked, setLocked] = useState<boolean | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  // The lockout switch lives in settings; read through dashboard summary by
  // asking the server indirectly: reuse summary endpoint's absence of an
  // explicit field, so poll via a tiny dedicated fetch of the audit feed.
  // Simpler: derive from a HEAD-like probe is overkill — expose via /api/me
  // is wrong too; keep the authoritative source: attempt PUT only when needed
  // and reflect the last known value from the toggle action itself.
  useEffect(() => { document.title = "Basis Admin Center"; }, []);

  const toggle = (target: boolean) =>
    api("/settings/lockout", { method: "PUT", body: JSON.stringify({ locked: target, confirm: "LOCK" }) })
      .then(() => { setLocked(target); toast(target ? "Portal locked." : "Portal unlocked."); });

  return (
    <>
      <Crumbs trail={["Portal settings"]} />
      <h1 className="page-title">Portal settings</h1>
      <p className="page-sub">Break-glass controls for the administration surface itself.</p>

      <div className={cls("banner", locked === true && "locked")}>
        <Icons.alert />
        <div style={{ flex: 1 }}>
          <strong>{locked === true ? "The portal is LOCKED." : "Portal lockout is available."}</strong>
          <div className="muted">
            Locking rejects every portal API call for all administrators until unlocked.
            Requires fresh re-authentication (step-up) and typed confirmation.
          </div>
        </div>
        {locked === true ? (
          <button className="btn primary" disabled={busy || confirmText !== "LOCK"} onClick={() => { setBusy(true); toggle(false).finally(() => { setBusy(false); setConfirmText(""); }); }}>
            Unlock portal
          </button>
        ) : (
          <div className="toolbar" style={{ margin: 0 }}>
            <input className="input" placeholder='Type "LOCK"' value={confirmText} onChange={(event) => setConfirmText(event.target.value)} style={{ width: 120 }} />
            <button className="btn danger" disabled={busy || confirmText !== "LOCK"} onClick={() => { setBusy(true); toggle(true).finally(() => { setBusy(false); setConfirmText(""); }); }}>
              Lock portal
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h3>Session policy</h3>
        <dl className="kv">
          <dt>Signed in as</dt><dd>{me?.email}</dd>
          <dt>Authentication time</dt><dd>{fmtDateTime(me?.authTime)} ({relTime(me?.authTime)})</dd>
          <dt>Step-up freshness window</dt><dd>{me?.stepUpMaxAgeSeconds ?? 300} seconds before sensitive operations demand re-authentication</dd>
          <dt>Session lifetime</dt><dd>8 hours, absolute</dd>
        </dl>
        <p className="muted" style={{ marginBottom: 0 }}>
          Sensitive operations include viewing secrets, changing permissions, disabling users,
          mass revocation, and this lockout switch.
        </p>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Global search plumbing + shell
// ---------------------------------------------------------------------------

const SearchContext = createContext<{ query: string | null }>({ query: null });
function useGlobalSearch() {
  return useContext(SearchContext).query;
}
function useDebounced<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

let reloadGlobal = (): void => undefined;

function Shell() {
  const [me, setMe] = useState<Me | null>(null);
  const [failed, setFailed] = useState(false);
  const [collapsed, setCollapsed] = useState(() => localStorage.getItem("basis-admin-nav") === "collapsed");
  const [query, setQuery] = useState("");
  const location = useLocation();
  const loginError = new URLSearchParams(location.search).get("error");

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

  const debouncedQuery = useDebounced(query, 350);
  useEffect(() => {
    if (!debouncedQuery.trim()) return;
    // Route the global search into the Users view, which owns filtering.
    if (!location.pathname.startsWith("/users")) {
      // Intentionally non-navigating: the search box pre-fills Users when visited.
    }
  }, [debouncedQuery, location.pathname]);

  if (loginError) {
    return (
      <main style={{ margin: "4rem auto", maxWidth: 540 }}>
        <div className="card">
          <h3 className="danger" style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <Icons.alert /> Sign-in failed
          </h3>
          <p>
            The identity provider returned <code>{loginError}</code>. If this says{" "}
            <code>forbidden</code>, the account has no portal permissions yet — grant the first
            administrator with:
          </p>
          <pre className="cmd">npm run admin:grant -- your@email.example portal.admins.manage</pre>
          <button className="btn primary" onClick={() => window.location.assign("/")}>Back to home</button>{" "}
          <button className="btn ghost" onClick={() => window.location.assign("/auth/start-sso")}>Try signing in again</button>
        </div>
      </main>
    );
  }
  if (failed && !location.pathname.startsWith("/auth")) return <Navigate to="/auth/start-sso" replace />;

  return (
    <AuthContext.Provider value={{ me, reload: load }}>
      <SearchContext.Provider value={{ query: debouncedQuery || null }}>
        <AppBar
          query={location.pathname.startsWith("/users") ? query : ""}
          setQuery={setQuery}
          collapsed={collapsed}
          toggleCollapsed={() => {
            setCollapsed((previous) => {
              try { localStorage.setItem("basis-admin-nav", previous ? "open" : "collapsed"); } catch {}
              return !previous;
            });
          }}
        />
        <div className="shell">
          <Sidebar collapsed={collapsed} />
          <main className="content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/users" element={<Users />} />
              <Route path="/users/:id" element={<UserDetail />} />
              <Route path="/apps" element={<Apps />} />
              <Route path="/resources" element={<Resources />} />
              <Route path="/sessions" element={<SessionsTokens />} />
              <Route path="/consents" element={<Consents />} />
              <Route path="/audit" element={<Audit />} />
              <Route path="/signins" element={<SignIns />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </main>
        </div>
      </SearchContext.Provider>
    </AuthContext.Provider>
  );
}

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
      <div className="card" style={{ maxWidth: 480, margin: "6rem auto" }}>
        <h3 className="danger" style={{ display: "flex", gap: 8, alignItems: "center" }}><Icons.alert /> Cannot start sign-in</h3>
        <p>{error}</p>
        <button className="btn primary" onClick={() => setAttempt((n) => n + 1)}>Retry</button>
      </div>
    );
  }
  return (
    <div style={{ textAlign: "center", marginTop: "6rem", color: "var(--muted)" }}>
      <Icons.refresh size={22} />
      <p>Redirecting to sign-in…</p>
    </div>
  );
}

function App() {
  return (
    <ToastHost>
      <BrowserRouter>
        <Routes>
          <Route path="/auth/start-sso" element={<Login />} />
          <Route path="/auth/callback" element={<Login />} />
          <Route path="/*" element={<Shell />} />
        </Routes>
      </BrowserRouter>
    </ToastHost>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
