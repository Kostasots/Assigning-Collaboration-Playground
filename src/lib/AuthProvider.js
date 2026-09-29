"use client";

import { createContext, useContext, useEffect, useState, useCallback } from "react";
import { getSupabaseClient } from "./supabaseClient";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined); // undefined = loading, null = signed out
  const [person, setPerson] = useState(null);
  const [roles, setRoles] = useState([]);
  const [loadingPerson, setLoadingPerson] = useState(false);

  const loadPerson = useCallback(async (currentSession) => {
    const supabase = getSupabaseClient();
    if (!currentSession) {
      setPerson(null);
      setRoles([]);
      return;
    }
    setLoadingPerson(true);
    const { data: personRow, error } = await supabase
      .from("people")
      .select("*")
      .eq("auth_user_id", currentSession.user.id)
      .maybeSingle();

    if (error || !personRow) {
      // Signed in with Supabase auth, but no matching `people` row yet —
      // an admin needs to add them (see README: "Adding a new person").
      setPerson(null);
      setRoles([]);
      setLoadingPerson(false);
      return;
    }
    setPerson(personRow);

    const { data: roleRows } = await supabase
      .from("person_roles")
      .select("role")
      .eq("person_id", personRow.id);
    setRoles((roleRows || []).map((r) => r.role));
    setLoadingPerson(false);
  }, []);

  useEffect(() => {
    const supabase = getSupabaseClient();
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      loadPerson(data.session);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      loadPerson(newSession);
    });
    return () => listener.subscription.unsubscribe();
  }, [loadPerson]);

  const signOut = useCallback(async () => {
    const supabase = getSupabaseClient();
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ session, person, roles, loadingPerson, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
