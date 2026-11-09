import Link from "next/link";
import { Suspense } from "react";
import { db, must } from "@/lib/db";
import type { Client, Draft, Email, Project } from "@/lib/types";
import { timeAgo } from "@/lib/format";
import Expandable from "@/components/Expandable";
import DraftActions from "@/components/DraftActions";
import ProjectSuggestion from "@/components/ProjectSuggestion";
import SearchBox from "@/components/SearchBox";
import SyncButton from "@/components/SyncButton";

export const dynamic = "force-dynamic";

type Row = Draft & {
  emails: Email & { clients: Client | null; projects: Pick<Project, "id" | "project_name" | "project_number"> | null };
  suggested: Pick<Project, "id" | "project_name" | "project_number"> | null;
};

const TABS = [
  { key: "open", label: "To review", statuses: ["pending", "revised"] },
  { key: "accepted", label: "Sent", statuses: ["accepted"] },
  { key: "declined", label: "Declined", statuses: ["declined", "superseded"] },
];

export default async function QueuePage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const q = String(sp.q ?? "").toLowerCase().trim();

  let rows = must(
    await db()
      .from("drafts")
      .select(
        "*, emails!inner(*, clients(*), projects(id,project_name,project_number)), suggested:projects!drafts_suggested_project_id_fkey(id,project_name,project_number)",
      )
      .in("status", tab.statuses)
      .order(tab.key === "open" ? "created_at" : "updated_at", { ascending: false })
      .limit(200),
  ) as unknown as Row[];

  if (q) {
    rows = rows.filter((r) =>
      [r.emails.subject, r.emails.body, r.body, r.emails.clients?.name, r.emails.clients?.email, r.emails.clients?.company, r.emails.projects?.project_name, r.emails.projects?.project_number]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q)),
    );
  }
  const acct = await db().from("gmail_account").select("email,last_synced_at").eq("id", 1).maybeSingle();

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Review Queue</h1>
          <p className="text-sm text-stone-500">
            Claude drafts a reply to every new client email. Nothing is sent until you press Accept.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Suspense>
            <SearchBox placeholder="Search client, subject, text…" />
          </Suspense>
          <SyncButton lastSynced={acct.data?.last_synced_at ?? null} />
        </div>
      </header>

      <div className="mb-4 flex gap-1 border-b border-stone-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={t.key === "open" ? "/" : `/?tab=${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium ${
              t.key === tab.key ? "border-brand-600 text-brand-700" : "border-transparent text-stone-500 hover:text-stone-800"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {!acct.data && (
        <div className="card p-6 text-sm">
          Gmail isn&apos;t connected yet. <a className="text-brand-700 underline" href="/api/auth/google">Connect Gmail</a>.
        </div>
      )}

      {rows.length === 0 && acct.data && (
        <div className="card p-10 text-center text-sm text-stone-500">
          {tab.key === "open" ? "All caught up — no drafts waiting for review." : "Nothing here yet."}
        </div>
      )}

      <ul className="space-y-4">
        {rows.map((r) => {
          const e = r.emails;
          const c = e.clients;
          const to = e.from_address ?? c?.email ?? "";
          const open = r.status === "pending" || r.status === "revised";
          return (
            <li key={r.id} className="card overflow-hidden">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-100 px-4 py-3">
                <Link href={c ? `/clients/${c.id}` : "#"} className="font-semibold hover:underline">
                  {c?.name || e.from_name || to}
                </Link>
                <span className="text-xs text-stone-500">{to}</span>
                {e.projects && (
                  <Link
                    href={`/projects/${e.projects.id}`}
                    className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 hover:bg-stone-200"
                  >
                    #{e.projects.project_number} {e.projects.project_name}
                  </Link>
                )}
                {r.status === "revised" && <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">edited</span>}
                <span className="ml-auto text-xs text-stone-400">received {timeAgo(e.sent_at)}</span>
              </div>
              <div className="grid gap-0 md:grid-cols-2">
                <div className="border-stone-100 p-4 md:border-r">
                  <div className="label">Client wrote</div>
                  <div className="mb-2 text-sm font-medium">{e.subject || "(no subject)"}</div>
                  <Expandable text={e.body ?? e.snippet ?? ""} lines={8} className="text-stone-700" />
                </div>
                <div className="bg-stone-50/60 p-4">
                  <div className="label">{open ? "Claude's draft" : r.status === "accepted" ? "Sent reply" : "Draft"}</div>
                  {r.error ? (
                    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Couldn&apos;t draft a reply: {r.error}</p>
                  ) : (
                    <Expandable text={r.body} lines={10} />
                  )}
                </div>
              </div>
              {open && (
                <div className="space-y-3 border-t border-stone-100 px-4 py-3">
                  {r.suggested && !e.project_id && (
                    <ProjectSuggestion draftId={r.id} emailId={e.id} project={r.suggested} reason={r.suggestion_reason} />
                  )}
                  <DraftActions draftId={r.id} to={to} failed={!!r.error} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
