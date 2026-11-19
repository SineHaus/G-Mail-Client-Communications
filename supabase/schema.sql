-- TERG client communications dashboard — database schema
-- Run this whole file once in Supabase → SQL Editor. Safe to re-run.
--
-- Access model
--  * All reads/writes go through the Next.js server with the service-role key. RLS is enabled on every
--    table with NO policies, so the public anon key (and anything in a browser) can read nothing.
--  * Who may see what is decided per team member by account_access (checked on every page and action),
--    and the database enforces that rows of one Gmail account can only link to rows of the same account
--    (composite foreign keys on (account_id, id)).
--  * Projects are shared across TERG (one numbering); a person only sees projects that touch an account
--    they can access (see visible_project_ids()).

create extension if not exists pgcrypto;

-- If an older, EMPTY version of this schema is present, replace it. If it holds data, stop.
do $$
declare
  old_shape boolean;
  has_rows boolean := false;
  t text;
begin
  old_shape :=
       to_regclass('public.gmail_account') is not null
    or (to_regclass('public.emails') is not null and not exists (
          select 1 from information_schema.columns where table_schema='public' and table_name='emails' and column_name='account_id'))
    or exists (select 1 from information_schema.columns where table_schema='public' and table_name='projects' and column_name='account_id');
  if not old_shape then return; end if;
  foreach t in array array['gmail_account','gmail_accounts','clients','projects','emails','drafts','draft_messages','style_examples'] loop
    if to_regclass('public.' || t) is not null then
      execute format('select exists (select 1 from %I)', t) into has_rows;
      if has_rows then
        raise exception 'An older version of the schema with data in table "%" is present. Not changing anything. Run supabase/migrations/003_team_and_shared_projects.sql first, then this file again.', t;
      end if;
    end if;
  end loop;
  drop table if exists draft_messages, drafts, emails, style_examples, projects, clients, gmail_account, gmail_accounts cascade;
  raise notice 'Replaced an older, empty schema.';
end $$;

-- People who can sign in. The first sign-in by an address in ALLOWED_EMAILS creates an Owner.
create table if not exists team_members (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,       -- their Google sign-in address, lowercase
  name          text,
  is_owner      boolean not null default false,
  active        boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists gmail_accounts (
  id                      uuid primary key default gen_random_uuid(),
  email_address           text not null unique,
  display_name            text,
  refresh_token_encrypted text,          -- AES-256-GCM (TOKEN_ENCRYPTION_KEY, server only). NULL = disconnected
  history_id              text,
  watch_expiration        timestamptz,
  last_synced_at          timestamptz,
  last_error              text,
  created_at              timestamptz not null default now()
);

-- Which Gmail accounts each (non-owner) person sees, and their role there. Owners see every account.
create table if not exists account_access (
  member_id   uuid not null references team_members(id) on delete cascade,
  account_id  uuid not null references gmail_accounts(id) on delete cascade,
  role        text not null check (role in ('approver','editor','viewer')),
  primary key (member_id, account_id)
);

create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references gmail_accounts(id) on delete cascade,
  name        text,
  email       text not null,
  phone       text,
  company     text,
  notes       text,
  ignored     boolean not null default false, -- not a client (vendor, personal…): no drafts
  created_at  timestamptz not null default now(),
  constraint clients_account_email_key unique (account_id, email),
  constraint clients_account_id_id_key unique (account_id, id)
);

-- Shared across TERG: one list, one numbering.
create table if not exists projects (
  id              uuid primary key default gen_random_uuid(),
  project_name    text not null,
  project_number  text not null unique,
  client_id       uuid references clients(id) on delete set null,
  status          text not null default 'inquiry'
                  check (status in ('inquiry','booked','completed','cancelled')),
  event_date      date,
  notes           text,
  created_by      text,
  created_at      timestamptz not null default now()
);

create table if not exists emails (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references gmail_accounts(id) on delete cascade,
  gmail_message_id   text not null,
  gmail_thread_id    text not null,
  message_id_header  text,
  client_id          uuid,
  project_id         uuid references projects(id) on delete set null,
  direction          text not null check (direction in ('inbound','outbound')),
  from_address       text,
  from_name          text,
  to_addresses       text,
  subject            text,
  body               text,             -- plain text, quoted history stripped
  snippet            text,
  sent_at            timestamptz not null,
  is_read            boolean not null default false, -- the dashboard's copy; changes are copied to Gmail's UNREAD label (lib/read-sync.ts)
  created_at         timestamptz not null default now(),
  constraint emails_account_message_key unique (account_id, gmail_message_id),
  constraint emails_account_id_id_key unique (account_id, id),
  constraint emails_client_fk foreign key (account_id, client_id)
    references clients(account_id, id) on delete set null (client_id)
);
create index if not exists emails_account_sent_idx on emails(account_id, sent_at desc);
create index if not exists emails_client_idx  on emails(client_id, sent_at desc);
create index if not exists emails_thread_idx  on emails(account_id, gmail_thread_id, sent_at);
create index if not exists emails_project_idx on emails(project_id, sent_at);
create index if not exists emails_unread_idx  on emails(account_id) where is_read = false;

-- Every edit or redraft is a new version (row). Only the newest version of an email's draft is open.
create table if not exists drafts (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references gmail_accounts(id) on delete cascade,
  email_id              uuid not null,
  version               int  not null default 1,
  body                  text not null,
  status                text not null default 'pending'
                        check (status in ('pending','sending','sent','declined','superseded')),
  created_by            text not null default 'claude', -- 'claude' or the team member's email
  review_note           text,                            -- the note sent back to Claude for this version
  suggested_project_id  uuid references projects(id) on delete set null,
  suggestion_reason     text,
  decided_by            text,                            -- who approved / declined (or 'gmail')
  decided_at            timestamptz,
  sent_gmail_message_id text,
  error                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint drafts_email_fk foreign key (account_id, email_id)
    references emails(account_id, id) on delete cascade
);
create index if not exists drafts_account_status_idx on drafts(account_id, status, created_at desc);
create index if not exists drafts_email_idx on drafts(email_id, version);
create unique index if not exists drafts_one_open_per_email
  on drafts(email_id) where status in ('pending','sending');

create table if not exists draft_messages (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references drafts(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  author      text,
  created_at  timestamptz not null default now()
);
create index if not exists draft_messages_draft_idx on draft_messages(draft_id, created_at);

create table if not exists style_examples (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references gmail_accounts(id) on delete cascade,
  context     text,
  body        text not null,
  source_gmail_message_id text,
  created_at  timestamptz not null default now(),
  constraint style_examples_account_source_key unique (account_id, source_gmail_message_id)
);

-- Every Approve, Decline, edit, redraft, link and admin change, with who did it.
create table if not exists audit_log (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid references gmail_accounts(id) on delete set null,
  actor       text not null,
  action      text not null,
  draft_id    uuid,
  email_id    uuid,
  detail      text,
  created_at  timestamptz not null default now()
);
create index if not exists audit_log_account_idx on audit_log(account_id, created_at desc);
create index if not exists audit_log_email_idx on audit_log(email_id, created_at);

-- Company settings, e.g. key 'reply_rules': TERG's AI reply rules, editable in Settings.
create table if not exists app_settings (
  key         text primary key,
  value       text not null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

-- "Who has this draft open" (heartbeat from the review screen).
create table if not exists presence (
  account_id   uuid not null,
  email_id     uuid not null,
  member_email text not null,
  member_name  text,
  seen_at      timestamptz not null default now(),
  primary key (email_id, member_email),
  constraint presence_email_fk foreign key (account_id, email_id)
    references emails(account_id, id) on delete cascade
);

-- AI agent tab (same as supabase/migrations/004_ai_agent.sql)
-- One row per quote request (one per Gmail thread). Claude fills `info` from the emails and drafts the
-- questions for what's missing; people move it through the stages with Approve.
create table if not exists quote_requests (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references gmail_accounts(id) on delete cascade,
  gmail_thread_id   text not null,
  client_id         uuid,
  latest_email_id   uuid,
  stage             text not null default 'gathering'
                    check (stage in ('gathering','ready_to_build','building','ready_to_send','approved_to_send','quote_sent','closed')),
  title             text,
  info              jsonb not null default '{}'::jsonb,  -- checklist key → answer
  items             jsonb not null default '[]'::jsonb,  -- [{name, quantity, note}]
  facts             jsonb not null default '{}'::jsonb,  -- for the delivery-day rules (event date, home/venue, …)
  notes             text,                                -- Claude's notes for the team
  goodshuffle_url   text,                                -- the project in Goodshuffle Pro, once built
  build_approved_by text,
  build_approved_at timestamptz,
  send_approved_by  text,
  send_approved_at  timestamptz,
  closed_reason     text,
  updated_by        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint quote_requests_account_thread_key unique (account_id, gmail_thread_id),
  constraint quote_requests_account_id_id_key unique (account_id, id),
  constraint quote_requests_client_fk foreign key (account_id, client_id)
    references clients(account_id, id) on delete set null (client_id),
  constraint quote_requests_email_fk foreign key (account_id, latest_email_id)
    references emails(account_id, id) on delete set null (latest_email_id)
);
create index if not exists quote_requests_account_stage_idx on quote_requests(account_id, stage, updated_at desc);

-- What someone typed in the AI agent's command box, what Claude made of it, and the approval it created.
create table if not exists agent_commands (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references gmail_accounts(id) on delete cascade,
  created_by        text not null,
  command           text not null,
  kind              text check (kind in ('draft_reply','quote_change','answer')),
  status            text not null default 'working'
                    check (status in ('working','done','needs_approval','applied','declined','failed')),
  reply             text,           -- Claude's one-line answer to the person
  draft_id          uuid,           -- the email draft it made, if any
  quote_request_id  uuid,
  proposed_change   jsonb,          -- a change to a quote request, waiting for Approve
  decided_by        text,
  decided_at        timestamptz,
  error             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint agent_commands_quote_fk foreign key (account_id, quote_request_id)
    references quote_requests(account_id, id) on delete cascade
);
create index if not exists agent_commands_account_idx on agent_commands(account_id, created_at desc);


-- New draft version in one step: closes the open version and opens the next. Refuses if the given
-- version is no longer the open one (someone else changed it first).
create or replace function new_draft_version(p_draft uuid, p_body text, p_created_by text, p_note text)
returns uuid language plpgsql as $$
declare
  old drafts%rowtype;
  new_id uuid;
begin
  update drafts set status = 'superseded', updated_at = now()
   where id = p_draft and status = 'pending'
   returning * into old;
  if not found then
    raise exception 'draft_not_open' using hint = 'A newer version exists or the draft was already handled.';
  end if;
  insert into drafts (account_id, email_id, version, body, status, created_by, review_note, suggested_project_id, suggestion_reason)
  values (old.account_id, old.email_id, old.version + 1, p_body, 'pending', p_created_by, p_note, old.suggested_project_id, old.suggestion_reason)
  returning id into new_id;
  return new_id;
end $$;

-- Projects a person with access to p_accounts may see: those with an email or client in one of those
-- accounts, plus projects not linked to anything yet.
create or replace function visible_project_ids(p_accounts uuid[])
returns table (id uuid) language sql stable as $$
  select e.project_id from emails e where e.project_id is not null and e.account_id = any(p_accounts)
  union
  select p.id from projects p join clients c on c.id = p.client_id where c.account_id = any(p_accounts)
  union
  select p.id from projects p
   where p.client_id is null and not exists (select 1 from emails e where e.project_id = p.id)
$$;

alter table team_members   enable row level security;
alter table gmail_accounts enable row level security;
alter table account_access enable row level security;
alter table clients        enable row level security;
alter table projects       enable row level security;
alter table emails         enable row level security;
alter table drafts         enable row level security;
alter table draft_messages enable row level security;
alter table style_examples enable row level security;
alter table audit_log      enable row level security;
alter table app_settings   enable row level security;
alter table presence       enable row level security;
alter table quote_requests enable row level security;
alter table agent_commands enable row level security;

-- Functions are only for the server (service role), not the public API keys.
revoke execute on function new_draft_version(uuid, text, text, text) from public, anon, authenticated;
revoke execute on function visible_project_ids(uuid[]) from public, anon, authenticated;
grant execute on function new_draft_version(uuid, text, text, text) to service_role;
grant execute on function visible_project_ids(uuid[]) to service_role;

-- Make the new tables visible to the API immediately (refreshes Supabase's schema cache).
notify pgrst, 'reload schema';
