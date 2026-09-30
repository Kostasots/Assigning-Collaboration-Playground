// ZIP -> { lat, lng, city, state } using the static file in /public (US ZIP centres).
// The file is only downloaded the first time a ZIP is looked up, then kept in memory.
let cache = null;

export async function lookupZip(zip) {
  if (!/^\d{5}$/.test(zip || "")) return null;
  if (!cache) {
    cache = fetch("/zip-centroids.json")
      .then((r) => (r.ok ? r.json() : {}))
      .catch(() => ({}));
  }
  const data = await cache;
  const hit = data[zip];
  return hit ? { lat: hit[0], lng: hit[1], city: hit[2], state: hit[3] } : null;
}
