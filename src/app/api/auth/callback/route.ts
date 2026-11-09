import { after, NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { clearTokenCache, exchangeCode } from "@/lib/google";
import { syncRecent } from "@/lib/ingest";
import { generateDrafts } from "@/lib/claude";
import { startWatch } from "@/lib/watch";
import { createSessionValue, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const fail = (msg: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, env.appUrl()));

  if (url.searchParams.get("error")) return fail(url.searchParams.get("error")!);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state || state !== req.cookies.get("oauth_state")?.value) return fail("Sign-in expired, please try again.");

  const { tokens, email, emailVerified } = await exchangeCode(code);
  if (!emailVerified || !env.allowedEmails().includes(email)) return fail(`${email} is not allowed to use this dashboard.`);

  const existing = await db().from("gmail_account").select("email,history_id").eq("id", 1).maybeSingle();
  const isNew = !existing.data || existing.data.email !== email;
  if (tokens.refresh_token) {
    const row: Record<string, unknown> = { id: 1, email, refresh_token: tokens.refresh_token, updated_at: new Date().toISOString() };
    if (isNew) row.history_id = null;
    // Switching to a different Gmail account resets the sync position.
    const up = await db().from("gmail_account").upsert(row);
    if (up.error) return fail(`Database error: ${up.error.message}`);
    clearTokenCache();
  } else if (!existing.data) {
    return fail("Google didn't return a refresh token. Remove the app at myaccount.google.com/permissions and sign in again.");
  }

  if (isNew || !existing.data?.history_id) {
    // First connection: import recent mail, draft replies, and start push notifications in the background.
    after(async () => {
      try {
        const { draftEmailIds } = await syncRecent();
        await startWatch().catch((e) => console.error("watch failed", e));
        await generateDrafts(draftEmailIds);
      } catch (e) {
        console.error("Initial sync failed", e);
      }
    });
  }

  const res = NextResponse.redirect(new URL("/", env.appUrl()));
  res.cookies.set(SESSION_COOKIE, await createSessionValue(email), sessionCookieOptions);
  res.cookies.delete("oauth_state");
  return res;
}
