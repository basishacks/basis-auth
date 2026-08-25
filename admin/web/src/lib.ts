export const cls = (...values: Array<string | false | undefined>) => values.filter(Boolean).join(" ");

export function initials(name?: string | null, email?: string | null): string {
  const source = name || email || "?";
  const parts = source.replace(/@.*/, "").split(/[.\s_-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

export function relTime(value?: string | Date | null, now = Date.now()): string {
  if (!value) return "—";
  const seconds = Math.floor((now - new Date(value).getTime()) / 1000);
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86400)} d ago`;
}

export const fmtDateTime = (value?: string | Date | null) =>
  value ? new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—";

export const fmtDate = (value?: string | Date | null) =>
  value ? new Date(value).toLocaleDateString() : "—";
