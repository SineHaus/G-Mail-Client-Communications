-- Upgrade: per-account projects  →  team logins, draft versions and projects shared across TERG.
-- For a database created with the earlier multi-account schema (the one that stopped schema.sql with
-- "An older version of the schema with data in table ... is present").
--
-- How to use:
--  1. Supabase → SQL Editor → New query: paste this whole file and Run.
--  2. Then paste the whole of supabase/schema.sql and Run. It adds the new tables (team_members,
--     account_access, audit_log, app_settings, presence), indexes and functions.
--
-- Keeps every row. Deletes nothing. Runs as one step: if anything fails, nothing is changed.
-- Safe to re-run: it does nothing if the database is already migrated.
--
-- What it changes:
--  * projects: shared across TERG with one numbering. The account_id column is removed (a project is
--    now visible through the emails and clients it is linked to). Stops first, changing nothing, if two
--    accounts use the same project number.
--  * emails / drafts: link to projects by project id instead of (account_id, id).
--  * drafts: new statuses. 'accepted' becomes 'sent', 'revised' (an edited open draft) becomes
--    'pending'. Adds version, created_by, review_note, decided_by, decided_at.
--  * draft_messages: adds author.
--  * gmail_accounts, clients, style_examples: unchanged.

do $$
declare
  dupes text;
begin
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'projects' and column_name = 'account_id') then
    raise notice 'Already migrated (projects are shared); nothing to do. Now run supabase/schema.sql.';
    return;
  end if;

  select string_agg(project_number, ', ') into dupes
    from (select project_number from projects group by project_number having count(*) > 1) d;
  if dupes is not null then
    raise exception 'More than one project uses the number(s) %. Project numbers are now shared across TERG, so give each a different number, then run this again. Nothing was changed.', dupes;
  end if;

  -- Projects: drop the per-account keys and links, then share them.
  alter table emails   drop constraint if exists emails_project_fk;
  alter table drafts   drop constraint if exists drafts_suggested_project_fk;
  alter table projects drop constraint if exists projects_client_fk;
  alter table projects drop constraint if exists projects_account_number_key;
  alter table projects drop constraint if exists projects_account_id_id_key;
  alter table projects drop column account_id;  -- also drops projects_account_id_fkey
  alter table projects add constraint projects_project_number_key unique (project_number);
  alter table projects add constraint projects_client_id_fkey
    foreign key (client_id) references clients(id) on delete set null;
  alter table projects add column if not exists created_by text;

  alter table emails add constraint emails_project_id_fkey
    foreign key (project_id) references projects(id) on delete set null;

  -- Drafts: new statuses, versions and who decided.
  drop index if exists drafts_one_open_per_email;
  alter table drafts drop constraint if exists drafts_status_check;
  update drafts set status = 'sent'    where status = 'accepted';
  update drafts set status = 'pending' where status = 'revised';
  alter table drafts add constraint drafts_status_check
    check (status in ('pending','sending','sent','declined','superseded'));
  alter table drafts add column if not exists version     int  not null default 1;
  alter table drafts add column if not exists created_by  text not null default 'claude';
  alter table drafts add column if not exists review_note text;
  alter table drafts add column if not exists decided_by  text;
  alter table drafts add column if not exists decided_at  timestamptz;
  update drafts set decided_at = updated_at where status in ('sent','declined') and decided_at is null;
  alter table drafts add constraint drafts_suggested_project_id_fkey
    foreign key (suggested_project_id) references projects(id) on delete set null;
  create unique index drafts_one_open_per_email
    on drafts(email_id) where status in ('pending','sending');

  alter table draft_messages add column if not exists author text;

  raise notice 'Migrated. Now run supabase/schema.sql to add the new tables.';
end $$;

notify pgrst, 'reload schema';
