-- Migration 004: AI agent tab (phase 1). Adds quote requests and the command box's history.
-- Only ADDS two tables; nothing existing is changed or deleted. Safe to run more than once.
-- Run it in Supabase → SQL Editor (paste the whole file, Run). supabase/schema.sql has the same tables
-- for a fresh install.

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

alter table quote_requests enable row level security;
alter table agent_commands enable row level security;

notify pgrst, 'reload schema';
