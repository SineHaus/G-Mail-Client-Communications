import "server-only";
import { db, must } from "./db";
import { gmailFor, getAccount } from "./google";
import { buildReplyRaw, header, parseAddressList } from "./email-parse";
import { ingestMessage } from "./ingest";
import { newDraftVersion } from "./drafts";
import { audit } from "./audit";

/**
 * Approve: send EXACTLY the version shown on screen through Gmail (users.messages.send), from the
 * account that received the original email, as a reply in the same thread.
 *
 * - `shownDraftId` is the version the person was looking at. If it's no longer the open version, refuse.
 * - If they edited the text without saving, it's saved as a new version first and that is what is sent.
 * - The draft is claimed (pending → sending) in one database step, so a double click can't send twice.
 * - The caller has already checked the person may approve on this account (Owner or Approver).
 *
 * This is the ONLY code path that sends email. No Gmail labels or read/unread status are touched.
 */
export async function approveDraft(actor: string, accountId: string, shownDraftId: string, bodyOnScreen: string) {
  const shown = must(
    await db().from("drafts").select("*").eq("account_id", accountId).eq("id", shownDraftId).maybeSingle(),
  ) as { id: string; account_id: string; email_id: string; body: string; status: string; version: number } | null;
  if (!shown) throw new Error("Draft not found in this account.");
  if (shown.status !== "pending") {
    throw new Error(
      shown.status === "superseded"
        ? "A newer version of this draft exists. Reload to see it before approving."
        : "This draft was already handled.",
    );
  }
  const body = bodyOnScreen.trim();
  if (!body) throw new Error("The draft is empty.");

  let draftId = shown.id;
  if (body !== shown.body.trim()) draftId = await newDraftVersion(shown.id, body, actor, null);

  const email = must(
    await db().from("emails").select("*").eq("account_id", accountId).eq("id", shown.email_id).single(),
  ) as { id: string; gmail_message_id: string; gmail_thread_id: string; subject: string | null };
  const acct = await getAccount(accountId);
  if (!acct.connected) throw new Error(`${acct.email_address} is disconnected. Reconnect it in Settings to send.`);

  const claimed = must(
    await db()
      .from("drafts")
      .update({ status: "sending", error: null, decided_by: actor, decided_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("account_id", accountId)
      .eq("id", draftId)
      .eq("status", "pending")
      .select("id"),
  ) as { id: string }[];
  if (!claimed.length) throw new Error("This draft was already handled.");

  try {
    const gmail = gmailFor(accountId);
    const orig = await gmail.getMessageHeaders(email.gmail_message_id);
    const replyTo = parseAddressList(header(orig, "Reply-To"))[0] ?? parseAddressList(header(orig, "From"))[0];
    if (!replyTo) throw new Error("Couldn't find the client's address on the original email.");
    const msgId = header(orig, "Message-ID") || header(orig, "Message-Id");
    const senderName =
      acct.display_name && acct.display_name !== acct.email_address
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
    await db()
      .from("drafts")
      .update({ status: "sent", sent_gmail_message_id: sent.id, updated_at: new Date().toISOString() })
      .eq("account_id", accountId)
      .eq("id", draftId);
    await db().from("emails").update({ is_read: true }).eq("account_id", accountId).eq("id", email.id); // dashboard-only
    await audit(actor, "approved_and_sent", { accountId, draftId, emailId: email.id, detail: `to ${replyTo.email}` });

    try {
      await ingestMessage(accountId, await gmail.getMessage(sent.id), acct.email_address);
    } catch (e) {
      console.error("Sent OK but failed to record sent message (webhook will catch it)", e);
    }
    return { draftId, gmailMessageId: sent.id };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db()
      .from("drafts")
      .update({ status: "pending", decided_by: null, decided_at: null, error: `Send failed: ${msg}` })
      .eq("account_id", accountId)
      .eq("id", draftId);
    await audit(actor, "send_failed", { accountId, draftId, emailId: email.id, detail: msg.slice(0, 300) });
    throw e;
  }
}
