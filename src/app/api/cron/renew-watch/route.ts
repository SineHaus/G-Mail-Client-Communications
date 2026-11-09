import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { startWatch } from "@/lib/watch";
import { syncHistory } from "@/lib/ingest";
import { generateDrafts } from "@/lib/claude";

export const maxDuration = 300;

/** Daily (vercel.json): renew the Gmail watch and catch up on anything push may have missed. */
export async function GET(req: NextRequest) {
  const secret = env.cronSecret();
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const watch = await startWatch();
  const { draftEmailIds } = await syncHistory();
  await generateDrafts(draftEmailIds);
  return NextResponse.json({ watch, drafted: draftEmailIds.length });
}
