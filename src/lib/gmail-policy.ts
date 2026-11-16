// The ONLY Gmail access this app is allowed. Pure module (no server deps) so it is unit-tested.
//
// The dashboard must never change anything in the Gmail mailbox: no label changes (UNREAD, INBOX…),
// no modify/batchModify/threads.modify, no trash/delete, no Gmail drafts. Read/unread status is
// tracked only in Supabase (emails.is_read). The single write is messages.send for an approved reply.

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

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
  ["POST", /^watch$/, "users.watch — push notifications only; does not change mail"],
  ["POST", /^stop$/, "users.stop — turns off push notifications when disconnecting; does not change mail"],
  ["POST", /^messages\/send$/, "users.messages.send — Accept button only"],
];

export function assertAllowedGmailCall(method: string, path: string): void {
  const m = method.toUpperCase();
  if (!ALLOWED.some(([am, re]) => am === m && re.test(path))) {
    throw new Error(`Blocked Gmail API call ${m} users/me/${path}: this dashboard never modifies the Gmail mailbox.`);
  }
}

/** True if Google granted exactly the allowed Gmail scopes and nothing broader. */
export function grantedScopesAreSafe(scope: string | undefined): boolean {
  if (!scope) return false;
  const granted = scope.split(/\s+/).filter(Boolean);
  return GMAIL_SCOPES.every((s) => granted.includes(s)) && granted.every((s) => (GMAIL_SCOPES as readonly string[]).includes(s));
}

/**
 * True if Gmail refused a call because this mailbox used up its per-minute quota (HTTP 429, or 403
 * with a rate-limit reason). Those calls are safe to retry after a pause; nothing was done.
 */
export function isGmailRateLimit(status: number, body: string): boolean {
  if (status === 429) return true;
  return status === 403 && /rateLimitExceeded|userRateLimitExceeded|RATE_LIMIT_EXCEEDED|Quota exceeded/i.test(body);
}
