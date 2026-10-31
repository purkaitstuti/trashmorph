import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Heart, MapPin, Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import type { z } from "zod";
import { RequestCollectionForm } from "./collections";
import { EmptyState, ListingCard, Pagination } from "../components/listing";
import { ErrorNote, Field, FullPageSpinner, PageHeader, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { CATEGORIES, CONDITIONS, NEXT_ACTIONS, REPORT_REASONS, SORTS, STATUS_LABEL, TYPES, UNITS, categoryLabel, conditionLabel, priceLabel, timeAgo, type Listing, type ListingDetail, type Page } from "../lib/listings";
import { getPosition, reverseGeocode } from "../lib/geo";
import { listingSchema } from "../lib/schemas";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/AuthProvider";

const FILTER_KEYS = ["q", "category", "listing_type", "max_price", "location", "sort"] as const;
const PAGE_SIZE = 12;
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

function ListGrid({ q, showStatus }: { q: { data?: Page<Listing>; isLoading: boolean; isError: boolean; error: unknown; refetch: () => void }; showStatus?: boolean }) {
  if (q.isLoading) return <p><Spinner /></p>;
  if (q.isError) return <div className="space-y-2"><ErrorNote>{errText(q.error)}</ErrorNote><button className="btn-outline" onClick={() => q.refetch()}>Try again</button></div>;
  return <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{q.data!.items.map((l) => <ListingCard key={l.id} l={l} showStatus={showStatus} />)}</div>;
}

export function MarketplacePage() {
  const { user } = useAuth();
  const profile = useQuery({ queryKey: ["profile", user?.id], queryFn: () => api<{ role: string }>("/api/v1/profiles/me"), enabled: !!user });
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const qs = new URLSearchParams();
  FILTER_KEYS.forEach((k) => { const v = params.get(k); if (v) qs.set(k, v); });
  qs.set("page", String(page)); qs.set("page_size", String(PAGE_SIZE));
  const query = useQuery({ queryKey: ["listings", qs.toString(), user?.id ?? "guest"], queryFn: () => api<Page<Listing>>(`/api/v1/listings?${qs}`) });
  const filtered = FILTER_KEYS.some((k) => params.get(k));

  return (
    <>
      <PageHeader title="Marketplace">{profile.data?.role === "recycler" ? "Household listings available for collection or reuse." : "Reusable items and recyclable materials from people nearby."} Contact sellers through an inquiry; TRASHMORPH doesn't process payments.</PageHeader>
      <form key={params.toString()} className="card mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget); const next = new URLSearchParams();
        FILTER_KEYS.forEach((k) => { const v = String(f.get(k) ?? "").trim(); if (v) next.set(k, v); });
        setParams(next);
      }}>
        <Field label="Search" name="q" defaultValue={params.get("q") ?? ""} placeholder="e.g. glass jars" />
        <Select label="Category" name="category" defaultValue={params.get("category") ?? ""} options={CATEGORIES} placeholder="All categories" />
        <Select label="Type" name="listing_type" defaultValue={params.get("listing_type") ?? ""} options={TYPES} placeholder="Any" />
        <Field label="Location" name="location" defaultValue={params.get("location") ?? ""} placeholder="City or area" />
        <Field label="Max price" name="max_price" type="number" min="0" step="0.01" defaultValue={params.get("max_price") ?? ""} hint="Free and exchange items are included." />
        <Select label="Sort by" name="sort" defaultValue={params.get("sort") ?? "newest"} options={SORTS} />
        <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><button className="btn-primary">Apply filters</button>{filtered && <button type="button" className="btn-outline" onClick={() => setParams(new URLSearchParams())}>Clear</button>}</div>
      </form>
      {query.data && query.data.items.length === 0 ? (
        <EmptyState title={filtered ? "No listings match your filters" : "No listings yet"}>
          {filtered ? "Try removing a filter or searching a wider area." : "Be the first to share something reusable."}
          <div className="mt-4"><Link to={user ? "/my-listings/new" : "/register"} className="btn-primary">{user ? "Create a listing" : "Create an account"}</Link></div>
        </EmptyState>
      ) : <ListGrid q={query} />}
      {query.data && <Pagination page={page} total={query.data.total} pageSize={PAGE_SIZE} onPage={(p) => { const n = new URLSearchParams(params); n.set("page", String(p)); setParams(n); window.scrollTo({ top: 0 }); }} />}
    </>
  );
}

export function ListingDetailPage() {
  const { id = "" } = useParams();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [img, setImg] = useState(0);
  const [msg, setMsg] = useState(""); const [contact, setContact] = useState(""); const [msgErr, setMsgErr] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false); const [reason, setReason] = useState("spam"); const [details, setDetails] = useState("");
  const q = useQuery({ queryKey: ["listing", id, user?.id], queryFn: () => api<ListingDetail>(`/api/v1/listings/${id}`), retry: false });
  const refresh = () => qc.invalidateQueries({ queryKey: ["listing", id] });

  const fav = useMutation({
    mutationFn: (on: boolean) => api(`/api/v1/listings/${id}/favorite`, { method: on ? "PUT" : "DELETE" }),
    onSuccess: refresh, onError: (e) => toast.error(errText(e)),
  });
  const inquire = useMutation({
    mutationFn: () => api(`/api/v1/listings/${id}/inquiries`, { method: "POST", body: { message: msg, reply_contact: contact || undefined } }),
    onSuccess: () => { toast.success("Inquiry sent"); refresh(); }, onError: (e) => setMsgErr(errText(e)),
  });
  const report = useMutation({
    mutationFn: () => api(`/api/v1/listings/${id}/report`, { method: "POST", body: { reason, details: details || undefined } }),
    onSuccess: () => { toast.success("Thanks, we received your report"); setReporting(false); }, onError: (e) => toast.error(errText(e)),
  });

  if (q.isLoading) return <FullPageSpinner />;
  if (q.isError || !q.data) return <EmptyState title="Listing not found">It may have been removed or is no longer available.<div className="mt-4"><Link to="/marketplace" className="btn-primary">Back to marketplace</Link></div></EmptyState>;
  const l = q.data;
  const canContact = l.status === "active" && !l.is_owner;

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        {l.images.length ? (
          <>
            <img src={l.images[img] ?? l.images[0]} alt={l.title} className="aspect-[4/3] w-full rounded-xl border border-line object-cover" />
            {l.images.length > 1 && <div className="mt-2 flex gap-2 overflow-x-auto">{l.images.map((u, i) => <button key={u} onClick={() => setImg(i)} aria-label={`Show photo ${i + 1}`} className={`shrink-0 overflow-hidden rounded-lg border-2 ${i === img ? "border-primary" : "border-transparent"}`}><img src={u} alt="" className="h-16 w-16 object-cover" /></button>)}</div>}
          </>
        ) : <div className="flex aspect-[4/3] items-center justify-center rounded-xl bg-subtle text-muted">No photos</div>}
      </div>
      <div>
        <div className="flex flex-wrap items-center gap-2"><span className="badge">{categoryLabel(l.category)}</span><span className="badge">{STATUS_LABEL[l.status] ?? l.status}</span></div>
        <h1 className="mt-2 text-3xl font-bold">{l.title}</h1>
        <p className="mt-1 font-display text-2xl font-bold text-primary">{priceLabel(l)}</p>
        {l.description && <p className="mt-4 whitespace-pre-line text-muted">{l.description}</p>}
        <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div><dt className="text-muted">Quantity</dt><dd>{l.quantity} {l.unit}</dd></div>
          <div><dt className="text-muted">Condition</dt><dd>{conditionLabel(l.condition)}</dd></div>
          <div><dt className="text-muted">Location</dt><dd>{l.location_label}</dd></div>
          <div><dt className="text-muted">Listed</dt><dd>{timeAgo(l.created_at)}</dd></div>
        </dl>
        <p className="mt-4 flex items-center gap-2 text-sm">Listed by {l.seller?.avatar_url && <img src={l.seller.avatar_url} alt="" className="h-6 w-6 rounded-full object-cover" />}<strong>{l.seller?.full_name || "A TRASHMORPH member"}</strong></p>

        {l.is_owner && <div className="mt-6"><Link to="/my-listings" className="btn-outline">Manage your listings</Link>{["draft", "active"].includes(l.status) && <Link to={`/my-listings/${l.id}/edit`} className="btn-primary ml-2">Edit</Link>}</div>}
        {!user && <p className="mt-6"><Link to="/login" state={{ from: `/marketplace/${l.id}` }} className="btn-primary">Sign in to contact the lister</Link></p>}

        {user && canContact && (
          <div className="mt-6 space-y-4">
            <button className={l.is_favorite ? "btn-primary" : "btn-outline"} aria-pressed={l.is_favorite} disabled={fav.isPending} onClick={() => fav.mutate(!l.is_favorite)}><Heart className="h-4 w-4" aria-hidden />{l.is_favorite ? "Saved" : "Save listing"}</button>
            {l.has_inquired ? <p className="card">You've sent an inquiry about this listing. The lister will see it in their inbox.</p> : (
              <form className="card space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); setMsgErr(null); if (msg.trim().length < 10) return setMsgErr("Write at least 10 characters."); inquire.mutate(); }}>
                <h2 className="font-semibold">Send an inquiry</h2>
                {msgErr && <ErrorNote>{msgErr}</ErrorNote>}
                <div><label htmlFor="msg" className="mb-1 block text-sm font-semibold">Message</label><textarea id="msg" rows={4} className="input" maxLength={1000} value={msg} onChange={(e) => setMsg(e.target.value)} /></div>
                <Field label="How should they reach you? (optional)" value={contact} maxLength={120} onChange={(e) => setContact(e.target.value)} hint="Only share contact details you're comfortable with. The lister sees this text." />
                <button className="btn-primary" disabled={inquire.isPending}>{inquire.isPending ? "Sending…" : "Send inquiry"}</button>
              </form>
            )}
            <RequestCollectionForm listing={l} />
            <p className="text-sm text-muted">Meet in a public place and inspect items before accepting. No payments are processed here.</p>
            {!reporting ? <button className="text-sm font-semibold text-muted underline" onClick={() => setReporting(true)}>Report this listing</button> : (
              <form className="card space-y-3" onSubmit={(e) => { e.preventDefault(); report.mutate(); }}>
                <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={REPORT_REASONS} />
                <Field label="Details (optional)" value={details} maxLength={500} onChange={(e) => setDetails(e.target.value)} />
                <div className="flex gap-2"><button className="btn-primary" disabled={report.isPending}>Submit report</button><button type="button" className="btn-outline" onClick={() => setReporting(false)}>Cancel</button></div>
              </form>
            )}
          </div>
        )}
        {user && !l.is_owner && l.status !== "active" && <p className="card mt-6">This listing isn't accepting inquiries right now.</p>}
      </div>
    </div>
  );
}

export function MyListingsPage() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["my-listings", status, page], queryFn: () => api<Page<Listing>>(`/api/v1/listings/mine?page=${page}&page_size=20${status ? `&status=${status}` : ""}`) });
  const invalidate = () => { qc.invalidateQueries({ queryKey: ["my-listings"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const change = useMutation({ mutationFn: (v: { id: string; status: string }) => api(`/api/v1/listings/${v.id}/status`, { method: "POST", body: { status: v.status } }), onSuccess: () => { toast.success("Listing updated"); invalidate(); }, onError: (e) => toast.error(errText(e)) });
  const del = useMutation({ mutationFn: (id: string) => api(`/api/v1/listings/${id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Listing deleted"); invalidate(); }, onError: (e) => toast.error(errText(e)) });
  const busy = change.isPending || del.isPending;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><PageHeader title="My listings" /><Link to="/my-listings/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden />New listing</Link></div>
      <div className="mb-4 max-w-xs"><Select label="Filter by status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} options={Object.entries(STATUS_LABEL)} placeholder="All statuses" /></div>
      {q.isLoading && <Spinner />}
      {q.isError && <div className="space-y-2"><ErrorNote>{errText(q.error)}</ErrorNote><button className="btn-outline" onClick={() => q.refetch()}>Try again</button></div>}
      {q.data && q.data.items.length === 0 && <EmptyState title="No listings here yet">Share something reusable or recyclable to get started.<div className="mt-4"><Link to="/my-listings/new" className="btn-primary">Create a listing</Link></div></EmptyState>}
      <ul className="space-y-3">
        {q.data?.items.map((l) => (
          <li key={l.id} className="card flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0"><Link to={`/marketplace/${l.id}`} className="font-semibold hover:underline">{l.title}</Link><p className="text-sm text-muted"><span className="badge mr-2">{STATUS_LABEL[l.status]}</span>{categoryLabel(l.category)} · {priceLabel(l)} · {timeAgo(l.created_at)}</p></div>
            <div className="flex flex-wrap gap-2">
              {["draft", "active"].includes(l.status) && <Link to={`/my-listings/${l.id}/edit`} className="btn-outline">Edit</Link>}
              {NEXT_ACTIONS[l.status]?.map(([to, label]) => <button key={to} className="btn-outline" disabled={busy} onClick={() => change.mutate({ id: l.id, status: to })}>{label}</button>)}
              {["draft", "cancelled"].includes(l.status) && <button className="btn-outline" disabled={busy} aria-label={`Delete ${l.title}`} onClick={() => window.confirm("Delete this listing permanently?") && del.mutate(l.id)}><Trash2 className="h-4 w-4" aria-hidden /></button>}
            </div>
          </li>
        ))}
      </ul>
      {q.data && <Pagination page={page} total={q.data.total} pageSize={20} onPage={setPage} />}
    </>
  );
}

type FormValues = z.infer<typeof listingSchema>;

export function ListingFormPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const editing = !!id;
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const existing = useQuery({ queryKey: ["listing", id, user?.id], queryFn: () => api<ListingDetail>(`/api/v1/listings/${id}`), enabled: editing });
  const [kept, setKept] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FormValues>({ resolver: zodResolver(listingSchema), defaultValues: { listing_type: "free", unit: "items", category: CATEGORIES.some(([k]) => k === search.get("category")) ? search.get("category")! : "", condition: "" } });
  const type = watch("listing_type");

  useEffect(() => {
    const l = existing.data;
    if (!l) return;
    reset({ title: l.title, description: l.description ?? "", category: l.category, quantity: String(l.quantity), unit: l.unit, condition: l.condition, listing_type: l.listing_type, price: l.price != null ? String(l.price) : "", location_label: l.location_label });
    setKept(l.images);
    if (l.latitude != null && l.longitude != null) setCoords({ latitude: l.latitude, longitude: l.longitude });
  }, [existing.data, reset]);

  function addFiles(list: FileList | null) {
    const picked = Array.from(list ?? []);
    for (const f of picked) {
      if (!["image/jpeg", "image/png", "image/webp"].includes(f.type)) return void toast.error("Photos must be JPG, PNG or WebP.");
      if (f.size > 3 * 1024 * 1024) return void toast.error("Each photo must be 3 MB or smaller.");
    }
    if (kept.length + files.length + picked.length > 5) return void toast.error("You can add up to 5 photos.");
    setFiles((f) => [...f, ...picked]);
  }

  async function fillFromLocation() {
    setLocating(true);
    try {
      const p = await getPosition();
      setCoords({ latitude: p.lat, longitude: p.lng });
      const label = await reverseGeocode(p.lat, p.lng);
      if (label) { setValue("location_label", label, { shouldValidate: true, shouldDirty: true }); toast.success("Location added"); }
      else toast("Coordinates saved, but we couldn't find a place name. Please type it in.");
    } catch (e) { toast.error(errText(e)); } finally { setLocating(false); }
  }

  async function submit(v: FormValues, status: "draft" | "active") {
    if (!user) return;
    setError(null); setBusy(true);
    try {
      const urls: string[] = [];
      for (const f of files) {
        const ext = f.type === "image/png" ? "png" : f.type === "image/webp" ? "webp" : "jpg";
        const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("listing-images").upload(path, f, { contentType: f.type });
        if (upErr) throw new Error("A photo couldn't be uploaded. Please try again.");
        urls.push(supabase.storage.from("listing-images").getPublicUrl(path).data.publicUrl);
      }
      const body = {
        title: v.title, description: v.description || null, category: v.category, quantity: Number(v.quantity), unit: v.unit, condition: v.condition,
        listing_type: v.listing_type, price: v.listing_type === "price" ? Number(v.price) : null, location_label: v.location_label,
        latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null, images: [...kept, ...urls],
      };
      const saved = editing ? await api<Listing>(`/api/v1/listings/${id}`, { method: "PATCH", body }) : await api<Listing>("/api/v1/listings", { method: "POST", body: { ...body, status } });
      await qc.invalidateQueries({ queryKey: ["my-listings"] });
      toast.success(editing ? "Listing saved" : status === "active" ? "Listing published" : "Draft saved");
      navigate(`/marketplace/${saved.id}`);
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  }

  if (editing && existing.isLoading) return <FullPageSpinner />;
  if (editing && (existing.isError || (existing.data && !existing.data.is_owner))) return <EmptyState title="You can't edit this listing">It doesn't exist or belongs to someone else.</EmptyState>;

  return (
    <>
      <PageHeader title={editing ? "Edit listing" : "New listing"} />
      <form noValidate className="card max-w-2xl space-y-4" onSubmit={(e) => e.preventDefault()}>
        {error && <ErrorNote>{error}</ErrorNote>}
        <Field label="Title" error={errors.title?.message} {...register("title")} />
        <div><label htmlFor="description" className="mb-1 block text-sm font-semibold">Description (optional)</label><textarea id="description" rows={4} className="input" {...register("description")} /></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Category" options={CATEGORIES} placeholder="Choose…" error={errors.category?.message} {...register("category")} />
          <Select label="Condition" options={CONDITIONS} placeholder="Choose…" error={errors.condition?.message} {...register("condition")} />
          <Field label="Quantity" type="number" inputMode="decimal" min="0" step="any" error={errors.quantity?.message} {...register("quantity")} />
          <Select label="Unit" options={UNITS} {...register("unit")} />
          <Select label="Offer type" options={TYPES} {...register("listing_type")} />
          {type === "price" && <Field label="Price" type="number" inputMode="decimal" min="0" step="0.01" error={errors.price?.message} {...register("price")} />}
        </div>
        <Field label="Location" placeholder="City or neighbourhood" error={errors.location_label?.message} {...register("location_label")} />
        <div className="text-sm">
          <button type="button" className="btn-outline" disabled={locating} onClick={fillFromLocation}><MapPin className="h-4 w-4" aria-hidden />{locating ? "Finding your location…" : "Use my current location"}</button>
          <p className="mt-1 text-muted">{coords ? `Saved coordinates: ${coords.latitude}, ${coords.longitude}. The location box above was filled in for you; edit it if needed.` : "Fills in the location box and saves coordinates so the listing can appear on maps. Your browser asks permission first, and OpenStreetMap is used to look up the place name."}{coords && <button type="button" className="ml-2 font-semibold underline" onClick={() => setCoords(null)}>Remove</button>}</p>
        </div>
        <div>
          <p className="mb-1 text-sm font-semibold">Photos (up to 5)</p>
          <div className="flex flex-wrap gap-2">
            {kept.map((u) => <div key={u} className="relative"><img src={u} alt="" className="h-20 w-20 rounded-lg object-cover" /><button type="button" aria-label="Remove photo" className="absolute -right-2 -top-2 rounded-full bg-danger px-2 text-white" onClick={() => setKept(kept.filter((k) => k !== u))}>×</button></div>)}
            {files.map((f, i) => <div key={i} className="relative"><img src={URL.createObjectURL(f)} alt="" className="h-20 w-20 rounded-lg object-cover" /><button type="button" aria-label="Remove photo" className="absolute -right-2 -top-2 rounded-full bg-danger px-2 text-white" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button></div>)}
          </div>
          <label className="btn-outline mt-2 cursor-pointer">Add photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} /></label>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          {editing ? <button className="btn-primary" disabled={busy} onClick={handleSubmit((v) => submit(v, "active"))}>{busy ? "Saving…" : "Save changes"}</button> : <>
            <button className="btn-primary" disabled={busy} onClick={handleSubmit((v) => submit(v, "active"))}>{busy ? "Saving…" : "Publish"}</button>
            <button className="btn-outline" disabled={busy} onClick={handleSubmit((v) => submit(v, "draft"))}>Save as draft</button></>}
          <Link to="/my-listings" className="btn-outline">Cancel</Link>
        </div>
      </form>
    </>
  );
}

export function SavedPage() {
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["favorites", page], queryFn: () => api<Page<Listing>>(`/api/v1/favorites?page=${page}&page_size=12`) });
  return (
    <>
      <PageHeader title="Saved listings" />
      {q.data && q.data.items.length === 0 ? <EmptyState title="Nothing saved yet">Save listings from the marketplace to find them here.<div className="mt-4"><Link to="/marketplace" className="btn-primary">Browse marketplace</Link></div></EmptyState> : <ListGrid q={q} />}
      {q.data && <Pagination page={page} total={q.data.total} pageSize={12} onPage={setPage} />}
    </>
  );
}
