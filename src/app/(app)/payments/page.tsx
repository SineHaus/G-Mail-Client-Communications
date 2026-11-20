import { getCurrentAccount } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { loadGoodshuffleProjects, money, shortDate } from "@/lib/dashboard";
import { GOODSHUFFLE_HOME } from "@/lib/quote-rules";
import NoAccount from "@/components/NoAccount";

export const dynamic = "force-dynamic";

// Payments: what customers still owe, from Goodshuffle's billing. Goodshuffle has no API, so this
// stays empty until the Goodshuffle sync fills goodshuffle_projects (migration 006).

export default async function PaymentsPage() {
  const member = await requireMember();
  const acct = await getCurrentAccount();
  if (!acct) return <NoAccount isOwner={member.is_owner} />;

  const projects = await loadGoodshuffleProjects(acct.id);
  const owed = projects.filter((p) => (p.amount_due ?? 0) > 0).sort((a, b) => (a.event_date ?? "9999").localeCompare(b.event_date ?? "9999"));
  const total = owed.reduce((n, p) => n + (p.amount_due ?? 0), 0);
  const cols = "minmax(180px,1.3fr) minmax(160px,1fr) 110px 120px 110px 70px";

  return (
    <div className="flex flex-col gap-3 t-in">
      <div className="t-vhead">
        <h1>Payments</h1>
        <span className="grow" />
        <a className="t-btn" href={GOODSHUFFLE_HOME} target="_blank" rel="noopener noreferrer">
          Open Goodshuffle ↗
        </a>
      </div>

      {projects.length === 0 ? (
        <div className="t-banner">
          <b>Payments come from Goodshuffle.</b> Goodshuffle has no way for the dashboard to read billing directly, so amounts due show up here once the Goodshuffle
          project sync is set up. Until then, check billing in Goodshuffle.
        </div>
      ) : (
        <>
          <section className="t-stats" aria-label="Payments">
            <div className="t-stat">
              <span>Still owed</span>
              <b>{money(total)}</b>
              <em>{owed.length} projects</em>
            </div>
          </section>
          <div className="t-tbl" style={{ ["--cols" as string]: cols }}>
            <div className="t-tr th">
              <span>Customer</span>
              <span>Project</span>
              <span>Event</span>
              <span>Billing</span>
              <span className="r">Due</span>
              <span />
            </div>
            {owed.length === 0 && <p className="t-empty">Nothing is owed right now.</p>}
            {owed.map((p) => (
              <div key={p.gsp_project_id} className="t-tr">
                <span className="t-cmain">
                  <b>{p.client_name || p.client_email || "Customer"}</b>
                  <small>{p.client_email ?? ""}</small>
                </span>
                <span className="c-x">{p.project_name ?? `Project #${p.gsp_project_id}`}</span>
                <span className="c-x" data-l="Event">
                  {p.event_date ? shortDate(`${p.event_date}T12:00:00Z`) : ""}
                </span>
                <span>
                  <span className={`t-pill ${/overdue/i.test(p.billing_status ?? "") ? "warn" : ""}`}>{p.billing_status ?? "Unpaid"}</span>
                </span>
                <span className="r">
                  <b>{money(p.amount_due)}</b>
                </span>
                <span className="r">
                  <a className="t-link" href={p.url} target="_blank" rel="noopener noreferrer">
                    GSP ↗
                  </a>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
