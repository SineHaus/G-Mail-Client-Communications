"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDraftAction, declineDraftAction, regenerateDraftAction } from "@/app/actions";

/**
 * Approve (two-step confirm; sends exactly the text shown) · Review · Decline.
 * Buttons appear only if the person's role on this account allows them.
 */
export default function DraftActions({
  draftId,
  to,
  failed,
  body,
  getBody,
  afterDone,
  compact,
  canEdit,
  canApprove,
  onDone,
}: {
  draftId: string;
  to: string;
  failed?: boolean;
  body?: string; // the stored text (Queue cards)
  getBody?: () => string; // the exact text on screen (editor, may include unsaved edits)
  afterDone?: string;
  compact?: boolean;
  canEdit: boolean;
  canApprove: boolean;
  onDone?: () => void; // after a send or decline (the thread panel reloads)
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const finish = (r: { ok: boolean; error?: string }) => {
    if (!r.ok) {
      setConfirming(false);
      return setError(r.error ?? "Something went wrong");
    }
    onDone?.();
    if (afterDone) router.push(afterDone);
    else router.refresh();
  };

  if (!canEdit) {
    return compact ? null : <Link className="btn-secondary" href={`/review/${draftId}`}>View</Link>;
  }

  if (failed) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button className="btn-brand" disabled={pending} onClick={() => start(async () => finish(await regenerateDraftAction(draftId)))}>
          {pending ? "Drafting…" : "Retry draft"}
        </button>
        <button className="btn-danger" disabled={pending} onClick={() => start(async () => finish(await declineDraftAction(draftId)))}>
          Decline
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
              onClick={() => start(async () => finish(await approveDraftAction(draftId, getBody ? getBody() : body ?? "")))}
            >
              {pending ? "Sending…" : `Send to ${to}`}
            </button>
            <button className="btn-ghost" disabled={pending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            {canApprove ? (
              <button className="btn-primary" onClick={() => { setError(null); setConfirming(true); }}>
                ✓ Approve
              </button>
            ) : (
              <span className="text-xs text-stone-500" title="Only the Owner or an Approver on this account can send">Approve: Approver only</span>
            )}
            {!compact && (
              <Link className="btn-secondary" href={`/review/${draftId}`}>
                ✎ Review
              </Link>
            )}
            <button
              className="btn-danger"
              disabled={pending}
              title="Handle it yourself outside the dashboard. Nothing is sent."
              onClick={() => start(async () => finish(await declineDraftAction(draftId)))}
            >
              ✕ Decline
            </button>
          </>
        )}
      </div>
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
