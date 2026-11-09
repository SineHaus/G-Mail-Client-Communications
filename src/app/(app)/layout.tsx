import { db } from "@/lib/db";
import { requireSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import NavLinks from "@/components/NavLinks";
import NotificationPoller from "@/components/NotificationPoller";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  let user;
  try {
    user = await requireSession();
  } catch {
    redirect("/login");
  }
  const { count } = await db()
    .from("drafts")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending", "revised"]);

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
        <NavLinks queueCount={count ?? 0} />
        <div className="hidden px-4 pt-6 text-xs text-stone-400 md:block">
          <div className="truncate">{user.email}</div>
          <form action="/api/auth/logout" method="post">
            <button className="mt-1 underline hover:text-stone-600">Sign out</button>
          </form>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-5 md:px-8 md:py-8">{children}</main>
      <NotificationPoller initialCount={count ?? 0} />
    </div>
  );
}
