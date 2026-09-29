-- FOR LOCAL TESTING ONLY. Exercises migration 0003 (ratings + proximity
-- auto-suggest) end-to-end as app_user/authenticated. Run AFTER
-- local-test-scenarios.sql (reuses the same seeded people/session role
-- setup convention) against a database that already has 0001, 0002, and
-- 0003 applied.

\echo '=== Setup: a geocoded school, plus near/far umpires, as postgres (owner) ==='
insert into schools (id, name, division, lat, lng) values
  ('11110000-0000-0000-0000-000000000001', 'Test Host College', 'D1', 40.0000, -75.0000);

-- ~30 miles away (should qualify for the 100-mile suggestion)
insert into umpires (id, canonical_name, home_lat, home_lng, usafh_rating, internal_rating) values
  ('22220000-0000-0000-0000-000000000001', 'Nearby Umpire', 40.4000, -75.0000, 'National', 'TBD-scale-A');

-- ~300 miles away (should NOT qualify)
insert into umpires (id, canonical_name, home_lat, home_lng) values
  ('22220000-0000-0000-0000-000000000002', 'Far Away Umpire', 44.0000, -75.0000);

\echo '=== Switch to app_user / authenticated, as Assignor One (reuses seed from the base test suite) ==='
set role app_user;
set myapp.mock_role = 'authenticated';
set myapp.mock_uid = '11111111-1111-1111-1111-111111111111';

\echo '--- Test A: creating a mileage-free-conference game auto-suggests the nearby umpire, not the far one ---'
insert into games (id, game_date, conference, home_school_id, home_school_text, visitor_school_text)
values ('33330000-0000-0000-0000-000000000001', '2026-10-17', 'Patriot',
  '11110000-0000-0000-0000-000000000001', 'Test Host College', 'Some Visitor');

do $$
declare v_near_count int; v_far_count int; v_distance double precision;
begin
  select count(*) into v_near_count from potentials
    where game_id = '33330000-0000-0000-0000-000000000001'
      and umpire_id = '22220000-0000-0000-0000-000000000001'
      and system_suggested;
  select count(*) into v_far_count from potentials
    where game_id = '33330000-0000-0000-0000-000000000001'
      and umpire_id = '22220000-0000-0000-0000-000000000002';
  select suggested_distance_miles into v_distance from potentials
    where game_id = '33330000-0000-0000-0000-000000000001'
      and umpire_id = '22220000-0000-0000-0000-000000000001';

  if v_near_count <> 1 then
    raise exception 'FAIL: expected the nearby umpire auto-suggested once, got %', v_near_count;
  end if;
  if v_far_count <> 0 then
    raise exception 'FAIL: the far-away umpire should NOT have been suggested, got % rows', v_far_count;
  end if;
  if v_distance is null or v_distance > 100 then
    raise exception 'FAIL: suggested_distance_miles should be populated and <= 100, got %', v_distance;
  end if;
  raise notice 'PASS: nearby umpire auto-suggested (% mi), far umpire correctly excluded', round(v_distance::numeric, 1);
end $$;

\echo '--- Test B: a non-mileage-free conference game gets NO auto-suggestions ---'
insert into games (id, game_date, conference, home_school_id, home_school_text, visitor_school_text)
values ('33330000-0000-0000-0000-000000000002', '2026-10-18', 'ACC',
  '11110000-0000-0000-0000-000000000001', 'Test Host College', 'Some Other Visitor');

do $$
declare v_count int;
begin
  select count(*) into v_count from potentials where game_id = '33330000-0000-0000-0000-000000000002';
  if v_count <> 0 then
    raise exception 'FAIL: ACC game should have zero auto-suggestions, got %', v_count;
  end if;
  raise notice 'PASS: non-mileage-free conference produced no auto-suggestions';
end $$;

\echo '--- Test C: re-running suggest_nearby_umpires manually is idempotent (no duplicate rows) ---'
do $$
declare v_count int;
begin
  perform suggest_nearby_umpires('33330000-0000-0000-0000-000000000001');
  select count(*) into v_count from potentials
    where game_id = '33330000-0000-0000-0000-000000000001'
      and umpire_id = '22220000-0000-0000-0000-000000000001';
  if v_count <> 1 then
    raise exception 'FAIL: expected exactly 1 row after re-running suggest_nearby_umpires, got %', v_count;
  end if;
  raise notice 'PASS: manual re-run is idempotent (on conflict do nothing)';
end $$;

\echo '--- Test D: ratings are readable through the same select used by the UI ---'
do $$
declare v_rating text;
begin
  select usafh_rating into v_rating from umpires where id = '22220000-0000-0000-0000-000000000001';
  if v_rating is distinct from 'National' then
    raise exception 'FAIL: expected usafh_rating ''National'', got %', v_rating;
  end if;
  raise notice 'PASS: umpire ratings readable (usafh_rating=%)', v_rating;
end $$;

\echo '--- Test E: anyone authenticated can delete a system-suggested Potentials row (not just its "adder" — there is none) ---'
set myapp.mock_uid = '22222222-2222-2222-2222-222222222222'; -- Assignor Two, did not create this row
do $$
declare v_count int;
begin
  delete from potentials
    where game_id = '33330000-0000-0000-0000-000000000001'
      and umpire_id = '22220000-0000-0000-0000-000000000001';
  select count(*) into v_count from potentials
    where game_id = '33330000-0000-0000-0000-000000000001'
      and umpire_id = '22220000-0000-0000-0000-000000000001';
  if v_count <> 0 then
    raise exception 'FAIL: system-suggested potential should be deletable by any authenticated user';
  end if;
  raise notice 'PASS: system-suggested potential removed by a different user (not the original "adder")';
end $$;

reset role;
\echo '=== All ratings/proximity scenario tests completed ==='
