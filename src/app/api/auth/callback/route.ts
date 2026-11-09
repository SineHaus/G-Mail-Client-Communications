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
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code");
  // Each sign-in attempt has its own cookie, keyed by its state value (CSRF protection).
  const stateCookie = /^[0-9a-f-]{36}$/.test(state) ? `oauth_state_${state}` : "";
  const mode = stateCookie ? req.cookies.get(stateCookie)?.value : undefined;
  const session = await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  const fail = (msg: string) => {
    console.warn("Sign-in failed:", msg, "| host:", url.host);
    const dest = mode === "add" && session ? `/settings?error=${encodeURIComponent(msg)}` : `/login?error=${encodeURIComponent(msg)}`;
    const res = NextResponse.redirect(new URL(dest, env.appUrl()));
    if (stateCookie) res.cookies.set(stateCookie, "", { path: "/api/auth", maxAge: 0 });
    return res;
  };

  const googleError = url.searchParams.get("error");
  if (googleError) {
    return fail(googleError === "access_denied" ? "Sign-in was cancelled, or Google blocked this account. Please try again." : `Google returned: ${googleError}`);
  }
  if (!code || !state) return fail("Google didn't send back a sign-in code. Please try again.");
  if (!mode) {
    return fail(
      `This sign-in couldn't be matched to one started here (it took over 30 minutes, cookies are blocked, or it was started from a different address). Open ${env.appUrl()}/login and try again.`,
    );
  }
  if (mode === "add" && !session) return fail("Please sign in first.");

  try {
    return await finishSignIn(req, code, mode, fail, stateCookie);
  } catch (e) {
    console.error("Sign-in callback error", e);
    return fail(`Sign-in failed: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
  }
}

async function finishSignIn(
  req: NextRequest,
  code: string,
  mode: string,
  fail: (msg: string) => NextResponse,
  stateCookie: string,
) {
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
  res.cookies.set(stateCookie, "", { path: "/api/auth", maxAge: 0 });
  return res;
}
