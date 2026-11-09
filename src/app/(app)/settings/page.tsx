import { db } from "@/lib/db";
import { fmtDate } from "@/lib/format";
import SyncButton from "@/components/SyncButton";
import WatchButton from "@/components/WatchButton";
import StyleExamples from "@/components/StyleExamples";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [acct, styles] = await Promise.all([
    db().from("gmail_account").select("email,history_id,watch_expires_at,last_synced_at").eq("id", 1).maybeSingle(),
    db().from("style_examples").select("id,context,body,created_at").order("created_at", { ascending: false }),
  ]);
  const a = acct.data as { email: string; watch_expires_at: string | null; last_synced_at: string | null } | null;
  const watchOk = a?.watch_expires_at && new Date(a.watch_expires_at) > new Date();

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="card p-5">
        <h2 className="mb-3 font-semibold">Gmail connection</h2>
        {a ? (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[12rem_1fr]">
            <dt className="text-stone-500">Connected account</dt>
            <dd className="font-medium">{a.email}</dd>
            <dt className="text-stone-500">Last sync</dt>
            <dd>{a.last_synced_at ? fmtDate(a.last_synced_at) : "Never"}</dd>
            <dt className="text-stone-500">Push notifications</dt>
            <dd>
              {watchOk ? (
                <span className="text-emerald-700">Active until {fmtDate(a.watch_expires_at)} (renews daily)</span>
              ) : (
                <span className="text-amber-700">Not active — new emails only arrive when you press Sync now.</span>
              )}
            </dd>
          </dl>
        ) : (
          <p className="text-sm text-stone-600">Not connected.</p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          <SyncButton lastSynced={a?.last_synced_at ?? null} />
          <WatchButton />
          <a href="/api/auth/google" className="btn-ghost">Reconnect Google</a>
        </div>
      </section>

      <section className="card p-5">
        <h2 className="font-semibold">Leonel&apos;s writing style</h2>
        <p className="mb-4 text-sm text-stone-500">
          Claude copies the tone of these past replies. Import some from your Sent mail, or paste good examples. 10–20 varied examples works well.
        </p>
        <StyleExamples examples={(styles.data ?? []) as { id: string; context: string | null; body: string; created_at: string }[]} />
      </section>
    </div>
  );
}
