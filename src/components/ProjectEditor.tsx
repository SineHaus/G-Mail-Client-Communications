"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateProjectAction } from "@/app/actions";
import type { Project } from "@/lib/types";

export default function ProjectEditor({ project, clients }: { project: Project; clients: { id: string; label: string }[] }) {
  const router = useRouter();
  const init = {
    project_name: project.project_name,
    project_number: project.project_number,
    client_id: project.client_id ?? "",
    status: project.status as string,
    event_date: project.event_date ?? "",
    notes: project.notes ?? "",
  };
  const [f, setF] = useState(init);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(f) !== JSON.stringify(init);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <label className="w-24">
          <span className="label">Number</span>
          <input className="input" value={f.project_number} onChange={(e) => setF({ ...f, project_number: e.target.value })} />
        </label>
        <label className="flex-1">
          <span className="label">Name</span>
          <input className="input" value={f.project_name} onChange={(e) => setF({ ...f, project_name: e.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className="label">Client</span>
        <select className="input" value={f.client_id} onChange={(e) => setF({ ...f, client_id: e.target.value })}>
          <option value="">— None —</option>
          {clients.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
      </label>
      <div className="flex gap-2">
        <label className="flex-1">
          <span className="label">Status</span>
          <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
            <option value="inquiry">Inquiry</option>
            <option value="booked">Booked</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label className="flex-1">
          <span className="label">Event date</span>
          <input className="input" type="date" value={f.event_date} onChange={(e) => setF({ ...f, event_date: e.target.value })} />
        </label>
      </div>
      <label className="block">
        <span className="label">Notes (Claude sees these)</span>
        <textarea className="input min-h-28" placeholder="Items, quantities, venue, quote…" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
      </label>
      <div className="flex items-center gap-2">
        <button
          className="btn-brand"
          disabled={!dirty || pending}
          onClick={() =>
            start(async () => {
              const r = await updateProjectAction(project.id, {
                ...f,
                client_id: f.client_id || null,
                event_date: f.event_date || null,
                notes: f.notes || null,
              });
              setMsg(r.ok ? "Saved" : r.error);
              router.refresh();
            })
          }
        >
          Save
        </button>
        {msg && <span className="text-xs text-stone-500">{msg}</span>}
      </div>
    </div>
  );
}
