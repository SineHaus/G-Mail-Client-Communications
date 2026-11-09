import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { exchangeCode, getAccount, saveAccountToken } from "@/lib/google";
import { syncRecent } from "@/lib/ingest";
import { generateDrafts } from "@/lib/claude";
import { startWatch } from "@/lib/watch";
import { ACCOUNT_COOKIE, accountCookieOptions } from "@/lib/accounts";
import { createSessionValue, SESSION_COOKIE, sessionCookieOptions, verifySessionValue } from "@/lib/session";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const [expectedState, mode] = (req.cookies.get("oauth_state")?.value ?? "").split(".");
  const session = await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value);
  const fail = (msg: string) => {
    const dest = mode === "add" && session ? `/settings?error=${encodeURIComponent(msg)}` : `/login?error=${encodeURIComponent(msg)}`;
    return NextResponse.redirect(new URL(dest, env.appUrl()));
  };

  if (url.searchParams.get("error")) return fail(url.searchParams.get("error")!);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== expectedState) return fail("Sign-in expired, please try again.");
  if (mode === "add" && !session) return fail("Please sign in first.");

  const { tokens, email, scopesOk } = await exchangeCode(code);
  if (!scopesOk) {
    return fail(
      "Google granted different permissions than read + send. Remove the app at myaccount.google.com/permissions and try again, allowing both.",
    );
  }
  // Dashboard sign-in is limited to ALLOWED_EMAILS. Adding extra mailboxes requires being signed in already.
  if (mode !== "add" && !env.allowedEmails().includes(email)) return fail(`${email} is not allowed to sign in to this dashboard.`);

  let accountId: string;
  let needsInitialSync: boolean;
  if (tokens.refresh_token) {
    const saved = await saveAccountToken(email, tokens.refresh_token); // stored encrypted, server side only
    accountId = saved.id;
    const acct = await getAccount(accountId);
    needsInitialSync = saved.isNew || !acct.history_id;
  } else {
    return fail("Google didn't return a refresh token. Remove the app at myaccount.google.com/permissions and try again.");
  }

  if (needsInitialSync) {
    // New or reconnected account: import recent mail, start its own push watch, draft replies — in the background.
    after(async () => {
      try {
        const { draftEmailIds } = await syncRecent(accountId);
        await startWatch(accountId).catch((e) => console.error("watch failed", email, e));
        await generateDrafts(accountId, draftEmailIds);
      } catch (e) {
        console.error("Initial sync failed", email, e);
      }
    });
  }

  const res = NextResponse.redirect(new URL(mode === "add" ? "/?added=1" : "/", env.appUrl()));
  if (mode !== "add") res.cookies.set(SESSION_COOKIE, await createSessionValue(email), sessionCookieOptions);
  // Switch to the account just connected.
  res.cookies.set(ACCOUNT_COOKIE, accountId, accountCookieOptions);
  res.cookies.delete("oauth_state");
  return res;
}
