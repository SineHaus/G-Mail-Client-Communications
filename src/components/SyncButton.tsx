"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncNowAction } from "@/app/actions";
import { timeAgo } from "@/lib/format";

export default function SyncButton({ lastSynced }: { lastSynced: string | null }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <button
      className="btn-secondary whitespace-nowrap"
      disabled={pending}
      title={lastSynced ? `Last synced ${timeAgo(lastSynced)}` : "Never synced"}
      onClick={() =>
        start(async () => {
          const r = await syncNowAction();
          setMsg(r.ok ? `${r.data?.imported ?? 0} new · ${r.data?.drafted ?? 0} drafted` : r.error);
          router.refresh();
          setTimeout(() => setMsg(null), 6000);
        })
      }
    >
      {pending ? "Syncing…" : msg ?? "↻ Sync now"}
    </button>
  );
}
