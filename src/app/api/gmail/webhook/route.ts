import { after, NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { syncHistory } from "@/lib/ingest";
import { generateDrafts } from "@/lib/claude";

export const maxDuration = 300;

/**
 * Gmail → Pub/Sub push endpoint. The push subscription URL must include ?token=GMAIL_WEBHOOK_TOKEN.
 * We acknowledge immediately and do the sync + Claude drafting after the response.
 */
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== env.webhookToken()) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  after(async () => {
    try {
      const { draftEmailIds } = await syncHistory();
      await generateDrafts(draftEmailIds);
    } catch (e) {
      console.error("webhook sync failed", e);
    }
  });
  return new NextResponse(null, { status: 204 });
}
