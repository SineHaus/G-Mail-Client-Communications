import { after, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listAccounts } from "@/lib/accounts";
import { requireMember } from "@/lib/team";
import { syncHistory } from "@/lib/ingest";
import { draftDeadline, draftMissing, findUndraftedEmails } from "@/lib/draft-queue";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const STALE_MS = 10 * 60_000;

/**
 * Polled by open dashboards (~45s): newest open draft across the accounts THIS person can access
 * (drives the "new draft" notification). Also a safety net for push: any of their connected
 * accounts not checked for 10 minutes gets a catch-up sync in the background.
 */
export async function GET() {
  const startedAt = Date.now();
  let accounts;
  try {
    accounts = await listAccounts(await requireMember());
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const ids = accounts.map((a) => a.id);
  if (!ids.length) return NextResponse.json({ count: 0, latest: null });

  const { count, data } = await db()
    .from("drafts")
    .select("created_at", { count: "exact" })
    .in("account_id", ids)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1);

  const stale = accounts.filter(
    (a) => a.connected && !a.last_error && (!a.last_synced_at || Date.now() - new Date(a.last_synced_at).getTime() > STALE_MS),
  );
  const deadline = draftDeadline(startedAt, maxDuration);
  // Connected inboxes that were checked recently but still have client emails without a draft
  // (e.g. the last run ran out of time): draft those in the background too.
  const fresh = accounts.filter((a) => a.connected && !stale.includes(a));
  if (stale.length || fresh.length) {
    after(async () => {
      for (const a of fresh) {
        try {
          if ((await findUndraftedEmails(a.id)).length) await draftMissing(a.id, deadline);
        } catch (e) {
          console.error("catch-up drafting failed", a.email_address, e);
        }
      }
      for (const a of stale) {
        try {
          // Claim the check first so several open tabs don't all sync at once.
          const claimed = await db()
            .from("gmail_accounts")
            .update({ last_synced_at: new Date().toISOString() })
            .eq("id", a.id)
            .or(`last_synced_at.is.null,last_synced_at.lt.${new Date(Date.now() - STALE_MS).toISOString()}`)
            .select("id");
          if (!claimed.data?.length) continue;
          const { draftEmailIds } = await syncHistory(a.id);
          await draftMissing(a.id, deadline, draftEmailIds);
        } catch (e) {
          console.error("catch-up sync failed", a.email_address, e);
        }
      }
    });
  }
  return NextResponse.json({ count: count ?? 0, latest: data?.[0]?.created_at ?? null });
}
