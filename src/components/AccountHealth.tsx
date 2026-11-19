import { timeAgo } from "@/lib/format";
import { readSyncNeedsReconnect } from "@/lib/read-sync";

/**
 * "Agent last checked X ago" + reconnect banner when the account's Gmail link isn't healthy, and a
 * reconnect note when its sign-in can't copy read/unread to Gmail yet.
 */
export default async function AccountHealth({
  account,
  isOwner,
}: {
  account: { id: string; email_address: string; connected: boolean; last_synced_at: string | null; last_error: string | null; watch_expiration: string | null };
  isOwner: boolean;
}) {
  const reconnect = `/api/auth/google?mode=add&hint=${encodeURIComponent(account.email_address)}`;
  // eslint-disable-next-line react-hooks/purity -- server component, rendered per request
  const now = Date.now();
  const live = !!account.watch_expiration && new Date(account.watch_expiration).getTime() > now;
  const problem = !account.connected
    ? `${account.email_address} is disconnected. You can still browse its history.`
    : account.last_error
      ? `Gmail stopped accepting the saved sign-in for ${account.email_address}. New mail isn't coming in.`
      : null;

  if (problem) {
    return (
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
        <span>⚠ {problem}</span>
        {isOwner ? (
          <a className="btn-brand ml-auto" href={reconnect}>Reconnect</a>
        ) : (
          <span className="ml-auto text-xs">Ask Leo to reconnect it.</span>
        )}
      </div>
    );
  }
  const readSyncOff = account.connected && (await readSyncNeedsReconnect(account.id).catch(() => false));
  return (
    <>
    {readSyncOff && (
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <span>Read and unread here aren&apos;t reaching Gmail (or Spark) for {account.email_address} yet. Reconnect it once to allow that.</span>
        {isOwner ? (
          <a className="btn-brand ml-auto" href={reconnect}>Reconnect</a>
        ) : (
          <span className="ml-auto text-xs">Ask Leo to reconnect it.</span>
        )}
      </div>
    )}
    <p className="mb-4 flex flex-wrap items-center gap-2 text-xs text-stone-500">
      <span className={`h-2 w-2 rounded-full ${live ? "bg-emerald-500" : "bg-amber-500"}`} />
      {live ? "Live updates on" : "Live updates off — new mail arrives on the next check"}
      <span>· agent last checked {account.last_synced_at ? timeAgo(account.last_synced_at) : "never"}</span>
    </p>
    </>
  );
}
