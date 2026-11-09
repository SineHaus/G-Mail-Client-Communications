import { NextResponse } from "next/server";
import { googleAuthUrl } from "@/lib/google";

export async function GET() {
  const state = crypto.randomUUID();
  const res = NextResponse.redirect(googleAuthUrl(state));
  res.cookies.set("oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  return res;
}
