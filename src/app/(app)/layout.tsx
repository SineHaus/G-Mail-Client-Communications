import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { accountCounts, getCurrentAccount, listAccounts } from "@/lib/accounts";
import NavLinks from "@/components/NavLinks";
import NotificationPoller from "@/components/NotificationPoller";
import AccountSwitcher from "@/components/AccountSwitcher";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  let user;
  try {
    user = await requireSession();
  } catch {
    redirect("/login");
  }
  const accounts = await listAccounts();
  const current = await getCurrentAccount(accounts);
  const counts = await accountCounts(accounts);
  const queueCount = current ? counts[current.id]?.drafts ?? 0 : 0;

  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="sticky top-0 z-20 border-b border-stone-200 bg-white md:h-screen md:w-56 md:shrink-0 md:border-r md:border-b-0">
        <div className="flex items-center gap-2 px-4 py-3 md:py-5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-xs font-bold text-white">ERG</div>
          <div className="leading-tight">
            <div className="text-sm font-semibold">Event Rental Guys</div>
            <div className="text-xs text-stone-500">Client comms</div>
          </div>
        </div>
        <NavLinks queueCount={queueCount} />
        <div className="hidden px-4 pt-6 text-xs text-stone-400 md:block">
          <div className="truncate">Signed in as {user.email}</div>
          <form action="/api/auth/logout" method="post">
            <button className="mt-1 underline hover:text-stone-600">Sign out</button>
          </form>
        </div>
      </aside>
      <div className="min-w-0 flex-1">
        <div className="sticky top-0 z-10 flex items-center gap-3 border-b border-stone-200 bg-[#f6f5f2]/90 px-4 py-2.5 backdrop-blur md:top-0 md:px-8">
          <AccountSwitcher
            accounts={accounts.map((a) => ({
              id: a.id,
              email: a.email_address,
              name: a.display_name,
              connected: a.connected,
              drafts: counts[a.id]?.drafts ?? 0,
              unread: counts[a.id]?.unread ?? 0,
            }))}
            currentId={current?.id ?? null}
          />
        </div>
        <main className="px-4 py-5 md:px-8 md:py-8">{children}</main>
      </div>
      <NotificationPoller initialCount={queueCount} />
    </div>
  );
}
