#!/usr/bin/env node
// Imports the existing season CSV (same format as the Google Sheet export)
// into Supabase: one row -> one `games` row, Wish 1/2 -> `potentials`,
// Confirmed 1/2 -> `confirmations` (inserted directly, NOT through
// confirm_umpire() — this is a bulk historical import of data that's
// already real-world-confirmed, not a new live confirm action, so it
// intentionally bypasses the same-date/potentials enforcement).
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/import-schedule.mjs path/to/schedule.csv "Gus's Email"
//
// The service role key bypasses RLS — never expose it in the browser app,
// only use it here, from a trusted machine/script.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const [, , csvPath, importedByEmail] = process.argv;
if (!csvPath) {
  console.error("Usage: node scripts/import-schedule.mjs path/to/schedule.csv [imported-by-email]");
  process.exit(1);
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables first.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

// ---- Minimal CSV parser (same one used in the browser conflict-checker) ----
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

function splitNames(cell) {
  if (!cell) return [];
  return cell.split(",").map((s) => s.trim()).filter(Boolean);
}

function toISODate(raw) {
  const s = (raw || "").trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
  return null;
}

const umpireIdCache = new Map();
async function resolveOrCreateUmpire(name) {
  const key = name.trim().toLowerCase();
  if (umpireIdCache.has(key)) return umpireIdCache.get(key);
  const { data: existing } = await supabase
    .from("umpires")
    .select("id")
    .ilike("canonical_name", name.trim())
    .limit(1)
    .maybeSingle();
  if (existing) {
    umpireIdCache.set(key, existing.id);
    return existing.id;
  }
  const { data: created, error } = await supabase
    .from("umpires")
    .insert({ canonical_name: name.trim() })
    .select("id")
    .single();
  if (error) throw error;
  umpireIdCache.set(key, created.id);
  return created.id;
}

async function main() {
  const text = readFileSync(csvPath, "utf-8");
  const rows = parseCSV(text).filter((r) => r.length > 1 || (r[0] || "").trim() !== "");
  const headers = rows[0].map((h) => h.trim());
  const dataRows = rows.slice(1).map((r) => {
    const obj = {};
    headers.forEach((h, i) => (obj[h] = r[i] !== undefined ? r[i] : ""));
    return obj;
  });

  let importedBy = null;
  if (importedByEmail) {
    const { data } = await supabase.from("people").select("id").eq("email", importedByEmail).maybeSingle();
    importedBy = data?.id || null;
  }

  console.log(`Importing ${dataRows.length} rows from ${csvPath}…`);
  let gamesCreated = 0, potentialsCreated = 0, confirmationsCreated = 0, skipped = 0;

  for (const row of dataRows) {
    const isoDate = toISODate(row["Date"]);
    if (!isoDate) { skipped++; continue; }

    const { data: game, error: gameErr } = await supabase
      .from("games")
      .insert({
        game_date: isoDate,
        game_time: row["Time"] || null,
        day_of_week: row["Day of Week"] || null,
        game_type: row["Game Type"] || null,
        conference: row["Conference"] || null,
        home_school_text: row["Home"] || "",
        visitor_school_text: row["Visitor"] || "",
        location_text: row["Location"] || null,
        created_by: importedBy,
      })
      .select("id")
      .single();
    if (gameErr) { console.error("Game insert failed:", gameErr.message); continue; }
    gamesCreated++;

    // Wish 1/2 -> potentials
    for (const col of ["Wish 1", "Wish 2"]) {
      for (const rawName of splitNames(row[col])) {
        const umpireId = await resolveOrCreateUmpire(rawName);
        const { error } = await supabase
          .from("potentials")
          .insert({ game_id: game.id, umpire_id: umpireId, added_by: importedBy, note: "imported from " + col })
          .select();
        if (!error) potentialsCreated++;
      }
    }

    // Confirmed 1/2 -> confirmations (direct insert, bypasses confirm_umpire()
    // on purpose — see file header comment)
    let slot = 1;
    for (const col of ["Confirmed 1", "Confirmed 2"]) {
      const names = splitNames(row[col]);
      if (names.length) {
        const umpireId = await resolveOrCreateUmpire(names[0]);
        const { error } = await supabase.from("confirmations").insert({
          game_id: game.id,
          slot,
          umpire_id: umpireId,
          confirmed_by: importedBy,
          is_emergency_override: false,
        });
        if (!error) confirmationsCreated++;
        else console.error("Confirmation insert failed:", error.message);
      }
      slot++;
    }
  }

  console.log(
    `Done. Games: ${gamesCreated}, Potentials: ${potentialsCreated}, Confirmations: ${confirmationsCreated}, Skipped (no valid date): ${skipped}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
