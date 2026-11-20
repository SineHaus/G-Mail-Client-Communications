"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markReadyForGoodshuffleAction } from "@/app/actions";

/** Puts a conversation in the approval queue to become a Goodshuffle Pro project. Sends nothing. */
export default function ReadyForGoodshuffleButton({ emailId }: { emailId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        className="t-btn"
        disabled={pending}
        title="Put it in the approval queue to become a Goodshuffle project. Nothing is sent."
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await markReadyForGoodshuffleAction(emailId);
            if (!r.ok) return setError(r.error);
            router.refresh();
          })
        }
      >
        {pending ? "Marking…" : "Ready for Goodshuffle"}
      </button>
      {error && <span className="text-xs text-red-700">{error}</span>}
    </>
  );
}
