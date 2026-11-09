"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { startWatchAction } from "@/app/actions";

export default function WatchButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="flex items-center gap-2">
      <button
        className="btn-secondary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await startWatchAction();
            setMsg(r.ok ? "Push notifications on" : r.error);
            router.refresh();
          })
        }
      >
        {pending ? "Starting…" : "Start push notifications"}
      </button>
      {msg && <span className="text-xs text-stone-500">{msg}</span>}
    </span>
  );
}
