"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { getSupabaseClient } from "@/lib/supabaseClient";
import RequireAuth from "@/components/RequireAuth";
import UmpirePicker from "@/components/UmpirePicker";
import { useAuth } from "@/lib/AuthProvider";

// Renders whatever rating info exists for an umpire ("" if neither is set)
// right next to their name, so assignors see level at decision time.
function RatingTags({ umpire }) {
  if (!umpire) return null;
  const tags = [];
  if (umpire.usafh_rating) tags.push(`USA FH: ${umpire.usafh_rating}`);
  if (umpire.internal_rating) tags.push(`Internal: ${umpire.internal_rating}`);
  if (!tags.length) return null;
  return <div className="text-xs text-neutral-500">{tags.join(" · ")}</div>;
}

// Callout: this umpire's OTHER confirmations the same date. Same-site ones are
// normal (e.g. two games at one stadium) but are shown so every assignor sees
// the double-up; anything confirmed by a DIFFERENT assignor is highlighted.
function CommitmentTags({ items, meId }) {
  if (!items || !items.length) return null;
  return (
    <div className="mt-1 space-y-1">
      {items.map((x) => {
        const byOther = x.confirmed_by_id && x.confirmed_by_id !== meId;
        const cls = !x.same_site
          ? "border-red-200 bg-red-50 text-red-700"
          : byOther
          ? "border-amber-300 bg-amber-50 text-amber-800"
          : "border-neutral-200 bg-neutral-50 text-neutral-600";
        return (
          <div key={x.other_game_id} className={`text-xs border rounded px-2 py-1 ${cls}`}>
            Also confirmed:{" "}
            <Link href={`/games/${x.other_game_id}`} className="underline">
              {x.home} vs {x.visitor}
            </Link>{" "}
            · {x.game_time || "TBD"} ·{" "}
            {x.same_site ? "same site" : `different site (${x.location})`} · by{" "}
            {x.confirmed_by_name || "?"}
            {byOther && " — another assignor, please coordinate"}
          </div>
        );
      })}
    </div>
  );
}

function GameDetailContent({ gameId }) {
  const { person } = useAuth();
  const [game, setGame] = useState(null);
  const [potentials, setPotentials] = useState([]);
  const [confirmations, setConfirmations] = useState([]);
  const [commitments, setCommitments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState("");
  const [roster, setRoster] = useState([]);
  const [pickedUmpireId, setPickedUmpireId] = useState(null);
  const [busy, setBusy] = useState(false);

  // Emergency override modal state
  const [overrideFor, setOverrideFor] = useState(null); // { slot, umpireId, umpireName, reasonHint }
  const [overrideReason, setOverrideReason] = useState("");

  // Emergency fill-in (umpire not in potentials at all) form state
  const [fillInSlot, setFillInSlot] = useState(null); // 1 | 2 | null
  const [fillInUmpireId, setFillInUmpireId] = useState(null);
  const [fillInReason, setFillInReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    const supabase = getSupabaseClient();

    const [
      { data: gameData, error: gameErr },
      { data: potentialsData },
      { data: confirmData },
      { data: commitmentsData },
      { data: rosterData },
    ] =
      await Promise.all([
        supabase.from("games").select("*").eq("id", gameId).single(),
        supabase
          .from("potentials")
          .select(
            "id, umpire_id, note, added_at, system_suggested, suggested_distance_miles, " +
              "umpires(canonical_name, usafh_rating, internal_rating), people(full_name)"
          )
          .eq("game_id", gameId)
          .order("added_at", { ascending: true }),
        supabase
          .from("confirmations")
          .select(
            "id, slot, umpire_id, is_emergency_override, override_reason, confirmed_at, " +
              "umpires(canonical_name, usafh_rating, internal_rating), people(full_name)"
          )
          .eq("game_id", gameId)
          .eq("active", true),
        // Other same-date confirmations for these umpires (returns nothing, harmlessly,
        // if the database function has not been created yet).
        supabase.rpc("same_date_umpire_commitments", { p_game_id: gameId }),
        supabase
          .from("umpires")
          .select("id, canonical_name, aliases, usafh_rating, internal_rating")
          .order("canonical_name"),
      ]);

    if (gameErr) setErrorMsg(gameErr.message);
    setGame(gameData || null);
    setPotentials(potentialsData || []);
    setConfirmations(confirmData || []);
    setCommitments(commitmentsData || []);
    setRoster(rosterData || []);
    setLoading(false);
  }, [gameId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- standard fetch-on-mount; load() guards its own state
    load();
  }, [load]);

  async function handleAddPotential(e) {
    e.preventDefault();
    if (!pickedUmpireId) return;
    setBusy(true);
    setErrorMsg("");
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase
        .from("potentials")
        .insert({ game_id: gameId, umpire_id: pickedUmpireId, added_by: person.id });
      if (error && error.code !== "23505") throw error; // ignore duplicate (already a potential)
      setPickedUmpireId(null);
      await load();
    } catch (err) {
      setErrorMsg(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function tryConfirm(slot, umpireId, isEmergency, reason) {
    setBusy(true);
    setErrorMsg("");
    try {
      const supabase = getSupabaseClient();
      const { error } = await supabase.rpc("confirm_umpire", {
        p_game_id: gameId,
        p_slot: slot,
        p_umpire_id: umpireId,
        p_is_emergency: isEmergency,
        p_override_reason: reason || null,
      });
      if (error) throw error;
      setOverrideFor(null);
      setOverrideReason("");
      setFillInSlot(null);
      setFillInUmpireId(null);
      setFillInReason("");
      await load();
    } catch (err) {
      // Only rule blocks (same-date conflict, not in Potentials) offer the override.
      // Anything else (no matching person record, a bad slot, ...) is just shown as an error.
      const isRuleBlock = /emergency override/i.test(err.message || "");
      if (!isEmergency && isRuleBlock) {
        const rosterEntry = roster.find((u) => u.id === umpireId);
        setOverrideFor({
          slot,
          umpireId,
          umpireName: rosterEntry?.canonical_name || "this umpire",
          reasonHint: err.message,
        });
      } else {
        setErrorMsg(err.message);
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleFillInSubmit(e) {
    e.preventDefault();
    if (!fillInUmpireId || !fillInReason.trim()) return;
    await tryConfirm(fillInSlot, fillInUmpireId, true, fillInReason);
  }

  if (loading) return <p className="p-6 text-sm text-neutral-500">Loading…</p>;
  if (!game) return <p className="p-6 text-sm text-red-600">Game not found.</p>;

  const confirmedUmpireIdsBySlot = { 1: null, 2: null };
  confirmations.forEach((c) => (confirmedUmpireIdsBySlot[c.slot] = c));

  return (
    <main className="max-w-2xl mx-auto px-6 py-8">
      <h1 className="text-lg font-semibold">
        {game.home_school_text} vs {game.visitor_school_text}
      </h1>
      <p className="text-sm text-neutral-500 mb-6">
        {game.game_date} · {game.game_time || "TBD"} · {game.conference || "—"} ·{" "}
        {game.game_type || "—"}
      </p>

      {errorMsg && <p className="text-sm text-red-600 mb-4">{errorMsg}</p>}

      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-2">Confirmed</h2>
        <div className="grid grid-cols-2 gap-3">
          {[1, 2].map((slot) => {
            const c = confirmedUmpireIdsBySlot[slot];
            return (
              <div
                key={slot}
                className={`border rounded-lg p-3 text-sm ${
                  c?.is_emergency_override
                    ? "border-amber-300 bg-amber-50"
                    : "border-neutral-200"
                }`}
              >
                <div className="text-xs text-neutral-500 mb-1">Slot {slot}</div>
                {c ? (
                  <>
                    <div className="font-medium">{c.umpires?.canonical_name}</div>
                    <RatingTags umpire={c.umpires} />
                    <div className="text-xs text-neutral-500">
                      by {c.people?.full_name || "?"}
                    </div>
                    <CommitmentTags
                      items={commitments.filter((x) => x.umpire_id === c.umpire_id)}
                      meId={person?.id}
                    />
                    {c.is_emergency_override && (
                      <div className="text-xs text-amber-700 mt-1">
                        Emergency override: {c.override_reason}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="text-neutral-400">Not confirmed</div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="text-sm font-semibold mb-2">Potentials</h2>
        <p className="text-xs text-neutral-500 mb-3">
          Anyone can add a candidate here for consideration, even if they might be busy elsewhere
          — this is a sandbox. Confirming still checks for same-date conflicts.
        </p>

        <form onSubmit={handleAddPotential} className="flex gap-2 mb-4">
          <UmpirePicker
            umpires={roster}
            value={pickedUmpireId}
            onChange={setPickedUmpireId}
            excludeIds={potentials.map((p) => p.umpire_id)}
          />
          <button
            type="submit"
            disabled={busy || !pickedUmpireId}
            className="rounded-md bg-neutral-900 text-white text-sm px-3 py-1.5 disabled:opacity-50"
          >
            Add
          </button>
        </form>

        <ul className="divide-y divide-neutral-200 border border-neutral-200 rounded-lg overflow-hidden">
          {potentials.length === 0 && (
            <li className="px-3 py-3 text-sm text-neutral-400">No potentials added yet.</li>
          )}
          {potentials.map((p) => (
            <li key={p.id} className="flex items-center justify-between px-3 py-2 text-sm">
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{p.umpires?.canonical_name}</span>
                  {p.system_suggested && (
                    <span
                      className="text-[10px] uppercase tracking-wide font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0.5"
                      title="Auto-suggested: within 100 miles of the host school, for a conference that doesn't reimburse mileage"
                    >
                      Suggested
                      {p.suggested_distance_miles != null && ` · ${Math.round(p.suggested_distance_miles)}mi`}
                    </span>
                  )}
                </div>
                <RatingTags umpire={p.umpires} />
                <CommitmentTags
                  items={commitments.filter((x) => x.umpire_id === p.umpire_id)}
                  meId={person?.id}
                />
                <div className="text-xs text-neutral-500">
                  {p.system_suggested ? "auto-suggested" : `added by ${p.people?.full_name || "?"}`}
                </div>
              </div>
              <div className="flex gap-1.5">
                {[1, 2].map((slot) => (
                  <button
                    key={slot}
                    disabled={busy}
                    onClick={() => tryConfirm(slot, p.umpire_id, false, null)}
                    className="text-xs rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50 disabled:opacity-50"
                  >
                    Confirm → slot {slot}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <button
          onClick={() => setFillInSlot(fillInSlot ? null : 1)}
          className="text-xs text-amber-700 underline"
        >
          {fillInSlot ? "Cancel emergency fill-in" : "Emergency fill-in (not in Potentials)"}
        </button>
        {fillInSlot && (
          <form onSubmit={handleFillInSubmit} className="mt-3 border border-amber-300 bg-amber-50 rounded-lg p-3 space-y-2">
            <div className="flex gap-2 items-center text-xs">
              <span>Slot:</span>
              {[1, 2].map((s) => (
                <label key={s} className="flex items-center gap-1">
                  <input
                    type="radio"
                    checked={fillInSlot === s}
                    onChange={() => setFillInSlot(s)}
                  />
                  {s}
                </label>
              ))}
            </div>
            <div className="flex">
              <UmpirePicker
                umpires={roster}
                value={fillInUmpireId}
                onChange={setFillInUmpireId}
                placeholder="Search the roster…"
              />
            </div>
            <input
              type="text"
              placeholder="Reason (required — this gets logged)"
              value={fillInReason}
              onChange={(e) => setFillInReason(e.target.value)}
              required
              className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={busy || !fillInUmpireId || !fillInReason.trim()}
              className="rounded-md bg-amber-600 text-white text-sm px-3 py-1.5 disabled:opacity-50"
            >
              Confirm as emergency fill-in
            </button>
          </form>
        )}
      </section>

      {overrideFor && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center p-6">
          <div className="bg-white rounded-lg p-5 max-w-sm w-full space-y-3">
            <h3 className="font-semibold text-sm">Can&apos;t confirm normally</h3>
            <p className="text-sm text-neutral-600">{overrideFor.reasonHint}</p>
            <p className="text-sm">
              Confirm <strong>{overrideFor.umpireName}</strong> to slot {overrideFor.slot} anyway,
              as an emergency override?
            </p>
            <input
              type="text"
              placeholder="Reason (required — this gets logged)"
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setOverrideFor(null);
                  setOverrideReason("");
                }}
                className="text-sm px-3 py-1.5 text-neutral-600"
              >
                Cancel
              </button>
              <button
                disabled={!overrideReason.trim() || busy}
                onClick={() =>
                  tryConfirm(overrideFor.slot, overrideFor.umpireId, true, overrideReason)
                }
                className="text-sm px-3 py-1.5 rounded-md bg-amber-600 text-white disabled:opacity-50"
              >
                Confirm anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

export default function GameDetailPage({ params }) {
  const { id } = use(params);
  return (
    <RequireAuth>
      <GameDetailContent gameId={id} />
    </RequireAuth>
  );
}
