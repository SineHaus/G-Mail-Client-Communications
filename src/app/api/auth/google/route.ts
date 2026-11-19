import { NextResponse, type NextRequest } from "next/server";
import { googleAuthUrl } from "@/lib/google";
import { missingEnv } from "@/lib/env";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";

/**
 * Starts Google sign-in.
 *   /api/auth/google            → sign in to the dashboard (identity only: openid + email)
 *   /api/auth/google?mode=add   → Owner connects / reconnects a Gmail account (read, send, and read/unread changes)
 */
export async function GET(req: NextRequest) {
  // Fail with a readable message instead of a blank 500 when setup is incomplete.
  const missing = missingEnv();
  if (missing.length) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(`Server setup incomplete. Missing: ${missing.join(", ")}`)}`, req.url));
  }
  const mode = req.nextUrl.searchParams.get("mode") === "add" ? "add" : "login";
  if (mode === "add" && !(await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null))) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const state = crypto.randomUUID();
  const hint = req.nextUrl.searchParams.get("hint") ?? undefined;
  const res = NextResponse.redirect(googleAuthUrl(state, mode === "add" ? "connect" : "login", hint));
  // One cookie per attempt, so finishing an older Google tab still works, and 30 minutes to finish.
  res.cookies.set(`oauth_state_${state}`, mode, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 1800,
  });
  return res;
}
