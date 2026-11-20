"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { runCommandAction } from "@/app/actions";
import Icon from "./icons";

/** Claude's command bar in the top bar. Commands only draft; anything for a customer waits for Approve. */
export default function CommandBar({ disabled }: { disabled?: string }) {
  const router = useRouter();
  const [text, setText] = useState("");
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const submit = () =>
    start(async () => {
      setNote(null);
      const r = await runCommandAction(text);
      if (!r.ok) return setNote({ ok: false, text: r.error });
      setText("");
      setNote({ ok: true, text: "Done. Anything for a customer is waiting on Today for Approve." });
      router.refresh();
    });
  return (
    <>
    {note && !note.ok && (
      <p className="t-toast" role="alert" onClick={() => setNote(null)}>
        Couldn&apos;t do it: {note.text}
      </p>
    )}
    <form
      className="t-cmd"
      title={note?.text}
      onSubmit={(e) => {
        e.preventDefault();
        if (text.trim() && !pending) submit();
      }}
    >
      <Icon name="spark" />
      <input
        value={text}
        disabled={!!disabled || pending}
        onChange={(e) => setText(e.target.value)}
        aria-label="Tell Claude what to do"
        placeholder={
          disabled ?? (pending ? "Claude is reading and drafting…" : note ? note.text : 'Tell Claude what to do, e.g. "add 10 chairs to the Curtin quote"')
        }
      />
      <button type="submit" disabled={!!disabled || pending || !text.trim()}>
        {pending ? "Working…" : "Run"}
      </button>
    </form>
    </>
  );
}
