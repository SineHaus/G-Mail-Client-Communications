import "server-only";
import { db } from "./db";
import { env } from "./env";
import { gmailFor } from "./google";

/** Start/renew Gmail push notifications for ONE account (Gmail expires each watch after 7 days). */
export async function startWatch(accountId: string) {
  const topic = env.pubsubTopic();
  if (!topic) return { ok: false as const, reason: "GMAIL_PUBSUB_TOPIC is not set" };
  const w = await gmailFor(accountId).watch(topic);
  await db()
    .from("gmail_accounts")
    .update({ watch_expiration: new Date(Number(w.expiration)).toISOString() })
    .eq("id", accountId);
  return { ok: true as const, expiration: w.expiration };
}

/** Renew every connected account's watch that expires within `withinHours` (default 3 days). */
export async function renewExpiringWatches(withinHours = 72) {
  const soon = new Date(Date.now() + withinHours * 3600_000).toISOString();
  const { data } = await db()
    .from("gmail_accounts")
    .select("id,email_address,watch_expiration")
    .not("refresh_token_encrypted", "is", null)
    .or(`watch_expiration.is.null,watch_expiration.lt.${soon}`);
  const results: { account: string; ok: boolean; detail: string }[] = [];
  for (const a of (data ?? []) as { id: string; email_address: string }[]) {
    try {
      const r = await startWatch(a.id);
      results.push({ account: a.email_address, ok: r.ok, detail: r.ok ? `expires ${new Date(Number(r.expiration)).toISOString()}` : r.reason });
    } catch (e) {
      results.push({ account: a.email_address, ok: false, detail: e instanceof Error ? e.message : String(e) });
    }
  }
  return results;
}
