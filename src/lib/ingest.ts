import "server-only";
import { db, must } from "./db";
import { env } from "./env";
import { GmailRateLimitError, gmailFor, getAccount, sleep } from "./google";
import { GOODSHUFFLE_WISH_LIST_SKIP, extractBody, header, inboundContact, listAttachments, mentionsProjectNumber, parseAddressList, stripQuoted, type GmailMessage } from "./email-parse";
import { attachmentsColumnReady } from "./schema-ready";
import { saveWishlistNotice } from "./goodshuffle-link";
import { audit } from "./audit";

// Every function here works on ONE Gmail account and scopes every query by account_id.

const SKIP_LABELS = ["DRAFT", "SPAM", "TRASH", "CHAT"];

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
export async function ingestMessage(
  accountId: string,
  msg: GmailMessage,
  myEmail: string,
  opts: { historical?: boolean } = {},
): Promise<IngestResult> {
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
  // For website form notifications the customer (Reply-To) is shown as the sender, not the no-reply address.
  let shownFrom = from;
  if (direction === "inbound") {
    const who = inboundContact(msg, myEmail);
    if ("skip" in who) {
      // Goodshuffle's wishlist notices stay out of the queue, but their project links are kept for the cards.
      if (who.skip === GOODSHUFFLE_WISH_LIST_SKIP) {
        await saveWishlistNotice(accountId, msg, myEmail).catch((e) => console.error("keeping wishlist notice failed", accountId, e));
      }
      return { status: "skipped", reason: who.skip };
    }
    counterpart = who.contact;
    shownFrom = who.contact;
  } else {
    counterpart = [...parseAddressList(header(msg, "To")), ...parseAddressList(header(msg, "Cc"))].find(
      (a) => a.email !== me,
    );
    if (!counterpart) return { status: "skipped", reason: "note to self" };
  }

  const client = await findOrCreateClient(accountId, counterpart.email, counterpart.name);

  // New messages inherit the project already linked to their thread (same account only)…
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
  const subject = header(msg, "Subject");
  const body = stripQuoted(extractBody(msg));
  // …otherwise auto-link by a project number in the email, or the client's only open project.
  let projectId: string | null = threadProject[0]?.project_id ?? null;
  let autoLinked: string | null = null;
  if (!projectId) {
    const found = await autoLinkProject(subject, body, client.id);
    if (found) {
      projectId = found.id;
      autoLinked = found.reason;
    }
  }
  const row = {
    account_id: accountId,
    gmail_message_id: msg.id,
    gmail_thread_id: msg.threadId,
    message_id_header: header(msg, "Message-ID") || header(msg, "Message-Id") || null,
    client_id: client.id,
    project_id: projectId,
    direction,
    from_address: shownFrom.email,
    from_name: shownFrom.name || null,
    to_addresses: header(msg, "To"),
    subject,
    body,
    snippet: msg.snippet ?? null,
    sent_at: sentAt,
    // Read/unread is tracked only in Supabase. Gmail's UNREAD label is never read from or written to.
    // Earlier emails pulled in for a thread's full history are history, not new mail.
    is_read: opts.historical ? true : direction === "outbound",
    ...((await attachmentsColumnReady()) ? { attachments: listAttachments(msg) } : {}),
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

  const emailId = (ins.data as { id: string }).id;
  if (autoLinked) {
    // Link the rest of the thread too (same account only).
    await db()
      .from("emails")
      .update({ project_id: projectId })
      .eq("account_id", accountId)
      .eq("gmail_thread_id", msg.threadId)
      .is("project_id", null);
    await audit("system", "auto_linked_project", { accountId, emailId, detail: autoLinked });
  }

  // A reply was sent from this mailbox (in Gmail, or from here) → open drafts for earlier emails are done.
  if (direction === "outbound" && !opts.historical) await closeThreadDrafts(accountId, msg.threadId, sentAt);

  return { status: "inserted", emailId, direction, threadId: msg.threadId, sentAt };
}

/**
 * Auto-link: a project number mentioned in the email ("#1042", "project 1042", or the number in the
 * subject), else the client's only open project. Projects are shared across TERG.
 */
export async function autoLinkProject(subject: string, body: string, clientId: string): Promise<{ id: string; reason: string } | null> {
  // isolation-exempt: matching numbers against every TERG project is the point of auto-linking; nothing
  // here is shown to anyone, and linking an email of this account makes that project visible to it.
  const projects = must(await db().from("projects").select("id,project_number,client_id,status")) as {
    id: string;
    project_number: string;
    client_id: string | null;
    status: string;
  }[];
  const hit = projects.find((p) => mentionsProjectNumber(subject, body, p.project_number));
  if (hit) return { id: hit.id, reason: `project #${hit.project_number} mentioned in the email` };
  const open = projects.filter((p) => p.client_id === clientId && (p.status === "inquiry" || p.status === "booked"));
  if (open.length === 1) return { id: open[0].id, reason: `client's only open project #${open[0].project_number}` };
  return null;
}

/** A replied-to thread: open drafts on earlier emails are closed as "handled outside the dashboard". */
async function closeThreadDrafts(accountId: string, threadId: string, before: string) {
  const earlier = must(
    await db().from("emails").select("id").eq("account_id", accountId).eq("gmail_thread_id", threadId).lt("sent_at", before),
  ) as { id: string }[];
  if (!earlier.length) return;
  await db()
    .from("drafts")
    .update({ status: "declined", decided_by: "replied in Gmail", decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("account_id", accountId)
    .in("email_id", earlier.map((e) => e.id))
    .eq("status", "pending");
}

/** Mark open drafts on emails in a thread sent before `before` as superseded (a newer email arrived). */
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
    .eq("status", "pending");
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
      await db().from("drafts").select("id").eq("account_id", accountId).eq("email_id", latest.id).in("status", ["pending", "sending"]).limit(1),
    ) as { id: string }[];
    if (open.length) continue;
    await supersedeThreadDrafts(accountId, threadId, latest.sent_at, latest.id);
    out.push(latest.id);
  }
  return out;
}

/**
 * Pause between message fetches. Each fetch costs 5 of the mailbox's 6,000 Gmail quota units per
 * minute; at this pace an import uses under half of that, leaving room for Sync now, push and sends.
 */
const FETCH_PACE_MS = 120;

/**
 * Fetch and store messages in the order given (oldest first), one at a time, so an import that is
 * cut short keeps everything it already stored. Messages already stored are not fetched again.
 * A Gmail rate limit that outlasts the retries stops the import early instead of failing it.
 */
async function ingestIds(accountId: string, ids: string[], myEmail: string) {
  const gmail = gmailFor(accountId);
  const known = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const rows = must(
      await db().from("emails").select("gmail_message_id").eq("account_id", accountId).in("gmail_message_id", ids.slice(i, i + 200)),
    ) as { gmail_message_id: string }[];
    for (const r of rows) known.add(r.gmail_message_id);
  }
  const results: IngestResult[] = [];
  let stoppedEarly: string | null = null;
  for (const id of ids) {
    if (known.has(id)) continue;
    let msg: GmailMessage;
    try {
      msg = await gmail.getMessage(id);
    } catch (e) {
      if ((e as { status?: number }).status === 404) continue; // deleted since
      if (e instanceof GmailRateLimitError) {
        stoppedEarly = e.message;
        break;
      }
      throw e;
    }
    results.push(await ingestMessage(accountId, msg, myEmail));
    await sleep(FETCH_PACE_MS);
  }
  return { results, stoppedEarly };
}

/**
 * Initial / manual import for one account: recent inbox + sent mail. Returns email ids that need
 * drafts, and `stoppedEarly` (a message) if Gmail's rate limit cut it short; running it again resumes.
 */
export async function syncRecent(accountId: string, days = 14, max = 150) {
  const acct = await getAccount(accountId);
  const gmail = gmailFor(accountId);
  const profile = await gmail.profile();
  if (profile.emailAddress.toLowerCase() !== acct.email_address) {
    throw new Error(`Token for ${acct.email_address} belongs to ${profile.emailAddress}; refusing to sync.`);
  }
  const ids = await gmail.listMessageIds(`newer_than:${days}d -in:chats -in:drafts -in:spam -in:trash`, max);
  // Gmail lists newest first; store oldest first so threads build up in order.
  const { results, stoppedEarly } = await ingestIds(accountId, ids.map((m) => m.id).reverse(), acct.email_address);
  await db()
    .from("gmail_accounts")
    // A cut-short first import leaves history_id empty, so the next check runs this import again (and resumes).
    .update({
      history_id: acct.history_id ?? (stoppedEarly ? null : profile.historyId),
      last_synced_at: new Date().toISOString(),
      last_error: null,
    })
    .eq("id", accountId);
  return { results, stoppedEarly, draftEmailIds: await pickDraftCandidates(accountId, results) };
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
  const { results, stoppedEarly } = await ingestIds(accountId, added.ids, acct.email_address);
  await db()
    .from("gmail_accounts")
    // Cut short by the rate limit: keep the old history_id so the next check picks up the rest.
    .update({ history_id: stoppedEarly ? acct.history_id : added.historyId, last_synced_at: new Date().toISOString(), last_error: null })
    .eq("id", accountId);
  return { results, stoppedEarly, draftEmailIds: await pickDraftCandidates(accountId, results) };
}
