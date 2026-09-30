"use client";

import Link from "next/link";
import { useAuth } from "@/lib/AuthProvider";

export default function NavBar() {
  const { session, person, signOut } = useAuth();

  return (
    <header className="border-b border-neutral-200 px-6 py-3 flex items-center justify-between">
      <Link href="/" className="font-semibold text-sm">
        FH Assigning Tool
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        {session && (
          <>
            <Link href="/" className="text-neutral-600 hover:text-neutral-900">
              Games
            </Link>
            <Link href="/umpires" className="text-neutral-600 hover:text-neutral-900">
              Umpires
            </Link>
            <Link href="/audit" className="text-neutral-600 hover:text-neutral-900">
              Audit log
            </Link>
            <span className="text-neutral-400">
              {person ? person.full_name : session.user.email}
            </span>
            <button onClick={signOut} className="text-neutral-500 hover:text-neutral-900">
              Sign out
            </button>
          </>
        )}
      </nav>
    </header>
  );
}
