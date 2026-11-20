-- Migration 007: Goodshuffle Pro messages, and replies that go back through Goodshuffle's Messages window.
-- Only ADDS three tables; nothing existing is changed or deleted. Safe to run more than once.
-- Run it in Supabase → SQL Editor (paste the whole file, Run). supabase/schema.sql has the same for a
-- fresh install. Until it's run, the Goodshuffle Pro box shows "Coming soon" as before.
--
-- How it works: the "TERG Goodshuffle messages" Chrome extension (extensions/goodshuffle-messages) runs in
-- the Chrome that is signed in to Goodshuffle Pro as support@theeventrentalguys.com. It copies new messages
-- here, Claude drafts a reply, a person approves it in the dashboard, and the extension types the approved
-- text into Goodshuffle's own reply box and presses Send. Nothing is sent without that approval.

-- A Chrome that may sync messages and send approved replies. The token is stored only as a SHA-256 hash.
create table if not exists goodshuffle_devices (
  id                 uuid primary key default gen_random_uuid(),
  account_id         uuid not null references gmail_accounts(id) on delete cascade,
  label              text not null,
  token_hash         text not null unique,
  created_by         text not null,
  created_at         timestamptz not null default now(),
  last_seen_at       timestamptz,
  last_signed_in_as  text,          -- the Goodshuffle login the extension last saw
  revoked_at         timestamptz
);
create index if not exists goodshuffle_devices_account_idx on goodshuffle_devices(account_id);

-- Messages as Goodshuffle stores them (Messages → a project's client conversation).
create table if not exists goodshuffle_messages (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references gmail_accounts(id) on delete cascade,
  gsp_message_id       text not null,
  gsp_project_id       text not null,
  gsp_conversation_id  text,
  direction            text not null check (direction in ('inbound','outbound','system')),
  sender_name          text,
  sender_email         text,
  subject              text,
  body                 text not null default '',
  sent_at              timestamptz not null,
  synced_at            timestamptz not null default now(),
  constraint goodshuffle_messages_account_message_key unique (account_id, gsp_message_id)
);
create index if not exists goodshuffle_messages_project_idx on goodshuffle_messages(account_id, gsp_project_id, sent_at desc);

-- Replies to send through Goodshuffle. pending (draft) → approved (a person said yes) → sending (the
-- extension claimed it) → sent, or failed. A failed or stuck reply is never retried by itself.
create table if not exists goodshuffle_replies (
  id                   uuid primary key default gen_random_uuid(),
  account_id           uuid not null references gmail_accounts(id) on delete cascade,
  gsp_project_id       text not null,
  in_reply_to          text,          -- gsp_message_id of the customer message this answers
  body                 text not null,
  status               text not null default 'pending'
                       check (status in ('pending','approved','sending','sent','failed','declined')),
  created_by           text not null default 'claude',
  decided_by           text,
  decided_at           timestamptz,
  claimed_by           uuid references goodshuffle_devices(id) on delete set null,
  claimed_at           timestamptz,
  sent_at              timestamptz,
  sent_gsp_message_id  text,
  error                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create index if not exists goodshuffle_replies_account_idx on goodshuffle_replies(account_id, status, created_at desc);
create unique index if not exists goodshuffle_replies_one_open_per_project
  on goodshuffle_replies(account_id, gsp_project_id) where status in ('pending','approved','sending','failed');

alter table goodshuffle_devices enable row level security;
alter table goodshuffle_messages enable row level security;
alter table goodshuffle_replies enable row level security;

notify pgrst, 'reload schema';
