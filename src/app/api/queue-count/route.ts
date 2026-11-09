import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireSession();
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { count, data } = await db()
    .from("drafts")
    .select("created_at", { count: "exact" })
    .in("status", ["pending", "revised"])
    .order("created_at", { ascending: false })
    .limit(1);
  return NextResponse.json({ count: count ?? 0, latest: data?.[0]?.created_at ?? null });
}
