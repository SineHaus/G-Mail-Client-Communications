import Link from "next/link";
import { notFound } from "next/navigation";
import { db, must } from "@/lib/db";
import type { Client, Draft, Email, ProjectLite } from "@/lib/types";
import { fmtDate } from "@/lib/format";
import Expandable from "@/components/Expandable";
import DraftEditor from "@/components/DraftEditor";
import ProjectLinker from "@/components/ProjectLinker";
import ProjectSuggestion from "@/components/ProjectSuggestion";
import MarkReadOnOpen from "@/components/MarkReadOnOpen";
import ReadToggle from "@/components/ReadToggle";
import { getCurrentAccount } from "@/lib/accounts";

export const dynamic = "force-dynamic";

export default async function ReviewPage({ params }: PageProps<"/review/[draftId]">) {
  const { draftId } = await params;
  const acct = await getCurrentAccount();
  if (!acct) notFound();
  // Only drafts of the selected account are found; another account's draft id is a 404 here.
  const res = await db().from("drafts").select("*").eq("account_id", acct.id).eq("id", draftId).maybeSingle();
  if (!res.data) notFound();
  const draft = res.data as Draft;
  const email = must(await db().from("emails").select("*").eq("account_id", acct.id).eq("id", draft.email_id).single()) as Email;
  const [thread, client, chat, projects, suggested] = await Promise.all([
    db().from("emails").select("*").eq("account_id", acct.id).eq("gmail_thread_id", email.gmail_thread_id).order("sent_at"),
    email.client_id
      ? db().from("clients").select("*").eq("account_id", acct.id).eq("id", email.client_id).maybeSingle()
      : Promise.resolve({ data: null }),
    db().from("draft_messages").select("role,content,created_at").eq("draft_id", draft.id).order("created_at"),
    db().from("projects").select("id,project_name,project_number,client_id,status").eq("account_id", acct.id).order("created_at", { ascending: false }).limit(300),
    draft.suggested_project_id
      ? db().from("projects").select("id,project_name,project_number").eq("account_id", acct.id).eq("id", draft.suggested_project_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const c = client.data as Client | null;
  const msgs = (thread.data ?? []) as Email[];
  const open = draft.status === "pending" || draft.status === "revised";

  return (
    <div className="mx-auto max-w-7xl">
      <MarkReadOnOpen emailId={email.id} isRead={email.is_read} />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
        <Link href="/" className="text-stone-500 hover:text-stone-800">← Review Queue</Link>
        <span className="text-stone-300">/</span>
        <span className="font-medium">{email.subject || "(no subject)"}</span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <section className="space-y-4">
          <div className="card p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="label">Client</div>
                {c ? (
                  <Link href={`/clients/${c.id}`} className="font-semibold hover:underline">{c.name || c.email}</Link>
                ) : (
                  <span>{email.from_address}</span>
                )}
                <div className="text-xs text-stone-500">
                  {[c?.email, c?.phone, c?.company].filter(Boolean).join(" · ")}
                </div>
              </div>
              <div className="min-w-56">
                <div className="label">Project</div>
                <ProjectLinker
                  emailId={email.id}
                  currentProjectId={email.project_id}
                  projects={(projects.data ?? []) as ProjectLite[]}
                  clientId={email.client_id}
                />
              </div>
            </div>
            {open && suggested.data && !email.project_id && (
              <div className="mt-3">
                <ProjectSuggestion draftId={draft.id} emailId={email.id} project={suggested.data} reason={draft.suggestion_reason} />
              </div>
            )}
          </div>

          <div className="card divide-y divide-stone-100">
            <div className="px-4 py-3 text-sm font-semibold">Conversation ({msgs.length})</div>
            {msgs.map((m) => (
              <article key={m.id} className={`px-4 py-3 ${m.id === email.id ? "bg-brand-50/50" : ""}`}>
                <div className="mb-1 flex flex-wrap items-center gap-2 text-xs">
                  <span
                    className={`rounded-full px-2 py-0.5 font-medium ${
                      m.direction === "outbound" ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-700"
                    }`}
                  >
                    {m.direction === "outbound" ? "You" : m.from_name || m.from_address}
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
        </section>

        <section>
          <DraftEditor
            draft={{ id: draft.id, body: draft.body, status: draft.status, error: draft.error }}
            to={email.from_address ?? c?.email ?? ""}
            fromAccount={acct.email_address}
            chat={(chat.data ?? []) as { role: "user" | "assistant"; content: string }[]}
          />
        </section>
      </div>
    </div>
  );
}
