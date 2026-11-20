import Link from "next/link";
import { getCurrentAccount } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { can } from "@/lib/permissions";
import { fmtDate, timeAgo } from "@/lib/format";
import { STAGE_LABEL } from "@/lib/quotes";
import { gspFromSubject, loadOpenDrafts, loadQuotes, type DraftRow, type QuoteRow } from "@/lib/dashboard";
import NoAccount from "@/components/NoAccount";
import AccountHealth from "@/components/AccountHealth";
import SyncButton from "@/components/SyncButton";
import DraftActions from "@/components/DraftActions";
import ReadyForGoodshuffleButton from "@/components/ReadyForGoodshuffleButton";
import { OpenThread } from "@/components/shell/ThreadPanel";
import Icon from "@/components/shell/icons";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Inbox: Claude's reply drafts, split into the Gmail box and the Goodshuffle Pro box (emails about a
 * Goodshuffle project, by the project number in the subject). Approve sends exactly the text shown.
 */
export default async function InboxPage() {
  const member = await requireMember();
  const acct = await getCurrentAccount();
  if (!acct) return <NoAccount isOwner={member.is_owner} />;
  const canEdit = can(acct.role, "edit");
  const canApprove = can(acct.role, "approve");
  const [drafts, quotes] = await Promise.all([loadOpenDrafts(acct.id), loadQuotes(acct.id)]);
  const byThread = new Map(quotes.map((q) => [q.gmail_thread_id, q]));
  const gsp = drafts.filter((d) => gspFromSubject(d.emails.subject));
  const gmail = drafts.filter((d) => !gspFromSubject(d.emails.subject));

  const card = (r: DraftRow) => {
    const e = r.emails;
    const c = e.clients;
    const to = e.from_address ?? c?.email ?? "";
    const q: QuoteRow | undefined = byThread.get(e.gmail_thread_id);
    const project = gspFromSubject(e.subject);
    const link = q?.goodshuffle_url ?? project?.url ?? null;
    return (
      <div key={r.id} className={`t-card ${!e.is_read && r.status === "pending" ? "unread" : ""}`} style={{ ["--stripe" as string]: "var(--h-comm)" }}>
        <div className="t-card-top">
          <OpenThread emailId={e.id} className="t-name">
            {c?.name || e.from_name || to}
          </OpenThread>
          {q && <span className="t-pill brand">{STAGE_LABEL[q.stage]}</span>}
          {r.status === "sending" && <span className="t-pill ok">Sending…</span>}
          <span className="t-time">{timeAgo(e.sent_at)}</span>
        </div>
        <div className="t-sub">{e.subject || "(no subject)"}</div>
        <div className="t-sub" style={{ whiteSpace: "normal" }}>
          {(e.snippet || e.body || "").slice(0, 180)}
        </div>
        {r.error && !r.body ? (
          <p className="t-banner">
            Couldn&apos;t draft a reply ({fmtDate(r.updated_at)}): {r.error}
          </p>
        ) : (
          <div className="t-draft">{r.body}</div>
        )}
        {r.status === "pending" && (
          <DraftActions draftId={r.id} to={to} failed={!!r.error && !r.body} body={r.body} canEdit={canEdit} canApprove={canApprove} />
        )}
        <div className="t-acts">
          <OpenThread emailId={e.id} className="t-link">
            Open the whole conversation
          </OpenThread>
          {canEdit && (!q || q.stage === "gathering" || q.stage === "closed") && <ReadyForGoodshuffleButton emailId={e.id} />}
          {link && (
            <a className="t-link ml-auto" href={link} target="_blank" rel="noopener noreferrer">
              Open in Goodshuffle ↗
            </a>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 t-in">
      <div className="t-vhead">
        <h1>Inbox</h1>
        <span className="grow" />
        <Link className="t-btn" href="/communication">
          All drafts, sent and declined
        </Link>
        {acct.connected && canEdit && <SyncButton lastSynced={acct.last_synced_at} />}
      </div>
      <AccountHealth account={acct} isOwner={member.is_owner} />
      <div className="t-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))" }}>
        <section className="t-mod comm">
          <div className="t-mod-head">
            <span className="ic">
              <Icon name="mail" />
            </span>
            <div className="grow">
              <h2 data-n="01">Gmail</h2>
              <p>Claude&apos;s replies to customer emails at {acct.email_address}.</p>
            </div>
            <span className="t-count">{gmail.length}</span>
          </div>
          <div className="t-list" style={{ maxHeight: "none" }}>
            {gmail.length ? gmail.map(card) : <p className="t-empty">No drafts waiting. New customer emails get a draft here.</p>}
          </div>
        </section>
        <section className="t-mod agent">
          <div className="t-mod-head">
            <span className="ic">
              <Icon name="quotes" />
            </span>
            <div className="grow">
              <h2 data-n="02">Goodshuffle Pro</h2>
              <p>Emails about a Goodshuffle project (quotes, invoices, replies), by the project number in the subject.</p>
            </div>
            <span className="t-count">{gsp.length}</span>
          </div>
          <div className="t-list" style={{ maxHeight: "none" }}>
            {gsp.length ? gsp.map(card) : <p className="t-empty">No drafts on Goodshuffle emails right now.</p>}
          </div>
          <p className="t-note px-3 pb-3">
            Messages written inside Goodshuffle Pro itself will show here once the Goodshuffle sync is set up (Goodshuffle has no API, so it reads them from Leo&apos;s
            Chrome).
          </p>
        </section>
      </div>
    </div>
  );
}
