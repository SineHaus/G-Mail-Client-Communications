"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { dismissSuggestionAction, linkProjectAction } from "@/app/actions";

/** "Link to #1042 Smith Wedding?" — one click to confirm Claude's suggestion. */
export default function ProjectSuggestion({
  draftId,
  emailId,
  project,
  reason,
}: {
  draftId: string;
  emailId: string;
  project: { id: string; project_name: string; project_number: string };
  reason: string | null;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-sm">
      <span className="text-brand-700">
        Suggested project: <b>#{project.project_number} {project.project_name}</b>
        {reason && <span className="block text-xs text-brand-700/80">{reason}</span>}
      </span>
      <span className="ml-auto flex gap-1">
        <button
          className="btn-brand py-1"
          disabled={pending}
          onClick={() => start(async () => { await linkProjectAction(emailId, project.id); router.refresh(); })}
        >
          Link
        </button>
        <button
          className="btn-ghost py-1"
          disabled={pending}
          onClick={() => start(async () => { await dismissSuggestionAction(draftId); router.refresh(); })}
        >
          Not this
        </button>
      </span>
    </div>
  );
}
