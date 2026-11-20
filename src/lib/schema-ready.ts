import "server-only";
import { db } from "./db";

// Whether migration 006 has been run. Until then the dashboard works as before: attachments are read
// live from Gmail when a thread is opened, and the Quotes page shows the projects it already knows.

const missing = (e: { code?: string; message: string }) =>
  e.code === "42P01" || e.code === "42703" || e.code === "PGRST204" || e.code === "PGRST205" || /could not find|does not exist/i.test(e.message);

function probe(check: () => PromiseLike<{ error: { code?: string; message: string } | null }>) {
  let ready = false;
  let checkedAt = 0;
  return async (): Promise<boolean> => {
    if (ready) return true;
    if (Date.now() - checkedAt < 5 * 60_000) return false;
    const { error } = await check();
    checkedAt = Date.now();
    if (!error) return (ready = true);
    if (missing(error)) return false;
    throw new Error(error.message);
  };
}

/** emails.attachments exists (migration 006). */
// Probes match no row (an account id that can't exist); they only ask whether the column/table is there.
const NO_ACCOUNT = "00000000-0000-0000-0000-000000000000";

export const attachmentsColumnReady = probe(() => db().from("emails").select("attachments").eq("account_id", NO_ACCOUNT).limit(1));

/** goodshuffle_projects exists (migration 006). */
export const goodshuffleProjectsReady = probe(() => db().from("goodshuffle_projects").select("id").eq("account_id", NO_ACCOUNT).limit(1));

/** goodshuffle_messages, goodshuffle_replies and goodshuffle_devices exist (migration 007). */
export const goodshuffleMessagesReady = probe(() => db().from("goodshuffle_replies").select("id").eq("account_id", NO_ACCOUNT).limit(1));
