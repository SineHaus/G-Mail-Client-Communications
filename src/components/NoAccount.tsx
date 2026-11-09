export default function NoAccount() {
  return (
    <div className="card mx-auto max-w-md p-8 text-center">
      <h1 className="text-lg font-semibold">Connect a Gmail account</h1>
      <p className="mt-1 text-sm text-stone-500">Add the inbox you want Claude to draft replies for. You can add more later.</p>
      <a href="/api/auth/google?mode=add" className="btn-brand mt-5">+ Add Gmail account</a>
    </div>
  );
}
