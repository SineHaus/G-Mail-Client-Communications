import "server-only";
import { db } from "./db";

/**
 * Save `body` as the next version of an open draft (atomic in the database: the given version is
 * closed and the new one opened). Refuses if the given version isn't the open one any more.
 * Returns the new version's draft id.
 */
export async function newDraftVersion(draftId: string, body: string, createdBy: string, note: string | null = null): Promise<string> {
  const { data, error } = await db().rpc("new_draft_version", {
    p_draft: draftId,
    p_body: body,
    p_created_by: createdBy,
    p_note: note,
  });
  if (error) {
    if (/draft_not_open/.test(error.message)) {
      throw new Error("This draft changed since you opened it (a newer version exists or it was handled). Reload to see the latest.");
    }
    throw new Error(error.message);
  }
  return data as string;
}
