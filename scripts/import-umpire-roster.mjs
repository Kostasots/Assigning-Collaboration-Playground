#!/usr/bin/env node
// Bulk-updates the umpire roster with home location and ratings, matched
// against the existing `umpires` table by canonical name or alias
// (case-insensitive exact match — same philosophy as everywhere else in
// this app: accuracy grows as the alias list grows, rather than guessing).
// Creates a new umpire row if no match is found.
//
// Expected CSV columns (case-insensitive, extra columns are ignored):
//   Name, City, State, USA FH Rating, Internal Rating
// Optional, if you already have coordinates for someone:
//   Lat, Lng
//
// Only non-empty cells overwrite existing data — an export missing a
// column for some people won't blank out data already entered for them.
//
// Geocoding (City/State -> Lat/Lng) is NOT done by this script yet. Run it
// to load names/city/state/ratings first; a follow-up pass will fill in
// Lat/Lng once we've seen the real RQ export and picked a geocoding
// approach that matches what that export actually contains (a zip code
// column, for instance, would make this a simple static lookup with no
// external API calls needed).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/import-umpire-roster.mjs path/to/roster.csv

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const [, , csvPath] = process.argv;
if (!csvPath) {
  console.error("Usage: node scripts/import-umpire-roster.mjs path/to/roster.csv");
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables first.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\r") { /* skip */ }
      else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Case-insensitive header lookup, since export tools vary in capitalization.
function findHeader(headers, ...candidates) {
  const lower = headers.map((h) => h.trim().toLowerCase());
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx !== -1) return idx;
  }
  return -1;
}

async function findExistingUmpire(name) {
  const { data } = await supabase
    .from("umpires")
    .select("id, canonical_name")
    .or(`canonical_name.ilike.${name},aliases.cs.{${name}}`)
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function main() {
  const text = readFileSync(csvPath, "utf-8");
  const rows = parseCSV(text).filter((r) => r.length > 1 || (r[0] || "").trim() !== "");
  const headers = rows[0].map((h) => h.trim());

  const nameIdx = findHeader(headers, "Name", "Umpire", "Umpire Name");
  const cityIdx = findHeader(headers, "City", "Home City");
  const stateIdx = findHeader(headers, "State", "Home State");
  const latIdx = findHeader(headers, "Lat", "Latitude");
  const lngIdx = findHeader(headers, "Lng", "Lon", "Longitude");
  const usafhIdx = findHeader(headers, "USA FH Rating", "USAFH Rating", "USA Field Hockey Rating");
  const internalIdx = findHeader(headers, "Internal Rating", "Our Rating");

  if (nameIdx === -1) {
    console.error("Couldn't find a Name column. Headers found:", headers.join(", "));
    process.exit(1);
  }

  const dataRows = rows.slice(1);
  console.log(`Processing ${dataRows.length} rows from ${csvPath}…`);

  let updated = 0, created = 0, skipped = 0;

  for (const r of dataRows) {
    const name = (r[nameIdx] || "").trim();
    if (!name) { skipped++; continue; }

    const patch = {};
    if (cityIdx !== -1 && r[cityIdx]?.trim()) patch.home_city = r[cityIdx].trim();
    if (stateIdx !== -1 && r[stateIdx]?.trim()) patch.home_state = r[stateIdx].trim();
    if (latIdx !== -1 && r[latIdx]?.trim()) patch.home_lat = parseFloat(r[latIdx]);
    if (lngIdx !== -1 && r[lngIdx]?.trim()) patch.home_lng = parseFloat(r[lngIdx]);
    if (usafhIdx !== -1 && r[usafhIdx]?.trim()) patch.usafh_rating = r[usafhIdx].trim();
    if (internalIdx !== -1 && r[internalIdx]?.trim()) patch.internal_rating = r[internalIdx].trim();

    const existing = await findExistingUmpire(name);
    if (existing) {
      if (Object.keys(patch).length) {
        const { error } = await supabase.from("umpires").update(patch).eq("id", existing.id);
        if (error) { console.error(`Update failed for ${name}:`, error.message); continue; }
      }
      updated++;
    } else {
      const { error } = await supabase.from("umpires").insert({ canonical_name: name, ...patch });
      if (error) { console.error(`Insert failed for ${name}:`, error.message); continue; }
      created++;
    }
  }

  console.log(`Done. Updated: ${updated}, Created: ${created}, Skipped (no name): ${skipped}`);
  if (latIdx === -1 && lngIdx === -1) {
    console.log(
      "No Lat/Lng columns found — home_city/home_state were set but the 100-mile Patriot League " +
      "suggestion feature won't produce results until coordinates are added (a follow-up geocoding pass)."
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
