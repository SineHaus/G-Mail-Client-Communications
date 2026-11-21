"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markReadyForGoodshuffleAction } from "@/app/actions";

/**
 * Start building in Goodshuffle Pro: puts the conversation in the approval queue (Today → Waiting on you) to become
 * a Goodshuffle Pro project. Sends nothing to the customer and creates nothing in Goodshuffle.
 */
export default function ReadyForGoodshuffleButton({ emailId }: { emailId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="btn-brand"
        disabled={pending}
        title="Puts it in the approval queue to become a Goodshuffle Pro project. Nothing is sent and nothing is created in Goodshuffle."
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await markReadyForGoodshuffleAction(emailId);
            if (!r.ok) return setError(r.error);
            router.refresh();
          })
        }
      >
        {pending ? "Starting…" : "Start building in Goodshuffle Pro"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </>
  );
}
