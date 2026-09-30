"use client";

import { useMemo, useRef, useState } from "react";
import { tidyName } from "@/lib/nameFormat";
import { lookupZip } from "@/lib/zipLookup";
import { normalizeText } from "@/lib/umpireSearch";

// "kim" -> last name only; "ashley kim" -> first + last.
function splitQuery(q) {
  const t = (q || "").trim().split(/\s+/).filter(Boolean);
  if (t.length === 0) return ["", ""];
  if (t.length === 1) return ["", t[0]];
  return [t[0], t.slice(1).join(" ")];
}

const inputCls = "w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm";

export default function AddUmpireForm({ roster, initialQuery = "", onSubmit, onDone, onCancel }) {
  const [initFirst, initLast] = splitQuery(initialQuery);
  const [firstRaw, setFirstRaw] = useState(initFirst);
  const [lastRaw, setLastRaw] = useState(initLast);
  const [nickname, setNickname] = useState("");
  const [zip, setZip] = useState("");
  const [geo, setGeo] = useState(null);
  const [zipStatus, setZipStatus] = useState("empty"); // empty | partial | loading | ok | notfound
  const [usafhRating, setUsafhRating] = useState("");
  const [notes, setNotes] = useState("");
  const [differentPerson, setDifferentPerson] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const zipSeq = useRef(0);

  const first = tidyName(firstRaw);
  const last = tidyName(lastRaw);
  const full = normalizeText(`${first} ${last}`);

  const exact = useMemo(
    () =>
      full
        ? roster.find(
            (u) =>
              normalizeText(u.canonical_name) === full ||
              (u.aliases || []).some((a) => normalizeText(a) === full)
          )
        : null,
    [roster, full]
  );
  const similar = useMemo(() => {
    const lastWord = normalizeText(last).split(" ").pop();
    if (!lastWord) return [];
    return roster
      .filter((u) => u !== exact && normalizeText(u.canonical_name).split(" ").includes(lastWord))
      .slice(0, 8);
  }, [roster, last, exact]);

  function handleZip(value) {
    const v = value.replace(/\D/g, "").slice(0, 5);
    setZip(v);
    setGeo(null);
    const seq = ++zipSeq.current;
    if (v.length === 0) return setZipStatus("empty");
    if (v.length < 5) return setZipStatus("partial");
    setZipStatus("loading");
    lookupZip(v).then((hit) => {
      if (seq !== zipSeq.current) return; // a newer ZIP was typed meanwhile
      setGeo(hit);
      setZipStatus(hit ? "ok" : "notfound");
    });
  }

  const canSubmit =
    !busy &&
    first &&
    last &&
    !exact &&
    (similar.length === 0 || differentPerson) &&
    (zipStatus === "empty" || zipStatus === "ok");

  async function handleSubmit(e) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError("");
    try {
      const row = await onSubmit({
        firstName: first,
        lastName: last,
        nickname: nickname.trim(),
        zip: zip || null,
        city: geo?.city ?? null,
        state: geo?.state ?? null,
        lat: geo?.lat ?? null,
        lng: geo?.lng ?? null,
        usafhRating: usafhRating.trim(),
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
      <p className="text-xs text-neutral-500">
        Add someone who isn&apos;t on the roster yet. Use their full name as it appears in RQ.
      </p>
      <div className="flex gap-2">
        <label className="flex-1 text-xs text-neutral-600">
          First name
          <input
            className={inputCls + " mt-1"}
            value={firstRaw}
            onChange={(e) => setFirstRaw(e.target.value)}
          />
        </label>
        <label className="flex-1 text-xs text-neutral-600">
          Last name
          <input
            className={inputCls + " mt-1"}
            value={lastRaw}
            onChange={(e) => setLastRaw(e.target.value)}
          />
        </label>
      </div>
      {first && last && (
        <p className="text-xs text-neutral-500">
          Will be saved as <strong>{first} {last}</strong>
        </p>
      )}

      {exact && (
        <p className="text-xs rounded-md border border-red-200 bg-red-50 text-red-700 px-3 py-2">
          {exact.canonical_name} is already on the roster. Close this and pick them from the
          search instead.
        </p>
      )}
      {!exact && similar.length > 0 && (
        <div className="text-xs rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 space-y-1.5">
          <div>Already on the roster with the same last name:</div>
          <ul className="list-disc pl-4">
            {similar.map((u) => (
              <li key={u.id}>{u.canonical_name}</li>
            ))}
          </ul>
          <label className="flex items-center gap-2 pt-1">
            <input
              type="checkbox"
              checked={differentPerson}
              onChange={(e) => setDifferentPerson(e.target.checked)}
            />
            None of these &mdash; this is a different person
          </label>
        </div>
      )}

      <label className="block text-xs text-neutral-600">
        Nickname or other spelling (optional)
        <input
          className={inputCls + " mt-1"}
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
        />
      </label>
      <label className="block text-xs text-neutral-600">
        Home ZIP (optional &mdash; used for distances, only the town is shown)
        <input
          className={inputCls + " mt-1"}
          inputMode="numeric"
          value={zip}
          onChange={(e) => handleZip(e.target.value)}
        />
      </label>
      {zipStatus === "partial" && (
        <p className="text-xs text-neutral-500">Enter all 5 digits, or leave it blank.</p>
      )}
      {zipStatus === "loading" && <p className="text-xs text-neutral-500">Looking up…</p>}
      {zipStatus === "ok" && (
        <p className="text-xs text-emerald-700">
          {geo.city}, {geo.state}
        </p>
      )}
      {zipStatus === "notfound" && (
        <p className="text-xs text-red-700">That ZIP wasn&apos;t found. Check it or leave it blank.</p>
      )}
      <div className="flex gap-2">
        <label className="flex-1 text-xs text-neutral-600">
          USA FH rating (optional)
          <input
            className={inputCls + " mt-1"}
            value={usafhRating}
            onChange={(e) => setUsafhRating(e.target.value)}
          />
        </label>
      </div>
      <label className="block text-xs text-neutral-600">
        Notes (optional)
        <input
          className={inputCls + " mt-1"}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
        />
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
          {busy ? "Adding…" : "Add umpire"}
        </button>
      </div>
    </form>
  );
}
