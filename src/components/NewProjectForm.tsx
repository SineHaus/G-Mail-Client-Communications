"use client";
import { useEffect, useState, useTransition } from "react";
import { createProjectAction, nextProjectNumber } from "@/app/actions";

export default function NewProjectForm({
  clientId,
  clients,
  linkEmailId,
  onDone,
  onCancel,
}: {
  clientId?: string | null;
  clients?: { id: string; label: string }[];
  linkEmailId?: string;
  onDone: (id: string) => void;
  onCancel?: () => void;
}) {
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [client, setClient] = useState(clientId ?? "");
  const [status, setStatus] = useState("inquiry");
  const [eventDate, setEventDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    nextProjectNumber().then((n) => setNumber((cur) => cur || n)).catch(() => {});
  }, []);

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        start(async () => {
          const r = await createProjectAction({
            project_name: name,
            project_number: number,
            client_id: client || null,
            status,
            event_date: eventDate || null,
            linkEmailId,
          });
          if (!r.ok) return setError(r.error);
          onDone(r.data!);
        });
      }}
    >
      <div className="flex gap-2">
        <input className="input w-24" placeholder="No." value={number} onChange={(e) => setNumber(e.target.value)} required aria-label="Project number" />
        <input className="input" placeholder="Project name (e.g. Smith Wedding)" value={name} onChange={(e) => setName(e.target.value)} required autoFocus aria-label="Project name" />
      </div>
      {clients && (
        <select className="input" value={client} onChange={(e) => setClient(e.target.value)} aria-label="Client">
          <option value="">— No client —</option>
          {clients.map((c) => (
            <option key={c.id} value={c.id}>{c.label}</option>
          ))}
        </select>
      )}
      <div className="flex gap-2">
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="inquiry">Inquiry</option>
          <option value="booked">Booked</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <input className="input" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} aria-label="Event date" title="Event date" />
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-brand" disabled={pending}>{pending ? "Creating…" : linkEmailId ? "Create & link" : "Create project"}</button>
        {onCancel && <button type="button" className="btn-ghost" onClick={onCancel}>Cancel</button>}
      </div>
    </form>
  );
}
