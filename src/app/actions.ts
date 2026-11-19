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
import { startWatch } from "@/lib/watch";
import { disconnectAccount, gmailFor, getAccount } from "@/lib/google";
import { extractBody, header, stripQuoted } from "@/lib/email-parse";
import { audit } from "@/lib/audit";

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
    await db().from("emails").update({ is_read: true }).eq("account_id", c.accountId).eq("id", rows[0].email_id);
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

// ---------- Read / unread (Supabase only — Gmail labels are never changed) ----------

export async function setEmailReadAction(emailId: string, isRead: boolean) {
  const r = await run("view", async (c) => {
    const rows = must(await db().from("emails").update({ is_read: isRead }).eq("account_id", c.accountId).eq("id", emailId).select("id")) as unknown[];
    if (!rows.length) throw new Error("Email not found in this account.");
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
    const { draftEmailIds, results, stoppedEarly } = stored.count ? await syncHistory(acct) : await syncRecent(acct);
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
