"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/AuthProvider";

// Wrap any page's content in <RequireAuth> to gate it behind sign-in and a
// matching `people` row. Shows a clear message rather than a blank page for
// the "signed in but nobody added me to `people` yet" case, since that's a
// setup step an admin has to do manually (see README).
export default function RequireAuth({ children }) {
  const { session, person, loadingPerson } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (session === null) router.replace("/login");
  }, [session, router]);

  if (session === undefined) {
    return <p className="p-6 text-sm text-neutral-500">Loading…</p>;
  }
  if (session === null) {
    return null; // redirecting
  }
  if (loadingPerson) {
    return <p className="p-6 text-sm text-neutral-500">Loading your account…</p>;
  }
  if (!person) {
    return (
      <div className="p-6 text-sm max-w-md">
        <p className="mb-2">
          You&apos;re signed in as <strong>{session.user.email}</strong>, but there&apos;s no
          matching record for you in the app yet.
        </p>
        <p className="text-neutral-500">
          Ask an admin to add you in Supabase (Table Editor → <code>people</code>) with this
          exact email address, plus your role(s) in <code>person_roles</code>.
        </p>
      </div>
    );
  }
  return children;
}
