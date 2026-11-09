"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { setEmailReadAction } from "@/app/actions";

/** Opening an email in the Review view marks it read in Supabase (never in Gmail). */
export default function MarkReadOnOpen({ emailId, isRead }: { emailId: string; isRead: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (isRead) return;
    setEmailReadAction(emailId, true).then(() => router.refresh());
  }, [emailId, isRead, router]);
  return null;
}
