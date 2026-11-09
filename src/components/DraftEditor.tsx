"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { regenerateDraftAction, reviseDraftAction, saveDraftAction } from "@/app/actions";
import DraftActions from "./DraftActions";

const QUICK = ["Make it shorter", "Make it warmer", "More formal", "Ask what date and venue they have in mind", "Fix grammar only"];

export default function DraftEditor({
  draft,
  to,
  chat: initialChat,
}: {
  draft: { id: string; body: string; status: string; error: string | null };
  to: string;
  chat: { role: "user" | "assistant"; content: string }[];
}) {
  const router = useRouter();
  const [body, setBody] = useState(draft.body);
  const [saved, setSaved] = useState(draft.body);
  const [chat, setChat] = useState(initialChat);
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [thinking, startThinking] = useTransition();
  const [saving, startSaving] = useTransition();
  const open = draft.status === "pending" || draft.status === "revised";

  function ask(instruction: string) {
    if (!instruction.trim()) return;
    setError(null);
    setInput("");
    setChat((c) => [...c, { role: "user", content: instruction }]);
    startThinking(async () => {
      const r = await reviseDraftAction(draft.id, instruction, body);
      if (!r.ok || !r.data) {
        setError(r.ok ? "No response" : r.error);
        setChat((c) => c.slice(0, -1));
        setInput(instruction);
        return;
      }
      setBody(r.data.body);
      setSaved(r.data.body);
      setChat((c) => [...c, { role: "assistant", content: r.data!.note }]);
    });
  }

  if (!open) {
    return (
      <div className="card p-5">
        <div className="label">{draft.status === "accepted" ? "Sent" : `Draft ${draft.status}`}</div>
        <pre className="font-sans text-sm whitespace-pre-wrap">{draft.body}</pre>
      </div>
    );
  }

  return (
    <div className="space-y-4 lg:sticky lg:top-6">
      <div className="card p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="label mb-0">Reply to {to}</div>
          <span className="text-xs text-stone-400">{body !== saved ? "Unsaved changes" : "Saved"}</span>
        </div>
        {draft.error && !draft.body ? (
          <div className="space-y-3">
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">Couldn&apos;t draft a reply: {draft.error}</p>
            <DraftActions draftId={draft.id} to={to} failed afterDone="/" />
          </div>
        ) : (
          <>
            <textarea
              className="input min-h-80 font-sans leading-relaxed"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={thinking}
            />
            {draft.error && <p className="mt-2 text-xs text-red-700">{draft.error}</p>}
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
              <DraftActions draftId={draft.id} to={to} body={() => body} afterDone="/" compact />
              <div className="flex gap-2">
                <button
                  className="btn-ghost"
                  disabled={saving || body === saved}
                  onClick={() =>
                    startSaving(async () => {
                      const r = await saveDraftAction(draft.id, body);
                      if (r.ok) setSaved(body);
                      else setError(r.error);
                    })
                  }
                >
                  {saving ? "Saving…" : "Save edits"}
                </button>
                <button
                  className="btn-ghost"
                  disabled={thinking || saving}
                  onClick={() =>
                    startThinking(async () => {
                      if (!confirm("Discard this draft and have Claude write a new one?")) return;
                      await regenerateDraftAction(draft.id);
                      router.push("/");
                    })
                  }
                >
                  Start over
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      <div className="card p-4">
        <div className="label">Ask Claude to change it</div>
        <div className="mb-3 max-h-64 space-y-2 overflow-y-auto">
          {chat.length === 0 && <p className="text-xs text-stone-400">e.g. &quot;make it shorter&quot;, &quot;mention we also have heaters&quot;</p>}
          {chat.map((m, i) => (
            <div
              key={i}
              className={`max-w-[85%] rounded-xl px-3 py-2 text-sm ${
                m.role === "user" ? "ml-auto bg-brand-600 text-white" : "bg-stone-100 text-stone-800"
              }`}
            >
              {m.content}
            </div>
          ))}
          {thinking && <div className="w-fit rounded-xl bg-stone-100 px-3 py-2 text-sm text-stone-500">Claude is rewriting…</div>}
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {QUICK.map((q) => (
            <button key={q} className="rounded-full border border-stone-200 px-2.5 py-1 text-xs text-stone-600 hover:bg-stone-50" disabled={thinking} onClick={() => ask(q)}>
              {q}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            ask(input);
          }}
        >
          <input className="input" placeholder="Tell Claude what to change…" value={input} onChange={(e) => setInput(e.target.value)} disabled={thinking} />
          <button className="btn-brand" disabled={thinking || !input.trim()}>Send</button>
        </form>
        {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
      </div>
    </div>
  );
}
