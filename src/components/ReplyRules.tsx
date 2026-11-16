"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveReplyRulesAction } from "@/app/actions";

const TEMPLATE = `Payment methods: [e.g. card, Zelle, check — 50% deposit to book]
Delivery fees: [e.g. free within 10 miles, then $X per mile]
Setup / takedown: [e.g. setup is extra, priced per item]
Minimum order: [...]
Cancellation policy: [...]`;

export default function ReplyRules({ initial, canEdit, updated }: { initial: string; canEdit: boolean; updated: string | null }) {
  const router = useRouter();
  const [text, setText] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-2">
      <textarea
        className="input min-h-48 font-mono text-xs leading-relaxed"
        value={text}
        placeholder={TEMPLATE}
        readOnly={!canEdit}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="flex flex-wrap items-center gap-2">
        {canEdit && (
          <button
            className="btn-brand"
            disabled={pending || text === initial}
            onClick={() =>
              start(async () => {
                const r = await saveReplyRulesAction(text);
                setMsg(r.ok ? "Saved — new drafts use these rules" : r.error);
                router.refresh();
              })
            }
          >
            Save rules
          </button>
        )}
        {!canEdit && <span className="text-xs text-stone-500">Only the Owner can change these.</span>}
        {msg && <span className="text-xs text-stone-500">{msg}</span>}
        {updated && <span className="ml-auto text-xs text-stone-400">{updated}</span>}
      </div>
    </div>
  );
}
