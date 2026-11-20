// Goodshuffle Pro messages: the rules for reading what the Chrome extension sends, and for the reply text.
// Pure module (unit-tested in goodshuffle-messages.test.ts). The extension lives in extensions/goodshuffle-messages.

/** The only Goodshuffle login the extension may read or send as (Leo's rule, Nov 20). */
export const GSP_SUPPORT_LOGIN = "support@theeventrentalguys.com";

export const isSupportLogin = (email: unknown) => typeof email === "string" && email.trim().toLowerCase() === GSP_SUPPORT_LOGIN;

/** A conversation in Goodshuffle Pro's Messages window. */
export const gspMessagesUrl = (projectId: string) => `https://pro.goodshuffle.com/ui/message/inbox/${encodeURIComponent(projectId)}`;

/** A Goodshuffle project id: digits only (e.g. 232040555). */
export const isProjectId = (v: unknown): v is string => typeof v === "string" && /^\d{4,12}$/.test(v);

export type GspMessageRow = {
  gsp_message_id: string;
  gsp_project_id: string;
  gsp_conversation_id: string | null;
  direction: "inbound" | "outbound" | "system";
  sender_name: string | null;
  sender_email: string | null;
  subject: string | null;
  body: string;
  sent_at: string;
};

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.slice(0, max) : v == null ? null : String(v).slice(0, max));

/** Goodshuffle's messageText is HTML from its editor; keep the words and line breaks only. */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|h\d)\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * One message from Goodshuffle's getMessagesForTransaction (client conversation) → a row to store.
 * Returns null for anything that doesn't look like a message, so a changed Goodshuffle format is skipped,
 * not stored half-read.
 */
export function readGspMessage(projectId: string, raw: unknown): GspMessageRow | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  const id = m.id == null ? "" : String(m.id);
  const date = typeof m.date === "string" || typeof m.date === "number" ? new Date(m.date) : null;
  if (!id || !date || Number.isNaN(date.getTime()) || !isProjectId(projectId)) return null;
  const sender = (m.sender && typeof m.sender === "object" ? m.sender : {}) as Record<string, unknown>;
  const conversation = (m.conversation && typeof m.conversation === "object" ? m.conversation : {}) as Record<string, unknown>;
  const fromUs = m.fromCurrentUser === true || sender.isCurrentUser === true || (sender.contactID == null && sender.id != null);
  const direction = m.eventType === "SYSTEM_ACTION" ? "system" : fromUs ? "outbound" : "inbound";
  return {
    gsp_message_id: id.slice(0, 64),
    gsp_project_id: projectId,
    gsp_conversation_id: conversation.id == null ? null : String(conversation.id).slice(0, 64),
    direction,
    sender_name: str(sender.fullName, 200),
    sender_email: str(sender.email, 200),
    subject: str(m.subject, 500),
    body: htmlToText(typeof m.messageText === "string" ? m.messageText : "").slice(0, 20_000),
    sent_at: date.toISOString(),
  };
}

/** The customer message a reply should answer: the newest message, if it's from the customer. */
export function needsReply(messages: Pick<GspMessageRow, "gsp_message_id" | "direction" | "sent_at">[]): string | null {
  const real = messages.filter((m) => m.direction !== "system").sort((a, b) => b.sent_at.localeCompare(a.sent_at));
  return real[0]?.direction === "inbound" ? real[0].gsp_message_id : null;
}

/**
 * Goodshuffle adds Leo's signature under the reply box by itself, so the reply we type has none.
 * Removes a trailing sign-off ("Leonel" / "The Event Rental Guys", with "Thanks," or "Best," before it).
 */
export function stripSignOff(text: string): string {
  const lines = text.trim().split("\n");
  const signOff = /^(leonel|leo|the event rental guys|terg|thanks!?,?|thank you!?,?|best,?|best regards,?|regards,?|cheers,?|-+)$/i;
  while (lines.length > 1 && (signOff.test(lines[lines.length - 1].trim()) || !lines[lines.length - 1].trim())) lines.pop();
  return lines.join("\n").trim();
}

/** Same words, ignoring spacing: used by the extension to check the reply box holds exactly the approved text. */
export const sameText = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();
