import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const isSupabaseConfigured = Boolean(url && key);

// Placeholders keep the app rendering when unconfigured; the UI shows a setup notice and auth calls fail clearly.
export const supabase = createClient(url || "http://localhost:54321", key || "missing-anon-key", {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
