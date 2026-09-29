# FH Umpire Assignment Tool

A small multi-user web app that replaces the Google Sheet for D1 field hockey
umpire assignment. It exists to solve one specific, urgent problem: the same
umpire getting double-booked across the five independent D1 assignors,
discovered only after the fact once games are already released in RQ+.

Core idea — **Potentials, then Confirm:**

- **Potentials** is a sandbox. Any assignor or evaluator can add a candidate
  umpire's name to a game's Potentials list, with no restriction — this is
  intentional, so people can suggest names for consideration.
- **Confirming** an umpire to a game is gated: you can only confirm someone
  who is in that game's Potentials list, AND the system blocks confirming
  someone who is already confirmed on another game the same date.
- **Emergency override** is the escape hatch for genuine fill-in situations
  (umpire not in Potentials, or a same-date conflict that's intentional). It
  requires a typed reason, is logged to the audit trail, and does not need
  anyone else's approval — it's self-declared, matching how this already
  works in practice today.

All of this enforcement lives in one place — a Postgres function
(`confirm_umpire`) that the app calls — not scattered across the UI, so it
can't be bypassed by a bug in a form somewhere.

## What's in this app

- `/` — dashboard of games, with conflict badges pulled from a view that
  surfaces any live same-date conflict (should normally be empty; only
  non-empty if an override created one on purpose).
- `/games/[id]` — the main working screen: see Confirmed slots, see and add
  to Potentials, confirm an umpire into a slot, or do an emergency fill-in.
- `/audit` — full history of every Potentials add, confirm, and override,
  most recent first.
- `/login` — email magic-link sign-in (no passwords).

## One-time setup

You'll need a free [Supabase](https://supabase.com) account and a free
[Vercel](https://vercel.com) account. Supabase hosts the database and
handles sign-in; Vercel hosts the web app itself.

### 1. Create the Supabase project

1. At [supabase.com](https://supabase.com), create a new project. Pick any
   name/region; save the database password it generates somewhere safe (you
   likely won't need it again for normal use).
2. Once it's ready, go to the **SQL Editor** in the left sidebar.
3. Open `supabase/migrations/0001_init.sql` from this folder, copy its
   entire contents, paste into a new SQL Editor query, and run it. This
   creates every table, the enforcement function, and all the security
   rules. It should complete with no errors.
4. Open `supabase/migrations/0002_seed_people.sql`. Before running it,
   replace the four `REPLACE_WITH_..._EMAIL` placeholders with Lance's,
   Ken's, Maggie's, and Chip's real email addresses (the address they'll
   sign in with). Then run it in the SQL Editor. This creates the 5 D1
   assignor accounts and marks you (Gus) as admin.
   - To add anyone else later (D2/D3 assignors, evaluators), use the Table
     Editor: add a row to `people` with their name/email, then a matching
     row in `person_roles` with the appropriate role
     (`d1_assignor` / `d2d3_assignor` / `evaluator` / `admin`).
4b. Open `supabase/migrations/0003_ratings_and_proximity.sql` and run it too.
   This adds umpire ratings (USA FH + an internal one) and the Patriot
   League 100-mile auto-suggest feature. It's safe to run right away —
   the proximity part quietly does nothing until school and umpire
   coordinates exist (see "Ratings and proximity data" below), it won't
   error or break anything in the meantime.
5. Go to **Authentication > Providers** and confirm Email is enabled (it is
   by default). Go to **Authentication > URL Configuration** and, once you
   know your Vercel URL (step 3 below), add `https://YOUR-APP.vercel.app/auth/callback`
   as a Redirect URL.
6. Go to **Project Settings > API**. You'll need two values from here in the
   next step: the **Project URL** and the **anon public** key.

### 2. Get the code onto GitHub (or your host of choice)

Push this folder to a new GitHub repository (or GitLab/Bitbucket). Vercel
deploys straight from a git repo.

### 3. Deploy to Vercel

1. At [vercel.com](https://vercel.com), "Add New Project," import the repo
   you just pushed.
2. In the project's Environment Variables settings, add:
   - `NEXT_PUBLIC_SUPABASE_URL` — the Project URL from step 1.6
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` — the anon public key from step 1.6
3. Deploy. Once it's live, note the `https://YOUR-APP.vercel.app` URL and go
   back and finish step 1.5 above (adding the redirect URL) if you haven't
   already.

### 4. Sign in

Go to your live URL, enter your email on `/login`, and click the magic link
that arrives. Anyone whose email you seeded into `people` can sign in the
same way. If someone signs in whose email isn't in `people` yet, they'll see
a clear message telling them to ask an admin to add them.

## Importing this season's schedule

`scripts/import-schedule.mjs` bulk-loads a historical CSV (same format as
the sheet already in use — Date/Time/Day/Type/Conference/Home/Visitor/Wish
1/Wish 2/Confirmed 1/Confirmed 2) directly into the database, so you can
test against real data without re-entering everything by hand.

1. In Supabase, go to **Project Settings > API** and copy the
   **service_role** secret key (different from the anon key — this one
   bypasses security rules, so never put it in the app itself or commit it
   anywhere).
2. In this folder, run:
   ```
   SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co \
   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key \
   node scripts/import-schedule.mjs path/to/schedule.csv
   ```
   (see `.env.local.example` for where these values live)
3. Historical Wish 1/2 columns import as Potentials; Confirmed 1/2 import as
   already-active confirmations (this bypasses the live conflict check on
   purpose, since it's importing outcomes that already happened in reality,
   not making a new live assignment decision).

## Ratings and the Patriot League 100-mile auto-suggest

Two related features, both added by `0003_ratings_and_proximity.sql`:

- **USA FH rating + an internal rating** (scale still TBD) show up right next
  to each umpire's name in Potentials and Confirmed on the game page, so
  whoever's deciding can see their level at that moment.
- For any conference flagged as not reimbursing mileage — seeded today with
  Patriot League — creating or editing a game automatically adds every
  umpire within 100 miles of the host school into that game's Potentials,
  clearly labeled "Suggested" with the distance, and removable by anyone
  the same as any other Potentials entry. This still goes through the same
  Confirm gate as everything else — being auto-suggested doesn't skip any
  of the protections above.
- If another conference later adopts a no-mileage policy, flip it on with:
  `update conferences set mileage_reimbursed = true where name = 'Conference Name';`
  (check the exact spelling with `select distinct conference from games;` —
  it needs to match `games.conference` exactly, case-insensitively).

**This needs two pieces of data that aren't populated yet:** the host
school's coordinates, and each umpire's home coordinates. Until both exist
for a given game, the auto-suggest quietly does nothing — no errors, just no
suggestions yet.

To get the umpire side of that data in:

1. Pull a roster export from RQ with each umpire's name, city/state, and
   whatever rating info you have (USA FH rating, and your own if you've
   started tracking one).
2. Run:
   ```
   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
     node scripts/import-umpire-roster.mjs path/to/roster.csv
   ```
   This fills in name/city/state/ratings by matching against the existing
   roster (same alias-aware matching as everywhere else in this app).
3. Coordinates (lat/lng) aren't geocoded by that script yet — city/state
   alone isn't enough for the 100-mile math. Once you've pulled a real
   export and I can see what columns it actually has (a zip code would make
   this simple — no external API needed), I'll build the last step that
   turns city/state or zip into coordinates for both umpires and schools.

## Running locally

```
cp .env.local.example .env.local
# fill in NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY
npm install
npm run dev
```

Then open http://localhost:3000. For local sign-in to work, add
`http://localhost:3000/auth/callback` as a redirect URL in Supabase too
(Authentication > URL Configuration).

## Safety testing

The core enforcement logic (`confirm_umpire` + row-level security) was
verified against a from-scratch local Postgres test harness covering 9
scenarios: reading games, blocking a confirm when not in Potentials,
allowing it once added, blocking a same-date double-confirm, allowing it
with a required override reason (and logging it), rejecting an override with
no reason, confirming that assigning a second umpire to a filled slot
properly supersedes the first, confirming that direct database writes to
confirmations are rejected (only the app's confirm button can write there),
and confirming signed-out users see nothing. All 9 pass. See
`scripts/local-test-scenarios.sql` if you want to see exactly what was
tested.

The ratings/proximity feature has its own 5-scenario suite in
`scripts/local-test-scenarios-ratings-proximity.sql`, covering: a
mileage-free-conference game correctly auto-suggesting a nearby umpire and
excluding a far one (with the right distance), a non-mileage-free conference
producing zero suggestions, re-running the suggestion logic being safe to
repeat without creating duplicates, ratings being readable through the same
query the UI uses, and a system-suggested Potentials entry being removable
by anyone, not just whoever technically "added" it (nobody did). All 5 pass.

## What's deliberately not built yet

- D2/D3 travel-sharing/proximity suggestions (Phase 6) — the underlying
  proximity logic now exists (it's the same machinery the Patriot League
  100-mile feature uses), but the D2/D3-pays-for-D1-umpire-travel workflow
  itself isn't built, and school coordinates still need to be geocoded.
- Geocoding umpire and school locations (city/state or zip -> lat/lng) —
  needs a real data export to build against; see "Ratings and the Patriot
  League 100-mile auto-suggest" above.
- Private per-assignor umpire rankings / idle-top-umpire shortlist (Phase 5).
- RPI import/display.

These were intentionally deferred until the core Potentials/Confirm flow is
live and trusted.
