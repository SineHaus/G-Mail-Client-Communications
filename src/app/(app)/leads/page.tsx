import Link from "next/link";
import { getCurrentAccount } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { getChecklist, missingFor, STAGE_LABEL } from "@/lib/quotes";
import { daysAgo, loadQuotes, personName, shortDate, type QuoteRow } from "@/lib/dashboard";
import NoAccount from "@/components/NoAccount";
import { OpenThread } from "@/components/shell/ThreadPanel";

export const dynamic = "force-dynamic";

// Leads: every open quote request, with what's still missing from the quote info checklist.
// A row opens the conversation in the side panel.

const VIEWS = [
  { key: "all", label: "All open" },
  { key: "missing", label: "Missing info" },
  { key: "week", label: "New this week" },
  { key: "noquote", label: "No quote yet" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function LeadsPage({ searchParams }: PageProps<"/leads">) {
  const sp = await searchParams;
  const member = await requireMember();
  const acct = await getCurrentAccount();
  if (!acct) return <NoAccount isOwner={member.is_owner} />;

  const [quotes, checklist] = await Promise.all([loadQuotes(acct.id), getChecklist()]);
  const open = quotes.filter((q) => q.stage !== "closed");
  const weekAgo = daysAgo(7);
  const rows = open.map((q) => ({ q, missing: missingFor(q, checklist).map((m) => m.label) }));
  const test: Record<View, (r: { q: QuoteRow; missing: string[] }) => boolean> = {
    all: () => true,
    missing: (r) => r.missing.length > 0,
    week: (r) => new Date(r.q.created_at).getTime() >= weekAgo,
    noquote: (r) => r.q.stage !== "quote_sent",
  };
  const raw = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view: View = VIEWS.some((v) => v.key === raw) ? (raw as View) : "all";
  const text = (Array.isArray(sp.q) ? sp.q[0] : sp.q)?.trim().toLowerCase() ?? "";
  const shown = rows
    .filter(test[view])
    .filter((r) => !text || [personName(r.q), r.q.client?.email ?? "", r.q.title ?? ""].some((s) => s.toLowerCase().includes(text)));
  const cols = "minmax(180px,1.3fr) minmax(160px,1fr) 150px minmax(160px,1.2fr) 80px";

  return (
    <div className="flex flex-col gap-3 t-in">
      <section className="t-stats" aria-label="Leads">
        {VIEWS.map((v) => (
          <Link key={v.key} className="t-stat" href={v.key === "all" ? "/leads" : `/leads?view=${v.key}`} aria-current={view === v.key ? "true" : undefined}>
            <span>{v.label}</span>
            <b>{rows.filter(test[v.key]).length}</b>
            <em>&nbsp;</em>
          </Link>
        ))}
      </section>

      <div className="t-vhead">
        <h1>Leads</h1>
        <span className="grow" />
        <form className="t-search" action="/leads">
          {view !== "all" && <input type="hidden" name="view" value={view} />}
          <input type="search" name="q" defaultValue={text} placeholder="Search leads" aria-label="Search leads" />
        </form>
      </div>

      <div className="t-tbl" style={{ ["--cols" as string]: cols }}>
        <div className="t-tr th">
          <span>Customer</span>
          <span>Request</span>
          <span>Stage</span>
          <span>Still missing</span>
          <span className="r">Added</span>
        </div>
        {shown.length === 0 && <p className="t-empty">{open.length ? "No leads in this view." : "No quote requests yet. They show up here as customers email."}</p>}
        {shown.map(({ q, missing }) => {
          const inner = (
            <>
              <span className="t-cmain">
                <b>{personName(q)}</b>
                <small>{q.client?.email ?? q.info?.email ?? ""}</small>
              </span>
              <span className="c-x">{q.title || "Quote request"}</span>
              <span>
                <span className={`t-pill ${q.stage === "gathering" ? "brand" : q.stage === "quote_sent" ? "pipe" : "warn"}`}>{STAGE_LABEL[q.stage]}</span>
              </span>
              <span className="c-x" data-l="Missing" title={missing.join(", ")}>
                {missing.length ? missing.slice(0, 3).join(", ") + (missing.length > 3 ? ` +${missing.length - 3}` : "") : ""}
              </span>
              <span className="c-x r">{shortDate(q.created_at)}</span>
            </>
          );
          return q.latest_email_id ? (
            <OpenThread key={q.id} emailId={q.latest_email_id} className="t-tr">
              {inner}
            </OpenThread>
          ) : (
            <div key={q.id} className="t-tr">
              {inner}
            </div>
          );
        })}
      </div>
      <p className="t-note">Missing info follows the quote info checklist in Settings.</p>
    </div>
  );
}
