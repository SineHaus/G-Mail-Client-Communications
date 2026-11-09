import { missingEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { error } = await searchParams;
  const missing = missingEnv();
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="card w-full max-w-sm p-8 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-xl font-bold text-white">
          ERG
        </div>
        <h1 className="text-xl font-semibold">Client Communications</h1>
        <p className="mt-1 text-sm text-stone-500">The Event Rental Guys</p>
        {missing.length > 0 && (
          <div className="mt-4 rounded-lg bg-amber-50 p-3 text-left text-sm text-amber-900">
            <p className="font-medium">Setup incomplete: the server is missing these settings</p>
            <ul className="mt-1 list-disc pl-5 font-mono text-xs">
              {missing.map((m) => <li key={m}>{m}</li>)}
            </ul>
            <p className="mt-2 text-xs">Add them in Vercel → Settings → Environment Variables (tick Production), then redeploy.</p>
          </div>
        )}
        {error && <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{String(error)}</p>}
        <a href="/api/auth/google" className="btn-secondary mt-6 w-full py-2.5">
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C36.9 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
          </svg>
          Sign in with Google
        </a>
        <p className="mt-4 text-xs text-stone-400">Connects your Gmail. Nothing is ever sent without your approval.</p>
      </div>
    </main>
  );
}
