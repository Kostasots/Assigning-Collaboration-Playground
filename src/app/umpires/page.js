"use client";

import { useEffect, useState, useCallback, useMemo } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import RequireAuth from "@/components/RequireAuth";
import Modal from "@/components/Modal";
import AddUmpireForm from "@/components/AddUmpireForm";
import EditUmpireForm from "@/components/EditUmpireForm";
import { useAuth } from "@/lib/AuthProvider";
import { addUmpire, updateUmpire } from "@/lib/umpireApi";
import { matchUmpires } from "@/lib/umpireSearch";

function UmpiresContent() {
  const { roles } = useAuth();
  const canEdit = roles.some((r) => r === "admin" || r === "d1_assignor" || r === "d2d3_assignor");
  const [umpires, setUmpires] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [query, setQuery] = useState("");
  const [onlyNoLocation, setOnlyNoLocation] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await getSupabaseClient()
      .from("umpires")
      .select(
        "id, canonical_name, aliases, home_city, home_state, home_zip, usafh_rating, internal_rating, notes"
      )
      .order("canonical_name");
    if (error) setErrorMsg(error.message);
    setUmpires(data || []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount
    load();
  }, [load]);

  const withoutLocation = useMemo(() => umpires.filter((u) => !u.home_zip).length, [umpires]);
  const shown = useMemo(() => {
    let list = query.trim()
      ? matchUmpires(umpires, query, { limit: 500 }).map((r) => r.umpire)
      : umpires;
    if (onlyNoLocation) list = list.filter((u) => !u.home_zip);
    return list;
  }, [umpires, query, onlyNoLocation]);

  if (loading) return <p className="p-6 text-sm text-neutral-500">Loading…</p>;

  return (
    <main className="max-w-3xl mx-auto px-6 py-8">
      <div className="flex items-start justify-between gap-4 mb-1">
        <h1 className="text-lg font-semibold">Umpires</h1>
        {canEdit && (
          <button
            onClick={() => {
              setNotice("");
              setAdding(true);
            }}
            className="rounded-md bg-neutral-900 text-white text-sm px-3 py-1.5"
          >
            Add umpire
          </button>
        )}
      </div>
      <p className="text-sm text-neutral-500 mb-4">
        {umpires.length} on the roster. Only the town is shown; the ZIP is used for distances.
      </p>
      {errorMsg && <p className="text-sm text-red-600 mb-3">{errorMsg}</p>}
      {notice && <p className="text-sm text-emerald-700 mb-3">{notice}</p>}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <input
          type="text"
          placeholder="Search by name or nickname…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="flex-1 min-w-[12rem] rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
        />
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <input
            type="checkbox"
            checked={onlyNoLocation}
            onChange={(e) => setOnlyNoLocation(e.target.checked)}
          />
          Only those without a location ({withoutLocation})
        </label>
      </div>

      <ul className="divide-y divide-neutral-200 border border-neutral-200 rounded-lg overflow-hidden">
        {shown.length === 0 && (
          <li className="px-3 py-3 text-sm text-neutral-400">No one matches.</li>
        )}
        {shown.map((u) => (
          <li key={u.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
            <div>
              <div className="font-medium">{u.canonical_name}</div>
              {u.aliases?.length > 0 && (
                <div className="text-xs text-neutral-500">also: {u.aliases.join(", ")}</div>
              )}
              <div className="text-xs">
                {u.home_zip ? (
                  <span className="text-neutral-600">
                    {u.home_city}, {u.home_state}
                  </span>
                ) : (
                  <span className="text-amber-700">No location yet</span>
                )}
                {(u.usafh_rating || u.internal_rating) && (
                  <span className="text-neutral-500">
                    {" · "}
                    {[
                      u.usafh_rating && `USA FH: ${u.usafh_rating}`,
                      u.internal_rating && `Internal: ${u.internal_rating}`,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                )}
              </div>
            </div>
            {canEdit && (
              <button
                onClick={() => {
                  setNotice("");
                  setEditing(u);
                }}
                className="text-xs rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
              >
                Edit
              </button>
            )}
          </li>
        ))}
      </ul>

      {adding && (
        <Modal title="Add a new umpire" onClose={() => setAdding(false)}>
          <AddUmpireForm
            roster={umpires}
            initialQuery={query}
            onSubmit={addUmpire}
            onCancel={() => setAdding(false)}
            onDone={async (row) => {
              await load();
              setNotice(`Added ${row.canonical_name}.`);
              setAdding(false);
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal title="Edit umpire" onClose={() => setEditing(null)}>
          <EditUmpireForm
            umpire={editing}
            onSubmit={updateUmpire}
            onCancel={() => setEditing(null)}
            onDone={async (row) => {
              await load();
              setNotice(`Saved ${row.canonical_name}.`);
              setEditing(null);
            }}
          />
        </Modal>
      )}
    </main>
  );
}

export default function UmpiresPage() {
  return (
    <RequireAuth>
      <UmpiresContent />
    </RequireAuth>
  );
}
