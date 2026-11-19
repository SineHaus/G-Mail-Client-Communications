"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

// The left panel: three main tabs, with Settings kept at the bottom.
const MAIN = [
  {
    href: "/",
    label: "AI agent",
    icon: "M9.8 3.5 8.5 7 5 8.3l3.5 1.3L9.8 13l1.3-3.4 3.4-1.3L11.1 7 9.8 3.5zM17 12l-.8 2.2L14 15l2.2.8L17 18l.8-2.2L20 15l-2.2-.8L17 12zM6.5 15l-.6 1.6-1.6.6 1.6.6.6 1.7.6-1.7 1.6-.6-1.6-.6-.6-1.6z",
    match: (p: string) => p === "/",
  },
  {
    href: "/communication",
    label: "Communication",
    icon: "M3 8l7.9 5.3a2 2 0 0 0 2.2 0L21 8M5 19h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2z",
    match: (p: string) => ["/communication", "/review", "/clients", "/projects"].some((x) => p.startsWith(x)),
  },
  {
    href: "/overview",
    label: "Overview",
    icon: "M4 20V10m6 10V4m6 16v-7m4 7H2",
    match: (p: string) => p.startsWith("/overview"),
  },
];
const SETTINGS = {
  href: "/settings",
  label: "Settings",
  icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z",
  match: (p: string) => p.startsWith("/settings"),
};

function Item({ l, active, badge }: { l: typeof SETTINGS; active: boolean; badge?: number }) {
  return (
    <Link
      href={l.href}
      className={`flex shrink-0 items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium ${
        active ? "bg-brand-50 text-brand-700" : "text-stone-600 hover:bg-stone-100"
      }`}
    >
      <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" aria-hidden>
        <path strokeLinecap="round" strokeLinejoin="round" d={l.icon} />
      </svg>
      {l.label}
      {!!badge && <span className="ml-auto rounded-full bg-brand-600 px-2 py-0.5 text-xs font-semibold text-white">{badge}</span>}
    </Link>
  );
}

export default function NavLinks({ agentCount }: { agentCount: number }) {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-2 pb-2 md:flex-1 md:flex-col md:px-3">
      {MAIN.map((l) => (
        <Item key={l.href} l={l} active={l.match(path)} badge={l.href === "/" ? agentCount : 0} />
      ))}
      <div className="md:mt-auto md:border-t md:border-stone-100 md:pt-2">
        <Item l={SETTINGS} active={SETTINGS.match(path)} />
      </div>
    </nav>
  );
}
