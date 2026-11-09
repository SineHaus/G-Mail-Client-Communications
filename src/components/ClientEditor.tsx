"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateClientAction } from "@/app/actions";
import type { Client } from "@/lib/types";

export default function ClientEditor({ client }: { client: Client }) {
  const router = useRouter();
  const [f, setF] = useState({
    name: client.name ?? "",
    phone: client.phone ?? "",
    company: client.company ?? "",
    notes: client.notes ?? "",
  });
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty =
    f.name !== (client.name ?? "") || f.phone !== (client.phone ?? "") || f.company !== (client.company ?? "") || f.notes !== (client.notes ?? "");

  const field = (k: keyof typeof f, label: string, type = "text") => (
    <label className="block">
      <span className="label">{label}</span>
      <input className="input" type={type} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
    </label>
  );

  return (
    <div className="space-y-3">
      <div>
        <span className="label">Email</span>
        <a href={`mailto:${client.email}`} className="text-sm break-all text-brand-700">{client.email}</a>
      </div>
      {field("name", "Name")}
      {field("phone", "Phone", "tel")}
      {field("company", "Company")}
      <label className="block">
        <span className="label">Notes (Claude sees these)</span>
        <textarea className="input min-h-24" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      <div className="flex items-center gap-2">
        <button
          className="btn-brand"
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const r = await updateClientAction(client.id, f);
              setMsg(r.ok ? "Saved" : r.error);
              router.refresh();
            })
          }
        >
          Save
        </button>
        {msg && <span className="text-xs text-stone-500">{msg}</span>}
      </div>
      <label className="flex items-start gap-2 border-t border-stone-100 pt-3 text-xs text-stone-600">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={client.ignored}
          disabled={pending}
          onChange={(e) =>
            start(async () => {
              await updateClientAction(client.id, { ignored: e.target.checked });
              router.refresh();
            })
          }
        />
        <span>Not a client (vendor, personal, etc.) — Claude won&apos;t draft replies to this address.</span>
      </label>
    </div>
  );
}
