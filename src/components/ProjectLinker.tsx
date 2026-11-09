"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { linkProjectAction } from "@/app/actions";
import type { ProjectLite } from "@/lib/types";
import NewProjectForm from "./NewProjectForm";

/** Link an email (and its thread) to a project, or create a new project for it. */
export default function ProjectLinker({
  emailId,
  currentProjectId,
  projects,
  clientId,
}: {
  emailId: string;
  currentProjectId: string | null;
  projects: ProjectLite[];
  clientId: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [creating, setCreating] = useState(false);
  const mine = projects.filter((p) => p.client_id === clientId);
  const others = projects.filter((p) => p.client_id !== clientId);
  const current = projects.find((p) => p.id === currentProjectId);

  if (creating) {
    return (
      <div className="w-72">
        <NewProjectForm clientId={clientId} linkEmailId={emailId} onDone={() => { setCreating(false); router.refresh(); }} onCancel={() => setCreating(false)} />
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <select
        className="input py-1.5"
        value={currentProjectId ?? ""}
        disabled={pending}
        onChange={(e) => {
          if (e.target.value === "__new") return setCreating(true);
          start(async () => {
            await linkProjectAction(emailId, e.target.value || null);
            router.refresh();
          });
        }}
      >
        <option value="">— Not linked —</option>
        {mine.length > 0 && (
          <optgroup label="This client's projects">
            {mine.map((p) => (
              <option key={p.id} value={p.id}>#{p.project_number} {p.project_name}</option>
            ))}
          </optgroup>
        )}
        {others.length > 0 && (
          <optgroup label="Other projects">
            {others.map((p) => (
              <option key={p.id} value={p.id}>#{p.project_number} {p.project_name}</option>
            ))}
          </optgroup>
        )}
        <option value="__new">+ New project…</option>
      </select>
      {current && (
        <Link href={`/projects/${current.id}`} className="text-xs text-brand-700 hover:underline">Open</Link>
      )}
    </div>
  );
}
