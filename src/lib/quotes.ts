import "server-only";
import { cache } from "react";
import { db, must } from "./db";
import {
  EMPTY_FACTS,
  ITEMS_KEY,
  itemsSummary,
  hasValue,
  mergeInfo,
  missingItems,
  parseChecklist,
  type ChecklistItem,
  type DeliveryFacts,
  type QuoteItem,
} from "./quote-rules";

// Quote requests: one per Gmail thread. Claude fills them in while drafting replies (lib/claude.ts);
// people move them through the stages with Approve (app/actions.ts). Nothing here sends anything.

export type Stage = "gathering" | "ready_to_build" | "building" | "ready_to_send" | "approved_to_send" | "quote_sent" | "closed";

export const STAGE_LABEL: Record<Stage, string> = {
  gathering: "Gathering info",
  ready_to_build: "Ready to put quote together",
  building: "Building in Goodshuffle",
  ready_to_send: "Ready to send quote",
  approved_to_send: "Approved to send",
  quote_sent: "Quote sent",
  closed: "Closed",
};

/** Stages where the customer's answers still shape the quote (later ones are already in Goodshuffle). */
const OPEN_FOR_INFO: Stage[] = ["gathering", "ready_to_build"];

export interface QuoteRequest {
  id: string;
  account_id: string;
  gmail_thread_id: string;
  client_id: string | null;
  latest_email_id: string | null;
  stage: Stage;
  title: string | null;
  info: Record<string, string>;
  items: QuoteItem[];
  facts: Partial<DeliveryFacts>;
  notes: string | null;
  goodshuffle_url: string | null;
  build_approved_by: string | null;
  build_approved_at: string | null;
  send_approved_by: string | null;
  send_approved_at: string | null;
  closed_reason: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export const CHECKLIST_KEY = "quote_checklist";

export async function getChecklistText(): Promise<string | null> {
  const { data } = await db().from("app_settings").select("value").eq("key", CHECKLIST_KEY).maybeSingle();
  return (data as { value: string } | null)?.value ?? null;
}

export async function getChecklist(): Promise<ChecklistItem[]> {
  return parseChecklist(await getChecklistText());
}

/**
 * Whether migration 004 has been run (the quote_requests table exists). Until then the AI agent tab
 * explains what to run, and drafting works exactly as before.
 */
export const agentTablesReady = cache(async function agentTablesReady(accountId: string): Promise<boolean> {
  const { error } = await db().from("quote_requests").select("id").eq("account_id", accountId).limit(1);
  if (!error) return true;
  if (error.code === "42P01" || error.code === "PGRST205" || /could not find the table|does not exist/i.test(error.message)) return false;
  throw new Error(error.message);
});

export function factsOf(q: Pick<QuoteRequest, "facts">): DeliveryFacts {
  return { ...EMPTY_FACTS, ...(q.facts ?? {}) };
}

export function missingFor(q: Pick<QuoteRequest, "info">, checklist: ChecklistItem[]) {
  return missingItems(checklist, q.info ?? {});
}

export async function quoteForThread(accountId: string, threadId: string): Promise<QuoteRequest | null> {
  const rows = must(
    await db().from("quote_requests").select("*").eq("account_id", accountId).eq("gmail_thread_id", threadId).limit(1),
  ) as QuoteRequest[];
  return rows[0] ?? null;
}

/** What Claude found in the email it just replied to (see QuoteSchema in lib/claude.ts). */
export interface QuoteIntake {
  is_quote_request: boolean;
  title: string;
  answers: { key: string; value: string }[];
  items: QuoteItem[];
  facts: DeliveryFacts;
  notes_for_team: string;
}

/**
 * Record Claude's reading of a client email on its thread's quote request: start one for a new quote
 * request, add new answers to an open one, and move it to "ready to put quote together" once every
 * required checklist item has an answer. Never moves a request backwards and never sends anything.
 */
export async function recordIntake(
  accountId: string,
  email: { id: string; gmail_thread_id: string; client_id: string | null; sent_at: string },
  intake: QuoteIntake | null,
  checklist: ChecklistItem[],
) {
  const existing = await quoteForThread(accountId, email.gmail_thread_id);
  if (!existing && !intake?.is_quote_request) return null;
  const now = new Date().toISOString();

  if (existing && !OPEN_FOR_INFO.includes(existing.stage)) {
    // Already approved to build (or later): don't change what was approved; tell the team instead.
    if (existing.stage === "closed" || existing.latest_email_id === email.id) return existing;
    const note = `New email from the customer (${now.slice(0, 10)}) after the quote was approved to build: check it for changes.`;
    must(
      await db()
        .from("quote_requests")
        .update({ latest_email_id: email.id, notes: [existing.notes, note].filter(Boolean).join("\n"), updated_at: now })
        .eq("account_id", accountId)
        .eq("id", existing.id)
        .select("id"),
    );
    return existing;
  }

  const keys = new Set(checklist.map((c) => c.key));
  const answers = Object.fromEntries((intake?.answers ?? []).filter((a) => keys.has(a.key) && hasValue(a.value)).map((a) => [a.key, a.value]));
  const items = intake?.items?.length ? intake.items : (existing?.items ?? []);
  if (keys.has(ITEMS_KEY) && items.length && !hasValue(answers[ITEMS_KEY])) answers[ITEMS_KEY] = itemsSummary(items);
  const info = mergeInfo(existing?.info ?? {}, answers);
  const facts: Partial<DeliveryFacts> = { ...(existing?.facts ?? {}) };
  for (const [k, v] of Object.entries(intake?.facts ?? {})) if (v !== null && v !== false && v !== "") (facts as Record<string, unknown>)[k] = v;
  const complete = missingItems(checklist, info).length === 0;
  const stage: Stage = complete ? "ready_to_build" : (existing?.stage ?? "gathering");
  const notes = intake?.notes_for_team?.trim() ? intake.notes_for_team.trim() : (existing?.notes ?? null);

  const row = {
    account_id: accountId,
    gmail_thread_id: email.gmail_thread_id,
    client_id: email.client_id,
    latest_email_id: email.id,
    stage,
    title: existing?.title || intake?.title?.trim() || null,
    info,
    items,
    facts,
    notes,
    updated_by: "claude",
    updated_at: now,
  };
  const saved = must(
    // Scoped by the row's account_id (part of the conflict key), so it can only touch this account's request.
    await db().from("quote_requests").upsert(row, { onConflict: "account_id,gmail_thread_id" }).select("*").single(),
  ) as QuoteRequest;
  return saved;
}

/** The quote request's text for Claude, so the next reply asks only for what's still missing. */
export function intakePrompt(checklist: ChecklistItem[], q: QuoteRequest | null) {
  const list = checklist.map((c) => `- ${c.key}: ${c.label}${c.optional ? " (optional, ask once)" : ""}`).join("\n");
  const known = q
    ? Object.entries(q.info)
        .map(([k, v]) => `- ${k}: ${v}`)
        .join("\n") || "(nothing yet)"
    : "(no quote request on this thread yet)";
  const stage = q ? `Stage: ${STAGE_LABEL[q.stage]}` : "";
  return `<quote_intake>
TERG's required-info checklist for a quote (key: label):
${list}

What this thread's quote request already has:
${stage}
${known}
</quote_intake>

Quote requests: if the latest client email asks for a quote, prices or availability for an event, or continues the quote request above, set quote.is_quote_request to true and fill quote from the WHOLE thread:
- answers: one entry per checklist key the customer has answered (use the key exactly as listed). Name and email may come from the client details. Leave out keys with no answer; never guess one.
- items: every rental item and quantity the customer asked for (quantity null if not given).
- facts: for TERG's internal delivery planning only. event_date as YYYY-MM-DD, venue_type "home" for a private residence or "venue" for a hall, restaurant, park, office or other venue, event_start as 24-hour HH:MM, the customer-request flags only when the customer actually asked, stage_or_dance_floor when a stage or dance floor is requested, north_jersey true when the event address is in North Jersey (Bergen, Passaic, Hudson, Essex, Morris, Sussex, Warren or Union county).
- title: a short label like "Smith wedding, Jun 6" or "Acme picnic".
- notes_for_team: one or two sentences for Leonel about anything unusual (a Saturday pickup request, a same-night pickup, an early start, a tax-exempt organisation). Empty if nothing.
Then in the reply, ask in one short, friendly list for the required checklist items still missing after this email (never for something they already gave). Never ask about or mention delivery or pickup dates, days or time windows. If nothing required is missing, thank them and say Leonel will put the quote together and send it over.
If the email is not a quote request and there's no quote request above, set quote.is_quote_request to false with empty answers and items.`;
}

/** Stages that wait on the team (an approval, or a step in Goodshuffle). */
export const TEAM_STAGES: Stage[] = ["ready_to_build", "building", "ready_to_send", "approved_to_send"];

/** Quote cards and command changes waiting on the team, for the AI agent tab's badge. 0 before migration 004. */
export async function agentWaitingCount(accountId: string): Promise<number> {
  const [q, c] = await Promise.all([
    db().from("quote_requests").select("id", { count: "exact", head: true }).eq("account_id", accountId).in("stage", TEAM_STAGES),
    db().from("agent_commands").select("id", { count: "exact", head: true }).eq("account_id", accountId).eq("status", "needs_approval"),
  ]);
  return (q.error ? 0 : (q.count ?? 0)) + (c.error ? 0 : (c.count ?? 0));
}
