"use client";

import { useRef, useState } from "react";
import { lookupZip } from "@/lib/zipLookup";

const inputCls = "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm";

// Edits everything about an umpire EXCEPT the name (a rename is an admin job).
export default function EditUmpireForm({ umpire, onSubmit, onDone, onCancel }) {
  const [aliases, setAliases] = useState((umpire.aliases || []).join(", "));
  const [zip, setZip] = useState(umpire.home_zip || "");
  const [geo, setGeo] = useState(
    umpire.home_zip
      ? { city: umpire.home_city, state: umpire.home_state, lat: umpire.home_lat, lng: umpire.home_lng }
      : null
  );
  const [zipStatus, setZipStatus] = useState(umpire.home_zip ? "ok" : "empty");
  const [usafhRating, setUsafhRating] = useState(umpire.usafh_rating || "");
  const [internalRating, setInternalRating] = useState(umpire.internal_rating || "");
  const [notes, setNotes] = useState(umpire.notes || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const zipSeq = useRef(0);

  function handleZip(value) {
    const v = value.replace(/\D/g, "").slice(0, 5);
    setZip(v);
    setGeo(null);
    const seq = ++zipSeq.current;
    if (v.length === 0) return setZipStatus("empty");
    if (v.length < 5) return setZipStatus("partial");
    setZipStatus("loading");
    lookupZip(v).then((hit) => {
      if (seq !== zipSeq.current) return;
      setGeo(hit);
      setZipStatus(hit ? "ok" : "notfound");
    });
  }

  const canSubmit = !busy && (zipStatus === "empty" || zipStatus === "ok");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const row = await onSubmit(umpire.id, {
        aliases: aliases.split(",").map((a) => a.trim()).filter(Boolean),
        zip: zip || null,
        city: geo?.city ?? null,
        state: geo?.state ?? null,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        usafhRating: usafhRating.trim(),
        internalRating: internalRating.trim(),
        notes: notes.trim(),
      });
      onDone(row);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 text-sm">
      <p className="font-medium">{umpire.canonical_name}</p>
      <label className="block text-xs text-neutral-600">
        Nicknames and other spellings (separate with commas)
        <input
          className={inputCls + " mt-1"}
          value={aliases}
          onChange={(e) => setAliases(e.target.value)}
        />
      </label>
      <label className="block text-xs text-neutral-600">
        Home ZIP (used for distances, only the town is shown)
        <input
          className={inputCls + " mt-1"}
          inputMode="numeric"
          value={zip}
          onChange={(e) => handleZip(e.target.value)}
        />
      </label>
      {zipStatus === "partial" && (
        <p className="text-xs text-neutral-500">Enter all 5 digits, or clear it.</p>
      )}
      {zipStatus === "loading" && <p className="text-xs text-neutral-500">Looking up…</p>}
      {zipStatus === "ok" && geo && (
        <p className="text-xs text-emerald-700">
          {geo.city}, {geo.state}
        </p>
      )}
      {zipStatus === "notfound" && (
        <p className="text-xs text-red-700">That ZIP wasn&apos;t found. Check it or clear it.</p>
      )}
      <div className="flex gap-2">
        <label className="flex-1 text-xs text-neutral-600">
          USA FH rating
          <input
            className={inputCls + " mt-1"}
            value={usafhRating}
            onChange={(e) => setUsafhRating(e.target.value)}
          />
        </label>
        <label className="flex-1 text-xs text-neutral-600">
          Internal rating
          <input
            className={inputCls + " mt-1"}
            value={internalRating}
            onChange={(e) => setInternalRating(e.target.value)}
          />
        </label>
      </div>
      <label className="block text-xs text-neutral-600">
        Notes
        <input className={inputCls + " mt-1"} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex justify-end gap-2 pt-1">
        <button type="button" onClick={onCancel} className="text-sm px-3 py-1.5 text-neutral-600">
          Cancel
        </button>
        <button
          type="submit"
          disabled={!canSubmit}
          className="rounded-md bg-neutral-900 text-white text-sm px-3 py-1.5 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}
