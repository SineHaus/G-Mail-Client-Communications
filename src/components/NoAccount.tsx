export default function NoAccount({ isOwner }: { isOwner: boolean }) {
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <h1 className="text-lg font-semibold">{isOwner ? "Connect a Gmail account" : "No accounts shared with you yet"}</h1>
      <p className="mt-1 text-sm text-stone-500">
        {isOwner
          ? "Add the inbox you want Claude to draft replies for. You can add more later."
          : "Ask Leo to give you access to a Gmail account in Settings → Team."}
      </p>
      {isOwner && <a href="/api/auth/google?mode=add" className="btn-brand mt-5">+ Add Gmail account</a>}
    </div>
  );
}
