-- Upgrade: single Gmail account  →  multiple Gmail accounts.
-- Run once in the Supabase SQL editor on a database created with the earlier schema.
-- Safe to re-run: it does nothing if the database is already migrated.
--
-- What it does:
--  1. Creates gmail_accounts and moves your current account into it.
--     The old table stored the refresh token UNENCRYPTED, so it is NOT copied — the old table is
--     dropped and you sign in with Google once more; the app then stores the token encrypted.
--  2. Adds account_id to clients, projects, emails, drafts, style_examples and assigns all
--     existing rows to your current account.
--  3. Replaces global unique keys / foreign keys with per-account ones, so rows can only link to
--     rows of the same account.

do $$
declare
  acct uuid;
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'emails' and column_name = 'account_id') then
    raise notice 'Already migrated to multi-account; nothing to do.';
    return;
  end if;

  create table if not exists gmail_accounts (
    id                      uuid primary key default gen_random_uuid(),
    email_address           text not null unique,
    display_name            text,
    refresh_token_encrypted text,
    history_id              text,
    watch_expiration        timestamptz,
    last_synced_at          timestamptz,
    last_error              text,
    created_at              timestamptz not null default now()
  );
  alter table gmail_accounts enable row level security;

  if to_regclass('public.gmail_account') is not null then
    insert into gmail_accounts (email_address, display_name, history_id, watch_expiration, last_synced_at, last_error)
      select lower(email), email, history_id, watch_expires_at, last_synced_at,
             'Sign in again to reconnect (token is now stored encrypted).'
      from gmail_account
      on conflict (email_address) do nothing;
  end if;

  select id into acct from gmail_accounts order by created_at limit 1;
  if acct is null and (exists (select 1 from emails) or exists (select 1 from clients)
                       or exists (select 1 from projects) or exists (select 1 from style_examples)) then
    raise exception 'Existing data but no Gmail account to assign it to. Aborting; nothing changed.';
  end if;

  -- 2. account_id everywhere, existing rows → current account
  alter table clients        add column account_id uuid;
  alter table projects       add column account_id uuid;
  alter table emails         add column account_id uuid;
  alter table drafts         add column account_id uuid;
  alter table style_examples add column account_id uuid;
  update clients        set account_id = acct;
  update projects       set account_id = acct;
  update emails         set account_id = acct;
  update drafts         set account_id = acct;
  update style_examples set account_id = acct;
  alter table clients        alter column account_id set not null;
  alter table projects       alter column account_id set not null;
  alter table emails         alter column account_id set not null;
  alter table drafts         alter column account_id set not null;
  alter table style_examples alter column account_id set not null;
  alter table clients        add constraint clients_account_id_fkey        foreign key (account_id) references gmail_accounts(id) on delete cascade;
  alter table projects       add constraint projects_account_id_fkey       foreign key (account_id) references gmail_accounts(id) on delete cascade;
  alter table emails         add constraint emails_account_id_fkey         foreign key (account_id) references gmail_accounts(id) on delete cascade;
  alter table drafts         add constraint drafts_account_id_fkey         foreign key (account_id) references gmail_accounts(id) on delete cascade;
  alter table style_examples add constraint style_examples_account_id_fkey foreign key (account_id) references gmail_accounts(id) on delete cascade;

  -- 3. global keys → per-account keys
  alter table clients        drop constraint if exists clients_email_key;
  alter table projects       drop constraint if exists projects_project_number_key;
  alter table emails         drop constraint if exists emails_gmail_message_id_key;
  alter table style_examples drop constraint if exists style_examples_source_gmail_message_id_key;
  alter table projects       drop constraint if exists projects_client_id_fkey;
  alter table emails         drop constraint if exists emails_client_id_fkey;
  alter table emails         drop constraint if exists emails_project_id_fkey;
  alter table drafts         drop constraint if exists drafts_email_id_fkey;
  alter table drafts         drop constraint if exists drafts_suggested_project_id_fkey;

  alter table clients  add constraint clients_account_email_key  unique (account_id, email);
  alter table clients  add constraint clients_account_id_id_key  unique (account_id, id);
  alter table projects add constraint projects_account_number_key unique (account_id, project_number);
  alter table projects add constraint projects_account_id_id_key unique (account_id, id);
  alter table emails   add constraint emails_account_message_key unique (account_id, gmail_message_id);
  alter table emails   add constraint emails_account_id_id_key   unique (account_id, id);
  alter table style_examples add constraint style_examples_account_source_key unique (account_id, source_gmail_message_id);

  alter table projects add constraint projects_client_fk foreign key (account_id, client_id)
    references clients(account_id, id) on delete set null (client_id);
  alter table emails add constraint emails_client_fk foreign key (account_id, client_id)
    references clients(account_id, id) on delete set null (client_id);
  alter table emails add constraint emails_project_fk foreign key (account_id, project_id)
    references projects(account_id, id) on delete set null (project_id);
  alter table drafts add constraint drafts_email_fk foreign key (account_id, email_id)
    references emails(account_id, id) on delete cascade;
  alter table drafts add constraint drafts_suggested_project_fk foreign key (account_id, suggested_project_id)
    references projects(account_id, id) on delete set null (suggested_project_id);

  drop index if exists emails_thread_idx;
  drop index if exists emails_unread_idx;
  drop index if exists drafts_status_idx;
  create index emails_account_sent_idx on emails(account_id, sent_at desc);
  create index emails_thread_idx on emails(account_id, gmail_thread_id, sent_at);
  create index emails_unread_idx on emails(account_id) where is_read = false;
  create index drafts_account_status_idx on drafts(account_id, status, created_at desc);

  -- The old single-account table held an unencrypted refresh token: remove it.
  drop table if exists gmail_account;
end $$;
