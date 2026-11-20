"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { pingPresenceAction, regenerateDraftAction, reviseDraftAction, saveDraftVersionAction } from "@/app/actions";
import DraftActions from "./DraftActions";

const QUICK = ["Make it shorter", "Make it warmer", "More formal", "Mention setup is extra", "Fix grammar only"];

export type Version = { id: string; version: number; created_by: string; review_note: string | null; created_at: string; status: string };

export default function DraftEditor({
  draft,
  emailId,
  to,
  fromAccount,
  chat,
  versions,
  canEdit,
  canApprove,
  othersViewing,
}: {
  draft: { id: string; body: string; status: string; error: string | null; version: number; created_by: string; decided_by: string | null };
  emailId: string;
  to: string;
  fromAccount: string;
  chat: { role: "user" | "assistant"; content: string; author: string | null }[];
  versions: Version[];
  canEdit: boolean;
  canApprove: boolean;
  othersViewing: string[];
}) {
  const router = useRouter();
  const [body, setBody] = useState(draft.body);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [working, start] = useTransition();
  const open = draft.status === "pending";
  const dirty = body.trim() !== draft.body.trim();

  // "Who has this open" heartbeat.
  useEffect(() => {
    if (!open) return;
    pingPresenceAction(emailId);
    const t = setInterval(() => pingPresenceAction(emailId), 30_000);
    return () => clearInterval(t);
  }, [emailId, open]);

  // Moving to a newer version: replace the URL so the page shows (and approves) exactly that version.
  const goTo = (id: string) => router.replace(`/review/${id}`);

  function ask(instruction: string) {
    if (!instruction.trim()) return;
    setError(null);
    setInput("");
    start(async () => {
      const r = await reviseDraftAction(draft.id, instruction, body);
      if (!r.ok || !r.data) {
        setError(r.ok ? "No response" : r.error);
        setInput(instruction);
        return;
      }
      goTo(r.data.draftId);
    });
  }

  const byLabel = (v: { created_by: string }) => (v.created_by === "claude" ? "Claude" : v.created_by.split("@")[0]);

  if (!open) {
    return (
      <div className="card p-5">
        <div className="label">
          {draft.status === "sent"
            ? `Sent${draft.decided_by ? ` · approved by ${draft.decided_by.split("@")[0]}` : ""}`
            : draft.status === "declined"
              ? `Handled outside the dashboard${draft.decided_by ? ` · ${draft.decided_by}` : ""}`
              : draft.status === "superseded"
                ? "Older version — a newer one exists"
                : `Draft ${draft.status}`}
        </div>
        <pre className="font-sans text-sm whitespace-pre-wrap">{draft.body}</pre>
        {draft.status === "superseded" && versions.find((v) => v.status === "pending") && (
          <button className="btn-brand mt-3" onClick={() => goTo(versions.find((v) => v.status === "pending")!.id)}>Open the current version</button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4 lg:sticky lg:top-20">
      {othersViewing.length > 0 && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          👀 {othersViewing.join(", ")} {othersViewing.length === 1 ? "has" : "have"} this draft open too.
        </p>
      )}
      <div className="card p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="label mb-0">
            Reply to {to} <span className="tracking-normal normal-case">· sends from {fromAccount}</span>
          </div>
          <span className="text-xs text-stone-500">
            Version {draft.version} · by {byLabel(draft)}
            {dirty && <span className="ml-1 text-amber-700">· unsaved edits</span>}
          </span>
        </div>
        {draft.error && !draft.body ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Couldn&apos;t draft a reply: {draft.error}</p>
            <DraftActions draftId={draft.id} to={to} failed afterDone="/" getBody={() => body} canEdit={canEdit} canApprove={canApprove} />
          </div>
        ) : (
          <>
            <textarea
              className="input min-h-80 font-sans leading-relaxed"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={working || !canEdit}
              readOnly={!canEdit}
            />
            {draft.error && <p className="mt-2 text-xs text-red-700">{draft.error}</p>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <DraftActions draftId={draft.id} to={to} getBody={() => body} afterDone="/" compact canEdit={canEdit} canApprove={canApprove} />
              {canEdit && (
                <div className="flex gap-2">
                  <button
                    className="btn-ghost"
                    disabled={working || !dirty}
                    onClick={() =>
                      start(async () => {
                        const r = await saveDraftVersionAction(draft.id, body);
                        if (r.ok && r.data) goTo(r.data);
                        else if (!r.ok) setError(r.error);
                      })
                    }
                  >
                    Save as new version
                  </button>
                  <button
                    className="btn-ghost"
                    disabled={working}
                    onClick={() => {
                      if (!confirm("Discard this draft and have Claude write a new one from scratch?")) return;
                      start(async () => {
                        const r = await regenerateDraftAction(draft.id);
                        if (!r.ok) setError(r.error);
                        else router.push("/inbox");
                      });
                    }}
                  >
                    Start over
                  </button>
                </div>
              )}
            </div>
            {canApprove && dirty && <p className="mt-2 text-xs text-stone-500">Approve sends the text exactly as shown, including your unsaved edits.</p>}
          </>
        )}
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>

      {canEdit && (
        <div className="card p-4">
          <div className="label">Review: send back to Claude with a note</div>
          <div className="mb-3 max-h-64 space-y-2 overflow-y-auto">
            {chat.length === 0 && <p className="text-xs text-stone-400">e.g. &quot;mention setup is extra&quot;, &quot;make it shorter&quot;</p>}
            {chat.map((m, i) => (
              <div
                key={i}
                className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${m.role === "user" ? "ml-auto bg-brand-600 text-white" : "bg-stone-100 text-stone-800"}`}
              >
                {m.role === "user" && m.author && <span className="block text-[11px] opacity-75">{m.author.split("@")[0]}</span>}
                {m.content}
              </div>
            ))}
            {working && <div className="w-fit rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-500">Working…</div>}
          </div>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {QUICK.map((q) => (
              <button key={q} className="rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-50" disabled={working} onClick={() => ask(q)}>
                {q}
              </button>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); ask(input); }}>
            <input className="input" placeholder="Note for Claude…" value={input} onChange={(e) => setInput(e.target.value)} disabled={working} />
            <button className="btn-brand" disabled={working || !input.trim()}>Send</button>
          </form>
          <p className="mt-2 text-xs text-stone-400">Claude&apos;s rewrite is saved as the next version. Nothing is sent until someone presses Approve.</p>
        </div>
      )}

      {versions.length > 1 && (
        <details className="card p-4 text-sm">
          <summary className="cursor-pointer font-medium">Version history ({versions.length})</summary>
          <ol className="mt-2 space-y-1 text-xs text-stone-600">
            {versions.map((v) => (
              <li key={v.id}>
                <button className="hover:underline" onClick={() => goTo(v.id)}>
                  v{v.version} · {byLabel(v)} · {new Date(v.created_at).toLocaleString()}
                  {v.review_note && <> · note: “{v.review_note}”</>}
                  {v.id === draft.id && " · (showing)"}
                </button>
              </li>
            ))}
          </ol>
        </details>
      )}
    </div>
  );
}
