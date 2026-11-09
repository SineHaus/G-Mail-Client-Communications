import "server-only";
import { db, must } from "./db";
import { Gmail, getAccount } from "./google";
import { buildReplyRaw, header, parseAddressList } from "./email-parse";
import { ingestMessage } from "./ingest";

/**
 * Accept: send the draft through Gmail (users.messages.send) as a reply in the same thread
 * (threadId + In-Reply-To/References). This is the ONLY code path that sends email, and sending
 * is the only change this app ever makes to the Gmail account — no labels are touched.
 */
export async function acceptDraft(draftId: string, finalBody?: string) {
  const draft = must(await db().from("drafts").select("*").eq("id", draftId).single()) as {
    id: string;
    email_id: string;
    body: string;
    status: string;
  };
  const body = (finalBody ?? draft.body).trim();
  if (!body) throw new Error("The draft is empty.");

  // Claim the draft first so a double-click can't send twice.
  const claimed = must(
    await db()
      .from("drafts")
      .update({ status: "accepted", body, error: null, updated_at: new Date().toISOString() })
      .eq("id", draftId)
      .in("status", ["pending", "revised"])
      .select("id"),
  ) as { id: string }[];
  if (!claimed.length) throw new Error("This draft was already handled.");

  try {
    const email = must(await db().from("emails").select("*").eq("id", draft.email_id).single()) as {
      gmail_message_id: string;
      gmail_thread_id: string;
      subject: string | null;
    };
    const acct = await getAccount();
    const orig = await Gmail.getMessageHeaders(email.gmail_message_id);
    const replyTo = parseAddressList(header(orig, "Reply-To"))[0] ?? parseAddressList(header(orig, "From"))[0];
    if (!replyTo) throw new Error("Couldn't find the client's address on the original email.");
    const msgId = header(orig, "Message-ID") || header(orig, "Message-Id");
    const senderName = process.env.SENDER_NAME ?? "Leonel - The Event Rental Guys";

    const raw = buildReplyRaw({
      from: `"${senderName}" <${acct.email}>`,
      to: replyTo.name ? `"${replyTo.name.replace(/"/g, "")}" <${replyTo.email}>` : replyTo.email,
      subject: header(orig, "Subject") || email.subject || "",
      body,
      inReplyTo: msgId || undefined,
      references: header(orig, "References") || undefined,
    });
    const sent = await Gmail.send(raw, email.gmail_thread_id);
    await db().from("drafts").update({ sent_gmail_message_id: sent.id }).eq("id", draftId);
    await db().from("emails").update({ is_read: true }).eq("id", draft.email_id); // dashboard-only read state

    // Store the sent message right away so it appears in the client's history.
    try {
      await ingestMessage(await Gmail.getMessage(sent.id), acct.email);
    } catch (e) {
      console.error("Sent OK but failed to record sent message (webhook will catch it)", e);
    }
    return { gmailMessageId: sent.id };
  } catch (e) {
    await db()
      .from("drafts")
      .update({ status: "pending", error: `Send failed: ${e instanceof Error ? e.message : e}` })
      .eq("id", draftId);
    throw e;
  }
}
