import { redirect } from "next/navigation";
import { accountCounts, getCurrentAccount, listAccounts } from "@/lib/accounts";
import { requireMember, memberLabel } from "@/lib/team";
import { ROLE_LABEL, can } from "@/lib/permissions";
import NotificationPoller from "@/components/NotificationPoller";
import AccountSwitcher from "@/components/AccountSwitcher";
import AppFrame from "@/components/shell/AppFrame";
import ThemeToggle from "@/components/shell/ThemeToggle";
import CommandBar from "@/components/shell/CommandBar";
import ThreadPanelProvider from "@/components/shell/ThreadPanel";
import { agentTablesReady, agentWaitingCount } from "@/lib/quotes";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  let member;
  try {
    member = await requireMember();
  } catch {
    redirect("/login");
  }
  const accounts = await listAccounts(member);
  const current = await getCurrentAccount(accounts);
  const counts = await accountCounts(accounts);
  const queueCount = current ? (counts[current.id]?.drafts ?? 0) : 0;
  const waiting = current ? await agentWaitingCount(current.id) : 0;
  const agentReady = current ? await agentTablesReady(current.id) : false;
  const today = new Date().toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "America/New_York" });
  const name = memberLabel(member);

  return (
    <ThreadPanelProvider>
      <AppFrame todayCount={waiting + queueCount} inboxCount={current ? (counts[current.id]?.unread ?? 0) : 0}>
        <div className="t-main">
          <header className="t-top">
            <div className="t-brand">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="on-light" src="/brand/terg-logo-black.png" alt="The Event Rental Guys" />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="on-dark" src="/brand/terg-logo-white.png" alt="The Event Rental Guys" />
              <span className="t-day">{today}</span>
            </div>
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
              isOwner={member.is_owner}
            />
            {current && can(current.role, "edit") && (
              <CommandBar disabled={agentReady ? undefined : "The command bar turns on after migration 004 is run."} />
            )}
            <div className="ml-auto flex items-center gap-2">
              <ThemeToggle />
              <details className="relative">
                <summary className="t-who cursor-pointer list-none" title={`${name} · ${member.email}`}>
                  {(name || member.email)[0]?.toUpperCase()}
                </summary>
                <div className="card absolute right-0 z-30 mt-2 w-60 p-3 text-xs text-stone-500">
                  <div className="truncate font-medium text-stone-700">{name}</div>
                  <div className="truncate">{member.email}</div>
                  {current && <div className="mt-0.5">{ROLE_LABEL[current.role]} on this account</div>}
                  <form action="/api/auth/logout" method="post">
                    <button className="mt-2 underline hover:text-stone-700">Sign out</button>
                  </form>
                </div>
              </details>
            </div>
          </header>
          <main className="min-w-0">{children}</main>
        </div>
      </AppFrame>
      <NotificationPoller initialCount={queueCount} />
    </ThreadPanelProvider>
  );
}
