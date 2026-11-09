import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { renewExpiringWatches } from "@/lib/watch";
import { syncHistory } from "@/lib/ingest";
import { generateDrafts } from "@/lib/claude";

export const maxDuration = 300;

/**
 * Daily (vercel.json). For EACH connected account separately:
 *  - renew its Gmail watch if it expires within 3 days (watches last 7 days, so it never lapses)
 *  - catch up on anything push may have missed
 * One account failing doesn't stop the others.
 */
export async function GET(req: NextRequest) {
  const secret = env.cronSecret();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const watches = await renewExpiringWatches(72);
  const { data } = await db().from("gmail_accounts").select("id,email_address").not("refresh_token_encrypted", "is", null);
  const syncs: { account: string; drafted?: number; error?: string }[] = [];
  for (const a of (data ?? []) as { id: string; email_address: string }[]) {
    try {
      const { draftEmailIds } = await syncHistory(a.id);
      await generateDrafts(a.id, draftEmailIds);
      syncs.push({ account: a.email_address, drafted: draftEmailIds.length });
    } catch (e) {
      syncs.push({ account: a.email_address, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return NextResponse.json({ watches, syncs });
}
