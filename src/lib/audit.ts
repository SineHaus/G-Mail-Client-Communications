import "server-only";
import { db } from "./db";

/** Append to audit_log. Never throws (logging must not break the action). */
export async function audit(
  actor: string,
  action: string,
  opts: { accountId?: string | null; draftId?: string | null; emailId?: string | null; detail?: string | null } = {},
) {
  const { error } = await db().from("audit_log").insert({
    actor,
    action,
    account_id: opts.accountId ?? null,
    draft_id: opts.draftId ?? null,
    email_id: opts.emailId ?? null,
    detail: opts.detail ?? null,
  });
  if (error) console.error("audit_log insert failed", error.message);
}
