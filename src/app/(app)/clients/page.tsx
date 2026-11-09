import Link from "next/link";
import { Suspense } from "react";
import { db, must } from "@/lib/db";
import type { Client } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import SearchBox from "@/components/SearchBox";

export const dynamic = "force-dynamic";

export default async function ClientsPage({ searchParams }: PageProps<"/clients">) {
  const sp = await searchParams;
  const q = String(sp.q ?? "").trim();
  const showIgnored = sp.ignored === "1";

  let query = db().from("clients").select("*, emails(count)").order("created_at", { ascending: false }).limit(500);
  if (!showIgnored) query = query.eq("ignored", false);
  if (q) {
    const safe = q.replace(/[%,()]/g, " ");
    query = query.or(`name.ilike.%${safe}%,email.ilike.%${safe}%,company.ilike.%${safe}%,phone.ilike.%${safe}%`);
  }
  const clients = must(await query) as unknown as (Client & { emails: { count: number }[] })[];

  const recent = must(
    await db().from("emails").select("client_id,sent_at").order("sent_at", { ascending: false }).limit(2000),
  ) as { client_id: string; sent_at: string }[];
  const last = new Map<string, string>();
  for (const r of recent) if (r.client_id && !last.has(r.client_id)) last.set(r.client_id, r.sent_at);
  clients.sort((a, b) => (last.get(b.id) ?? b.created_at).localeCompare(last.get(a.id) ?? a.created_at));

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Clients</h1>
          <p className="text-sm text-stone-500">Created automatically from your email. {clients.length} shown.</p>
        </div>
        <div className="flex items-center gap-3">
          <Suspense>
            <SearchBox placeholder="Search name, email, company…" />
          </Suspense>
          <Link href={showIgnored ? "/clients" : "/clients?ignored=1"} className="text-xs whitespace-nowrap text-stone-500 hover:underline">
            {showIgnored ? "Hide non-clients" : "Show non-clients"}
          </Link>
        </div>
      </header>
      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-stone-50 text-left text-xs tracking-wide text-stone-500 uppercase">
            <tr>
              <th className="px-4 py-2.5 font-medium">Client</th>
              <th className="hidden px-4 py-2.5 font-medium sm:table-cell">Company</th>
              <th className="hidden px-4 py-2.5 text-right font-medium md:table-cell">Emails</th>
              <th className="px-4 py-2.5 text-right font-medium">Last contact</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {clients.map((c) => (
              <tr key={c.id} className="hover:bg-stone-50">
                <td className="px-4 py-3">
                  <Link href={`/clients/${c.id}`} className="block">
                    <span className="font-medium">{c.name || c.email}</span>
                    {c.ignored && <span className="ml-2 rounded bg-stone-100 px-1.5 text-xs text-stone-500">not a client</span>}
                    <span className="block text-xs text-stone-500">{c.email}</span>
                  </Link>
                </td>
                <td className="hidden px-4 py-3 text-stone-600 sm:table-cell">{c.company}</td>
                <td className="hidden px-4 py-3 text-right text-stone-600 md:table-cell">{c.emails?.[0]?.count ?? 0}</td>
                <td className="px-4 py-3 text-right text-xs text-stone-500">{last.get(c.id) ? timeAgo(last.get(c.id)!) : "—"}</td>
              </tr>
            ))}
            {clients.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-stone-500">No clients found.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
