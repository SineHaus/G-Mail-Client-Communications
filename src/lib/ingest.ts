import "server-only";
import { db, must } from "./db";
import { env } from "./env";
import { gmailFor, getAccount } from "./google";
import { extractBody, header, parseAddressList, stripQuoted, type GmailMessage } from "./email-parse";

// Every function here works on ONE Gmail account and scopes every query by account_id.

const SKIP_LABELS = ["DRAFT", "SPAM", "TRASH", "CHAT"];
const BULK_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_UPDATES", "CATEGORY_FORUMS"];
const BULK_SENDER = /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|bounce)/i;

export type IngestResult =
  | { status: "skipped"; reason: string }
  | { status: "exists"; emailId: string }
  | { status: "inserted"; emailId: string; direction: "inbound" | "outbound"; threadId: string; sentAt: string };

type ClientRow = { id: string; name: string | null; ignored: boolean };

async function findOrCreateClient(accountId: string, email: string, name: string): Promise<ClientRow> {
  const find = async () =>
    (must(
      await db().from("clients").select("id,name,ignored").eq("account_id", accountId).eq("email", email).limit(1),
    ) as ClientRow[])[0];
  const existing = await find();
  if (existing) {
    if (!existing.name && name) await db().from("clients").update({ name }).eq("account_id", accountId).eq("id", existing.id);
    return existing;
  }
  const ins = await db()
    .from("clients")
    .upsert({ account_id: accountId, email, name: name || null }, { onConflict: "account_id,email", ignoreDuplicates: true })
    .select("id,name,ignored");
  if (ins.data?.[0]) return ins.data[0] as ClientRow;
  return (await find())!; // lost a race with a concurrent insert
}

/** Store one Gmail message of `accountId` (if it's a client conversation) and match/create the client. */
export async function ingestMessage(accountId: string, msg: GmailMessage, myEmail: string): Promise<IngestResult> {
  const found = must(
    await db().from("emails").select("id").eq("account_id", accountId).eq("gmail_message_id", msg.id).limit(1),
  ) as { id: string }[];
  if (found[0]) return { status: "exists", emailId: found[0].id };

  const labels = msg.labelIds ?? [];
  if (labels.some((l) => SKIP_LABELS.includes(l))) return { status: "skipped", reason: "label" };

  const from = parseAddressList(header(msg, "From"))[0];
  if (!from) return { status: "skipped", reason: "no sender" };
  const me = myEmail.toLowerCase();
  const direction: "inbound" | "outbound" = from.email === me ? "outbound" : "inbound";

  let counterpart: { name: string; email: string } | undefined;
  if (direction === "inbound") {
    const isBulk =
      labels.some((l) => BULK_LABELS.includes(l)) || BULK_SENDER.test(from.email) || !!header(msg, "List-Unsubscribe");
    if (isBulk) return { status: "skipped", reason: "bulk/automated" };
    counterpart = from;
  } else {
    counterpart = [...parseAddressList(header(msg, "To")), ...parseAddressList(header(msg, "Cc"))].find(
      (a) => a.email !== me,
    );
    if (!counterpart) return { status: "skipped", reason: "note to self" };
  }

  const client = await findOrCreateClient(accountId, counterpart.email, counterpart.name);

  // New messages inherit the project already linked to their thread (same account only).
  const threadProject = must(
    await db()
      .from("emails")
      .select("project_id")
      .eq("account_id", accountId)
      .eq("gmail_thread_id", msg.threadId)
      .not("project_id", "is", null)
      .limit(1),
  ) as { project_id: string }[];

  const sentAt = new Date(Number(msg.internalDate ?? Date.now())).toISOString();
  const row = {
    account_id: accountId,
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId,
    message_id_header: header(msg, "Message-ID") || header(msg, "Message-Id") || null,
    client_id: client.id,
    project_id: threadProject[0]?.project_id ?? null,
    direction,
    from_address: from.email,
    from_name: from.name || null,
    to_addresses: header(msg, "To"),
    subject: header(msg, "Subject"),
    body: stripQuoted(extractBody(msg)),
    snippet: msg.snippet ?? null,
    sent_at: sentAt,
    // Read/unread is tracked only in Supabase. Gmail's UNREAD label is never read from or written to.
    is_read: direction === "outbound",
  };
  const ins = await db().from("emails").insert({ ...row, account_id: accountId }).select("id").single();
  if (ins.error) {
    if (ins.error.code === "23505") {
      const again = must(
        await db().from("emails").select("id").eq("account_id", accountId).eq("gmail_message_id", msg.id).single(),
      ) as { id: string };
      return { status: "exists", emailId: again.id };
    }
    throw new Error(ins.error.message);
  }

  // Leonel replied (from Gmail or from here) → any open draft for earlier emails in the thread is stale.
  if (direction === "outbound") await supersedeThreadDrafts(accountId, msg.threadId, sentAt);

  return { status: "inserted", emailId: (ins.data as { id: string }).id, direction, threadId: msg.threadId, sentAt };
}

/** Mark open drafts on emails in a thread sent before `before` as superseded. */
export async function supersedeThreadDrafts(accountId: string, threadId: string, before: string, exceptEmailId?: string) {
  const earlier = must(
    await db().from("emails").select("id").eq("account_id", accountId).eq("gmail_thread_id", threadId).lt("sent_at", before),
  ) as { id: string }[];
  const ids = earlier.map((e) => e.id).filter((id) => id !== exceptEmailId);
  if (!ids.length) return;
  await db()
    .from("drafts")
    .update({ status: "superseded", updated_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .in("email_id", ids)
    .in("status", ["pending", "revised"]);
}

/**
 * From freshly inserted messages, pick the inbound ones that should get a Claude draft:
 * the latest message in its thread, from a non-ignored client, within the lookback window,
 * with no open draft already.
 */
export async function pickDraftCandidates(accountId: string, results: IngestResult[]): Promise<string[]> {
  const cutoff = Date.now() - env.draftLookbackDays() * 86_400_000;
  const threads = new Set(
    results.filter((r) => r.status === "inserted" && r.direction === "inbound").map((r) => (r as { threadId: string }).threadId),
  );
  const out: string[] = [];
  for (const threadId of threads) {
    const latest = (must(
      await db()
        .from("emails")
        .select("id,direction,sent_at,clients!emails_client_fk(ignored)")
        .eq("account_id", accountId)
        .eq("gmail_thread_id", threadId)
        .order("sent_at", { ascending: false })
        .limit(1),
    ) as unknown as { id: string; direction: string; sent_at: string; clients: { ignored: boolean } | null }[])[0];
    if (!latest || latest.direction !== "inbound") continue;
    if (latest.clients?.ignored) continue;
    if (new Date(latest.sent_at).getTime() < cutoff) continue;
    const open = must(
      await db().from("drafts").select("id").eq("account_id", accountId).eq("email_id", latest.id).in("status", ["pending", "revised"]).limit(1),
    ) as { id: string }[];
    if (open.length) continue;
    await supersedeThreadDrafts(accountId, threadId, latest.sent_at, latest.id);
    out.push(latest.id);
  }
  return out;
}

async function ingestIds(accountId: string, ids: string[], myEmail: string) {
  const gmail = gmailFor(accountId);
  const results: IngestResult[] = [];
  const messages: GmailMessage[] = [];
  for (const id of ids) {
    try {
      messages.push(await gmail.getMessage(id));
    } catch (e) {
      if ((e as { status?: number }).status === 404) continue; // deleted since
      throw e;
    }
  }
  messages.sort((a, b) => Number(a.internalDate) - Number(b.internalDate));
  for (const m of messages) results.push(await ingestMessage(accountId, m, myEmail));
  return results;
}

/** Initial / manual import for one account: recent inbox + sent mail. Returns email ids that need drafts. */
export async function syncRecent(accountId: string, days = 14, max = 150) {
  const acct = await getAccount(accountId);
  const gmail = gmailFor(accountId);
  const profile = await gmail.profile();
  if (profile.emailAddress.toLowerCase() !== acct.email_address) {
    throw new Error(`Token for ${acct.email_address} belongs to ${profile.emailAddress}; refusing to sync.`);
  }
  const ids = await gmail.listMessageIds(`newer_than:${days}d -in:chats -in:drafts -in:spam -in:trash`, max);
  const results = await ingestIds(accountId, ids.map((m) => m.id), acct.email_address);
  await db()
    .from("gmail_accounts")
    .update({ history_id: acct.history_id ?? profile.historyId, last_synced_at: new Date().toISOString(), last_error: null })
    .eq("id", accountId);
  return { results, draftEmailIds: await pickDraftCandidates(accountId, results) };
}

/** Incremental sync for one account using Gmail history (push webhook, cron and "Sync now"). */
export async function syncHistory(accountId: string) {
  const acct = await getAccount(accountId);
  if (!acct.connected) throw new Error(`${acct.email_address} is disconnected.`);
  if (!acct.history_id) return syncRecent(accountId);
  let added: { ids: string[]; historyId: string };
  try {
    added = await gmailFor(accountId).historyAdded(acct.history_id);
  } catch (e) {
    if ((e as { status?: number }).status === 404) {
      // History id expired (~1 week); restart from a fresh window.
      await db().from("gmail_accounts").update({ history_id: null }).eq("id", accountId);
      return syncRecent(accountId, 7);
    }
    throw e;
  }
  const results = await ingestIds(accountId, added.ids, acct.email_address);
  await db()
    .from("gmail_accounts")
    .update({ history_id: added.historyId, last_synced_at: new Date().toISOString(), last_error: null })
    .eq("id", accountId);
  return { results, draftEmailIds: await pickDraftCandidates(accountId, results) };
}
