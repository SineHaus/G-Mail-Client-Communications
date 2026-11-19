import Link from "next/link";

const TABS = [
  { key: "email", label: "Email", href: "/communication" },
  { key: "clients", label: "Clients", href: "/clients" },
  { key: "projects", label: "Projects", href: "/projects" },
] as const;

/** The channel tabs at the top of the Communication pages. Texts and Goodshuffle messages come in phase 3. */
export default function CommunicationTabs({ active }: { active: (typeof TABS)[number]["key"] }) {
  return (
    <div className="mb-5 flex flex-wrap items-center gap-1 rounded-xl border border-stone-200 bg-white p-1 text-sm">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`rounded-lg px-3 py-1.5 font-medium ${t.key === active ? "bg-brand-50 text-brand-700" : "text-stone-600 hover:bg-stone-100"}`}
        >
          {t.label}
        </Link>
      ))}
      <span className="rounded-lg px-3 py-1.5 text-stone-400" title="RingCentral texts on 551-277-2716 arrive in phase 3">
        Texts · soon
      </span>
      <span className="rounded-lg px-3 py-1.5 text-stone-400" title="Goodshuffle project messages arrive in phase 3">
        Goodshuffle · soon
      </span>
    </div>
  );
}
