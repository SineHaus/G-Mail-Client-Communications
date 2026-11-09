-- Client Communications Dashboard — database schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL Editor → New query → paste → Run).
-- All access goes through the Next.js server with the service-role key, so RLS is
-- enabled with no policies: the public anon key can read/write nothing.

create extension if not exists pgcrypto;

-- The single connected Gmail account (Leonel's) and its sync state.
create table if not exists gmail_account (
  id             int primary key default 1 check (id = 1),
  email          text not null,
  refresh_token  text not null,
  history_id     text,
  watch_expires_at timestamptz,
  last_synced_at timestamptz,
  updated_at     timestamptz not null default now()
);

create table if not exists clients (
  id          uuid primary key default gen_random_uuid(),
  name        text,
  email       text not null unique,
  phone       text,
  company     text,
  notes       text,
  ignored     boolean not null default false, -- true = not a client (vendor, newsletter…): no drafts
  created_at  timestamptz not null default now()
);

create table if not exists projects (
  id              uuid primary key default gen_random_uuid(),
  project_name    text not null,
  project_number  text not null unique,
  client_id       uuid references clients(id) on delete set null,
  status          text not null default 'inquiry'
                  check (status in ('inquiry','booked','completed','cancelled')),
  event_date      date,
  notes           text,
  created_at      timestamptz not null default now()
);

create table if not exists emails (
  id                 uuid primary key default gen_random_uuid(),
  gmail_message_id   text not null unique,
  gmail_thread_id    text not null,
  message_id_header  text,             -- RFC 822 Message-ID, used for In-Reply-To when replying
  client_id          uuid references clients(id) on delete set null,
  project_id         uuid references projects(id) on delete set null,
  direction          text not null check (direction in ('inbound','outbound')),
  from_address       text,
  from_name          text,
  to_addresses       text,
  subject            text,
  body               text,             -- plain text, quoted history stripped
  snippet            text,
  sent_at            timestamptz not null,
  created_at         timestamptz not null default now()
);
create index if not exists emails_client_idx  on emails(client_id, sent_at desc);
create index if not exists emails_thread_idx  on emails(gmail_thread_id, sent_at);
create index if not exists emails_project_idx on emails(project_id, sent_at);

create table if not exists drafts (
  id                    uuid primary key default gen_random_uuid(),
  email_id              uuid not null references emails(id) on delete cascade,
  body                  text not null,
  status                text not null default 'pending'
                        check (status in ('pending','accepted','declined','revised','superseded')),
  suggested_project_id  uuid references projects(id) on delete set null,
  suggestion_reason     text,
  error                 text,
  sent_gmail_message_id text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index if not exists drafts_status_idx on drafts(status, created_at desc);
-- At most one open draft per email.
create unique index if not exists drafts_one_open_per_email
  on drafts(email_id) where status in ('pending','revised');

-- Review-view chat with Claude about a draft ("make it shorter").
create table if not exists draft_messages (
  id          uuid primary key default gen_random_uuid(),
  draft_id    uuid not null references drafts(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz not null default now()
);
create index if not exists draft_messages_draft_idx on draft_messages(draft_id, created_at);

-- Past replies from Leonel that teach Claude his tone.
create table if not exists style_examples (
  id          uuid primary key default gen_random_uuid(),
  context     text,          -- optional: what the client asked
  body        text not null, -- Leonel's reply
  source_gmail_message_id text unique,
  created_at  timestamptz not null default now()
);

alter table gmail_account  enable row level security;
alter table clients        enable row level security;
alter table projects       enable row level security;
alter table emails         enable row level security;
alter table drafts         enable row level security;
alter table draft_messages enable row level security;
alter table style_examples enable row level security;
