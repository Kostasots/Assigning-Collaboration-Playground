// Tidy a typed name part: trim, collapse spaces, and fix names typed in ALL CAPS or
// all lowercase. Names already in mixed case (McGinley, DeLong, den Hartog) are
// trusted exactly as typed.
export function tidyName(s) {
  const t = (s || "").trim().replace(/\s+/g, " ");
  if (!t) return "";
  if (t !== t.toUpperCase() && t !== t.toLowerCase()) return t;
  return t
    .toLowerCase()
    .split(" ")
    .map((w) =>
      w
        .replace(/(^|[-'])([a-z])/g, (m, a, b) => a + b.toUpperCase())
        .replace(/^Mc([a-z])/, (m, c) => "Mc" + c.toUpperCase())
    )
    .join(" ");
}
