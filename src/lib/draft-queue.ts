import "server-only";
import { db, must } from "./db";
import { env } from "./env";
import { generateDrafts } from "./claude";
import { isWishListNoticeSubject, WISH_LIST_SUBJECT_ILIKE } from "./email-parse";

// Drafting is picked up wherever it left off. A Vercel function stops at its time limit (maxDuration),
// and before this, an email whose draft hadn't been written by then never got one: only emails stored
// in that same run were drafted. Now every check (push, the dashboard's poll, the daily job, Sync now)
// drafts any unanswered client email that still has no draft, as many as fit in the time left.

/** Time a run keeps free at the end, so it finishes before the platform stops the function. */
const END_MARGIN_MS = 20_000;

/** The deadline for drafting in a request that started at `startedAt`, given the route's maxDuration (seconds). */
export function draftDeadline(startedAt: number, maxDurationSeconds = 300) {
  return startedAt + maxDurationSeconds * 1000 - END_MARGIN_MS;
}

/**
 * Unanswered client emails of `accountId` that should have a Claude draft and don't: the latest
 * message of its thread, inbound, from a client that isn't ignored, within the draft lookback window,
 * and with no draft row at all (a declined, sent or failed draft counts as handled). Newest first.
 */
export async function findUndraftedEmails(accountId: string): Promise<string[]> {
  const cutoff = new Date(Date.now() - env.draftLookbackDays() * 86_400_000).toISOString();
  const rows = must(
    await db()
      .from("emails")
      .select("id,gmail_thread_id,direction,subject,clients!emails_client_fk(ignored)")
      .eq("account_id", accountId)
      .gte("sent_at", cutoff)
      .order("sent_at", { ascending: false })
      .limit(500),
  ) as unknown as { id: string; gmail_thread_id: string; direction: string; subject: string | null; clients: { ignored: boolean } | null }[];

  // Newest first, so the first row seen for a thread is its latest message.
  const seen = new Set<string>();
  const candidates: string[] = [];
  for (const r of rows) {
    if (seen.has(r.gmail_thread_id)) continue;
    seen.add(r.gmail_thread_id);
    if (r.direction === "inbound" && !r.clients?.ignored && !isWishListNoticeSubject(r.subject)) candidates.push(r.id);
  }
  if (!candidates.length) return [];

  const drafted = new Set<string>();
  for (let i = 0; i < candidates.length; i += 200) {
    const d = must(
      await db().from("drafts").select("email_id").eq("account_id", accountId).in("email_id", candidates.slice(i, i + 200)),
    ) as { email_id: string }[];
    for (const x of d) drafted.add(x.email_id);
  }
  return candidates.filter((id) => !drafted.has(id));
}

/** How long a drafting lease lasts: longer than any function may run, so a stopped run frees it. */
const LEASE_MS = 6 * 60_000;

/**
 * One drafting run per inbox at a time, so open dashboards, push and the daily job don't ask Claude
 * for the same emails at once. Returns a token to release with, or null if another run holds it.
 */
async function claimDraftingLease(accountId: string): Promise<string | null> {
  const key = `drafting_lease:${accountId}`;
  const token = new Date().toISOString();
  const ins = await db().from("app_settings").insert({ key, value: token, updated_by: "system" });
  if (!ins.error) return token;
  if (ins.error.code !== "23505") throw new Error(ins.error.message);
  // Someone holds it: take it over only if it's older than a function can run (that run was stopped).
  const staleBefore = new Date(Date.now() - LEASE_MS).toISOString();
  const upd = await db()
    .from("app_settings")
    .update({ value: token, updated_at: token })
    .eq("key", key)
    .lt("value", staleBefore)
    .select("key");
  return upd.data?.length ? token : null;
}

async function releaseDraftingLease(accountId: string, token: string) {
  await db().from("app_settings").delete().eq("key", `drafting_lease:${accountId}`).eq("value", token);
}

/**
 * Draft every client email of `accountId` that still needs one (`first` — e.g. emails stored by the
 * sync that just ran — go first), stopping before `deadline`. Whatever is left is drafted on the next check.
 * Returns how many were drafted now and how many are still waiting.
 */
export async function draftMissing(accountId: string, deadline: number, first: string[] = []) {
  const hidden = await hideWishListEmails(accountId).catch((e) => {
    console.error("hiding wish list emails failed", accountId, e);
    return new Set<string>();
  });
  const ids = [...new Set([...first, ...(await findUndraftedEmails(accountId))])].filter((id) => !hidden.has(id));
  if (!ids.length) return { drafted: 0, waiting: 0 };
  const token = await claimDraftingLease(accountId);
  if (!token) return { drafted: 0, waiting: ids.length }; // another run is drafting this inbox right now
  try {
    const { drafted, left } = await generateDrafts(accountId, ids, deadline);
    return { drafted, waiting: left };
  } finally {
    await releaseDraftingLease(accountId, token);
  }
}

/**
 * Goodshuffle Pro's "New Wish List Submission" notices stored before they were filtered out at import:
 * close their open drafts (as superseded, which no list shows) and mark them read, so they drop out of
 * the queue and the unread count. Nothing is deleted. Returns their email ids.
 */
export async function hideWishListEmails(accountId: string): Promise<Set<string>> {
  const rows = must(
    await db()
      .from("emails")
      .select("id,subject")
      .eq("account_id", accountId)
      .eq("direction", "inbound")
      .ilike("subject", WISH_LIST_SUBJECT_ILIKE)
      .limit(500),
  ) as { id: string; subject: string | null }[];
  const ids = rows.filter((r) => isWishListNoticeSubject(r.subject)).map((r) => r.id);
  if (!ids.length) return new Set();
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    must(
      await db()
        .from("drafts")
        .update({ status: "superseded", updated_at: new Date().toISOString() })
        .eq("account_id", accountId)
        .in("email_id", chunk)
        .eq("status", "pending")
        .select("id"),
    );
    must(await db().from("emails").update({ is_read: true }).eq("account_id", accountId).in("id", chunk).eq("is_read", false).select("id"));
  }
  return new Set(ids);
}
