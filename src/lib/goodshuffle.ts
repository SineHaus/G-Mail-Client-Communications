// Goodshuffle Pro project links, read from Goodshuffle's own "New Wishlist Submission" emails.
// Pure helpers (no server deps, unit-testable). Goodshuffle has no API; these notices are the one place
// the dashboard can see a project's id next to the customer's name, phone and email.

import { decodeB64Url, header, htmlToText, parseAddressList, type GmailMessage, type GmailPart } from "./email-parse.ts";

/** The project page in Goodshuffle Pro, the same link the notice's View Project button opens. */
export function goodshuffleProjectUrl(projectId: string): string {
  return `https://pro.goodshuffle.com/app/project/detail?id=${encodeURIComponent(projectId)}`;
}

export interface WishlistNotice {
  projectId: string;
  url: string;
  projectName: string | null;
  contactName: string | null;
  phone: string | null;
  email: string | null;
  receivedAt: string;
}

function partTexts(part: GmailPart | undefined, mime: string, out: string[] = []): string[] {
  if (!part) return out;
  if (part.mimeType === mime && part.body?.data && !part.filename) out.push(decodeB64Url(part.body.data));
  for (const p of part.parts ?? []) partTexts(p, mime, out);
  return out;
}

const PROJECT_LINK = /pro\.goodshuffle\.com\/app\/project\/detail\?id=(\d{3,})/i;
const PHONE = /^\+?[\d\s().-]{10,}$/;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/** The lines under a heading ("Contact", "Project") up to the next blank-line-separated heading. */
function section(lines: string[], heading: string, stopAt: string[]): string[] {
  const start = lines.findIndex((l) => l.toLowerCase() === heading.toLowerCase());
  if (start < 0) return [];
  const out: string[] = [];
  for (const l of lines.slice(start + 1)) {
    if (stopAt.some((s) => l.toLowerCase() === s.toLowerCase())) break;
    out.push(l);
  }
  return out;
}

/**
 * Read a Goodshuffle "New Wishlist Submission" notice: the project id (from the View Project link, or
 * the "#231009191" in the project name), the project name, and the contact's name, phone and email.
 * The email is the notice's Reply-To (the customer) when it isn't Goodshuffle's or this inbox's own,
 * else one written in the Contact section. Returns null when no project id is found.
 */
export function parseWishlistNotice(msg: GmailMessage, myEmail: string): WishlistNotice | null {
  const html = partTexts(msg.payload, "text/html").join("\n");
  const plain = partTexts(msg.payload, "text/plain").join("\n");
  const raw = `${plain}\n${html}`.replace(/&amp;/g, "&");
  const text = plain.trim() ? plain : htmlToText(html);
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const projectLines = section(lines, "Project", ["Contact", "Venue", "Contract Details"]);
  const projectName = projectLines[0] ?? null;
  const projectId =
    raw.match(PROJECT_LINK)?.[1] ??
    projectName?.match(/#\s?(\d{5,})\b/)?.[1] ??
    text.match(/Wishlist\s+['‘’"“”][^'‘’"“”]*#\s?(\d{5,})/i)?.[1] ??
    null;
  if (!projectId) return null;

  const contact = section(lines, "Contact", ["Venue", "Contract Details", "Project"]);
  const contactName = contact.find((l) => !PHONE.test(l) && !EMAIL.test(l)) ?? null;
  const phone = contact.find((l) => PHONE.test(l) && digits(l).length >= 10) ?? null;

  const me = myEmail.toLowerCase();
  const replyTo = parseAddressList(header(msg, "Reply-To"))[0];
  const replyToCustomer = replyTo && !/goodshuffle/i.test(replyTo.email) && replyTo.email !== me ? replyTo.email : null;
  const contactEmail = contact.map((l) => l.match(EMAIL)?.[0]?.toLowerCase()).find(Boolean) ?? null;

  return {
    projectId,
    url: goodshuffleProjectUrl(projectId),
    projectName: projectName ? projectName.replace(/\s+/g, " ").trim() : null,
    contactName: contactName ?? (replyTo?.name || null),
    phone,
    email: replyToCustomer ?? contactEmail,
    receivedAt: new Date(Number(msg.internalDate ?? Date.now())).toISOString(),
  };
}

// ---------- Matching a client to a wishlist ----------

const digits = (s: string) => s.replace(/\D/g, "");

/** The last 10 digits of a phone number (drops a leading +1), or null if it's too short to compare. */
export function normPhone(s: string | null | undefined): string | null {
  const d = digits(s ?? "");
  return d.length >= 10 ? d.slice(-10) : null;
}

function nameWords(s: string | null | undefined): string[] {
  return (s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
    .filter(Boolean);
}

/**
 * Do two names belong to the same person? Same first and last name (middle names ignored), or the
 * same first name when one side only has a first name ("Nicole" and "Nicole Linnartz").
 */
export function namesAgree(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = nameWords(a);
  const y = nameWords(b);
  if (!x.length || !y.length) return false;
  if (x[0] !== y[0]) return false;
  if (x.length === 1 || y.length === 1) return true;
  return x[x.length - 1] === y[y.length - 1];
}

export interface Person {
  names: (string | null | undefined)[];
  emails: (string | null | undefined)[];
  phones: (string | null | undefined)[];
}

export interface WishlistRow {
  gsp_project_id: string;
  url: string;
  project_name: string | null;
  contact_name: string | null;
  phone: string | null;
  email: string | null;
  received_at: string;
}

export interface GoodshuffleMatch {
  wishlist: WishlistRow;
  /** linked: name plus email or phone agree, one project, around the time of the request. possible: check it. */
  level: "linked" | "possible";
  why: string;
}

const DAY = 86_400_000;
/** A wishlist counts as this request's project when it came in this close to the request. */
const BEFORE_DAYS = 45;
const AFTER_DAYS = 14;

/**
 * Find the Goodshuffle project for a client among the account's wishlist notices.
 * "linked" only when the name agrees and the email or phone agrees, the wishlist came in around the
 * time of the request (`at`), and no other project fits as well. Anything weaker is "possible", for
 * a person to check. No match: null.
 */
export function matchWishlist(person: Person, wishlists: WishlistRow[], at: string): GoodshuffleMatch | null {
  const emails = new Set(person.emails.map((e) => e?.trim().toLowerCase()).filter(Boolean) as string[]);
  const phones = new Set(person.phones.map(normPhone).filter(Boolean) as string[]);
  const names = person.names.filter((n) => n?.trim());
  const when = new Date(at).getTime();

  type Scored = { w: WishlistRow; strong: boolean; inWindow: boolean; why: string; nameOnly: boolean };
  const scored: Scored[] = [];
  for (const w of wishlists) {
    const emailHit = !!w.email && emails.has(w.email.toLowerCase());
    const phone = normPhone(w.phone);
    const phoneHit = !!phone && phones.has(phone);
    const nameHit = names.some((n) => namesAgree(n, w.contact_name));
    if (!emailHit && !phoneHit && !nameHit) continue;
    const t = new Date(w.received_at).getTime();
    const inWindow = !Number.isNaN(when) && t >= when - BEFORE_DAYS * DAY && t <= when + AFTER_DAYS * DAY;
    const parts = [nameHit && "name", emailHit && "email", phoneHit && "phone"].filter(Boolean) as string[];
    scored.push({
      w,
      strong: nameHit && (emailHit || phoneHit),
      inWindow,
      why: `${parts.join(" + ")} match`,
      nameOnly: nameHit && !emailHit && !phoneHit,
    });
  }
  if (!scored.length) return null;
  const newest = (a: Scored, b: Scored) => b.w.received_at.localeCompare(a.w.received_at);

  const linked = scored.filter((s) => s.strong && s.inWindow).sort(newest);
  if (linked.length === 1) return { wishlist: linked[0].w, level: "linked", why: linked[0].why };
  if (linked.length > 1) {
    return { wishlist: linked[0].w, level: "possible", why: `${linked.length} Goodshuffle projects fit this client, newest shown` };
  }

  // Weaker fits: a strong match from another time (a past event?), or only one of name / email / phone.
  // A name alone only counts when exactly one wishlist has that name.
  const nameOnly = scored.filter((s) => s.nameOnly);
  const candidates = scored.filter((s) => !s.nameOnly || nameOnly.length === 1).sort((a, b) => Number(b.strong) - Number(a.strong) || newest(a, b));
  const best = candidates[0];
  if (!best) return null;
  const why = best.strong && !best.inWindow ? `${best.why}, but from ${best.w.received_at.slice(0, 10)}` : `${best.why} only`;
  return { wishlist: best.w, level: "possible", why };
}

// ---------- Project numbers in email subjects ----------
// Goodshuffle's own quote and invoice emails put the project number in the subject, e.g.
// "Quote for Emma Hutton (Project #232032021)", and customers reply on the same subject. That covers
// the projects built by hand, which most are (wishlists are rare).

const SUBJECT_PROJECT = /\bProject\s*#\s?(\d{6,})\b/gi;

/** The Goodshuffle project numbers written in an email subject ("Project #232032021"), in order, no repeats. */
export function projectIdsInSubject(subject: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (subject ?? "").matchAll(SUBJECT_PROJECT)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** One stored email whose subject names a Goodshuffle project. */
export interface ProjectMention {
  gsp_project_id: string;
  subject: string;
  gmail_thread_id: string;
  /** The customer's side of the email: the sender of an inbound one, the recipients of an outbound one. */
  emails: string[];
  sent_at: string;
}

export interface MentionEmailRow {
  gmail_thread_id: string;
  direction: "inbound" | "outbound";
  from_address: string | null;
  to_addresses: string | null;
  subject: string | null;
  sent_at: string;
}

/** Turn stored emails into project mentions (one per project number in each subject). */
export function mentionsFromEmails(rows: MentionEmailRow[]): ProjectMention[] {
  const out: ProjectMention[] = [];
  for (const r of rows) {
    const ids = projectIdsInSubject(r.subject);
    if (!ids.length) continue;
    const emails =
      r.direction === "inbound"
        ? [r.from_address?.trim().toLowerCase()].filter(Boolean)
        : parseAddressList(r.to_addresses ?? "").map((a) => a.email);
    for (const id of ids) {
      out.push({ gsp_project_id: id, subject: r.subject ?? "", gmail_thread_id: r.gmail_thread_id, emails: emails as string[], sent_at: r.sent_at });
    }
  }
  return out;
}

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "outlook.com", "hotmail.com", "live.com", "icloud.com", "me.com", "aol.com", "msn.com"]);
const domainOf = (e: string) => e.split("@")[1]?.toLowerCase() ?? "";

/**
 * Addresses that can identify a customer: drops this inbox's own address and, unless it's a free-mail
 * domain, every address on the business's own domain (a quote forwarded from logistics@ isn't the customer).
 */
export function customerEmails(emails: (string | null | undefined)[], ownEmail: string): string[] {
  const own = ownEmail.trim().toLowerCase();
  const ownDomain = FREE_MAIL.has(domainOf(own)) ? null : domainOf(own);
  return [...new Set(emails.map((e) => e?.trim().toLowerCase()).filter((e): e is string => !!e && e.includes("@")))].filter(
    (e) => e !== own && (!ownDomain || domainOf(e) !== ownDomain),
  );
}

/** A mention as the row shape the cards show (no contact name or phone in a subject). */
function mentionRow(m: ProjectMention): WishlistRow {
  return {
    gsp_project_id: m.gsp_project_id,
    url: goodshuffleProjectUrl(m.gsp_project_id),
    project_name: m.subject.replace(/^(?:\s*(?:re|fwd?|fw)\s*:\s*)+/i, "").trim() || null,
    contact_name: null,
    phone: null,
    email: m.emails[0] ?? null,
    received_at: m.sent_at,
  };
}

/** A project number counts for this request when it was emailed no earlier than this before the request. */
const MENTION_BEFORE_DAYS = 30;

/**
 * Find the Goodshuffle project for a quote from project numbers in email subjects: in the quote's own
 * Gmail thread, or in emails with the customer's address. "linked" when exactly one project number fits
 * from around or after the request; several, or only older ones (a past event?), are "possible".
 */
export function matchProjectMention(
  person: Pick<Person, "emails">,
  threadId: string | null,
  mentions: ProjectMention[],
  at: string,
  ownEmail: string,
): GoodshuffleMatch | null {
  const emails = new Set(customerEmails(person.emails, ownEmail));
  const when = new Date(at).getTime();
  const hits = mentions
    .map((m) => ({
      m,
      sameThread: !!threadId && m.gmail_thread_id === threadId,
      emailHit: m.emails.some((e) => emails.has(e)),
    }))
    .filter((h) => h.sameThread || h.emailHit)
    .sort((a, b) => b.m.sent_at.localeCompare(a.m.sent_at));
  if (!hits.length) return null;
  const whyOf = (h: (typeof hits)[number]) =>
    h.sameThread ? "project number in this email thread" : `project number in an email with ${h.m.emails.find((e) => emails.has(e))}`;

  // The quote's own thread names one project: that's it.
  const threadIds = [...new Set(hits.filter((h) => h.sameThread).map((h) => h.m.gsp_project_id))];
  if (threadIds.length === 1) return { wishlist: mentionRow(hits.find((h) => h.sameThread)!.m), level: "linked", why: whyOf(hits.find((h) => h.sameThread)!) };

  const recent = hits.filter((h) => Number.isNaN(when) || new Date(h.m.sent_at).getTime() >= when - MENTION_BEFORE_DAYS * DAY);
  const recentIds = [...new Set(recent.map((h) => h.m.gsp_project_id))];
  if (recentIds.length === 1) return { wishlist: mentionRow(recent[0].m), level: "linked", why: whyOf(recent[0]) };
  if (recentIds.length > 1) {
    return { wishlist: mentionRow(recent[0].m), level: "possible", why: `${recentIds.length} Goodshuffle projects in this client's emails, newest shown` };
  }
  return { wishlist: mentionRow(hits[0].m), level: "possible", why: `${whyOf(hits[0])}, but from ${hits[0].m.sent_at.slice(0, 10)}` };
}

/**
 * The better of two matches: a sure one before a possible one, else the first (the wishlist's). Two
 * sure matches that name different projects are only possible: a person should check.
 */
export function bestMatch(a: GoodshuffleMatch | null, b: GoodshuffleMatch | null): GoodshuffleMatch | null {
  if (!a) return b;
  if (!b) return a;
  if (a.level === "linked" && b.level === "linked" && a.wishlist.gsp_project_id !== b.wishlist.gsp_project_id) {
    return { wishlist: b.wishlist, level: "possible", why: "the wishlist and the emails name different Goodshuffle projects" };
  }
  if (a.level === b.level) return a;
  return a.level === "linked" ? a : b;
}
