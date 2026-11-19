"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runCommandAction } from "@/app/actions";

/** The AI agent's text box. Claude reads and drafts; whatever it makes waits in the queue for Approve. */
export default function CommandBox({ disabled }: { disabled?: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setError(null);
      const r = await runCommandAction(text);
      if (!r.ok) return setError(r.error);
      setText("");
      router.refresh();
    });
  return (
    <div className="card p-3">
      <div className="flex flex-col gap-2 md:flex-row md:items-start">
        <textarea
          className="input min-h-11 flex-1 resize-y"
          rows={1}
          value={text}
          disabled={!!disabled || pending}
          placeholder={disabled ?? 'Tell Claude what to do, e.g. "add 10 chairs to the Curtin quote" or "draft a reply to Ashley about Saturday pickup"'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && text.trim() && !pending) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button className="btn-brand md:mt-0.5" disabled={!!disabled || pending || !text.trim()} onClick={submit}>
          {pending ? "Working…" : "Run"}
        </button>
      </div>
      <p className="mt-1.5 text-xs text-stone-400">
        {pending ? "Claude is reading and drafting. This can take up to a minute." : "Commands only draft. Anything for a customer waits below for Approve."}
      </p>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
