import { NextResponse, type NextRequest } from "next/server";
import { requireAccount } from "@/lib/accounts";
import { loadThreadView } from "@/lib/thread";
import { can } from "@/lib/permissions";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The thread side panel's data: one conversation of the selected account, in full (read-only). */
export async function GET(_req: NextRequest, ctx: RouteContext<"/api/thread/[emailId]">) {
  let accountId: string;
  let canApprove = false;
  let canEdit = false;
  try {
    const a = await requireAccount("view");
    accountId = a.accountId;
    canApprove = can(a.role, "approve");
    canEdit = can(a.role, "edit");
  } catch {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { emailId } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(emailId)) return NextResponse.json({ error: "not found" }, { status: 404 });
  const view = await loadThreadView(accountId, emailId);
  if (!view) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ...view, canApprove, canEdit }, { headers: { "Cache-Control": "no-store" } });
}
