-- FH Umpire Assigning Tool — core schema (v1)
-- Run this once in the Supabase SQL Editor (Project > SQL Editor > New query > paste > Run).
-- Safe to re-run only if the tables don't already exist — it does not use IF NOT EXISTS
-- everywhere on purpose, so a partial re-run fails loudly instead of silently skipping.

create extension if not exists pgcrypto;

-- ── People & roles ──────────────────────────────────────────────────────
-- One row per human who can log in. auth_user_id links to Supabase's own
-- auth.users table once they've signed in at least once via magic link.

create table people (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  full_name text not null,
  email text not null unique,
  created_at timestamptz not null default now()
);

create type person_role as enum ('d1_assignor', 'd2d3_assignor', 'evaluator', 'admin');

create table person_roles (
  person_id uuid not null references people(id) on delete cascade,
  role person_role not null,
  primary key (person_id, role)
);

-- Which conferences a D1 assignor has confirm authority over (Gus: ACC,
-- Big East, Ivy, Patriot, A10, MAC, Independents; Lance: B1G; etc.)
create table assignor_conferences (
  person_id uuid not null references people(id) on delete cascade,
  conference text not null,
  primary key (person_id, conference)
);

-- ── Umpires (canonical roster) ──────────────────────────────────────────
create table umpires (
  id uuid primary key default gen_random_uuid(),
  canonical_name text not null,
  aliases text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now()
);

create index idx_umpires_canonical_name on umpires (lower(canonical_name));

-- ── Schools (Phase 6 proximity groundwork — schema exists now, most rows
-- can stay unpopulated until that phase is actually built) ────────────
create table schools (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  aliases text[] not null default '{}',
  division text, -- 'D1' | 'D2' | 'D3'
  conference text,
  city text,
  state text,
  lat double precision,
  lng double precision
);

create index idx_schools_name on schools (lower(name));

-- ── Games ────────────────────────────────────────────────────────────
create table games (
  id uuid primary key default gen_random_uuid(),
  game_date date not null,
  game_time text,           -- kept as free text: source data has "TBD", "5:00", etc.
  day_of_week text,
  game_type text,            -- Exhibition | Scrimmage | Non-Conference | Regular Season | Conference Game | Tournament
  conference text,
  home_school_id uuid references schools(id),
  home_school_text text not null,
  visitor_school_id uuid references schools(id),
  visitor_school_text text not null,
  location_text text,
  primary_assignor_id uuid references people(id),
  created_at timestamptz not null default now(),
  created_by uuid references people(id)
);

create index idx_games_date on games (game_date);

-- ── Potentials — the sandbox pool, intentionally ungated ───────────────
-- Anyone with an account can add a candidate name to any game's Potentials,
-- even if that person is already busy elsewhere that date. No conflict
-- check happens here on purpose (see project spec, "where the conflict
-- check gates").
create table potentials (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  umpire_id uuid not null references umpires(id),
  added_by uuid not null references people(id),
  added_at timestamptz not null default now(),
  note text,
  unique (game_id, umpire_id)
);

-- ── Confirmations — the gated, enforced table ───────────────────────────
-- Two slots per game. Only ever written through confirm_umpire() below —
-- there is deliberately no direct INSERT/UPDATE grant on this table for
-- the authenticated role, so the app cannot bypass the enforcement logic
-- even by accident.
create table confirmations (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references games(id) on delete cascade,
  slot integer not null check (slot in (1, 2)),
  umpire_id uuid not null references umpires(id),
  confirmed_by uuid not null references people(id),
  confirmed_at timestamptz not null default now(),
  is_emergency_override boolean not null default false,
  override_reason text,
  active boolean not null default true
);

-- Only one ACTIVE confirmation per game+slot at a time; superseded rows
-- (active = false) are kept for history/audit, not deleted.
create unique index one_active_confirmation_per_slot
  on confirmations (game_id, slot)
  where active;

create index idx_confirmations_umpire_active
  on confirmations (umpire_id)
  where active;

-- ── Audit log ────────────────────────────────────────────────────────
create table audit_log (
  id uuid primary key default gen_random_uuid(),
  event_type text not null, -- 'potential_added' | 'confirmed' | 'confirmed_override' | 'confirmation_replaced'
  game_id uuid references games(id),
  umpire_id uuid references umpires(id),
  actor_id uuid references people(id),
  details jsonb,
  created_at timestamptz not null default now()
);

create index idx_audit_log_game on audit_log (game_id);
create index idx_audit_log_created on audit_log (created_at desc);

-- ── Helper: resolve the calling user's people.id from their auth session ─
create or replace function current_person_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from people where auth_user_id = auth.uid();
$$;

-- ── The core enforcement function ───────────────────────────────────────
-- This is THE fix for the double-booking problem: confirming an umpire is
-- only allowed if (a) they're in this game's Potentials pool, and (b) they
-- aren't already actively confirmed on a DIFFERENT game the same date —
-- unless the caller explicitly flags an emergency override with a reason,
-- in which case it's allowed but logged loudly.
create or replace function confirm_umpire(
  p_game_id uuid,
  p_slot integer,
  p_umpire_id uuid,
  p_is_emergency boolean default false,
  p_override_reason text default null
)
returns confirmations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor_id uuid;
  v_game_date date;
  v_in_potentials boolean;
  v_conflicting_game_id uuid;
  v_conflicting_conference text;
  v_new_row confirmations;
  v_event_type text;
  v_details jsonb;
begin
  v_actor_id := current_person_id();
  if v_actor_id is null then
    raise exception 'No matching person record for the current logged-in user.';
  end if;

  if p_slot not in (1, 2) then
    raise exception 'Slot must be 1 or 2.';
  end if;

  select game_date into v_game_date from games where id = p_game_id;
  if v_game_date is null then
    raise exception 'Game % not found.', p_game_id;
  end if;

  select exists(
    select 1 from potentials
    where game_id = p_game_id and umpire_id = p_umpire_id
  ) into v_in_potentials;

  select c.game_id, g.conference
    into v_conflicting_game_id, v_conflicting_conference
  from confirmations c
  join games g on g.id = c.game_id
  where c.umpire_id = p_umpire_id
    and c.active
    and g.game_date = v_game_date
    and c.game_id <> p_game_id
  limit 1;

  if (not v_in_potentials or v_conflicting_game_id is not null) and not p_is_emergency then
    if v_conflicting_game_id is not null then
      raise exception 'This umpire is already confirmed on another game (%) the same date. Use the emergency override if this is intentional.', v_conflicting_game_id
        using errcode = 'P0001';
    else
      raise exception 'This umpire is not in this game''s Potentials pool. Add them to Potentials first, or use the emergency override.'
        using errcode = 'P0001';
    end if;
  end if;

  if p_is_emergency and (p_override_reason is null or length(trim(p_override_reason)) = 0) then
    raise exception 'An emergency override requires a reason.';
  end if;

  -- Supersede any existing active confirmation for this game+slot.
  update confirmations
    set active = false
    where game_id = p_game_id and slot = p_slot and active;

  insert into confirmations (game_id, slot, umpire_id, confirmed_by, is_emergency_override, override_reason)
  values (p_game_id, p_slot, p_umpire_id, v_actor_id, p_is_emergency, p_override_reason)
  returning * into v_new_row;

  v_event_type := case when p_is_emergency then 'confirmed_override' else 'confirmed' end;
  v_details := jsonb_build_object(
    'slot', p_slot,
    'was_in_potentials', v_in_potentials,
    'same_date_conflict_game_id', v_conflicting_game_id,
    'same_date_conflict_conference', v_conflicting_conference,
    'is_emergency_override', p_is_emergency,
    'override_reason', p_override_reason
  );

  insert into audit_log (event_type, game_id, umpire_id, actor_id, details)
  values (v_event_type, p_game_id, p_umpire_id, v_actor_id, v_details);

  return v_new_row;
end;
$$;

-- ── Row Level Security ────────────────────────────────────────────────
alter table people enable row level security;
alter table person_roles enable row level security;
alter table assignor_conferences enable row level security;
alter table umpires enable row level security;
alter table schools enable row level security;
alter table games enable row level security;
alter table potentials enable row level security;
alter table confirmations enable row level security;
alter table audit_log enable row level security;

-- Read access: any authenticated (logged-in) person can read everything —
-- this is a small internal team tool, not a public app.
create policy "read all - people" on people for select using (auth.role() = 'authenticated');
create policy "read all - person_roles" on person_roles for select using (auth.role() = 'authenticated');
create policy "read all - assignor_conferences" on assignor_conferences for select using (auth.role() = 'authenticated');
create policy "read all - umpires" on umpires for select using (auth.role() = 'authenticated');
create policy "read all - schools" on schools for select using (auth.role() = 'authenticated');
create policy "read all - games" on games for select using (auth.role() = 'authenticated');
create policy "read all - potentials" on potentials for select using (auth.role() = 'authenticated');
create policy "read all - confirmations" on confirmations for select using (auth.role() = 'authenticated');
create policy "read all - audit_log" on audit_log for select using (auth.role() = 'authenticated');

-- Writes: Potentials can be added directly by any authenticated person
-- (that's the whole point of the sandbox — no gate). Games/umpires/schools
-- can be created/edited by anyone logged in for v1 simplicity (tighten to
-- admin-only later if that turns out to matter).
create policy "insert potentials - any authenticated" on potentials for insert
  with check (auth.role() = 'authenticated');
create policy "delete own potentials" on potentials for delete
  using (added_by = current_person_id());

create policy "insert games - any authenticated" on games for insert
  with check (auth.role() = 'authenticated');
create policy "update games - any authenticated" on games for update
  using (auth.role() = 'authenticated');

create policy "insert umpires - any authenticated" on umpires for insert
  with check (auth.role() = 'authenticated');
create policy "update umpires - any authenticated" on umpires for update
  using (auth.role() = 'authenticated');

create policy "insert schools - any authenticated" on schools for insert
  with check (auth.role() = 'authenticated');
create policy "update schools - any authenticated" on schools for update
  using (auth.role() = 'authenticated');

-- Deliberately NO insert/update policy on `confirmations` for the
-- authenticated role — the only way to write a confirmation is through
-- confirm_umpire(), which runs as security definer and bypasses RLS for
-- its own writes while still checking who's calling via current_person_id().

grant execute on function confirm_umpire(uuid, integer, uuid, boolean, text) to authenticated;
grant execute on function current_person_id() to authenticated;

-- Base table-level grants. RLS policies restrict WHICH rows are visible/
-- writable, but Postgres also requires the underlying table-level
-- privilege to exist at all — without these, every policy above is a
-- no-op and every query from the app returns nothing. Written explicitly
-- rather than relying on a Supabase project's default grants.
grant usage on schema public to authenticated;
grant select on people, person_roles, assignor_conferences, umpires, schools, games,
  potentials, confirmations, audit_log to authenticated;
grant insert on potentials, games, umpires, schools to authenticated;
grant update on games, umpires, schools to authenticated;
grant delete on potentials to authenticated;

-- ── Auto-link: when someone signs in for the first time, if an admin has
-- already added a `people` row for their email (with auth_user_id still
-- null), link it automatically instead of requiring a manual DB edit after
-- every new sign-in.
create or replace function link_person_on_signup()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update people
    set auth_user_id = new.id
    where email = new.email and auth_user_id is null;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function link_person_on_signup();

-- ── Convenience view: today's/this-week's active same-date conflicts ────
-- Surfaces any case where two ACTIVE confirmations put the same umpire on
-- two different games the same date — should normally be empty, since
-- confirm_umpire() blocks this unless someone explicitly overrode it. A
-- non-empty result here means an override was used and is worth a look.
create view v_active_same_date_conflicts as
select
  c1.umpire_id,
  u.canonical_name,
  g1.game_date,
  c1.game_id as game_id_a,
  g1.conference as conference_a,
  c1.is_emergency_override as override_a,
  c2.game_id as game_id_b,
  g2.conference as conference_b,
  c2.is_emergency_override as override_b
from confirmations c1
join confirmations c2
  on c1.umpire_id = c2.umpire_id
  and c1.game_id < c2.game_id
join games g1 on g1.id = c1.game_id
join games g2 on g2.id = c2.game_id
join umpires u on u.id = c1.umpire_id
where c1.active and c2.active and g1.game_date = g2.game_date;

grant select on v_active_same_date_conflicts to authenticated;
