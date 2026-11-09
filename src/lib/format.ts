export function fmtDate(iso: string | null | undefined, withTime = true) {
  if (!iso) return "";
  const d = new Date(iso);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
    timeZone: process.env.NEXT_PUBLIC_TIMEZONE || undefined,
  });
}

export function timeAgo(iso: string) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 7) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(iso, false);
}

export const STATUS_STYLES: Record<string, string> = {
  inquiry: "bg-sky-50 text-sky-700 ring-sky-200",
  booked: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  completed: "bg-stone-100 text-stone-600 ring-stone-200",
  cancelled: "bg-red-50 text-red-700 ring-red-200",
};
