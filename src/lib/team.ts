import "server-only";
import { cache } from "react";
import { db, must } from "./db";
import { env } from "./env";
import { requireSession } from "./auth";
import type { Role } from "./permissions";

export interface Member {
  id: string;
  email: string;
  name: string | null;
  is_owner: boolean;
  active: boolean;
}

export const memberLabel = (m: { name: string | null; email: string }) => m.name || m.email.split("@")[0];

/** Active team member for an address, or null. */
export async function findMember(email: string): Promise<Member | null> {
  const r = must(
    await db().from("team_members").select("id,email,name,is_owner,active").eq("email", email.toLowerCase()).maybeSingle(),
  ) as Member | null;
  return r && r.active ? r : null;
}

/**
 * Sign-in gate. Allowed: an active team member, or an address in ALLOWED_EMAILS (bootstraps Leo:
 * the first sign-in creates an Owner). Returns null if this person may not sign in.
 */
export async function memberForSignIn(email: string): Promise<Member | null> {
  const e = email.toLowerCase();
  const existing = must(
    await db().from("team_members").select("id,email,name,is_owner,active").eq("email", e).maybeSingle(),
  ) as Member | null;
  if (existing) {
    if (!existing.active) return null;
    await db().from("team_members").update({ last_login_at: new Date().toISOString() }).eq("id", existing.id);
    return existing;
  }
  if (!env.allowedEmails().includes(e)) return null;
  return must(
    await db()
      .from("team_members")
      .insert({ email: e, is_owner: true, last_login_at: new Date().toISOString() })
      .select("id,email,name,is_owner,active")
      .single(),
  ) as Member;
}

/** The signed-in, active team member (re-checked on every request, so removal takes effect at once). */
export const requireMember = cache(async function requireMember(): Promise<Member> {
  const s = await requireSession();
  const m = await findMember(s.email);
  if (!m) throw new Error("Your access to this dashboard has been removed.");
  return m;
});

/** The member's role on each Gmail account they can see (owners: every account). */
export const accessMap = cache(async function accessMap(member: Member): Promise<Map<string, Role>> {
  const map = new Map<string, Role>();
  if (member.is_owner) {
    const all = must(await db().from("gmail_accounts").select("id")) as { id: string }[];
    for (const a of all) map.set(a.id, "owner");
    return map;
  }
  const rows = must(await db().from("account_access").select("account_id,role").eq("member_id", member.id)) as {
    account_id: string;
    role: Role;
  }[];
  for (const r of rows) map.set(r.account_id, r.role);
  return map;
});
