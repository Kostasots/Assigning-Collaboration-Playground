"use client";

import { useState, useMemo, useId } from "react";
import { matchUmpires } from "@/lib/umpireSearch";

// Pick an umpire from the roster. Nothing typed here can create an umpire:
// the only value this ever reports is an existing roster entry (or null).
export default function UmpirePicker({
  umpires,
  value,
  onChange,
  excludeIds = [],
  onAddNew,
  placeholder = "Search the roster…",
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();

  const selected = value ? umpires.find((u) => u.id === value) : null;
  const results = useMemo(
    () => matchUmpires(umpires, query, { excludeIds }),
    [umpires, query, excludeIds]
  );

  function choose(u) {
    onChange(u.id);
    setQuery("");
    setOpen(false);
    setActive(0);
  }

  function handleKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, Math.max(results.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      // Never submit the surrounding form from here; Enter just picks the highlighted person.
      e.preventDefault();
      if (open && results[active]) choose(results[active].umpire);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  if (selected) {
    return (
      <div className="flex-1 flex items-center justify-between rounded-md border border-neutral-300 bg-neutral-50 px-3 py-1.5 text-sm">
        <span className="font-medium">{selected.canonical_name}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          className="text-xs text-neutral-500 underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="relative flex-1">
      <input
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setActive(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={handleKeyDown}
        className="w-full rounded-md border border-neutral-300 px-3 py-1.5 text-sm"
      />
      {open && query.trim() && (
        <ul id={listId} className="absolute z-10 mt-1 w-full max-h-64 overflow-auto rounded-md border border-neutral-200 bg-white shadow-md text-sm">
          {results.length === 0 ? (
            <li className="px-3 py-2 text-neutral-500">
              No one on the roster matches &ldquo;{query.trim()}&rdquo;.
              {!onAddNew && " Check the spelling, or ask an admin to add them."}
            </li>
          ) : (
            results.map((r, i) => (
              <li key={r.umpire.id}>
                <button
                  type="button"
                  // mousedown (not click) so the input's blur doesn't close the list first
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(r.umpire);
                  }}
                  className={`w-full text-left px-3 py-2 hover:bg-neutral-50 ${
                    i === active ? "bg-neutral-100" : ""
                  }`}
                >
                  <span className="font-medium">{r.umpire.canonical_name}</span>
                  {r.viaAlias && (
                    <span className="text-xs text-neutral-500"> · also known as {r.viaAlias}</span>
                  )}
                  {(r.umpire.usafh_rating || r.umpire.internal_rating) && (
                    <span className="block text-xs text-neutral-500">
                      {[
                        r.umpire.usafh_rating && `USA FH: ${r.umpire.usafh_rating}`,
                        r.umpire.internal_rating && `Internal: ${r.umpire.internal_rating}`,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  )}
                </button>
              </li>
            ))
          )}
          {onAddNew && (
            <li>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  onAddNew(query.trim());
                }}
                className="w-full text-left px-3 py-2 text-sm text-neutral-700 border-t border-neutral-100 hover:bg-neutral-50"
              >
                + Add &ldquo;{query.trim()}&rdquo; as a new umpire…
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
