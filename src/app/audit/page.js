"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabaseClient";
import RequireAuth from "@/components/RequireAuth";

function AuditContent() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = getSupabaseClient();
    const { data, error } = await supabase
      .from("audit_log")
      .select(
        `id, event_type, created_at, details,
         games(id, game_date, home_school_text, visitor_school_text),
         umpires(canonical_name), people(full_name)`
      )
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) setErrorMsg(error.message);
    setRows(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount; load() guards its own state
    load();
  }, [load]);

  if (loading) return <p className="p-6 text-sm text-neutral-500">Loading…</p>;
  if (errorMsg) return <p className="p-6 text-sm text-red-600">{errorMsg}</p>;

  return (
    <main className="max-w-4xl mx-auto px-6 py-8">
      <h1 className="text-lg font-semibold mb-1">Audit log</h1>
      <p className="text-sm text-neutral-500 mb-6">
        Every Potentials add, confirm, and emergency override — most recent first.
      </p>

      <ul className="divide-y divide-neutral-200 border border-neutral-200 rounded-lg overflow-hidden">
        {rows.map((r) => (
          <li key={r.id} className="px-4 py-3 text-sm">
            <div className="flex items-center gap-2">
              <span
                className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  r.event_type === "confirmed_override"
                    ? "bg-amber-100 text-amber-700"
                    : r.event_type === "confirmed"
                    ? "bg-emerald-100 text-emerald-700"
                    : "bg-neutral-100 text-neutral-600"
                }`}
              >
                {r.event_type}
              </span>
              <span className="text-neutral-500 text-xs">
                {new Date(r.created_at).toLocaleString()}
              </span>
            </div>
            <div className="mt-1">
              <strong>{r.people?.full_name || "?"}</strong> — {r.umpires?.canonical_name || "?"}
              {r.games && (
                <>
                  {" "}
                  on{" "}
                  <Link href={`/games/${r.games.id}`} className="underline">
                    {r.games.home_school_text} vs {r.games.visitor_school_text} (
                    {r.games.game_date})
                  </Link>
                </>
              )}
            </div>
            {r.details?.override_reason && (
              <div className="text-xs text-neutral-500 mt-0.5">
                Reason: {r.details.override_reason}
              </div>
            )}
          </li>
        ))}
        {rows.length === 0 && (
          <li className="px-4 py-3 text-sm text-neutral-400">No activity yet.</li>
        )}
      </ul>
    </main>
  );
}

export default function AuditPage() {
  return (
    <RequireAuth>
      <AuditContent />
    </RequireAuth>
  );
}
