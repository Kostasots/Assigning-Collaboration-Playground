"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabaseClient";
import RequireAuth from "@/components/RequireAuth";

function DashboardContent() {
  const [games, setGames] = useState([]);
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    const supabase = getSupabaseClient();

    const [{ data: gamesData, error: gamesErr }, { data: conflictsData, error: conflictsErr }] =
      await Promise.all([
        supabase
          .from("games")
          .select(
            `id, game_date, game_time, conference, game_type,
             home_school_text, visitor_school_text,
             confirmations(slot, active, is_emergency_override, umpires(canonical_name))`
          )
          .order("game_date", { ascending: true })
          .limit(200),
        supabase.from("v_active_same_date_conflicts").select("*"),
      ]);

    if (gamesErr) setErrorMsg(gamesErr.message);
    setGames(gamesData || []);
    if (!conflictsErr) setConflicts(conflictsData || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount; load() guards its own state
    load();
  }, [load]);

  const conflictGameIds = new Set(conflicts.flatMap((c) => [c.game_id_a, c.game_id_b]));

  if (loading) return <p className="p-6 text-sm text-neutral-500">Loading games…</p>;
  if (errorMsg) return <p className="p-6 text-sm text-red-600">{errorMsg}</p>;

  return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-lg font-semibold mb-1">Games</h1>
      <p className="text-sm text-neutral-500 mb-6">
        {games.length} game{games.length === 1 ? "" : "s"} loaded.
        {conflicts.length > 0 && (
          <span className="text-red-600 font-medium">
            {" "}
            {conflicts.length} active same-date conflict{conflicts.length === 1 ? "" : "s"} right now.
          </span>
        )}
      </p>

      {games.length === 0 && (
        <p className="text-sm text-neutral-500">
          No games yet. Import your schedule via the Supabase Table Editor, or add games manually
          once that flow is built.
        </p>
      )}

      <ul className="divide-y divide-neutral-200 border border-neutral-200 rounded-lg overflow-hidden">
        {games.map((g) => {
          const activeConfirms = (g.confirmations || []).filter((c) => c.active);
          const hasConflict = conflictGameIds.has(g.id);
          return (
            <li key={g.id}>
              <Link
                href={`/games/${g.id}`}
                className="flex items-center justify-between px-4 py-3 hover:bg-neutral-50 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {g.home_school_text} vs {g.visitor_school_text}
                  </div>
                  <div className="text-neutral-500">
                    {g.game_date} · {g.game_time || "TBD"} · {g.conference || "—"} ·{" "}
                    {g.game_type || "—"}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {activeConfirms.map((c) => (
                    <span
                      key={c.slot}
                      className={`text-xs px-2 py-0.5 rounded-full border ${
                        c.is_emergency_override
                          ? "border-amber-300 bg-amber-50 text-amber-700"
                          : "border-neutral-200 bg-neutral-50 text-neutral-600"
                      }`}
                    >
                      {c.umpires?.canonical_name || "?"}
                    </span>
                  ))}
                  {hasConflict && (
                    <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-medium">
                      conflict
                    </span>
                  )}
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </main>
  );
}

export default function DashboardPage() {
  return (
    <RequireAuth>
      <DashboardContent />
    </RequireAuth>
  );
}
