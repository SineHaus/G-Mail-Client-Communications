"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  approveBuildAction,
  approveSendAction,
  decideCommandChangeAction,
  markBuiltAction,
  markQuoteSentAction,
  moveQuoteAction,
  setGoodshuffleLinkAction,
  startQuoteAction,
  updateQuoteAction,
} from "@/app/actions";

type R = { ok: boolean; error?: string };

function useAct() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const act = (fn: () => Promise<R>, after?: () => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) return setError(r.error ?? "Something went wrong");
      after?.();
      router.refresh();
    });
  return { pending, error, act };
}

const Err = ({ e }: { e: string | null }) => (e ? <p className="text-xs text-red-700">{e}</p> : null);

/** The buttons on a quote card, by stage. Approve steps appear only for people with send rights. */
export function QuoteStageActions({
  id,
  stage,
  goodshuffleUrl,
  canEdit,
  canApprove,
  missingCount,
}: {
  id: string;
  stage: string;
  goodshuffleUrl: string | null;
  canEdit: boolean;
  canApprove: boolean;
  missingCount: number;
}) {
  const { pending, error, act } = useAct();
  const [url, setUrl] = useState(goodshuffleUrl ?? "");
  const [closing, setClosing] = useState(false);
  const [reason, setReason] = useState("");
  if (!canEdit) return null;
  const approveOnly = <span className="text-xs text-stone-500">Approve: Owner or Approver only</span>;

  if (closing) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <input className="input max-w-sm" placeholder="Why? (e.g. booked elsewhere, no reply)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <button className="btn-danger" disabled={pending} onClick={() => act(() => moveQuoteAction(id, "closed", reason))}>
          Close it
        </button>
        <button className="btn-ghost" onClick={() => setClosing(false)}>Cancel</button>
        <Err e={error} />
      </div>
    );
  }
  const close = (
    <button className="btn-ghost" disabled={pending} onClick={() => setClosing(true)} title="Lost, cancelled or not a real quote request">
      Close
    </button>
  );

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {stage === "gathering" && (
          <>
            <span className="text-xs text-stone-500">
              {missingCount ? `Waiting on the customer for ${missingCount} detail${missingCount === 1 ? "" : "s"}.` : "Waiting on the customer."}
            </span>
            <button className="btn-secondary" disabled={pending} onClick={() => act(() => moveQuoteAction(id, "ready_to_build"))}>
              Ready anyway
            </button>
            {close}
          </>
        )}
        {stage === "ready_to_build" && (
          <>
            {canApprove ? (
              <button className="btn-primary" disabled={pending} onClick={() => act(() => approveBuildAction(id))}>
                ✓ Approve: put the quote together
              </button>
            ) : (
              approveOnly
            )}
            <button className="btn-secondary" disabled={pending} onClick={() => act(() => moveQuoteAction(id, "gathering"))}>
              Back to gathering info
            </button>
            {close}
          </>
        )}
        {stage === "building" && (
          <>
            <input className="input max-w-md" placeholder="Paste the Goodshuffle project link" value={url} onChange={(e) => setUrl(e.target.value)} />
            <button className="btn-brand" disabled={pending || !url.trim()} onClick={() => act(() => markBuiltAction(id, url))}>
              Quote is built
            </button>
            {close}
          </>
        )}
        {stage === "ready_to_send" && (
          <>
            {canApprove ? (
              <button className="btn-primary" disabled={pending} onClick={() => act(() => approveSendAction(id))}>
                ✓ Approve: send the quote
              </button>
            ) : (
              approveOnly
            )}
            {close}
          </>
        )}
        {stage === "approved_to_send" && (
          <>
            <button className="btn-brand" disabled={pending} onClick={() => act(() => markQuoteSentAction(id))}>
              I sent it from Goodshuffle
            </button>
            {close}
          </>
        )}
        {stage === "quote_sent" && close}
        {stage === "closed" && (
          <button className="btn-secondary" disabled={pending} onClick={() => act(() => moveQuoteAction(id, "gathering"))}>
            Reopen
          </button>
        )}
      </div>
      <Err e={error} />
    </div>
  );
}

/** Edit the answers, items and title by hand (only before it's approved to build). */
export function QuoteEditor({
  id,
  title,
  checklist,
  info,
  itemsText,
}: {
  id: string;
  title: string;
  checklist: { key: string; label: string; optional: boolean }[];
  info: Record<string, string>;
  itemsText: string;
}) {
  const { pending, error, act } = useAct();
  const [open, setOpen] = useState(false);
  const [t, setT] = useState(title);
  const [vals, setVals] = useState(info);
  const [items, setItems] = useState(itemsText);
  if (!open) {
    return (
      <button className="btn-ghost" onClick={() => setOpen(true)}>
        ✎ Edit details
      </button>
    );
  }
  return (
    <div className="w-full space-y-3 rounded-lg border border-stone-200 bg-stone-50 p-3">
      <label className="block">
        <span className="label">Title</span>
        <input className="input" value={t} onChange={(e) => setT(e.target.value)} />
      </label>
      <div className="grid gap-2 md:grid-cols-2">
        {checklist
          .filter((c) => c.key !== "items_and_quantities")
          .map((c) => (
            <label key={c.key} className="block">
              <span className="label">
                {c.label}
                {c.optional ? " (optional)" : ""}
              </span>
              <input className="input" value={vals[c.key] ?? ""} onChange={(e) => setVals({ ...vals, [c.key]: e.target.value })} />
            </label>
          ))}
      </div>
      <label className="block">
        <span className="label">Items, one per line (e.g. 10 x white chairs)</span>
        <textarea className="input min-h-28 font-mono text-xs" value={items} onChange={(e) => setItems(e.target.value)} />
      </label>
      <div className="flex items-center gap-2">
        <button
          className="btn-brand"
          disabled={pending}
          onClick={() =>
            act(
              () => updateQuoteAction(id, { title: t, info: vals, itemsText: items }),
              () => setOpen(false),
            )
          }
        >
          Save
        </button>
        <button className="btn-ghost" onClick={() => setOpen(false)}>Cancel</button>
        <Err e={error} />
      </div>
    </div>
  );
}

/** Add or change the Goodshuffle project link on any card. */
export function GoodshuffleLinkEditor({ id, url }: { id: string; url: string | null }) {
  const { pending, error, act } = useAct();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(url ?? "");
  if (!open)
    return (
      <button className="text-xs text-stone-500 underline hover:text-stone-800" onClick={() => setOpen(true)}>
        {url ? "change link" : "add project link"}
      </button>
    );
  return (
    <span className="flex flex-wrap items-center gap-1">
      <input className="input h-8 w-72 py-1 text-xs" placeholder="pro.goodshuffle.com/app/project/…" value={v} onChange={(e) => setV(e.target.value)} />
      <button className="btn-secondary px-2 py-1 text-xs" disabled={pending} onClick={() => act(() => setGoodshuffleLinkAction(id, v), () => setOpen(false))}>
        Save
      </button>
      <button className="btn-ghost px-2 py-1 text-xs" onClick={() => setOpen(false)}>Cancel</button>
      <Err e={error} />
    </span>
  );
}

/** Approve or decline a change that a command proposed. */
export function ChangeActions({ commandId, canEdit, canApprove }: { commandId: string; canEdit: boolean; canApprove: boolean }) {
  const { pending, error, act } = useAct();
  if (!canEdit) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canApprove ? (
        <button className="btn-primary" disabled={pending} onClick={() => act(() => decideCommandChangeAction(commandId, true))}>
          ✓ Approve change
        </button>
      ) : (
        <span className="text-xs text-stone-500">Approve: Owner or Approver only</span>
      )}
      <button className="btn-danger" disabled={pending} onClick={() => act(() => decideCommandChangeAction(commandId, false))}>
        ✕ Decline
      </button>
      <Err e={error} />
    </div>
  );
}

/** On an email draft with no quote request yet: track its thread as one. */
export function StartQuoteButton({ emailId }: { emailId: string }) {
  const { pending, error, act } = useAct();
  return (
    <span className="inline-flex items-center gap-2">
      <button className="btn-ghost px-2 py-1 text-xs" disabled={pending} onClick={() => act(() => startQuoteAction(emailId))}>
        + Track as quote request
      </button>
      <Err e={error} />
    </span>
  );
}
