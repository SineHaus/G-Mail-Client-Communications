# Client Communications Dashboard — The Event Rental Guys

A web dashboard that connects to one or more Gmail accounts and handles all client communication in one place.
Claude drafts a reply to every new client email in Leonel's voice. **Nothing is sent until someone with send rights presses Approve.**

- **Queue** (home): every new client email with Claude's draft beside it. **Approve** (sends) / **Review** / **Decline** (handled outside the dashboard). Shows when a teammate has a draft open, and when the agent last checked mail.
- **Draft review**: full thread, editable draft, "send back to Claude with a note". Every edit or redraft is saved as a new **version**; Approve sends exactly the version on screen.
- **Clients**: auto-created from email addresses; profile with contact info, notes, projects and full email history.
- **Projects**: shared across TERG with one numbering. Emails auto-link when a project number appears in them (or the client has one open project); otherwise Claude suggests one, confirmed with a click.
- **Accounts & team** (Settings): connected Gmail accounts; team members with a role per inbox (Owner, Approver, Editor, Viewer, or no access); editable **AI reply rules**; style examples; activity log.
- **Account switcher** (top of every page): only the inboxes you have access to, with open-draft and unread counts. The last selected one is remembered.

Drafts live only in this app's database, never in Gmail Drafts. Only the Approve button sends mail (`src/lib/send.ts` is the single code path that calls Gmail's send API), and only for the Owner or an Approver on that inbox.

### Gmail safety: the dashboard never changes your inbox

- **Scopes:** connecting a mailbox asks for only `gmail.readonly` and `gmail.send`. No `gmail.modify`, no full mail access, and no `include_granted_scopes`, so older, broader grants are never inherited; any other scope is refused. Signing in to the dashboard asks only for `openid email` (who you are) and gives the app no access to your mailbox.
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
  lib/draft-queue.ts    finds client emails still without a draft and drafts them within the time left
  lib/send.ts           Approve → send reply in the same Gmail thread
  lib/team.ts, lib/permissions.ts   team members, roles per inbox
  lib/drafts.ts         draft versions
  lib/email-parse.ts    MIME parsing, quote stripping, reply building (unit-tested)
  proxy.ts              login guard for every page and API route
supabase/schema.sql     database schema for a fresh install
supabase/migrations/003_team_and_shared_projects.sql   upgrade a database that already holds data from the earlier multi-account schema
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
   It's safe to run again. If an older, empty version of the schema is there, it's replaced; if an older version holds data, it stops without changing anything.
   If it stops because an older version holds data, first run `supabase/migrations/003_team_and_shared_projects.sql` the same way (it keeps all your data), then run `supabase/schema.sql` again.
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

Open <http://localhost:3000> and **Sign in with Google** as the address in `ALLOWED_EMAILS`; you become the Owner. Then **+ Add Gmail account** for each inbox (leo@, grovert@, support@), allowing read + send. Each inbox imports its last 14 days of mail, creates client profiles, and gets drafts for unanswered client emails from the last 3 days. Then in Settings: add Grovert under **Team** with his access per inbox, fill in **AI reply rules**, and **Import from my Sent mail** so Claude learns the tone.

Deploy: push this folder to a GitHub repo, import it at <https://vercel.com/new>, add every variable from `.env.example` (with `APP_URL=https://YOUR-APP.vercel.app`), deploy. Then finish step 3.3 (redirect URI) and step 4.4 (push subscription), sign in on the deployed URL, and press **Settings → Start push notifications**. `vercel.json` schedules a daily job that, for **each** connected account, renews its Gmail watch when it's within 3 days of expiring (watches last 7 days, so none lapse) and catches up on anything missed.

To add more inboxes later: account switcher → **+ Add Gmail account** (Owner only). Google sign-in runs with the two Gmail scopes; the inbox is imported, gets its own push watch, and becomes the selected one.

## How it works

### Team, roles and isolation

- **Sign-in:** each person signs in with their own Google account (identity only). They must be on the team list (`team_members`). The first sign-in by an address in `ALLOWED_EMAILS` creates an **Owner** (Leo). Owners add people in Settings → Team and give them a role on each inbox:

  | Role | Can do |
  |---|---|
  | Owner | Everything on every inbox: connect Gmail accounts, team, roles, reply rules, Approve |
  | Approver | On that inbox: edit drafts, Approve, Decline, Review |
  | Editor | On that inbox: edit drafts, Decline, Review. Can't send |
  | Viewer | On that inbox: read only |
  | No access | The inbox is hidden entirely |

  Launch setup: Leo = Owner. Grovert = Approver on grovert@ and support@, no access to leo@.
- **Every request re-checks access.** Pages and server actions load only the inboxes the person may see and check their role (view / edit / approve / manage) before doing anything; removing someone takes effect immediately.
- **The database enforces account isolation.** Links between account rows are composite foreign keys on `(account_id, id)`: an email can only point at a client of the same inbox, a draft only at an email of the same inbox. Cross-inbox links are rejected by Postgres.
- **Shared projects stay private per inbox.** A person sees a project only if it touches an inbox they can access (`visible_project_ids()`), and on a project page sees only emails from those inboxes. Claude's drafting context includes only projects visible through the email's own inbox.
- **RLS** is enabled on every table with no policies: the browser and the public API keys can read nothing. All data goes through the server.
- **Tests** fail if any query on an inbox's tables lacks an `account_id` filter, or if a project query bypasses the visible-projects list.
- **Audit log:** every Approve, Decline, edit, redraft, link and admin change is recorded with who did it (Settings → Activity, and per email on the review screen).

### Drafts, versions and sending

- **Drafting picks up where it left off.** Every check (push, the open dashboard's poll, the daily job, Sync now) drafts any unanswered client email from the draft lookback window that has no draft yet, three at a time, as many as fit before the function's time limit. The rest are drafted on the next check, so an email is never left without a draft because a run ran out of time. A lease in `app_settings` keeps two runs from drafting the same inbox at once. A Claude call that takes over 150 s, or a refused API key or unknown model, shows as a red card with Retry and the reason.
- Claude's first draft is **version 1**. "Save as new version" (hand edit) or "send back to Claude with a note" creates the next version, closing the previous one in a single database step.
- **Approve** sends exactly the text on screen (unsaved edits are saved as a new version first). If someone else made a newer version in the meantime, Approve refuses and asks you to reload. The draft is locked `pending → sending` before sending, so a double click can't send twice.
- **Decline** means you handle it yourself outside the dashboard: nothing is sent and it moves to "Handled outside". A reply sent directly from Gmail closes the draft the same way.
- **AI reply rules** (payment methods, delivery fees, policies) live in Settings and apply to every draft. The fixed rules in `src/lib/claude.ts` always apply on top: never offer delivery or pickup dates, no invented prices, nothing sends without Approve.

### Getting new mail

- **New email** → Gmail publishes to Pub/Sub → `/api/gmail/webhook` → Gmail history API → messages stored in `emails`, matched to a client by address (client auto-created). Promotions/social/forums, `no-reply` senders and mailing lists are skipped, except website form notifications and chat-bot emails that name the customer in `Reply-To` (on another domain): those count, with the customer as the client. If an inbox has nothing stored yet, **Sync now** re-runs its 14-day import and says how many emails it skipped as automated.
- **Drafting**: for the newest inbound message in each thread, Claude gets the thread, the client's earlier emails, client notes, linked project details, open projects and Leonel's style examples, and returns a reply plus an optional project suggestion. The prompt (`src/lib/claude.ts`) enforces the rules: Leonel's tone, sign-off "Leonel / The Event Rental Guys", **never offer delivery or pickup dates**, no invented prices or availability (uses `[PLACEHOLDERS]` instead).
- **Approve** sends the reply in the same Gmail thread (`In-Reply-To`/`References` headers, to the client's `Reply-To` if set), from the inbox that received the email, and records it in history.
- **Safety net for push:** while anyone has the dashboard open, an inbox not checked for 10 minutes gets a catch-up sync. A daily cron also renews each inbox's Gmail watch and catches up. The Queue shows "agent last checked X ago", and a reconnect banner if an inbox's Google sign-in stops working.
- **Gmail's per-minute limit:** each mailbox may spend 6,000 Gmail quota units a minute (a message fetch costs 5). Imports fetch one message every ~120 ms, skip messages already stored, and keep what they stored if cut short. A call Gmail refuses for quota is retried for about a minute (sends are never retried automatically); if the limit still holds, the import pauses and the next sync resumes where it stopped. **Sync now** says so instead of failing.
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
