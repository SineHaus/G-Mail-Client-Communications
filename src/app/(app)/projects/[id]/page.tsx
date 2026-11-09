import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import type { Client, Email, Project } from "@/lib/types";
import ProjectEditor from "@/components/ProjectEditor";
import EmailHistory from "@/components/EmailHistory";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const res = await db().from("projects").select("*").eq("id", id).maybeSingle();
  if (!res.data) notFound();
  const project = res.data as Project;
  const [emails, clients, drafts] = await Promise.all([
    db().from("emails").select("*").eq("project_id", id).order("sent_at", { ascending: true }),
    db().from("clients").select("id,name,email").order("name"),
    db().from("drafts").select("id,email_id").in("status", ["pending", "revised"]),
  ]);
  const allClients = (clients.data ?? []) as Pick<Client, "id" | "name" | "email">[];
  const clientMap = Object.fromEntries(allClients.map((c) => [c.id, { id: c.id, name: c.name || c.email }]));
  const linkedClient = allClients.find((c) => c.id === project.client_id);
  const openDrafts = Object.fromEntries(((drafts.data ?? []) as { id: string; email_id: string }[]).map((d) => [d.email_id, d.id]));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 text-sm">
        <Link href="/projects" className="text-stone-500 hover:text-stone-800">← Projects</Link>
      </div>
      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="card h-fit p-4">
          <div className="font-mono text-xs text-stone-400">#{project.project_number}</div>
          <h1 className="mb-1 text-lg font-semibold">{project.project_name}</h1>
          {linkedClient && (
            <Link href={`/clients/${linkedClient.id}`} className="mb-4 block text-sm text-brand-700 hover:underline">
              {linkedClient.name || linkedClient.email}
            </Link>
          )}
          <ProjectEditor project={project} clients={allClients.map((c) => ({ id: c.id, label: c.name ? `${c.name} (${c.email})` : c.email }))} />
        </aside>
        <section>
          <h2 className="mb-3 text-sm font-semibold">Linked emails, oldest first ({emails.data?.length ?? 0})</h2>
          <EmailHistory emails={(emails.data ?? []) as Email[]} openDrafts={openDrafts} showClient={clientMap} />
          {!emails.data?.length && (
            <p className="mt-3 text-xs text-stone-500">Link emails from the Review view or accept Claude&apos;s project suggestions.</p>
          )}
        </section>
      </div>
    </div>
  );
}
