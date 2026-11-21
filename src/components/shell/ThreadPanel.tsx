"use client";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import DraftActions from "@/components/DraftActions";
import { markReadyForGoodshuffleAction } from "@/app/actions";
import Icon from "./icons";

// The thread side panel: open any customer conversation at a third of the screen (full width on a
// phone) without leaving the page. Esc, X or a click outside closes it.

type File = { part: string; name: string; type: string; size: number };
type View = {
  emailId: string;
  subject: string;
  client: { id: string; name: string | null; email: string; phone: string | null } | null;
  fullHistory: boolean;
  messages: { id: string; direction: "inbound" | "outbound"; fromName: string | null; fromAddress: string; sentAt: string; body: string; attachments: File[] }[];
  otherThreads: { emailId: string; subject: string; sentAt: string; count: number }[];
  quote: {
    id: string;
    stage: string;
    stageLabel: string;
    title: string | null;
    info: { label: string; value: string }[];
    missing: string[];
    items: { name: string; quantity?: number | string | null; note?: string | null }[];
    notes: string | null;
  } | null;
  goodshuffleUrl: string | null;
  draft: { id: string; body: string; status: string } | null;
  replyTo: string;
  canApprove: boolean;
  canEdit: boolean;
};

const Ctx = createContext<(emailId: string) => void>(() => {});
export const useOpenThread = () => useContext(Ctx);

/** A button that opens a conversation in the side panel. */
export function OpenThread({ emailId, className, children, title }: { emailId: string; className?: string; children: React.ReactNode; title?: string }) {
  const open = useOpenThread();
  return (
    <button type="button" className={className} title={title ?? "Open the conversation"} onClick={() => open(emailId)}>
      {children}
    </button>
  );
}

const initials = (s: string) =>
  s
    .replace(/@.*/, "")
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("") || "?";
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const size = (n: number) => (n > 1_000_000 ? `${(n / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1000))} KB`);

async function fetchView(id: string): Promise<{ view: View } | { error: string }> {
  try {
    const r = await fetch(`/api/thread/${id}`, { cache: "no-store" });
    if (r.ok) return { view: (await r.json()) as View };
    return { error: r.status === 404 ? "That conversation isn't on this account." : "Couldn't open the conversation. Try again." };
  } catch {
    return { error: "Couldn't open the conversation. Try again." };
  }
}

export default function ThreadPanelProvider({ children }: { children: React.ReactNode }) {
  const [emailId, setEmailId] = useState<string | null>(null);
  const open = useCallback((id: string) => setEmailId(id), []);
  return (
    <Ctx.Provider value={open}>
      {children}
      <ThreadPanel key={emailId ?? "closed"} emailId={emailId} onClose={() => setEmailId(null)} onOpen={open} />
    </Ctx.Provider>
  );
}

function ThreadPanel({ emailId, onClose, onOpen }: { emailId: string | null; onClose: () => void; onOpen: (id: string) => void }) {
  const router = useRouter();
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"thread" | "quote" | "history">("thread");
  const [draft, setDraft] = useState("");
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const show = useCallback((r: { view: View } | { error: string }) => {
    if ("error" in r) {
      setView(null);
      setError(r.error);
    } else {
      setError(null);
      setView(r.view);
      setDraft(r.view.draft?.body ?? "");
    }
  }, []);
  const load = useCallback(async (id: string) => show(await fetchView(id)), [show]);

  useEffect(() => {
    // The panel is remounted for each conversation (key above), so it starts fresh on the Thread tab.
    if (!emailId) return;
    let live = true;
    fetchView(emailId).then((r) => live && show(r));
    closeRef.current?.focus();
    return () => {
      live = false;
    };
  }, [emailId, show]);

  useEffect(() => {
    if (!emailId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [emailId, onClose]);

  // Newest message in view once a thread loads.
  useEffect(() => {
    if (view && tab === "thread") bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [view, tab]);

  const on = !!emailId;
  const name = view?.client?.name || view?.messages.find((m) => m.direction === "inbound")?.fromName || view?.client?.email || "";
  const files = view?.messages.flatMap((m) => m.attachments.map((a) => ({ ...a, emailId: m.id, sentAt: m.sentAt }))) ?? [];

  const markReady = () =>
    start(async () => {
      if (!view) return;
      const r = await markReadyForGoodshuffleAction(view.emailId);
      if (!r.ok) return setNote(r.error);
      setNote("Started. It's in the approval queue on Today, waiting for Approve.");
      await load(view.emailId);
      router.refresh();
    });

  return (
    <>
      <div className={`t-scrim ${on ? "on" : ""}`} onClick={onClose} aria-hidden />
      <aside className={`t-panel ${on ? "on" : ""}`} role="dialog" aria-modal="true" aria-label="Conversation" aria-hidden={!on} inert={!on}>
        <div className="t-phead">
          <div className="t-ptitle">
            <div className="t-av">{initials(name || "?")}</div>
            <div style={{ minWidth: 0 }}>
              <h3>{name || (error ? "Conversation" : "Opening…")}</h3>
              {view && (
                <p>
                  {view.client?.email}
                  {view.client?.phone ? ` · ${view.client.phone}` : ""}
                </p>
              )}
            </div>
            <button ref={closeRef} type="button" className="t-x" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
          {view && (
            <div className="t-pmeta">
              <span className="t-pill">{view.subject}</span>
              {view.quote && <span className={`t-pill ${view.quote.missing.length ? "warn" : "brand"}`}>{view.quote.stageLabel}</span>}
              {view.goodshuffleUrl && (
                <a className="t-pill brand" href={view.goodshuffleUrl} target="_blank" rel="noopener noreferrer">
                  Open in Goodshuffle ↗
                </a>
              )}
              {view.client && (
                <Link className="t-link" href={`/clients/${view.client.id}`}>
                  Contact page
                </Link>
              )}
            </div>
          )}
        </div>
        <div className="t-ptabs" role="tablist">
          {(
            [
              ["thread", `Thread${view ? ` · ${view.messages.length}` : ""}`],
              ["quote", "Quote details"],
              ["history", `Customer history${view ? ` · ${view.otherThreads.length + 1}` : ""}`],
            ] as const
          ).map(([k, l]) => (
            <button key={k} type="button" role="tab" className="t-tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {l}
            </button>
          ))}
        </div>
        <div className="t-pbody" ref={bodyRef}>
          {error && <p className="t-banner">{error}</p>}
          {!view && !error && <p className="t-empty">Opening the conversation…</p>}
          {view && tab === "thread" && (
            <>
              {!view.fullHistory && <p className="t-note">Gmail was busy, so this shows the emails the dashboard already has.</p>}
              {view.messages.map((m) => (
                <div key={m.id} className={`t-msg ${m.direction === "inbound" ? "in" : "out"}`}>
                  <div className="mt">
                    <b>{m.direction === "inbound" ? m.fromName || m.fromAddress : "TERG"}</b>
                    <span>{when(m.sentAt)}</span>
                  </div>
                  <div>{m.body.trim() || "(no text)"}</div>
                  {m.attachments.length > 0 && (
                    <div className="t-files">
                      {m.attachments.map((a) => (
                        <a key={a.part} className="t-file" href={`/api/attachment?email=${m.id}&part=${encodeURIComponent(a.part)}`} target="_blank" rel="noopener noreferrer">
                          <Icon name="clip" className="h-3.5 w-3.5" />
                          <span>{a.name}</span>
                          <small>{size(a.size)}</small>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
          {view && tab === "quote" && (
            <>
              {view.quote ? (
                <div className="t-facts">
                  <h4>
                    <span>{view.quote.title || "Quote request"}</span>
                    <span>{view.quote.stageLabel}</span>
                  </h4>
                  <dl>
                    {view.quote.info.map((i) => (
                      <div key={i.label} style={{ display: "contents" }}>
                        <dt>{i.label}</dt>
                        <dd>{i.value}</dd>
                      </div>
                    ))}
                    {view.quote.missing.map((m) => (
                      <div key={m} style={{ display: "contents" }}>
                        <dt>{m}</dt>
                        <dd className="miss">Still needed</dd>
                      </div>
                    ))}
                  </dl>
                  {view.quote.items.length > 0 && (
                    <div className="for-you">
                      <b>Items:</b> {view.quote.items.map((i) => `${i.quantity ?? "?"} ${i.name}`).join(", ")}
                    </div>
                  )}
                  {view.quote.notes && <div className="for-you">{view.quote.notes}</div>}
                </div>
              ) : (
                <p className="t-empty">No quote request on this conversation yet.</p>
              )}
              {view.canEdit && (!view.quote || view.quote.stage === "gathering" || view.quote.stage === "closed") && (
                <div className="t-acts">
                  <button type="button" className="t-btn brand" disabled={pending} onClick={markReady}>
                    {pending ? "Starting…" : "Start building in Goodshuffle Pro"}
                  </button>
                  <span className="t-note">Puts it in the approval queue to become a Goodshuffle Pro project. Nothing is sent or created in Goodshuffle.</span>
                </div>
              )}
              {note && <p className="t-note">{note}</p>}
            </>
          )}
          {view && tab === "history" && (
            <>
              <h4 className="t-sec-h">Files in this conversation</h4>
              {files.length ? (
                <div className="t-files">
                  {files.map((a) => (
                    <a key={`${a.emailId}:${a.part}`} className="t-file" href={`/api/attachment?email=${a.emailId}&part=${encodeURIComponent(a.part)}`} target="_blank" rel="noopener noreferrer">
                      <Icon name="clip" className="h-3.5 w-3.5" />
                      <span>{a.name}</span>
                      <small>{size(a.size)}</small>
                    </a>
                  ))}
                </div>
              ) : (
                <p className="t-note">No files.</p>
              )}
              <h4 className="t-sec-h">Other conversations with this customer</h4>
              {view.otherThreads.length ? (
                <div className="t-lane-items" style={{ padding: 0 }}>
                  {view.otherThreads.map((t) => (
                    <button key={t.emailId} type="button" className="t-mini" onClick={() => onOpen(t.emailId)}>
                      <span className="t-stack">
                        <b>{t.subject}</b>
                        <span>
                          {when(t.sentAt)} · {t.count} email{t.count === 1 ? "" : "s"}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="t-note">This is their only conversation.</p>
              )}
            </>
          )}
        </div>
        {view?.draft && (
          <div className="t-pfoot">
            <div className="flex justify-between text-[11px] text-[var(--muted)]">
              <span>Claude&apos;s draft to {view.replyTo}</span>
              <span>{view.draft.status === "sending" ? "Sending…" : "Not sent until you approve"}</span>
            </div>
            <textarea
              className="input min-h-[84px] resize-y"
              value={draft}
              readOnly={!view.canEdit}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Claude's draft"
            />
            {view.draft.status === "pending" && (
              <DraftActions
                draftId={view.draft.id}
                to={view.replyTo}
                getBody={() => draft}
                canEdit={view.canEdit}
                canApprove={view.canApprove}
                onDone={() => view && load(view.emailId)}
                extra={
                  view.canEdit && (!view.quote || view.quote.stage === "gathering" || view.quote.stage === "closed") ? (
                    <button type="button" className="btn-brand" disabled={pending} onClick={markReady}>
                      {pending ? "Starting…" : "Start building in Goodshuffle Pro"}
                    </button>
                  ) : null
                }
              />
            )}
          </div>
        )}
      </aside>
    </>
  );
}
