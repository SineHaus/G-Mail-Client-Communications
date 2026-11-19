import Link from "next/link";
import { db, must } from "@/lib/db";
import type { Client, Draft, Email } from "@/lib/types";
import { timeAgo, fmtDate } from "@/lib/format";
import { getCurrentAccount } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { can } from "@/lib/permissions";
import { STAGE_LABEL, TEAM_STAGES, agentTablesReady, factsOf, getChecklist, missingFor, type QuoteRequest, type Stage } from "@/lib/quotes";
import { ALWAYS_ON_QUOTE, GOODSHUFFLE_HOME, deliveryPlan, itemsToText, type ChecklistItem } from "@/lib/quote-rules";
import { describeChange, type ProposedChange } from "@/lib/agent-commands";
import Expandable from "@/components/Expandable";
import DraftActions from "@/components/DraftActions";
import CommandBox from "@/components/CommandBox";
import NoAccount from "@/components/NoAccount";
import AccountHealth from "@/components/AccountHealth";
import SyncButton from "@/components/SyncButton";
import { ChangeActions, GoodshuffleLinkEditor, QuoteEditor, QuoteStageActions, StartQuoteButton, UseGoodshuffleLinkButton } from "@/components/QuoteActions";
import { loadProjectMentions, loadWishlists, matchQuote, personForClient, wishlistTableReady } from "@/lib/goodshuffle-link";
import { goodshuffleProjectUrl, matchWishlist, projectIdsInSubject, type GoodshuffleMatch } from "@/lib/goodshuffle";

export const dynamic = "force-dynamic";
// The command box and Redraft call Claude; give them the full 5 minutes.
export const maxDuration = 300;

type DraftRow = Draft & { emails: Email & { clients: Client | null } };
type Command = {
  id: string;
  created_by: string;
  command: string;
  kind: string | null;
  status: string;
  reply: string | null;
  draft_id: string | null;
  quote_request_id: string | null;
  proposed_change: ProposedChange | null;
  decided_by: string | null;
  error: string | null;
  created_at: string;
};

const VIEWS = [
  { key: "approvals", label: "Waiting on you" },
  { key: "gathering", label: "Waiting on customer" },
  { key: "sent", label: "Quote sent" },
  { key: "closed", label: "Closed" },
] as const;

const STAGE_STYLE: Record<Stage, string> = {
  gathering: "bg-amber-50 text-amber-800",
  ready_to_build: "bg-brand-50 text-brand-700",
  building: "bg-sky-50 text-sky-700",
  ready_to_send: "bg-brand-50 text-brand-700",
  approved_to_send: "bg-sky-50 text-sky-700",
  quote_sent: "bg-emerald-50 text-emerald-700",
  closed: "bg-stone-100 text-stone-600",
};

const who = (email: string | null) => (email ? (email.includes("@") ? email.split("@")[0] : email) : "");

export default async function AgentPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const view = VIEWS.find((v) => v.key === sp.view) ?? VIEWS[0];
  const member = await requireMember();
  const acct = await getCurrentAccount();
  if (!acct) return <NoAccount isOwner={member.is_owner} />;
  const canEdit = can(acct.role, "edit");
  const canApprove = can(acct.role, "approve");
  const ready = await agentTablesReady(acct.id);

  const [draftsRes, quotesRes, commandsRes, checklist, wishlists, gspReady, mentions] = await Promise.all([
    db()
      .from("drafts")
      .select("*, emails!drafts_email_fk!inner(*, clients!emails_client_fk(*))")
      .eq("account_id", acct.id)
      .in("status", ["pending", "sending"])
      .order("created_at", { ascending: false })
      .limit(100),
    ready
      ? db().from("quote_requests").select("*").eq("account_id", acct.id).order("updated_at", { ascending: false }).limit(300)
      : Promise.resolve({ data: [], error: null }),
    ready
      ? db().from("agent_commands").select("*").eq("account_id", acct.id).order("created_at", { ascending: false }).limit(30)
      : Promise.resolve({ data: [], error: null }),
    getChecklist(),
    loadWishlists(acct.id),
    wishlistTableReady(acct.id),
    loadProjectMentions(acct.id),
  ]);
  const drafts = must(draftsRes) as unknown as DraftRow[];
  const quotes = (must(quotesRes) ?? []) as QuoteRequest[];
  const commands = (must(commandsRes) ?? []) as Command[];
  const byThread = new Map(quotes.map((q) => [q.gmail_thread_id, q]));
  const byId = new Map(quotes.map((q) => [q.id, q]));

  const clientIds = [...new Set(quotes.map((q) => q.client_id).filter(Boolean))] as string[];
  const clients = new Map(
    (clientIds.length
      ? (must(await db().from("clients").select("id,name,email,phone").eq("account_id", acct.id).in("id", clientIds)) as QuoteClient[])
      : []
    ).map((c) => [c.id, c]),
  );

  const changes = commands.filter((c) => c.status === "needs_approval");
  const order: Stage[] = ["ready_to_send", "approved_to_send", "building", "ready_to_build"];
  const teamQuotes = quotes.filter((q) => TEAM_STAGES.includes(q.stage)).sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
  const gathering = quotes.filter((q) => q.stage === "gathering");
  const sent = quotes.filter((q) => q.stage === "quote_sent");
  const closed = quotes.filter((q) => q.stage === "closed");
  const counts: Record<string, number> = {
    approvals: changes.length + teamQuotes.length + drafts.length,
    gathering: gathering.length,
    sent: sent.length,
    closed: closed.length,
  };
  const recent = commands.filter((c) => c.status !== "needs_approval").slice(0, 8);

  // Goodshuffle projects, matched from Goodshuffle's wishlist emails and the project numbers in its
  // quote and invoice subjects (lib/goodshuffle.ts). No Claude calls.
  const gspFor = (q: QuoteRequest) => matchQuote(q, q.client_id ? clients.get(q.client_id) : null, wishlists, mentions, acct.email_address);
  const quoteCard = (q: QuoteRequest) => (
    <QuoteCard
      key={q.id}
      q={q}
      checklist={checklist}
      client={q.client_id ? clients.get(q.client_id) : undefined}
      gspMatch={gspFor(q)}
      canEdit={canEdit}
      canApprove={canApprove}
    />
  );

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">AI agent</h1>
          <p className="text-sm text-stone-500">
            <span className="font-medium text-stone-700">{acct.email_address}</span> · Claude gathers quote details over email and drafts every reply. Nothing reaches a
            customer, and no quote moves on, until you or Grovert press Approve.
          </p>
        </div>
        {acct.connected && canEdit && <SyncButton lastSynced={acct.last_synced_at} />}
      </header>
      <AccountHealth account={acct} isOwner={member.is_owner} />

      {!ready && (
        <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <b>One setup step turns on quote requests and the command box.</b> Run <code>supabase/migrations/004_ai_agent.sql</code> in Supabase → SQL Editor. It only
          adds two new tables. Until then, email drafts below work exactly as before.
        </div>
      )}

      {ready && !gspReady && member.is_owner && (
        <div className="card border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <b>One setup step turns on automatic Goodshuffle links.</b> Run <code>supabase/migrations/005_goodshuffle_wishlists.sql</code> in Supabase → SQL Editor. It only adds
          one table. Until then, paste project links by hand as before.
        </div>
      )}

      {canEdit && <CommandBox disabled={ready ? undefined : "The command box turns on after the setup step above."} />}

      {recent.length > 0 && (
        <details className="card px-4 py-2 text-sm" open>
          <summary className="cursor-pointer py-1 text-xs font-medium uppercase tracking-wide text-stone-500">Recent commands</summary>
          <ul className="divide-y divide-stone-100">
            {recent.map((c) => (
              <li key={c.id} className="py-2">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">“{c.command}”</span>
                  <span className="text-xs text-stone-400">
                    {who(c.created_by)} · {timeAgo(c.created_at)}
                  </span>
                </div>
                {c.status === "working" && <p className="text-xs text-stone-500">Working…</p>}
                {c.status === "failed" && <p className="text-xs text-red-700">Couldn&apos;t do it: {c.error}</p>}
                {c.reply && c.status !== "failed" && (
                  <p className="text-xs text-stone-600">
                    {c.reply}
                    {c.draft_id && (
                      <>
                        {" "}
                        <Link className="font-medium text-brand-700 hover:underline" href={`/review/${c.draft_id}`}>
                          Open the draft
                        </Link>
                      </>
                    )}
                    {(c.status === "applied" || c.status === "declined") && ` · ${c.status === "applied" ? "approved" : "declined"} by ${who(c.decided_by)}`}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex gap-1 border-b border-stone-200">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "approvals" ? "/" : `/?view=${v.key}`}
            className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium ${
              v.key === view.key ? "border-brand-600 text-brand-700" : "border-transparent text-stone-500 hover:text-stone-800"
            }`}
          >
            {v.label}
            {counts[v.key] > 0 && <span className="rounded-full bg-stone-100 px-1.5 text-xs text-stone-600">{counts[v.key]}</span>}
          </Link>
        ))}
      </div>

      {view.key === "approvals" && (
        <>
          {counts.approvals === 0 && <div className="card p-10 text-center text-sm text-stone-500">All caught up. Nothing is waiting on you.</div>}

          {changes.map((c) => {
            const q = c.quote_request_id ? byId.get(c.quote_request_id) : undefined;
            return (
              <div key={c.id} className="card overflow-hidden">
                <CardHead kind="Change" title={q?.title ?? "Quote request"} sub={`asked by ${who(c.created_by)} ${timeAgo(c.created_at)}`} gsp={q?.goodshuffle_url ?? null} />
                <div className="space-y-2 px-4 py-3 text-sm">
                  <p className="text-stone-500">“{c.command}”</p>
                  <ul className="list-disc pl-5">
                    {describeChange(c.proposed_change ?? { set_answers: [], add_items: [], remove_items: [] }).map((l, i) => (
                      <li key={i}>{l}</li>
                    ))}
                  </ul>
                  <ChangeActions commandId={c.id} canEdit={canEdit} canApprove={canApprove} />
                </div>
              </div>
            );
          })}

          {teamQuotes.map(quoteCard)}

          {drafts.length > 0 && (
            <h2 className="pt-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Emails to approve ({drafts.length})</h2>
          )}
          {drafts.map((r) => {
            const e = r.emails;
            const c = e.clients;
            const to = e.from_address ?? c?.email ?? "";
            const q = byThread.get(e.gmail_thread_id);
            const missing = q ? missingFor(q, checklist) : [];
            const gsp: { url: string; label: string; title?: string } | null = q?.goodshuffle_url
              ? { url: q.goodshuffle_url, label: "Open in Goodshuffle ↗" }
              : projectIdsInSubject(e.subject).length === 1
              ? // Goodshuffle's own quote or invoice email (or a reply to it) names its project.
                { url: goodshuffleProjectUrl(projectIdsInSubject(e.subject)[0]), label: "Open in Goodshuffle ↗", title: "The project number is in the subject" }
              : (() => {
                  const m = q ? gspFor(q) : matchWishlist(personForClient(c), wishlists, e.sent_at);
                  if (!m) return null;
                  return m.level === "linked"
                    ? { url: m.wishlist.url, label: "Open in Goodshuffle ↗", title: `Matched: ${m.why}` }
                    : { url: m.wishlist.url, label: "Goodshuffle: possible match ↗", title: `Check it's the right project: ${m.why}` };
                })();
            return (
              <div key={r.id} className={`card overflow-hidden ${!e.is_read && r.status === "pending" ? "ring-2 ring-brand-100" : ""}`}>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-100 px-4 py-2.5">
                  <span className="rounded bg-stone-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-stone-600">Gmail</span>
                  <Link href={c ? `/clients/${c.id}` : "#"} className="font-semibold hover:underline">
                    {c?.name || e.from_name || to}
                  </Link>
                  <span className="truncate text-xs text-stone-500">{e.subject || "(no subject)"}</span>
                  {q ? (
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STAGE_STYLE[q.stage]}`}>
                      Quote: {STAGE_LABEL[q.stage]}
                      {q.stage === "gathering" && missing.length ? `, asking for ${missing.length}` : ""}
                    </span>
                  ) : (
                    ready && canEdit && <StartQuoteButton emailId={e.id} />
                  )}
                  {r.status === "sending" && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">sending…</span>}
                  <span className="ml-auto text-xs text-stone-400">received {timeAgo(e.sent_at)}</span>
                  {gsp && (
                    <a
                      href={gsp.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      title={gsp.title}
                      className="rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
                    >
                      {gsp.label}
                    </a>
                  )}
                </div>
                <div className="grid md:grid-cols-2">
                  <div className="border-stone-100 p-4 md:border-r">
                    <div className="label">Customer wrote</div>
                    <Expandable text={e.body ?? e.snippet ?? ""} lines={5} className="text-stone-700" />
                  </div>
                  <div className="bg-stone-50/60 p-4">
                    <div className="label">Claude&apos;s draft</div>
                    {r.error && !r.body ? (
                      <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Couldn&apos;t draft a reply ({fmtDate(r.updated_at)}): {r.error}</p>
                    ) : (
                      <Expandable text={r.body} lines={7} />
                    )}
                  </div>
                </div>
                {r.status === "pending" && (
                  <div className="border-t border-stone-100 px-4 py-3">
                    <DraftActions draftId={r.id} to={to} failed={!!r.error && !r.body} body={r.body} canEdit={canEdit} canApprove={canApprove} />
                  </div>
                )}
              </div>
            );
          })}
        </>
      )}

      {view.key === "gathering" && (
        <>
          <p className="text-sm text-stone-500">
            Claude asks the customer for what&apos;s missing in each reply you approve. When every required detail is in, the request moves to “Ready to put quote together”.
          </p>
          {gathering.length === 0 && <div className="card p-10 text-center text-sm text-stone-500">No quote requests waiting on customers.</div>}
          {gathering.map(quoteCard)}
        </>
      )}
      {view.key === "sent" && (sent.length ? sent.map(quoteCard) : <div className="card p-10 text-center text-sm text-stone-500">No quotes marked as sent yet.</div>)}
      {view.key === "closed" && (closed.length ? closed.map(quoteCard) : <div className="card p-10 text-center text-sm text-stone-500">Nothing closed.</div>)}
    </div>
  );
}

function CardHead({ kind, title, sub, gsp, badge }: { kind: string; title: string; sub?: string; gsp: string | null; badge?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-stone-100 px-4 py-2.5">
      <span className="rounded bg-brand-50 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand-700">{kind}</span>
      <span className="font-semibold">{title}</span>
      {badge}
      {sub && <span className="text-xs text-stone-400">{sub}</span>}
      <a
        href={gsp ?? GOODSHUFFLE_HOME}
        target="_blank"
        rel="noopener noreferrer"
        className="ml-auto rounded-lg border border-stone-200 px-2 py-1 text-xs font-medium text-stone-700 hover:bg-stone-50"
      >
        {gsp ? "Open in Goodshuffle ↗" : "Goodshuffle Pro ↗"}
      </a>
    </div>
  );
}

type QuoteClient = Pick<Client, "id" | "name" | "email" | "phone">;

function QuoteCard({
  q,
  checklist,
  client,
  gspMatch,
  canEdit,
  canApprove,
}: {
  q: QuoteRequest;
  checklist: ChecklistItem[];
  client?: QuoteClient;
  gspMatch: GoodshuffleMatch | null;
  canEdit: boolean;
  canApprove: boolean;
}) {
  const missing = missingFor(q, checklist);
  const plan = deliveryPlan(factsOf(q));
  const step: Partial<Record<Stage, string>> = {
    building: `Approved by ${who(q.build_approved_by)}. Build it in Goodshuffle as a draft (nothing goes to the customer), then paste the project link here.`,
    ready_to_send: "Check the Goodshuffle total against what was approved, then approve. In this first version you send it from Goodshuffle yourself.",
    approved_to_send: `Approved to send by ${who(q.send_approved_by)}. Open the project in Goodshuffle and press Send To Client, then mark it here.`,
  };
  const editable = canEdit && (q.stage === "gathering" || q.stage === "ready_to_build");
  return (
    <div className="card overflow-hidden">
      <CardHead
        kind="Quote"
        title={q.title || client?.name || "Quote request"}
        badge={<span className={`rounded-full px-2 py-0.5 text-xs ${STAGE_STYLE[q.stage]}`}>{STAGE_LABEL[q.stage]}</span>}
        sub={[client ? client.email : null, `updated ${timeAgo(q.updated_at)}`].filter(Boolean).join(" · ")}
        gsp={q.goodshuffle_url}
      />
      {step[q.stage] && <p className="border-b border-stone-100 bg-sky-50/50 px-4 py-2 text-sm text-sky-900">{step[q.stage]}</p>}
      {!q.goodshuffle_url && gspMatch && q.stage !== "closed" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-stone-100 bg-amber-50/60 px-4 py-2 text-sm text-amber-900">
          <span>
            {gspMatch.level === "linked" ? "Goodshuffle project found" : "Possible Goodshuffle project"}
            {gspMatch.wishlist.project_name ? <>: <b>{gspMatch.wishlist.project_name}</b></> : null} ({gspMatch.why}).
            {gspMatch.level === "possible" ? " Check it's the right one." : ""}
          </span>
          <a href={gspMatch.wishlist.url} target="_blank" rel="noopener noreferrer" className="font-medium underline">
            Open it ↗
          </a>
          {canEdit && <UseGoodshuffleLinkButton id={q.id} url={gspMatch.wishlist.url} />}
        </div>
      )}
      <div className="grid gap-0 md:grid-cols-2">
        <div className="space-y-3 border-stone-100 p-4 md:border-r">
          <div>
            <div className="label">Details</div>
            <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1 text-sm">
              {checklist
                .filter((c) => c.key !== "items_and_quantities")
                .map((c) => (
                  <div key={c.key} className="contents">
                    <dt className="text-stone-500">{c.label}</dt>
                    <dd className={q.info[c.key] ? "" : c.optional ? "text-stone-300" : "font-medium text-amber-700"}>
                      {q.info[c.key] || (c.optional ? "—" : "missing")}
                    </dd>
                  </div>
                ))}
            </dl>
          </div>
          <div>
            <div className="label">Items</div>
            {q.items.length ? (
              <ul className="text-sm">
                {q.items.map((i, n) => (
                  <li key={n}>
                    <b>{i.quantity ?? "?"}</b> × {i.name}
                    {i.note ? <span className="text-stone-500"> ({i.note})</span> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm font-medium text-amber-700">No items yet</p>
            )}
          </div>
        </div>
        <div className="space-y-3 bg-stone-50/60 p-4 text-sm">
          <div>
            <div className="label">Proposed delivery (for you only, never offered to the customer)</div>
            <p>
              <span className="text-stone-500">Drop-off:</span> {plan.dropoff}
            </p>
            <p>
              <span className="text-stone-500">Pickup:</span> {plan.pickup}
            </p>
            <p className="mt-1 text-stone-600">{plan.fee}</p>
          </div>
          <div>
            <div className="label">Always on the quote</div>
            <ul className="list-disc pl-5 text-stone-600">
              {ALWAYS_ON_QUOTE.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
          {plan.flags.length > 0 && (
            <div>
              <div className="label">Check before it goes out</div>
              <ul className="space-y-1">
                {plan.flags.map((f) => (
                  <li key={f} className="rounded-md bg-amber-50 px-2 py-1 text-amber-900">
                    {f}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {q.notes && (
            <div>
              <div className="label">Claude&apos;s notes</div>
              <p className="whitespace-pre-wrap text-stone-700">{q.notes}</p>
            </div>
          )}
          <p className="text-xs text-stone-400">
            Goodshuffle project: {q.goodshuffle_url ? <a className="underline" href={q.goodshuffle_url} target="_blank" rel="noopener noreferrer">open</a> : "not linked yet"}
            {q.goodshuffle_url && gspMatch?.level === "linked" && gspMatch.wishlist.url === q.goodshuffle_url ? ` (matched: ${gspMatch.why})` : ""}
            {canEdit && q.stage !== "closed" && (
              <>
                {" · "}
                <GoodshuffleLinkEditor id={q.id} url={q.goodshuffle_url} />
              </>
            )}
            {q.closed_reason ? ` · closed: ${q.closed_reason}` : ""}
            {q.send_approved_at ? ` · send approved ${fmtDate(q.send_approved_at)}` : ""}
          </p>
        </div>
      </div>
      {canEdit && (
        <div className="flex flex-wrap items-start gap-2 border-t border-stone-100 px-4 py-3">
          <QuoteStageActions id={q.id} stage={q.stage} goodshuffleUrl={q.goodshuffle_url} canEdit={canEdit} canApprove={canApprove} missingCount={missing.length} />
          {editable && (
            <QuoteEditor id={q.id} title={q.title ?? ""} checklist={checklist} info={q.info} itemsText={itemsToText(q.items)} />
          )}
        </div>
      )}
    </div>
  );
}
