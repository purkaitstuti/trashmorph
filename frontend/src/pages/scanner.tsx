import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImagePlus, Trash2, Upload, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import { EmptyState, Pagination } from "../components/listing";
import { ErrorNote, PageHeader, Spinner } from "../components/ui";
import { api, uploadForm } from "../lib/api";
import { categoryLabel, timeAgo, type Page } from "../lib/listings";
import { checkImage, pct, scanCategoryLabel, type ScanItem, type ScanResult, type ScannerStatus } from "../lib/scanner";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");
const label = (c: string) => scanCategoryLabel(c, categoryLabel);

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
      <PageHeader title="Waste scanner">Take or upload a photo of one item to get a suggested category and disposal guidance.</PageHeader>
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
          {!result.is_uncertain && result.category !== "other" && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to={`/recyclers?material=${result.category}`} className="btn-primary">Find recyclers for this</Link>
              <Link to={`/my-listings/new?category=${result.category}`} className="btn-outline">List it for reuse</Link>
            </div>
          )}
        </section>
      )}

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
