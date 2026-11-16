import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db, must } from "./db";
import { ACCOUNT_PUBLIC_COLUMNS, type GmailAccount } from "./google";
import { accessMap, requireMember, type Member } from "./team";
import { can, type Permission, type Role } from "./permissions";

/** Remembers the last selected account (a preference; every request re-checks access). */
export const ACCOUNT_COOKIE = "erg_account";
export const accountCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

export type AccountWithRole = GmailAccount & { role: Role };

async function allAccounts(): Promise<GmailAccount[]> {
  const rows = must(
    await db().from("gmail_accounts").select(`${ACCOUNT_PUBLIC_COLUMNS},refresh_token_encrypted`).order("created_at"),
  ) as (Omit<GmailAccount, "connected"> & { refresh_token_encrypted: string | null })[];
  // Strip the encrypted token before anything leaves this function.
  return rows.map(({ refresh_token_encrypted, ...a }) => ({ ...a, connected: !!refresh_token_encrypted }));
}

/** Only the accounts this member may see, each with their role. Accounts they can't see never load. */
export const listAccounts = cache(async function listAccounts(member?: Member): Promise<AccountWithRole[]> {
  const m = member ?? (await requireMember());
  const access = await accessMap(m);
  return (await allAccounts()).filter((a) => access.has(a.id)).map((a) => ({ ...a, role: access.get(a.id)! }));
});

/** The account whose dashboard is shown: the remembered one if still accessible, else the first. */
export async function getCurrentAccount(accounts?: AccountWithRole[]): Promise<AccountWithRole | null> {
  const list = accounts ?? (await listAccounts());
  const wanted = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  return list.find((a) => a.id === wanted) ?? list.find((a) => a.connected) ?? list[0] ?? null;
}

/**
 * For server actions and API routes: the signed-in member, the selected account, and a check that
 * their role there allows `permission`. Every query must then be scoped with this accountId.
 */
export async function requireAccount(permission: Permission = "view") {
  const member = await requireMember();
  const acct = await getCurrentAccount(await listAccounts(member));
  if (!acct) throw new Error("You don't have access to any Gmail account yet.");
  if (!can(acct.role, permission)) {
    throw new Error(
      permission === "approve"
        ? "Only the Owner or an Approver on this account can send."
        : permission === "manage"
          ? "Only the Owner can do that."
          : "Your role on this account is view-only.",
    );
  }
  return { member, accountId: acct.id, role: acct.role, account: acct };
}

/** Role check for a specific account (used where an action names an account explicitly). */
export async function requireRoleOn(accountId: string, permission: Permission) {
  const member = await requireMember();
  const role = (await accessMap(member)).get(accountId);
  if (!can(role, permission)) throw new Error("You don't have permission for that account.");
  return { member, role: role! };
}

/** Per-account badge counts for the switcher: open drafts + unread client emails. */
export async function accountCounts(accounts: { id: string }[]) {
  const out: Record<string, { drafts: number; unread: number }> = {};
  await Promise.all(
    accounts.map(async (a) => {
      const [d, u] = await Promise.all([
        db().from("drafts").select("id", { count: "exact", head: true }).eq("account_id", a.id).in("status", ["pending", "sending"]),
        db().from("emails").select("id", { count: "exact", head: true }).eq("account_id", a.id).eq("direction", "inbound").eq("is_read", false),
      ]);
      out[a.id] = { drafts: d.count ?? 0, unread: u.count ?? 0 };
    }),
  );
  return out;
}

/** Project ids visible through the given accounts (shared projects; see visible_project_ids in SQL). */
export async function visibleProjectIds(accountIds: string[]): Promise<string[]> {
  if (!accountIds.length) return [];
  const rows = must(await db().rpc("visible_project_ids", { p_accounts: accountIds })) as { id: string }[];
  return [...new Set(rows.map((r) => r.id))];
}
