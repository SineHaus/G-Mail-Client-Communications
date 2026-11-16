import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import type { Client, Email, Project } from "@/lib/types";
import { getCurrentAccount, listAccounts, visibleProjectIds } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { can } from "@/lib/permissions";
import ProjectEditor from "@/components/ProjectEditor";
import EmailHistory from "@/components/EmailHistory";

export const dynamic = "force-dynamic";

export default async function ProjectPage({ params }: PageProps<"/projects/[id]">) {
  const { id } = await params;
  const member = await requireMember();
  const accounts = await listAccounts(member);
  const acct = await getCurrentAccount(accounts);
  if (!acct) notFound();
  const accountIds = accounts.map((a) => a.id);
  const visible = (await visibleProjectIds(accountIds)).filter((v) => v === id);
  if (!visible.length) notFound(); // not visible through any account this person can access
  const res = await db().from("projects").select("*").in("id", visible).maybeSingle();
  if (!res.data) notFound();
  const project = res.data as Project;

  // Only emails from accounts this person can access; each labelled with its inbox.
  const [emails, clients, drafts] = await Promise.all([
    db().from("emails").select("*").in("account_id", accountIds).eq("project_id", id).order("sent_at", { ascending: true }),
    db().from("clients").select("id,name,email,account_id").in("account_id", accountIds).order("name"),
    db().from("drafts").select("id,email_id").eq("account_id", acct.id).eq("status", "pending"),
  ]);
  const allClients = (clients.data ?? []) as (Pick<Client, "id" | "name" | "email"> & { account_id: string })[];
  const clientMap = Object.fromEntries(allClients.map((c) => [c.id, { id: c.id, name: c.name || c.email }]));
  const linkedClient = allClients.find((c) => c.id === project.client_id);
  const openDrafts = Object.fromEntries(((drafts.data ?? []) as { id: string; email_id: string }[]).map((d) => [d.email_id, d.id]));
  const inbox = Object.fromEntries(accounts.map((a) => [a.id, a.display_name && a.display_name !== a.email_address ? a.display_name : a.email_address]));
  const list = ((emails.data ?? []) as Email[]).map((e) => ({ ...e, inbox: accounts.length > 1 ? inbox[e.account_id] : undefined }));
  const canEdit = can(acct.role, "edit");

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
          <ProjectEditor
            project={project}
            canEdit={canEdit}
            clients={allClients.filter((c) => c.account_id === acct.id || c.id === project.client_id).map((c) => ({ id: c.id, label: c.name ? `${c.name} (${c.email})` : c.email }))}
          />
        </aside>
        <section>
          <h2 className="mb-3 text-sm font-semibold">Linked emails, oldest first ({list.length})</h2>
          <EmailHistory emails={list} openDrafts={openDrafts} showClient={clientMap} canEdit={canEdit} currentAccountId={acct.id} />
          {!list.length && <p className="mt-3 text-xs text-stone-500">Link emails from the Review screen, or mention #{project.project_number} in an email and it links itself.</p>}
        </section>
      </div>
    </div>
  );
}
