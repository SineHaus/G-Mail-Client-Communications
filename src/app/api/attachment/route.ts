import { NextResponse, type NextRequest } from "next/server";
import { requireAccount } from "@/lib/accounts";
import { db, must } from "@/lib/db";
import { gmailFor } from "@/lib/google";
import { canShowInline, findPartById } from "@/lib/email-parse";

export const dynamic = "force-dynamic";

/**
 * Opens one attachment of an email of the selected account, read from Gmail (nothing is stored).
 * Pictures and PDFs open in the browser; everything else downloads. The response is sandboxed so a
 * file can never run as part of the dashboard.
 */
export async function GET(req: NextRequest) {
  let accountId: string;
  try {
    accountId = (await requireAccount("view")).accountId;
  } catch {
    return new NextResponse("Sign in first.", { status: 401 });
  }
  const emailId = req.nextUrl.searchParams.get("email") ?? "";
  const partId = req.nextUrl.searchParams.get("part") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(emailId) || !/^[0-9.]{1,20}$/.test(partId)) return new NextResponse("Not found.", { status: 404 });

  const row = (must(
    await db().from("emails").select("gmail_message_id").eq("account_id", accountId).eq("id", emailId).limit(1),
  ) as { gmail_message_id: string }[])[0];
  if (!row) return new NextResponse("Not found.", { status: 404 });

  const gmail = gmailFor(accountId);
  const msg = await gmail.getMessage(row.gmail_message_id);
  const part = findPartById(msg, partId);
  if (!part || !part.filename) return new NextResponse("That file isn't on this email anymore.", { status: 404 });

  const data = part.body?.attachmentId ? (await gmail.getAttachment(msg.id, part.body.attachmentId)).data : part.body?.data;
  if (!data) return new NextResponse("That file couldn't be read from Gmail.", { status: 502 });
  const bytes = Buffer.from(data.replace(/-/g, "+").replace(/_/g, "/"), "base64");

  const type = (part.mimeType || "application/octet-stream").toLowerCase();
  const inline = canShowInline(type);
  const name = part.filename.replace(/[\r\n"\\]/g, "_");
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "Content-Type": inline ? type : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${name.replace(/[^\x20-\x7e]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(part.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; plugin-types application/pdf",
      "Cache-Control": "private, no-store",
    },
  });
}
