"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setEmailReadAction } from "@/app/actions";

/** Unread dot + "Mark read/unread". Updates Supabase only; Gmail is untouched. */
export default function ReadToggle({ emailId, isRead }: { emailId: string; isRead: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-1.5">
      {!isRead && <span className="h-2 w-2 rounded-full bg-brand-600" aria-label="Unread" />}
      <button
        className="text-xs text-stone-500 hover:text-stone-800 hover:underline disabled:opacity-50"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setEmailReadAction(emailId, !isRead);
            router.refresh();
          })
        }
      >
        {isRead ? "Mark unread" : "Mark read"}
      </button>
    </span>
  );
}
