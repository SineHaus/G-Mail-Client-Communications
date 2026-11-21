import { NextResponse, type NextRequest } from "next/server";
import { findMember } from "@/lib/team";
import { isPreview, previewOrigin, readPreviewPass } from "@/lib/preview";
import { createSessionValue, SESSION_COOKIE, sessionCookieOptions } from "@/lib/session";

export const dynamic = "force-dynamic";

/**
 * A preview of a pull request: the live dashboard signed the person in with Google and sent them back
 * here with a one-minute pass made for this preview only. Only works on a preview deployment.
 */
export async function GET(req: NextRequest) {
  const here = previewOrigin();
  const back = (msg: string) => NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(msg)}`, req.url));
  if (!isPreview() || !here) return back("This only works on a preview.");
  const email = await readPreviewPass(req.nextUrl.searchParams.get("pass") ?? "", here, process.env.SESSION_SECRET ?? "").catch(() => null);
  if (!email) return back("That sign-in link expired or wasn't for this preview. Sign in again.");
  if (!(await findMember(email))) return back(`${email} isn't on the TERG team list.`);
  const res = NextResponse.redirect(new URL("/", here));
  res.cookies.set(SESSION_COOKIE, await createSessionValue(email), sessionCookieOptions);
  return res;
}
