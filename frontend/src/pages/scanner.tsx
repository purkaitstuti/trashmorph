import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, LocateFixed, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import { EmptyState, Pagination } from "../components/listing";
import { ErrorNote, Field, PageHeader, Select, Spinner } from "../components/ui";
import { api, uploadForm } from "../lib/api";
import { CATEGORIES, CONDITIONS, TYPES, UNITS, categoryLabel, timeAgo, type Listing, type Page } from "../lib/listings";
import { getPosition, reverseGeocode } from "../lib/geo";
import { checkImage, pct, scanCategoryLabel, type ScanCandidate, type ScanItem, type ScanResult, type ScannerStatus } from "../lib/scanner";
import { supabase } from "../lib/supabase";
import { useAuth } from "../providers/AuthProvider";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const label = (c: string) => scanCategoryLabel(c, categoryLabel);

type DraftItem = ScanCandidate & { selected: boolean; title: string; draftCategory: string; quantity: string; unit: string; condition: string; listingType: string; price: string; description: string };

function RegionPreview({ file, bbox }: { file: File; bbox: number[] }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const [x, y, w, h] = bbox;
      const sx = Math.round(x * img.naturalWidth), sy = Math.round(y * img.naturalHeight);
      const sw = Math.max(1, Math.round(w * img.naturalWidth)), sh = Math.max(1, Math.round(h * img.naturalHeight));
      const canvas = document.createElement("canvas"); canvas.width = sw; canvas.height = sh;
      canvas.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
      setSrc(canvas.toDataURL("image/jpeg", 0.82)); URL.revokeObjectURL(url);
    };
    img.onerror = () => { URL.revokeObjectURL(url); };
    img.src = url;
    return () => { URL.revokeObjectURL(url); url = ""; };
  }, [file, bbox]);
  return src ? <img src={src} alt={`Scanned ${bbox[0] === 0 && bbox[1] === 0 && bbox[2] === 1 && bbox[3] === 1 ? "whole image" : "image region"}`} className="h-20 w-20 shrink-0 rounded-lg border border-line object-contain bg-bg" /> : <div className="h-20 w-20 shrink-0 animate-pulse rounded-lg bg-subtle" aria-hidden />;
}

async function cropFile(file: File, bbox: number[], name: string): Promise<File> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("Couldn't prepare an item photo.")); img.src = url; });
    const [x, y, w, h] = bbox;
    const sx = Math.round(x * img.naturalWidth), sy = Math.round(y * img.naturalHeight);
    const sw = Math.max(1, Math.round(w * img.naturalWidth)), sh = Math.max(1, Math.round(h * img.naturalHeight));
    const scale = Math.min(1, 1600 / Math.max(sw, sh));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(sw * scale)); canvas.height = Math.max(1, Math.round(sh * scale));
    canvas.getContext("2d")?.drawImage(img, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((v) => v ? resolve(v) : reject(new Error("Couldn't prepare an item photo.")), "image/jpeg", 0.82));
    return new File([blob], `${name}.jpg`, { type: "image/jpeg" });
  } finally { URL.revokeObjectURL(url); }
}

function ScanListingComposer({ result, file }: { result: ScanResult; file: File }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [location, setLocation] = useState("");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Listing[]>([]);
  const [items, setItems] = useState<DraftItem[]>(() => result.candidates.map((c) => {
    const draftCategory = c.category === "uncertain" ? "other" : c.category;
    return { ...c, selected: false, draftCategory, title: `${categoryLabel(draftCategory)} · ${c.region_label}`, quantity: "1", unit: "items", condition: "good", listingType: "free", price: "", description: c.is_uncertain ? "" : c.suggested_action };
  }));
  const selected = items.filter((i) => i.selected);
  function update(id: string, patch: Partial<DraftItem>) { setItems((current) => current.map((i) => i.candidate_id === id ? { ...i, ...patch } : i)); }

  async function useLocation() {
    setLocating(true);
    try {
      const p = await getPosition(); setCoords({ latitude: p.lat, longitude: p.lng });
      const place = await reverseGeocode(p.lat, p.lng); if (place) setLocation(place); else toast("Coordinates saved. Add a city or neighbourhood name.");
    } catch (e) { toast.error(e instanceof Error ? e.message : "Couldn't get your location."); } finally { setLocating(false); }
  }

  async function publishSelected() {
    setError(null);
    if (!user) return setError("Sign in to create listings.");
    if (!selected.length) return setError("Select at least one item to list.");
    if (location.trim().length < 2) return setError("Enter a city or neighbourhood for these listings.");
    if (selected.some((i) => i.title.trim().length < 3 || Number(i.quantity) <= 0 || (i.listingType === "price" && (!i.price || Number(i.price) < 0)))) return setError("Check each selected item's title, quantity, and price.");
    setPublishing(true);
    let published = 0;
    try {
      for (const item of selected) {
        const crop = await cropFile(file, item.bbox, item.candidate_id);
        const path = `${user.id}/${crypto.randomUUID()}.jpg`;
        const { error: uploadError } = await supabase.storage.from("listing-images").upload(path, crop, { contentType: "image/jpeg" });
        if (uploadError) throw new Error(`Couldn't upload the photo for “${item.title}”.`);
        const imageUrl = supabase.storage.from("listing-images").getPublicUrl(path).data.publicUrl;
        const listing = await api<Listing>("/api/v1/listings", { method: "POST", body: {
          title: item.title.trim(), description: item.description.trim() || null, category: item.draftCategory,
          quantity: Number(item.quantity), unit: item.unit, condition: item.condition, listing_type: item.listingType,
          price: item.listingType === "price" ? Number(item.price) : null, location_label: location.trim(),
          latitude: coords?.latitude ?? null, longitude: coords?.longitude ?? null, images: [imageUrl], status: "active",
        } });
        published += 1; setCreated((current) => [...current, listing]);
        setItems((current) => current.map((i) => i.candidate_id === item.candidate_id ? { ...i, selected: false } : i));
      }
      toast.success(`${published} listing${published === 1 ? "" : "s"} published.`);
      void qc.invalidateQueries({ queryKey: ["my-listings"] }); void qc.invalidateQueries({ queryKey: ["market"] }); void qc.invalidateQueries({ queryKey: ["dashboard"] });
    } catch (e) {
      setError(`${published ? `${published} listing${published === 1 ? " was" : "s were"} published. ` : ""}${e instanceof Error ? e.message : "Something went wrong."}`);
      if (published) { void qc.invalidateQueries({ queryKey: ["my-listings"] }); void qc.invalidateQueries({ queryKey: ["dashboard"] }); }
    } finally { setPublishing(false); }
  }

  return <section className="card mt-6 max-w-4xl" aria-label="Choose and edit items to list">
    <h2 className="text-2xl font-bold">Choose items to list</h2>
    <p className="mt-2 text-sm text-muted">The scanner classifies the whole image and four regions; these are region suggestions, not guaranteed object detections. The same item may appear in more than one region. Review each crop, select only the items you want, and edit the details before publishing.</p>
    <div className="mt-4 space-y-4">{items.map((item) => <article key={item.candidate_id} className={`rounded-xl border p-4 ${item.selected ? "border-primary" : "border-line"}`}>
      <label className="mb-3 flex items-center gap-3 font-semibold"><input type="checkbox" className="h-5 w-5 accent-[rgb(var(--primary))]" checked={item.selected} onChange={(e) => update(item.candidate_id, { selected: e.target.checked })} />Select {item.region_label} as a listing</label>
      <div className="flex gap-3"><RegionPreview file={file} bbox={item.bbox} /><div><p className="font-semibold">{item.region_label}: {label(item.category)}</p><p className="text-sm text-muted">{pct(item.confidence)} confidence{item.is_uncertain ? " · low confidence, please choose the category yourself" : ""}</p>{item.is_uncertain && <p className="mt-1 text-xs text-muted">Model guess: {item.top_guess}</p>}</div></div>
      {item.selected && <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Listing title" value={item.title} maxLength={120} onChange={(e) => update(item.candidate_id, { title: e.target.value })} />
        <Select label="Category" value={item.draftCategory} onChange={(e) => update(item.candidate_id, { draftCategory: e.target.value })} options={CATEGORIES} />
        <Field label="Quantity" type="number" min="0.01" step="any" value={item.quantity} onChange={(e) => update(item.candidate_id, { quantity: e.target.value })} />
        <Select label="Unit" value={item.unit} onChange={(e) => update(item.candidate_id, { unit: e.target.value })} options={UNITS} />
        <Select label="Condition" value={item.condition} onChange={(e) => update(item.candidate_id, { condition: e.target.value })} options={CONDITIONS} />
        <Select label="Offer type" value={item.listingType} onChange={(e) => update(item.candidate_id, { listingType: e.target.value })} options={TYPES} />
        {item.listingType === "price" && <Field label="Price" type="number" min="0" step="0.01" value={item.price} onChange={(e) => update(item.candidate_id, { price: e.target.value })} />}
        <div className="sm:col-span-2"><label className="mb-1 block text-sm font-semibold">Description (optional)</label><textarea className="input" rows={2} maxLength={2000} value={item.description} onChange={(e) => update(item.candidate_id, { description: e.target.value })} /></div>
      </div>}
    </article>)}</div>
    <div className="mt-5 space-y-3 border-t border-line pt-4">
      <div className="flex flex-wrap items-end gap-2"><div className="min-w-64 flex-1"><Field label="Shared listing location" placeholder="City or neighbourhood" value={location} onChange={(e) => setLocation(e.target.value)} /></div><button type="button" className="btn-outline" disabled={locating} onClick={useLocation}><LocateFixed className="h-4 w-4" aria-hidden />{locating ? "Finding…" : "Use my location"}</button></div>
      {error && <ErrorNote>{error}</ErrorNote>}
      <button className="btn-primary" disabled={publishing || selected.length === 0} onClick={publishSelected}>{publishing ? "Publishing selected listings…" : `Publish ${selected.length} selected item${selected.length === 1 ? "" : "s"}`}</button>
    </div>
    {!!created.length && <div className="mt-5 rounded-lg bg-subtle p-4"><h3 className="font-semibold">Published listings</h3><ul className="mt-2 list-disc pl-5">{created.map((l) => <li key={l.id}><Link className="underline" to={`/marketplace/${l.id}`}>{l.title}</Link></li>)}</ul></div>}
  </section>;
}

export function ScannerPage() {
  const qc = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [save, setSave] = useState(true);
  const [progress, setProgress] = useState(0);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [page, setPage] = useState(1);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const status = useQuery({ queryKey: ["scanner-status"], queryFn: () => api<ScannerStatus>("/api/v1/waste/status"), retry: false });
  const history = useQuery({ queryKey: ["scans", page], queryFn: () => api<Page<ScanItem>>(`/api/v1/waste/scans?page=${page}&page_size=12`) });
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  function choose(f: File | undefined) {
    if (!f) return;
    const problem = checkImage(f);
    if (problem) return void toast.error(problem);
    setError(null); setResult(null); setProgress(0); setFile(f); setPreview(URL.createObjectURL(f));
  }
  function clear() { setFile(null); setPreview(null); setResult(null); setError(null); setProgress(0); }

  const scan = useMutation({
    mutationFn: () => { const fd = new FormData(); fd.append("file", file!); fd.append("save_image", String(save)); return uploadForm<ScanResult>("/api/v1/waste/classify", fd, setProgress); },
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ["scans"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
    onError: (e) => setError(errText(e)),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/api/v1/waste/scans/${id}`, { method: "DELETE" }),
    onSuccess: () => { toast.success("Scan deleted"); qc.invalidateQueries({ queryKey: ["scans"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
    onError: (e) => toast.error(errText(e)),
  });
  const unavailable = status.data && !status.data.available;
  const analysing = scan.isPending && progress >= 100;

  return (
    <>
      <PageHeader title="Waste scanner">Scan a photo for material suggestions by image region, then select and edit items to create listings.</PageHeader>
      {status.isLoading && <p><Spinner label="Checking the scanner…" /></p>}
      {unavailable && <div role="status" className="card mb-6 border-primary"><p className="font-semibold">The scanner isn't available right now</p><p className="mt-1 text-muted">{status.data!.message} You can still browse the <Link to="/recycling-guide" className="font-semibold text-primary underline">recycling guide</Link>.</p></div>}
      {status.isError && <ErrorNote>{errText(status.error)}</ErrorNote>}

      <section className="card max-w-2xl" aria-label="Scan an item">
        {!file ? (
          <div onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files[0]); }}
            className={`flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-8 text-center ${drag ? "border-primary bg-subtle" : "border-line"}`}>
            <ImagePlus className="h-10 w-10 text-muted" aria-hidden />
            <p className="text-muted">Drag a photo here, or choose one. JPG, PNG or WebP, up to 5 MB.</p>
            <div className="flex flex-wrap justify-center gap-2">
              <button className="btn-primary" disabled={!!unavailable} onClick={() => cameraRef.current?.click()}><Camera className="h-4 w-4" aria-hidden />Take photo</button>
              <button className="btn-outline" disabled={!!unavailable} onClick={() => uploadRef.current?.click()}><Upload className="h-4 w-4" aria-hidden />Upload image</button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Take a photo" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Upload an image" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        ) : (
          <div className="space-y-4">
            <div className="relative">
              <img src={preview!} alt="Preview of the photo you chose" className="max-h-80 w-full rounded-lg object-contain" />
              <button className="btn-outline absolute right-2 top-2 h-10 w-10 !p-0" onClick={clear} disabled={scan.isPending} aria-label="Remove photo"><X className="h-5 w-5" aria-hidden /></button>
            </div>
            <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 h-5 w-5 accent-[rgb(var(--primary))]" checked={save} onChange={(e) => setSave(e.target.checked)} disabled={scan.isPending} /><span>Save this photo to my scan history. It's private to you and you can delete it any time. Untick to keep only the result.</span></label>
            {error && <ErrorNote>{error}</ErrorNote>}
            {scan.isPending && (
              <div aria-live="polite">
                <div className="h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress"><div className="h-full bg-primary transition-all" style={{ width: `${progress}%` }} /></div>
                <p className="mt-2 text-sm text-muted">{analysing ? "Analysing your photo…" : `Uploading… ${progress}%`}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button className="btn-primary" disabled={scan.isPending || !!unavailable} onClick={() => { setError(null); setResult(null); setProgress(0); scan.mutate(); }}>{scan.isPending ? "Scanning…" : result ? "Scan again" : "Scan this photo"}</button>
              <button className="btn-outline" disabled={scan.isPending} onClick={() => uploadRef.current?.click()}>Replace photo</button>
              <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" aria-label="Choose a different image" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ""; }} />
            </div>
          </div>
        )}
      </section>

      {result && (
        <section className="card mt-6 max-w-2xl" aria-label="Scan result" aria-live="polite">
          <p className="text-sm text-muted">Suggested category</p>
          <h2 className="text-3xl font-bold">{label(result.category)}</h2>
          <p className="mt-1 text-sm text-muted">Model confidence {pct(result.confidence)}{result.is_uncertain && result.top_guess ? `. Its best guess was "${result.top_guess}", but that's below our confidence threshold.` : ""}</p>
          {result.is_uncertain && <p className="mt-3 rounded-lg bg-subtle p-3 text-sm">We couldn't identify this confidently. A clearer photo of a single item in good light often helps.</p>}
          <h3 className="mt-4 font-semibold">What to do</h3><p className="text-muted">{result.suggested_action}</p>
          <h3 className="mt-3 font-semibold">Good to know</h3><p className="text-muted">{result.recycling_guidance}</p>
          {result.alternatives.length > 1 && <p className="mt-3 text-sm text-muted">Other possibilities: {result.alternatives.slice(1).map((a) => `${a.label} (${pct(a.confidence)})`).join(", ")}</p>}
          <p className="mt-4 text-xs text-muted">{result.disclaimer}{result.image_saved ? "" : " Your photo wasn't saved."}</p>
        </section>
      )}

      {result && file && <ScanListingComposer key={result.scan_id} result={result} file={file} />}

      <section className="mt-10" aria-label="Scan history">
        <h2 className="text-2xl font-bold">Your scan history</h2>
        {history.isLoading && <p className="mt-3"><Spinner /></p>}
        {history.isError && <div className="mt-3 space-y-2"><ErrorNote>{errText(history.error)}</ErrorNote><button className="btn-outline" onClick={() => history.refetch()}>Try again</button></div>}
        {history.data && history.data.items.length === 0 && <div className="mt-3"><EmptyState title="No scans yet">Your results will be listed here.</EmptyState></div>}
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {history.data?.items.map((s) => (
            <li key={s.id} className="card flex gap-3 !p-3">
              {s.image_url ? <img src={s.image_url} alt="" loading="lazy" className="h-20 w-20 shrink-0 rounded-lg object-cover" /> : <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-lg bg-subtle text-xs text-muted">No photo</div>}
              <div className="min-w-0 flex-1"><p className="font-semibold">{label(s.category)}</p><p className="text-sm text-muted">{pct(s.confidence)} · {timeAgo(s.created_at)}</p></div>
              <button className="btn-outline h-10 w-10 shrink-0 !p-0" disabled={remove.isPending} aria-label="Delete scan" onClick={() => window.confirm("Delete this scan?") && remove.mutate(s.id)}><Trash2 className="h-4 w-4" aria-hidden /></button>
            </li>
          ))}
        </ul>
        {history.data && <Pagination page={page} total={history.data.total} pageSize={12} onPage={setPage} />}
      </section>
    </>
  );
}
