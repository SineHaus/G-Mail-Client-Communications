"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { switchAccountAction } from "@/app/actions";

type Acct = { id: string; email: string; name: string | null; connected: boolean; drafts: number; unread: number };

function Badges({ a }: { a: Acct }) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      {a.drafts > 0 && (
        <span className="rounded-full bg-brand-600 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-white" title={`${a.drafts} drafts to review`}>
          {a.drafts}
        </span>
      )}
      {a.unread > 0 && (
        <span className="rounded-full bg-stone-200 px-1.5 py-0.5 text-[11px] leading-none font-medium text-stone-700" title={`${a.unread} unread`}>
          {a.unread} unread
        </span>
      )}
    </span>
  );
}

/** Dropdown at the top of every page: switch between Gmail accounts, see counts, add another. */
export default function AccountSwitcher({ accounts, currentId }: { accounts: Acct[]; currentId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDivElement>(null);
  const current = accounts.find((a) => a.id === currentId);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!accounts.length) {
    return (
      <a href="/api/auth/google?mode=add" className="btn-brand">+ Add Gmail account</a>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        className="flex max-w-[80vw] items-center gap-2 rounded-lg border border-stone-300 bg-white px-3 py-1.5 text-sm shadow-sm hover:bg-stone-50 sm:max-w-sm"
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={pending}
      >
        <span className={`h-2 w-2 shrink-0 rounded-full ${current?.connected ? "bg-emerald-500" : "bg-stone-300"}`} />
        <span className="min-w-0 truncate font-medium">
          {pending ? "Switching…" : current ? current.name && current.name !== current.email ? current.name : current.email : "Choose account"}
        </span>
        {current && <Badges a={current} />}
        <svg className="h-4 w-4 shrink-0 text-stone-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
          <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4z" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-80 max-w-[90vw] overflow-hidden rounded-xl border border-stone-200 bg-white shadow-lg" role="listbox">
          <ul className="max-h-80 overflow-y-auto py-1">
            {accounts.map((a) => (
              <li key={a.id}>
                <button
                  role="option"
                  aria-selected={a.id === currentId}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-stone-50 ${a.id === currentId ? "bg-brand-50" : ""}`}
                  onClick={() => {
                    setOpen(false);
                    if (a.id === currentId) return;
                    start(async () => {
                      await switchAccountAction(a.id);
                      router.refresh();
                    });
                  }}
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${a.connected ? "bg-emerald-500" : "bg-stone-300"}`} />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{a.name && a.name !== a.email ? a.name : a.email}</span>
                    <span className="block truncate text-xs text-stone-500">
                      {a.name && a.name !== a.email ? a.email : ""}
                      {!a.connected && " · disconnected"}
                    </span>
                  </span>
                  <Badges a={a} />
                </button>
              </li>
            ))}
          </ul>
          <div className="border-t border-stone-100 p-1">
            <a href="/api/auth/google?mode=add" className="block rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50">
              + Add Gmail account
            </a>
            <a href="/settings" className="block rounded-lg px-3 py-2 text-sm text-stone-600 hover:bg-stone-50">Manage accounts</a>
          </div>
        </div>
      )}
    </div>
  );
}
