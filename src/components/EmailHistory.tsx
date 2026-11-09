"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { draftForEmailAction } from "@/app/actions";
import type { Email, Project } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import Expandable from "./Expandable";

type Row = Email & { projects?: Pick<Project, "id" | "project_name" | "project_number"> | null };

export default function EmailHistory({
  emails,
  openDrafts,
  showClient,
}: {
  emails: Row[];
  openDrafts: Record<string, string>;
  showClient?: Record<string, { id: string; name: string }>;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!emails.length) return <div className="card p-8 text-center text-sm text-stone-500">No emails yet.</div>;

  return (
    <ol className="space-y-3">
      {emails.map((m) => {
        const draftId = openDrafts[m.id];
        const client = showClient && m.client_id ? showClient[m.client_id] : null;
        return (
          <li key={m.id} className={`card p-4 ${m.direction === "outbound" ? "border-l-4 border-l-emerald-400" : "border-l-4 border-l-stone-300"}`}>
            <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
              <span className={`rounded-full px-2 py-0.5 font-medium ${m.direction === "outbound" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-700"}`}>
                {m.direction === "outbound" ? "You → client" : "Client → you"}
              </span>
              {client && <Link href={`/clients/${client.id}`} className="font-medium hover:underline">{client.name}</Link>}
              <span className="text-stone-400">{fmtDate(m.sent_at)}</span>
              {m.projects && (
                <Link href={`/projects/${m.projects.id}`} className="rounded-full bg-stone-100 px-2 py-0.5 text-stone-700 hover:bg-stone-200">
                  #{m.projects.project_number} {m.projects.project_name}
                </Link>
              )}
              <span className="ml-auto flex gap-2">
                {draftId ? (
                  <Link href={`/review/${draftId}`} className="font-medium text-brand-700 hover:underline">Review draft →</Link>
                ) : (
                  m.direction === "inbound" && (
                    <button
                      className="font-medium text-brand-700 hover:underline disabled:opacity-50"
                      disabled={pending}
                      onClick={() => {
                        setBusy(m.id);
                        setError(null);
                        start(async () => {
                          const r = await draftForEmailAction(m.id);
                          setBusy(null);
                          if (r.ok && r.data) router.push(`/review/${r.data}`);
                          else setError(r.ok ? "Couldn't create a draft" : r.error);
                        });
                      }}
                    >
                      {busy === m.id ? "Drafting…" : "Draft reply"}
                    </button>
                  )
                )}
              </span>
            </div>
            <div className="mb-1 text-sm font-medium">{m.subject || "(no subject)"}</div>
            <Expandable text={m.body ?? m.snippet ?? ""} lines={4} className="text-stone-700" />
          </li>
        );
      })}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </ol>
  );
}
