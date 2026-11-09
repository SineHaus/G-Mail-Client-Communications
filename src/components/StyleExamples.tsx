"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addStyleExampleAction, deleteStyleExampleAction, importStyleExamplesAction } from "@/app/actions";
import Expandable from "./Expandable";

export default function StyleExamples({ examples }: { examples: { id: string; context: string | null; body: string }[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [body, setBody] = useState("");
  const [context, setContext] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          className="btn-brand"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await importStyleExamplesAction(20);
              setMsg(r.ok ? `Imported ${r.data} replies from Sent mail` : r.error);
              router.refresh();
            })
          }
        >
          {pending ? "Working…" : "Import from my Sent mail"}
        </button>
        {msg && <span className="text-xs text-stone-500">{msg}</span>}
      </div>

      <details className="rounded-lg border border-stone-200 p-3">
        <summary className="cursor-pointer text-sm font-medium">Add an example manually</summary>
        <div className="mt-3 space-y-2">
          <textarea className="input min-h-16" placeholder="(Optional) What the client wrote" value={context} onChange={(e) => setContext(e.target.value)} />
          <textarea className="input min-h-32" placeholder="Leonel's reply" value={body} onChange={(e) => setBody(e.target.value)} />
          <button
            className="btn-secondary"
            disabled={pending || !body.trim()}
            onClick={() =>
              start(async () => {
                const r = await addStyleExampleAction(body, context);
                if (r.ok) { setBody(""); setContext(""); }
                setMsg(r.ok ? "Added" : r.error);
                router.refresh();
              })
            }
          >
            Add example
          </button>
        </div>
      </details>

      <ul className="space-y-3">
        {examples.map((ex) => (
          <li key={ex.id} className="rounded-lg border border-stone-200 p-3">
            {ex.context && (
              <div className="mb-2 border-l-2 border-stone-200 pl-2 text-xs text-stone-500">
                <Expandable text={ex.context} lines={2} />
              </div>
            )}
            <Expandable text={ex.body} lines={4} />
            <button
              className="mt-2 text-xs text-red-700 hover:underline"
              disabled={pending}
              onClick={() => start(async () => { await deleteStyleExampleAction(ex.id); router.refresh(); })}
            >
              Remove
            </button>
          </li>
        ))}
        {examples.length === 0 && <li className="text-sm text-stone-400">No examples yet — drafts will use a friendly, professional default tone.</li>}
      </ul>
    </div>
  );
}
