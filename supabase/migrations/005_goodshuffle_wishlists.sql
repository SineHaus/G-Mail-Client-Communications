-- Migration 005: Goodshuffle project links on cards. Adds one table; nothing existing is changed or
-- deleted. Safe to run more than once. Run it in Supabase → SQL Editor (paste the whole file, Run).
-- supabase/schema.sql has the same table for a fresh install.

-- Goodshuffle Pro's "New Wishlist Submission" emails, one row per Goodshuffle project. The dashboard
-- matches them to clients by name plus email or phone, and puts the project's link on the card.
create table if not exists goodshuffle_wishlists (
  id                uuid primary key default gen_random_uuid(),
  account_id        uuid not null references gmail_accounts(id) on delete cascade,
  gmail_message_id  text not null,
  gsp_project_id    text not null,
  url               text not null,
  project_name      text,
  contact_name      text,
  phone             text,
  email             text,
  received_at       timestamptz not null,
  created_at        timestamptz not null default now(),
  constraint goodshuffle_wishlists_account_project_key unique (account_id, gsp_project_id)
);
create index if not exists goodshuffle_wishlists_account_idx on goodshuffle_wishlists(account_id, received_at desc);

alter table goodshuffle_wishlists enable row level security;

notify pgrst, 'reload schema';
