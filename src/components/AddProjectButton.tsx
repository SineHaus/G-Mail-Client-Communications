"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import NewProjectForm from "./NewProjectForm";

export default function AddProjectButton({
  clientId,
  clients,
  buttonClassName = "text-xs font-medium text-brand-700 hover:underline",
}: {
  clientId?: string;
  clients?: { id: string; label: string }[];
  buttonClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  if (!open) return <button className={buttonClassName} onClick={() => setOpen(true)}>+ New project</button>;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 pt-24" onClick={() => setOpen(false)}>
      <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-3 font-semibold">New project</h3>
        <NewProjectForm
          clientId={clientId}
          clients={clients}
          onDone={(id) => { setOpen(false); router.push(`/projects/${id}`); }}
          onCancel={() => setOpen(false)}
        />
      </div>
    </div>
  );
}
