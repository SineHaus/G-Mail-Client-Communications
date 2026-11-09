import "server-only";
import { db, must } from "./db";
import { env } from "./env";
import type { GmailMessage } from "./email-parse";
import { assertAllowedGmailCall, GMAIL_SCOPES, grantedScopesAreSafe } from "./gmail-policy";
import { decryptToken, encryptToken } from "./token-crypto";

export const redirectUri = () => `${env.appUrl()}/api/auth/callback`;

export function googleAuthUrl(state: string, loginHint?: string): string {
  const p = new URLSearchParams({
    client_id: env.googleClientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GMAIL_SCOPES.join(" "), // gmail.readonly + gmail.send only — no modify, no full mail access
    access_type: "offline",
    prompt: "consent select_account", // always return a refresh token; let the user pick which Google account
    // No include_granted_scopes: the token must not inherit broader scopes granted to this app earlier.
    state,
  });
  if (loginHint) p.set("login_hint", loginHint);
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
  if (!res.ok) {
    const err = new Error(`Google token error ${res.status}: ${await res.text()}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function gmailFetch<T>(accessToken: string, path: string, init?: RequestInit): Promise<T> {
  // Hard guard: refuse anything that isn't on the read-only + send allowlist (see gmail-policy.ts).
  assertAllowedGmailCall(init?.method ?? "GET", path);
  const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  if (!res.ok) {
    const err = new Error(`Gmail API ${res.status} on ${path}: ${await res.text()}`) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  const text = await res.text();
  return (text ? JSON.parse(text) : {}) as T;
}

export async function exchangeCode(code: string) {
  const tokens = await tokenRequest({ code, grant_type: "authorization_code", redirect_uri: redirectUri() });
  // Identify the account with the read-only Gmail profile call (no openid/email/profile scopes needed).
  const profile = await gmailFetch<{ emailAddress: string }>(tokens.access_token, "profile");
  return { tokens, email: profile.emailAddress.toLowerCase(), scopesOk: grantedScopesAreSafe(tokens.scope) };
}

// ---------- Accounts ----------

/** Columns that are safe to hand to pages (never the encrypted token). */
export const ACCOUNT_PUBLIC_COLUMNS =
  "id,email_address,display_name,history_id,watch_expiration,last_synced_at,last_error,created_at";

export interface GmailAccount {
  id: string;
  email_address: string;
  display_name: string | null;
  history_id: string | null;
  watch_expiration: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  created_at: string;
  connected: boolean;
}

export async function getAccount(accountId: string): Promise<GmailAccount> {
  const row = must(
    await db().from("gmail_accounts").select(`${ACCOUNT_PUBLIC_COLUMNS},refresh_token_encrypted`).eq("id", accountId).maybeSingle(),
  ) as (Omit<GmailAccount, "connected"> & { refresh_token_encrypted: string | null }) | null;
  if (!row) throw new Error("Gmail account not found.");
  const { refresh_token_encrypted, ...rest } = row;
  return { ...rest, connected: !!refresh_token_encrypted };
}

/** Create or reconnect an account and store its refresh token encrypted. Returns the account id. */
export async function saveAccountToken(email: string, refreshToken: string): Promise<{ id: string; isNew: boolean }> {
  const existing = must(
    await db().from("gmail_accounts").select("id,refresh_token_encrypted").eq("email_address", email).maybeSingle(),
  ) as { id: string; refresh_token_encrypted: string | null } | null;
  const enc = encryptToken(refreshToken, email);
  if (existing) {
    must(
      await db()
        .from("gmail_accounts")
        .update({ refresh_token_encrypted: enc, last_error: null })
        .eq("id", existing.id)
        .select("id"),
    );
    tokenCache.delete(existing.id);
    return { id: existing.id, isNew: !existing.refresh_token_encrypted };
  }
  const ins = must(
    await db().from("gmail_accounts").insert({ email_address: email, display_name: email, refresh_token_encrypted: enc }).select("id").single(),
  ) as { id: string };
  return { id: ins.id, isNew: true };
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

async function accessToken(accountId: string): Promise<string> {
  const hit = tokenCache.get(accountId);
  if (hit && hit.expiresAt > Date.now() + 60_000) return hit.token;
  const row = must(
    await db().from("gmail_accounts").select("email_address,refresh_token_encrypted").eq("id", accountId).single(),
  ) as { email_address: string; refresh_token_encrypted: string | null };
  if (!row.refresh_token_encrypted) throw new Error(`${row.email_address} is disconnected. Reconnect it in Settings.`);
  try {
    const t = await tokenRequest({ refresh_token: decryptToken(row.refresh_token_encrypted, row.email_address), grant_type: "refresh_token" });
    tokenCache.set(accountId, { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  } catch (e) {
    await db()
      .from("gmail_accounts")
      .update({ last_error: `Google rejected the saved sign-in; reconnect this account. (${e instanceof Error ? e.message.slice(0, 200) : e})` })
      .eq("id", accountId);
    throw e;
  }
}

/** Remove an account's tokens: stop push, revoke at Google, delete the encrypted token. Data is kept. */
export async function disconnectAccount(accountId: string) {
  const row = must(
    await db().from("gmail_accounts").select("email_address,refresh_token_encrypted").eq("id", accountId).single(),
  ) as { email_address: string; refresh_token_encrypted: string | null };
  if (row.refresh_token_encrypted) {
    try {
      await gmailFor(accountId).stop();
    } catch (e) {
      console.warn("users.stop failed (continuing)", e);
    }
    try {
      const refresh = decryptToken(row.refresh_token_encrypted, row.email_address);
      await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ token: refresh }),
      });
    } catch (e) {
      console.warn("token revoke failed (continuing)", e);
    }
  }
  tokenCache.delete(accountId);
  must(
    await db()
      .from("gmail_accounts")
      .update({ refresh_token_encrypted: null, watch_expiration: null, history_id: null, last_error: null })
      .eq("id", accountId)
      .select("id"),
  );
}

/** Gmail API bound to one account. Every call is checked against gmail-policy.ts. */
export function gmailFor(accountId: string) {
  const gmail = async <T>(path: string, init?: RequestInit) => gmailFetch<T>(await accessToken(accountId), path, init);
  return {
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

    /** The only mailbox write: send an approved reply into its existing thread. */
    send: (raw: string, threadId: string) =>
      gmail<{ id: string; threadId: string }>("messages/send", {
        method: "POST",
        body: JSON.stringify({ raw, threadId }),
      }),

    /** Push notifications. labelIds here only filters which changes notify us; it changes no labels. */
    watch: (topicName: string) =>
      gmail<{ historyId: string; expiration: string }>("watch", {
        method: "POST",
        body: JSON.stringify({ topicName, labelIds: ["INBOX", "SENT"], labelFilterBehavior: "include" }),
      }),

    /** Stop push notifications (used when disconnecting). Changes no mail. */
    stop: () => gmail<Record<string, never>>("stop", { method: "POST" }),
  };
}
