import Link from "next/link";
import { notFound } from "next/navigation";
import { db, must } from "@/lib/db";
import type { Client, Draft, Email, ProjectLite } from "@/lib/types";
import { fmtDate, presenceCutoff } from "@/lib/format";
import { getCurrentAccount, visibleProjectIds } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { can } from "@/lib/permissions";
import Expandable from "@/components/Expandable";
import DraftEditor, { type Version } from "@/components/DraftEditor";
import ProjectLinker from "@/components/ProjectLinker";
import ProjectSuggestion from "@/components/ProjectSuggestion";
import MarkReadOnOpen from "@/components/MarkReadOnOpen";
import ReadToggle from "@/components/ReadToggle";

export const dynamic = "force-dynamic";
// Server actions on this page (Sync now, Redraft, Review, Retry) call Claude; give them the full 5 minutes.
export const maxDuration = 300;

export default async function ReviewPage({ params }: PageProps<"/review/[draftId]">) {
  const { draftId } = await params;
  const member = await requireMember();
  const acct = await getCurrentAccount();
  if (!acct) notFound();
  const canEdit = can(acct.role, "edit");
  const canApprove = can(acct.role, "approve");

  // Only drafts of the selected (and accessible) account are found; anything else is a 404.
  const res = await db().from("drafts").select("*").eq("account_id", acct.id).eq("id", draftId).maybeSingle();
  if (!res.data) notFound();
  const draft = res.data as Draft;
  const email = must(await db().from("emails").select("*").eq("account_id", acct.id).eq("id", draft.email_id).single()) as Email;
  const visible = await visibleProjectIds([acct.id]);

  const [thread, client, versions, projects, history] = await Promise.all([
    db().from("emails").select("*").eq("account_id", acct.id).eq("gmail_thread_id", email.gmail_thread_id).order("sent_at"),
    email.client_id
      ? db().from("clients").select("*").eq("account_id", acct.id).eq("id", email.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db()
      .from("drafts")
      .select("id,version,created_by,review_note,created_at,status")
      .eq("account_id", acct.id)
      .eq("email_id", email.id)
      .order("created_at"),
    visible.length
      ? db().from("projects").select("id,project_name,project_number,client_id,status").in("id", visible).order("created_at", { ascending: false }).limit(300)
      : Promise.resolve({ data: [] }),
    db()
      .from("audit_log")
      .select("actor,action,detail,created_at")
      .eq("account_id", acct.id)
      .eq("email_id", email.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);
  const versionRows = (versions.data ?? []) as Version[];
  const chat = versionRows.length
    ? ((await db()
        .from("draft_messages")
        .select("role,content,author,created_at")
        .in("draft_id", versionRows.map((v) => v.id))
        .order("created_at")).data ?? []) as { role: "user" | "assistant"; content: string; author: string | null }[]
    : [];
  const presence = (await db()
    .from("presence")
    .select("member_name,member_email")
    .eq("account_id", acct.id)
    .eq("email_id", email.id)
    .neq("member_email", member.email)
    .gte("seen_at", presenceCutoff())).data as { member_name: string | null; member_email: string }[] | null;

  const projectList = (projects.data ?? []) as ProjectLite[];
  const suggested = projectList.find((p) => p.id === draft.suggested_project_id);
  const c = client.data as Client | null;
  const msgs = (thread.data ?? []) as Email[];

  return (
    <div className="mx-auto max-w-7xl">
      <MarkReadOnOpen emailId={email.id} isRead={email.is_read} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/" className="text-stone-500 hover:text-stone-800">← Queue</Link>
        <span className="text-stone-300">/</span>
        <span className="font-medium">{email.subject || "(no subject)"}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="space-y-4">
          <div className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="label">Client</div>
                {c ? <Link href={`/clients/${c.id}`} className="font-semibold hover:underline">{c.name || c.email}</Link> : <span>{email.from_address}</span>}
                <div className="text-xs text-stone-500">{[c?.email, c?.phone, c?.company].filter(Boolean).join(" · ")}</div>
              </div>
              <div className="min-w-56">
                <div className="label">Project</div>
                {canEdit ? (
                  <ProjectLinker emailId={email.id} currentProjectId={email.project_id} projects={projectList} clientId={email.client_id} />
                ) : (
                  <span className="text-sm">{projectList.find((p) => p.id === email.project_id)?.project_name ?? "Not linked"}</span>
                )}
              </div>
            </div>
            {draft.status === "pending" && suggested && !email.project_id && canEdit && (
              <div className="mt-3">
                <ProjectSuggestion draftId={draft.id} emailId={email.id} project={suggested} reason={draft.suggestion_reason} />
              </div>
            )}
          </div>

          <div className="card divide-y divide-stone-100">
            <div className="px-4 py-3 text-sm font-semibold">Conversation ({msgs.length})</div>
            {msgs.map((m) => (
              <article key={m.id} className={`px-4 py-3 ${m.id === email.id ? "bg-brand-50/50" : ""}`}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span className={`rounded-full px-2 py-0.5 font-medium ${m.direction === "outbound" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-700"}`}>
                    {m.direction === "outbound" ? "TERG" : m.from_name || m.from_address}
                  </span>
                  <span className="text-stone-400">{fmtDate(m.sent_at)}</span>
                  {m.id === email.id && <span className="font-medium text-brand-700">replying to this</span>}
                  {m.direction === "inbound" && (
                    <span className="ml-auto">
                      <ReadToggle emailId={m.id} isRead={m.is_read} />
                    </span>
                  )}
                </div>
                <Expandable text={m.body ?? m.snippet ?? ""} lines={m.id === email.id ? 30 : 5} className="text-stone-700" />
              </article>
            ))}
          </div>

          {(history.data ?? []).length > 0 && (
            <details className="card p-4 text-sm">
              <summary className="cursor-pointer font-medium">Activity</summary>
              <ul className="mt-2 space-y-1 text-xs text-stone-600">
                {((history.data ?? []) as { actor: string; action: string; detail: string | null; created_at: string }[]).map((h, i) => (
                  <li key={i}>
                    {fmtDate(h.created_at)} · <b>{h.actor.split("@")[0]}</b> {h.action.replace(/_/g, " ")}
                    {h.detail ? ` — ${h.detail}` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section>
          <DraftEditor
            draft={{ id: draft.id, body: draft.body, status: draft.status, error: draft.error, version: draft.version, created_by: draft.created_by, decided_by: draft.decided_by }}
            emailId={email.id}
            to={email.from_address ?? c?.email ?? ""}
            fromAccount={acct.email_address}
            chat={chat}
            versions={versionRows}
            canEdit={canEdit}
            canApprove={canApprove}
            othersViewing={(presence ?? []).map((p) => p.member_name || p.member_email)}
          />
        </section>
      </div>
    </div>
  );
}
