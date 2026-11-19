// Pure helpers for parsing Gmail API messages and building replies. No server deps (unit-testable).

export interface GmailHeader { name: string; value: string }
export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
}
export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export function header(msg: GmailMessage | GmailPart, name: string): string {
  const headers = "payload" in msg ? msg.payload?.headers : (msg as GmailPart).headers;
  const h = headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? "";
}

export function decodeB64Url(data: string): string {
  return Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
}

export function encodeB64Url(data: string): string {
  return Buffer.from(data, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Parse `"Jane Doe" <jane@x.com>, bob@y.com` into address objects. */
export function parseAddressList(value: string): { name: string; email: string }[] {
  if (!value) return [];
  const out: { name: string; email: string }[] = [];
  // Split on commas that are not inside quotes.
  const parts = value.match(/(?:"[^"]*"|[^,])+/g) ?? [];
  for (const raw of parts) {
    const p = raw.trim();
    if (!p) continue;
    const m = p.match(/^(.*?)<([^>]+)>\s*$/);
    if (m) {
      out.push({ name: m[1].trim().replace(/^"|"$/g, "").trim(), email: m[2].trim().toLowerCase() });
    } else if (p.includes("@")) {
      out.push({ name: "", email: p.replace(/^"|"$/g, "").trim().toLowerCase() });
    }
  }
  return out;
}

export function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|blockquote)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function findPart(part: GmailPart | undefined, mime: string): GmailPart | undefined {
  if (!part) return undefined;
  if (part.mimeType === mime && part.body?.data && !part.filename) return part;
  for (const p of part.parts ?? []) {
    const f = findPart(p, mime);
    if (f) return f;
  }
  return undefined;
}

/** Best plain-text body of a message (text/plain preferred, else converted HTML). */
export function extractBody(msg: GmailMessage): string {
  const plain = findPart(msg.payload, "text/plain");
  if (plain?.body?.data) return decodeB64Url(plain.body.data).replace(/\r\n/g, "\n");
  const html = findPart(msg.payload, "text/html");
  if (html?.body?.data) return htmlToText(decodeB64Url(html.body.data));
  return msg.snippet ?? "";
}

/** Remove quoted reply history ("On … wrote:", "> " lines, Outlook headers) and trailing whitespace. */
export function stripQuoted(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Gmail/Apple: "On Mon, Nov 3, 2026 at 9:14 AM Jane <jane@x.com> wrote:" (sometimes wrapped onto 2 lines)
    if (/^On\s/.test(line.trim())) {
      const joined = `${line.trim()} ${(lines[i + 1] ?? "").trim()}`;
      if (/wrote:\s*$/.test(line.trim()) || /wrote:\s*$/.test(joined)) break;
    }
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(line.trim())) break;
    if (/^_{10,}$/.test(line.trim()) && /^From:/i.test((lines[i + 1] ?? "").trim())) break;
    if (/^From:\s.+/i.test(line.trim()) && /^(Sent|Date):\s/i.test((lines[i + 1] ?? "").trim())) break;
    if (/^>/.test(line)) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function encodeHeaderValue(v: string): string {
  // RFC 2047 encoded-word for non-ASCII header values (e.g. subjects with accents/emoji).
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}

export function replySubject(subject: string): string {
  const s = subject.trim() || "(no subject)";
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/** Build a raw RFC 822 reply, base64url-encoded for gmail.users.messages.send. */
export function buildReplyRaw(opts: {
  from: string;
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const headers = [
    `From: ${opts.from}`,
    `To: ${opts.to}`,
    `Subject: ${encodeHeaderValue(replySubject(opts.subject))}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
  ];
  if (opts.inReplyTo) {
    headers.push(`In-Reply-To: ${opts.inReplyTo}`);
    headers.push(`References: ${[opts.references, opts.inReplyTo].filter(Boolean).join(" ")}`);
  }
  const bodyB64 = Buffer.from(opts.body.replace(/\r?\n/g, "\r\n"), "utf8")
    .toString("base64")
    .replace(/.{76}/g, "$&\r\n");
  return encodeB64Url(`${headers.join("\r\n")}\r\n\r\n${bodyB64}`);
}

/**
 * Does the email mention this project number? Matches "#1042", "project 1042", "job no. 1042",
 * "order #1042", "quote 1042", "invoice 1042", or the bare number in the subject. Avoids matching
 * prices, quantities and longer numbers ("$1042", "1042 chairs" in the body, "21042").
 */
export function mentionsProjectNumber(subject: string, body: string, projectNumber: string): boolean {
  const n = projectNumber.trim().replace(/^#/, "");
  if (n.length < 3) return false;
  const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const labelled = new RegExp(
    `(?:#\\s?|\\b(?:project|job|order|quote|invoice|event)\\s*(?:no\\.?|number|num|#)?\\s*:?\\s*#?)${esc}(?![\\w-])`,
    "i",
  );
  const inSubject = new RegExp(`(?<![\\w$#.-])${esc}(?![\\w-]|\\.\\d)`, "i");
  return labelled.test(subject) || labelled.test(body) || inSubject.test(subject);
}

// ---------- Who an inbound email is really from ----------

/** Gmail tabs that are marketing, never client mail. (Updates is allowed: form notifications land there.) */
const MARKETING_LABELS = ["CATEGORY_PROMOTIONS", "CATEGORY_SOCIAL", "CATEGORY_FORUMS"];
const AUTOMATED_SENDER = /(no-?reply|do-?not-?reply|mailer-daemon|postmaster|notifications?@|bounce)/i;
const domainOf = (email: string) => email.split("@")[1] ?? "";

// ---------- Mail the team asked not to see ----------

/** Goodshuffle Pro's "New Wish List Submission" notices. Leo doesn't want them shown or drafted (Nov 19). */
export const WISH_LIST_SUBJECT = /new\s+wish\s*list\s+submission/i;
/** The same, for a database filter on the stored subject (stored copies don't keep the Goodshuffle sender). */
export const WISH_LIST_SUBJECT_ILIKE = "%wish%list%submission%";

/**
 * A stored email that is one of those notices. Stored copies show the customer as the sender, so this
 * goes by the subject alone, and a reply or forward ("Re: New Wish List Submission") from a real
 * customer still counts as client mail.
 */
export function isWishListNoticeSubject(subject: string | null | undefined): boolean {
  const s = (subject ?? "").trim();
  return WISH_LIST_SUBJECT.test(s) && !/^(re|fw|fwd|aw)\s*:/i.test(s);
}

/** The skip reason for those notices (ingest keeps their project links; lib/goodshuffle-link.ts). */
export const GOODSHUFFLE_WISH_LIST_SKIP = "goodshuffle wish list";

export function isGoodshuffleWishList(msg: GmailMessage): boolean {
  if (!WISH_LIST_SUBJECT.test(header(msg, "Subject"))) return false;
  const senders = [...parseAddressList(header(msg, "From")), ...parseAddressList(header(msg, "Sender"))];
  return senders.some((a) => /goodshuffle/i.test(a.email) || /goodshuffle/i.test(a.name));
}

export type InboundContact =
  | { skip: string }
  | { contact: { name: string; email: string }; viaForm: boolean };

/**
 * Decide whether an inbound email is client mail, and who the client is.
 *
 * - Normal mail from a person: the sender is the client.
 * - Website form notifications ("New Form Submitted") and chat-bot transcripts come from a
 *   no-reply / notifications address with the customer in Reply-To. The customer is the client
 *   (approved replies already go to Reply-To). Counted only when the Reply-To person is on a
 *   different domain from the sender and from this inbox, so a company's own notifications and
 *   newsletters (which reply to themselves) are still skipped.
 * - Everything else automated (Promotions/Social/Forums tabs, no-reply senders, mailing lists) is skipped.
 */
export function inboundContact(msg: GmailMessage, myEmail: string): InboundContact {
  const from = parseAddressList(header(msg, "From"))[0];
  if (!from) return { skip: "no sender" };
  if (isGoodshuffleWishList(msg)) return { skip: GOODSHUFFLE_WISH_LIST_SKIP };
  const labels = msg.labelIds ?? [];
  if (labels.some((l) => MARKETING_LABELS.includes(l))) return { skip: "bulk/automated" };

  const automated =
    labels.includes("CATEGORY_UPDATES") || AUTOMATED_SENDER.test(from.email) || !!header(msg, "List-Unsubscribe");
  if (!automated) return { contact: from, viaForm: false };

  const me = myEmail.toLowerCase();
  const replyTo = parseAddressList(header(msg, "Reply-To"))[0];
  const isCustomer =
    !!replyTo &&
    replyTo.email !== from.email &&
    replyTo.email !== me &&
    !AUTOMATED_SENDER.test(replyTo.email) &&
    domainOf(replyTo.email) !== domainOf(from.email) &&
    domainOf(replyTo.email) !== domainOf(me);
  return isCustomer ? { contact: replyTo, viaForm: true } : { skip: "bulk/automated" };
}
