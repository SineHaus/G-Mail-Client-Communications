import Link from "next/link";
import { Suspense } from "react";
import { db, must } from "@/lib/db";
import type { Client, Draft, Email, Project } from "@/lib/types";
import { presenceCutoff, timeAgo } from "@/lib/format";
import { getCurrentAccount } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { can } from "@/lib/permissions";
import Expandable from "@/components/Expandable";
import DraftActions from "@/components/DraftActions";
import ProjectSuggestion from "@/components/ProjectSuggestion";
import SearchBox from "@/components/SearchBox";
import SyncButton from "@/components/SyncButton";
import ReadToggle from "@/components/ReadToggle";
import NoAccount from "@/components/NoAccount";
import AccountHealth from "@/components/AccountHealth";

export const dynamic = "force-dynamic";
// Server actions on this page (Sync now, Redraft, Review, Retry) call Claude; give them the full 5 minutes.
export const maxDuration = 300;

type Row = Draft & {
  emails: Email & { clients: Client | null; projects: Pick<Project, "id" | "project_name" | "project_number"> | null };
  suggested: Pick<Project, "id" | "project_name" | "project_number"> | null;
};

const TABS = [
  { key: "open", label: "To review", statuses: ["pending", "sending"] },
  { key: "sent", label: "Sent", statuses: ["sent"] },
  { key: "declined", label: "Handled outside", statuses: ["declined"] },
];

export default async function QueuePage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const tab = TABS.find((t) => t.key === sp.tab) ?? TABS[0];
  const q = String(sp.q ?? "").toLowerCase().trim();
  const member = await requireMember();
  const acct = await getCurrentAccount();
  if (!acct) return <NoAccount isOwner={member.is_owner} />;
  const canEdit = can(acct.role, "edit");
  const canApprove = can(acct.role, "approve");

  let rows = must(
    await db()
      .from("drafts")
      .select(
        "*, emails!drafts_email_fk!inner(*, clients!emails_client_fk(*), projects!emails_project_id_fkey(id,project_name,project_number)), suggested:projects!drafts_suggested_project_id_fkey(id,project_name,project_number)",
      )
      .eq("account_id", acct.id)
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

  // Teammates with a draft open in the last 90 seconds.
  const presence = rows.length
    ? (must(
        await db()
          .from("presence")
          .select("email_id,member_name,member_email")
          .eq("account_id", acct.id)
          .in("email_id", rows.map((r) => r.email_id))
          .neq("member_email", member.email)
          .gte("seen_at", presenceCutoff()),
      ) as { email_id: string; member_name: string | null; member_email: string }[])
    : [];
  const viewing = new Map<string, string[]>();
  for (const p of presence) viewing.set(p.email_id, [...(viewing.get(p.email_id) ?? []), p.member_name || p.member_email]);

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Queue</h1>
          <p className="text-sm text-stone-500">
            <span className="font-medium text-stone-700">{acct.email_address}</span> · Claude drafts a reply to every new client email. Nothing is sent until someone presses Approve.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Suspense>
            <SearchBox placeholder="Search client, subject, text…" />
          </Suspense>
          {acct.connected && canEdit && <SyncButton lastSynced={acct.last_synced_at} />}
        </div>
      </header>
      <AccountHealth account={acct} isOwner={member.is_owner} />

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

      {rows.length === 0 && (
        <div className="card p-10 text-center text-sm text-stone-500">
          {tab.key === "open" ? "All caught up — no drafts waiting for review." : "Nothing here yet."}
        </div>
      )}

      <ul className="space-y-4">
        {rows.map((r) => {
          const e = r.emails;
          const c = e.clients;
          const to = e.from_address ?? c?.email ?? "";
          const open = r.status === "pending";
          const others = viewing.get(r.email_id);
          return (
            <li key={r.id} className={`card overflow-hidden ${!e.is_read && open ? "ring-2 ring-brand-100" : ""}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-100 px-4 py-3">
                <Link href={c ? `/clients/${c.id}` : "#"} className="font-semibold hover:underline">
                  {c?.name || e.from_name || to}
                </Link>
                <span className="text-xs text-stone-500">{to}</span>
                {e.projects && (
                  <Link href={`/projects/${e.projects.id}`} className="rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700 hover:bg-stone-200">
                    #{e.projects.project_number} {e.projects.project_name}
                  </Link>
                )}
                {r.version > 1 && (
                  <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">
                    v{r.version} · {r.created_by === "claude" ? "Claude" : r.created_by.split("@")[0]}
                  </span>
                )}
                {r.status === "sending" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">sending…</span>}
                {others && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">👀 {others.join(", ")} has it open</span>}
                <span className="ml-auto flex items-center gap-3 text-xs text-stone-400">
                  <ReadToggle emailId={e.id} isRead={e.is_read} />
                  received {timeAgo(e.sent_at)}
                </span>
              </div>
              <div className="grid gap-0 md:grid-cols-2">
                <div className="border-stone-100 p-4 md:border-r">
                  <div className="label">Client wrote</div>
                  <div className="mb-2 text-sm font-medium">{e.subject || "(no subject)"}</div>
                  <Expandable text={e.body ?? e.snippet ?? ""} lines={8} className="text-stone-700" />
                </div>
                <div className="bg-stone-50/60 p-4">
                  <div className="label">
                    {open || r.status === "sending"
                      ? "Claude's draft"
                      : r.status === "sent"
                        ? `Sent${r.decided_by ? ` · approved by ${r.decided_by.split("@")[0]}` : ""}`
                        : `Handled outside${r.decided_by ? ` · ${r.decided_by.includes("@") ? r.decided_by.split("@")[0] : r.decided_by}` : ""}`}
                  </div>
                  {r.error && !r.body ? (
                    <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Couldn&apos;t draft a reply: {r.error}</p>
                  ) : (
                    <>
                      <Expandable text={r.body} lines={10} />
                      {r.error && <p className="mt-2 text-xs text-red-700">{r.error}</p>}
                    </>
                  )}
                </div>
              </div>
              {open && (
                <div className="space-y-3 border-t border-stone-100 px-4 py-3">
                  {r.suggested && !e.project_id && canEdit && (
                    <ProjectSuggestion draftId={r.id} emailId={e.id} project={r.suggested} reason={r.suggestion_reason} />
                  )}
                  <DraftActions
                    draftId={r.id}
                    to={to}
                    failed={!!r.error && !r.body}
                    body={r.body}
                    canEdit={canEdit}
                    canApprove={canApprove}
                  />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
