import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { db, must } from "./db";
import { ACCOUNT_PUBLIC_COLUMNS, type GmailAccount } from "./google";
import { requireSession } from "./auth";

/** Remembers the last selected account (just a preference; every query re-checks it exists). */
export const ACCOUNT_COOKIE = "erg_account";
export const accountCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
};

export const listAccounts = cache(async function listAccounts(): Promise<GmailAccount[]> {
  const rows = must(
    await db().from("gmail_accounts").select(`${ACCOUNT_PUBLIC_COLUMNS},refresh_token_encrypted`).order("created_at"),
  ) as (Omit<GmailAccount, "connected"> & { refresh_token_encrypted: string | null })[];
  // Strip the encrypted token before anything leaves this function.
  return rows.map(({ refresh_token_encrypted, ...a }) => ({ ...a, connected: !!refresh_token_encrypted }));
});

/** The account whose dashboard is shown: the remembered one if it still exists, else the first connected one. */
export async function getCurrentAccount(accounts?: GmailAccount[]): Promise<GmailAccount | null> {
  const list = accounts ?? (await listAccounts());
  const wanted = (await cookies()).get(ACCOUNT_COOKIE)?.value;
  return list.find((a) => a.id === wanted) ?? list.find((a) => a.connected) ?? list[0] ?? null;
}

/** For server actions and API routes: signed in + an account selected. Returns the account id to scope every query by. */
export async function requireAccount(): Promise<string> {
  await requireSession();
  const acct = await getCurrentAccount();
  if (!acct) throw new Error("No Gmail account connected yet.");
  return acct.id;
}

/** Per-account badge counts for the switcher: open drafts + unread client emails. */
export async function accountCounts(accounts: GmailAccount[]) {
  const out: Record<string, { drafts: number; unread: number }> = {};
  await Promise.all(
    accounts.map(async (a) => {
      const [d, u] = await Promise.all([
        db().from("drafts").select("id", { count: "exact", head: true }).eq("account_id", a.id).in("status", ["pending", "revised"]),
        db().from("emails").select("id", { count: "exact", head: true }).eq("account_id", a.id).eq("direction", "inbound").eq("is_read", false),
      ]);
      out[a.id] = { drafts: d.count ?? 0, unread: u.count ?? 0 };
    }),
  );
  return out;
}
