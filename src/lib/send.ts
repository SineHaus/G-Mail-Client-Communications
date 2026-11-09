import "server-only";
import { db, must } from "./db";
import { gmailFor, getAccount } from "./google";
import { buildReplyRaw, header, parseAddressList } from "./email-parse";
import { ingestMessage } from "./ingest";

/**
 * Accept: send the draft through Gmail (users.messages.send) FROM THE ACCOUNT THAT RECEIVED THE
 * ORIGINAL EMAIL, as a reply in the same thread (threadId + In-Reply-To/References).
 * This is the ONLY code path that sends email, and sending is the only change this app ever
 * makes to a Gmail account — no labels or read/unread status are touched.
 */
export async function acceptDraft(accountId: string, draftId: string, finalBody?: string) {
  const draft = must(
    await db().from("drafts").select("*").eq("account_id", accountId).eq("id", draftId).maybeSingle(),
  ) as { id: string; account_id: string; email_id: string; body: string; status: string } | null;
  if (!draft) throw new Error("Draft not found in this account.");
  const body = (finalBody ?? draft.body).trim();
  if (!body) throw new Error("The draft is empty.");

  // The original email, from the SAME account (the composite FK guarantees they match).
  const email = must(
    await db().from("emails").select("*").eq("account_id", draft.account_id).eq("id", draft.email_id).single(),
  ) as { id: string; account_id: string; gmail_message_id: string; gmail_thread_id: string; subject: string | null };
  const acct = await getAccount(email.account_id);
  if (!acct.connected) throw new Error(`${acct.email_address} is disconnected. Reconnect it in Settings to send.`);

  // Claim the draft first so a double-click can't send twice.
  const claimed = must(
    await db()
      .from("drafts")
      .update({ status: "accepted", body, error: null, updated_at: new Date().toISOString() })
      .eq("account_id", accountId)
      .eq("id", draftId)
      .in("status", ["pending", "revised"])
      .select("id"),
  ) as { id: string }[];
  if (!claimed.length) throw new Error("This draft was already handled.");

  try {
    const gmail = gmailFor(email.account_id);
    const orig = await gmail.getMessageHeaders(email.gmail_message_id);
    const replyTo = parseAddressList(header(orig, "Reply-To"))[0] ?? parseAddressList(header(orig, "From"))[0];
    if (!replyTo) throw new Error("Couldn't find the client's address on the original email.");
    const msgId = header(orig, "Message-ID") || header(orig, "Message-Id");
    const senderName = acct.display_name && acct.display_name !== acct.email_address
      ? acct.display_name
      : process.env.SENDER_NAME ?? "Leonel - The Event Rental Guys";

    const raw = buildReplyRaw({
      from: `"${senderName.replace(/"/g, "")}" <${acct.email_address}>`,
      to: replyTo.name ? `"${replyTo.name.replace(/"/g, "")}" <${replyTo.email}>` : replyTo.email,
      subject: header(orig, "Subject") || email.subject || "",
      body,
      inReplyTo: msgId || undefined,
      references: header(orig, "References") || undefined,
    });
    const sent = await gmail.send(raw, email.gmail_thread_id);
    await db().from("drafts").update({ sent_gmail_message_id: sent.id }).eq("account_id", accountId).eq("id", draftId);
    await db().from("emails").update({ is_read: true }).eq("account_id", accountId).eq("id", email.id); // dashboard-only read state

    // Store the sent message right away so it appears in the client's history.
    try {
      await ingestMessage(email.account_id, await gmail.getMessage(sent.id), acct.email_address);
    } catch (e) {
      console.error("Sent OK but failed to record sent message (webhook will catch it)", e);
    }
    return { gmailMessageId: sent.id };
  } catch (e) {
    await db()
      .from("drafts")
      .update({ status: "pending", error: `Send failed: ${e instanceof Error ? e.message : e}` })
      .eq("account_id", accountId)
      .eq("id", draftId);
    throw e;
  }
}
