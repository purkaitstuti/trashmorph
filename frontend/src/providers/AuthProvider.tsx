import type { Session, User } from "@supabase/supabase-js";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { supabase } from "../lib/supabase";

type Ctx = {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, details: { fullName: string; accountType: "user" | "recycler"; recyclerOrganization?: string; recyclerLocation?: string; recyclerContact?: string }) => Promise<"verify" | "signed-in">;
  signInWithGoogle: () => Promise<void>;
  resetPassword: (email: string) => Promise<void>;
  updatePassword: (password: string) => Promise<void>;
  resendVerification: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
};
const AuthContext = createContext<Ctx | null>(null);
const callback = () => `${window.location.origin}/auth/callback`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    supabase.auth.getSession().then(({ data }) => { if (active) { setSession(data.session); setLoading(false); } });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => { setSession(s); setLoading(false); });
    return () => { active = false; sub.subscription.unsubscribe(); };
  }, []);

  const value = useMemo<Ctx>(() => ({
    user: session?.user ?? null,
    session,
    loading,
    async signInWithPassword(email, password) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(email, password, details) {
      const { data, error } = await supabase.auth.signUp({ email, password, options: { data: {
        full_name: details.fullName, account_type: details.accountType,
        recycler_organization: details.accountType === "recycler" ? details.recyclerOrganization : null,
        recycler_location: details.accountType === "recycler" ? details.recyclerLocation : null,
        recycler_contact: details.accountType === "recycler" ? details.recyclerContact : null,
      }, emailRedirectTo: callback() } });
      if (error) throw error;
      // With email confirmation on, Supabase returns an obfuscated user with no identities for an existing address.
      if (data.user && data.user.identities?.length === 0) throw new Error("An account with this email already exists. Try signing in.");
      return data.session ? "signed-in" : "verify";
    },
    async signInWithGoogle() {
      const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: callback() } });
      if (error) throw error;
    },
    async resetPassword(email) {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${window.location.origin}/reset-password` });
      if (error) throw error;
    },
    async updatePassword(password) {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
    },
    async resendVerification(email) {
      const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: callback() } });
      if (error) throw error;
    },
    async signOut() {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
    },
  }), [session, loading]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
