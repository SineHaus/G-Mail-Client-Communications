// The ONLY Gmail access this app is allowed. Pure module (no server deps) so it is unit-tested.
//
// The dashboard must never change anything in the Gmail mailbox: no label changes (UNREAD, INBOX…),
// no modify/batchModify/threads.modify, no trash/delete, no Gmail drafts. Read/unread status is
// tracked only in Supabase (emails.is_read). The single write is messages.send for an approved reply.

export const GMAIL_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
] as const;

/** Every Gmail API call the app may make, as [HTTP method, path pattern under users/me/]. */
const ALLOWED: readonly [string, RegExp, string][] = [
  ["GET", /^profile$/, "users.getProfile (read-only)"],
  ["GET", /^messages\?[^/]*$/, "users.messages.list (read-only)"],
  ["GET", /^messages\/[A-Za-z0-9]+\?format=(full|metadata)(&metadataHeaders=[A-Za-z-]+)*$/, "users.messages.get (read-only)"],
  ["GET", /^history\?[^/]*$/, "users.history.list (read-only)"],
  ["POST", /^watch$/, "users.watch — push notifications only; does not change mail"],
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
