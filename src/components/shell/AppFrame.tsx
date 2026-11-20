"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Icon, { type IconName } from "./icons";
import { useLocalPref } from "./local-pref";

type Item = { href: string; label: string; icon: IconName; match: (p: string) => boolean; badge?: number; badgeTone?: "amber" | "tent" | "quiet"; phone?: boolean };

/** The sidebar (bottom bar on phones) around every page. Collapsing is remembered on this device. */
export default function AppFrame({ children, todayCount, inboxCount }: { children: React.ReactNode; todayCount: number; inboxCount: number }) {
  const path = usePathname();
  const [rail, setRail] = useLocalPref<"open" | "collapsed">("terg-rail", "open");
  const collapsed = rail === "collapsed";
  // The phone "More" sheet is open only on the page it was opened from, so it closes on navigation.
  const [moreOn, setMoreOn] = useState<string | null>(null);
  const more = moreOn === path;
  const toggle = () => setRail(collapsed ? "open" : "collapsed");

  const main: Item[] = [
    { href: "/", label: "Today", icon: "today", match: (p) => p === "/" || p.startsWith("/approvals"), badge: todayCount, badgeTone: "amber", phone: true },
    { href: "/inbox", label: "Inbox", icon: "inbox", match: (p) => ["/inbox", "/communication", "/review"].some((x) => p.startsWith(x)), badge: inboxCount, badgeTone: "tent", phone: true },
  ];
  const sales: Item[] = [
    { href: "/leads", label: "Leads", icon: "leads", match: (p) => p.startsWith("/leads"), phone: true },
    { href: "/quotes", label: "Quotes", icon: "quotes", match: (p) => p.startsWith("/quotes") || p.startsWith("/projects"), phone: true },
    { href: "/clients", label: "Contacts", icon: "contacts", match: (p) => p.startsWith("/clients") },
    { href: "/payments", label: "Payments", icon: "payments", match: (p) => p.startsWith("/payments") },
  ];
  const settings: Item = { href: "/settings", label: "Settings", icon: "settings", match: (p) => p.startsWith("/settings") };

  const link = (l: Item, extra = "") => (
    <Link key={l.href} href={l.href} className={`t-rail-btn ${extra} ${l.phone ? "" : "t-desk"}`} aria-current={l.match(path) ? "page" : undefined} title={l.label}>
      <Icon name={l.icon} />
      <span className="t-lbl">{l.label}</span>
      {!!l.badge && <span className={`t-dot ${l.badgeTone ?? ""}`}>{l.badge > 99 ? "99+" : l.badge}</span>}
    </Link>
  );
  const moreItems = [sales[2], sales[3], settings];

  return (
    <div className="t-app" data-collapsed={collapsed ? "true" : "false"}>
      <aside className="t-rail" aria-label="Main">
        <div className="t-side-head">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="t-side-tent" src="/brand/terg-tent-white.png" alt="" />
          <div className="t-side-name">
            <b>TERG</b>
            <small>Team dashboard</small>
          </div>
        </div>
        {main.map((l) => link(l))}
        <div className="t-grp">
          <Icon name="sales" />
          <span>Sales</span>
        </div>
        {sales.map((l) => link(l))}
        <div className="t-spacer" />
        {link(settings, "t-foot")}
        <button type="button" className="t-rail-btn t-collapse t-desk" onClick={toggle} aria-label={collapsed ? "Expand the sidebar" : "Collapse the sidebar"}>
          <Icon name="collapse" />
          <span className="t-lbl">Collapse</span>
        </button>
        <button
          type="button"
          className="t-rail-btn t-more"
          aria-expanded={more}
          aria-current={moreItems.some((l) => l.match(path)) ? "page" : undefined}
          onClick={() => setMoreOn(more ? null : path)}
        >
          <Icon name="more" />
          <span className="t-lbl">More</span>
        </button>
      </aside>
      <nav className="t-more-sheet" hidden={!more} aria-label="More">
        {moreItems.map((l) => (
          <Link key={l.href} href={l.href} aria-current={l.match(path) ? "page" : undefined}>
            <Icon name={l.icon} />
            {l.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
