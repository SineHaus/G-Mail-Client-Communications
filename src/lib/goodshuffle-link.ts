import "server-only";
import { cache } from "react";
import { db, must } from "./db";
import { audit } from "./audit";
import { GmailRateLimitError, getAccount, gmailFor, sleep } from "./google";
import { agentTablesReady, type QuoteRequest } from "./quotes";
import { matchWishlist, parseWishlistNotice, type GoodshuffleMatch, type Person, type WishlistRow } from "./goodshuffle";
import type { GmailMessage } from "./email-parse";

// Goodshuffle project links on cards. Goodshuffle Pro has no API, but its "New Wishlist Submission"
// emails (skipped from the queue at import) name the project and the customer. They're kept in
// goodshuffle_wishlists and matched to clients by name plus email or phone. No Claude calls, nothing is
// sent, and nothing in Goodshuffle or Gmail is changed. Every query is scoped to one account.

/** Whether migration 005 has been run (the goodshuffle_wishlists table exists). */
export const wishlistTableReady = cache(async function wishlistTableReady(accountId: string): Promise<boolean> {
  const { error } = await db().from("goodshuffle_wishlists").select("id").eq("account_id", accountId).limit(1);
  if (!error) return true;
  if (error.code === "42P01" || error.code === "PGRST205" || /could not find the table|does not exist/i.test(error.message)) return false;
  throw new Error(error.message);
});

/** Keep one wishlist notice of `accountId`. Returns false when it isn't one or migration 005 isn't run. */
export async function saveWishlistNotice(accountId: string, msg: GmailMessage, myEmail: string): Promise<boolean> {
  const n = parseWishlistNotice(msg, myEmail);
  if (!n) return false;
  const { error } = await db()
    .from("goodshuffle_wishlists")
    .upsert(
      {
        account_id: accountId,
        gmail_message_id: msg.id,
        gsp_project_id: n.projectId,
        url: n.url,
        project_name: n.projectName,
        contact_name: n.contactName,
        phone: n.phone,
        email: n.email,
        received_at: n.receivedAt,
      },
      { onConflict: "account_id,gsp_project_id", ignoreDuplicates: true },
    );
  if (error) {
    if (error.code === "42P01" || error.code === "PGRST205") return false;
    throw new Error(error.message);
  }
  return true;
}

const backfillKey = (accountId: string) => `gsp_wishlists_backfilled:${accountId}`;
/** Someone removed an automatic link from this quote: don't put one back. */
export const noAutoLinkKey = (quoteId: string) => `gsp_no_autolink:${quoteId}`;

const BACKFILL_QUERY = 'from:goodshuffle.com ("wishlist submission" OR "wish list submission") newer_than:365d';
const BACKFILL_MAX = 200;

/**
 * Once per inbox: read the wishlist notices of the past year from Gmail (read-only), so cards for
 * clients who came in before this feature get their link too. Stops at `deadline` and resumes on the
 * next check; already kept notices aren't fetched again.
 */
async function backfillWishlists(accountId: string, deadline: number) {
  const done = await db().from("app_settings").select("key").eq("key", backfillKey(accountId)).maybeSingle();
  if (done.data) return;
  const acct = await getAccount(accountId);
  if (!acct.connected) return;
  const gmail = gmailFor(accountId);
  const ids = (await gmail.listMessageIds(BACKFILL_QUERY, BACKFILL_MAX)).map((m) => m.id);
  const known = new Set(
    (must(
      await db().from("goodshuffle_wishlists").select("gmail_message_id").eq("account_id", accountId).limit(2000),
    ) as { gmail_message_id: string }[]).map((r) => r.gmail_message_id),
  );
  for (const id of ids) {
    if (known.has(id)) continue;
    if (Date.now() > deadline) return; // finish on the next check
    try {
      await saveWishlistNotice(accountId, await gmail.getMessage(id), acct.email_address);
    } catch (e) {
      if ((e as { status?: number }).status === 404) continue;
      if (e instanceof GmailRateLimitError) return;
      throw e;
    }
    await sleep(120);
  }
  await db()
    .from("app_settings")
    .upsert({ key: backfillKey(accountId), value: new Date().toISOString(), updated_by: "system", updated_at: new Date().toISOString() });
}

export async function loadWishlists(accountId: string): Promise<WishlistRow[]> {
  if (!(await wishlistTableReady(accountId))) return [];
  return must(
    await db()
      .from("goodshuffle_wishlists")
      .select("gsp_project_id,url,project_name,contact_name,phone,email,received_at")
      .eq("account_id", accountId)
      .order("received_at", { ascending: false })
      .limit(2000),
  ) as WishlistRow[];
}

type ClientBits = { id: string; name: string | null; email: string; phone: string | null };

/** Who a quote request is for: the client on file plus what the customer wrote in the request. */
export function personForQuote(q: Pick<QuoteRequest, "info">, client: ClientBits | null | undefined): Person {
  return {
    names: [client?.name, q.info?.name],
    emails: [client?.email, q.info?.email],
    phones: [client?.phone, q.info?.phone],
  };
}

export function personForClient(client: ClientBits | null | undefined): Person {
  return { names: [client?.name], emails: [client?.email], phones: [client?.phone] };
}

/**
 * Put the Goodshuffle link on every open quote of `accountId` that has none, when exactly one
 * wishlist matches by name plus email or phone around the time of the request. A link someone typed
 * is never replaced, and a quote whose automatic link someone removed is left alone.
 */
export async function autoLinkQuotes(accountId: string): Promise<number> {
  if (!(await agentTablesReady(accountId))) return 0;
  const wishlists = await loadWishlists(accountId);
  if (!wishlists.length) return 0;
  const quotes = must(
    await db()
      .from("quote_requests")
      .select("id,title,info,client_id,created_at")
      .eq("account_id", accountId)
      .is("goodshuffle_url", null)
      .neq("stage", "closed")
      .limit(300),
  ) as Pick<QuoteRequest, "id" | "title" | "info" | "client_id" | "created_at">[];
  if (!quotes.length) return 0;
  const clientIds = [...new Set(quotes.map((q) => q.client_id).filter(Boolean))] as string[];
  const clients = new Map(
    (clientIds.length
      ? (must(await db().from("clients").select("id,name,email,phone").eq("account_id", accountId).in("id", clientIds)) as ClientBits[])
      : []
    ).map((c) => [c.id, c]),
  );
  const optedOut = new Set(
    (must(
      await db().from("app_settings").select("key").like("key", `${noAutoLinkKey("")}%`).limit(5000),
    ) as { key: string }[]).map((r) => r.key),
  );
  let linked = 0;
  for (const q of quotes) {
    if (optedOut.has(noAutoLinkKey(q.id))) continue;
    const m = matchWishlist(personForQuote(q, q.client_id ? clients.get(q.client_id) : null), wishlists, q.created_at);
    if (m?.level !== "linked") continue;
    const rows = must(
      await db()
        .from("quote_requests")
        .update({ goodshuffle_url: m.wishlist.url, updated_at: new Date().toISOString() })
        .eq("account_id", accountId)
        .eq("id", q.id)
        .is("goodshuffle_url", null)
        .select("id"),
    ) as { id: string }[];
    if (!rows.length) continue;
    linked++;
    await audit("system", "auto_linked_goodshuffle", {
      accountId,
      detail: `${q.title ?? q.id} · Goodshuffle #${m.wishlist.gsp_project_id} (${m.why})`,
    });
  }
  return linked;
}

/**
 * Run on every drafting check: read past notices once, then link quotes. Never throws (the links are a
 * convenience and must not stop drafting). Leaves at least 60 seconds of `deadline` for drafting.
 */
export async function refreshGoodshuffleLinks(accountId: string, deadline: number) {
  try {
    if (!(await wishlistTableReady(accountId))) return;
    await backfillWishlists(accountId, Math.min(deadline - 60_000, Date.now() + 40_000));
    await autoLinkQuotes(accountId);
  } catch (e) {
    console.error("goodshuffle links failed", accountId, e);
  }
}

export type { GoodshuffleMatch };
