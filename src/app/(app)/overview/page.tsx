import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentAccount } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { agentTablesReady } from "@/lib/quotes";
import NoAccount from "@/components/NoAccount";

export const dynamic = "force-dynamic";

/**
 * Overview (phase 4 brings the Goodshuffle numbers). For now: the numbers this dashboard already tracks
 * itself, which work from day one.
 */
export default async function OverviewPage() {
  const member = await requireMember();
  const acct = await getCurrentAccount();
  if (!acct) return <NoAccount isOwner={member.is_owner} />;
  const ready = await agentTablesReady(acct.id);

  const count = async (p: PromiseLike<{ count: number | null; error: unknown }>) => {
    const r = await p;
    return r.error ? null : (r.count ?? 0);
  };
  const q = (stages: string[]) =>
    count(db().from("quote_requests").select("id", { count: "exact", head: true }).eq("account_id", acct.id).in("stage", stages));
  const [drafts, unread, gathering, toBuild, toSend, sent] = await Promise.all([
    count(db().from("drafts").select("id", { count: "exact", head: true }).eq("account_id", acct.id).eq("status", "pending")),
    count(db().from("emails").select("id", { count: "exact", head: true }).eq("account_id", acct.id).eq("direction", "inbound").eq("is_read", false)),
    ready ? q(["gathering"]) : null,
    ready ? q(["ready_to_build", "building"]) : null,
    ready ? q(["ready_to_send", "approved_to_send"]) : null,
    ready ? q(["quote_sent"]) : null,
  ]);

  const tiles: { label: string; value: number | null; href: string }[] = [
    { label: "Emails waiting for approval", value: drafts, href: "/" },
    { label: "Unread client emails", value: unread, href: "/communication" },
    { label: "Quote requests waiting on customer info", value: gathering, href: "/?view=gathering" },
    { label: "Quotes to put together", value: toBuild, href: "/" },
    { label: "Quotes ready to send", value: toSend, href: "/" },
    { label: "Quotes sent", value: sent, href: "/?view=sent" },
  ];
  const soon = ["Quotes sent this week and month, with totals", "Quotes pending and expiring", "Conflicts", "Subrentals needed", "Close rate, last 30 days", "Follow-ups due today"];

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">Overview</h1>
        <p className="text-sm text-stone-500">
          <span className="font-medium text-stone-700">{acct.email_address}</span> · Numbers from this dashboard, live. Goodshuffle numbers come in a later phase.
        </p>
      </header>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((t) => (
          <Link key={t.label} href={t.href} className="card p-4 hover:border-brand-200">
            <div className="text-3xl font-semibold">{t.value ?? "–"}</div>
            <div className="text-sm text-stone-500">{t.label}</div>
          </Link>
        ))}
      </div>
      {!ready && <p className="text-xs text-stone-500">Quote numbers show once the AI agent setup step (migration 004) has been run.</p>}
      <section className="card p-4">
        <h2 className="text-sm font-semibold">Coming with Goodshuffle</h2>
        <ul className="mt-2 grid gap-1 text-sm text-stone-500 sm:grid-cols-2">
          {soon.map((s) => (
            <li key={s}>· {s}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
