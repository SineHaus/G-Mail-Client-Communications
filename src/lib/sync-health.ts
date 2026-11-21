import "server-only";
// Why an inbox's last check failed, so it shows on the page instead of only in Vercel's logs.
// A failed background check (push, the open dashboard's poll, the daily job) used to leave
// "agent last checked 2 min ago" on screen while no new mail came in.

import { db } from "./db";

const key = (accountId: string) => `sync_error:${accountId}`;

export type SyncError = { at: string; where: string; message: string };

export async function recordSyncError(accountId: string, where: string, e: unknown) {
  const message = (e instanceof Error ? e.message : String(e)).replace(/\s+/g, " ").slice(0, 300);
  const value: SyncError = { at: new Date().toISOString(), where, message };
  const { error } = await db()
    .from("app_settings")
    .upsert({ key: key(accountId), value: JSON.stringify(value), updated_by: "system", updated_at: value.at }, { onConflict: "key" });
  if (error) console.error("sync error not recorded", accountId, error.message);
}

export async function clearSyncError(accountId: string) {
  await db().from("app_settings").delete().eq("key", key(accountId));
}

export async function lastSyncError(accountId: string): Promise<SyncError | null> {
  const { data } = await db().from("app_settings").select("value").eq("key", key(accountId)).maybeSingle();
  if (!data) return null;
  try {
    return JSON.parse((data as { value: string }).value) as SyncError;
  } catch {
    return null;
  }
}

export { isRejectedSignIn } from "./sync-health-rule";
