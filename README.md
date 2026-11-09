# Client Communications Dashboard — The Event Rental Guys

A web dashboard that connects to one or more Gmail accounts and handles all client communication in one place.
Claude drafts a reply to every new client email in Leonel's voice. **Nothing is sent until Leonel presses Accept.**

- **Review Queue** (home): every new client email with Claude's draft beside it. Accept / Review / Decline.
- **Review view**: full thread, editable draft, chat with Claude ("make it shorter"), link to a project.
- **Clients**: auto-created from email addresses; search; profile with contact info, notes, projects and full email history.
- **Projects**: name + number, status, event date, notes; every linked email in order. Claude suggests a project for each new email, confirmed with one click.
- **Settings**: connected Gmail accounts (add, rename, sync, push status, reconnect, disconnect) and the style examples Claude uses for Leonel's tone.
- **Account switcher** (top of every page): move between Gmail accounts. Each account has its own review queue, clients, projects and history, and shows its open-draft and unread counts. The last selected account is remembered.

Drafts live only in this app's database, never in Gmail Drafts. Only the Accept button sends mail (`src/lib/send.ts` is the single code path that calls Gmail's send API).

### Gmail safety: the dashboard never changes your inbox

- **Scopes:** only `gmail.readonly` and `gmail.send`. No `gmail.modify`, no full mail access, and no `include_granted_scopes`, so older, broader grants are never inherited. If Google's token reports any other scope, sign-in is refused.
- **Allowlist:** every Gmail request goes through `src/lib/google.ts`, which checks it against `src/lib/gmail-policy.ts` before sending. Only these calls are allowed: `getProfile`, `messages.list`, `messages.get`, `history.list` (all read-only), `watch` (push notifications) and `messages.send`. Anything else throws, including `messages.modify`, `batchModify`, `threads.modify`, trash, delete, labels and drafts.
- **No label changes:** the app never adds or removes labels, so Gmail's UNREAD flag, archiving and the rest of your inbox stay exactly as they are.
- **Same rules for every account:** each added account gets exactly the same two scopes and goes through the same allowlist.
- **Read/unread lives in Supabase only** (`emails.is_read`). Opening an email in the Review view, accepting or declining marks it read in the dashboard; "Mark read/unread" toggles it there.
- **Replies** go out with `messages.send` using the original `threadId` plus `In-Reply-To`/`References`, so they land in the same conversation. Gmail itself puts sent mail in Sent, as it does for any email you send.
- **Enforced by tests:** `npm test` fails if any file contains label-modifying Gmail code, if the scopes change, or if any file other than `lib/google.ts` calls the Gmail API.

## Stack

Next.js 16 (App Router) + Tailwind CSS 4 · Supabase Postgres · Gmail API (Google OAuth, Pub/Sub push) · Anthropic API (Claude) · Vercel.

```
src/
  app/(app)/            Review Queue, review/[draftId], clients, projects, settings
  app/api/auth/*        Google sign-in / callback / logout
  app/api/gmail/webhook Pub/Sub push endpoint → incremental sync → drafts
  app/api/cron/renew-watch  daily: renew Gmail watch + catch-up sync
  app/actions.ts        server actions (accept, decline, revise, link project, …)
  lib/google.ts         OAuth + Gmail REST calls (the only file that talks to Gmail)
  lib/gmail-policy.ts   allowed scopes + allowlist of Gmail calls (read-only + send)
  lib/token-crypto.ts   AES-256-GCM encryption of refresh tokens
  lib/accounts.ts       account list, current-account selection (cookie), switcher counts
  components/AccountSwitcher.tsx  the dropdown
  lib/ingest.ts         Gmail → emails/clients; picks which emails get drafts
  lib/claude.ts         drafting + revision prompts (drafting rules live here)
  lib/send.ts           Accept → send reply in the same Gmail thread
  lib/email-parse.ts    MIME parsing, quote stripping, reply building (unit-tested)
  proxy.ts              login guard for every page and API route
supabase/schema.sql     database schema for a fresh install
supabase/migrations/002_multi_account.sql   upgrade from the earlier single-account schema
```

## Setup, step by step

You'll create four accounts/projects: Google Cloud, Supabase, Anthropic, Vercel. Budget ~45 minutes.

### 1. Google Cloud project + Gmail API

1. Go to <https://console.cloud.google.com/>, sign in with **Leonel's Google account**, and create a new project (top bar → project picker → **New project**), e.g. `erg-dashboard`. Note the **project ID**.
2. **APIs & Services → Library**: search for and **Enable** both **Gmail API** and **Cloud Pub/Sub API**.

### 2. OAuth consent screen

1. **APIs & Services → OAuth consent screen** (also labelled *Google Auth Platform*). Click **Get started**.
2. App name `ERG Client Dashboard`, support email = Leonel's.
3. **Audience**:
   - If Leonel's email is a **Google Workspace** address (e.g. `leonel@eventrentalguys.com` on Google Workspace): choose **Internal**. Done — no verification needed.
   - If it's a regular **@gmail.com** address, or you'll add mailboxes from different domains: choose **External**, add each address under **Test users**, then go back to **Audience** and click **Publish app** (status *In production*). Google will show an "unverified app" warning at sign-in — click **Advanced → Go to ERG Client Dashboard**. This is fine for a single private user. *(If you leave it in "Testing", Google expires the Gmail permission every 7 days and Leonel has to sign in again.)*
   - With **Internal**, only accounts in that Workspace organisation can be added; to add an outside @gmail.com account use External.
4. **Data access → Add or remove scopes**: add only `.../auth/gmail.readonly` and `.../auth/gmail.send`. Save. Do **not** add `gmail.modify` or `https://mail.google.com/`.

### 3. OAuth client credentials

1. **APIs & Services → Credentials → Create credentials → OAuth client ID**.
2. Application type **Web application**, name `ERG dashboard`.
3. **Authorized redirect URIs** — add both:
   - `http://localhost:3000/api/auth/callback`
   - `https://YOUR-APP.vercel.app/api/auth/callback` (add after step 7 once you know the URL)
4. Create, then copy the **Client ID** and **Client secret** into `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`.

### 4. Pub/Sub for new-email push notifications

1. **Pub/Sub → Topics → Create topic**, ID `gmail-inbox` (uncheck "default subscription"). The full name is `projects/PROJECT_ID/topics/gmail-inbox` → `GMAIL_PUBSUB_TOPIC`.
2. Open the topic → **Permissions** (right panel; may need *Show info panel*) → **Add principal**: `gmail-api-push@system.gserviceaccount.com`, role **Pub/Sub Publisher**. This lets Gmail publish to your topic.
3. Generate a random token for `GMAIL_WEBHOOK_TOKEN` (e.g. `openssl rand -hex 24`).
   One topic and one subscription serve **all** connected accounts: each notification says which mailbox it's about and the app routes it to that account.
4. After deploying (step 7): **Subscriptions → Create subscription**, topic `gmail-inbox`, delivery type **Push**, endpoint
   `https://YOUR-APP.vercel.app/api/gmail/webhook?token=YOUR_GMAIL_WEBHOOK_TOKEN`, acknowledgement deadline 60 s. Create.

Push needs a public HTTPS URL, so it only works on the deployed app. Locally, use **Sync now**.

### 5. Supabase

1. Create a project at <https://supabase.com/dashboard>.
2. **SQL Editor → New query**, paste the whole of `supabase/schema.sql`, **Run**.
   *Already set up with the earlier single-account version?* Run `supabase/migrations/002_multi_account.sql` instead. It moves your current account and **all existing emails, drafts, clients, projects and style examples** onto it, then deletes the old table, which held the refresh token unencrypted. Afterwards, sign in with Google once more so the token is stored encrypted.
3. **Project Settings → API**: copy the **Project URL** → `SUPABASE_URL` and the **service_role** secret → `SUPABASE_SERVICE_ROLE_KEY`. (Row-level security is on with no policies, so the public anon key can't read anything; only this server can.)

### 6. Anthropic

Create an API key at <https://console.anthropic.com/> → `ANTHROPIC_API_KEY`. Drafts use `claude-opus-5-5` by default (override with `ANTHROPIC_MODEL`). Requests opt into Anthropic's server-side refusal fallback, so a declined request is retried on a fallback model automatically.

### 6b. Token encryption key

Generate `TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32`. Every account's Google refresh token is encrypted with it (AES-256-GCM) before it's written to Supabase, and it's decrypted only on the server when calling Gmail. Tokens never reach the browser. Don't change the key later, or every account will need reconnecting.

### 7. Run locally, then deploy to Vercel

```bash
cp .env.example .env.local   # fill in every value
npm install
npm run dev
```

Open <http://localhost:3000>, **Sign in with Google**, allow Gmail access. The app imports the last 14 days of mail, creates client profiles, and drafts replies for unanswered client emails from the last 3 days. Then open **Settings → Import from my Sent mail** so Claude learns Leonel's tone.

Deploy: push this folder to a GitHub repo, import it at <https://vercel.com/new>, add every variable from `.env.example` (with `APP_URL=https://YOUR-APP.vercel.app`), deploy. Then finish step 3.3 (redirect URI) and step 4.4 (push subscription), sign in on the deployed URL, and press **Settings → Start push notifications**. `vercel.json` schedules a daily job that, for **each** connected account, renews its Gmail watch when it's within 3 days of expiring (watches last 7 days, so none lapse) and catches up on anything missed.

To add more inboxes: account switcher → **+ Add Gmail account** (or Settings). Google sign-in runs again with the same two scopes; the new account is imported, gets its own push watch, and becomes the selected account. Only `ALLOWED_EMAILS` can sign in to the dashboard itself; extra mailboxes can be added only while signed in.

## How it works

### Multiple accounts and isolation

- `gmail_accounts` holds each mailbox: email, display name, **encrypted** refresh token, history id, watch expiration. Every row in `clients`, `projects`, `emails`, `drafts` and `style_examples` has an `account_id`.
- **The database enforces isolation.** Links between rows are composite foreign keys on `(account_id, id)`, so an email can only point at a client or project of the same account, and a draft only at an email or project of the same account. A cross-account link is rejected by Postgres. Client emails and project numbers are unique **per account**.
- **The app scopes every query.** Pages and server actions resolve the selected account and filter every query with `account_id`. An id from another account just isn't found. Claude's drafting context (thread, client history, projects, style examples) comes only from the email's own account. `npm test` fails if any query on these tables lacks an `account_id` filter.
- **Sending** uses the account that received the original email, in the same thread.
- **Push:** each account has its own `watch`; the webhook looks up the mailbox named in the notification and syncs only that account. Disconnected accounts are ignored.
- **Disconnect** (Settings) stops that account's push notifications, revokes the token at Google and deletes the stored token. Its emails, clients and projects stay viewable, and you can reconnect at any time.

- **New email** → Gmail publishes to Pub/Sub → `/api/gmail/webhook` → Gmail history API → messages stored in `emails`, matched to a client by address (client auto-created). Promotions/social/updates, `no-reply` senders and mailing lists are skipped.
- **Drafting**: for the newest inbound message in each thread, Claude gets the thread, the client's earlier emails, client notes, linked project details, open projects and Leonel's style examples, and returns a reply plus an optional project suggestion. The prompt (`src/lib/claude.ts`) enforces the rules: Leonel's tone, sign-off "Leonel / The Event Rental Guys", **never offer delivery or pickup dates**, no invented prices or availability (uses `[PLACEHOLDERS]` instead).
- **Accept** sends the reply in the same Gmail thread (`In-Reply-To`/`References` headers, to the client's `Reply-To` if set) and records it in history. The draft is claimed first, so a double-click can't send twice.
- **Decline** discards. **Review** lets Leonel edit or chat with Claude; edits are saved as status `revised`.
- If Leonel replies from Gmail directly, the open draft for that thread is marked superseded automatically.
- Marking a contact "Not a client" on their profile stops drafts for that address.
- Linking an email to a project links its whole thread; later emails in the thread inherit the project.

## Scripts

```bash
npm run dev     # local dev server
npm run build   # production build
npm test        # unit tests: email parsing/reply building + Gmail safety policy
npm run lint
```
