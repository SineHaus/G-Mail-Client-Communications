import Link from "next/link";
import { Suspense } from "react";
import { db, must } from "@/lib/db";
import type { Client, Project } from "@/lib/types";
import { fmtDate, STATUS_STYLES } from "@/lib/format";
import { getCurrentAccount, listAccounts, visibleProjectIds } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { can } from "@/lib/permissions";
import SearchBox from "@/components/SearchBox";
import AddProjectButton from "@/components/AddProjectButton";
import NoAccount from "@/components/NoAccount";
import CommunicationTabs from "@/components/CommunicationTabs";

export const dynamic = "force-dynamic";
// Server actions on this page (Sync now, Redraft, Review, Retry) call Claude; give them the full 5 minutes.
export const maxDuration = 300;
const STATUSES = ["all", "inquiry", "booked", "completed", "cancelled"];

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const sp = await searchParams;
  const q = String(sp.q ?? "").trim().toLowerCase();
  const status = STATUSES.includes(String(sp.status)) ? String(sp.status) : "all";
  const member = await requireMember();
  const accounts = await listAccounts(member);
  const acct = await getCurrentAccount(accounts);
  if (!acct) return <NoAccount isOwner={member.is_owner} />;
  const accountIds = accounts.map((a) => a.id);

  // Shared TERG projects, limited to those touching an account this person can access.
  const visible = await visibleProjectIds(accountIds);
  let projects = visible.length
    ? (must(
        await db().from("projects").select("*").in("id", visible).order("created_at", { ascending: false }).limit(1000),
      ) as Project[])
    : [];
  if (status !== "all") projects = projects.filter((p) => p.status === status);
  if (q) projects = projects.filter((p) => p.project_name.toLowerCase().includes(q) || p.project_number.toLowerCase().includes(q));

  const clientIds = [...new Set(projects.map((p) => p.client_id).filter(Boolean))] as string[];
  const [clientRows, emailRows, myClients] = await Promise.all([
    clientIds.length
      ? db().from("clients").select("id,name,email,account_id").in("account_id", accountIds).in("id", clientIds)
      : Promise.resolve({ data: [] }),
    projects.length
      ? db().from("emails").select("project_id").in("account_id", accountIds).in("project_id", projects.map((p) => p.id))
      : Promise.resolve({ data: [] }),
    db().from("clients").select("id,name,email").eq("account_id", acct.id).eq("ignored", false).order("name"),
  ]);
  const clients = new Map(((clientRows.data ?? []) as (Pick<Client, "id" | "name" | "email">)[]).map((c) => [c.id, c]));
  const counts = new Map<string, number>();
  for (const e of (emailRows.data ?? []) as { project_id: string }[]) counts.set(e.project_id, (counts.get(e.project_id) ?? 0) + 1);

  return (
    <div className="mx-auto max-w-5xl">
      <CommunicationTabs active="projects" />
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-stone-500">Shared across TERG&apos;s inboxes, with one numbering. Link emails to keep each event together.</p>
        </div>
        <div className="flex items-center gap-3">
          <Suspense>
            <SearchBox placeholder="Search name or number…" />
          </Suspense>
          {can(acct.role, "edit") && (
            <AddProjectButton
              buttonClassName="btn-brand whitespace-nowrap"
              clients={((myClients.data ?? []) as Pick<Client, "id" | "name" | "email">[]).map((c) => ({ id: c.id, label: c.name ? `${c.name} (${c.email})` : c.email }))}
            />
          )}
        </div>
      </header>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/projects${s === "all" ? "" : `?status=${s}`}${q ? `${s === "all" ? "?" : "&"}q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${s === status ? "bg-[var(--ink)] text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50"}`}
          >
            {s}
          </Link>
        ))}
      </div>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs tracking-wide text-stone-500 uppercase">
            <tr>
              <th className="px-4 py-2.5 font-medium">No.</th>
              <th className="px-4 py-2.5 font-medium">Project</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Client</th>
              <th className="hidden px-4 py-2.5 font-medium md:table-cell">Event date</th>
              <th className="px-4 py-2.5 text-right font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {projects.map((p) => {
              const c = p.client_id ? clients.get(p.client_id) : undefined;
              return (
                <tr key={p.id} className="hover:bg-stone-50">
                  <td className="px-4 py-3 font-mono text-xs text-stone-500">#{p.project_number}</td>
                  <td className="px-4 py-3">
                    <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.project_name}</Link>
                    <span className="block text-xs text-stone-400">{counts.get(p.id) ?? 0} emails</span>
                  </td>
                  <td className="hidden px-4 py-3 text-stone-600 sm:table-cell">{c ? c.name || c.email : "—"}</td>
                  <td className="hidden px-4 py-3 text-stone-600 md:table-cell">{p.event_date ? fmtDate(p.event_date + "T12:00:00", false) : "—"}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`rounded-full px-2 py-0.5 text-xs capitalize ring-1 ${STATUS_STYLES[p.status]}`}>{p.status}</span>
                  </td>
                </tr>
              );
            })}
            {projects.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-stone-500">No projects found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
