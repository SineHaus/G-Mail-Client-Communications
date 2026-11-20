import Link from "next/link";
import { getCurrentAccount } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { STAGE_LABEL, TEAM_STAGES, type Stage } from "@/lib/quotes";
import { loadGoodshuffleProjects, loadQuotes, money, personName, shortDate, type GoodshuffleProject } from "@/lib/dashboard";
import { loadWishlists } from "@/lib/goodshuffle-link";
import { GOODSHUFFLE_HOME } from "@/lib/quote-rules";
import NoAccount from "@/components/NoAccount";
import { OpenThread } from "@/components/shell/ThreadPanel";
import Icon from "@/components/shell/icons";

export const dynamic = "force-dynamic";

// Quotes: every quote request and every Goodshuffle project the dashboard knows, with Goodshuffle Pro's
// status counts and filters. Goodshuffle has no API: projects come from its emails (wishlists and the
// project number in quote and invoice subjects) and, once the Goodshuffle sync fills goodshuffle_projects
// (migration 006), from its Projects page with totals, logistics and billing.

type Group = "new" | "action" | "sent" | "signed" | "closed";
const GROUPS: { key: Group; label: string }[] = [
  { key: "new", label: "New" },
  { key: "sent", label: "Quote Sent" },
  { key: "action", label: "Action Needed" },
  { key: "signed", label: "Signed" },
  { key: "closed", label: "Closed" },
];
const BILLING = ["Unpaid", "Partially paid", "Paid", "Overdue"];

type Row = {
  key: string;
  name: string;
  email: string;
  project: string;
  venue: string;
  eventDate: string | null; // YYYY-MM-DD
  logStart: string | null;
  logEnd: string | null;
  group: Group;
  status: string;
  total: number | null;
  due: number | null;
  billing: string | null;
  gspUrl: string | null;
  emailId: string | null;
  updated: string;
};

const groupOfStage = (s: Stage): Group => (s === "gathering" ? "new" : TEAM_STAGES.includes(s) ? "action" : s === "quote_sent" ? "sent" : "closed");
const groupOfGsp = (s: string | null): Group | null => {
  const t = (s ?? "").toLowerCase();
  if (/sign|book|confirm|won|complete/.test(t)) return "signed";
  if (/lost|cancel|declin|expired|archiv/.test(t)) return "closed";
  if (/sent/.test(t)) return "sent";
  if (/action/.test(t)) return "action";
  if (/new|draft|inquir/.test(t)) return "new";
  return null;
};
const isoDay = (v: unknown) => {
  const s = typeof v === "string" ? v : "";
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const d = Date.parse(s);
  return Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : null;
};
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
const many = (v: string | string[] | undefined) => (Array.isArray(v) ? v : v ? [v] : []);
const num = (v: string) => (v.trim() && Number.isFinite(Number(v)) ? Number(v) : null);

export default async function QuotesPage({ searchParams }: PageProps<"/quotes">) {
  const sp = await searchParams;
  const member = await requireMember();
  const acct = await getCurrentAccount();
  if (!acct) return <NoAccount isOwner={member.is_owner} />;

  const [quotes, projects, wishlists] = await Promise.all([loadQuotes(acct.id), loadGoodshuffleProjects(acct.id), loadWishlists(acct.id)]);
  const projectByUrl = new Map<string, GoodshuffleProject>(projects.map((p) => [p.url, p]));
  const usedProjects = new Set<string>();
  const rows: Row[] = [];

  for (const q of quotes) {
    const p = q.goodshuffle_url ? projectByUrl.get(q.goodshuffle_url) : undefined;
    if (p) usedProjects.add(p.gsp_project_id);
    rows.push({
      key: q.id,
      name: personName(q),
      email: q.client?.email ?? q.info?.email ?? "",
      project: p?.project_name || q.title || "",
      venue: p?.venue || q.info?.venue_name || q.info?.event_address || q.info?.venue_address || "",
      eventDate: p?.event_date ?? isoDay((q.facts as { event_date?: string })?.event_date) ?? isoDay(q.info?.event_date),
      logStart: p?.logistics_start ?? null,
      logEnd: p?.logistics_end ?? null,
      group: groupOfGsp(p?.status ?? null) ?? groupOfStage(q.stage),
      status: p?.status || STAGE_LABEL[q.stage],
      total: p?.quote_total ?? null,
      due: p?.amount_due ?? null,
      billing: p?.billing_status ?? null,
      gspUrl: q.goodshuffle_url,
      emailId: q.latest_email_id,
      updated: q.updated_at,
    });
  }
  for (const p of projects) {
    if (usedProjects.has(p.gsp_project_id)) continue;
    usedProjects.add(p.gsp_project_id);
    rows.push({
      key: `gsp:${p.gsp_project_id}`,
      name: p.client_name || p.client_email || "Customer",
      email: p.client_email ?? "",
      project: p.project_name ?? `Project #${p.gsp_project_id}`,
      venue: p.venue ?? "",
      eventDate: p.event_date,
      logStart: p.logistics_start,
      logEnd: p.logistics_end,
      group: groupOfGsp(p.status) ?? "new",
      status: p.status ?? "In Goodshuffle",
      total: p.quote_total,
      due: p.amount_due,
      billing: p.billing_status,
      gspUrl: p.url,
      emailId: null,
      updated: p.synced_at,
    });
  }
  // Wishlists from the website with no quote request yet: new projects in Goodshuffle.
  const linkedUrls = new Set(quotes.map((q) => q.goodshuffle_url).filter(Boolean));
  for (const w of wishlists) {
    if (usedProjects.has(w.gsp_project_id) || linkedUrls.has(w.url)) continue;
    usedProjects.add(w.gsp_project_id);
    rows.push({
      key: `wish:${w.gsp_project_id}`,
      name: w.contact_name || w.email || "Website wishlist",
      email: w.email ?? "",
      project: w.project_name ?? `Project #${w.gsp_project_id}`,
      venue: "",
      eventDate: null,
      logStart: null,
      logEnd: null,
      group: "new",
      status: "Wishlist",
      total: null,
      due: null,
      billing: null,
      gspUrl: w.url,
      emailId: null,
      updated: w.received_at,
    });
  }

  // ---- filters (Goodshuffle Pro's Projects page filters) ----
  const status = one(sp.status);
  const text = one(sp.q).trim().toLowerCase();
  const f = {
    eventFrom: one(sp.event_from),
    eventTo: one(sp.event_to),
    logFrom: one(sp.log_from),
    logTo: one(sp.log_to),
    totalMin: num(one(sp.total_min)),
    totalMax: num(one(sp.total_max)),
    dueMin: num(one(sp.due_min)),
    dueMax: num(one(sp.due_max)),
    billing: many(sp.billing),
  };
  const stageFilter = (Object.keys(STAGE_LABEL) as Stage[]).includes(status as Stage) ? (status as Stage) : null;
  const groupFilter = GROUPS.some((g) => g.key === status) ? (status as Group) : null;
  const inRange = (v: number | null, min: number | null, max: number | null) => (min == null || (v != null && v >= min)) && (max == null || (v != null && v <= max));
  const shown = rows.filter((r) => {
    if (groupFilter && r.group !== groupFilter) return false;
    if (stageFilter && r.status !== STAGE_LABEL[stageFilter]) return false;
    if (!stageFilter && !groupFilter && r.group === "closed" && status !== "all") return false;
    if (text && ![r.name, r.email, r.project, r.venue].some((s) => s.toLowerCase().includes(text))) return false;
    if (f.eventFrom && (!r.eventDate || r.eventDate < f.eventFrom)) return false;
    if (f.eventTo && (!r.eventDate || r.eventDate > f.eventTo)) return false;
    if (f.logFrom && (!r.logStart || r.logStart.slice(0, 10) < f.logFrom)) return false;
    if (f.logTo && (!r.logEnd || r.logEnd.slice(0, 10) > f.logTo)) return false;
    if (!inRange(r.total, f.totalMin, f.totalMax) || !inRange(r.due, f.dueMin, f.dueMax)) return false;
    if (f.billing.length && !f.billing.some((b) => (r.billing ?? "").toLowerCase() === b.toLowerCase())) return false;
    return true;
  });
  const sort = ["event", "name", "total", "updated"].includes(one(sp.sort)) ? one(sp.sort) : "updated";
  const dir = one(sp.dir) === "asc" ? 1 : one(sp.dir) === "desc" ? -1 : sort === "event" || sort === "name" ? 1 : -1;
  const val = (r: Row) => (sort === "event" ? (r.eventDate ?? "9999") : sort === "name" ? r.name.toLowerCase() : sort === "total" ? (r.total ?? -1) : r.updated);
  shown.sort((a, b) => (val(a) < val(b) ? -dir : val(a) > val(b) ? dir : 0));

  const view = one(sp.view) === "board" ? "board" : "list";
  const counts = Object.fromEntries(GROUPS.map((g) => [g.key, rows.filter((r) => r.group === g.key).length])) as Record<Group, number>;
  const hasGspDetails = projects.length > 0;

  const params = (patch: Record<string, string | null>) => {
    const u = new URLSearchParams();
    for (const [k, v] of Object.entries(sp)) for (const x of many(v)) u.append(k, x);
    for (const [k, v] of Object.entries(patch)) {
      u.delete(k);
      if (v) u.set(k, v);
    }
    const s = u.toString();
    return s ? `/quotes?${s}` : "/quotes";
  };
  const sortLink = (key: string, label: string) => (
    <Link href={params({ sort: key, dir: sort === key ? (dir === 1 ? "desc" : "asc") : null })}>
      {label}
      {sort === key ? (dir === 1 ? " ↑" : " ↓") : ""}
    </Link>
  );
  const cols = "minmax(180px,1.4fr) minmax(140px,1fr) 110px 130px 100px 100px 90px";

  const rowInner = (r: Row) => (
    <>
      <span className="t-cmain">
        <b>{r.name}</b>
        <small>{r.email}</small>
      </span>
      <span className="t-cmain">
        <b>{r.project || "Quote request"}</b>
        <small>{r.venue}</small>
      </span>
      <span className="c-x" data-l="Event">
        {r.eventDate ? shortDate(`${r.eventDate}T12:00:00Z`) : ""}
      </span>
      <span>
        <span className={`t-pill ${r.group === "action" ? "warn" : r.group === "signed" ? "ok" : r.group === "sent" ? "pipe" : r.group === "new" ? "brand" : ""}`}>{r.status}</span>
      </span>
      <span className="c-x r" data-l="Total">
        {money(r.total)}
      </span>
      <span className="c-x r" data-l="Due">
        {money(r.due)}
      </span>
      <span className="r">
        {r.gspUrl && (
          <a className="t-link" href={r.gspUrl} target="_blank" rel="noopener noreferrer">
            GSP ↗
          </a>
        )}
      </span>
    </>
  );

  return (
    <div className="flex flex-col gap-3 t-in">
      <section className="t-stats" aria-label="Goodshuffle status">
        {GROUPS.filter((g) => g.key !== "closed").map((g) => (
          <Link key={g.key} className="t-stat" href={params({ status: groupFilter === g.key ? null : g.key })} aria-current={groupFilter === g.key ? "true" : undefined}>
            <span>{g.label}</span>
            <b>{counts[g.key]}</b>
            <em>{g.key === "signed" && !hasGspDetails ? "Needs the Goodshuffle sync" : g.key === "action" ? "Waiting on the team" : " "}</em>
          </Link>
        ))}
      </section>

      <div className="t-vhead">
        <h1>Quotes</h1>
        <span className="grow" />
        <div className="t-seg" role="group" aria-label="View">
          <Link href={params({ view: null })} aria-current={view === "list" ? "page" : undefined}>
            List
          </Link>
          <Link href={params({ view: "board" })} aria-current={view === "board" ? "page" : undefined}>
            Board
          </Link>
        </div>
        <a className="t-btn brand" href={GOODSHUFFLE_HOME} target="_blank" rel="noopener noreferrer">
          Open Goodshuffle ↗
        </a>
      </div>

      <div className="t-vbody">
        <aside className="t-views" aria-label="Views and filters">
          <h4>Views</h4>
          <Link href={params({ status: null })} aria-current={!status ? "true" : undefined}>
            Open <small>{rows.filter((r) => r.group !== "closed").length}</small>
          </Link>
          {GROUPS.map((g) => (
            <Link key={g.key} href={params({ status: g.key })} aria-current={groupFilter === g.key ? "true" : undefined}>
              {g.label} <small>{counts[g.key]}</small>
            </Link>
          ))}
          <Link href={params({ status: "all" })} aria-current={status === "all" ? "true" : undefined}>
            Everything <small>{rows.length}</small>
          </Link>
          <h4>Filters</h4>
          <form className="t-filter" action="/quotes">
            {status && <input type="hidden" name="status" value={status} />}
            {view === "board" && <input type="hidden" name="view" value="board" />}
            <span className="cap">Client, venue or project</span>
            <input type="search" name="q" defaultValue={one(sp.q)} placeholder="Search" />
            <span className="cap">Event date</span>
            <div className="pair">
              <input type="date" name="event_from" defaultValue={f.eventFrom} aria-label="Event date from" />
              <input type="date" name="event_to" defaultValue={f.eventTo} aria-label="Event date to" />
            </div>
            <span className="cap">Logistics start and end</span>
            <div className="pair">
              <input type="date" name="log_from" defaultValue={f.logFrom} aria-label="Logistics start from" />
              <input type="date" name="log_to" defaultValue={f.logTo} aria-label="Logistics end by" />
            </div>
            <span className="cap">Quote total ($)</span>
            <div className="pair">
              <input type="number" name="total_min" min={0} defaultValue={one(sp.total_min)} placeholder="Min" aria-label="Quote total at least" />
              <input type="number" name="total_max" min={0} defaultValue={one(sp.total_max)} placeholder="Max" aria-label="Quote total at most" />
            </div>
            <span className="cap">Amount due ($)</span>
            <div className="pair">
              <input type="number" name="due_min" min={0} defaultValue={one(sp.due_min)} placeholder="Min" aria-label="Amount due at least" />
              <input type="number" name="due_max" min={0} defaultValue={one(sp.due_max)} placeholder="Max" aria-label="Amount due at most" />
            </div>
            <span className="cap">Billing status</span>
            {BILLING.map((b) => (
              <label key={b} className="chk">
                <input type="checkbox" name="billing" value={b} defaultChecked={f.billing.includes(b)} /> {b}
              </label>
            ))}
            <div className="t-acts mt-1">
              <button className="t-btn brand" type="submit">
                Apply
              </button>
              <Link className="t-btn quiet" href="/quotes">
                Clear
              </Link>
            </div>
          </form>
          {!hasGspDetails && (
            <p className="note">
              Totals, logistics and billing fill in once the Goodshuffle sync is set up. Until then those filters only match projects that have them.
            </p>
          )}
        </aside>

        <div className="t-vmain">
          {view === "list" ? (
            <div className="t-tbl" style={{ ["--cols" as string]: cols }}>
              <div className="t-tr th">
                <span>{sortLink("name", "Client")}</span>
                <span>Project · venue</span>
                <span>{sortLink("event", "Event")}</span>
                <span>Status</span>
                <span className="r">{sortLink("total", "Total")}</span>
                <span className="r">Due</span>
                <span />
              </div>
              {shown.length === 0 && <p className="t-empty">No quotes match.</p>}
              {shown.map((r) =>
                r.emailId ? (
                  <OpenThread key={r.key} emailId={r.emailId} className="t-tr" title="Open the conversation">
                    {rowInner(r)}
                  </OpenThread>
                ) : (
                  <div key={r.key} className="t-tr">
                    {rowInner(r)}
                  </div>
                ),
              )}
            </div>
          ) : (
            <div className="t-board">
              {GROUPS.map((g) => {
                const items = shown.filter((r) => r.group === g.key);
                return (
                  <div key={g.key} className="t-lane">
                    <div className="t-lane-head">
                      <b>{g.label}</b>
                      <span className="n">{items.length}</span>
                    </div>
                    <div className="t-lane-items">
                      {items.length === 0 && <p className="t-empty">None</p>}
                      {items.map((r) => {
                        const inner = (
                          <span className="t-stack">
                            <b>{r.name}</b>
                            <span>{[r.project, r.eventDate ? shortDate(`${r.eventDate}T12:00:00Z`) : "", money(r.total)].filter(Boolean).join(" · ")}</span>
                          </span>
                        );
                        return r.emailId ? (
                          <OpenThread key={r.key} emailId={r.emailId} className="t-mini">
                            {inner}
                          </OpenThread>
                        ) : r.gspUrl ? (
                          <a key={r.key} className="t-mini" href={r.gspUrl} target="_blank" rel="noopener noreferrer">
                            {inner}
                            <Icon name="quotes" className="h-4 w-4 opacity-60" />
                          </a>
                        ) : (
                          <div key={r.key} className="t-mini">
                            {inner}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <p className="t-note">
            {shown.length} of {rows.length}. Projects come from Goodshuffle&apos;s emails (website wishlists, and the project number in quote and invoice emails)
            {hasGspDetails ? " and the Goodshuffle sync." : ". Signed status, totals and billing need the Goodshuffle sync."}
          </p>
        </div>
      </div>
    </div>
  );
}
