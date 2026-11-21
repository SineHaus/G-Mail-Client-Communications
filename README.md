# Client Communications Dashboard — The Event Rental Guys

A web dashboard that connects to one or more Gmail accounts and handles all client communication in one place.
Claude drafts a reply to every new client email in Leonel's voice. **Nothing is sent until someone with send rights presses Approve.**

The left panel has three tabs, with Settings at the bottom:

- **AI agent** (home): one approval queue for everything waiting on the team. Claude reads each new client email; when it's a quote request it fills in the request from the thread and its reply asks the customer for whatever on the **quote checklist** is still missing. Once every required item has an answer the request moves to **Ready to put quote together** (Approve), then **Building in Goodshuffle** (paste the project link), then **Ready to send quote** (Approve), then **Quote sent**. Every quote card shows the proposed drop-off and pickup days from Leo's delivery rules (for the team only, never offered to customers), the delivery fee rule, what's always on a quote, anything to check with Leo first, and a link to Goodshuffle Pro. A **command box** takes typed tasks ("add 10 chairs to the Curtin quote", "draft a reply to Ashley about Saturday pickup"); Claude turns each into an email draft or a proposed change, and both wait for Approve. Email drafts sit in the same queue with **Approve** (sends) / **Review** / **Decline**.
- **Communication**: the email queue (all drafts, Sent and Handled outside), Clients and Projects. Texts and Goodshuffle messages come in a later phase.
- **Overview**: the numbers this dashboard tracks itself (emails waiting, unread, quote requests by stage). Goodshuffle numbers come later.
- **Draft review**: full thread, editable draft, "send back to Claude with a note". Every edit or redraft is saved as a new **version**; Approve sends exactly the version on screen.
- **Clients**: auto-created from email addresses; profile with contact info, notes, projects and full email history.
- **Projects**: shared across TERG with one numbering. Emails auto-link when a project number appears in them (or the client has one open project); otherwise Claude suggests one, confirmed with a click.
- **Accounts & team** (Settings): connected Gmail accounts; team members with a role per inbox (Owner, Approver, Editor, Viewer, or no access); editable **AI reply rules**; style examples; activity log.
- **Quote checklist** (Settings): what a quote needs, one item per line, editable without code.
- **Account switcher** (top of every page): only the inboxes you have access to, with open-draft and unread counts. The last selected one is remembered.

Drafts live only in this app's database, never in Gmail Drafts. Only the Approve button sends mail (`src/lib/send.ts` is the single code path that calls Gmail's send API), and only for the Owner or an Approver on that inbox.

### Gmail safety: the dashboard reads, sends approved replies, and copies read/unread

- **Scopes:** connecting a mailbox asks for `gmail.readonly`, `gmail.send` and `gmail.modify`. `gmail.modify` is there only so read/unread can be copied to Gmail; the allowlist below limits it to the UNREAD label. No full mail access (`https://mail.google.com/`), and no `include_granted_scopes`, so older, broader grants are never inherited; any other scope is refused. Signing in to the dashboard asks only for `openid email` (who you are) and gives the app no access to your mailbox.
- **Allowlist:** every Gmail request goes through `src/lib/google.ts`, which checks it against `src/lib/gmail-policy.ts` before sending. Only these calls are allowed: `getProfile`, `messages.list`, `messages.get`, `history.list` (all read-only), `watch` (push notifications), `messages.send`, and two read/unread calls: `messages.batchModify` that only removes `UNREAD`, and `messages.modify` that only adds `UNREAD`. The request body of those two is checked too. Anything else throws, including other labels (INBOX, STARRED, TRASH…), archive, `threads.modify`, trash, delete, label admin and drafts.
- **Same rules for every account:** each added account gets exactly the same scopes and goes through the same allowlist.
- **Read/unread is copied to Gmail** (`src/lib/read-sync.ts`). The dashboard's copy (`emails.is_read`) changes first; then Gmail's UNREAD label follows, so Gmail and apps that mirror it (Spark, the Gmail app) show the same. Opening an email in the Review view, approving or declining marks it read; "Mark read/unread" toggles it. Marking read also marks the earlier inbound emails in that thread read (a conversation shows as unread while any message in it is), but never later ones. Goodshuffle wish-list notices the dashboard hides on its own are marked read in the dashboard only.
- **Older connections:** an inbox connected before `gmail.modify` was added keeps working; read/unread just stays in the dashboard, and a note with a **Reconnect** button appears until it is reconnected once. Reconnecting with the new permission also marks read in Gmail the emails from the last 30 days that were already read in the dashboard. A Gmail error never undoes the dashboard change.
- **Replies** go out with `messages.send` using the original `threadId` plus `In-Reply-To`/`References`, so they land in the same conversation. Gmail itself puts sent mail in Sent, as it does for any email you send.
- **Enforced by tests:** `npm test` fails if a read/unread request could touch any label other than UNREAD, if any file other than `lib/gmail-policy.ts` spells out a label change, if the scopes change, or if any file other than `lib/google.ts` calls the Gmail API.

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
  lib/gmail-policy.ts   allowed scopes + allowlist of Gmail calls (read-only, send, UNREAD label)
  lib/read-sync.ts      read/unread: dashboard first, then Gmail's UNREAD label
  lib/token-crypto.ts   AES-256-GCM encryption of refresh tokens
  lib/accounts.ts       account list, current-account selection (cookie), switcher counts
  components/AccountSwitcher.tsx  the dropdown
  lib/ingest.ts         Gmail → emails/clients; picks which emails get drafts
  lib/claude.ts         drafting + revision prompts (drafting rules live here)
  lib/draft-queue.ts    finds client emails still without a draft and drafts them within the time left
  lib/send.ts           Approve → send reply in the same Gmail thread
  lib/quotes.ts         quote requests: checklist, what Claude found in each email, stages
  lib/quote-rules.ts    checklist parsing, Leo's delivery-day rules, Goodshuffle links (unit-tested)
  lib/agent-commands.ts the AI agent's command box (drafts and proposed changes only)
  lib/team.ts, lib/permissions.ts   team members, roles per inbox
  lib/drafts.ts         draft versions
  lib/email-parse.ts    MIME parsing, quote stripping, reply building (unit-tested)
  proxy.ts              login guard for every page and API route
supabase/schema.sql     database schema for a fresh install
supabase/migrations/003_team_and_shared_projects.sql   upgrade a database that already holds data from the earlier multi-account schema
supabase/migrations/004_ai_agent.sql   adds the AI agent's two tables (quote_requests, agent_commands); run once on an existing database
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
4. **Data access → Add or remove scopes**: add `.../auth/gmail.readonly`, `.../auth/gmail.send` and `.../auth/gmail.modify` (read/unread only; see Gmail safety). Save. Do **not** add `https://mail.google.com/`.

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

Create an API key at <https://console.anthropic.com/> → `ANTHROPIC_API_KEY`. Drafts use `claude-opus-5-5` by default (override with `ANTHROPIC_MODEL`). To spend less, set `ANTHROPIC_MODEL=claude-sonnet-5-5` (about half the price per draft). `ANTHROPIC_EFFORT` sets how hard Claude thinks before writing: `low` (default, cheapest), `medium` or `high`. Each draft sends 6 style examples, the last 5 emails with the client from other threads and the last 8 messages of the thread, all shortened; the style examples go in the cached part of the system prompt, so drafts written within 5 minutes of each other pay about a tenth for them. Set a monthly spend limit in the Anthropic Console (Limits) as a backstop. Requests opt into Anthropic's server-side refusal fallback, so a declined request is retried on a fallback model automatically.

After changing `ANTHROPIC_API_KEY` (or any other environment variable) in Vercel, redeploy: a running deployment keeps the old value. Drafts that failed with "The Anthropic API key was refused" stay as red cards until someone taps **Retry draft**.

### 6b. Token encryption key

Generate `TOKEN_ENCRYPTION_KEY` with `openssl rand -base64 32`. Every account's Google refresh token is encrypted with it (AES-256-GCM) before it's written to Supabase, and it's decrypted only on the server when calling Gmail. Tokens never reach the browser. Don't change the key later, or every account will need reconnecting.

### 7. Run locally, then deploy to Vercel

```bash
cp .env.example .env.local   # fill in every value
npm install
npm run dev
```

Open <http://localhost:3000> and **Sign in with Google** as the address in `ALLOWED_EMAILS`; you become the Owner. Then **+ Add Gmail account** for each inbox (leo@, grovert@, support@), allowing all the Gmail permissions it asks for. Each inbox imports its last 14 days of mail, creates client profiles, and gets drafts for unanswered client emails from the last 3 days. Then in Settings: add Grovert under **Team** with his access per inbox, fill in **AI reply rules**, and **Import from my Sent mail** so Claude learns the tone.

Deploy: push this folder to a GitHub repo, import it at <https://vercel.com/new>, add every variable from `.env.example` (with `APP_URL=https://YOUR-APP.vercel.app`), deploy. Then finish step 3.3 (redirect URI) and step 4.4 (push subscription), sign in on the deployed URL, and press **Settings → Start push notifications**. `vercel.json` schedules a daily job that, for **each** connected account, renews its Gmail watch when it's within 3 days of expiring (watches last 7 days, so none lapse) and catches up on anything missed.

To add more inboxes later: account switcher → **+ Add Gmail account** (Owner only). Google sign-in runs with the three Gmail scopes; the inbox is imported, gets its own push watch, and becomes the selected one.

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

### AI agent and quote requests

- **Setup:** on a database that already exists, run `supabase/migrations/004_ai_agent.sql` once in Supabase → SQL Editor. It only adds two tables. Until it's run, the AI agent tab shows the email drafts as before and explains the step; drafting is unchanged.
- **Gathering info:** drafting a reply is one Claude call that also reads the thread for a quote request: the checklist answers, the items, and facts for delivery planning (event date, home or venue, start time, requests like a Saturday or same-night pickup). Answers are merged into the thread's quote request and never erased. The reply asks only for required items still missing, and never mentions delivery or pickup dates.
- **Gates:** "Ready to put quote together" and "Ready to send quote" need someone with send rights (Owner or Approver). In this first version the dashboard doesn't touch Goodshuffle: after the first approval someone builds the project in Goodshuffle and pastes its link; after the second they press Send To Client in Goodshuffle and mark it here. Only `pro.goodshuffle.com` links are accepted.
- **Goodshuffle links:** Goodshuffle Pro has no API, but its "New Wishlist Submission" emails name the project (and its View Project link) with the customer's name, phone and email. They stay out of the queue, and the dashboard keeps them in `goodshuffle_wishlists` (the past year is read from Gmail once per inbox, read-only). A quote card gets the link by itself when the name and the email or phone agree, the wishlist came in around the time of the request, and only one project fits. Weaker fits show as "Possible Goodshuffle project" with a button to use it after checking. A link someone typed is never replaced, and one someone removed isn't put back. No Claude calls; nothing in Goodshuffle changes. Projects started by hand are found too: Goodshuffle puts the project number in the subject of its quote and invoice emails ("Quote for Emma Hutton (Project #232032021)"), so a card is linked when its own Gmail thread, or an email with the customer's address from around or after the request, names exactly one project (internal addresses like logistics@ never count). Email cards whose subject names a project get an "Open in Goodshuffle" link. Setup for the wishlist part: run `supabase/migrations/005_goodshuffle_wishlists.sql` once in Supabase → SQL Editor (one new table).
- **Delivery days** come from `lib/quote-rules.ts` (Leo's rules, Nov 18, with tests): weekend at a home drops Thu/Fri and picks up Mon/Tue; weekend at a venue drops that morning and picks up the next morning; Friday drops Wed/Thu; midweek is day before and day after; Thanksgiving drops Tue/Wed and picks up Fri/Sat. Venue prices, Saturday pickups and same-night pickups are flagged for Leo.
- **Commands** are logged in `agent_commands` with who typed them. A command can create or revise an email draft, or propose a change to a quote request, which waits for Approve. It can't send or change anything by itself.

### Drafts, versions and sending

- **Drafting picks up where it left off.** Every check (push, the open dashboard's poll, the daily job, Sync now) drafts any unanswered client email from the draft lookback window that has no draft yet, three at a time, as many as fit before the function's time limit. The rest are drafted on the next check, so an email is never left without a draft because a run ran out of time. A lease in `app_settings` keeps two runs from drafting the same inbox at once. A Claude call that takes over 150 s, or a refused API key or unknown model, shows as a red card with Retry and the reason.
- Claude's first draft is **version 1**. "Save as new version" (hand edit) or "send back to Claude with a note" creates the next version, closing the previous one in a single database step.
- **Approve** sends exactly the text on screen (unsaved edits are saved as a new version first). If someone else made a newer version in the meantime, Approve refuses and asks you to reload. The draft is locked `pending → sending` before sending, so a double click can't send twice.
- **Decline** means you handle it yourself outside the dashboard: nothing is sent and it moves to "Handled outside". A reply sent directly from Gmail closes the draft the same way.
- **AI reply rules** (payment methods, delivery fees, policies) live in Settings and apply to every draft. The fixed rules in `src/lib/claude.ts` always apply on top: never offer delivery or pickup dates, no invented prices, nothing sends without Approve.

### Getting new mail

- **New email** → Gmail publishes to Pub/Sub → `/api/gmail/webhook` → Gmail history API → messages stored in `emails`, matched to a client by address (client auto-created). Promotions/social/forums, `no-reply` senders and mailing lists are skipped, except website form notifications and chat-bot emails that name the customer in `Reply-To` (on another domain): those count, with the customer as the client. Goodshuffle Pro's "New Wish List Submission" notices are skipped (Leo doesn't want them); ones stored before that rule get their open drafts closed and are marked read on the next check. If an inbox has nothing stored yet, **Sync now** re-runs its 14-day import and says how many emails it skipped as automated.
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
