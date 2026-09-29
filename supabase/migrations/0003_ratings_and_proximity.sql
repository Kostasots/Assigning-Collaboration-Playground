-- FH Umpire Assigning Tool — ratings + mileage-free-conference proximity (v1)
-- Run this in the Supabase SQL Editor AFTER 0001_init.sql and 0002_seed_people.sql.
--
-- Two features:
-- 1. Umpire ratings (USA FH rating + an internal rating whose scale is still
--    TBD) so assignors can see level at decision time on the game page.
-- 2. For conferences that don't reimburse mileage (Patriot League today,
--    flagged as data — not hardcoded — so it can extend to others later),
--    automatically suggest umpires within 100 miles of the host school into
--    that game's Potentials pool, clearly tagged as system-suggested and
--    removable, same as any other Potentials entry.
--
-- IMPORTANT — this feature is genuinely inert until two pieces of location
-- data exist, neither of which is populated yet:
--   (a) schools.lat / schools.lng for the host school (Phase 6 groundwork,
--       already in the schema, not yet geocoded)
--   (b) umpires.home_lat / umpires.home_lng for each umpire (new in this
--       migration, needs the roster export from RQ)
-- Nothing breaks if this data is missing — suggest_nearby_umpires() just
-- quietly inserts zero rows until both sides are populated. See README for
-- the plan on getting that data in.

-- ── Umpire ratings + home location ──────────────────────────────────────
alter table umpires add column if not exists home_city text;
alter table umpires add column if not exists home_state text;
alter table umpires add column if not exists home_lat double precision;
alter table umpires add column if not exists home_lng double precision;
-- Kept as free text on purpose: USA FH's scale can be entered as-is (e.g.
-- "National", "Level 3"), and the internal rating's scale isn't designed
-- yet — text avoids a second migration once it is. Tighten to a proper
-- enum/numeric type later if a fixed scale gets decided.
alter table umpires add column if not exists usafh_rating text;
alter table umpires add column if not exists internal_rating text;

-- ── Conferences reference table — data-driven mileage policy ───────────
-- Whether a conference reimburses mileage is data, not application logic,
-- so this can extend beyond Patriot League later without a code change.
create table if not exists conferences (
  name text primary key,
  mileage_reimbursed boolean not null default false
);

alter table conferences enable row level security;
create policy "read all - conferences" on conferences for select using (auth.role() = 'authenticated');
create policy "insert conferences - any authenticated" on conferences for insert
  with check (auth.role() = 'authenticated');
create policy "update conferences - any authenticated" on conferences for update
  using (auth.role() = 'authenticated');

grant select, insert, update on conferences to authenticated;

-- Seeded with both spellings that commonly show up for this conference —
-- harmless if only one matches your actual games.conference text. Check
-- what you actually have with: select distinct conference from games;
-- and add/fix a row here if neither spelling matches.
insert into conferences (name, mileage_reimbursed) values
  ('Patriot', true),
  ('Patriot League', true)
on conflict (name) do update set mileage_reimbursed = excluded.mileage_reimbursed;

-- ── Potentials: support system-suggested entries ────────────────────────
-- Auto-suggested candidates land in the same Potentials table as
-- human-added ones (same sandbox, same Confirm-gate protections) but are
-- tagged so the UI can label them and so they can be removed by anyone,
-- not just whoever "added" them (nobody did, a rule did).
alter table potentials alter column added_by drop not null;
alter table potentials add column if not exists system_suggested boolean not null default false;
alter table potentials add column if not exists suggested_distance_miles double precision;

create policy "delete system-suggested potentials" on potentials for delete
  using (system_suggested = true and auth.role() = 'authenticated');

-- ── Distance helper (haversine, in miles) ───────────────────────────────
create or replace function miles_between(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
)
returns double precision
language sql
immutable
as $$
  select case
    when lat1 is null or lng1 is null or lat2 is null or lng2 is null then null
    else 3958.8 * 2 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) +
      cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
    ))
  end
$$;

-- ── Core proximity function ─────────────────────────────────────────────
-- Callable automatically (via the triggers below, on new/changed games) or
-- manually (e.g. a "Suggest nearby umpires" button, or re-run in bulk once
-- location data lands for games that already existed before this data did).
-- Matches the host school by home_school_id if set, else by name/alias
-- text match against home_school_text — the import script doesn't resolve
-- home_school_id today, so relying on text match is what actually works
-- against real imported data.
create or replace function suggest_nearby_umpires(p_game_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conference text;
  v_home_school_id uuid;
  v_home_school_text text;
  v_school_lat double precision;
  v_school_lng double precision;
  v_mileage_reimbursed boolean;
  v_inserted integer := 0;
begin
  select conference, home_school_id, home_school_text
    into v_conference, v_home_school_id, v_home_school_text
  from games where id = p_game_id;

  if v_conference is null then
    return 0;
  end if;

  select mileage_reimbursed into v_mileage_reimbursed
  from conferences where lower(name) = lower(v_conference);

  if not coalesce(v_mileage_reimbursed, false) then
    return 0;
  end if;

  select lat, lng into v_school_lat, v_school_lng
  from schools
  where id = v_home_school_id
     or lower(name) = lower(v_home_school_text)
     or (v_home_school_text is not null and v_home_school_text ilike any (aliases))
  order by (id = v_home_school_id) desc nulls last
  limit 1;

  if v_school_lat is null or v_school_lng is null then
    return 0; -- host school not geocoded yet — nothing to do until that data lands
  end if;

  insert into potentials (game_id, umpire_id, system_suggested, suggested_distance_miles, note)
  select p_game_id, u.id, true,
    miles_between(v_school_lat, v_school_lng, u.home_lat, u.home_lng),
    'Auto-suggested: within 100mi of host school (' || v_conference || ' does not reimburse mileage)'
  from umpires u
  where u.home_lat is not null and u.home_lng is not null
    and miles_between(v_school_lat, v_school_lng, u.home_lat, u.home_lng) <= 100
  on conflict (game_id, umpire_id) do nothing;

  get diagnostics v_inserted = row_count;
  return v_inserted;
end;
$$;

grant execute on function suggest_nearby_umpires(uuid) to authenticated;
grant execute on function miles_between(double precision, double precision, double precision, double precision) to authenticated;

-- ── Triggers: auto-run on new games, and on games whose conference or
-- host school changes (e.g. a correction after initial entry) ───────────
create or replace function trg_suggest_nearby_umpires()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform suggest_nearby_umpires(new.id);
  return new;
end;
$$;

create trigger after_game_insert_suggest_nearby
  after insert on games
  for each row execute function trg_suggest_nearby_umpires();

create trigger after_game_update_suggest_nearby
  after update of conference, home_school_id, home_school_text on games
  for each row
  when (new.conference is distinct from old.conference
        or new.home_school_id is distinct from old.home_school_id
        or new.home_school_text is distinct from old.home_school_text)
  execute function trg_suggest_nearby_umpires();
