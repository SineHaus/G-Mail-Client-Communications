import { db } from "@/lib/db";
import { getCurrentAccount, listAccounts } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { can } from "@/lib/permissions";
import { fmtDate } from "@/lib/format";
import StyleExamples from "@/components/StyleExamples";
import AccountCard from "@/components/AccountCard";
import TeamManager from "@/components/TeamManager";
import ReplyRules from "@/components/ReplyRules";

export const dynamic = "force-dynamic";
// Server actions on this page (Sync now, Redraft, Review, Retry) call Claude; give them the full 5 minutes.
export const maxDuration = 300;

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { error } = await searchParams;
  const member = await requireMember();
  const accounts = await listAccounts(member);
  const current = await getCurrentAccount(accounts);
  const isOwner = member.is_owner;

  const [styles, rules, team, access, activity] = await Promise.all([
    current
      ? db().from("style_examples").select("id,context,body,created_at").eq("account_id", current.id).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] }),
    db().from("app_settings").select("value,updated_by,updated_at").eq("key", "reply_rules").maybeSingle(),
    isOwner ? db().from("team_members").select("id,email,name,is_owner,active,last_login_at").order("created_at") : Promise.resolve({ data: [] }),
    isOwner ? db().from("account_access").select("member_id,account_id,role") : Promise.resolve({ data: [] }),
    isOwner ? db().from("audit_log").select("actor,action,detail,created_at,account_id").order("created_at", { ascending: false }).limit(50) : Promise.resolve({ data: [] }),
  ]);
  const rulesRow = rules.data as { value: string; updated_by: string | null; updated_at: string } | null;
  const acctName = Object.fromEntries(accounts.map((a) => [a.id, a.email_address]));

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{String(error)}</p>}

      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Gmail accounts</h2>
            <p className="text-sm text-stone-500">
              Each account has its own queue and clients. Access to Gmail is read + send only; nothing is ever marked read or labelled there.
            </p>
          </div>
          {isOwner && <a href="/api/auth/google?mode=add" className="btn-brand">+ Add Gmail account</a>}
        </div>
        <ul className="space-y-3">
          {accounts.map((a) => (
            <AccountCard
              key={a.id}
              account={{
                id: a.id,
                email: a.email_address,
                name: a.display_name,
                connected: a.connected,
                lastSynced: a.last_synced_at,
                watchExpiration: a.watch_expiration,
                lastError: a.last_error,
              }}
              isCurrent={a.id === current?.id}
              isOwner={isOwner}
              canEdit={can(a.role, "edit")}
            />
          ))}
          {!accounts.length && <li className="text-sm text-stone-500">No accounts {isOwner ? "yet" : "shared with you yet"}.</li>}
        </ul>
      </section>

      {isOwner && (
        <section className="card p-5">
          <h2 className="font-semibold">Team</h2>
          <p className="mb-4 text-sm text-stone-500">
            People sign in with their own Google account. Give each person a role per Gmail account: <b>Approver</b> can send, <b>Editor</b> can edit and decline
            but not send, <b>Viewer</b> can only read, <b>No access</b> hides that inbox from them entirely. Owners can do everything everywhere.
          </p>
          <TeamManager
            members={(team.data ?? []) as { id: string; email: string; name: string | null; is_owner: boolean; active: boolean; last_login_at: string | null }[]}
            access={(access.data ?? []) as { member_id: string; account_id: string; role: "approver" | "editor" | "viewer" }[]}
            accounts={accounts.map((a) => ({ id: a.id, email: a.email_address }))}
            meId={member.id}
          />
        </section>
      )}

      <section className="card p-5">
        <h2 className="font-semibold">AI reply rules</h2>
        <p className="mb-4 text-sm text-stone-500">
          TERG&apos;s rules Claude follows in every draft, for every inbox: payment methods, delivery fees, policies. Change them here, no code edits needed. The fixed rules
          (never offer delivery or pickup dates, never invent prices, nothing sends without Approve) always apply on top.
        </p>
        <ReplyRules
          initial={rulesRow?.value ?? ""}
          canEdit={isOwner}
          updated={rulesRow ? `Last changed ${fmtDate(rulesRow.updated_at)}${rulesRow.updated_by ? ` by ${rulesRow.updated_by.split("@")[0]}` : ""}` : null}
        />
      </section>

      {current && can(current.role, "edit") && (
        <section className="card p-5">
          <h2 className="font-semibold">Writing style for {current.display_name && current.display_name !== current.email_address ? current.display_name : current.email_address}</h2>
          <p className="mb-4 text-sm text-stone-500">
            Claude copies the tone of these past replies when drafting for this inbox. Import some from its Sent mail, or paste good examples. 10–20 varied examples works well.
          </p>
          <StyleExamples examples={(styles.data ?? []) as { id: string; context: string | null; body: string; created_at: string }[]} />
        </section>
      )}

      {isOwner && (
        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Activity</h2>
          <ul className="space-y-1 text-xs text-stone-600">
            {((activity.data ?? []) as { actor: string; action: string; detail: string | null; created_at: string; account_id: string | null }[]).map((h, i) => (
              <li key={i}>
                {fmtDate(h.created_at)} · <b>{h.actor.split("@")[0]}</b> {h.action.replace(/_/g, " ")}
                {h.account_id && acctName[h.account_id] ? ` · ${acctName[h.account_id]}` : ""}
                {h.detail ? ` — ${h.detail}` : ""}
              </li>
            ))}
            {!activity.data?.length && <li className="text-stone-400">Nothing yet.</li>}
          </ul>
        </section>
      )}
    </div>
  );
}
