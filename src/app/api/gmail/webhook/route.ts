import { after, NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { syncHistory } from "@/lib/ingest";
import { generateDrafts } from "@/lib/claude";

export const maxDuration = 300;

/**
 * Gmail → Pub/Sub push endpoint, shared by all accounts. The push subscription URL must include
 * ?token=GMAIL_WEBHOOK_TOKEN. Each notification names the mailbox it is about
 * ({"emailAddress": ..., "historyId": ...}); we route it to that account only.
 */
export async function POST(req: NextRequest) {
  if (req.nextUrl.searchParams.get("token") !== env.webhookToken()) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  let emailAddress: string | undefined;
  try {
    const body = (await req.json()) as { message?: { data?: string } };
    const data = JSON.parse(Buffer.from(body.message?.data ?? "", "base64").toString("utf8")) as { emailAddress?: string };
    emailAddress = data.emailAddress?.toLowerCase();
  } catch {
    return new NextResponse(null, { status: 204 }); // malformed: ack so Pub/Sub doesn't retry forever
  }
  if (!emailAddress) return new NextResponse(null, { status: 204 });

  const { data: acct } = await db()
    .from("gmail_accounts")
    .select("id")
    .eq("email_address", emailAddress)
    .not("refresh_token_encrypted", "is", null) // disconnected accounts are ignored
    .maybeSingle();
  if (!acct) return new NextResponse(null, { status: 204 });

  const accountId = (acct as { id: string }).id;
  after(async () => {
    try {
      const { draftEmailIds } = await syncHistory(accountId);
      await generateDrafts(accountId, draftEmailIds);
    } catch (e) {
      console.error("webhook sync failed", emailAddress, e);
    }
  });
  return new NextResponse(null, { status: 204 });
}
