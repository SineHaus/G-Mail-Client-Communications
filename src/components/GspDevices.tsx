"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGspDeviceAction, revokeGspDeviceAction } from "@/app/actions";

type Device = { id: string; label: string; created_by: string; created_at: string; last_seen_at: string | null; last_signed_in_as: string | null; revoked_at: string | null };

/** Settings → Goodshuffle messages: tokens for the Chrome that runs the extension. A new token is shown once. */
export default function GspDevices({ devices, origin }: { devices: Device[]; origin: string }) {
  const router = useRouter();
  const [label, setLabel] = useState("Leo's MacBook Pro");
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const active = devices.filter((d) => !d.revoked_at);

  return (
    <div className="space-y-3 text-sm">
      {active.length > 0 && (
        <ul className="divide-y divide-stone-200 rounded-lg border border-stone-200">
          {active.map((d) => (
            <li key={d.id} className="flex flex-wrap items-center gap-2 p-3">
              <span className="grow">
                <b>{d.label}</b>
                <span className="block text-xs text-stone-500">
                  {d.last_seen_at ? `Last checked in ${new Date(d.last_seen_at).toLocaleString()}` : "Hasn't checked in yet"}
                  {d.last_signed_in_as ? `, Goodshuffle signed in as ${d.last_signed_in_as}` : ""}
                </span>
              </span>
              <button
                className="btn-danger"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await revokeGspDeviceAction(d.id);
                    if (!r.ok) setError(r.error);
                    router.refresh();
                  })
                }
              >
                Disconnect
              </button>
            </li>
          ))}
        </ul>
      )}

      {token ? (
        <div className="rounded-lg bg-amber-50 p-3">
          <p className="mb-2">
            Copy these into the extension&apos;s settings now. The token is shown only once; if you lose it, disconnect this Chrome and make a new one.
          </p>
          <p className="text-xs text-stone-500">Dashboard address</p>
          <code className="mb-2 block break-all rounded bg-white p-2">{origin}</code>
          <p className="text-xs text-stone-500">Token</p>
          <code className="block break-all rounded bg-white p-2">{token}</code>
          <button className="btn-secondary mt-2" onClick={() => (setToken(null), router.refresh())}>
            Done
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <input className="input grow" value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Name for this Chrome" />
          <button
            className="btn-brand"
            disabled={pending || !label.trim()}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await createGspDeviceAction(label);
                if (!r.ok) return setError(r.error);
                setToken(r.data?.token ?? null);
              })
            }
          >
            {pending ? "Making…" : "Connect a Chrome"}
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
