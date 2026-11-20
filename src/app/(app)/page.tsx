import Link from "next/link";
import { db, must } from "@/lib/db";
import { getCurrentAccount } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { can } from "@/lib/permissions";
import { timeAgo } from "@/lib/format";
import { STAGE_LABEL, TEAM_STAGES, agentTablesReady, getChecklist, missingFor, type Stage } from "@/lib/quotes";
import { describeChange, type ProposedChange } from "@/lib/agent-commands";
import {
  FOLLOW_UP_DAYS,
  PIPELINE,
  daysAgo,
  followUpsDue,
  gspFromSubject,
  initials,
  loadOpenDrafts,
  loadQuotes,
  loadRecentInbound,
  personName,
  shortDate,
  type QuoteRow,
} from "@/lib/dashboard";
import NoAccount from "@/components/NoAccount";
import AccountHealth from "@/components/AccountHealth";
import SyncButton from "@/components/SyncButton";
import { ChangeActions, QuoteStageActions } from "@/components/QuoteActions";
import { OpenThread } from "@/components/shell/ThreadPanel";
import Icon from "@/components/shell/icons";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

type Change = { id: string; created_by: string; command: string; quote_request_id: string | null; proposed_change: ProposedChange | null; created_at: string };

const STRIPE: Partial<Record<Stage, string>> = {
  ready_to_build: "var(--amber)",
  building: "var(--h-pipe)",
  ready_to_send: "var(--amber)",
  approved_to_send: "var(--ok)",
};
const who = (email: string) => email.split("@")[0];

/** Today: what's waiting on the team, the quote pipeline, newest customer emails and follow-ups due. */
export default async function TodayPage({ searchParams }: PageProps<"/">) {
  const sp = await searchParams;
  const member = await requireMember();
  const acct = await getCurrentAccount();
  if (!acct) return <NoAccount isOwner={member.is_owner} />;
  const canEdit = can(acct.role, "edit");
  const canApprove = can(acct.role, "approve");
  const ready = await agentTablesReady(acct.id);

  const [quotes, drafts, inbound, checklist, changes] = await Promise.all([
    loadQuotes(acct.id),
    loadOpenDrafts(acct.id),
    loadRecentInbound(acct.id, 40),
    getChecklist(),
    ready
      ? (must(
          await db()
            .from("agent_commands")
            .select("id,created_by,command,quote_request_id,proposed_change,created_at")
            .eq("account_id", acct.id)
            .eq("status", "needs_approval")
            .order("created_at", { ascending: false })
            .limit(30),
        ) as Change[])
      : [],
  ]);
  const followUps = await followUpsDue(acct.id, quotes);
  const order: Stage[] = ["ready_to_send", "approved_to_send", "building", "ready_to_build"];
  const team = quotes.filter((q) => TEAM_STAGES.includes(q.stage)).sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
  const byId = new Map(quotes.map((q) => [q.id, q]));
  const waiting = team.length + changes.length;
  const unread = inbound.filter((e) => !e.is_read).length;
  const draftByEmail = new Map(drafts.map((d) => [d.email_id, d]));
  const sentThisMonth = quotes.filter((q) => q.stage === "quote_sent" && new Date(q.updated_at).getTime() > daysAgo(30)).length;

  const inboxTab = ["email", "gsp", "unread"].includes(String(sp.inbox)) ? String(sp.inbox) : "all";
  const inboxRows = inbound.filter((e) =>
    inboxTab === "gsp" ? !!gspFromSubject(e.subject) : inboxTab === "email" ? !gspFromSubject(e.subject) : inboxTab === "unread" ? !e.is_read : true,
  );

  const kpis = [
    { label: "Waiting on you", value: waiting, note: "approvals", href: "/approvals", hue: "var(--amber)", lead: true },
    { label: "Drafts to approve", value: drafts.filter((d) => d.status === "pending").length, note: "in the inbox", href: "/inbox", hue: "var(--h-agent)" },
    { label: "Unread", value: unread, note: "customer emails", href: "/?inbox=unread", hue: "var(--h-comm)" },
    { label: "Gathering info", value: quotes.filter((q) => q.stage === "gathering").length, note: "asking customers", href: "/leads?view=missing", hue: "var(--h-pipe)" },
    { label: "Quotes sent", value: sentThisMonth, note: "last 30 days", href: "/quotes?status=quote_sent", hue: "var(--ok)" },
    { label: "Follow-ups due", value: followUps.length, note: `${FOLLOW_UP_DAYS}+ days quiet`, href: "#follow-ups", hue: "var(--h-follow)" },
  ];

  const quoteCard = (q: QuoteRow) => {
    const missing = missingFor(q, checklist);
    return (
      <div key={q.id} className="t-card" style={{ ["--stripe" as string]: STRIPE[q.stage] ?? "var(--line)" }}>
        <div className="t-card-top">
          <span className="t-ch gsp">Quote</span>
          {q.latest_email_id ? (
            <OpenThread emailId={q.latest_email_id} className="t-name">
              {personName(q)}
            </OpenThread>
          ) : (
            <span className="t-name">{personName(q)}</span>
          )}
          <span className="t-time">{timeAgo(q.updated_at)}</span>
        </div>
        <div className="t-sub">
          {STAGE_LABEL[q.stage]}
          {q.title && q.title !== personName(q) ? ` · ${q.title}` : ""}
          {q.info?.event_date ? ` · ${q.info.event_date}` : ""}
        </div>
        {missing.length > 0 && q.stage === "ready_to_build" && (
          <div className="t-acts">
            {missing.slice(0, 4).map((m) => (
              <span key={m.key} className="t-pill warn">
                {m.label}
              </span>
            ))}
          </div>
        )}
        <div className="t-acts">
          <QuoteStageActions id={q.id} stage={q.stage} goodshuffleUrl={q.goodshuffle_url} canEdit={canEdit} canApprove={canApprove} missingCount={missing.length} />
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 t-in">
      <AccountHealth account={acct} isOwner={member.is_owner} />
      {!ready && (
        <p className="t-banner">
          Quote requests, the pipeline and the command bar turn on after <code>supabase/migrations/004_ai_agent.sql</code> is run in Supabase. Email drafts work as
          before.
        </p>
      )}

      <section className="t-kpis" aria-label="Today at a glance">
        {kpis.map((k) => (
          <Link key={k.label} href={k.href} className={`t-kpi ${k.lead ? "lead" : ""}`} style={{ ["--hue" as string]: k.hue }}>
            <b>{k.value}</b>
            <span>{k.label}</span>
            <em>{k.note}</em>
          </Link>
        ))}
      </section>

      <div className="t-grid">
        {/* 01 Waiting on you */}
        <div className="t-col">
          <section className="t-mod agent">
            <div className="t-mod-head">
              <span className="ic">
                <Icon name="check" />
              </span>
              <div className="grow">
                <h2 data-n="01">Waiting on you</h2>
                <p>Quotes marked ready for Goodshuffle, and changes asked for in the command bar.</p>
              </div>
              <span className="t-count amber">{waiting}</span>
            </div>
            <div className="t-list">
              {waiting === 0 && <p className="t-empty">All caught up. Nothing is waiting on you.</p>}
              {changes.map((c) => {
                const q = c.quote_request_id ? byId.get(c.quote_request_id) : undefined;
                return (
                  <div key={c.id} className="t-card" style={{ ["--stripe" as string]: "var(--h-agent)" }}>
                    <div className="t-card-top">
                      <span className="t-ch">Change</span>
                      <span className="t-name">{q ? personName(q) : "Quote request"}</span>
                      <span className="t-time">
                        {who(c.created_by)} · {timeAgo(c.created_at)}
                      </span>
                    </div>
                    <div className="t-sub">“{c.command}”</div>
                    <ul className="ml-4 list-disc text-[12.5px]">
                      {describeChange(c.proposed_change ?? { set_answers: [], add_items: [], remove_items: [] }).map((l, i) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                    <ChangeActions commandId={c.id} canEdit={canEdit} canApprove={canApprove} />
                  </div>
                );
              })}
              {team.map(quoteCard)}
            </div>
            <div className="t-acts px-3 pb-3">
              <Link className="t-link" href="/approvals">
                Open the approval queue to edit details or links
              </Link>
              {acct.connected && canEdit && (
                <span className="ml-auto">
                  <SyncButton lastSynced={acct.last_synced_at} />
                </span>
              )}
            </div>
          </section>
        </div>

        {/* 02 Quote pipeline */}
        <div className="t-col">
          <section className="t-mod pipe">
            <div className="t-mod-head">
              <span className="ic">
                <Icon name="pipe" />
              </span>
              <div className="grow">
                <h2 data-n="02">Quote pipeline</h2>
                <p>Every open quote request, by stage.</p>
              </div>
              <span className="t-count">{quotes.filter((q) => q.stage !== "closed").length}</span>
            </div>
            <div className="t-list">
              {PIPELINE.map((lane) => {
                const items = quotes.filter((q) => lane.stages.includes(q.stage));
                const max = Math.max(1, ...PIPELINE.map((l) => quotes.filter((q) => l.stages.includes(q.stage)).length));
                return (
                  <div key={lane.key} className="t-lane">
                    <div className="t-lane-head">
                      <b>{lane.label}</b>
                      <span className="bar">
                        <i style={{ width: `${(items.length / max) * 100}%` }} />
                      </span>
                      <span className="n">{items.length}</span>
                    </div>
                    {items.length > 0 && (
                      <div className="t-lane-items">
                        {items.slice(0, 5).map((q) =>
                          q.latest_email_id ? (
                            <OpenThread key={q.id} emailId={q.latest_email_id} className="t-mini">
                              <span className="t-stack">
                                <b>{personName(q)}</b>
                                <span>{[q.info?.event_type, q.info?.event_date].filter(Boolean).join(" · ") || STAGE_LABEL[q.stage]}</span>
                              </span>
                            </OpenThread>
                          ) : (
                            <Link key={q.id} href="/quotes" className="t-mini">
                              <span className="t-stack">
                                <b>{personName(q)}</b>
                                <span>{STAGE_LABEL[q.stage]}</span>
                              </span>
                            </Link>
                          ),
                        )}
                        {items.length > 5 && (
                          <Link className="t-link px-2" href={`/quotes?status=${lane.stages[0]}`}>
                            {items.length - 5} more
                          </Link>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* 03 Inbox + 04 Follow-ups */}
        <div className="t-col">
          <section className="t-mod comm">
            <div className="t-mod-head">
              <span className="ic">
                <Icon name="mail" />
              </span>
              <div className="grow">
                <h2 data-n="03">Inbox</h2>
                <p>Newest customer emails, one row per conversation.</p>
              </div>
              <span className="t-count">{unread}</span>
            </div>
            <nav className="t-tabs" aria-label="Inbox filter">
              {(
                [
                  ["all", "All"],
                  ["unread", "Unread"],
                  ["email", "Email"],
                  ["gsp", "Goodshuffle"],
                ] as const
              ).map(([k, l]) => (
                <Link key={k} className="t-tab" href={k === "all" ? "/" : `/?inbox=${k}`} aria-current={inboxTab === k ? "page" : undefined} scroll={false}>
                  {l}
                </Link>
              ))}
            </nav>
            <div className="t-list">
              {inboxRows.length === 0 && <p className="t-empty">Nothing here.</p>}
              {inboxRows.slice(0, 25).map((e) => {
                const name = e.clients?.name || e.from_name || e.from_address || "Customer";
                const gsp = gspFromSubject(e.subject);
                const d = draftByEmail.get(e.id);
                return (
                  <OpenThread key={e.id} emailId={e.id} className={`t-row ${e.is_read ? "" : "unread"}`}>
                    <span className="t-av">{initials(name)}</span>
                    <span className="l1">
                      <b>{name}</b>
                      <span className={`t-ch ${gsp ? "gsp" : "email"}`}>{gsp ? "GSP" : "Email"}</span>
                      {d && <span className="t-pill brand">Draft ready</span>}
                    </span>
                    <span className="t-time">{timeAgo(e.sent_at)}</span>
                    <span className="l2">{e.subject || e.snippet || "(no subject)"}</span>
                  </OpenThread>
                );
              })}
            </div>
            <div className="t-acts px-3 pb-3">
              <Link className="t-link" href="/inbox">
                Open the inbox to approve drafts
              </Link>
            </div>
          </section>

          <section className="t-mod follow" id="follow-ups">
            <div className="t-mod-head">
              <span className="ic">
                <Icon name="clock" />
              </span>
              <div className="grow">
                <h2 data-n="04">Follow-ups due</h2>
                <p>Follow Up #1: quotes sent with no reply for {FOLLOW_UP_DAYS} days.</p>
              </div>
              <span className="t-count">{followUps.length}</span>
            </div>
            <div className="t-list">
              {followUps.length === 0 && <p className="t-empty">No follow-ups due.</p>}
              {followUps.map(({ q, lastEmailId, days }) => (
                <OpenThread key={q.id} emailId={lastEmailId} className="t-mini">
                  <span className="t-stack">
                    <b>{personName(q)}</b>
                    <span>
                      Quote sent, quiet for {days} days{q.info?.event_date ? ` · event ${q.info.event_date}` : ""}
                    </span>
                  </span>
                  <span className="t-pill warn">Follow Up #1</span>
                </OpenThread>
              ))}
            </div>
          </section>
        </div>
      </div>
      <p className="t-note">Updated {shortDate(new Date().toISOString())}. Nothing on this page reaches a customer until someone presses Approve.</p>
    </div>
  );
}
