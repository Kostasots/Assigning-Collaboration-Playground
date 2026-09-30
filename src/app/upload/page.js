"use client";

import { useState } from "react";
import { getSupabaseClient } from "@/lib/supabaseClient";
import RequireAuth from "@/components/RequireAuth";
import SchedulePreview from "@/components/SchedulePreview";
import { readScheduleFile } from "@/lib/sheetRead";
import { analyzeSchedule } from "@/lib/scheduleImport";

function UploadContent() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [sheetName, setSheetName] = useState("");
  const [fileName, setFileName] = useState("");

  async function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    setError("");
    setResult(null);
    setFileName(file.name);
    try {
      const supabase = getSupabaseClient();
      const [sheets, schoolsRes, umpiresRes] = await Promise.all([
        readScheduleFile(file),
        supabase.from("schools").select("id, name, aliases"),
        supabase.from("umpires").select("id, canonical_name, aliases"),
      ]);
      if (schoolsRes.error) throw schoolsRes.error;
      if (umpiresRes.error) throw umpiresRes.error;
      const ctx = { schools: schoolsRes.data || [], umpires: umpiresRes.data || [] };
      // use the first sheet that has recognizable schedule columns
      let chosen = null;
      for (const sh of sheets) {
        const r = analyzeSchedule(sh.rows, ctx);
        if (r.ok) {
          chosen = { r, name: sh.name };
          break;
        }
      }
      if (!chosen) throw new Error("I couldn't find a schedule in that file. It needs a heading row with at least Date and Home columns.");
      setResult(chosen.r);
      setSheetName(chosen.name);
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  }

  return (
    <main className="max-w-3xl mx-auto px-6 py-8">
      <h1 className="text-lg font-semibold mb-1">Upload a schedule</h1>
      <p className="text-sm text-neutral-500 mb-4">
        Choose an .xlsx or .csv schedule sheet to see what the tool understands from it.
      </p>
      <p className="text-sm rounded-md border border-amber-300 bg-amber-50 text-amber-800 px-3 py-2 mb-4">
        Preview only: nothing is saved yet. Games are not created from this page.
      </p>

      <label className="inline-block rounded-md bg-neutral-900 text-white text-sm px-3 py-1.5 cursor-pointer">
        {busy ? "Reading…" : "Choose a file"}
        <input type="file" accept=".xlsx,.csv" onChange={handleFile} disabled={busy} className="hidden" />
      </label>
      {fileName && <span className="ml-3 text-sm text-neutral-500">{fileName}</span>}

      {error && <p className="text-sm text-red-600 mt-4">{error}</p>}
      {result && (
        <div className="mt-6">
          <SchedulePreview result={result} sheetName={sheetName} />
        </div>
      )}
    </main>
  );
}

export default function UploadPage() {
  return (
    <RequireAuth>
      <UploadContent />
    </RequireAuth>
  );
}
