import { NextResponse, type NextRequest } from "next/server";
import { googleAuthUrl } from "@/lib/google";
import { missingEnv } from "@/lib/env";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";
import { isOwnPreview, isPreview, liveOrigin, previewOrigin } from "@/lib/preview";

/**
 * Starts Google sign-in.
 *   /api/auth/google            → sign in to the dashboard (identity only: openid + email)
 *   /api/auth/google?mode=add   → Owner connects / reconnects a Gmail account (read, send, and read/unread changes)
 *   /api/auth/google?preview=…  → (live dashboard only) sign in, then go back to that preview of a pull request
 *
 * On a preview, sign-in goes through the live dashboard, since Google only returns to the live address.
 */
export async function GET(req: NextRequest) {
  // Fail with a readable message instead of a blank 500 when setup is incomplete.
  const missing = missingEnv();
  if (missing.length) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(`Server setup incomplete. Missing: ${missing.join(", ")}`)}`, req.url));
  }
  const mode = req.nextUrl.searchParams.get("mode") === "add" ? "add" : "login";
  if (isPreview()) {
    const live = liveOrigin();
    const here = previewOrigin();
    if (mode === "add") return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent("Connect Gmail accounts on the live dashboard, not on a preview.")}`, req.url));
    if (!live || !here) return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent("This preview doesn't know the live dashboard's address.")}`, req.url));
    return NextResponse.redirect(`${live}/api/auth/google?preview=${encodeURIComponent(here)}`);
  }
  const preview = req.nextUrl.searchParams.get("preview");
  if (preview && !isOwnPreview(preview, process.env.VERCEL_URL)) {
    return NextResponse.redirect(new URL(`/login?error=${encodeURIComponent("That preview address isn't one of this dashboard's previews.")}`, req.url));
  }
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
  if (preview && mode === "login") {
    res.cookies.set(`oauth_preview_${state}`, preview, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/api/auth", maxAge: 1800 });
  }
  return res;
}
