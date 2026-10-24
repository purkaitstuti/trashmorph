import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, LocateFixed, MapPin, Plus, Search } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import type { z } from "zod";
import { EmptyState } from "../components/listing";
import { ErrorNote, Field, PageHeader, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { forwardGeocode, getPosition, reverseGeocode } from "../lib/geo";
import { CATEGORIES, categoryLabel } from "../lib/listings";
import { RECYCLER_TYPES, VERIFICATION_LABEL, directionsUrl, typeLabel, type Recycler } from "../lib/recyclers";
import { recyclerSchema } from "../lib/schemas";
import { useAuth } from "../providers/AuthProvider";

// Leaflet is only loaded on pages that show a map.
const RecyclerMap = lazy(() => import("../components/Map").then((m) => ({ default: m.RecyclerMap })));
const LocationPicker = lazy(() => import("../components/Map").then((m) => ({ default: m.LocationPicker })));
type Point = { lat: number; lng: number };
type Result = { items: Recycler[]; total: number; truncated: boolean };
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const RADII: [string, string][] = [["5", "5 km"], ["10", "10 km"], ["25", "25 km"], ["50", "50 km"], ["100", "100 km"]];

function RecyclerCard({ r }: { r: Recycler }) {
  return (
    <article className="card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-lg font-semibold">{r.name}</h3>
        {r.distance_km != null && <span className="badge">{r.distance_km} km away</span>}
      </div>
      <p className="text-sm text-muted">{typeLabel(r.recycler_type)}</p>
      <p className="mt-2 flex flex-wrap gap-1">{r.accepted_materials.map((m) => <span key={m} className="badge">{categoryLabel(m)}</span>)}</p>
      {r.description && <p className="mt-2 text-sm">{r.description}</p>}
      {r.address && <p className="mt-2 flex items-start gap-1 text-sm text-muted"><MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />{r.address}</p>}
      {r.contact_information && <p className="mt-1 text-sm text-muted">Contact: {r.contact_information}</p>}
      <p className="mt-3 text-xs text-muted">{VERIFICATION_LABEL[r.verification_status] ?? r.verification_status}. Confirm opening hours and accepted items before you go.</p>
      <a href={directionsUrl(r)} target="_blank" rel="noopener noreferrer" className="btn-outline mt-3">Directions<ExternalLink className="h-4 w-4" aria-hidden /></a>
    </article>
  );
}

export function RecyclersPage() {
  const { user } = useAuth();
  const [initial] = useSearchParams();
  const [material, setMaterial] = useState(CATEGORIES.some(([k]) => k === initial.get("material")) ? initial.get("material")! : "");
  const [type, setType] = useState("");
  const [center, setCenter] = useState<Point | null>(null);
  const [radius, setRadius] = useState("25");
  const [place, setPlace] = useState("");
  const [view, setView] = useState<"map" | "list">("map");
  const [busy, setBusy] = useState(false);

  const qs = new URLSearchParams();
  if (material) qs.set("material", material);
  if (type) qs.set("recycler_type", type);
  if (center) { qs.set("lat", String(center.lat)); qs.set("lng", String(center.lng)); qs.set("radius_km", radius); }
  const q = useQuery({ queryKey: ["recyclers", qs.toString(), user?.id], queryFn: () => api<Result>(`/api/v1/recyclers?${qs}`) });

  async function searchPlace() {
    if (!place.trim()) return;
    setBusy(true);
    const hit = await forwardGeocode(place.trim());
    setBusy(false);
    if (!hit) return void toast.error("We couldn't find that place. Try a city or a more specific name.");
    setCenter({ lat: hit.lat, lng: hit.lng });
  }
  async function useMyLocation() {
    setBusy(true);
    try {
      const p = await getPosition();
      setCenter(p);
      setPlace((await reverseGeocode(p.lat, p.lng)) ?? "");
    } catch (e) { toast.error(errText(e)); } finally { setBusy(false); }
  }

  return (
    <>
      <div className="mb-2 flex flex-wrap items-end justify-between gap-3">
        <PageHeader title="Find recyclers">Recycling and reuse options that have been added to TRASHMORPH.</PageHeader>
        {user && <Link to="/recyclers/suggest" className="btn-outline"><Plus className="h-4 w-4" aria-hidden />Suggest a recycler</Link>}
      </div>
      <p className="mb-4 max-w-3xl text-sm text-muted">Coverage is limited to places people have submitted and reviewed so far, and we never invent locations. Always confirm details with the recycler.</p>
      <div className="card mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Select label="Material" value={material} onChange={(e) => setMaterial(e.target.value)} options={CATEGORIES} placeholder="Any material" />
        <Select label="Type" value={type} onChange={(e) => setType(e.target.value)} options={RECYCLER_TYPES} placeholder="Any type" />
        <div className="sm:col-span-2">
          <label htmlFor="place" className="mb-1 block text-sm font-semibold">Search near</label>
          <div className="flex gap-2">
            <input id="place" className="input" value={place} onChange={(e) => setPlace(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchPlace()} placeholder="City or area" />
            <button className="btn-primary shrink-0" disabled={busy} onClick={searchPlace} aria-label="Search place"><Search className="h-4 w-4" aria-hidden /></button>
            <button className="btn-outline shrink-0" disabled={busy} onClick={useMyLocation} aria-label="Use my location"><LocateFixed className="h-4 w-4" aria-hidden /></button>
          </div>
        </div>
        {center && (
          <div className="flex items-end gap-3 sm:col-span-2 lg:col-span-4">
            <div className="w-40"><Select label="Within" value={radius} onChange={(e) => setRadius(e.target.value)} options={RADII} /></div>
            <button className="btn-outline" onClick={() => { setCenter(null); setPlace(""); }}>Clear location</button>
          </div>
        )}
      </div>
      <div role="tablist" className="mb-4 flex gap-2">
        {(["map", "list"] as const).map((v) => <button key={v} role="tab" aria-selected={view === v} className={view === v ? "btn-primary capitalize" : "btn-outline capitalize"} onClick={() => setView(v)}>{v} view</button>)}
      </div>
      {q.isLoading && <Spinner />}
      {q.isError && <div className="space-y-2"><ErrorNote>{errText(q.error)}</ErrorNote><button className="btn-outline" onClick={() => q.refetch()}>Try again</button></div>}
      {q.data && q.data.items.length === 0 && (
        <EmptyState title="No recyclers found">There are no reviewed recyclers that match{center ? " near this location" : ""} yet. Try widening the search or removing a filter.{user && <div className="mt-4"><Link to="/recyclers/suggest" className="btn-primary">Suggest a recycler</Link></div>}</EmptyState>
      )}
      {q.data && q.data.items.length > 0 && (
        <>
          <p className="mb-3 text-sm text-muted" role="status">{q.data.total} found{q.data.truncated ? " (showing the first 200)" : ""}</p>
          {view === "map" ? <Suspense fallback={<Spinner label="Loading map…" />}><RecyclerMap items={q.data.items} center={center} /></Suspense> : null}
          <div className={`grid gap-4 sm:grid-cols-2 ${view === "map" ? "mt-6" : ""}`}>{q.data.items.map((r) => <RecyclerCard key={r.id} r={r} />)}</div>
        </>
      )}
    </>
  );
}

export function RecyclerFormPage() {
  const navigate = useNavigate();
  const [materials, setMaterials] = useState<string[]>([]);
  const [point, setPoint] = useState<Point | null>(null);
  const [place, setPlace] = useState("");
  const [extraError, setExtraError] = useState<string | null>(null);
  const [finding, setFinding] = useState(false);
  const { register, handleSubmit, setValue, formState: { errors } } = useForm<z.infer<typeof recyclerSchema>>({ resolver: zodResolver(recyclerSchema), defaultValues: { recycler_type: "" } });

  const submit = useMutation({
    mutationFn: (v: z.infer<typeof recyclerSchema>) => api("/api/v1/recyclers", { method: "POST", body: {
      name: v.name, recycler_type: v.recycler_type, description: v.description || null, address: v.address || null, contact_information: v.contact_information || null,
      accepted_materials: materials, latitude: point!.lat, longitude: point!.lng } }),
    onSuccess: () => { toast.success("Thanks! Your suggestion will appear once it's reviewed."); navigate("/recyclers"); },
    onError: (e) => setExtraError(errText(e)),
  });

  async function findPlace() {
    if (!place.trim()) return;
    setFinding(true);
    const hit = await forwardGeocode(place.trim());
    setFinding(false);
    if (!hit) return void toast.error("We couldn't find that place. Click the map instead.");
    setPoint({ lat: hit.lat, lng: hit.lng });
  }
  async function useMyLocation() {
    setFinding(true);
    try {
      const p = await getPosition(); setPoint(p);
      const label = await reverseGeocode(p.lat, p.lng);
      if (label) setValue("address", label, { shouldDirty: true });
    } catch (e) { toast.error(errText(e)); } finally { setFinding(false); }
  }

  return (
    <>
      <PageHeader title="Suggest a recycler">Add a recycling or reuse place you know about. Suggestions are reviewed before they appear publicly.</PageHeader>
      <form noValidate className="card max-w-2xl space-y-4" onSubmit={handleSubmit((v) => {
        setExtraError(null);
        if (!materials.length) return setExtraError("Choose at least one accepted material.");
        if (!point) return setExtraError("Set the location by searching or clicking the map.");
        submit.mutate(v);
      })}>
        {extraError && <ErrorNote>{extraError}</ErrorNote>}
        <Field label="Name" error={errors.name?.message} {...register("name")} />
        <Select label="Type" options={RECYCLER_TYPES} placeholder="Choose…" error={errors.recycler_type?.message} {...register("recycler_type")} />
        <fieldset><legend className="mb-1 text-sm font-semibold">Accepted materials</legend>
          <div className="flex flex-wrap gap-3">{CATEGORIES.map(([v, l]) => <label key={v} className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={materials.includes(v)} onChange={(e) => setMaterials(e.target.checked ? [...materials, v] : materials.filter((m) => m !== v))} />{l}</label>)}</div>
        </fieldset>
        <div><label htmlFor="desc" className="mb-1 block text-sm font-semibold">Description (optional)</label><textarea id="desc" rows={3} className="input" {...register("description")} /></div>
        <Field label="Address (optional)" error={errors.address?.message} {...register("address")} />
        <Field label="Contact details (optional)" hint="A phone number or website. This is shown publicly once reviewed." error={errors.contact_information?.message} {...register("contact_information")} />
        <div>
          <p className="mb-1 text-sm font-semibold">Location</p>
          <div className="mb-2 flex gap-2">
            <input aria-label="Search for the place" className="input" value={place} onChange={(e) => setPlace(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); findPlace(); } }} placeholder="Search a place name or address" />
            <button type="button" className="btn-primary shrink-0" disabled={finding} onClick={findPlace} aria-label="Search place"><Search className="h-4 w-4" aria-hidden /></button>
            <button type="button" className="btn-outline shrink-0" disabled={finding} onClick={useMyLocation} aria-label="Use my location"><LocateFixed className="h-4 w-4" aria-hidden /></button>
          </div>
          <Suspense fallback={<Spinner label="Loading map…" />}><LocationPicker value={point} onChange={setPoint} /></Suspense>
          <p className="mt-1 text-sm text-muted">{point ? `Selected: ${point.lat}, ${point.lng}. Click the map to adjust.` : "Search, use your location, or click the map to drop a pin."}</p>
        </div>
        <button className="btn-primary" disabled={submit.isPending}>{submit.isPending ? "Submitting…" : "Submit for review"}</button>
      </form>
    </>
  );
}
