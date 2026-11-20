import "server-only";
import { db, must } from "./db";
import type { Client, Draft, Email } from "./types";
import { agentTablesReady, type QuoteRequest, type Stage } from "./quotes";
import { goodshuffleProjectUrl, projectIdsInSubject } from "./goodshuffle";
import { goodshuffleProjectsReady } from "./schema-ready";

// Shared reads for Today, Inbox, Leads and Quotes. Every query is scoped to one account.

export type QuoteClient = Pick<Client, "id" | "name" | "email" | "phone">;
export type QuoteRow = QuoteRequest & { client: QuoteClient | null };
export type DraftRow = Draft & { emails: Email & { clients: Client | null } };

export const PIPELINE: { key: string; label: string; stages: Stage[] }[] = [
  { key: "gathering", label: "Gathering info", stages: ["gathering"] },
  { key: "build", label: "Put quote together", stages: ["ready_to_build", "building"] },
  { key: "send", label: "Ready to send", stages: ["ready_to_send", "approved_to_send"] },
  { key: "sent", label: "Quote sent", stages: ["quote_sent"] },
];

export const DAY = 86_400_000;
/** The time n days ago, in ms. */
export const daysAgo = (n: number) => Date.now() - n * DAY;
/** Follow Up #1: a sent quote with no reply from the customer for this many days. */
export const FOLLOW_UP_DAYS = 10;

export async function loadQuotes(accountId: string, limit = 500): Promise<QuoteRow[]> {
  if (!(await agentTablesReady(accountId))) return [];
  const quotes = must(
    await db().from("quote_requests").select("*").eq("account_id", accountId).order("updated_at", { ascending: false }).limit(limit),
  ) as QuoteRequest[];
  const ids = [...new Set(quotes.map((q) => q.client_id).filter(Boolean))] as string[];
  const clients = new Map<string, QuoteClient>();
  for (let i = 0; i < ids.length; i += 200) {
    const rows = must(
      await db().from("clients").select("id,name,email,phone").eq("account_id", accountId).in("id", ids.slice(i, i + 200)),
    ) as QuoteClient[];
    for (const c of rows) clients.set(c.id, c);
  }
  return quotes.map((q) => ({ ...q, client: q.client_id ? (clients.get(q.client_id) ?? null) : null }));
}

export async function loadOpenDrafts(accountId: string): Promise<DraftRow[]> {
  return must(
    await db()
      .from("drafts")
      .select("*, emails!drafts_email_fk!inner(*, clients!emails_client_fk(*))")
      .eq("account_id", accountId)
      .in("status", ["pending", "sending"])
      .order("created_at", { ascending: false })
      .limit(200),
  ) as unknown as DraftRow[];
}

export type InboxEmail = Email & { clients: Pick<Client, "id" | "name" | "email" | "ignored"> | null };

/** Newest emails from customers (not from people marked "not a client"). */
export async function loadRecentInbound(accountId: string, limit = 40): Promise<InboxEmail[]> {
  const rows = must(
    await db()
      .from("emails")
      .select("*, clients!emails_client_fk(id,name,email,ignored)")
      .eq("account_id", accountId)
      .eq("direction", "inbound")
      .order("sent_at", { ascending: false })
      .limit(limit * 2),
  ) as unknown as InboxEmail[];
  // One row per conversation: its newest customer email.
  const seen = new Set<string>();
  return rows.filter((e) => !e.clients?.ignored && !seen.has(e.gmail_thread_id) && seen.add(e.gmail_thread_id)).slice(0, limit);
}

/** The Goodshuffle project named in an email subject, if any ("Project #12345"). */
export function gspFromSubject(subject: string | null | undefined): { id: string; url: string } | null {
  const ids = projectIdsInSubject(subject);
  return ids.length === 1 ? { id: ids[0], url: goodshuffleProjectUrl(ids[0]) } : null;
}

/** Sent quotes whose conversation ends with our email more than FOLLOW_UP_DAYS ago. */
export async function followUpsDue(accountId: string, quotes: QuoteRow[]) {
  const sent = quotes.filter((q) => q.stage === "quote_sent");
  if (!sent.length) return [];
  const threads = sent.map((q) => q.gmail_thread_id);
  const latest = new Map<string, { id: string; direction: string; sent_at: string }>();
  for (let i = 0; i < threads.length; i += 100) {
    const rows = must(
      await db()
        .from("emails")
        .select("id,gmail_thread_id,direction,sent_at")
        .eq("account_id", accountId)
        .in("gmail_thread_id", threads.slice(i, i + 100))
        .order("sent_at", { ascending: false })
        .limit(2000),
    ) as { id: string; gmail_thread_id: string; direction: string; sent_at: string }[];
    for (const r of rows) if (!latest.has(r.gmail_thread_id)) latest.set(r.gmail_thread_id, r);
  }
  const cutoff = Date.now() - FOLLOW_UP_DAYS * DAY;
  return sent
    .map((q) => ({ q, last: latest.get(q.gmail_thread_id) }))
    .filter((x) => x.last && x.last.direction === "outbound" && new Date(x.last.sent_at).getTime() < cutoff)
    .map((x) => ({ q: x.q, lastEmailId: x.last!.id, days: Math.floor((Date.now() - new Date(x.last!.sent_at).getTime()) / DAY) }))
    .sort((a, b) => b.days - a.days);
}

export interface GoodshuffleProject {
  gsp_project_id: string;
  url: string;
  project_name: string | null;
  client_name: string | null;
  client_email: string | null;
  venue: string | null;
  status: string | null;
  event_date: string | null;
  logistics_start: string | null;
  logistics_end: string | null;
  quote_total: number | null;
  amount_due: number | null;
  billing_status: string | null;
  synced_at: string;
}

/** Goodshuffle project details (empty until migration 006 is run and the Goodshuffle sync fills it). */
export async function loadGoodshuffleProjects(accountId: string): Promise<GoodshuffleProject[]> {
  if (!(await goodshuffleProjectsReady())) return [];
  return must(
    await db()
      .from("goodshuffle_projects")
      .select("gsp_project_id,url,project_name,client_name,client_email,venue,status,event_date,logistics_start,logistics_end,quote_total,amount_due,billing_status,synced_at")
      .eq("account_id", accountId)
      .order("event_date", { ascending: true })
      .limit(2000),
  ) as GoodshuffleProject[];
}

export const personName = (q: QuoteRow) => q.client?.name || q.info?.name || q.title || q.client?.email || "Customer";
export const shortDate = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" }) : "";
export const money = (n: number | null | undefined) =>
  n == null ? "" : n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
export const initials = (s: string) =>
  s
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";
