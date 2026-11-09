import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import type { Client, Email, Project } from "@/lib/types";
import { fmtDate, STATUS_STYLES } from "@/lib/format";
import ClientEditor from "@/components/ClientEditor";
import EmailHistory from "@/components/EmailHistory";
import AddProjectButton from "@/components/AddProjectButton";

export const dynamic = "force-dynamic";

export default async function ClientPage({ params }: PageProps<"/clients/[id]">) {
  const { id } = await params;
  const res = await db().from("clients").select("*").eq("id", id).maybeSingle();
  if (!res.data) notFound();
  const client = res.data as Client;
  const [emails, projects, drafts] = await Promise.all([
    db().from("emails").select("*, projects(id,project_name,project_number)").eq("client_id", id).order("sent_at", { ascending: false }),
    db().from("projects").select("*").eq("client_id", id).order("created_at", { ascending: false }),
    db().from("drafts").select("id,email_id,status").in("status", ["pending", "revised"]),
  ]);
  const list = (emails.data ?? []) as (Email & { projects: Pick<Project, "id" | "project_name" | "project_number"> | null })[];
  const openDrafts = Object.fromEntries(((drafts.data ?? []) as { id: string; email_id: string }[]).map((d) => [d.email_id, d.id]));

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-4 text-sm">
        <Link href="/clients" className="text-stone-500 hover:text-stone-800">← Clients</Link>
      </div>
      <div className="grid gap-6 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="card p-4">
            <h1 className="text-lg font-semibold">{client.name || client.email}</h1>
            <p className="mb-4 text-xs text-stone-500">Client since {fmtDate(client.created_at, false)}</p>
            <ClientEditor client={client} />
          </div>
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <div className="label mb-0">Projects</div>
              <AddProjectButton clientId={client.id} />
            </div>
            <ul className="space-y-2">
              {((projects.data ?? []) as Project[]).map((p) => (
                <li key={p.id}>
                  <Link href={`/projects/${p.id}`} className="flex items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-stone-50">
                    <span>
                      <span className="text-stone-400">#{p.project_number}</span> {p.project_name}
                    </span>
                    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${STATUS_STYLES[p.status]}`}>{p.status}</span>
                  </Link>
                </li>
              ))}
              {!projects.data?.length && <li className="text-xs text-stone-400">No projects yet.</li>}
            </ul>
          </div>
        </aside>
        <section>
          <h2 className="mb-3 text-sm font-semibold">Email history ({list.length})</h2>
          <EmailHistory emails={list} openDrafts={openDrafts} />
        </section>
      </div>
    </div>
  );
}
