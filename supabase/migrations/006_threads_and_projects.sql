-- Migration 006: full email threads with attachments, and a place for Goodshuffle project details.
-- Only ADDS one column and one table; nothing existing is changed or deleted. Safe to run more than once.
-- Run it in Supabase → SQL Editor (paste the whole file, Run). supabase/schema.sql has the same for a
-- fresh install. Until it's run, the dashboard still works: attachments are read live from Gmail and the
-- Quotes page lists the projects the dashboard already knows.

-- Each email's attachments: [{part, name, type, size}]. The files stay in Gmail and open from there.
alter table emails add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Goodshuffle Pro projects as Goodshuffle shows them (Projects page). Filled by the Goodshuffle sync from
-- Leo's Chrome (next step; Goodshuffle has no API). The Quotes and Payments pages read it when it has rows.
create table if not exists goodshuffle_projects (
  id               uuid primary key default gen_random_uuid(),
  account_id       uuid not null references gmail_accounts(id) on delete cascade,
  gsp_project_id   text not null,
  url              text not null,
  project_name     text,
  client_name      text,
  client_email     text,
  venue            text,
  status           text,          -- as Goodshuffle shows it: New, Quote Sent, Action Needed, Signed, Lost…
  event_date       date,
  logistics_start  timestamptz,
  logistics_end    timestamptz,
  quote_total      numeric(12,2),
  amount_due       numeric(12,2),
  billing_status   text,          -- e.g. Unpaid, Partially paid, Paid, Overdue
  synced_at        timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  constraint goodshuffle_projects_account_project_key unique (account_id, gsp_project_id)
);
create index if not exists goodshuffle_projects_account_idx on goodshuffle_projects(account_id, event_date);

alter table goodshuffle_projects enable row level security;

notify pgrst, 'reload schema';
