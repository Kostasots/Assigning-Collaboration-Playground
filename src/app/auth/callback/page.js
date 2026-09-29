"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabaseClient";

// Landing point for the magic-link email. Exchanges the one-time code in the
// URL for a real session, then sends the user on to the dashboard.
export default function AuthCallbackPage() {
  const router = useRouter();
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth
      .exchangeCodeForSession(window.location.href)
      .then(({ error }) => {
        if (error) {
          setErrorMsg(error.message);
        } else {
          router.replace("/");
        }
      });
  }, [router]);

  return (
    <main className="mx-auto max-w-sm px-6 py-24 text-sm">
      {errorMsg ? (
        <p className="text-red-600">Sign-in failed: {errorMsg}</p>
      ) : (
        <p className="text-neutral-500">Signing you in…</p>
      )}
    </main>
  );
}
