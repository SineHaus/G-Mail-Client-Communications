"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveChecklistAction } from "@/app/actions";

export default function QuoteChecklist({ initial, isDefault, canEdit, updated }: { initial: string; isDefault: boolean; canEdit: boolean; updated: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <textarea className="input min-h-64 font-mono text-xs leading-relaxed" value={text} readOnly={!canEdit} onChange={(e) => setText(e.target.value)} />
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <button
            className="btn-brand"
            disabled={pending || (!isDefault && text === initial)}
            onClick={() =>
              start(async () => {
                const r = await saveChecklistAction(text);
                setMsg(r.ok ? "Saved. New emails use this checklist." : r.error);
                router.refresh();
              })
            }
          >
            Save checklist
          </button>
        )}
        {!canEdit && <span className="text-xs text-stone-500">Only the Owner can change this.</span>}
        {isDefault && <span className="text-xs text-amber-700">This is the draft list from the build plan. Change it or save it to confirm.</span>}
        {msg && <span className="text-xs text-stone-500">{msg}</span>}
        {updated && <span className="ml-auto text-xs text-stone-400">{updated}</span>}
      </div>
    </div>
  );
}
