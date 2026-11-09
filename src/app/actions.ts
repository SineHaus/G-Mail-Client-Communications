"use server";

import { revalidatePath } from "next/cache";
import { db, must } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { acceptDraft } from "@/lib/send";
import { generateDraft, generateDrafts, reviseDraft } from "@/lib/claude";
import { syncHistory } from "@/lib/ingest";
import { startWatch } from "@/lib/watch";
import { Gmail, getAccount } from "@/lib/google";
import { extractBody, header, stripQuoted } from "@/lib/email-parse";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

async function run<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    await requireSession();
    const data = await fn();
    return { ok: true, data };
  } catch (e) {
    console.error(e);
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

const now = () => new Date().toISOString();

// ---------- Drafts ----------

export async function acceptDraftAction(draftId: string, body?: string) {
  const r = await run(() => acceptDraft(draftId, body));
  revalidatePath("/", "layout");
  return r;
}

export async function declineDraftAction(draftId: string) {
  const r = await run(async () => {
    must(
      await db()
        .from("drafts")
        .update({ status: "declined", updated_at: now() })
        .eq("id", draftId)
        .in("status", ["pending", "revised"])
        .select("id"),
    );
  });
  revalidatePath("/", "layout");
  return r;
}

export async function saveDraftAction(draftId: string, body: string) {
  return run(async () => {
    must(
      await db()
        .from("drafts")
        .update({ body, status: "revised", updated_at: now() })
        .eq("id", draftId)
        .in("status", ["pending", "revised"])
        .select("id"),
    );
  });
}

export async function reviseDraftAction(draftId: string, instruction: string, currentBody: string) {
  return run(() => reviseDraft(draftId, instruction, currentBody));
}

/** Regenerate from scratch (e.g. after an error, or to start over). */
export async function regenerateDraftAction(draftId: string) {
  const r = await run(async () => {
    const d = must(await db().from("drafts").select("email_id").eq("id", draftId).single()) as { email_id: string };
    await db().from("drafts").update({ status: "declined", updated_at: now() }).eq("id", draftId);
    await generateDraft(d.email_id);
  });
  revalidatePath("/", "layout");
  return r;
}

/** Ask Claude for a draft for any inbound email (e.g. an older one that wasn't auto-drafted). */
export async function draftForEmailAction(emailId: string) {
  const r = await run(async () => {
    const open = must(
      await db().from("drafts").select("id").eq("email_id", emailId).in("status", ["pending", "revised"]).limit(1),
    ) as { id: string }[];
    if (open[0]) return open[0].id;
    await generateDraft(emailId);
    const d = must(
      await db().from("drafts").select("id").eq("email_id", emailId).in("status", ["pending", "revised"]).limit(1),
    ) as { id: string }[];
    return d[0]?.id;
  });
  revalidatePath("/", "layout");
  return r;
}

// ---------- Projects ----------

/** Link an email — and the rest of its thread — to a project (or unlink with null). */
export async function linkProjectAction(emailId: string, projectId: string | null) {
  const r = await run(async () => {
    const e = must(await db().from("emails").select("gmail_thread_id").eq("id", emailId).single()) as {
      gmail_thread_id: string;
    };
    must(await db().from("emails").update({ project_id: projectId }).eq("gmail_thread_id", e.gmail_thread_id).select("id"));
    // Once linked, the suggestion is resolved.
    if (projectId) await db().from("drafts").update({ suggested_project_id: null }).eq("email_id", emailId);
  });
  revalidatePath("/", "layout");
  return r;
}

export async function dismissSuggestionAction(draftId: string) {
  const r = await run(async () => {
    await db().from("drafts").update({ suggested_project_id: null, suggestion_reason: null }).eq("id", draftId);
  });
  revalidatePath("/", "layout");
  return r;
}

export async function nextProjectNumber(): Promise<string> {
  await requireSession();
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
  const r = await run(async () => {
    if (!input.project_name.trim() || !input.project_number.trim()) throw new Error("Project name and number are required.");
    const ins = await db()
      .from("projects")
      .insert({
        project_name: input.project_name.trim(),
        project_number: input.project_number.trim().replace(/^#/, ""),
        client_id: input.client_id || null,
        status: input.status || "inquiry",
        event_date: input.event_date || null,
        notes: input.notes || null,
      })
      .select("id")
      .single();
    if (ins.error) throw new Error(ins.error.code === "23505" ? "That project number is already used." : ins.error.message);
    const id = (ins.data as { id: string }).id;
    if (input.linkEmailId) {
      const res = await linkProjectAction(input.linkEmailId, id);
      if (!res.ok) throw new Error(res.error);
    }
    return id;
  });
  revalidatePath("/", "layout");
  return r;
}

export async function updateProjectAction(
  id: string,
  fields: { project_name?: string; project_number?: string; status?: string; event_date?: string | null; notes?: string | null; client_id?: string | null },
) {
  const r = await run(async () => {
    const res = await db().from("projects").update(fields).eq("id", id);
    if (res.error) throw new Error(res.error.code === "23505" ? "That project number is already used." : res.error.message);
  });
  revalidatePath("/", "layout");
  return r;
}

// ---------- Clients ----------

export async function updateClientAction(
  id: string,
  fields: { name?: string; phone?: string; company?: string; notes?: string; ignored?: boolean },
) {
  const r = await run(async () => {
    must(await db().from("clients").update(fields).eq("id", id).select("id"));
    // Marking someone "not a client" clears their open drafts.
    if (fields.ignored) {
      const emails = must(await db().from("emails").select("id").eq("client_id", id)) as { id: string }[];
      if (emails.length)
        await db()
          .from("drafts")
          .update({ status: "declined", updated_at: now() })
          .in("email_id", emails.map((e) => e.id))
          .in("status", ["pending", "revised"]);
    }
  });
  revalidatePath("/", "layout");
  return r;
}

// ---------- Gmail ----------

export async function syncNowAction() {
  const r = await run(async () => {
    const { draftEmailIds, results } = await syncHistory();
    await generateDrafts(draftEmailIds);
    return { imported: results.filter((x) => x.status === "inserted").length, drafted: draftEmailIds.length };
  });
  revalidatePath("/", "layout");
  return r;
}

export async function startWatchAction() {
  const r = await run(async () => {
    const w = await startWatch();
    if (!w.ok) throw new Error(w.reason);
    return w.expiration;
  });
  revalidatePath("/settings");
  return r;
}

// ---------- Style examples ----------

export async function addStyleExampleAction(body: string, context: string) {
  const r = await run(async () => {
    if (!body.trim()) throw new Error("Paste one of Leonel's replies.");
    must(await db().from("style_examples").insert({ body: body.trim(), context: context.trim() || null }).select("id"));
  });
  revalidatePath("/settings");
  return r;
}

export async function deleteStyleExampleAction(id: string) {
  const r = await run(async () => {
    await db().from("style_examples").delete().eq("id", id);
  });
  revalidatePath("/settings");
  return r;
}

/** Pull Leonel's recent sent replies from Gmail as tone examples. */
export async function importStyleExamplesAction(max = 20) {
  const r = await run(async () => {
    const acct = await getAccount();
    const ids = await Gmail.listMessageIds("in:sent newer_than:365d -in:chats", 80);
    let added = 0;
    for (const { id } of ids) {
      if (added >= max) break;
      const msg = await Gmail.getMessage(id);
      const to = header(msg, "To").toLowerCase();
      if (!to || to.includes(acct.email)) continue;
      const body = stripQuoted(extractBody(msg));
      if (body.length < 60 || body.length > 4000) continue;
      // Use the message Leonel was replying to (if any) as context.
      const thread = must(
        await db()
          .from("emails")
          .select("body,sent_at")
          .eq("gmail_thread_id", msg.threadId)
          .eq("direction", "inbound")
          .lt("sent_at", new Date(Number(msg.internalDate)).toISOString())
          .order("sent_at", { ascending: false })
          .limit(1),
      ) as { body: string }[];
      const ins = await db()
        .from("style_examples")
        .upsert(
          { body, context: thread[0]?.body?.slice(0, 2000) ?? null, source_gmail_message_id: id },
          { onConflict: "source_gmail_message_id", ignoreDuplicates: true },
        )
        .select("id");
      if (ins.data?.length) added++;
    }
    return added;
  });
  revalidatePath("/settings");
  return r;
}

