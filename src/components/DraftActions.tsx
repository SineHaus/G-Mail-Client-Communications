"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptDraftAction, declineDraftAction, regenerateDraftAction } from "@/app/actions";

/** Accept (two-step confirm, sends via Gmail) · Review · Decline. */
export default function DraftActions({
  draftId,
  to,
  failed,
  body,
  afterDone,
  compact,
}: {
  draftId: string;
  to: string;
  failed?: boolean;
  body?: () => string; // when used in the editor, send the edited text
  afterDone?: string;
  compact?: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const finish = (r: { ok: boolean; error?: string }) => {
    if (!r.ok) return setError(r.error ?? "Something went wrong");
    if (afterDone) router.push(afterDone);
    else router.refresh();
  };

  if (failed) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-brand" disabled={pending} onClick={() => start(async () => finish(await regenerateDraftAction(draftId)))}>
          {pending ? "Drafting…" : "Retry draft"}
        </button>
        <button className="btn-danger" disabled={pending} onClick={() => start(async () => finish(await declineDraftAction(draftId)))}>
          Dismiss
        </button>
        {error && <span className="text-xs text-red-700">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {confirming ? (
          <>
            <button
              className="btn-primary"
              disabled={pending}
              onClick={() => start(async () => finish(await acceptDraftAction(draftId, body?.())))}
            >
              {pending ? "Sending…" : `Send to ${to}`}
            </button>
            <button className="btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn-primary" onClick={() => { setError(null); setConfirming(true); }}>
              ✓ Accept
            </button>
            {!compact && (
              <Link className="btn-secondary" href={`/review/${draftId}`}>
                ✎ Review
              </Link>
            )}
            <button className="btn-danger" disabled={pending} onClick={() => start(async () => finish(await declineDraftAction(draftId)))}>
              ✕ Decline
            </button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
