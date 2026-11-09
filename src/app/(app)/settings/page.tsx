import { db } from "@/lib/db";
import { getCurrentAccount, listAccounts } from "@/lib/accounts";
import StyleExamples from "@/components/StyleExamples";
import AccountCard from "@/components/AccountCard";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const { error } = await searchParams;
  const accounts = await listAccounts();
  const current = await getCurrentAccount(accounts);
  const styles = current
    ? await db().from("style_examples").select("id,context,body,created_at").eq("account_id", current.id).order("created_at", { ascending: false })
    : { data: [] };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>
      {error && <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{String(error)}</p>}

      <section className="card p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-semibold">Gmail accounts</h2>
            <p className="text-sm text-stone-500">
              Each account has its own review queue, clients, projects and push notifications. Access is read + send only.
            </p>
          </div>
          <a href="/api/auth/google?mode=add" className="btn-brand">+ Add Gmail account</a>
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
            />
          ))}
          {!accounts.length && <li className="text-sm text-stone-500">No accounts yet.</li>}
        </ul>
      </section>

      {current && (
        <section className="card p-5">
          <h2 className="font-semibold">Writing style for {current.display_name && current.display_name !== current.email_address ? current.display_name : current.email_address}</h2>
          <p className="mb-4 text-sm text-stone-500">
            Claude copies the tone of these past replies when drafting for this account. Import some from its Sent mail, or paste good examples. 10–20 varied examples works well.
          </p>
          <StyleExamples examples={(styles.data ?? []) as { id: string; context: string | null; body: string; created_at: string }[]} />
        </section>
      )}
    </div>
  );
}
