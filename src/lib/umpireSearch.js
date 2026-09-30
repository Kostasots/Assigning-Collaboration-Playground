// Roster search used by the umpire picker. Pure functions, no React, so the
// matching rules can be tested on their own.
//
// Rules: every word you type must start some word of the umpire's name (or of
// one of their aliases/nicknames). So "kim" finds every Kim, "maisano f" finds
// only the Maisano whose first name starts with F, and a nickname such as
// "shrek" finds the umpire it is saved as an alias for.

export const normalizeText = (s) =>
  (s || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

export function matchUmpires(umpires, query, { excludeIds = [], limit = 8 } = {}) {
  const tokens = normalizeText(query).split(" ").filter(Boolean);
  if (!tokens.length) return [];
  const q = tokens.join(" ");
  const exclude = new Set(excludeIds);
  const results = [];

  for (const u of umpires) {
    if (exclude.has(u.id)) continue;
    const candidates = [u.canonical_name, ...(u.aliases || [])];
    let best = null;
    candidates.forEach((cand, idx) => {
      const full = normalizeText(cand);
      const words = full.split(" ");
      if (!tokens.every((t) => words.some((w) => w.startsWith(t)))) return;
      const score = (full === q ? 0 : full.startsWith(q) ? 1 : 2) + (idx === 0 ? 0 : 0.5);
      if (!best || score < best.score) best = { score, viaAlias: idx > 0 ? cand : null };
    });
    if (best) results.push({ umpire: u, score: best.score, viaAlias: best.viaAlias });
  }

  results.sort(
    (a, b) => a.score - b.score || a.umpire.canonical_name.localeCompare(b.umpire.canonical_name)
  );
  return results.slice(0, limit);
}
