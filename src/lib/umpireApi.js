import { getSupabaseClient } from "@/lib/supabaseClient";

// The only ways the app creates or changes an umpire. Both go through database
// functions (add_umpire / update_umpire) that enforce the rules and write the audit log.
export async function addUmpire(v) {
  const { data, error } = await getSupabaseClient().rpc("add_umpire", {
    p_first_name: v.firstName,
    p_last_name: v.lastName,
    p_nickname: v.nickname || null,
    p_zip: v.zip || null,
    p_city: v.city || null,
    p_state: v.state || null,
    p_lat: v.lat ?? null,
    p_lng: v.lng ?? null,
    p_usafh_rating: v.usafhRating || null,
    p_notes: v.notes || null,
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function updateUmpire(id, v) {
  const { data, error } = await getSupabaseClient().rpc("update_umpire", {
    p_id: id,
    p_aliases: v.aliases || [],
    p_zip: v.zip || null,
    p_city: v.city || null,
    p_state: v.state || null,
    p_lat: v.lat ?? null,
    p_lng: v.lng ?? null,
    p_usafh_rating: v.usafhRating || null,
    p_internal_rating: v.internalRating || null,
    p_notes: v.notes || null,
  });
  if (error) throw new Error(error.message);
  return data;
}
