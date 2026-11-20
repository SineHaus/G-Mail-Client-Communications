// The ONLY Gmail access this app is allowed. Pure module (no server deps) so it is unit-tested.
//
// The dashboard changes almost nothing in the Gmail mailbox. It may:
//   - send an approved reply (messages.send), and
//   - add or remove the UNREAD label, so read/unread in the dashboard shows the same in Gmail
//     (and in apps that mirror Gmail, like Spark).
// Nothing else: no other labels (INBOX, STARRED, IMPORTANT…), no archive, trash or delete, no
// threads.modify, no Gmail drafts. Every modify request body is checked by assertAllowedGmailBody.

export const GMAIL_READ_SEND_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

/** Needed only to change the UNREAD label. The app's own allowlist limits it to that one label. */
export const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

/** What connecting a mailbox asks Google for. */
export const GMAIL_SCOPES = [...GMAIL_READ_SEND_SCOPES, GMAIL_MODIFY_SCOPE] as const;

/**
 * Signing in to the dashboard only proves who you are: openid + email, no mailbox access at all.
 * Mailbox access (GMAIL_SCOPES) is granted only when an Owner connects a Gmail account.
 */
export const LOGIN_SCOPES = ["openid", "email"] as const;
const LOGIN_GRANTED_OK = new Set(["openid", "email", "https://www.googleapis.com/auth/userinfo.email"]);

/** True if a sign-in token carries identity only (and no Gmail or other access). */
export function loginScopesAreSafe(scope: string | undefined): boolean {
  if (!scope) return false;
  const granted = scope.split(/\s+/).filter(Boolean);
  return granted.includes("openid") && granted.every((s) => LOGIN_GRANTED_OK.has(s));
}

/** Every Gmail API call the app may make, as [HTTP method, path pattern under users/me/]. */
const ALLOWED: readonly [string, RegExp, string][] = [
  ["GET", /^profile$/, "users.getProfile (read-only)"],
  ["GET", /^messages\?[^/]*$/, "users.messages.list (read-only)"],
  ["GET", /^messages\/[A-Za-z0-9]+\?format=(full|metadata)(&metadataHeaders=[A-Za-z-]+)*$/, "users.messages.get (read-only)"],
  ["GET", /^history\?[^/]*$/, "users.history.list (read-only)"],
  ["GET", /^threads\/[A-Za-z0-9]+\?format=full$/, "users.threads.get (read-only): a dashboard thread's earlier emails"],
  ["GET", /^messages\/[A-Za-z0-9]+\/attachments\/[A-Za-z0-9_-]+$/, "users.messages.attachments.get (read-only): opening an attachment"],
  ["POST", /^watch$/, "users.watch — push notifications only; does not change mail"],
  ["POST", /^stop$/, "users.stop — turns off push notifications when disconnecting; does not change mail"],
  ["POST", /^messages\/send$/, "users.messages.send — Accept button only"],
  ["POST", /^messages\/batchModify$/, "users.messages.batchModify — removes the UNREAD label only (mark read)"],
  ["POST", /^messages\/[A-Za-z0-9]+\/modify$/, "users.messages.modify — adds the UNREAD label only (mark unread)"],
];

const BLOCKED = (m: string, path: string, why: string) =>
  new Error(`Blocked Gmail API call ${m} users/me/${path}: ${why}`);

export function assertAllowedGmailCall(method: string, path: string): void {
  const m = method.toUpperCase();
  if (!ALLOWED.some(([am, re]) => am === m && re.test(path))) {
    throw BLOCKED(m, path, "this dashboard only reads mail, sends approved replies and changes read/unread.");
  }
}

const MESSAGE_ID = /^[A-Za-z0-9]+$/;
const MAX_BATCH = 1000; // Gmail's own limit for batchModify

/**
 * The two label-changing calls may only touch UNREAD:
 *   messages/batchModify  → { ids: [...], removeLabelIds: ["UNREAD"] }   (mark read)
 *   messages/{id}/modify  → { addLabelIds: ["UNREAD"] }                   (mark unread)
 * Any other key or label is refused. Other calls are not checked here.
 */
export function assertAllowedGmailBody(method: string, path: string, body: unknown): void {
  const m = method.toUpperCase();
  const isBatch = /^messages\/batchModify$/.test(path);
  const isOne = /^messages\/[A-Za-z0-9]+\/modify$/.test(path);
  if (!isBatch && !isOne) return;
  let b: Record<string, unknown>;
  try {
    b = typeof body === "string" ? JSON.parse(body) : (body as Record<string, unknown>);
  } catch {
    throw BLOCKED(m, path, "unreadable request body.");
  }
  if (!b || typeof b !== "object" || Array.isArray(b)) throw BLOCKED(m, path, "missing request body.");
  const keys = Object.keys(b).sort().join(",");
  const onlyUnread = (v: unknown) => Array.isArray(v) && v.length === 1 && v[0] === "UNREAD";
  if (isBatch) {
    const ids = b.ids;
    const idsOk = Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_BATCH && ids.every((i) => typeof i === "string" && MESSAGE_ID.test(i));
    if (keys !== "ids,removeLabelIds" || !idsOk || !onlyUnread(b.removeLabelIds)) {
      throw BLOCKED(m, path, "batchModify may only remove the UNREAD label.");
    }
  } else if (keys !== "addLabelIds" || !onlyUnread(b.addLabelIds)) {
    throw BLOCKED(m, path, "modify may only add the UNREAD label.");
  }
}

/**
 * True if Google granted read + send, optionally gmail.modify, and nothing broader.
 * gmail.modify is optional so mailboxes connected before it was added keep working (read status
 * just isn't copied to Gmail until they reconnect; see grantedCanModify).
 */
export function grantedScopesAreSafe(scope: string | undefined): boolean {
  if (!scope) return false;
  const granted = scope.split(/\s+/).filter(Boolean);
  return (
    GMAIL_READ_SEND_SCOPES.every((s) => granted.includes(s)) && granted.every((s) => (GMAIL_SCOPES as readonly string[]).includes(s))
  );
}

/** True if the granted scopes let the app change the UNREAD label. */
export function grantedCanModify(scope: string | undefined): boolean {
  return !!scope && scope.split(/\s+/).includes(GMAIL_MODIFY_SCOPE);
}

/** True if Gmail refused a call because the saved sign-in doesn't include the needed scope. */
export function isGmailScopeError(status: number, body: string): boolean {
  return status === 403 && /insufficientPermissions|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficient authentication scopes|Insufficient Permission/i.test(body);
}

/**
 * True if Gmail refused a call because this mailbox used up its per-minute quota (HTTP 429, or 403
 * with a rate-limit reason). Those calls are safe to retry after a pause; nothing was done.
 */
export function isGmailRateLimit(status: number, body: string): boolean {
  if (status === 429) return true;
  return status === 403 && /rateLimitExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED|Quota exceeded/i.test(body);
}

/**
 * The only two label requests the app builds. Kept here, next to the allowlist, so no other file
 * spells out a label change (gmail-policy.test.ts checks that).
 */
export function markReadRequest(gmailMessageIds: string[]) {
  return { path: "messages/batchModify", body: { ids: gmailMessageIds, removeLabelIds: ["UNREAD"] } };
}
export function markUnreadRequest(gmailMessageId: string) {
  return { path: `messages/${gmailMessageId}/modify`, body: { addLabelIds: ["UNREAD"] } };
}
export const MARK_READ_BATCH_SIZE = MAX_BATCH;
