"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addTeamMemberAction, setAccountRoleAction, setMemberActiveAction, setOwnerAction } from "@/app/actions";
import { fmtDate } from "@/lib/format";

type M = { id: string; email: string; name: string | null; is_owner: boolean; active: boolean; last_login_at: string | null };
type Access = { member_id: string; account_id: string; role: "approver" | "editor" | "viewer" };

export default function TeamManager({
  members,
  access,
  accounts,
  meId,
}: {
  members: M[];
  access: Access[];
  accounts: { id: string; email: string }[];
  meId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const roleOf = (m: string, a: string) => access.find((x) => x.member_id === m && x.account_id === a)?.role ?? "none";
  const act = (fn: () => Promise<{ ok: boolean; error?: string }>, ok?: string) =>
    start(async () => {
      const r = await fn();
      setMsg(r.ok ? ok ?? null : r.error ?? "Failed");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead className="text-left text-xs tracking-wide text-stone-500 uppercase">
            <tr>
              <th className="py-2 pr-3 font-medium">Person</th>
              {accounts.map((a) => (
                <th key={a.id} className="px-2 py-2 font-medium normal-case">{a.email.split("@")[0]}@</th>
              ))}
              <th className="py-2 pl-2 font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {members.map((m) => (
              <tr key={m.id} className={m.active ? "" : "opacity-50"}>
                <td className="py-2 pr-3">
                  <div className="font-medium">{m.name || m.email.split("@")[0]}{m.id === meId && " (you)"}</div>
                  <div className="text-xs text-stone-500">{m.email}</div>
                  <div className="text-[11px] text-stone-400">{m.last_login_at ? `Last sign-in ${fmtDate(m.last_login_at)}` : "Hasn't signed in yet"}</div>
                </td>
                {accounts.map((a) => (
                  <td key={a.id} className="px-2 py-2">
                    {m.is_owner ? (
                      <span className="text-xs font-medium text-brand-700">Owner</span>
                    ) : (
                      <select
                        className="input py-1 text-xs"
                        value={roleOf(m.id, a.id)}
                        disabled={pending || !m.active}
                        aria-label={`${m.email} on ${a.email}`}
                        onChange={(e) => act(() => setAccountRoleAction(m.id, a.id, e.target.value as "none" | "approver" | "editor" | "viewer"), "Saved")}
                      >
                        <option value="none">No access (hidden)</option>
                        <option value="approver">Approver</option>
                        <option value="editor">Editor</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    )}
                  </td>
                ))}
                <td className="py-2 pl-2 text-right text-xs whitespace-nowrap">
                  {m.id !== meId && (
                    <>
                      <button className="text-stone-500 hover:underline" disabled={pending} onClick={() => act(() => setOwnerAction(m.id, !m.is_owner))}>
                        {m.is_owner ? "Remove Owner" : "Make Owner"}
                      </button>
                      <span className="mx-1 text-stone-300">·</span>
                      <button className="text-red-700 hover:underline" disabled={pending} onClick={() => act(() => setMemberActiveAction(m.id, !m.active))}>
                        {m.active ? "Remove" : "Restore"}
                      </button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="flex flex-wrap items-end gap-2 border-t border-stone-100 pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          act(async () => {
            const r = await addTeamMemberAction(email, name);
            if (r.ok) { setEmail(""); setName(""); }
            return r;
          }, "Added — now pick their access per inbox, then they can sign in with Google");
        }}
      >
        <label>
          <span className="label">Google email</span>
          <input className="input w-64" type="email" required placeholder="grovert@theeventrentalguys.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label>
          <span className="label">Name</span>
          <input className="input w-36" placeholder="Grovert" value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button className="btn-brand" disabled={pending}>Add person</button>
      </form>
      {msg && <p className="text-xs text-stone-500">{msg}</p>}
    </div>
  );
}
