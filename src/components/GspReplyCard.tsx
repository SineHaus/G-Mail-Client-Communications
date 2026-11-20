"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveGspReplyAction, declineGspReplyAction, reviseGspReplyAction, saveGspReplyAction } from "@/app/actions";

type Msg = { id: string; direction: "inbound" | "outbound" | "system"; sender_name: string | null; subject: string | null; body: string; sent_at: string };
type Reply = { id: string; gsp_project_id: string; body: string; status: string; error: string | null; created_at: string };

/**
 * A Goodshuffle Pro message with Claude's drafted reply. Approve queues exactly the text on screen; the
 * extension in the support@ Chrome types it into Goodshuffle's reply box and sends it. Nothing is sent
 * before Approve.
 */
export default function GspReplyCard({ reply, messages, url, canEdit, canApprove }: { reply: Reply; messages: Msg[]; url: string; canEdit: boolean; canApprove: boolean }) {
  const router = useRouter();
  const [body, setBody] = useState(reply.body);
  const [confirming, setConfirming] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [showAll, setShowAll] = useState(false);
  const editable = canEdit && (reply.status === "pending" || reply.status === "failed");
  const last = [...messages].reverse().find((m) => m.direction === "inbound");
  const who = last?.sender_name || "Customer";
  const shown = showAll ? messages : messages.slice(-3);

  const act = (fn: () => Promise<{ ok: boolean; error?: string; data?: unknown }>, after?: (d: unknown) => void) =>
    start(async () => {
      setError(null);
      const r = await fn();
      if (!r.ok) {
        setConfirming(false);
        return setError(r.error ?? "Something went wrong");
      }
      after?.(r.data);
      router.refresh();
    });

  return (
    <div className="t-card" style={{ ["--stripe" as string]: "var(--h-agent)" }}>
      <div className="t-card-top">
        <span className="t-name">{who}</span>
        <span className="t-pill">Project #{reply.gsp_project_id}</span>
        {reply.status === "approved" && <span className="t-pill ok">Approved, waiting for Chrome</span>}
        {reply.status === "sending" && <span className="t-pill ok">Sending in Goodshuffle…</span>}
        {reply.status === "failed" && <span className="t-pill warn">Not sent</span>}
      </div>
      {last?.subject && <div className="t-sub">{last.subject}</div>}
      <div className="flex flex-col gap-1">
        {messages.length > 3 && !showAll && (
          <button className="t-link self-start" onClick={() => setShowAll(true)}>
            Show {messages.length - 3} earlier messages
          </button>
        )}
        {shown.map((m) => (
          <div key={m.id} className="t-sub" style={{ whiteSpace: "pre-wrap" }}>
            <b>{m.direction === "inbound" ? m.sender_name || "Customer" : "You"}:</b> {m.body.slice(0, 600)}
          </div>
        ))}
      </div>
      {reply.error && <p className="t-banner">{reply.error}</p>}
      {editable ? (
        <textarea
          className="t-draft"
          style={{ width: "100%", minHeight: 140, resize: "vertical" }}
          value={body}
          onChange={(e) => (setBody(e.target.value), setConfirming(false))}
          aria-label="Reply to send in Goodshuffle"
        />
      ) : (
        <div className="t-draft">{reply.body}</div>
      )}
      <p className="t-note">Goodshuffle adds your signature under the reply.</p>
      {editable && (
        <div className="flex flex-wrap items-center gap-2">
          {canApprove &&
            (confirming ? (
              <>
                <button className="t-btn go" disabled={pending || !body.trim()} onClick={() => act(() => approveGspReplyAction(reply.id, body))}>
                  {pending ? "Approving…" : `Send to ${who} in Goodshuffle`}
                </button>
                <button className="t-btn quiet" disabled={pending} onClick={() => setConfirming(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button className="t-btn go" disabled={pending || !body.trim()} onClick={() => setConfirming(true)}>
                Approve
              </button>
            ))}
          {body.trim() !== reply.body.trim() && (
            <button className="t-btn" disabled={pending} onClick={() => act(() => saveGspReplyAction(reply.id, body))}>
              Save edits
            </button>
          )}
          <button className="t-btn quiet" disabled={pending} onClick={() => act(() => declineGspReplyAction(reply.id))}>
            Decline
          </button>
        </div>
      )}
      {editable && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) act(() => reviseGspReplyAction(reply.id, note, body), (d) => (typeof d === "string" && setBody(d), setNote("")));
          }}
        >
          <input className="input grow" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ask Claude to change it, e.g. shorter" aria-label="Ask Claude to change the reply" />
          <button className="t-btn" disabled={pending || !note.trim()}>
            {pending ? "Working…" : "Redraft"}
          </button>
        </form>
      )}
      {canEdit && reply.status === "approved" && (
        <div className="flex flex-wrap items-center gap-2">
          <button className="t-btn quiet" disabled={pending} onClick={() => act(() => declineGspReplyAction(reply.id))}>
            Cancel the send
          </button>
        </div>
      )}
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="t-acts">
        <a className="t-link ml-auto" href={url} target="_blank" rel="noopener noreferrer">
          Open in Goodshuffle ↗
        </a>
      </div>
    </div>
  );
}
