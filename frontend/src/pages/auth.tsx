import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import type { z } from "zod";
import { AuthShell, GoogleButton, OrDivider, usePasswordToggle } from "../components/AuthShell";
import { ErrorNote, Field, FullPageSpinner } from "../components/ui";
import { emailSchema, loginSchema, registerSchema, resetSchema } from "../lib/schemas";
import { useAuth } from "../providers/AuthProvider";

const msg = (e: unknown, fallback: string) => (e instanceof Error && e.message ? e.message : fallback);

export function LoginPage() {
  const { user, loading, signInWithPassword, resendVerification } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = (location.state as { from?: string } | null)?.from ?? "/dashboard";
  const pw = usePasswordToggle();
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const { register, handleSubmit, getValues, formState: { errors, isSubmitting } } = useForm<z.infer<typeof loginSchema>>({ resolver: zodResolver(loginSchema) });

  if (loading) return <FullPageSpinner />;
  if (user) return <Navigate to={from} replace />;

  const onSubmit = handleSubmit(async (v) => {
    setError(null); setUnverified(false);
    try { await signInWithPassword(v.email, v.password); navigate(from, { replace: true }); }
    catch (e) {
      const m = msg(e, "");
      if (/not confirmed/i.test(m)) { setUnverified(true); setError("Confirm your email first. Check your inbox for the verification link."); }
      else if (/invalid login/i.test(m)) setError("Email or password is incorrect.");
      else setError("We couldn't sign you in. Please try again.");
    }
  });

  return (
    <AuthShell title="Sign in" subtitle="Welcome back to TRASHMORPH.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
        <Field label="Password" type={pw.type} trailing={pw.trailing} autoComplete="current-password" error={errors.password?.message} {...register("password")} />
        <div className="text-right text-sm"><Link to="/forgot-password" className="font-semibold text-primary underline">Forgot password?</Link></div>
        <button className="btn-primary w-full" disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in"}</button>
        {unverified && (
          <button type="button" className="btn-outline w-full" onClick={async () => {
            try { await resendVerification(getValues("email")); toast.success("Verification email sent."); } catch (e) { toast.error(msg(e, "Couldn't resend the email.")); }
          }}>Resend verification email</button>
        )}
      </form>
      <OrDivider />
      <GoogleButton label="Continue with Google" />
      <p className="mt-5 text-center text-sm text-muted">New here? <Link to="/register" className="font-semibold text-primary underline">Create an account</Link></p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { user, loading, signUp } = useAuth();
  const pw = usePasswordToggle();
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { register, handleSubmit, watch, formState: { errors, isSubmitting } } = useForm<z.infer<typeof registerSchema>>({ resolver: zodResolver(registerSchema), defaultValues: { accountType: "user", recyclerOrganization: "", recyclerLocation: "", recyclerContact: "" } });
  const accountType = watch("accountType");

  if (loading) return <FullPageSpinner />;
  if (user && !sentTo) return <Navigate to="/dashboard" replace />;
  if (sentTo) return (
    <AuthShell title="Check your email">
      <p>We sent a verification link to <strong>{sentTo}</strong>. Open it to finish creating your account.</p>
      <p className="mt-3 text-sm text-muted">Nothing there? Check spam, or try signing in to request a new link.</p>
      <Link to="/login" className="btn-outline mt-5 w-full">Go to sign in</Link>
    </AuthShell>
  );

  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try { const r = await signUp(v.email, v.password, { fullName: v.fullName, accountType: v.accountType, recyclerOrganization: v.recyclerOrganization, recyclerLocation: v.recyclerLocation, recyclerContact: v.recyclerContact }); if (r === "verify") setSentTo(v.email); }
    catch (e) { setError(msg(e, "We couldn't create your account. Please try again.")); }
  });

  return (
    <AuthShell title="Create your account" subtitle="Choose how you'll use TRASHMORPH.">
      <form onSubmit={onSubmit} noValidate className="space-y-4">
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Full name" autoComplete="name" error={errors.fullName?.message} {...register("fullName")} />
        <fieldset className="space-y-2"><legend className="text-sm font-semibold">I am joining as</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" value="user" className="accent-[rgb(var(--primary))]" {...register("accountType")} /> Household member</label>
          <label className="flex items-center gap-2 text-sm"><input type="radio" value="recycler" className="accent-[rgb(var(--primary))]" {...register("accountType")} /> Recycler or recycling organization</label>
        </fieldset>
        {accountType === "recycler" && <div className="space-y-3 rounded-xl border border-line p-4"><p className="text-sm text-muted">These details help households identify the organization requesting pickup.</p>
          <Field label="Organization name" autoComplete="organization" error={errors.recyclerOrganization?.message} {...register("recyclerOrganization")} />
          <Field label="Organization location" placeholder="City, area, or address" error={errors.recyclerLocation?.message} {...register("recyclerLocation")} />
          <Field label="Contact details" placeholder="Phone, email, or both" error={errors.recyclerContact?.message} {...register("recyclerContact")} />
        </div>}
        <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
        <Field label="Password" type={pw.type} trailing={pw.trailing} autoComplete="new-password" hint="At least 10 characters, with a letter and a number." error={errors.password?.message} {...register("password")} />
        <Field label="Confirm password" type={pw.type} autoComplete="new-password" error={errors.confirm?.message} {...register("confirm")} />
        <div>
          <label className="flex items-start gap-3 text-sm">
            <input type="checkbox" className="mt-1 h-5 w-5 accent-[rgb(var(--primary))]" aria-invalid={!!errors.terms} {...register("terms")} />
            <span>I agree to the <Link to="/terms" className="font-semibold text-primary underline">Terms</Link> and <Link to="/privacy" className="font-semibold text-primary underline">Privacy Policy</Link>.</span>
          </label>
          {errors.terms && <p role="alert" className="mt-1 text-sm text-danger">{errors.terms.message}</p>}
        </div>
        <button className="btn-primary w-full" disabled={isSubmitting}>{isSubmitting ? "Creating account…" : "Create account"}</button>
      </form>
      {accountType === "user" ? <><OrDivider /><GoogleButton label="Sign up with Google" /></> : <p className="mt-4 text-center text-xs text-muted">Recycler accounts need the organization details above, so continue with email and password.</p>}
      <p className="mt-5 text-center text-sm text-muted">Already registered? <Link to="/login" className="font-semibold text-primary underline">Sign in</Link></p>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof emailSchema>>({ resolver: zodResolver(emailSchema) });
  if (sent) return (
    <AuthShell title="Check your email">
      <p>If an account exists for that address, we've sent a link to reset your password.</p>
      <Link to="/login" className="btn-outline mt-5 w-full">Back to sign in</Link>
    </AuthShell>
  );
  return (
    <AuthShell title="Reset your password" subtitle="Enter your email and we'll send you a reset link.">
      <form noValidate className="space-y-4" onSubmit={handleSubmit(async (v) => {
        setError(null);
        try { await resetPassword(v.email); setSent(true); } catch (e) { setError(msg(e, "Couldn't send the reset email. Please try again.")); }
      })}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
        <button className="btn-primary w-full" disabled={isSubmitting}>{isSubmitting ? "Sending…" : "Send reset link"}</button>
      </form>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const { session, loading, updatePassword, signOut } = useAuth();
  const navigate = useNavigate();
  const pw = usePasswordToggle();
  const [error, setError] = useState<string | null>(null);
  const [waited, setWaited] = useState(false);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<z.infer<typeof resetSchema>>({ resolver: zodResolver(resetSchema) });
  useEffect(() => { const t = setTimeout(() => setWaited(true), 2500); return () => clearTimeout(t); }, []);

  if (loading || (!session && !waited)) return <FullPageSpinner />;
  if (!session) return (
    <AuthShell title="Link expired or invalid">
      <p>This password reset link is no longer valid. Request a new one to continue.</p>
      <Link to="/forgot-password" className="btn-primary mt-5 w-full">Request a new link</Link>
    </AuthShell>
  );
  return (
    <AuthShell title="Choose a new password">
      <form noValidate className="space-y-4" onSubmit={handleSubmit(async (v) => {
        setError(null);
        try { await updatePassword(v.password); await signOut(); toast.success("Password updated. Sign in with your new password."); navigate("/login", { replace: true }); }
        catch (e) { setError(msg(e, "Couldn't update your password. Please try again.")); }
      })}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="New password" type={pw.type} trailing={pw.trailing} autoComplete="new-password" hint="At least 10 characters, with a letter and a number." error={errors.password?.message} {...register("password")} />
        <Field label="Confirm new password" type={pw.type} autoComplete="new-password" error={errors.confirm?.message} {...register("confirm")} />
        <button className="btn-primary w-full" disabled={isSubmitting}>{isSubmitting ? "Saving…" : "Update password"}</button>
      </form>
    </AuthShell>
  );
}

// Landing page for email-verification and Google OAuth redirects. supabase-js exchanges the code in the URL.
export function AuthCallbackPage() {
  const { session, loading } = useAuth();
  const [waited, setWaited] = useState(false);
  useEffect(() => { const t = setTimeout(() => setWaited(true), 4000); return () => clearTimeout(t); }, []);
  const params = new URLSearchParams(window.location.search + window.location.hash.replace("#", "&"));
  const urlError = params.get("error_description") ?? params.get("error");

  if (session) return <Navigate to="/dashboard" replace />;
  if (urlError || (!loading && waited)) return (
    <AuthShell title="We couldn't finish signing you in">
      <p>{urlError ? urlError.replace(/\+/g, " ") : "The link may have expired or already been used."}</p>
      <Link to="/login" className="btn-primary mt-5 w-full">Back to sign in</Link>
    </AuthShell>
  );
  return <FullPageSpinner />;
}
