import Link from "next/link";
import { Suspense } from "react";
import { db, must } from "@/lib/db";
import type { Client, Project } from "@/lib/types";
import { fmtDate, STATUS_STYLES } from "@/lib/format";
import SearchBox from "@/components/SearchBox";
import AddProjectButton from "@/components/AddProjectButton";

export const dynamic = "force-dynamic";
const STATUSES = ["all", "inquiry", "booked", "completed", "cancelled"];

export default async function ProjectsPage({ searchParams }: PageProps<"/projects">) {
  const sp = await searchParams;
  const q = String(sp.q ?? "").trim();
  const status = STATUSES.includes(String(sp.status)) ? String(sp.status) : "all";

  let query = db().from("projects").select("*, clients(id,name,email), emails(count)").order("created_at", { ascending: false }).limit(500);
  if (status !== "all") query = query.eq("status", status);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`project_name.ilike.%${safe}%,project_number.ilike.%${safe}%`);
  }
  const projects = must(await query) as unknown as (Project & { clients: Pick<Client, "id" | "name" | "email"> | null; emails: { count: number }[] })[];
  const clients = must(await db().from("clients").select("id,name,email").eq("ignored", false).order("name")) as Pick<Client, "id" | "name" | "email">[];

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Projects</h1>
          <p className="text-sm text-stone-500">Link emails to a project to keep each event&apos;s conversation together.</p>
        </div>
        <div className="flex items-center gap-3">
          <Suspense>
            <SearchBox placeholder="Search name or number…" />
          </Suspense>
          <AddProjectButton
            buttonClassName="btn-brand whitespace-nowrap"
            clients={clients.map((c) => ({ id: c.id, label: c.name ? `${c.name} (${c.email})` : c.email }))}
          />
        </div>
      </header>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {STATUSES.map((s) => (
          <Link
            key={s}
            href={`/projects${s === "all" ? "" : `?status=${s}`}${q ? `${s === "all" ? "?" : "&"}q=${encodeURIComponent(q)}` : ""}`}
            className={`rounded-full px-3 py-1 text-xs font-medium capitalize ${s === status ? "bg-stone-900 text-white" : "bg-white text-stone-600 ring-1 ring-stone-200 hover:bg-stone-50"}`}
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
            {projects.map((p) => (
              <tr key={p.id} className="hover:bg-stone-50">
                <td className="px-4 py-3 font-mono text-xs text-stone-500">#{p.project_number}</td>
                <td className="px-4 py-3">
                  <Link href={`/projects/${p.id}`} className="font-medium hover:underline">{p.project_name}</Link>
                  <span className="block text-xs text-stone-400">{p.emails?.[0]?.count ?? 0} emails</span>
                </td>
                <td className="hidden px-4 py-3 text-stone-600 sm:table-cell">
                  {p.clients ? <Link href={`/clients/${p.clients.id}`} className="hover:underline">{p.clients.name || p.clients.email}</Link> : "—"}
                </td>
                <td className="hidden px-4 py-3 text-stone-600 md:table-cell">{p.event_date ? fmtDate(p.event_date + "T12:00:00", false) : "—"}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`rounded-full px-2 py-0.5 text-xs capitalize ring-1 ${STATUS_STYLES[p.status]}`}>{p.status}</span>
                </td>
              </tr>
            ))}
            {projects.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-stone-500">No projects found.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
