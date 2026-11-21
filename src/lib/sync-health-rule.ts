// Pure rule (unit-tested in sync-health.test.ts).

/** Google said the saved sign-in itself is no good (revoked, expired, wrong app), not a passing outage. */
export function isRejectedSignIn(e: unknown): boolean {
  const status = (e as { status?: number }).status;
  const text = e instanceof Error ? e.message : String(e);
  return (status === 400 || status === 401) && /invalid_grant|invalid_client|unauthorized_client|deleted_client/i.test(text);
}
