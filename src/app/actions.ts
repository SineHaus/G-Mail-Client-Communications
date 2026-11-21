"use server";

// Every action resolves the signed-in team member and the CURRENT account, checks their role there
// (view / edit / approve / manage), and scopes every read and write with .eq("account_id", acct).
// Rows of accounts a person can't access are never found. Decisions are written to audit_log.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db, must } from "@/lib/db";
import { ACCOUNT_COOKIE, accountCookieOptions, listAccounts, requireAccount, requireRoleOn, visibleProjectIds } from "@/lib/accounts";
import { requireMember, memberLabel } from "@/lib/team";
import type { Permission } from "@/lib/permissions";
import { approveDraft } from "@/lib/send";
import { generateDraft, reviseDraft } from "@/lib/claude";
import { draftDeadline, draftMissing } from "@/lib/draft-queue";
import { newDraftVersion } from "@/lib/drafts";
import { syncHistory, syncRecent } from "@/lib/ingest";
import { recordSyncError } from "@/lib/sync-health";
import { startWatch } from "@/lib/watch";
import { disconnectAccount, gmailFor, getAccount } from "@/lib/google";
import { extractBody, header, stripQuoted } from "@/lib/email-parse";
import { audit } from "@/lib/audit";
import { markEmailRead, markEmailUnread } from "@/lib/read-sync";
import { CHECKLIST_KEY, getChecklist, missingFor, quoteForThread, type QuoteRequest, type Stage } from "@/lib/quotes";
import { ITEMS_KEY, applyItemChange, cleanGoodshuffleUrl, itemsSummary, mergeInfo, textToItems } from "@/lib/quote-rules";
import { runCommand, type ProposedChange } from "@/lib/agent-commands";
import { noAutoLinkKey } from "@/lib/goodshuffle-link";
import { approveReply, createDevice, declineReply, reviseGspReply, revokeDevice, saveReplyText } from "@/lib/goodshuffle-messages";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
type Ctx = Awaited<ReturnType<typeof requireAccount>>;

async function run<T>(permission: Permission, fn: (ctx: Ctx) => Promise<T>): Promise<Result<T>> {
  try {
    const ctx = await requireAccount(permission);
    return { ok: true, data: await fn(ctx) };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function runOwner<T>(fn: (actor: string) => Promise<T>): Promise<Result<T>> {
  try {
    const m = await requireMember();
    if (!m.is_owner) throw new Error("Only the Owner can do that.");
    return { ok: true, data: await fn(m.email) };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const now = () => new Date().toISOString();
const refreshAll = () => revalidatePath("/", "layout");

/** Throws unless the row exists in this account. */
async function assertInAccount(table: "emails" | "drafts" | "clients" | "style_examples", id: string, accountId: string) {
  const r = must(await db().from(table).select("id").eq("account_id", accountId).eq("id", id).limit(1)) as { id: string }[];
  if (!r.length) throw new Error("Not found in this account (did you switch accounts in another tab?). Refresh the page.");
}

/** Throws unless the shared project is visible through this account. */
async function assertProjectVisible(projectId: string, accountId: string) {
  if (!(await visibleProjectIds([accountId])).includes(projectId)) throw new Error("Project not found.");
}

// ---------- Accounts ----------

export async function switchAccountAction(accountId: string) {
  try {
    const accounts = await listAccounts(await requireMember());
    if (!accounts.some((a) => a.id === accountId)) throw new Error("Unknown account");
    (await cookies()).set(ACCOUNT_COOKIE, accountId, accountCookieOptions); // remembered for next visit
    refreshAll();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function renameAccountAction(accountId: string, displayName: string) {
  const r = await runOwner(async (actor) => {
    must(await db().from("gmail_accounts").update({ display_name: displayName.trim() || null }).eq("id", accountId).select("id"));
    await audit(actor, "account_renamed", { accountId, detail: displayName });
  });
  refreshAll();
  return r;
}

/** Disconnect: stop push, revoke at Google and delete the stored (encrypted) token. Data is kept. */
export async function disconnectAccountAction(accountId: string) {
  const r = await runOwner(async (actor) => {
    await disconnectAccount(accountId);
    await audit(actor, "account_disconnected", { accountId });
  });
  refreshAll();
  return r;
}

// ---------- Drafts ----------

/** Approve: sends exactly `bodyOnScreen` for the version the person was looking at. */
export async function approveDraftAction(draftId: string, bodyOnScreen: string) {
  const r = await run("approve", (c) => approveDraft(c.member.email, c.accountId, draftId, bodyOnScreen));
  refreshAll();
  return r;
}

/** Decline: Leo handles it outside the dashboard. Nothing is sent; it leaves the Queue. */
export async function declineDraftAction(draftId: string) {
  const r = await run("edit", async (c) => {
    const rows = must(
      await db()
        .from("drafts")
        .update({ status: "declined", decided_by: c.member.email, decided_at: now(), updated_at: now() })
        .eq("account_id", c.accountId)
        .eq("id", draftId)
        .eq("status", "pending")
        .select("email_id"),
    ) as { email_id: string }[];
    if (!rows[0]) throw new Error("This draft changed since you opened it. Reload to see the latest.");
    await markEmailRead(c.accountId, rows[0].email_id);
    await audit(c.member.email, "declined", { accountId: c.accountId, draftId, emailId: rows[0].email_id, detail: "handled outside the dashboard" });
  });
  refreshAll();
  return r;
}

/** Hand edits: saved as a new version. Returns the new version's id. */
export async function saveDraftVersionAction(draftId: string, body: string) {
  const r = await run("edit", async (c) => {
    await assertInAccount("drafts", draftId, c.accountId);
    const newId = await newDraftVersion(draftId, body.trim(), c.member.email, null);
    await audit(c.member.email, "edited_draft", { accountId: c.accountId, draftId: newId });
    return newId;
  });
  refreshAll();
  return r;
}

/** Review: send back to Claude with a note; Claude's rewrite becomes the next version. */
export async function reviseDraftAction(draftId: string, instruction: string, currentBody: string) {
  const r = await run("edit", async (c) => {
    const out = await reviseDraft(c.member.email, c.accountId, draftId, instruction, currentBody);
    await audit(c.member.email, "sent_back_to_claude", { accountId: c.accountId, draftId: out.draftId, detail: instruction.slice(0, 300) });
    return out;
  });
  refreshAll();
  return r;
}

/** Start over: close the open version and have Claude draft from scratch. */
export async function regenerateDraftAction(draftId: string) {
  const r = await run("edit", async (c) => {
    const rows = must(
      await db()
        .from("drafts")
        .update({ status: "superseded", updated_at: now() })
        .eq("account_id", c.accountId)
        .eq("id", draftId)
        .eq("status", "pending")
        .select("email_id"),
    ) as { email_id: string }[];
    if (!rows[0]) throw new Error("This draft changed since you opened it. Reload to see the latest.");
    await generateDraft(c.accountId, rows[0].email_id);
    await audit(c.member.email, "redrafted_from_scratch", { accountId: c.accountId, emailId: rows[0].email_id });
  });
  refreshAll();
  return r;
}

/** Ask Claude for a draft for any inbound email (e.g. an older one that wasn't auto-drafted). */
export async function draftForEmailAction(emailId: string) {
  const r = await run("edit", async (c) => {
    await assertInAccount("emails", emailId, c.accountId);
    const findOpen = async () =>
      (must(
        await db().from("drafts").select("id").eq("account_id", c.accountId).eq("email_id", emailId).in("status", ["pending", "sending"]).limit(1),
      ) as { id: string }[])[0]?.id;
    const existing = await findOpen();
    if (existing) return existing;
    await generateDraft(c.accountId, emailId);
    return findOpen();
  });
  refreshAll();
  return r;
}

/** "Who has this open": heartbeat from the review screen (every ~30s). */
export async function pingPresenceAction(emailId: string) {
  return run("view", async (c) => {
    await db().from("presence").upsert(
      { account_id: c.accountId, email_id: emailId, member_email: c.member.email, member_name: memberLabel(c.member), seen_at: now() },
      { onConflict: "email_id,member_email" },
    );
  });
}

// ---------- Read / unread (dashboard first, then copied to Gmail's UNREAD label; see lib/read-sync.ts) ----------

export async function setEmailReadAction(emailId: string, isRead: boolean) {
  const r = await run("view", async (c) => {
    if (isRead) await markEmailRead(c.accountId, emailId);
    else await markEmailUnread(c.accountId, emailId);
  });
  refreshAll();
  return r;
}

// ---------- Projects (shared across TERG) ----------

/** Link an email — and the rest of its thread — to a project (or unlink with null). */
export async function linkProjectAction(emailId: string, projectId: string | null) {
  const r = await run("edit", async (c) => {
    if (projectId) await assertProjectVisible(projectId, c.accountId);
    const e = must(
      await db().from("emails").select("gmail_thread_id").eq("account_id", c.accountId).eq("id", emailId).single(),
    ) as { gmail_thread_id: string };
    must(
      await db().from("emails").update({ project_id: projectId }).eq("account_id", c.accountId).eq("gmail_thread_id", e.gmail_thread_id).select("id"),
    );
    if (projectId) await db().from("drafts").update({ suggested_project_id: null }).eq("account_id", c.accountId).eq("email_id", emailId);
    await audit(c.member.email, projectId ? "linked_project" : "unlinked_project", { accountId: c.accountId, emailId, detail: projectId });
  });
  refreshAll();
  return r;
}

export async function dismissSuggestionAction(draftId: string) {
  const r = await run("edit", async (c) => {
    await db().from("drafts").update({ suggested_project_id: null, suggestion_reason: null }).eq("account_id", c.accountId).eq("id", draftId);
  });
  refreshAll();
  return r;
}

/** Next free TERG-wide project number. */
export async function nextProjectNumber(): Promise<string> {
  await requireAccount("edit");
  // isolation-exempt: numbers only (no names or links) to pick the next free TERG-wide number.
  const rows = must(await db().from("projects").select("project_number")) as { project_number: string }[];
  const nums = rows.map((r) => parseInt(r.project_number.replace(/\D/g, ""), 10)).filter((n) => !isNaN(n));
  return String(nums.length ? Math.max(...nums) + 1 : 1001);
}

export async function createProjectAction(input: {
  project_name: string;
  project_number: string;
  client_id?: string | null;
  status?: string;
  event_date?: string | null;
  notes?: string | null;
  linkEmailId?: string;
}) {
  const r = await run("edit", async (c) => {
    if (!input.project_name.trim() || !input.project_number.trim()) throw new Error("Project name and number are required.");
    if (input.client_id) await assertInAccount("clients", input.client_id, c.accountId);
    // isolation-exempt: inserting a new project (its client, if any, was checked to be in this account).
    const ins = await db()
      .from("projects")
      .insert({
        project_name: input.project_name.trim(),
        project_number: input.project_number.trim().replace(/^#/, ""),
        client_id: input.client_id || null,
        status: input.status || "inquiry",
        event_date: input.event_date || null,
        notes: input.notes || null,
        created_by: c.member.email,
      })
      .select("id")
      .single();
    if (ins.error) throw new Error(ins.error.code === "23505" ? "That project number is already used." : ins.error.message);
    const id = (ins.data as { id: string }).id;
    await audit(c.member.email, "created_project", { accountId: c.accountId, detail: `#${input.project_number} ${input.project_name}` });
    if (input.linkEmailId) {
      const res = await linkProjectAction(input.linkEmailId, id);
      if (!res.ok) throw new Error(res.error);
    }
    return id;
  });
  refreshAll();
  return r;
}

export async function updateProjectAction(
  id: string,
  fields: { project_name?: string; project_number?: string; status?: string; event_date?: string | null; notes?: string | null; client_id?: string | null },
) {
  const r = await run("edit", async (c) => {
    await assertProjectVisible(id, c.accountId);
    if (fields.client_id) await assertInAccount("clients", fields.client_id, c.accountId);
    const visible = [id]; // checked visible through this account just above
    const res = await db().from("projects").update(fields).in("id", visible).select("id");
    if (res.error) throw new Error(res.error.code === "23505" ? "That project number is already used." : res.error.message);
    await audit(c.member.email, "updated_project", { accountId: c.accountId, detail: id });
  });
  refreshAll();
  return r;
}

// ---------- Clients ----------

export async function updateClientAction(
  id: string,
  fields: { name?: string; phone?: string; company?: string; notes?: string; ignored?: boolean },
) {
  const r = await run("edit", async (c) => {
    const rows = must(await db().from("clients").update(fields).eq("account_id", c.accountId).eq("id", id).select("id")) as unknown[];
    if (!rows.length) throw new Error("Client not found in this account.");
    if (fields.ignored) {
      const emails = must(await db().from("emails").select("id").eq("account_id", c.accountId).eq("client_id", id)) as { id: string }[];
      if (emails.length)
        await db()
          .from("drafts")
          .update({ status: "declined", decided_by: c.member.email, decided_at: now(), updated_at: now() })
          .eq("account_id", c.accountId)
          .in("email_id", emails.map((e) => e.id))
          .eq("status", "pending");
    }
  });
  refreshAll();
  return r;
}

// ---------- Gmail (per account) ----------

export async function syncNowAction(accountId?: string) {
  const startedAt = Date.now();
  const r = await run("edit", async (c) => {
    const acct = accountId ?? c.accountId;
    if (accountId) await requireRoleOn(accountId, "edit");
    // An inbox with nothing stored yet (e.g. everything was skipped on its first import) gets the
    // 14-day import again; already-stored messages are skipped, so this is safe to repeat.
    const stored = await db().from("emails").select("id", { count: "exact", head: true }).eq("account_id", acct);
    const { draftEmailIds, results, stoppedEarly } = await (stored.count ? syncHistory(acct) : syncRecent(acct)).catch(async (e: unknown) => {
      await recordSyncError(acct, "Sync now", e);
      throw e;
    });
    // Server actions here run under the page's maxDuration (300 s); what doesn't fit is drafted on the next check.
    const { drafted, waiting } = await draftMissing(acct, draftDeadline(startedAt, 300), draftEmailIds);
    return {
      imported: results.filter((x) => x.status === "inserted").length,
      drafted,
      waiting,
      skipped: results.filter((x) => x.status === "skipped" && x.reason === "bulk/automated").length,
      // Gmail's per-minute limit cut the import short; what was stored is kept and the next sync resumes.
      stoppedEarly,
    };
  });
  refreshAll();
  return r;
}

export async function startWatchAction(accountId?: string) {
  const r = await run("edit", async (c) => {
    if (accountId) await requireRoleOn(accountId, "edit");
    const w = await startWatch(accountId ?? c.accountId);
    if (!w.ok) throw new Error(w.reason);
    return w.expiration;
  });
  refreshAll();
  return r;
}

// ---------- Style examples (per account) ----------

export async function addStyleExampleAction(body: string, context: string) {
  const r = await run("edit", async (c) => {
    if (!body.trim()) throw new Error("Paste one of Leo's replies.");
    must(await db().from("style_examples").insert({ account_id: c.accountId, body: body.trim(), context: context.trim() || null }).select("id"));
  });
  revalidatePath("/settings");
  return r;
}

export async function deleteStyleExampleAction(id: string) {
  const r = await run("edit", async (c) => {
    await db().from("style_examples").delete().eq("account_id", c.accountId).eq("id", id);
  });
  revalidatePath("/settings");
  return r;
}

export async function importStyleExamplesAction(max = 20) {
  const r = await run("edit", async (c) => {
    const acct = c.accountId;
    const account = await getAccount(acct);
    const gmail = gmailFor(acct);
    const ids = await gmail.listMessageIds("in:sent newer_than:365d -in:chats", 80);
    let added = 0;
    for (const { id } of ids) {
      if (added >= max) break;
      const msg = await gmail.getMessage(id);
      const to = header(msg, "To").toLowerCase();
      if (!to || to.includes(account.email_address)) continue;
      const body = stripQuoted(extractBody(msg));
      if (body.length < 60 || body.length > 4000) continue;
      const thread = must(
        await db()
          .from("emails")
          .select("body,sent_at")
          .eq("account_id", acct)
          .eq("gmail_thread_id", msg.threadId)
          .eq("direction", "inbound")
          .lt("sent_at", new Date(Number(msg.internalDate)).toISOString())
          .order("sent_at", { ascending: false })
          .limit(1),
      ) as { body: string }[];
      const ins = await db()
        .from("style_examples")
        .upsert(
          { account_id: acct, body, context: thread[0]?.body?.slice(0, 2000) ?? null, source_gmail_message_id: id },
          { onConflict: "account_id,source_gmail_message_id", ignoreDuplicates: true },
        )
        .select("id");
      if (ins.data?.length) added++;
    }
    return added;
  });
  revalidatePath("/settings");
  return r;
}

// ---------- AI reply rules (Owner) ----------

export async function saveReplyRulesAction(text: string) {
  const r = await runOwner(async (actor) => {
    must(
      await db()
        .from("app_settings")
        .upsert({ key: "reply_rules", value: text.trim(), updated_by: actor, updated_at: now() })
        .select("key"),
    );
    await audit(actor, "updated_reply_rules");
  });
  revalidatePath("/settings");
  return r;
}

// ---------- Quote checklist (Owner) ----------

export async function saveChecklistAction(text: string) {
  const r = await runOwner(async (actor) => {
    must(
      await db()
        .from("app_settings")
        .upsert({ key: CHECKLIST_KEY, value: text.trim(), updated_by: actor, updated_at: now() })
        .select("key"),
    );
    await audit(actor, "updated_quote_checklist");
  });
  revalidatePath("/settings");
  return r;
}

// ---------- AI agent: quote requests ----------
// Each step moves a quote request from the stage(s) it must be in to the next one, in one database
// step, so two people pressing at once can't both move it. Approve steps need send rights
// (Owner or Approver). Nothing here sends anything to a customer or touches Goodshuffle.

async function moveQuote(c: Ctx, id: string, from: Stage[], fields: Partial<QuoteRequest>, action: string, detail?: string) {
  const rows = must(
    await db()
      .from("quote_requests")
      .update({ ...fields, updated_by: c.member.email, updated_at: now() })
      .eq("account_id", c.accountId)
      .eq("id", id)
      .in("stage", from)
      .select("id,title"),
  ) as { id: string; title: string | null }[];
  if (!rows[0]) throw new Error("This quote request changed since you opened it. Reload to see the latest.");
  await audit(c.member.email, action, { accountId: c.accountId, detail: [rows[0].title ?? id, detail].filter(Boolean).join(" · ") });
}

async function loadQuote(c: Ctx, id: string) {
  const rows = must(await db().from("quote_requests").select("*").eq("account_id", c.accountId).eq("id", id).limit(1)) as QuoteRequest[];
  if (!rows[0]) throw new Error("Quote request not found in this account. Refresh the page.");
  return rows[0];
}

/** Gate 1: the proposed quote is right, put it together in Goodshuffle. */
export async function approveBuildAction(id: string) {
  const r = await run("approve", (c) =>
    moveQuote(c, id, ["ready_to_build"], { stage: "building", build_approved_by: c.member.email, build_approved_at: now() }, "approved_quote_build"),
  );
  refreshAll();
  return r;
}

/** The quote is built in Goodshuffle: record its project link and move it to the send gate. */
export async function markBuiltAction(id: string, goodshuffleUrl: string) {
  const r = await run("edit", async (c) => {
    const url = cleanGoodshuffleUrl(goodshuffleUrl);
    if (!url) throw new Error("Paste the project's link from Goodshuffle Pro (it starts with pro.goodshuffle.com).");
    await moveQuote(c, id, ["building"], { stage: "ready_to_send", goodshuffle_url: url }, "marked_quote_built");
  });
  refreshAll();
  return r;
}

/** Gate 2: the quote in Goodshuffle is right and may go to the customer. */
export async function approveSendAction(id: string) {
  const r = await run("approve", async (c) => {
    const q = await loadQuote(c, id);
    if (!q.goodshuffle_url) throw new Error("Add the Goodshuffle project link first.");
    await moveQuote(c, id, ["ready_to_send"], { stage: "approved_to_send", send_approved_by: c.member.email, send_approved_at: now() }, "approved_quote_send");
  });
  refreshAll();
  return r;
}

/** Someone pressed Send To Client in Goodshuffle (phase 1 does this by hand). */
export async function markQuoteSentAction(id: string) {
  const r = await run("edit", (c) => moveQuote(c, id, ["approved_to_send"], { stage: "quote_sent" }, "marked_quote_sent"));
  refreshAll();
  return r;
}

export async function setGoodshuffleLinkAction(id: string, goodshuffleUrl: string) {
  const r = await run("edit", async (c) => {
    const url = goodshuffleUrl.trim() ? cleanGoodshuffleUrl(goodshuffleUrl) : null;
    if (goodshuffleUrl.trim() && !url) throw new Error("Paste the project's link from Goodshuffle Pro (it starts with pro.goodshuffle.com).");
    await moveQuote(c, id, ["gathering", "ready_to_build", "building", "ready_to_send", "approved_to_send", "quote_sent"], { goodshuffle_url: url }, "set_goodshuffle_link");
    // Removed by hand: the dashboard won't put an automatic link back on this quote.
    if (!url) {
      must(
        await db()
          .from("app_settings")
          .upsert({ key: noAutoLinkKey(id), value: now(), updated_by: c.member.email, updated_at: now() })
          .select("key"),
      );
    }
  });
  refreshAll();
  return r;
}

/** Hand edits to the answers and items. A request that is now complete moves to "ready to put quote together". */
export async function updateQuoteAction(id: string, input: { title: string; info: Record<string, string>; itemsText: string }) {
  const r = await run("edit", async (c) => {
    const q = await loadQuote(c, id);
    if (!["gathering", "ready_to_build"].includes(q.stage)) throw new Error("This quote was already approved to build. Change it in Goodshuffle.");
    const checklist = await getChecklist();
    const keys = new Set(checklist.map((k) => k.key));
    const info: Record<string, string> = {};
    for (const [k, v] of Object.entries(q.info)) info[k] = v;
    for (const [k, v] of Object.entries(input.info)) if (keys.has(k)) info[k] = v.trim();
    const items = textToItems(input.itemsText);
    if (keys.has(ITEMS_KEY)) info[ITEMS_KEY] = items.length ? itemsSummary(items) : "";
    for (const k of Object.keys(info)) if (!info[k]) delete info[k];
    const stage: Stage = missingFor({ info }, checklist).length ? q.stage : "ready_to_build";
    await moveQuote(c, id, [q.stage], { title: input.title.trim() || q.title, info, items, stage }, "edited_quote_request");
  });
  refreshAll();
  return r;
}

export async function moveQuoteAction(id: string, to: "gathering" | "ready_to_build" | "closed", reason?: string) {
  const r = await run("edit", async (c) => {
    if (to === "closed") {
      await moveQuote(c, id, ["gathering", "ready_to_build", "building", "ready_to_send", "approved_to_send", "quote_sent"], { stage: "closed", closed_reason: reason?.trim() || null }, "closed_quote_request", reason);
    } else if (to === "ready_to_build") {
      await moveQuote(c, id, ["gathering"], { stage: "ready_to_build" }, "quote_request_ready_anyway");
    } else {
      await moveQuote(c, id, ["ready_to_build", "closed"], { stage: "gathering", closed_reason: null }, "quote_request_back_to_gathering", reason);
    }
  });
  refreshAll();
  return r;
}

/** Start tracking an email's thread as a quote request by hand (e.g. one from before the AI agent). */
export async function startQuoteAction(emailId: string) {
  const r = await run("edit", async (c) => {
    const e = must(
      await db().from("emails").select("id,gmail_thread_id,client_id,subject,clients!emails_client_fk(name,email)").eq("account_id", c.accountId).eq("id", emailId).single(),
    ) as unknown as { id: string; gmail_thread_id: string; client_id: string | null; subject: string | null; clients: { name: string | null; email: string } | null };
    const existing = await quoteForThread(c.accountId, e.gmail_thread_id);
    if (existing) return existing.id;
    const info = mergeInfo({}, { name: e.clients?.name ?? "", email: e.clients?.email ?? "" });
    const row = must(
      await db()
        .from("quote_requests")
        .insert({
          account_id: c.accountId,
          gmail_thread_id: e.gmail_thread_id,
          client_id: e.client_id,
          latest_email_id: e.id,
          title: e.clients?.name || e.subject || null,
          info,
          updated_by: c.member.email,
        })
        .select("id")
        .single(),
    ) as { id: string };
    await audit(c.member.email, "started_quote_request", { accountId: c.accountId, emailId });
    return row.id;
  });
  refreshAll();
  return r;
}

/**
 * "Ready for Goodshuffle": a thread the team marks as ready to become a Goodshuffle Pro project.
 * Starts its quote request if it has none and moves it into the approval queue (Ready to put quote
 * together). Nothing is sent and nothing is made in Goodshuffle; that still waits for Approve.
 */
export async function markReadyForGoodshuffleAction(emailId: string) {
  const started = await startQuoteAction(emailId);
  if (!started.ok) return started;
  const id = started.data as string;
  const r = await run("edit", async (c) => {
    const q = must(await db().from("quote_requests").select("stage").eq("account_id", c.accountId).eq("id", id).single()) as { stage: string };
    if (q.stage === "gathering" || q.stage === "closed") {
      await moveQuote(c, id, ["gathering", "closed"], { stage: "ready_to_build", closed_reason: null }, "quote_request_marked_ready_for_goodshuffle");
    }
    return id;
  });
  refreshAll();
  return r;
}

// ---------- AI agent: command box ----------

export async function runCommandAction(command: string) {
  const r = await run("edit", async (c) => {
    const text = command.trim();
    if (!text) throw new Error("Type what you'd like done.");
    if (text.length > 2000) throw new Error("That's too long for one command; keep it under 2,000 characters.");
    await runCommand(c.member.email, c.accountId, text);
  });
  refreshAll();
  return r;
}

/** Approve or decline a change a command proposed to a quote request. Approve needs send rights. */
export async function decideCommandChangeAction(commandId: string, approve: boolean) {
  const r = await run(approve ? "approve" : "edit", async (c) => {
    const close = async () => {
      const rows = must(
        await db()
          .from("agent_commands")
          .update({ status: approve ? "applied" : "declined", decided_by: c.member.email, decided_at: now(), updated_at: now() })
          .eq("account_id", c.accountId)
          .eq("id", commandId)
          .eq("status", "needs_approval")
          .select("id"),
      ) as { id: string }[];
      if (!rows[0]) throw new Error("This change was already handled. Reload to see the latest.");
    };
    const cmd = (must(
      await db().from("agent_commands").select("quote_request_id,proposed_change,command,status").eq("account_id", c.accountId).eq("id", commandId).limit(1),
    ) as { quote_request_id: string | null; proposed_change: ProposedChange | null; command: string; status: string }[])[0];
    if (!cmd || cmd.status !== "needs_approval") throw new Error("This change was already handled. Reload to see the latest.");
    if (!approve) {
      await close();
      return void (await audit(c.member.email, "declined_quote_change", { accountId: c.accountId, detail: cmd.command.slice(0, 300) }));
    }
    const { quote_request_id: qid, proposed_change: ch } = cmd;
    if (!qid || !ch) throw new Error("Nothing to apply.");
    // Mark it handled first (so a double press can't apply it twice), then apply it.
    await close();
    const q = await loadQuote(c, qid);
    const checklist = await getChecklist();
    const keys = new Set(checklist.map((k) => k.key));
    const info = mergeInfo(q.info, Object.fromEntries(ch.set_answers.filter((a) => keys.has(a.key)).map((a) => [a.key, a.value])));
    const items = applyItemChange(q.items, ch.add_items, ch.remove_items);
    if (keys.has(ITEMS_KEY) && items.length) info[ITEMS_KEY] = itemsSummary(items);
    const late = !["gathering", "ready_to_build"].includes(q.stage);
    const stage: Stage = q.stage === "gathering" && !missingFor({ info }, checklist).length ? "ready_to_build" : q.stage;
    const notes = late
      ? [q.notes, `Changed after it was approved to build (${now().slice(0, 10)}): update the Goodshuffle project to match.`].filter(Boolean).join("\n")
      : q.notes;
    try {
      await moveQuote(c, qid, [q.stage], { info, items, stage, notes }, "applied_quote_change", cmd.command.slice(0, 200));
    } catch (e) {
      // Put it back so it can be approved again once the page is reloaded.
      await db().from("agent_commands").update({ status: "needs_approval", decided_by: null, decided_at: null }).eq("account_id", c.accountId).eq("id", commandId);
      throw e;
    }
  });
  refreshAll();
  return r;
}

// ---------- Team (Owner) ----------

export async function addTeamMemberAction(email: string, name: string) {
  const r = await runOwner(async (actor) => {
    const e = email.trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error("Enter a valid email address.");
    const res = await db().from("team_members").upsert({ email: e, name: name.trim() || null, active: true }, { onConflict: "email" }).select("id");
    if (res.error) throw new Error(res.error.message);
    await audit(actor, "team_member_added", { detail: e });
  });
  revalidatePath("/settings");
  return r;
}

/** role: "none" removes access to that account (it's hidden from them). */
export async function setAccountRoleAction(memberId: string, accountId: string, role: "none" | "approver" | "editor" | "viewer") {
  const r = await runOwner(async (actor) => {
    if (role === "none") {
      await db().from("account_access").delete().eq("member_id", memberId).eq("account_id", accountId);
    } else {
      must(await db().from("account_access").upsert({ member_id: memberId, account_id: accountId, role }, { onConflict: "member_id,account_id" }).select("member_id"));
    }
    await audit(actor, "access_changed", { accountId, detail: `${memberId} → ${role}` });
  });
  revalidatePath("/settings");
  return r;
}

export async function setMemberActiveAction(memberId: string, active: boolean) {
  const r = await runOwner(async (actor) => {
    const me = await requireMember();
    if (me.id === memberId && !active) throw new Error("You can't remove yourself.");
    must(await db().from("team_members").update({ active }).eq("id", memberId).select("id"));
    await audit(actor, active ? "team_member_restored" : "team_member_removed", { detail: memberId });
  });
  revalidatePath("/settings");
  return r;
}

export async function setOwnerAction(memberId: string, isOwner: boolean) {
  const r = await runOwner(async (actor) => {
    const me = await requireMember();
    if (me.id === memberId && !isOwner) throw new Error("You can't remove your own Owner role.");
    must(await db().from("team_members").update({ is_owner: isOwner }).eq("id", memberId).select("id"));
    await audit(actor, isOwner ? "made_owner" : "removed_owner", { detail: memberId });
  });
  revalidatePath("/settings");
  return r;
}

// ---------- Goodshuffle Pro messages (sent by the Chrome extension, only after Approve) ----------

/** Approve: queues exactly `bodyOnScreen` for the extension to type into Goodshuffle and send. */
export async function approveGspReplyAction(id: string, bodyOnScreen: string) {
  const r = await run("approve", (c) => approveReply(c.accountId, id, bodyOnScreen, c.member.email));
  refreshAll();
  return r;
}

export async function declineGspReplyAction(id: string) {
  const r = await run("edit", (c) => declineReply(c.accountId, id, c.member.email));
  refreshAll();
  return r;
}

export async function saveGspReplyAction(id: string, body: string) {
  const r = await run("edit", (c) => saveReplyText(c.accountId, id, body, c.member.email));
  refreshAll();
  return r;
}

export async function reviseGspReplyAction(id: string, instruction: string, currentBody: string) {
  const r = await run("edit", (c) => reviseGspReply(c.accountId, id, instruction, currentBody, c.member.email));
  refreshAll();
  return r;
}

/** A token for the Chrome that runs the extension (shown once). Owner only. */
export async function createGspDeviceAction(label: string) {
  return run("manage", (c) => createDevice(c.accountId, label, c.member.email));
}

export async function revokeGspDeviceAction(deviceId: string) {
  const r = await run("manage", (c) => revokeDevice(c.accountId, deviceId, c.member.email));
  revalidatePath("/settings");
  return r;
}
