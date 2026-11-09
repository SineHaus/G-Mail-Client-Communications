import { NextResponse, type NextRequest } from "next/server";
import { googleAuthUrl } from "@/lib/google";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";

/**
 * Starts Google sign-in.
 *   /api/auth/google            → sign in to the dashboard (connects that Gmail account too)
 *   /api/auth/google?mode=add   → add / reconnect another Gmail account (must already be signed in)
 * Same scopes either way: gmail.readonly + gmail.send.
 */
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") === "add" ? "add" : "login";
  if (mode === "add" && !(await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value))) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  const state = crypto.randomUUID();
  const hint = req.nextUrl.searchParams.get("hint") ?? undefined;
  const res = NextResponse.redirect(googleAuthUrl(state, hint));
  res.cookies.set("oauth_state", `${state}.${mode}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
