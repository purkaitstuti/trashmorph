import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, LineElement, PointElement, Tooltip } from "chart.js";
import { ExternalLink, LocateFixed, MapPin, Plus, Search } from "lucide-react";
import { lazy, Suspense, useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Doughnut, Line } from "react-chartjs-2";
import { EmptyState } from "../components/listing";
import { ErrorNote, Field, PageHeader, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { forwardGeocode, getPosition, reverseGeocode } from "../lib/geo";
import { FOOD_CATEGORIES, FOOD_STATUS, FOOD_UNITS, foodCategoryLabel, foodDirectionsUrl, ORG_TYPES, type FoodDonation, type FoodOrganization } from "../lib/foodRescue";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/AuthProvider";

ChartJS.register(ArcElement, BarElement, CategoryScale, Legend, LineElement, LinearScale, PointElement, Tooltip);
const FoodOrganizationMap = lazy(() => import("../components/Map").then((m) => ({ default: m.FoodOrganizationMap })));
const LocationPicker = lazy(() => import("../components/Map").then((m) => ({ default: m.LocationPicker })));
type Point = { lat: number; lng: number };
type Page<T> = { items: T[]; total: number };
const errorText = (e: unknown) => e instanceof Error ? e.message : "Something went wrong.";
const RADII: [string, string][] = [["5", "5 km"], ["10", "10 km"], ["25", "25 km"], ["50", "50 km"], ["100", "100 km"]];
const dt = (d: Date) => { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); };
const futureDefault = () => { const d = new Date(); d.setHours(d.getHours() + 4); return dt(d); };

function OrganizationCard({ org }: { org: FoodOrganization }) {
  return <article className="card">
    <div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-lg font-semibold">{org.name}</h3><div className="flex flex-wrap gap-2">{org.distance_km != null && <span className="badge">{org.distance_km} km away</span>}<span className={`badge ${org.verification_status === "needs_review" ? "border border-amber-500/50 text-amber-800 dark:text-amber-300" : ""}`}>{org.verification_status === "needs_review" ? "Needs review" : "Details reviewed"}</span></div></div>
    <p className="text-sm text-muted">{ORG_TYPES[org.organization_type] ?? org.organization_type}</p>
    <p className="mt-2 flex items-start gap-1 text-sm text-muted"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{org.address}</p>
    {org.contact_number && <p className="mt-2 text-sm">Phone: <a className="underline" href={`tel:${org.contact_number}`}>{org.contact_number}</a></p>}
    {org.website && <p className="mt-1 text-sm"><a className="inline-flex items-center gap-1 underline" href={org.website} target="_blank" rel="noopener noreferrer">Website<ExternalLink className="h-3 w-3" aria-hidden /></a></p>}
    {org.operating_hours && <p className="mt-2 text-sm text-muted">Hours: {org.operating_hours}</p>}
    {org.donation_requirements && <p className="mt-2 text-sm">Donation requirements: {org.donation_requirements}</p>}
    <p className="mt-3 text-xs text-muted">{org.verification_status === "needs_review" ? "This directory entry has not yet been reviewed by TRASHMORPH. Confirm the organization and all details independently." : "TRASHMORPH has reviewed the directory details, but this does not mean the organization has agreed to accept food."} Contact the organization to confirm availability, eligibility, and collection arrangements.</p>
    <a href={foodDirectionsUrl(org)} target="_blank" rel="noopener noreferrer" className="btn-outline mt-3">Directions<ExternalLink className="h-4 w-4" aria-hidden /></a>
  </article>;
}

function DonationCard({ donation, mine = false, onChanged }: { donation: FoodDonation; mine?: boolean; onChanged?: () => void }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState("unsafe_food");
  const [details, setDetails] = useState("");
  const [outcome, setOutcome] = useState(false);
  const [orgId, setOrgId] = useState("");
  const [qty, setQty] = useState(String(donation.quantity));
  const [donatedDate, setDonatedDate] = useState(new Date().toISOString().slice(0, 10));
  const orgs = useQuery({ queryKey: ["food-organizations", "all"], queryFn: () => api<{ items: FoodOrganization[] }>("/api/v1/food-rescue/organizations") });
  const report = useMutation({ mutationFn: () => api(`/api/v1/food-rescue/donations/${donation.id}/report`, { method: "POST", body: { reason, details: details || undefined } }), onSuccess: () => { toast.success("Thanks. Your report was received."); setReporting(false); }, onError: (e) => toast.error(errorText(e)) });
  const mark = useMutation({ mutationFn: (status: "donated" | "cancelled") => api(`/api/v1/food-rescue/donations/${donation.id}/outcome`, { method: "POST", body: { status, ...(status === "donated" ? { organization_id: orgId || undefined, reported_quantity: Number(qty), donated_at: donatedDate } : {}) } }), onSuccess: () => { toast.success("Donation record updated."); void qc.invalidateQueries({ queryKey: ["food-donations"] }); void qc.invalidateQueries({ queryKey: ["food-dashboard"] }); onChanged?.(); }, onError: (e) => toast.error(errorText(e)) });
  const remove = useMutation({ mutationFn: () => api(`/api/v1/food-rescue/donations/${donation.id}`, { method: "DELETE" }), onSuccess: () => { toast.success("Listing removed."); void qc.invalidateQueries({ queryKey: ["food-donations"] }); onChanged?.(); }, onError: (e) => toast.error(errorText(e)) });
  return <article className="card overflow-hidden !p-0">
    {donation.photo_url && <img src={donation.photo_url} alt="" loading="lazy" className="h-40 w-full object-cover" />}
    <div className="p-5"><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="text-lg font-semibold">{donation.title}</h3><span className="badge">{FOOD_STATUS[donation.status] ?? donation.status}</span></div>
      <p className="mt-1 text-sm text-muted">{foodCategoryLabel(donation.food_category)} · {donation.quantity} {donation.unit}</p>
      <p className="mt-1 text-sm text-muted">Pickup: {donation.location_label} · by {new Date(donation.pickup_deadline).toLocaleString()}</p>
      {donation.description && <p className="mt-3 text-sm">{donation.description}</p>}
      <div className="mt-3 space-y-1 text-sm"><p><strong>Prepared:</strong> {new Date(donation.prepared_at).toLocaleString()}</p><p><strong>Storage:</strong> {donation.storage_conditions}</p><p><strong>Allergens:</strong> {donation.allergens.length ? donation.allergens.join(", ") : "None listed"}</p></div>
      {donation.status === "donated" && <p className="mt-3 rounded-lg bg-subtle p-3 text-sm">Donor-reported handover: {donation.reported_quantity} {donation.unit} on {donation.donated_at}. This outcome has not been independently verified.</p>}
      {mine && donation.status === "available" && new Date(donation.pickup_deadline) > new Date() && <div className="mt-4 space-y-3 border-t border-line pt-4">
        {!outcome ? <div className="flex flex-wrap gap-2"><Link to={`/food-rescue/${donation.id}/edit`} className="btn-outline">Edit listing</Link><button className="btn-primary" onClick={() => setOutcome(true)}>Record outcome</button></div> : <div className="space-y-3 rounded-lg bg-subtle p-3">
          <p className="font-semibold">Record donor-reported handover</p><Select label="Organization (optional)" value={orgId} onChange={(e) => setOrgId(e.target.value)} options={(orgs.data?.items ?? []).map((o) => [o.id, o.name] as [string, string])} placeholder="Not listed / prefer not to say" />
          <Field label={`Quantity handed over (${donation.unit})`} type="number" min="0.01" max={donation.quantity} step="any" value={qty} onChange={(e) => setQty(e.target.value)} />
          <Field label="Date handed over" type="date" max={new Date().toISOString().slice(0, 10)} value={donatedDate} onChange={(e) => setDonatedDate(e.target.value)} />
          <div className="flex gap-2"><button className="btn-primary" disabled={mark.isPending} onClick={() => mark.mutate("donated")}>Confirm donated</button><button className="btn-outline" onClick={() => setOutcome(false)}>Back</button></div>
        </div>}
        <div className="flex flex-wrap gap-2"><button className="btn-outline" onClick={() => mark.mutate("cancelled")}>Cancel listing</button></div>
      </div>}
      {mine && donation.status !== "donated" && !(donation.status === "available" && new Date(donation.pickup_deadline) > new Date()) && <div className="mt-4 border-t border-line pt-4"><button className="btn-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>Remove listing</button></div>}
      {mine && donation.status === "available" && new Date(donation.pickup_deadline) > new Date() && <div className="mt-2"><button className="btn-danger" onClick={() => remove.mutate()} disabled={remove.isPending}>Remove listing</button></div>}
      {!mine && <div className="mt-4 border-t border-line pt-3">{user ? (!reporting ? <button className="text-sm font-semibold text-muted underline" onClick={() => setReporting(true)}>Report unsafe or misleading listing</button> : <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); report.mutate(); }}>
        <Select label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} options={[["unsafe_food", "Food safety concern"], ["misleading", "Misleading details"], ["other", "Other"]]} />
        <textarea className="input" rows={2} maxLength={1000} placeholder="Details (optional)" value={details} onChange={(e) => setDetails(e.target.value)} />
        <div className="flex gap-2"><button className="btn-primary" disabled={report.isPending}>Send report</button><button type="button" className="btn-outline" onClick={() => setReporting(false)}>Cancel</button></div>
      </form>) : <Link className="text-sm font-semibold underline" to="/login">Sign in to report a listing</Link>}</div>}
    </div>
  </article>;
}

export function FoodRescuePage() {
  const { user } = useAuth();
  const [center, setCenter] = useState<Point | null>(null); const [radius, setRadius] = useState("25"); const [place, setPlace] = useState("");
  const [search, setSearch] = useState(""); const [orgType, setOrgType] = useState(""); const [view, setView] = useState<"map" | "list">("map"); const [busy, setBusy] = useState(false); const [tab, setTab] = useState<"organizations" | "food">("organizations");
  const qs = new URLSearchParams({ radius_km: radius, ...(center ? { lat: String(center.lat), lng: String(center.lng) } : {}), ...(search ? { q: search } : {}), ...(orgType ? { organization_type: orgType } : {}) });
  const orgs = useQuery({ queryKey: ["food-organizations", qs.toString()], queryFn: () => api<{ items: FoodOrganization[]; total: number }>(`/api/v1/food-rescue/organizations?${qs}`) });
  const donations = useQuery({ queryKey: ["food-donations", "public"], queryFn: () => api<Page<FoodDonation>>("/api/v1/food-rescue/donations") });
  async function searchPlace() { if (!place.trim()) return; setBusy(true); const hit = await forwardGeocode(place.trim()); setBusy(false); if (!hit) return void toast.error("We couldn't find that place. Try a city or area."); setCenter({ lat: hit.lat, lng: hit.lng }); }
  async function currentLocation() { setBusy(true); try { const p = await getPosition(); setCenter(p); setPlace((await reverseGeocode(p.lat, p.lng)) ?? ""); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } }
  return <>
    <div className="mb-2 flex flex-wrap items-end justify-between gap-3"><PageHeader title="Food Rescue">Connect surplus edible food with local organizations that may accept donations.</PageHeader><Link to={user ? "/food-rescue/new" : "/login"} className="btn-primary"><Plus className="h-4 w-4" aria-hidden />List surplus food</Link></div>
    <p className="mb-5 max-w-3xl text-sm text-muted">TRASHMORPH is a discovery and coordination aid. Contact each organization to confirm availability, food eligibility, and collection arrangements. Food safety is not certified by this platform. Public donation locations are approximate.</p>
    <section className="card mb-5 max-w-3xl"><h2 className="font-semibold">Food handling reminders</h2><ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted"><li>Use clean, sealed food-grade containers and note how the food has been stored.</li><li>Label known allergens and ingredients where you can.</li><li>Follow local food-safety guidance for hot or cold storage, and do not offer food if its handling history is uncertain.</li></ul></section>
    <div role="tablist" className="mb-4 flex gap-2">{([["organizations", "Find organizations"], ["food", "Available food"]] as const).map(([v, l]) => <button key={v} role="tab" aria-selected={tab === v} className={tab === v ? "btn-primary" : "btn-outline"} onClick={() => setTab(v)}>{l}</button>)}</div>
    {tab === "organizations" ? <>
      <div className="card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><div><label htmlFor="food-search" className="mb-1 block text-sm font-semibold">Search organizations</label><input id="food-search" className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, area, requirements" /></div><Select label="Organization type" value={orgType} onChange={(e) => setOrgType(e.target.value)} options={Object.entries(ORG_TYPES)} placeholder="All types" />
        <div className="sm:col-span-2"><label htmlFor="food-place" className="mb-1 block text-sm font-semibold">Search near</label><div className="flex gap-2"><input id="food-place" className="input" value={place} onChange={(e) => setPlace(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchPlace()} placeholder="City or area" /><button className="btn-primary shrink-0" disabled={busy} onClick={searchPlace} aria-label="Search place"><Search className="h-4 w-4" aria-hidden /></button><button className="btn-outline shrink-0" disabled={busy} onClick={currentLocation} aria-label="Use my location"><LocateFixed className="h-4 w-4" aria-hidden /></button></div></div>
        <Select label="Within" value={radius} onChange={(e) => setRadius(e.target.value)} options={RADII} />{center && <button className="btn-outline sm:col-span-2 lg:col-span-4" onClick={() => { setCenter(null); setPlace(""); }}>Clear location</button>}
      </div>
      <div role="tablist" className="mb-4 flex gap-2">{(["map", "list"] as const).map((v) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? "btn-primary capitalize" : "btn-outline capitalize"} onClick={() => setView(v)}>{v} view</button>)}</div>
      {orgs.isLoading && <Spinner />}{orgs.isError && <ErrorNote>{errorText(orgs.error)}</ErrorNote>}
      {orgs.data?.items.length === 0 && <EmptyState title="No listed organizations match">The Food Rescue directory has no matching curated records yet. Organizations are added by the TRASHMORPH platform after their details are checked; none are invented or implied to have agreed to accept donations.</EmptyState>}
      {!!orgs.data?.items.length && <><p className="mb-3 text-sm text-muted">{orgs.data.total} listed organizations</p>{view === "map" && <Suspense fallback={<Spinner label="Loading map…" />}><FoodOrganizationMap items={orgs.data.items} center={center} /></Suspense>}<div className={`grid gap-4 sm:grid-cols-2 ${view === "map" ? "mt-5" : ""}`}>{orgs.data.items.map((o) => <OrganizationCard key={o.id} org={o} />)}</div></>}
    </> : <>{donations.isLoading && <Spinner />}{donations.isError && <ErrorNote>{errorText(donations.error)}</ErrorNote>}{donations.data?.items.length === 0 && <EmptyState title="No available food listings">When someone lists surplus food, it will appear here. You can also <Link className="underline" to={user ? "/food-rescue/new" : "/login"}>create a listing</Link>.</EmptyState>}<div className="grid gap-4 sm:grid-cols-2">{donations.data?.items.map((d) => <DonationCard key={d.id} donation={d} />)}</div></>}
  </>;
}

export function FoodDonationFormPage() {
  const { id } = useParams(); const navigate = useNavigate(); const qc = useQueryClient(); const { user } = useAuth();
  const existing = useQuery({ queryKey: ["food-donations", "mine", user?.id], queryFn: () => api<Page<FoodDonation>>("/api/v1/food-rescue/donations?mine=true&page_size=50"), enabled: !!id && !!user });
  const [title, setTitle] = useState(""); const [donorType, setDonorType] = useState("individual"); const [donorOrgName, setDonorOrgName] = useState(""); const [category, setCategory] = useState("prepared_meal"); const [description, setDescription] = useState(""); const [quantity, setQuantity] = useState(""); const [unit, setUnit] = useState("servings");
  const [preparedAt, setPreparedAt] = useState(dt(new Date())); const [storage, setStorage] = useState(""); const [allergens, setAllergens] = useState(""); const [deadline, setDeadline] = useState(futureDefault); const [locationLabel, setLocationLabel] = useState(""); const [point, setPoint] = useState<Point | null>(null); const [photo, setPhoto] = useState<File | null>(null); const [photoUrl, setPhotoUrl] = useState<string | null>(null); const [place, setPlace] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState<string | null>(null);
  useEffect(() => { const d = existing.data?.items.find((x) => x.id === id); if (d) { setTitle(d.title); setDonorType(d.donor_type); setDonorOrgName(d.donor_organization_name ?? ""); setCategory(d.food_category); setDescription(d.description ?? ""); setQuantity(String(d.quantity)); setUnit(d.unit); setPreparedAt(dt(new Date(d.prepared_at))); setStorage(d.storage_conditions); setAllergens(d.allergens.join(", ")); setDeadline(dt(new Date(d.pickup_deadline))); setLocationLabel(d.location_label); setPoint({ lat: d.latitude, lng: d.longitude }); setPhotoUrl(d.photo_url); } }, [existing.data, id]);
  async function findPlace() { if (!place.trim()) return; setBusy(true); const hit = await forwardGeocode(place.trim()); setBusy(false); if (!hit) return void toast.error("We couldn't find that place. Try a neighborhood or area."); setPoint({ lat: hit.lat, lng: hit.lng }); setLocationLabel(hit.label); }
  async function currentLocation() { setBusy(true); try { const p = await getPosition(); setPoint(p); setLocationLabel((await reverseGeocode(p.lat, p.lng)) ?? "Nearby"); } catch (e) { toast.error(errorText(e)); } finally { setBusy(false); } }
  async function submit(e: React.FormEvent) { e.preventDefault(); setErr(null); if (!point) return setErr("Set a pickup area using search, your location, or the map."); if (!locationLabel.trim()) return setErr("Enter a general pickup area, not your exact home address."); if (!quantity || Number(quantity) <= 0) return setErr("Enter a quantity above zero."); if (donorType === "organization" && !donorOrgName.trim()) return setErr("Enter your organization name.");
    setBusy(true);
    try {
      let uploaded = photoUrl;
      if (photo) { if (!/^image\/(jpeg|png|webp)$/.test(photo.type) || photo.size > 3 * 1024 * 1024) throw new Error("Choose a JPG, PNG, or WebP image under 3 MB."); const { data: auth } = await supabase.auth.getSession(); if (!auth.session) throw new Error("Sign in to create a listing."); const path = `${auth.session.user.id}/${crypto.randomUUID()}.${photo.type.split("/")[1]}`; const { error } = await supabase.storage.from("food-rescue-images").upload(path, photo, { contentType: photo.type }); if (error) throw new Error("Couldn't upload the photo."); uploaded = supabase.storage.from("food-rescue-images").getPublicUrl(path).data.publicUrl; }
      const body = { title, donor_type: donorType, donor_organization_name: donorType === "organization" ? donorOrgName.trim() : null, food_category: category, description: description || null, quantity: Number(quantity), unit, prepared_at: new Date(preparedAt).toISOString(), storage_conditions: storage, allergens: allergens.split(",").map((a) => a.trim()).filter(Boolean), pickup_deadline: new Date(deadline).toISOString(), location_label: locationLabel, latitude: point.lat, longitude: point.lng, photo_url: uploaded };
      if (id) await api(`/api/v1/food-rescue/donations/${id}`, { method: "PATCH", body }); else await api("/api/v1/food-rescue/donations", { method: "POST", body });
      void qc.invalidateQueries({ queryKey: ["food-donations"] }); toast.success(id ? "Food listing updated." : "Food listing published."); navigate("/food-rescue/mine");
    } catch (e) { setErr(errorText(e)); } finally { setBusy(false); }
  }
  if (id && existing.isLoading) return <Spinner />;
  return <><PageHeader title={id ? "Edit food listing" : "List surplus food"}>Share enough detail for a potential recipient to decide whether the food may be suitable.</PageHeader>
    <form noValidate className="card max-w-3xl space-y-4" onSubmit={submit}>{err && <ErrorNote>{err}</ErrorNote>}
      <Field label="Listing title" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} required placeholder="e.g. Vegetarian lunch boxes" />
      <Select label="Donor type" value={donorType} onChange={(e) => setDonorType(e.target.value)} options={[["individual", "Individual / household"], ["organization", "Organization / business"]]} />
      {donorType === "organization" && <Field label="Organization name" value={donorOrgName} maxLength={160} onChange={(e) => setDonorOrgName(e.target.value)} required />}
      <Select label="Food category" value={category} onChange={(e) => setCategory(e.target.value)} options={FOOD_CATEGORIES} />
      <div><label className="mb-1 block text-sm font-semibold" htmlFor="food-description">Description</label><textarea id="food-description" className="input" rows={3} maxLength={1500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Ingredients, packaging, or other useful detail" /></div>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Quantity" type="number" min="0.01" max="1000000" step="any" value={quantity} onChange={(e) => setQuantity(e.target.value)} required /><Select label="Unit" value={unit} onChange={(e) => setUnit(e.target.value)} options={FOOD_UNITS} /></div>
      <div className="grid gap-3 sm:grid-cols-2"><Field label="Prepared or packaged at" type="datetime-local" value={preparedAt} onChange={(e) => setPreparedAt(e.target.value)} required /><Field label="Pickup deadline" type="datetime-local" min={dt(new Date())} value={deadline} onChange={(e) => setDeadline(e.target.value)} required /></div>
      <Field label="Storage conditions" hint="For example: kept refrigerated since preparation." value={storage} maxLength={500} onChange={(e) => setStorage(e.target.value)} required />
      <Field label="Known allergens" hint="Separate with commas. Enter 'None known' if appropriate." value={allergens} onChange={(e) => setAllergens(e.target.value)} />
      <div><label className="mb-1 block text-sm font-semibold" htmlFor="food-area">Pickup area (approximate)</label><div className="flex gap-2"><input id="food-area" className="input" value={locationLabel} readOnly placeholder="Select an area on the map" /><input aria-label="Search a pickup area" className="input" value={place} onChange={(e) => setPlace(e.target.value)} onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), void findPlace())} placeholder="Search area" /><button type="button" className="btn-primary" disabled={busy} onClick={findPlace} aria-label="Search"><Search className="h-4 w-4" aria-hidden /></button><button type="button" className="btn-outline" disabled={busy} onClick={currentLocation} aria-label="Use current location"><LocateFixed className="h-4 w-4" aria-hidden /></button></div><p className="mt-1 text-sm text-muted">We show a neighborhood-level label and round public coordinates to approximately 1 km. Do not enter your exact residential address.</p></div>
      <Suspense fallback={<Spinner label="Loading map…" />}><LocationPicker value={point} onChange={(p) => { setPoint(p); void reverseGeocode(Number(p.lat.toFixed(2)), Number(p.lng.toFixed(2))).then((label) => { if (label) setLocationLabel(label); }); }} /></Suspense>
      <div><label className="mb-1 block text-sm font-semibold" htmlFor="food-photo">Photo (optional)</label><input id="food-photo" type="file" accept="image/jpeg,image/png,image/webp" className="input" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />{photoUrl && !photo && <p className="mt-1 text-sm text-muted">Current photo saved. Choose a new photo to replace it.</p>}</div>
      <p className="rounded-lg bg-subtle p-3 text-sm text-muted">Food Rescue does not certify food safety. You are responsible for accurate preparation, storage, allergen, and deadline information. Donors contact organizations directly; TRASHMORPH does not arrange or guarantee collection.</p>
      <button className="btn-primary" disabled={busy}>{busy ? "Saving…" : id ? "Save changes" : "Publish food listing"}</button>
    </form></>;
}

export function MyFoodDonationsPage() {
  const { user } = useAuth(); const q = useQuery({ queryKey: ["food-donations", "mine", user?.id], queryFn: () => api<Page<FoodDonation>>("/api/v1/food-rescue/donations?mine=true&page_size=50"), enabled: !!user });
  return <><div className="mb-2 flex flex-wrap items-end justify-between gap-3"><PageHeader title="My food listings">Manage your Food Rescue posts and record what happened.</PageHeader><Link to="/food-rescue/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden />List food</Link></div>{q.isLoading && <Spinner />}{q.isError && <ErrorNote>{errorText(q.error)}</ErrorNote>}{q.data?.items.length === 0 && <EmptyState title="You haven't listed food yet">Create a listing to connect with potential local recipients.</EmptyState>}<div className="grid gap-4 sm:grid-cols-2">{q.data?.items.map((d) => <DonationCard key={d.id} donation={d} mine onChanged={() => void q.refetch()} />)}</div></>;
}

type FoodStats = { total_listed: number; reported_donated: number; reported_quantity: number; status_counts: Record<string, number>; by_category: { category: string; count: number }[]; activity: { date: string; type: "listed" | "donated"; count: number }[]; verification_note: string };
export function FoodRescueDashboardPage() {
  const { user } = useAuth(); const q = useQuery({ queryKey: ["food-dashboard", user?.id], queryFn: () => api<FoodStats>("/api/v1/food-rescue/dashboard"), enabled: !!user }); const d = q.data;
  return <><PageHeader title="Food Rescue dashboard">Your listing and donor-reported handover activity, based on Food Rescue records.</PageHeader>{q.isLoading && <Spinner />}{q.isError && <ErrorNote>{errorText(q.error)}</ErrorNote>}{d && <>
    <p className="mb-4 rounded-lg bg-subtle p-3 text-sm text-muted">{d.verification_note}</p>
    <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">{([["Total listed", d.total_listed], ["Reported donated", d.reported_donated], ["Reported quantity", d.reported_quantity], ["Available", d.status_counts.available], ["Expired / cancelled", d.status_counts.expired + d.status_counts.cancelled]] as const).map(([label, n]) => <div key={label} className="card !p-3"><dt className="text-sm text-muted">{label}</dt><dd className="font-display text-2xl font-bold">{n}</dd></div>)}</dl>
    <div className="grid gap-4 lg:grid-cols-2"><section className="card"><h2 className="font-semibold">Donated food categories</h2>{d.by_category.length ? <div className="relative mt-3 h-64"><Doughnut data={{ labels: d.by_category.map((x) => foodCategoryLabel(x.category)), datasets: [{ data: d.by_category.map((x) => x.count), backgroundColor: ["#10b981", "#f59e0b", "#0ea5e9", "#8b5cf6", "#ef4444", "#14b8a6"] }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom" } } }} /></div> : <p className="mt-5 text-muted">No reported handovers yet.</p>}</section>
      <section className="card"><h2 className="font-semibold">Listing and handover activity</h2>{d.activity.length ? <div className="relative mt-3 h-64"><Line data={{ labels: [...new Set(d.activity.map((x) => x.date))].map((date) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })), datasets: (["listed", "donated"] as const).map((type, i) => ({ label: type === "listed" ? "Listed" : "Donor-reported handover", data: [...new Set(d.activity.map((x) => x.date))].map((date) => d.activity.find((x) => x.date === date && x.type === type)?.count ?? 0), borderColor: i ? "#0ea5e9" : "#10b981", backgroundColor: i ? "#0ea5e9" : "#10b981" })) }} options={{ responsive: true, maintainAspectRatio: false, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }} /></div> : <p className="mt-5 text-muted">No activity in this range.</p>}</section></div>
    <section className="card mt-4"><h2 className="font-semibold">Donation status</h2><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr>{["Status", "Listings"].map((x) => <th key={x} className="py-2 pr-4">{x}</th>)}</tr></thead><tbody>{Object.entries(d.status_counts).map(([s, n]) => <tr key={s} className="border-t border-line"><td className="py-2 pr-4">{FOOD_STATUS[s]}</td><td>{n}</td></tr>)}</tbody></table></div></section>
  </>}</>;
}
