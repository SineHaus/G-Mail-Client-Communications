import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST() {
  const res = NextResponse.redirect(new URL("/login", env.appUrl()), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
