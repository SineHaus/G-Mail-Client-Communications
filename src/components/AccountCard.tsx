"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { disconnectAccountAction, renameAccountAction, startWatchAction, switchAccountAction, syncNowAction } from "@/app/actions";
import { fmtDate } from "@/lib/format";

type A = {
  id: string;
  email: string;
  name: string | null;
  connected: boolean;
  lastSynced: string | null;
  watchExpiration: string | null;
  lastError: string | null;
};

export default function AccountCard({ account: a, isCurrent }: { account: A; isCurrent: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [name, setName] = useState(a.name && a.name !== a.email ? a.name : "");
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  // eslint-disable-next-line react-hooks/purity -- display-only comparison against the current time
  const watchOk = a.watchExpiration && new Date(a.watchExpiration).getTime() > Date.now();

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, okMsg: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? okMsg : r.error ?? "Failed");
      router.refresh();
    });

  return (
    <li className={`rounded-xl border p-4 ${isCurrent ? "border-brand-500 bg-brand-50/30" : "border-stone-200"}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${a.connected ? "bg-emerald-500" : "bg-stone-300"}`} />
            <span className="font-medium break-all">{a.email}</span>
            {isCurrent && <span className="rounded-full bg-brand-100 px-2 py-0.5 text-xs text-brand-700">viewing</span>}
          </div>
          <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1 text-xs text-stone-600">
            <dt className="text-stone-400">Status</dt>
            <dd>{a.connected ? "Connected (read + send)" : "Disconnected — tokens removed"}</dd>
            <dt className="text-stone-400">Last sync</dt>
            <dd>{a.lastSynced ? fmtDate(a.lastSynced) : "Never"}</dd>
            <dt className="text-stone-400">Push notifications</dt>
            <dd>
              {!a.connected ? "Off" : watchOk ? <>On until {fmtDate(a.watchExpiration)} · renews automatically</> : <span className="text-amber-700">Not active</span>}
            </dd>
          </dl>
          {a.lastError && <p className="mt-2 text-xs text-red-700">{a.lastError}</p>}
        </div>
        {!isCurrent && (
          <button className="btn-secondary" disabled={pending} onClick={() => act(() => switchAccountAction(a.id), "Switched")}>
            View this account
          </button>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          className="input w-56 py-1.5"
          placeholder="Display / sender name (optional)"
          value={name}
          onChange={(e) => setName(e.target.value)}
          aria-label="Display name"
        />
        <button className="btn-ghost" disabled={pending} onClick={() => act(() => renameAccountAction(a.id, name), "Saved")}>
          Save name
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
        {a.connected ? (
          <>
            <button className="btn-secondary" disabled={pending} onClick={() => act(() => syncNowAction(a.id), "Synced")}>↻ Sync now</button>
            <button className="btn-secondary" disabled={pending} onClick={() => act(() => startWatchAction(a.id), "Push notifications on")}>
              {watchOk ? "Renew push now" : "Start push notifications"}
            </button>
            {confirmDisconnect ? (
              <>
                <button className="btn btn-danger border-red-300" disabled={pending} onClick={() => act(() => disconnectAccountAction(a.id), "Disconnected")}>
                  Yes, disconnect and remove tokens
                </button>
                <button className="btn-ghost" onClick={() => setConfirmDisconnect(false)}>Cancel</button>
              </>
            ) : (
              <button className="btn-danger" disabled={pending} onClick={() => setConfirmDisconnect(true)}>Disconnect</button>
            )}
          </>
        ) : (
          <a className="btn-brand" href={`/api/auth/google?mode=add&hint=${encodeURIComponent(a.email)}`}>Reconnect</a>
        )}
        {pending && <span className="text-xs text-stone-500">Working…</span>}
        {msg && !pending && <span className="text-xs text-stone-500">{msg}</span>}
      </div>
      {confirmDisconnect && (
        <p className="mt-2 text-xs text-stone-500">
          Stops push notifications, revokes access at Google and deletes the stored token. Emails, clients and projects stay in the dashboard; reconnect any time.
        </p>
      )}
    </li>
  );
}
