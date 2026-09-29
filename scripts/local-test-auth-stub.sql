-- FOR LOCAL TESTING ONLY — simulates just enough of Supabase's built-in
-- `auth` schema (auth.users, auth.uid(), auth.role()) to run the real
-- migration against a plain local Postgres and exercise RLS. Never run
-- this against an actual Supabase project — it already provides these.
create schema if not exists auth;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique
);

-- Mocked via session GUCs instead of real JWT claims.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('myapp.mock_uid', true), '')::uuid
$$;

create or replace function auth.role() returns text
language sql stable as $$
  select coalesce(nullif(current_setting('myapp.mock_role', true), ''), 'anon')
$$;
