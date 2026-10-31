import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, User } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";
import type { z } from "zod";
import { ErrorNote, Field, PageHeader, Spinner } from "../components/ui";
import { api, type Profile, type Settings } from "../lib/api";
import { profileSchema, recyclerProfileSchema } from "../lib/schemas";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/AuthProvider";
import { useTheme, type Theme } from "../providers/ThemeProvider";

function useProfile() {
  const { user } = useAuth();
  return useQuery({ queryKey: ["profile", user?.id], queryFn: () => api<Profile>("/api/v1/profiles/me"), enabled: !!user });
}

export function ProfilePage() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const { data, isLoading, isError, error } = useProfile();
  const [uploading, setUploading] = useState(false);
  const { register, handleSubmit, reset, formState: { errors, isDirty } } = useForm<z.infer<typeof profileSchema>>({ resolver: zodResolver(profileSchema) });
  const recyclerForm = useForm<z.infer<typeof recyclerProfileSchema>>({ resolver: zodResolver(recyclerProfileSchema), defaultValues: { organization: "", location: "", contact: "" } });
  useEffect(() => { if (data) reset({ full_name: data.full_name ?? "", preferred_location: data.preferred_location ?? "" }); }, [data, reset]);

  const save = useMutation({
    mutationFn: (body: Partial<Profile>) => api<Profile>("/api/v1/profiles/me", { method: "PATCH", body }),
    onSuccess: (p) => { qc.setQueryData(["profile", user?.id], p); toast.success("Profile saved"); },
    onError: (e: Error) => toast.error(e.message),
  });
  const activateRecycler = useMutation({
    mutationFn: (body: z.infer<typeof recyclerProfileSchema>) => api<Profile>("/api/v1/profiles/me/recycler", { method: "POST", body }),
    onSuccess: (p) => { qc.setQueryData(["profile", user?.id], p); void qc.invalidateQueries({ queryKey: ["household-waste-available"] }); toast.success("Recycler profile activated."); },
    onError: (e: Error) => toast.error(e.message),
  });

  async function onAvatar(file: File | undefined) {
    if (!file || !user) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return void toast.error("Choose a JPG, PNG or WebP image.");
    if (file.size > 2 * 1024 * 1024) return void toast.error("Image must be 2 MB or smaller.");
    setUploading(true);
    try {
      const path = `${user.id}/avatar-${Date.now()}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
      await save.mutateAsync({ avatar_url: pub.publicUrl });
    } catch { toast.error("Couldn't upload your photo. Please try again."); }
    finally { setUploading(false); }
  }

  return (
    <>
      <PageHeader title="Your profile" />
      {isError && <ErrorNote>{(error as Error).message}</ErrorNote>}
      {isLoading ? <Spinner /> : (
        <>
        <div className="grid max-w-3xl gap-6 md:grid-cols-[auto_1fr]">
          <div className="flex flex-col items-center gap-3">
            {data?.avatar_url ? <img src={data.avatar_url} alt="Your profile" className="h-28 w-28 rounded-full object-cover" /> : <div className="flex h-28 w-28 items-center justify-center rounded-full bg-subtle"><User className="h-10 w-10 text-muted" aria-hidden /></div>}
            <label className="btn-outline cursor-pointer"><Camera className="h-4 w-4" aria-hidden />{uploading ? "Uploading…" : "Change photo"}
              <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={uploading} onChange={(e) => onAvatar(e.target.files?.[0])} />
            </label>
          </div>
          <form noValidate className="card space-y-4" onSubmit={handleSubmit((v) => save.mutate({ full_name: v.full_name, preferred_location: v.preferred_location || undefined }))}>
            <Field label="Full name" autoComplete="name" error={errors.full_name?.message} {...register("full_name")} />
            <Field label="Email" value={data?.email ?? ""} readOnly hint="Your sign-in email can't be changed here." />
            <Field label="Preferred location" placeholder="City or neighbourhood" error={errors.preferred_location?.message} {...register("preferred_location")} />
            <button className="btn-primary" disabled={!isDirty || save.isPending}>{save.isPending ? "Saving…" : "Save changes"}</button>
          </form>
        </div>
        {data?.role === "recycler" ? <section className="card mt-6 max-w-3xl"><p className="badge">Recycler account</p><h2 className="mt-3 text-xl font-semibold">Organization details</h2><dl className="mt-3 grid gap-3 sm:grid-cols-2"><div><dt className="text-sm text-muted">Organization</dt><dd className="font-semibold">{data.recycler_organization}</dd></div><div><dt className="text-sm text-muted">Location</dt><dd className="font-semibold">{data.recycler_location}</dd></div><div><dt className="text-sm text-muted">Contact</dt><dd className="font-semibold">{data.recycler_contact}</dd></div></dl></section> : data?.role === "user" ? <section className="card mt-6 max-w-3xl"><h2 className="text-xl font-semibold">Recycler profile</h2><p className="mt-1 text-sm text-muted">If you collect household waste as an organization, add your details to access household pickup logs.</p><form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={recyclerForm.handleSubmit((v) => activateRecycler.mutate(v))}><Field label="Organization name" error={recyclerForm.formState.errors.organization?.message} {...recyclerForm.register("organization")} /><Field label="Organization location" error={recyclerForm.formState.errors.location?.message} {...recyclerForm.register("location")} /><Field label="Contact number or email" error={recyclerForm.formState.errors.contact?.message} {...recyclerForm.register("contact")} /><button className="btn-primary sm:col-span-2" disabled={activateRecycler.isPending}>{activateRecycler.isPending ? "Saving…" : "Activate recycler profile"}</button></form></section> : <section className="card mt-6 max-w-3xl"><h2 className="font-semibold">Account type</h2><p className="mt-1 text-muted">Administrator</p></section>}
        </>
      )}
    </>
  );
}

export function SettingsPage() {
  const { user, signOut, resetPassword } = useAuth();
  const { theme, setTheme } = useTheme();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const settings = useQuery({ queryKey: ["settings", user?.id], queryFn: () => api<Settings>("/api/v1/settings/me"), enabled: !!user });
  const update = useMutation({
    mutationFn: (body: Partial<Settings>) => api<Settings>("/api/v1/settings/me", { method: "PUT", body }),
    onSuccess: (s) => qc.setQueryData(["settings", user?.id], s),
    onError: (e: Error) => toast.error(e.message),
  });
  const [confirm, setConfirm] = useState("");
  const [deleting, setDeleting] = useState(false);

  // Adopt the saved theme on a new device (local storage still wins on this device until changed).
  useEffect(() => { if (settings.data && localStorage.getItem("trashmorph-theme") === null) setTheme(settings.data.theme); }, [settings.data, setTheme]);

  const prefs = settings.data?.notification_preferences;
  const pickTheme = (t: Theme) => { setTheme(t); update.mutate({ theme: t }); };

  async function deleteAccount() {
    setDeleting(true);
    try {
      await api("/api/v1/profiles/me", { method: "DELETE", body: { confirm: "DELETE" } });
      await supabase.auth.signOut({ scope: "local" });
      toast.success("Your account was deleted.");
      navigate("/", { replace: true });
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't delete your account."); setDeleting(false); }
  }

  return (
    <>
      <PageHeader title="Settings" />
      <div className="max-w-2xl space-y-6">
        <section className="card" aria-labelledby="appearance">
          <h2 id="appearance" className="font-semibold">Appearance</h2>
          <div role="radiogroup" aria-label="Theme" className="mt-3 flex flex-wrap gap-2">
            {(["light", "dark", "system"] as Theme[]).map((t) => (
              <button key={t} role="radio" aria-checked={theme === t} onClick={() => pickTheme(t)} className={theme === t ? "btn-primary capitalize" : "btn-outline capitalize"}>{t}</button>
            ))}
          </div>
        </section>

        <section className="card" aria-labelledby="notif">
          <h2 id="notif" className="font-semibold">Notifications</h2>
          {settings.isError && <ErrorNote>{(settings.error as Error).message}</ErrorNote>}
          {settings.isLoading ? <p className="mt-3"><Spinner /></p> : prefs && (
            <div className="mt-3 space-y-3">
              <label className="flex items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={prefs.in_app} onChange={(e) => update.mutate({ notification_preferences: { ...prefs, in_app: e.target.checked } })} />In-app notifications</label>
              <label className="flex items-center gap-3"><input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={prefs.email} onChange={(e) => update.mutate({ notification_preferences: { ...prefs, email: e.target.checked } })} />Email notifications</label>
              <p className="text-sm text-muted">Email delivery isn't set up yet, so this preference is saved but no emails are sent.</p>
            </div>
          )}
        </section>

        <section className="card" aria-labelledby="security">
          <h2 id="security" className="font-semibold">Password</h2>
          <p className="mt-2 text-sm text-muted">We'll email a link to {user?.email} so you can choose a new password.</p>
          <button className="btn-outline mt-3" onClick={async () => { try { await resetPassword(user!.email!); toast.success("Reset link sent."); } catch { toast.error("Couldn't send the reset email."); } }}>Send reset link</button>
        </section>

        <section className="card" aria-labelledby="privacy">
          <h2 id="privacy" className="font-semibold">Privacy</h2>
          <p className="mt-2 text-sm text-muted">Your profile photo is stored publicly so it can display. Location is only used if you enter a preferred location; we don't track your device location. Read the <Link to="/privacy" className="font-semibold text-primary underline">Privacy Policy</Link>.</p>
          <button className="btn-outline mt-3" onClick={async () => { await signOut(); navigate("/", { replace: true }); }}>Sign out</button>
        </section>

        <section className="card" aria-labelledby="a11y">
          <h2 id="a11y" className="font-semibold">Accessibility</h2>
          <p className="mt-2 text-sm text-muted">Every control works with the keyboard and shows a visible focus ring. Animations are minimised automatically if your device is set to reduce motion, and text and colours are checked for contrast in both light and dark themes. Use your browser's zoom or your device's text size to enlarge text.</p>
        </section>

        <section className="card border-danger/50" aria-labelledby="danger">
          <h2 id="danger" className="font-semibold text-danger">Delete account</h2>
          <p className="mt-2 text-sm text-muted">This permanently deletes your account, profile, settings and uploaded photo. It can't be undone.</p>
          <Field label='Type DELETE to confirm' value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="off" />
          <button className="btn-danger mt-3" disabled={confirm !== "DELETE" || deleting} onClick={deleteAccount}>{deleting ? "Deleting…" : "Delete my account"}</button>
        </section>
      </div>
    </>
  );
}
