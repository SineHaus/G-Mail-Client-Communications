import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { exchangeCode, exchangeLoginCode, getAccount, saveAccountToken } from "@/lib/google";
import { findMember, memberForSignIn } from "@/lib/team";
import { audit } from "@/lib/audit";
import { syncRecent } from "@/lib/ingest";
import { draftDeadline, draftMissing } from "@/lib/draft-queue";
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
    return await finishSignIn(code, mode, fail, stateCookie, session);
  } catch (e) {
    console.error("Sign-in callback error", e);
    return fail(`Sign-in failed: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
  }
}

async function finishSignIn(
  code: string,
  mode: string,
  fail: (msg: string) => NextResponse,
  stateCookie: string,
  session: { email: string } | null,
) {
  if (mode !== "add") {
    // Dashboard sign-in: identity only. Must be an active team member (or a bootstrap Owner in ALLOWED_EMAILS).
    const { email, scopesOk } = await exchangeLoginCode(code);
    if (!scopesOk) return fail("Google returned unexpected permissions for sign-in. Please try again.");
    const member = await memberForSignIn(email);
    if (!member) return fail(`${email} isn't on the TERG team list. Ask Leo to add you in Settings → Team.`);
    await audit(email, "sign_in");
    const res = NextResponse.redirect(new URL("/", env.appUrl()));
    res.cookies.set(SESSION_COOKIE, await createSessionValue(email), sessionCookieOptions);
    res.cookies.set(stateCookie, "", { path: "/api/auth", maxAge: 0 });
    return res;
  }

  // Connecting a Gmail account: Owners only.
  const owner = session ? await findMember(session.email) : null;
  if (!owner?.is_owner) return fail("Only the Owner can connect Gmail accounts.");

  const { tokens, email, scopesOk } = await exchangeCode(code);
  if (!scopesOk) {
    return fail(
      "Google granted different permissions than read + send. Remove the app at myaccount.google.com/permissions and try again, allowing both.",
    );
  }
  if (!tokens.refresh_token) {
    return fail("Google didn't return a refresh token. Remove the app at myaccount.google.com/permissions and try again.");
  }
  const saved = await saveAccountToken(email, tokens.refresh_token); // stored encrypted, server side only
  const accountId = saved.id;
  const acct = await getAccount(accountId);
  await audit(owner.email, saved.isNew ? "account_connected" : "account_reconnected", { accountId, detail: email });

  if (saved.isNew || !acct.history_id) {
    // New or reconnected account: import recent mail, start its own push watch, draft replies — in the background.
    const startedAt = Date.now(); // within a few seconds of the request's start; draftDeadline leaves 20 s spare
    after(async () => {
      try {
        const { draftEmailIds } = await syncRecent(accountId);
        await startWatch(accountId).catch((e) => console.error("watch failed", email, e));
        await draftMissing(accountId, draftDeadline(startedAt, maxDuration), draftEmailIds);
      } catch (e) {
        console.error("Initial sync failed", email, e);
      }
    });
  }

  const res = NextResponse.redirect(new URL("/?added=1", env.appUrl()));
  res.cookies.set(ACCOUNT_COOKIE, accountId, accountCookieOptions); // switch to the account just connected
  res.cookies.set(stateCookie, "", { path: "/api/auth", maxAge: 0 });
  return res;
}
