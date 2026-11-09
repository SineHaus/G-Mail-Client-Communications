"use server";

// Every action resolves the CURRENT account (requireAccount) and scopes every read and write with
// .eq("account_id", acct). A row id from another account simply isn't found, so an action can never
// touch another account's data. The database's composite foreign keys enforce the same rule.

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db, must } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { ACCOUNT_COOKIE, accountCookieOptions, listAccounts, requireAccount } from "@/lib/accounts";
import { acceptDraft } from "@/lib/send";
import { generateDraft, generateDrafts, reviseDraft } from "@/lib/claude";
import { syncHistory } from "@/lib/ingest";
import { startWatch } from "@/lib/watch";
import { disconnectAccount, gmailFor, getAccount } from "@/lib/google";
import { extractBody, header, stripQuoted } from "@/lib/email-parse";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function run<T>(fn: (accountId: string) => Promise<T>): Promise<Result<T>> {
  try {
    const accountId = await requireAccount();
    const data = await fn(accountId);
    return { ok: true, data };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const now = () => new Date().toISOString();
const refreshAll = () => revalidatePath("/", "layout");

/** Throws unless the row exists in this account. */
async function assertInAccount(table: "emails" | "drafts" | "projects" | "clients" | "style_examples", id: string, accountId: string) {
  const r = must(await db().from(table).select("id").eq("account_id", accountId).eq("id", id).limit(1)) as { id: string }[];
  if (!r.length) throw new Error("Not found in this account (did you switch accounts in another tab?). Refresh the page.");
}

// ---------- Accounts ----------

export async function switchAccountAction(accountId: string) {
  try {
    await requireSession();
    const accounts = await listAccounts();
    if (!accounts.some((a) => a.id === accountId)) throw new Error("Unknown account");
    (await cookies()).set(ACCOUNT_COOKIE, accountId, accountCookieOptions); // remembered for next visit
    refreshAll();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function renameAccountAction(accountId: string, displayName: string) {
  try {
    await requireSession();
    must(await db().from("gmail_accounts").update({ display_name: displayName.trim() || null }).eq("id", accountId).select("id"));
    refreshAll();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Disconnect: stop push, revoke at Google and delete the stored (encrypted) token. Emails/clients/projects are kept. */
export async function disconnectAccountAction(accountId: string) {
  try {
    await requireSession();
    await disconnectAccount(accountId);
    refreshAll();
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- Drafts ----------

export async function acceptDraftAction(draftId: string, body?: string) {
  const r = await run((acct) => acceptDraft(acct, draftId, body));
  refreshAll();
  return r;
}

export async function declineDraftAction(draftId: string) {
  const r = await run(async (acct) => {
    const rows = must(
      await db()
        .from("drafts")
        .update({ status: "declined", updated_at: now() })
        .eq("account_id", acct)
        .eq("id", draftId)
        .in("status", ["pending", "revised"])
        .select("email_id"),
    ) as { email_id: string }[];
    if (rows[0]) await db().from("emails").update({ is_read: true }).eq("account_id", acct).eq("id", rows[0].email_id);
  });
  refreshAll();
  return r;
}

export async function saveDraftAction(draftId: string, body: string) {
  return run(async (acct) => {
    const rows = must(
      await db()
        .from("drafts")
        .update({ body, status: "revised", updated_at: now() })
        .eq("account_id", acct)
        .eq("id", draftId)
        .in("status", ["pending", "revised"])
        .select("id"),
    ) as { id: string }[];
    if (!rows.length) throw new Error("Draft not found in this account.");
  });
}

export async function reviseDraftAction(draftId: string, instruction: string, currentBody: string) {
  return run((acct) => reviseDraft(acct, draftId, instruction, currentBody));
}

/** Regenerate from scratch (e.g. after an error, or to start over). */
export async function regenerateDraftAction(draftId: string) {
  const r = await run(async (acct) => {
    const d = must(await db().from("drafts").select("email_id").eq("account_id", acct).eq("id", draftId).single()) as { email_id: string };
    await db().from("drafts").update({ status: "declined", updated_at: now() }).eq("account_id", acct).eq("id", draftId);
    await generateDraft(acct, d.email_id);
  });
  refreshAll();
  return r;
}

/** Ask Claude for a draft for any inbound email (e.g. an older one that wasn't auto-drafted). */
export async function draftForEmailAction(emailId: string) {
  const r = await run(async (acct) => {
    await assertInAccount("emails", emailId, acct);
    const findOpen = async () =>
      (must(
        await db().from("drafts").select("id").eq("account_id", acct).eq("email_id", emailId).in("status", ["pending", "revised"]).limit(1),
      ) as { id: string }[])[0]?.id;
    const existing = await findOpen();
    if (existing) return existing;
    await generateDraft(acct, emailId);
    return findOpen();
  });
  refreshAll();
  return r;
}

// ---------- Read / unread (Supabase only — Gmail labels are never changed) ----------

export async function setEmailReadAction(emailId: string, isRead: boolean) {
  const r = await run(async (acct) => {
    const rows = must(await db().from("emails").update({ is_read: isRead }).eq("account_id", acct).eq("id", emailId).select("id")) as unknown[];
    if (!rows.length) throw new Error("Email not found in this account.");
  });
  refreshAll();
  return r;
}

// ---------- Projects ----------

/** Link an email — and the rest of its thread — to a project of the same account (or unlink with null). */
export async function linkProjectAction(emailId: string, projectId: string | null) {
  const r = await run(async (acct) => {
    if (projectId) await assertInAccount("projects", projectId, acct);
    const e = must(
      await db().from("emails").select("gmail_thread_id").eq("account_id", acct).eq("id", emailId).single(),
    ) as { gmail_thread_id: string };
    must(
      await db().from("emails").update({ project_id: projectId }).eq("account_id", acct).eq("gmail_thread_id", e.gmail_thread_id).select("id"),
    );
    if (projectId) await db().from("drafts").update({ suggested_project_id: null }).eq("account_id", acct).eq("email_id", emailId);
  });
  refreshAll();
  return r;
}

export async function dismissSuggestionAction(draftId: string) {
  const r = await run(async (acct) => {
    await db().from("drafts").update({ suggested_project_id: null, suggestion_reason: null }).eq("account_id", acct).eq("id", draftId);
  });
  refreshAll();
  return r;
}

export async function nextProjectNumber(): Promise<string> {
  const acct = await requireAccount();
  const rows = must(await db().from("projects").select("project_number").eq("account_id", acct)) as { project_number: string }[];
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
  const r = await run(async (acct) => {
    if (!input.project_name.trim() || !input.project_number.trim()) throw new Error("Project name and number are required.");
    if (input.client_id) await assertInAccount("clients", input.client_id, acct);
    const ins = await db()
      .from("projects")
      .insert({
        account_id: acct,
        project_name: input.project_name.trim(),
        project_number: input.project_number.trim().replace(/^#/, ""),
        client_id: input.client_id || null,
        status: input.status || "inquiry",
        event_date: input.event_date || null,
        notes: input.notes || null,
      })
      .select("id")
      .single();
    if (ins.error) throw new Error(ins.error.code === "23505" ? "That project number is already used in this account." : ins.error.message);
    const id = (ins.data as { id: string }).id;
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
  const r = await run(async (acct) => {
    if (fields.client_id) await assertInAccount("clients", fields.client_id, acct);
    const res = await db().from("projects").update(fields).eq("account_id", acct).eq("id", id).select("id");
    if (res.error) throw new Error(res.error.code === "23505" ? "That project number is already used in this account." : res.error.message);
    if (!res.data?.length) throw new Error("Project not found in this account.");
  });
  refreshAll();
  return r;
}

// ---------- Clients ----------

export async function updateClientAction(
  id: string,
  fields: { name?: string; phone?: string; company?: string; notes?: string; ignored?: boolean },
) {
  const r = await run(async (acct) => {
    const rows = must(await db().from("clients").update(fields).eq("account_id", acct).eq("id", id).select("id")) as unknown[];
    if (!rows.length) throw new Error("Client not found in this account.");
    // Marking someone "not a client" clears their open drafts.
    if (fields.ignored) {
      const emails = must(await db().from("emails").select("id").eq("account_id", acct).eq("client_id", id)) as { id: string }[];
      if (emails.length)
        await db()
          .from("drafts")
          .update({ status: "declined", updated_at: now() })
          .eq("account_id", acct)
          .in("email_id", emails.map((e) => e.id))
          .in("status", ["pending", "revised"]);
    }
  });
  refreshAll();
  return r;
}

// ---------- Gmail (per account) ----------

/** Sync the current account, or a specific one from Settings. */
export async function syncNowAction(accountId?: string) {
  const r = await run(async (current) => {
    const acct = accountId ?? current;
    const { draftEmailIds, results } = await syncHistory(acct);
    await generateDrafts(acct, draftEmailIds);
    return { imported: results.filter((x) => x.status === "inserted").length, drafted: draftEmailIds.length };
  });
  refreshAll();
  return r;
}

export async function startWatchAction(accountId?: string) {
  const r = await run(async (current) => {
    const w = await startWatch(accountId ?? current);
    if (!w.ok) throw new Error(w.reason);
    return w.expiration;
  });
  refreshAll();
  return r;
}

// ---------- Style examples (per account) ----------

export async function addStyleExampleAction(body: string, context: string) {
  const r = await run(async (acct) => {
    if (!body.trim()) throw new Error("Paste one of Leonel's replies.");
    must(await db().from("style_examples").insert({ account_id: acct, body: body.trim(), context: context.trim() || null }).select("id"));
  });
  revalidatePath("/settings");
  return r;
}

export async function deleteStyleExampleAction(id: string) {
  const r = await run(async (acct) => {
    await db().from("style_examples").delete().eq("account_id", acct).eq("id", id);
  });
  revalidatePath("/settings");
  return r;
}

/** Pull the current account's recent sent replies from Gmail as tone examples. */
export async function importStyleExamplesAction(max = 20) {
  const r = await run(async (acct) => {
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
      // Use the message being replied to (same account) as context.
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
