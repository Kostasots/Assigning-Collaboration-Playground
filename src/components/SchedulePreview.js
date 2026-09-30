"use client";

// Read-only view of what the schedule analysis found. Nothing here saves anything.

const FLAG_LABEL = {
  time_assumed_pm: "Times with no AM/PM, read as afternoon",
  date_fixed: "Dates with a typo, corrected",
  conference_fixed: "Conference names tidied",
  type_fixed: "Game types with a typo, corrected",
  location_note: "Extra text after the site, moved to Notes",
  location_names: "Umpire names typed in the Location cell, read as Wish 1",
  unknown_team: "Teams not in the school directory (saved as plain text)",
  no_assignor: "Games with no assignor listed",
  tentative_confirmed: "Confirmed names with a ? (saved as Potentials)",
};

const STATUS_LABEL = {
  variant: "Probably a misspelling of",
  ambiguous: "Could be",
  mismatch: "Surname is on the roster, but the first name doesn't match",
  none: "Not on the roster",
};

const gameLabel = (r) =>
  `Row ${r.rowNumber} · ${r.date || r.dateRaw || "no date"} · ${r.time?.display || "TBD"} · ${r.home?.raw || "?"} vs ${r.visitor?.raw || "?"}${r.who ? ` (${r.who})` : ""}`;

const swatch = (fill) => (fill?.startsWith("rgb:") ? `#${fill.slice(8)}` : "#e5e5e5");

function Card({ label, value, tone }) {
  const tones = { good: "text-emerald-700", warn: "text-amber-700", bad: "text-red-700", plain: "text-neutral-900" };
  return (
    <div className="border border-neutral-200 rounded-lg px-4 py-3">
      <div className={`text-2xl font-semibold ${tones[tone || "plain"]}`}>{value}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

function Section({ title, count, open, children }) {
  return (
    <details open={open} className="border border-neutral-200 rounded-lg">
      <summary className="cursor-pointer px-4 py-2.5 text-sm font-medium flex items-center gap-2">
        {title}
        {count != null && <span className="text-xs font-normal text-neutral-500">({count})</span>}
      </summary>
      <div className="px-4 pb-3 text-sm">{children}</div>
    </details>
  );
}

export default function SchedulePreview({ result, sheetName }) {
  if (!result.ok) return <p className="text-sm text-red-600">{result.error}</p>;
  const { summary: s, records, duplicates, conflicts, groups, unknownTeams, names, nameStats, columns } = result;

  const attention = records.filter((r) => r.flags.some((f) => f.level === "error" || f.level === "warn"));
  const infoByCode = {};
  records.forEach((r) => r.flags.filter((f) => f.level === "info").forEach((f) => (infoByCode[f.code] = infoByCode[f.code] || []).push({ r, f })));
  const autoPct = nameStats.total ? Math.round(((nameStats.exact + nameStats.resolved) * 100) / nameStats.total) : 0;

  return (
    <div className="space-y-4">
      <p className="text-sm text-neutral-600">
        Read sheet <strong>{sheetName}</strong>: {s.rowsRead} rows, {s.games} games
        {s.skippedBlank ? `, ${s.skippedBlank} blank rows skipped` : ""}
        {s.skippedHeader ? `, ${s.skippedHeader} repeated heading row skipped` : ""}.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card label="games found" value={s.games} />
        <Card label="ready as they are" value={s.ready} tone="good" />
        <Card label="worth a look" value={s.needsLook} tone={s.needsLook ? "warn" : "good"} />
        <Card label="can't be imported" value={s.errors} tone={s.errors ? "bad" : "good"} />
      </div>

      <Section title="Columns I recognized" open={columns.unmapped.length > 0}>
        <p className="text-neutral-600">{columns.found.map((c) => c.field).join(", ")}.</p>
        {columns.unmapped.length > 0 && (
          <p className="text-amber-700 mt-1">
            Not recognized (any text in these is saved as a note): {columns.unmapped.map((u) => u.header).join(", ")}
          </p>
        )}
      </Section>

      <Section title="Games worth a look" count={attention.length} open>
        {attention.length === 0 && <p className="text-neutral-500">Nothing to check.</p>}
        <ul className="divide-y divide-neutral-100">
          {attention.map((r) => (
            <li key={r.rowNumber} className="py-2">
              <div className="font-medium">{gameLabel(r)}</div>
              {r.flags
                .filter((f) => f.level !== "info")
                .map((f, i) => (
                  <div key={i} className={f.level === "error" ? "text-red-700 text-xs" : "text-amber-800 text-xs"}>
                    {f.message}
                  </div>
                ))}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Same game entered more than once" count={duplicates.length}>
        {duplicates.length === 0 && <p className="text-neutral-500">None found.</p>}
        <ul className="divide-y divide-neutral-100">
          {duplicates.map((d, i) => (
            <li key={i} className="py-2">
              <div className="font-medium">
                {d.date} · {d.teams}
              </div>
              <div className="text-xs text-neutral-600">
                Rows {d.rows.join(" and ")} ({d.assignors.join(" and ")})
                {d.crossAssignor ? " — two different assignors" : ""}
                {d.differs.length ? ` — ${d.differs.join(" and ")} differ` : ""}
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Umpires confirmed in two places the same day" count={conflicts.length}>
        <p className="text-xs text-neutral-500 mb-2">
          Same rule the app uses when you confirm someone: different sites, or the same site less than 2 hours apart.
        </p>
        {conflicts.length === 0 && <p className="text-neutral-500">None found.</p>}
        <ul className="divide-y divide-neutral-100">
          {conflicts.map((c, i) => (
            <li key={i} className="py-1.5">
              <span className="font-medium">{c.umpire}</span> · {c.date} · rows {c.rows.join(" and ")}
              <span className="text-xs text-neutral-500"> — {c.reason}</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Keep-the-same-crew groups (from cell colors)" count={groups.length}>
        {groups.length === 0 && <p className="text-neutral-500">No colored groups found (colors are only read from .xlsx files).</p>}
        <ul className="divide-y divide-neutral-100">
          {groups.map((g, i) => (
            <li key={i} className="py-1.5 flex items-start gap-2">
              <span className="mt-1 h-3 w-3 rounded-sm border border-neutral-300 shrink-0" style={{ background: swatch(g.color) }} />
              <div>
                <span className="font-medium">{g.site}</span> · {g.dates.map((d) => d.slice(5)).join(", ")} · {g.games} game{g.games === 1 ? "" : "s"}
                {g.assignor ? ` (${g.assignor})` : ""}
                <div className="text-xs">
                  {g.crewDiffers ? (
                    <span className="text-amber-700">No umpire shared between these games yet</span>
                  ) : g.sharedUmpires.length ? (
                    <span className="text-emerald-700">Same crew member{g.sharedUmpires.length > 1 ? "s" : ""}: {g.sharedUmpires.join(", ")}</span>
                  ) : (
                    <span className="text-neutral-500">{g.games > 1 ? "Crew not assigned yet" : "Only one game"}</span>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Teams not in the school directory" count={unknownTeams.length}>
        {unknownTeams.length === 0 && <p className="text-neutral-500">All teams matched.</p>}
        <ul>
          {unknownTeams.map((t) => (
            <li key={t.name}>
              {t.name} <span className="text-xs text-neutral-500">({t.games} game{t.games === 1 ? "" : "s"})</span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Umpire names that need a decision" count={names.length}>
        <p className="text-xs text-neutral-500 mb-2">
          {autoPct}% of the {nameStats.total} names on the sheet matched the roster automatically. These didn&apos;t.
        </p>
        <ul className="divide-y divide-neutral-100">
          {names.map((n) => (
            <li key={n.raw} className="py-1.5">
              <span className="font-medium">{n.raw}</span>{" "}
              <span className="text-xs text-neutral-500">
                ({n.mentions}×) — {STATUS_LABEL[n.res.status]}
                {n.res.candidates?.length ? `: ${n.res.candidates.slice(0, 6).map((c) => c.name).join(", ")}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Things I tidied or assumed" count={Object.values(infoByCode).reduce((n, a) => n + a.length, 0)}>
        <ul className="space-y-2">
          {Object.entries(infoByCode).map(([code, items]) => (
            <li key={code}>
              <div className="font-medium">
                {FLAG_LABEL[code] || code} <span className="text-xs font-normal text-neutral-500">({items.length})</span>
              </div>
              <div className="text-xs text-neutral-500">
                {items.slice(0, 3).map(({ r, f }) => `Row ${r.rowNumber}: ${f.message}`).join(" · ")}
                {items.length > 3 ? " …" : ""}
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}
