import { Eye, EyeOff } from "lucide-react";
import { useState, type ReactNode } from "react";
import toast from "react-hot-toast";
import { useAuth } from "../providers/AuthProvider";

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md">
      <h1 className="text-3xl font-bold">{title}</h1>
      {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
      <div className="card mt-6">{children}</div>
    </div>
  );
}

export function PasswordToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button type="button" onClick={onToggle} className="flex h-10 w-10 items-center justify-center rounded-md text-muted hover:text-ink" aria-label={shown ? "Hide password" : "Show password"} aria-pressed={shown}>
      {shown ? <EyeOff className="h-5 w-5" aria-hidden /> : <Eye className="h-5 w-5" aria-hidden />}
    </button>
  );
}

export function usePasswordToggle() {
  const [shown, setShown] = useState(false);
  return { type: shown ? "text" : "password", trailing: <PasswordToggle shown={shown} onToggle={() => setShown((s) => !s)} /> };
}

export function GoogleButton({ label }: { label: string }) {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);
  return (
    <button type="button" className="btn-outline w-full" disabled={busy} onClick={async () => {
      setBusy(true);
      try { await signInWithGoogle(); } catch (e) { setBusy(false); toast.error(e instanceof Error ? e.message : "Google sign-in failed."); }
    }}>
      <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.800 2.400 30.300 0 24 0 14.600 0 6.500 5.400 2.600 13.200l7.900 6.100C12.400 13.600 17.700 9.500 24 9.500z"/><path fill="#4285F4" d="M46.500 24.500c0-1.600-.1-3.100-.4-4.500H24v9h12.700c-.6 3-2.200 5.500-4.700 7.200l7.300 5.700c4.300-4 6.700-9.900 6.700-17.400z"/><path fill="#FBBC05" d="M10.500 28.700A14.500 14.500 0 0 1 9.500 24c0-1.600.3-3.200.8-4.700l-7.900-6.100A24 24 0 0 0 0 24c0 3.900.9 7.500 2.600 10.800l7.900-6.100z"/><path fill="#34A853" d="M24 48c6.500 0 11.900-2.100 15.900-5.800l-7.300-5.700c-2 1.400-4.600 2.300-8.600 2.300-6.300 0-11.600-4.100-13.500-9.800l-7.900 6.100C6.500 42.600 14.600 48 24 48z"/></svg>
      {label}
    </button>
  );
}

export function OrDivider() {
  return <div className="my-5 flex items-center gap-3 text-sm text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>;
}
