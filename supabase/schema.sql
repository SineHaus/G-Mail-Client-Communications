-- Client Communications Dashboard — database schema (multi-account)
-- FRESH INSTALL: run this once in the Supabase SQL editor.
-- UPGRADING a database created with the earlier single-account schema? Run
-- supabase/migrations/002_multi_account.sql instead.
--
-- All access goes through the Next.js server with the service-role key; RLS is enabled with no
-- policies, so the public anon key can read/write nothing.
--
-- Account isolation is enforced by the database itself: every row carries account_id, and every
-- link between rows (email→client, email→project, project→client, draft→email, draft→project)
-- is a composite foreign key on (account_id, id), so a row can only ever point at rows of the
-- SAME Gmail account.

create extension if not exists pgcrypto;

create table if not exists gmail_accounts (
  id                      uuid primary key default gen_random_uuid(),
  email_address           text not null unique,
  display_name            text,
  refresh_token_encrypted text,          -- AES-256-GCM (key in TOKEN_ENCRYPTION_KEY, server only). NULL = disconnected
  history_id              text,
  watch_expiration        timestamptz,
  last_synced_at          timestamptz,
  last_error              text,
  created_at              timestamptz not null default now()
);

create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references gmail_accounts(id) on delete cascade,
  name        text,
  email       text not null,
  phone       text,
  company     text,
  notes       text,
  ignored     boolean not null default false, -- true = not a client (vendor, newsletter…): no drafts
  created_at  timestamptz not null default now(),
  constraint clients_account_email_key unique (account_id, email),
  constraint clients_account_id_id_key unique (account_id, id)
);

create table if not exists projects (
  id              uuid primary key default gen_random_uuid(),
  account_id      uuid not null references gmail_accounts(id) on delete cascade,
  project_name    text not null,
  project_number  text not null,
  client_id       uuid,
  status          text not null default 'inquiry'
                  check (status in ('inquiry','booked','completed','cancelled')),
  event_date      date,
  notes           text,
  created_at      timestamptz not null default now(),
  constraint projects_account_number_key unique (account_id, project_number),
  constraint projects_account_id_id_key unique (account_id, id),
  constraint projects_client_fk foreign key (account_id, client_id)
    references clients(account_id, id) on delete set null (client_id)
);

create table if not exists emails (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references gmail_accounts(id) on delete cascade,
  gmail_message_id   text not null,
  gmail_thread_id    text not null,
  message_id_header  text,             -- RFC 822 Message-ID, used for In-Reply-To when replying
  client_id          uuid,
  project_id         uuid,
  direction          text not null check (direction in ('inbound','outbound')),
  from_address       text,
  from_name          text,
  to_addresses       text,
  subject            text,
  body               text,             -- plain text, quoted history stripped
  snippet            text,
  sent_at            timestamptz not null,
  is_read            boolean not null default false, -- read/unread lives ONLY here, never in Gmail
  created_at         timestamptz not null default now(),
  constraint emails_account_message_key unique (account_id, gmail_message_id),
  constraint emails_account_id_id_key unique (account_id, id),
  constraint emails_client_fk foreign key (account_id, client_id)
    references clients(account_id, id) on delete set null (client_id),
  constraint emails_project_fk foreign key (account_id, project_id)
    references projects(account_id, id) on delete set null (project_id)
);
create index if not exists emails_account_sent_idx on emails(account_id, sent_at desc);
create index if not exists emails_client_idx  on emails(client_id, sent_at desc);
create index if not exists emails_thread_idx  on emails(account_id, gmail_thread_id, sent_at);
create index if not exists emails_project_idx on emails(project_id, sent_at);
create index if not exists emails_unread_idx  on emails(account_id) where is_read = false;

create table if not exists drafts (
  id                    uuid primary key default gen_random_uuid(),
  account_id            uuid not null references gmail_accounts(id) on delete cascade,
  email_id              uuid not null,
  body                  text not null,
  status                text not null default 'pending'
                        check (status in ('pending','accepted','declined','revised','superseded')),
  suggested_project_id  uuid,
  suggestion_reason     text,
  error                 text,
  sent_gmail_message_id text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint drafts_email_fk foreign key (account_id, email_id)
    references emails(account_id, id) on delete cascade,
  constraint drafts_suggested_project_fk foreign key (account_id, suggested_project_id)
    references projects(account_id, id) on delete set null (suggested_project_id)
);
create index if not exists drafts_account_status_idx on drafts(account_id, status, created_at desc);
-- At most one open draft per email.
create unique index if not exists drafts_one_open_per_email
  on drafts(email_id) where status in ('pending','revised');

-- Review-view chat with Claude about a draft ("make it shorter"). Belongs to its draft's account.
create table if not exists draft_messages (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references drafts(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists draft_messages_draft_idx on draft_messages(draft_id, created_at);

-- Past replies that teach Claude Leonel's tone — per account.
create table if not exists style_examples (
  id          uuid primary key default gen_random_uuid(),
  account_id  uuid not null references gmail_accounts(id) on delete cascade,
  context     text,          -- optional: what the client asked
  body        text not null, -- Leonel's reply
  source_gmail_message_id text,
  created_at  timestamptz not null default now(),
  constraint style_examples_account_source_key unique (account_id, source_gmail_message_id)
);

alter table gmail_accounts enable row level security;
alter table clients        enable row level security;
alter table projects       enable row level security;
alter table emails         enable row level security;
alter table drafts         enable row level security;
alter table draft_messages enable row level security;
alter table style_examples enable row level security;
