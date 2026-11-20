import "server-only";
import { db, must } from "./db";
import { gmailFor, getAccount } from "./google";
import { ingestMessage } from "./ingest";
import { listAttachments, type AttachmentMeta, type GmailMessage } from "./email-parse";
import { attachmentsColumnReady } from "./schema-ready";
import { agentTablesReady, getChecklist, missingFor, quoteForThread, STAGE_LABEL, type Stage } from "./quotes";
import { answerFor } from "./quote-rules";
import { goodshuffleProjectUrl, projectIdsInSubject } from "./goodshuffle";

// The thread side panel: one customer conversation in full, opened from anywhere on the dashboard.
// Everything here is read-only and scoped to one account. Gmail is only read (threads.get,
// messages.get, attachments.get in lib/gmail-policy.ts).

export interface ThreadMessage {
  id: string;
  gmailMessageId: string;
  direction: "inbound" | "outbound";
  fromName: string | null;
  fromAddress: string;
  sentAt: string;
  body: string;
  attachments: AttachmentMeta[];
}

export interface ThreadView {
  emailId: string;
  threadId: string;
  subject: string;
  client: { id: string; name: string | null; email: string; phone: string | null } | null;
  messages: ThreadMessage[];
  /** False when Gmail couldn't be reached just now; the stored emails are shown. */
  fullHistory: boolean;
  otherThreads: { emailId: string; subject: string; sentAt: string; count: number }[];
  quote: {
    id: string;
    stage: Stage;
    stageLabel: string;
    title: string | null;
    info: { label: string; value: string }[];
    missing: string[];
    items: { name: string; quantity?: number | string | null; note?: string | null }[];
    notes: string | null;
    goodshuffleUrl: string | null;
  } | null;
  goodshuffleUrl: string | null;
  draft: { id: string; body: string; status: string } | null;
  replyTo: string;
}

type EmailRow = {
  id: string;
  gmail_message_id: string;
  gmail_thread_id: string;
  direction: "inbound" | "outbound";
  from_name: string | null;
  from_address: string;
  subject: string | null;
  body: string | null;
  sent_at: string;
  client_id: string | null;
  attachments?: AttachmentMeta[] | null;
};

/** Pull every message of a Gmail thread into the dashboard (earlier ones go in as already-read history). */
async function backfillThread(accountId: string, threadId: string, myEmail: string) {
  const thread = await gmailFor(accountId).getThread(threadId);
  const messages = thread.messages ?? [];
  for (const msg of messages) {
    // Adds only what's missing; nothing is drafted for history (only a thread's newest email gets a draft).
    await ingestMessage(accountId, msg, myEmail, { historical: true }).catch((e) =>
      console.error("thread backfill: one message failed", accountId, msg.id, e),
    );
  }
  return messages;
}

export async function loadThreadView(accountId: string, emailId: string): Promise<ThreadView | null> {
  const withAttachments = await attachmentsColumnReady();
  const cols = `id,gmail_message_id,gmail_thread_id,direction,from_name,from_address,subject,body,sent_at,client_id${withAttachments ? ",attachments" : ""}`;
  const first = (must(await db().from("emails").select(cols).eq("account_id", accountId).eq("id", emailId).limit(1)) as unknown as EmailRow[])[0];
  if (!first) return null;
  const threadId = first.gmail_thread_id;

  // Full history from Gmail (and the files on each message). If Gmail is busy, show what's stored.
  let live: GmailMessage[] = [];
  let fullHistory = true;
  try {
    const acct = await getAccount(accountId);
    live = await backfillThread(accountId, threadId, acct.email_address);
  } catch (e) {
    fullHistory = false;
    console.error("thread panel: Gmail thread read failed", accountId, threadId, e);
  }
  const liveFiles = new Map(live.map((m) => [m.id, listAttachments(m)]));

  const rows = must(
    await db().from("emails").select(cols).eq("account_id", accountId).eq("gmail_thread_id", threadId).order("sent_at", { ascending: true }),
  ) as unknown as EmailRow[];

  const clientId = rows.find((r) => r.client_id)?.client_id ?? first.client_id;
  const client = clientId
    ? ((must(await db().from("clients").select("id,name,email,phone").eq("account_id", accountId).eq("id", clientId).limit(1)) as ThreadView["client"][])[0] ?? null)
    : null;

  // The customer's other conversations (any age), newest first.
  const others = clientId
    ? (must(
        await db()
          .from("emails")
          .select("id,gmail_thread_id,subject,sent_at")
          .eq("account_id", accountId)
          .eq("client_id", clientId)
          .neq("gmail_thread_id", threadId)
          .order("sent_at", { ascending: false })
          .limit(300),
      ) as { id: string; gmail_thread_id: string; subject: string | null; sent_at: string }[])
    : [];
  const grouped = new Map<string, { emailId: string; subject: string; sentAt: string; count: number }>();
  for (const o of others) {
    const g = grouped.get(o.gmail_thread_id);
    if (g) g.count++;
    else grouped.set(o.gmail_thread_id, { emailId: o.id, subject: o.subject || "(no subject)", sentAt: o.sent_at, count: 1 });
  }

  let quote: ThreadView["quote"] = null;
  if (await agentTablesReady(accountId)) {
    const q = await quoteForThread(accountId, threadId);
    if (q) {
      const checklist = await getChecklist();
      const info = checklist
        .map((c) => ({ label: c.label, value: answerFor(q.info ?? {}, c.key) }))
        .filter((c) => c.value.trim());
      quote = {
        id: q.id,
        stage: q.stage,
        stageLabel: STAGE_LABEL[q.stage],
        title: q.title,
        info,
        missing: missingFor(q, checklist).map((m) => m.label),
        items: q.items ?? [],
        notes: q.notes,
        goodshuffleUrl: q.goodshuffle_url,
      };
    }
  }

  const subject = rows.find((r) => r.subject)?.subject ?? first.subject ?? "(no subject)";
  const gspId = rows.map((r) => projectIdsInSubject(r.subject ?? "")[0]).find(Boolean);
  const goodshuffleUrl = quote?.goodshuffleUrl ?? (gspId ? goodshuffleProjectUrl(gspId) : null);

  // The open draft on this thread's newest customer email, if any.
  const latestInbound = [...rows].reverse().find((r) => r.direction === "inbound");
  const draft = latestInbound
    ? ((must(
        await db()
          .from("drafts")
          .select("id,body,status")
          .eq("account_id", accountId)
          .eq("email_id", latestInbound.id)
          .in("status", ["pending", "sending"])
          .order("version", { ascending: false })
          .limit(1),
      ) as { id: string; body: string; status: string }[])[0] ?? null)
    : null;

  return {
    emailId,
    threadId,
    subject,
    client,
    fullHistory,
    messages: rows.map((r) => ({
      id: r.id,
      gmailMessageId: r.gmail_message_id,
      direction: r.direction,
      fromName: r.from_name,
      fromAddress: r.from_address,
      sentAt: r.sent_at,
      body: r.body ?? "",
      attachments: liveFiles.get(r.gmail_message_id) ?? r.attachments ?? [],
    })),
    otherThreads: [...grouped.values()],
    quote,
    goodshuffleUrl,
    draft,
    replyTo: latestInbound?.from_address ?? client?.email ?? "",
  };
}
