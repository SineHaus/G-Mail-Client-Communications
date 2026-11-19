import "server-only";
// Read/unread in the dashboard (emails.is_read) is copied to Gmail, so Gmail and apps that mirror it
// (Spark, the Gmail app) show the same. Gmail is best effort: the dashboard change always stands, and
// a Gmail failure never breaks the button. Only the UNREAD label is ever touched (see gmail-policy.ts).

import { db, must } from "./db";
import { GmailScopeError, gmailFor } from "./google";

const flagKey = (accountId: string) => `read_sync_needs_reconnect:${accountId}`;

/** Set when an inbox's Google sign-in predates the read/unread permission. Cleared on reconnect. */
export async function readSyncNeedsReconnect(accountId: string): Promise<boolean> {
  const { data } = await db().from("app_settings").select("value").eq("key", flagKey(accountId)).maybeSingle();
  return !!data;
}

export async function setReadSyncNeedsReconnect(accountId: string, needed: boolean) {
  if (needed) {
    await db()
      .from("app_settings")
      .upsert({ key: flagKey(accountId), value: "1", updated_by: "system", updated_at: new Date().toISOString() }, { onConflict: "key" });
  } else {
    await db().from("app_settings").delete().eq("key", flagKey(accountId));
  }
}

type EmailRow = { id: string; gmail_message_id: string; gmail_thread_id: string; sent_at: string; direction: string; is_read: boolean };

async function copyToGmail(accountId: string, op: () => Promise<void>) {
  try {
    if (await readSyncNeedsReconnect(accountId)) return; // known to fail until the inbox reconnects
    await op();
  } catch (e) {
    if (e instanceof GmailScopeError) {
      await setReadSyncNeedsReconnect(accountId, true).catch(() => {});
      return;
    }
    console.error("Couldn't copy read status to Gmail (dashboard change kept)", accountId, e);
  }
}

/**
 * Mark an email read, plus the earlier inbound emails in its thread (Gmail and Spark show a
 * conversation as unread while any message in it is unread). Later emails in the thread are left
 * alone, so a reply that arrived after it stays unread. Returns the email ids marked read.
 */
export async function markEmailRead(accountId: string, emailId: string): Promise<string[]> {
  const email = must(
    await db().from("emails").select("id,gmail_message_id,gmail_thread_id,sent_at,direction,is_read").eq("account_id", accountId).eq("id", emailId).maybeSingle(),
  ) as EmailRow | null;
  if (!email) throw new Error("Email not found in this account.");
  // Earlier inbound emails in the thread, read or not here: ones marked read in the dashboard before
  // read status was copied to Gmail may still be unread there.
  const earlier = must(
    await db()
      .from("emails")
      .select("id,gmail_message_id,is_read")
      .eq("account_id", accountId)
      .eq("gmail_thread_id", email.gmail_thread_id)
      .eq("direction", "inbound")
      .lte("sent_at", email.sent_at)
      .neq("id", email.id)
      .limit(200),
  ) as { id: string; gmail_message_id: string; is_read: boolean }[];
  const ids = [email.id, ...earlier.filter((e) => !e.is_read).map((e) => e.id)];
  must(await db().from("emails").update({ is_read: true }).eq("account_id", accountId).in("id", ids).select("id"));
  // Gmail only needs inbound messages; ones the team sent are never unread there.
  const gmailIds = [...(email.direction === "inbound" ? [email.gmail_message_id] : []), ...earlier.map((e) => e.gmail_message_id)];
  if (gmailIds.length) await copyToGmail(accountId, () => gmailFor(accountId).markRead(gmailIds));
  return ids;
}

/**
 * After an inbox (re)connects with the read/unread permission: copy to Gmail the emails already
 * read in the dashboard over the last `days` days, so Gmail and Spark catch up. Never marks anything
 * unread. Best effort.
 */
export async function catchUpReadInGmail(accountId: string, days = 30): Promise<number> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const rows = must(
    await db()
      .from("emails")
      .select("gmail_message_id")
      .eq("account_id", accountId)
      .eq("direction", "inbound")
      .eq("is_read", true)
      .gte("sent_at", since)
      .order("sent_at", { ascending: false })
      .limit(1000),
  ) as { gmail_message_id: string }[];
  if (!rows.length) return 0;
  await copyToGmail(accountId, () => gmailFor(accountId).markRead(rows.map((r) => r.gmail_message_id)));
  return rows.length;
}

/** Mark one email unread, in the dashboard and in Gmail. */
export async function markEmailUnread(accountId: string, emailId: string): Promise<void> {
  const rows = must(
    await db().from("emails").update({ is_read: false }).eq("account_id", accountId).eq("id", emailId).select("gmail_message_id,direction"),
  ) as { gmail_message_id: string; direction: string }[];
  if (!rows.length) throw new Error("Email not found in this account.");
  if (rows[0].direction === "inbound") await copyToGmail(accountId, () => gmailFor(accountId).markUnread(rows[0].gmail_message_id));
}
