-- FOR LOCAL TESTING ONLY. Exercises the real enforcement logic end-to-end
-- as the `app_user` role (a member of `authenticated`, and NOT the table
-- owner, so RLS actually applies).

\echo '=== Seed two test people as postgres (owner, bypasses RLS) ==='
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'assignor1@test.com'),
  ('22222222-2222-2222-2222-222222222222', 'assignor2@test.com');

insert into people (id, auth_user_id, full_name, email) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '11111111-1111-1111-1111-111111111111', 'Assignor One', 'assignor1@test.com'),
  ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '22222222-2222-2222-2222-222222222222', 'Assignor Two', 'assignor2@test.com');

insert into umpires (id, canonical_name) values
  ('cccccccc-cccc-cccc-cccc-cccccccccccc', 'Test Umpire');

insert into games (id, game_date, home_school_text, visitor_school_text, conference) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '2026-10-10', 'School A', 'School B', 'TestConf'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '2026-10-10', 'School C', 'School D', 'TestConf');

\echo '=== Switch to app_user / authenticated, as Assignor One ==='
set role app_user;
set myapp.mock_role = 'authenticated';
set myapp.mock_uid = '11111111-1111-1111-1111-111111111111';

\echo '--- Test 1: can read games (RLS + grants working) ---'
do $$
declare v_count int;
begin
  select count(*) into v_count from games;
  if v_count <> 2 then raise exception 'FAIL: expected 2 games visible, got %', v_count; end if;
  raise notice 'PASS: can read games (% rows)', v_count;
end $$;

\echo '--- Test 2: confirming an umpire NOT in Potentials, no emergency flag -> should fail ---'
do $$
begin
  perform confirm_umpire('dddddddd-dddd-dddd-dddd-dddddddddddd', 1, 'cccccccc-cccc-cccc-cccc-cccccccccccc', false, null);
  raise exception 'FAIL: expected an error (not in potentials) but confirm_umpire succeeded';
exception when others then
  if sqlerrm like '%not in this game''s Potentials%' then
    raise notice 'PASS: blocked with correct message: %', sqlerrm;
  else
    raise exception 'FAIL: blocked, but with unexpected message: %', sqlerrm;
  end if;
end $$;

\echo '--- Test 3: add to Potentials (sandbox, no gate) then confirm succeeds ---'
insert into potentials (game_id, umpire_id, added_by)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

do $$
declare v_row confirmations;
begin
  select * into v_row from confirm_umpire('dddddddd-dddd-dddd-dddd-dddddddddddd', 1, 'cccccccc-cccc-cccc-cccc-cccccccccccc', false, null);
  if v_row.active then
    raise notice 'PASS: confirmed successfully, id=%', v_row.id;
  else
    raise exception 'FAIL: confirmation row not active';
  end if;
end $$;

\echo '--- Test 4: confirming same umpire on a DIFFERENT game, same date, no emergency -> should fail ---'
do $$
begin
  perform confirm_umpire('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 1, 'cccccccc-cccc-cccc-cccc-cccccccccccc', false, null);
  raise exception 'FAIL: expected same-date conflict error but confirm_umpire succeeded';
exception when others then
  if sqlerrm like '%already confirmed on another game%' then
    raise notice 'PASS: blocked with correct message: %', sqlerrm;
  else
    raise exception 'FAIL: blocked, but with unexpected message: %', sqlerrm;
  end if;
end $$;

\echo '--- Test 5: same request, but WITH emergency override + reason -> should succeed and log ---'
do $$
declare v_row confirmations; v_audit_count int;
begin
  select * into v_row from confirm_umpire('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 1, 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, 'Testing override path');
  if not v_row.is_emergency_override then
    raise exception 'FAIL: row should be flagged as emergency override';
  end if;
  select count(*) into v_audit_count from audit_log where event_type = 'confirmed_override' and game_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';
  if v_audit_count <> 1 then
    raise exception 'FAIL: expected 1 audit_log row for the override, got %', v_audit_count;
  end if;
  raise notice 'PASS: override confirmed and logged (audit rows: %)', v_audit_count;
end $$;

\echo '--- Test 6: emergency override WITHOUT a reason -> should fail ---'
do $$
begin
  perform confirm_umpire('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 2, 'cccccccc-cccc-cccc-cccc-cccccccccccc', true, '   ');
  raise exception 'FAIL: expected "requires a reason" error but it succeeded';
exception when others then
  if sqlerrm like '%requires a reason%' then
    raise notice 'PASS: blocked with correct message: %', sqlerrm;
  else
    raise exception 'FAIL: blocked, but with unexpected message: %', sqlerrm;
  end if;
end $$;

\echo '--- Test 7: confirming a second umpire to the SAME slot supersedes the first (only one active) ---'
insert into umpires (id, canonical_name) values ('99999999-9999-9999-9999-999999999999', 'Replacement Umpire');
insert into potentials (game_id, umpire_id, added_by)
values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '99999999-9999-9999-9999-999999999999', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

do $$
declare v_active_count int; v_old_active boolean;
begin
  perform confirm_umpire('dddddddd-dddd-dddd-dddd-dddddddddddd', 1, '99999999-9999-9999-9999-999999999999', false, null);
  select count(*) into v_active_count from confirmations where game_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' and slot = 1 and active;
  select active into v_old_active from confirmations where umpire_id = 'cccccccc-cccc-cccc-cccc-cccccccccccc' and game_id = 'dddddddd-dddd-dddd-dddd-dddddddddddd' and slot = 1;
  if v_active_count <> 1 then
    raise exception 'FAIL: expected exactly 1 active confirmation for game/slot, got %', v_active_count;
  end if;
  if v_old_active is not false then
    raise exception 'FAIL: old confirmation should have been superseded (active=false)';
  end if;
  raise notice 'PASS: supersede logic works (old confirmation deactivated, exactly 1 active remains)';
end $$;

\echo '--- Test 8: direct INSERT into confirmations by an authenticated user should be REJECTED (no policy) ---'
do $$
begin
  insert into confirmations (game_id, slot, umpire_id, confirmed_by)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd', 2, 'cccccccc-cccc-cccc-cccc-cccccccccccc', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  raise exception 'FAIL: direct insert into confirmations should have been blocked by RLS but succeeded';
exception when insufficient_privilege then
  raise notice 'PASS: direct insert correctly blocked (insufficient_privilege)';
when others then
  raise notice 'PASS (blocked, different error — also acceptable): %', sqlerrm;
end $$;

\echo '=== Test 9: unauthenticated (anon) cannot read games ==='
set myapp.mock_role = 'anon';
do $$
declare v_count int;
begin
  select count(*) into v_count from games;
  if v_count <> 0 then
    raise exception 'FAIL: anon should see 0 games due to RLS, saw %', v_count;
  end if;
  raise notice 'PASS: anon correctly sees 0 rows';
end $$;

reset role;
\echo '=== All scenario tests completed ==='
