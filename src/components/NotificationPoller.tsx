"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

/** Polls for new drafts; refreshes the UI and shows a browser notification when one arrives. */
export default function NotificationPoller({ initialCount }: { initialCount: number }) {
  const router = useRouter();
  const last = useRef<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("unsupported");

  useEffect(() => {
    let stopped = false;
    // Read browser-only state after hydration (avoids a server/client mismatch).
    const t = setTimeout(() => setPerm(typeof Notification === "undefined" ? "unsupported" : Notification.permission), 0);
    async function tick() {
      try {
        const r = await fetch("/api/queue-count", { cache: "no-store" });
        if (!r.ok) return;
        const { count, latest } = (await r.json()) as { count: number; latest: string | null };
        if (last.current && latest && latest > last.current) {
          const msg = `New draft ready to review (${count} waiting)`;
          setToast(msg);
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && document.hidden) {
            new Notification("The Event Rental Guys", { body: msg });
          }
          router.refresh();
        }
        last.current = latest ?? last.current ?? new Date(0).toISOString();
      } catch {}
    }
    tick();
    const id = setInterval(() => !stopped && tick(), 45_000);
    return () => {
      stopped = true;
      clearTimeout(t);
      clearInterval(id);
    };
  }, [router, initialCount]);

  return (
    <>
      {perm === "default" && (
        <button
          onClick={async () => setPerm(await Notification.requestPermission())}
          className="fixed right-4 bottom-4 z-30 hidden rounded-full border border-stone-200 bg-white px-4 py-2 text-xs text-stone-600 shadow md:block"
        >
          🔔 Enable new-email notifications
        </button>
      )}
      {toast && (
        <div className="fixed inset-x-4 bottom-4 z-40 mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-stone-900 px-4 py-3 text-sm text-white shadow-lg">
          {toast}
          <button onClick={() => setToast(null)} className="text-stone-400 hover:text-white">✕</button>
        </div>
      )}
    </>
  );
}
