import "server-only";
import { db, must } from "./db";
import { env } from "./env";
import type { GmailMessage } from "./email-parse";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
];

export const redirectUri = () => `${env.appUrl()}/api/auth/callback`;

export function googleAuthUrl(state: string): string {
  const p = new URLSearchParams({
    client_id: env.googleClientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent", // always return a refresh token
    include_granted_scopes: "true",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${p}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId(),
      client_secret: env.googleClientSecret(),
      ...body,
    }),
  });
  if (!res.ok) throw new Error(`Google token error ${res.status}: ${await res.text()}`);
  return res.json();
}

export async function exchangeCode(code: string) {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  const info = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  }).then((r) => r.json() as Promise<{ email: string; email_verified?: boolean }>);
  return { tokens, email: info.email.toLowerCase(), emailVerified: info.email_verified !== false };
}

let cached: { token: string; expiresAt: number } | null = null;

export async function getAccount() {
  const rows = must(await db().from("gmail_account").select("*").eq("id", 1).limit(1));
  const acct = (rows as Array<{
    email: string;
    refresh_token: string;
    history_id: string | null;
    watch_expires_at: string | null;
    last_synced_at: string | null;
  }>)[0];
  if (!acct) throw new Error("Gmail is not connected yet. Sign in with Google first.");
  return acct;
}

async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  const acct = await getAccount();
  const t = await tokenRequest({ refresh_token: acct.refresh_token, grant_type: "refresh_token" });
  cached = { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 };
  return cached.token;
}

export function clearTokenCache() {
  cached = null;
}

async function gmail<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = new Error(`Gmail API ${res.status} on ${path}: ${await res.text()}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export const Gmail = {
  profile: () => gmail<{ emailAddress: string; historyId: string }>("profile"),

  listMessageIds: async (q: string, max: number) => {
    const ids: { id: string; threadId: string }[] = [];
    let pageToken: string | undefined;
    while (ids.length < max) {
      const p = new URLSearchParams({ q, maxResults: String(Math.min(100, max - ids.length)) });
      if (pageToken) p.set("pageToken", pageToken);
      const r = await gmail<{ messages?: { id: string; threadId: string }[]; nextPageToken?: string }>(`messages?${p}`);
      ids.push(...(r.messages ?? []));
      pageToken = r.nextPageToken;
      if (!pageToken) break;
    }
    return ids;
  },

  getMessage: (id: string) => gmail<GmailMessage>(`messages/${id}?format=full`),

  getMessageHeaders: (id: string) =>
    gmail<GmailMessage>(
      `messages/${id}?format=metadata&metadataHeaders=Message-ID&metadataHeaders=References&metadataHeaders=Reply-To&metadataHeaders=From&metadataHeaders=Subject`,
    ),

  /** Message IDs added since startHistoryId. Throws with status 404 if the history id is too old. */
  historyAdded: async (startHistoryId: string) => {
    const ids = new Set<string>();
    let pageToken: string | undefined;
    let latest = startHistoryId;
    do {
      const p = new URLSearchParams({ startHistoryId, historyTypes: "messageAdded" });
      if (pageToken) p.set("pageToken", pageToken);
      const r = await gmail<{
        history?: { messagesAdded?: { message: { id: string } }[] }[];
        historyId: string;
        nextPageToken?: string;
      }>(`history?${p}`);
      for (const h of r.history ?? []) for (const m of h.messagesAdded ?? []) ids.add(m.message.id);
      latest = r.historyId;
      pageToken = r.nextPageToken;
    } while (pageToken);
    return { ids: [...ids], historyId: latest };
  },

  send: (raw: string, threadId: string) =>
    gmail<{ id: string; threadId: string }>("messages/send", {
      method: "POST",
      body: JSON.stringify({ raw, threadId }),
    }),

  watch: (topicName: string) =>
    gmail<{ historyId: string; expiration: string }>("watch", {
      method: "POST",
      body: JSON.stringify({ topicName, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "include" }),
    }),
};
