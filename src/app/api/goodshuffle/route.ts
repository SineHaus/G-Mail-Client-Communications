import { after, NextResponse } from "next/server";
import { assertSupportLogin, claimReply, deviceFromRequest, draftMany, reportResult, storeMessages, workFor } from "@/lib/goodshuffle-messages";
import { goodshuffleMessagesReady } from "@/lib/schema-ready";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * The Chrome extension's one endpoint (extensions/goodshuffle-messages). It signs in with a device token
 * from Settings, and every call says which Goodshuffle login it sees; anything but support@ is refused.
 *
 *   { op: "work", signedInAs }                          → projects to read, and whether replies wait to be sent
 *   { op: "sync", signedInAs, projects: [{projectId, messages}] } → stores messages; Claude drafts replies
 *   { op: "claim", signedInAs }                         → the next approved reply (it's now "sending")
 *   { op: "result", signedInAs, id, sent, gspMessageId?, error? } → how the send went
 *
 * The extension never gets a reply that a person hasn't approved in the dashboard.
 */
export async function POST(req: Request) {
  const device = await deviceFromRequest(req).catch(() => null);
  if (!device) return NextResponse.json({ error: "This Chrome isn't connected. Make a new token in the dashboard's Settings." }, { status: 401 });
  if (!(await goodshuffleMessagesReady())) return NextResponse.json({ error: "The dashboard's database needs migration 007 first." }, { status: 503 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Bad request." }, { status: 400 });
  }
  try {
    await assertSupportLogin(device, body.signedInAs);
    switch (body.op) {
      case "work":
        return NextResponse.json(await workFor(device));
      case "sync": {
        const projects = Array.isArray(body.projects) ? (body.projects as { projectId: string; messages: unknown[] }[]) : [];
        const toDraft = await storeMessages(device, projects);
        if (toDraft.length) {
          const deadline = Date.now() + (maxDuration - 20) * 1000;
          after(() => draftMany(device.account_id, toDraft, deadline));
        }
        return NextResponse.json({ stored: projects.length, drafting: toDraft.length });
      }
      case "claim":
        return NextResponse.json({ reply: await claimReply(device) });
      case "result": {
        const id = typeof body.id === "string" ? body.id : "";
        if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Bad request." }, { status: 400 });
        await reportResult(
          device,
          id,
          body.sent === true
            ? { sent: true, gspMessageId: typeof body.gspMessageId === "string" ? body.gspMessageId : undefined }
            : { sent: false, error: typeof body.error === "string" && body.error ? body.error : "The extension couldn't send it." },
        );
        return NextResponse.json({ ok: true });
      }
      default:
        return NextResponse.json({ error: "Unknown request." }, { status: 400 });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("goodshuffle extension call failed", body.op, msg);
    return NextResponse.json({ error: msg }, { status: /signed in as another account/.test(msg) ? 403 : 500 });
  }
}
