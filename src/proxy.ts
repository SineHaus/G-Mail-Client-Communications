import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionValue } from "@/lib/session";

// Paths reachable without signing in.
const PUBLIC = ["/login", "/api/auth/", "/api/gmail/webhook", "/api/cron/"];

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  // In production, always use the one address Google returns to (APP_URL). Opening the app via another
  // Vercel address (e.g. from the Vercel dashboard) would otherwise break sign-in.
  if (process.env.VERCEL_ENV === "production" && process.env.APP_URL && req.method === "GET" &&
      (!pathname.startsWith("/api/") || pathname === "/api/auth/google")) {
    const canonical = new URL(process.env.APP_URL);
    if (req.nextUrl.host !== canonical.host) {
      return NextResponse.redirect(new URL(pathname + req.nextUrl.search, canonical.origin), 308);
    }
  }
  if (PUBLIC.some((p) => pathname === p || pathname.startsWith(p))) return NextResponse.next();
  // If SESSION_SECRET is missing, treat everyone as signed out; the login page lists what's missing.
  const session = await verifySessionValue(req.cookies.get(SESSION_COOKIE)?.value).catch(() => null);
  if (session) return NextResponse.next();
  if (pathname.startsWith("/api/")) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  return NextResponse.redirect(new URL("/login", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|jpg)$).*)"],
};
