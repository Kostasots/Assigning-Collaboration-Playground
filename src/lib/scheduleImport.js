// Turns rows read from a schedule sheet into a checked, cleaned preview. Pure functions:
// nothing here touches the database. `schools` and `umpires` are passed in.
//
//   analyzeSchedule(rows, { schools, umpires }) -> { records, summary, ... }
//
// Every game gets flags: "error" (can't be imported as is), "warn" (imported, but look at
// it) or "info" (something was tidied or interpreted).

import { normalizeText } from "@/lib/umpireSearch";

// ── Columns ───────────────────────────────────────────────────────────────
const HEADER_SYNONYMS = {
  who: ["who", "assignor", "assigned by", "assigning"],
  conference: ["conference", "conf"],
  gameType: ["game type", "type", "gametype"],
  date: ["date", "game date"],
  time: ["time", "start", "start time", "game time"],
  day: ["day of week", "day", "dow"],
  home: ["home", "home team"],
  visitor: ["visitor", "visiting team", "visitors", "away", "away team", "visitor team"],
  location: ["location", "site", "venue", "field"],
  wish1: ["wish 1", "wish1", "preferred 1", "preferred umpire 1", "request 1"],
  wish2: ["wish 2", "wish2", "preferred 2", "preferred umpire 2", "request 2"],
  confirmed1: ["confirmed 1", "confirmed1", "umpire 1", "ump 1", "official 1"],
  confirmed2: ["confirmed 2", "confirmed2", "umpire 2", "ump 2", "official 2"],
  notes: ["notes", "note", "comments", "comment"],
};
const FIELD_LABEL = {
  who: "Who", conference: "Conference", gameType: "Game Type", date: "Date", time: "Time", day: "Day of Week",
  home: "Home", visitor: "Visitor", location: "Location", wish1: "Wish 1", wish2: "Wish 2",
  confirmed1: "Confirmed 1", confirmed2: "Confirmed 2", notes: "Notes",
};

export function mapHeaders(headerCells) {
  const mapping = {};
  const unmapped = [];
  headerCells.forEach((h, i) => {
    const n = normalizeText(h);
    if (!n) return;
    const field = Object.keys(HEADER_SYNONYMS).find((f) => HEADER_SYNONYMS[f].includes(n) && !(f in mapping));
    if (field) mapping[field] = i;
    else unmapped.push({ index: i, header: String(h) });
  });
  return { mapping, unmapped };
}

// ── Small helpers ─────────────────────────────────────────────────────────
const text = (v) => (v == null ? "" : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).replace(/\s+/g, " ").trim();

function editDistance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

const GAME_TYPES = ["Regular Season", "Non-Conference", "Conference Game", "Exhibition", "Scrimmage", "Tournament"];
const CONFERENCE_FIXES = { ae: "America East" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parseDate(v) {
  if (v instanceof Date) return { iso: v.toISOString().slice(0, 10), fixed: false };
  const s = text(v);
  let m;
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/))) return build(+m[3], +m[1], +m[2], false);
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return build(+m[1], +m[2], +m[3], false);
  if ((m = s.match(/^(\d{1,2})\/(\d{1,2}),\s*(\d{4})$/))) return build(+m[3], +m[1], +m[2], true); // 10/16,2026
  return null;
  function build(y, mo, d, fixed) {
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return { iso: dt.toISOString().slice(0, 10), fixed };
  }
}
const weekday = (iso) => DAYS[new Date(iso + "T00:00:00Z").getUTCDay()];

// "5:00 PM" -> { display, minutes }. Bare hours 1-7 are read as afternoon.
export function parseTime(v) {
  const s = text(v).toUpperCase();
  if (!s || s === "TBD") return { display: "TBD", minutes: null, flags: [] };
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/);
  if (!m) return { display: text(v), minutes: null, flags: [{ level: "warn", code: "time_unreadable", message: `Time "${text(v)}" isn't a time I can read, so it will be saved as TBD.` }], unreadable: true };
  let h = +m[1];
  const mi = +(m[2] || 0);
  const flags = [];
  if (m[3] === "PM" && h < 12) h += 12;
  else if (m[3] === "AM" && h === 12) h = 0;
  else if (!m[3] && h >= 1 && h <= 7) {
    h += 12;
    flags.push({ level: "info", code: "time_assumed_pm", message: `Time "${text(v)}" has no AM/PM; read as ${h - 12}:${String(mi).padStart(2, "0")} PM.` });
  }
  if (h > 23 || mi > 59) return { display: text(v), minutes: null, flags: [{ level: "warn", code: "time_unreadable", message: `Time "${text(v)}" isn't valid.` }], unreadable: true };
  const disp = `${h % 12 === 0 ? 12 : h % 12}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
  if (h < 8 || h > 22) {
    const alt = h >= 1 && h <= 7 ? ` Did you mean ${h}:${String(mi).padStart(2, "0")} PM?` : "";
    flags.push({ level: "warn", code: "odd_time", message: `Start time ${disp} looks unusual for a game.${alt}` });
  }
  return { display: disp, minutes: h * 60 + mi, flags };
}

// ── Schools ───────────────────────────────────────────────────────────────
function buildSchoolIndex(schools) {
  const byName = new Map();
  for (const s of schools) {
    byName.set(normalizeText(s.name), s);
    for (const a of s.aliases || []) if (!byName.has(normalizeText(a))) byName.set(normalizeText(a), s);
  }
  return byName;
}

const PLACEHOLDERS = new Set(["tbd", "tba", ""]);

function resolveTeam(raw, idx) {
  const n = normalizeText(raw);
  if (!n) return { raw, school: null, placeholder: true };
  if (PLACEHOLDERS.has(n)) return { raw, school: null, placeholder: true };
  const s = idx.get(n);
  return s ? { raw, school: s } : { raw, school: null, unknown: true };
}

// Leading part of a Location cell that names a school/venue; the rest is extra text.
function splitLocation(raw, idx) {
  const words = raw.split(" ");
  for (let k = Math.min(words.length, 7); k >= 1; k--) {
    const s = idx.get(normalizeText(words.slice(0, k).join(" ")));
    if (s) return { school: s, extra: words.slice(k).join(" ").replace(/^[\s.,;:-]+/, "").trim() };
  }
  return { school: null, extra: "" };
}

// ── Umpire names ──────────────────────────────────────────────────────────
function buildRoster(umpires) {
  const people = umpires.map((u) => {
    const t = normalizeText(u.canonical_name).split(" ");
    return { id: u.id, name: u.canonical_name, first: t[0] || "", last: t.slice(1), lastFull: t.slice(1).join(" ") };
  });
  const byFull = new Map();
  umpires.forEach((u) => {
    for (const n of [u.canonical_name, ...(u.aliases || [])]) {
      const k = normalizeText(n);
      if (!byFull.has(k)) byFull.set(k, new Set());
      byFull.get(k).add(u.id);
    }
  });
  const byLastToken = new Map();
  const byFirst = new Map();
  for (const p of people) {
    for (const tk of new Set(p.last)) byLastToken.set(tk, [...(byLastToken.get(tk) || []), p]);
    byFirst.set(p.first, [...(byFirst.get(p.first) || []), p]);
  }
  return { people, byFull, byLastToken, byFirst, byId: new Map(people.map((p) => [p.id, p])) };
}

// Split one Wish/Confirmed cell into names. "?" marks a name as tentative.
export function parseNameCell(raw) {
  let s = text(raw);
  if (!s) return [];
  const notes = [];
  s = s.replace(/\([^)]*\)?/g, (m) => {
    notes.push(m);
    return " ";
  });
  s = s.replace(/\bfor (the )?weekend\b/gi, " ").replace(/\bweekend\b/gi, " ");
  return s
    .split(/[,/;]|\band\b/i)
    .map((p) => p.replace(/^\s*or\s+/i, "").trim())
    .filter(Boolean)
    .map((p) => {
      const tentative = /\?/.test(p);
      const name = p.replace(/\?/g, "").replace(/[.\s]+$/g, "").trim();
      return { name, tentative, wordCount: name.split(" ").length, hasDigit: /\d/.test(name) };
    })
    .filter((p) => p.name)
    .map((p) => (p.wordCount > 4 || p.hasDigit ? { ...p, isNote: true } : p));
}

export function resolveUmpire(name, roster) {
  const n = normalizeText(name);
  if (!n) return { status: "none", candidates: [] };
  const exact = roster.byFull.get(n);
  if (exact && exact.size === 1) {
    const id = [...exact][0];
    return { status: "exact", id, name: roster.byId.get(id).name };
  }
  if (exact && exact.size > 1) return { status: "ambiguous", candidates: [...exact].map((id) => roster.byId.get(id)) };

  const t = n.split(" ");
  const pick = (cands, pre, how) => {
    const shape = (list) => list.map((p) => ({ id: p.id, name: p.name }));
    if (pre.length) {
      const f = pre[0];
      const m = cands.filter((p) => p.first.startsWith(f));
      if (m.length === 1) return { status: how === "fuzzy" ? "variant" : "resolved", id: m[0].id, name: m[0].name, candidates: shape(m) };
      if (m.length > 1) return { status: "ambiguous", candidates: shape(m) };
      return { status: "mismatch", candidates: shape(cands) };
    }
    if (cands.length === 1) return { status: how === "fuzzy" ? "variant" : "resolved", id: cands[0].id, name: cands[0].name, candidates: shape(cands) };
    return { status: "ambiguous", candidates: shape(cands) };
  };

  // surname: last two words if they form a known multi-word surname, else the last word
  let surname = t[t.length - 1];
  let pre = t.slice(0, -1);
  if (t.length >= 2 && roster.people.some((p) => p.lastFull === t.slice(-2).join(" "))) {
    surname = t.slice(-2).join(" ");
    pre = t.slice(0, -2);
  }
  let cands = roster.people.filter((p) => p.lastFull === surname);
  if (!cands.length) cands = roster.byLastToken.get(surname.split(" ").pop()) || [];
  if (cands.length) return pick(cands, pre, "exact");

  // spelling variant of a surname
  const tok = surname.split(" ").pop();
  if (tok.length >= 4) {
    const limit = tok.length >= 7 ? 2 : 1;
    let best = null;
    let bestD = 99;
    let tie = false;
    for (const key of roster.byLastToken.keys()) {
      const d = editDistance(tok, key);
      if (d < bestD) {
        bestD = d;
        best = key;
        tie = false;
      } else if (d === bestD) tie = true;
    }
    if (best && bestD <= limit && !tie) return pick(roster.byLastToken.get(best), pre, "fuzzy");
  }
  // a first name on its own ("Ruth")
  if (t.length === 1 && roster.byFirst.has(t[0])) {
    const c = roster.byFirst.get(t[0]);
    return c.length === 1
      ? { status: "variant", id: c[0].id, name: c[0].name, candidates: [{ id: c[0].id, name: c[0].name }] }
      : { status: "ambiguous", candidates: c.map((p) => ({ id: p.id, name: p.name })) };
  }
  return { status: "none", candidates: [] };
}

const AUTO = new Set(["exact", "resolved"]);

// ── Main analysis ─────────────────────────────────────────────────────────
export function analyzeSchedule(rows, { schools = [], umpires = [] } = {}) {
  const idx = buildSchoolIndex(schools);
  const roster = buildRoster(umpires);

  // find the header row (first row where several known column names appear)
  let headerAt = -1;
  let map = null;
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const m = mapHeaders((rows[i] || []).map((c) => c?.v));
    if (Object.keys(m.mapping).length >= 4 && "date" in m.mapping && "home" in m.mapping) {
      headerAt = i;
      map = m;
      break;
    }
  }
  if (!map) {
    return { ok: false, error: "I couldn't find the column headings. The sheet needs at least Date and Home columns.", records: [] };
  }
  const M = map.mapping;
  const cell = (r, f) => (f in M ? r[M[f]] : undefined);
  const val = (r, f) => cell(r, f)?.v ?? null;

  const records = [];
  let skippedBlank = 0;
  let skippedHeader = 0;
  rows.slice(headerAt + 1).forEach((r, k) => {
    const rowNumber = headerAt + 2 + k;
    r = r || [];
    if (!r.some((c) => text(c?.v))) return void skippedBlank++;
    if (normalizeText(val(r, "home")) === "home" && normalizeText(val(r, "date")) === "date") return void skippedHeader++;
    const dateRaw = val(r, "date");
    if (!text(dateRaw) && !text(val(r, "home"))) return void skippedBlank++;

    const flags = [];
    const rec = { rowNumber, flags, notes: [], wishes: [], confirmed: [] };

    // date + weekday
    const d = parseDate(dateRaw);
    if (!d) flags.push({ level: "error", code: "bad_date", message: `Date "${text(dateRaw)}" can't be read.` });
    else {
      rec.date = d.iso;
      if (d.fixed) flags.push({ level: "info", code: "date_fixed", message: `Date "${text(dateRaw)}" was read as ${d.iso}.` });
      const y = +d.iso.slice(0, 4);
      if (y < 2020 || y > 2035) flags.push({ level: "warn", code: "odd_year", message: `Year ${y} looks wrong.` });
      const given = text(val(r, "day"));
      if (given && given.slice(0, 3).toLowerCase() !== weekday(d.iso).slice(0, 3).toLowerCase())
        flags.push({ level: "warn", code: "day_mismatch", message: `The date ${d.iso} is a ${weekday(d.iso)}, but the sheet says ${given}. Which is right?` });
      rec.day = weekday(d.iso);
    }
    rec.dateRaw = text(dateRaw);

    // time
    const t = parseTime(val(r, "time"));
    rec.time = t;
    flags.push(...t.flags);

    // who / conference / type
    rec.who = text(val(r, "who"));
    if (!rec.who) flags.push({ level: "info", code: "no_assignor", message: "No assignor listed for this game." });
    const conf = text(val(r, "conference"));
    rec.conference = CONFERENCE_FIXES[conf.toLowerCase()] || conf;
    if (CONFERENCE_FIXES[conf.toLowerCase()]) flags.push({ level: "info", code: "conference_fixed", message: `Conference "${conf}" read as ${rec.conference}.` });
    const gt = text(val(r, "gameType"));
    const gtHit = GAME_TYPES.find((g) => g.toLowerCase() === gt.toLowerCase()) || GAME_TYPES.find((g) => editDistance(g.toLowerCase(), gt.toLowerCase()) <= 2);
    rec.gameType = gt ? gtHit || gt : "";
    if (gt && gtHit && gtHit !== gt) flags.push({ level: "info", code: "type_fixed", message: `Game type "${gt}" read as ${gtHit}.` });

    // teams
    rec.home = resolveTeam(text(val(r, "home")), idx);
    rec.visitor = resolveTeam(text(val(r, "visitor")), idx);
    if (!rec.home.raw) flags.push({ level: "error", code: "no_home", message: "No home team." });
    for (const [side, t2] of [["Home", rec.home], ["Visitor", rec.visitor]])
      if (t2.unknown) flags.push({ level: "info", code: "unknown_team", message: `${side} "${t2.raw}" isn't in the school directory; it will be saved as plain text.`, team: t2.raw });

    // site: Location if given, otherwise the home school's field
    const locRaw = text(val(r, "location"));
    let extra = "";
    if (!locRaw) rec.site = { text: rec.home.school?.name || rec.home.raw, school: rec.home.school, source: "home" };
    else {
      const sp = splitLocation(locRaw, idx);
      if (sp.school) {
        rec.site = { text: sp.school.name, school: sp.school, source: "location" };
        extra = sp.extra;
      } else rec.site = { text: locRaw, school: null, source: "location" };
    }
    rec.siteKey = rec.site.school ? `school:${rec.site.school.id}` : `text:${normalizeText(rec.site.text)}`;

    // umpire cells (+ any extra text found in Location)
    const readCell = (field) => parseNameCell(val(r, field));
    const collect = (parts, kind, slot) =>
      parts.forEach((p) => {
        if (p.isNote) return void rec.notes.push(p.name);
        const res = resolveUmpire(p.name, roster);
        const item = { raw: p.name, tentative: p.tentative, res, slot };
        (kind === "wish" ? rec.wishes : rec.confirmed).push(item);
      });
    collect(readCell("wish1"), "wish", 1);
    collect(readCell("wish2"), "wish", 2);
    collect(readCell("confirmed1"), "confirmed", 1);
    collect(readCell("confirmed2"), "confirmed", 2);

    if (extra) {
      const parts = parseNameCell(extra);
      const looksLikeNames = parts.length && parts.every((p) => !p.isNote && p.wordCount <= 3 && resolveUmpire(p.name, roster).status !== "none");
      if (looksLikeNames) {
        collect(parts, "wish", 1);
        flags.push({ level: "info", code: "location_names", message: `Text after the site ("${extra}") looks like umpire names; read as Wish 1.` });
      } else {
        rec.notes.push(extra);
        flags.push({ level: "info", code: "location_note", message: `Text after the site ("${extra}") was moved to Notes.` });
      }
    }
    const noteText = text(val(r, "notes"));
    if (noteText) rec.notes.push(noteText);
    // unmapped columns after the standard ones (e.g. an unnamed notes column)
    map.unmapped.forEach((u) => {
      const t3 = text(r[u.index]?.v);
      if (t3) rec.notes.push(t3);
    });

    // tentative confirmed names are treated as possibilities, not confirmations
    if (rec.confirmed.some((c) => c.tentative)) flags.push({ level: "info", code: "tentative_confirmed", message: "A confirmed name has a ? after it; it will be saved as a Potential, not a confirmation." });

    // fill colours on the team columns (group marker)
    const whoFill = cell(r, "who")?.fill || null;
    const homeFill = cell(r, "home")?.fill || null;
    rec.groupFill = homeFill && homeFill !== whoFill ? homeFill : null;
    rec.rowFill = whoFill;

    records.push(rec);
  });

  // ── across rows ──
  // duplicates: same date and the same two teams (either order), placeholders excluded
  const teamKey = (t2) => (t2.school ? `s:${t2.school.id}` : t2.placeholder ? null : `t:${normalizeText(t2.raw)}`);
  const byGame = new Map();
  records.forEach((rec) => {
    const a = teamKey(rec.home);
    const b = teamKey(rec.visitor);
    if (!rec.date || !a || !b) return;
    const key = `${rec.date}|${[a, b].sort().join("|")}`;
    byGame.set(key, [...(byGame.get(key) || []), rec]);
  });
  const duplicates = [];
  for (const group of byGame.values()) {
    if (group.length < 2) continue;
    const rowsIn = group.map((g) => g.rowNumber);
    const cross = new Set(group.map((g) => g.who || "(none)")).size > 1;
    const same = (f) => new Set(group.map(f)).size === 1;
    const differs = [!same((g) => g.time.display) && "time", !same((g) => g.siteKey) && "site"].filter(Boolean);
    duplicates.push({ date: group[0].date, rows: rowsIn, assignors: group.map((g) => g.who || "(none)"), teams: `${group[0].home.raw} vs ${group[0].visitor.raw}`, crossAssignor: cross, differs });
    group.forEach((g) =>
      g.flags.push({
        level: "warn",
        code: "possible_duplicate",
        message: `Same game as row${rowsIn.length > 2 ? "s" : ""} ${rowsIn.filter((n) => n !== g.rowNumber).join(", ")}${cross ? " (entered by a different assignor)" : ""}${differs.length ? `; the ${differs.join(" and ")} differ${differs.length === 1 ? "s" : ""}` : ""}.`,
      })
    );
    group.forEach((g) => (g.dupGroup = rowsIn.join(",")));
  }

  // umpire conflicts: same person confirmed on two games the same date, unless same site + 2h apart
  const conflicts = [];
  const byUmpDay = new Map();
  records.forEach((rec) =>
    rec.confirmed.forEach((c) => {
      if (c.tentative || !AUTO.has(c.res.status) || !rec.date) return;
      const k = `${c.res.id}|${rec.date}`;
      byUmpDay.set(k, [...(byUmpDay.get(k) || []), rec]);
    })
  );
  for (const [k, recs] of byUmpDay) {
    const uniq = [...new Map(recs.map((x) => [x.rowNumber, x])).values()];
    for (let i = 0; i < uniq.length; i++)
      for (let j = i + 1; j < uniq.length; j++) {
        const a = uniq[i];
        const b = uniq[j];
        if (a.dupGroup && a.dupGroup === b.dupGroup) continue; // the same game listed twice
        const sameSite = a.siteKey === b.siteKey;
        const gap = a.time.minutes != null && b.time.minutes != null ? Math.abs(a.time.minutes - b.time.minutes) : null;
        if (sameSite && gap != null && gap >= 120) continue;
        const uid = k.split("|")[0];
        const conflict = {
          umpire: roster.byId.get(uid).name,
          date: a.date,
          rows: [a.rowNumber, b.rowNumber],
          reason: !sameSite ? "different sites" : gap == null ? "same site, start time not set" : "same site, starts less than 2 hours apart",
        };
        conflicts.push(conflict);
        for (const g of [a, b]) g.flags.push({ level: "warn", code: "umpire_conflict", message: `${conflict.umpire} is also confirmed on row ${g === a ? b.rowNumber : a.rowNumber} (${conflict.reason}).` });
      }
  }

  // "keep the same crew" groups from cell colours: same colour + same site within a few days
  const groups = [];
  const byColorSite = new Map();
  records.forEach((rec) => {
    if (!rec.groupFill || !rec.date) return;
    const k = `${rec.groupFill}|${rec.siteKey}`;
    byColorSite.set(k, [...(byColorSite.get(k) || []), rec]);
  });
  for (const [k, recs] of byColorSite) {
    recs.sort((a, b) => a.date.localeCompare(b.date));
    let cluster = [];
    const flush = () => {
      if (cluster.length) groups.push(makeGroup(k, cluster));
      cluster = [];
    };
    recs.forEach((rec, i) => {
      if (i > 0 && (Date.parse(rec.date) - Date.parse(recs[i - 1].date)) / 86400000 > 3) flush();
      cluster.push(rec);
    });
    flush();
  }
  function makeGroup(k, cluster) {
    const counts = new Map();
    cluster.forEach((rec) => new Set(rec.confirmed.filter((c) => AUTO.has(c.res.status) && !c.tentative).map((c) => c.res.id)).forEach((id) => counts.set(id, (counts.get(id) || 0) + 1)));
    const shared = [...counts].filter(([, n]) => n > 1).map(([id]) => roster.byId.get(id).name);
    const withCrew = cluster.filter((rec) => rec.confirmed.length).length;
    const g = {
      color: k.split("|")[0],
      site: cluster[0].site.text,
      assignor: cluster[0].who,
      dates: [...new Set(cluster.map((c) => c.date))],
      rows: cluster.map((c) => c.rowNumber),
      games: cluster.length,
      sharedUmpires: shared,
      crewDiffers: cluster.length > 1 && withCrew > 1 && shared.length === 0,
    };
    cluster.forEach((rec) => (rec.groupIndex = groups.length));
    return g;
  }

  // ── summaries ──
  const count = (lvl) => records.filter((r) => r.flags.some((f) => f.level === lvl)).length;
  const errors = count("error");
  const needsLook = records.filter((r) => !r.flags.some((f) => f.level === "error") && r.flags.some((f) => f.level === "warn")).length;
  const unknownTeams = new Map();
  records.forEach((rec) => rec.flags.filter((f) => f.code === "unknown_team").forEach((f) => unknownTeams.set(f.team, (unknownTeams.get(f.team) || 0) + 1)));
  const names = new Map();
  records.forEach((rec) =>
    [...rec.confirmed, ...rec.wishes].forEach((c) => {
      const k = normalizeText(c.raw);
      if (!names.has(k)) names.set(k, { raw: c.raw, res: c.res, mentions: 0 });
      names.get(k).mentions++;
    })
  );
  const nameList = [...names.values()];
  const nameStats = { total: nameList.reduce((n, x) => n + x.mentions, 0) };
  for (const st of ["exact", "resolved", "variant", "ambiguous", "mismatch", "none"])
    nameStats[st] = nameList.filter((x) => x.res.status === st).reduce((n, x) => n + x.mentions, 0);

  return {
    ok: true,
    columns: { found: Object.keys(M).map((f) => ({ field: FIELD_LABEL[f], header: text(rows[headerAt][M[f]]?.v) })), unmapped: map.unmapped },
    records,
    summary: {
      rowsRead: rows.length - headerAt - 1,
      games: records.length,
      ready: records.length - errors - needsLook,
      needsLook,
      errors,
      skippedBlank,
      skippedHeader,
    },
    duplicates,
    conflicts,
    groups,
    unknownTeams: [...unknownTeams].map(([name, n]) => ({ name, games: n })).sort((a, b) => b.games - a.games),
    names: nameList.filter((x) => !AUTO.has(x.res.status)).sort((a, b) => b.mentions - a.mentions),
    nameStats,
  };
}
