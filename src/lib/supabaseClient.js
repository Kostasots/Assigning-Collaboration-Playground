"use client";

import { createBrowserClient } from "@supabase/ssr";

// Reads the two public, safe-to-expose values from environment variables set
// in Vercel (or .env.local for local dev). See README.md for where to get
// these from your Supabase project (Project Settings > API).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

let client = null;

export function getSupabaseClient() {
  if (!client) {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
          "Set these in .env.local (local dev) or your Vercel project's Environment Variables (production)."
      );
    }
    client = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }
  return client;
}
