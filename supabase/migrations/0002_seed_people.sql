-- Seed the 5 known D1 assignors. Run this AFTER 0001_init.sql.
-- IMPORTANT: replace the placeholder emails below with everyone's real
-- email address before running — that's what links their magic-link
-- sign-in to their person record (see the link_person_on_signup trigger).
-- Add D2/D3 assignors and evaluators the same way once you have that list.

insert into people (full_name, email) values
  ('Gus', 'gus@soteriades.com'),
  ('Lance Sarabia', 'REPLACE_WITH_LANCE_EMAIL'),
  ('Ken Dias', 'REPLACE_WITH_KEN_EMAIL'),
  ('Maggie Tieman', 'REPLACE_WITH_MAGGIE_EMAIL'),
  ('Chip Rodgers', 'REPLACE_WITH_CHIP_EMAIL');

insert into person_roles (person_id, role)
select id, 'd1_assignor' from people
where email in (
  'gus@soteriades.com',
  'REPLACE_WITH_LANCE_EMAIL',
  'REPLACE_WITH_KEN_EMAIL',
  'REPLACE_WITH_MAGGIE_EMAIL',
  'REPLACE_WITH_CHIP_EMAIL'
);

-- Also make Gus an admin, since he does final confirmation across the board.
insert into person_roles (person_id, role)
select id, 'admin' from people where email = 'gus@soteriades.com';

insert into assignor_conferences (person_id, conference)
select id, conf from people, unnest(array[
  'ACC','Big East','Ivy','Patriot','A10','MAC','Independents'
]) as conf
where email = 'gus@soteriades.com';

insert into assignor_conferences (person_id, conference)
select id, 'B1G' from people where email = 'REPLACE_WITH_LANCE_EMAIL';

insert into assignor_conferences (person_id, conference)
select id, conf from people, unnest(array['CAA','NEC','Delaware']) as conf
where email = 'REPLACE_WITH_KEN_EMAIL';

insert into assignor_conferences (person_id, conference)
select id, 'America East' from people where email = 'REPLACE_WITH_MAGGIE_EMAIL';

insert into assignor_conferences (person_id, conference)
select id, 'Queens' from people where email = 'REPLACE_WITH_CHIP_EMAIL';
