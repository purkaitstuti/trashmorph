import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { z } from "zod";
import { EmptyState, Pagination } from "../components/listing";
import { ErrorNote, Field, FullPageSpinner, PageHeader, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { timeAgo, type ListingDetail, type Page } from "../lib/listings";
import { collectionSchema } from "../lib/schemas";

export type CollectionItem = { id: string; listing_id: string; listing_title: string; quantity: number; requested_date: string; time_window: string; instructions: string | null; status: string; role: "requester" | "owner"; other_party_name: string | null; created_at: string; updated_at: string };
type History = { previous_status: string | null; new_status: string; changed_by_role: string | null; created_at: string };
type Detail = CollectionItem & { history: History[]; allowed_actions: string[] };

const STATUS: Record<string, string> = { requested: "Requested", accepted: "Accepted", scheduled: "Scheduled", in_progress: "In progress", completed: "Completed", cancelled: "Cancelled", rejected: "Declined" };
const ACTION: Record<string, string> = { accepted: "Accept", rejected: "Decline", scheduled: "Mark scheduled", in_progress: "Start pickup", completed: "Mark completed", cancelled: "Cancel request" };
const CONFIRM = new Set(["rejected", "cancelled", "completed"]);
const WINDOWS: [string, string][] = [["any", "Any time"], ["morning", "Morning"], ["afternoon", "Afternoon"], ["evening", "Evening"]];
const WINDOW_LABEL = Object.fromEntries(WINDOWS);
const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export function RequestCollectionForm({ listing }: { listing: ListingDetail }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const today = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const { register, handleSubmit, formState: { errors } } = useForm<z.infer<typeof collectionSchema>>({ resolver: zodResolver(collectionSchema), defaultValues: { quantity: String(listing.quantity), time_window: "any", requested_date: today } });
  const create = useMutation({
    mutationFn: (v: z.infer<typeof collectionSchema>) => api<Detail>("/api/v1/collections", { method: "POST", body: { listing_id: listing.id, quantity: Number(v.quantity), requested_date: v.requested_date, time_window: v.time_window, instructions: v.instructions || null } }),
    onSuccess: (d) => { toast.success("Collection request sent"); navigate(`/collections/${d.id}`); },
    onError: (e) => setError(errText(e)),
  });
  if (!open) return <button className="btn-outline" onClick={() => setOpen(true)}>Request collection</button>;
  return (
    <form className="card space-y-3" noValidate onSubmit={handleSubmit((v) => { setError(null); create.mutate(v); })}>
      <h2 className="font-semibold">Request collection</h2>
      <p className="text-sm text-muted">This sends a request to the lister. TRASHMORPH helps you coordinate but doesn't arrange pickups or guarantee that a request will be accepted.</p>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={`Quantity (${listing.unit})`} type="number" min="0" step="any" error={errors.quantity?.message} {...register("quantity")} />
        <Field label="Preferred date" type="date" min={today} error={errors.requested_date?.message} {...register("requested_date")} />
        <Select label="Time window" options={WINDOWS} {...register("time_window")} />
      </div>
      <div><label htmlFor="instr" className="mb-1 block text-sm font-semibold">Instructions (optional)</label><textarea id="instr" rows={3} maxLength={500} className="input" {...register("instructions")} /></div>
      <div className="flex gap-2"><button className="btn-primary" disabled={create.isPending}>{create.isPending ? "Sending…" : "Send request"}</button><button type="button" className="btn-outline" onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

export function CollectionsPage() {
  const [role, setRole] = useState<"requester" | "owner">("requester");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["collections", role, page], queryFn: () => api<Page<CollectionItem>>(`/api/v1/collections?role=${role}&page=${page}&page_size=20`) });
  return (
    <>
      <PageHeader title="Collections">Requests to collect items, and requests for your own listings. This tracks coordination between people; it isn't a pickup service.</PageHeader>
      <div role="tablist" className="mb-4 flex flex-wrap gap-2">
        <button role="tab" aria-selected={role === "requester"} className={role === "requester" ? "btn-primary" : "btn-outline"} onClick={() => { setRole("requester"); setPage(1); }}>My requests</button>
        <button role="tab" aria-selected={role === "owner"} className={role === "owner" ? "btn-primary" : "btn-outline"} onClick={() => { setRole("owner"); setPage(1); }}>Requests for my listings</button>
      </div>
      {q.isLoading && <Spinner />}
      {q.isError && <div className="space-y-2"><ErrorNote>{errText(q.error)}</ErrorNote><button className="btn-outline" onClick={() => q.refetch()}>Try again</button></div>}
      {q.data && q.data.items.length === 0 && <EmptyState title="No requests yet">{role === "requester" ? <>Find something reusable in the <Link to="/marketplace" className="font-semibold text-primary underline">marketplace</Link> and request a collection.</> : "When someone asks to collect one of your listings, it will appear here."}</EmptyState>}
      <ul className="space-y-3">
        {q.data?.items.map((c) => (
          <li key={c.id}><Link to={`/collections/${c.id}`} className="card flex flex-wrap items-center justify-between gap-2 hover:border-primary">
            <span><span className="block font-semibold">{c.listing_title}</span><span className="block text-sm text-muted">{c.role === "requester" ? "From" : "Requested by"} {c.other_party_name || "a TRASHMORPH member"} · {c.requested_date} · {WINDOW_LABEL[c.time_window]}</span></span>
            <span className="badge">{STATUS[c.status]}</span>
          </Link></li>
        ))}
      </ul>
      {q.data && <Pagination page={page} total={q.data.total} pageSize={20} onPage={setPage} />}
    </>
  );
}

export function CollectionDetailPage() {
  const { id = "" } = useParams();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["collection", id], queryFn: () => api<Detail>(`/api/v1/collections/${id}`), retry: false });
  const change = useMutation({
    mutationFn: (status: string) => api<Detail>(`/api/v1/collections/${id}/status`, { method: "POST", body: { status } }),
    onSuccess: (d) => { qc.setQueryData(["collection", id], d); qc.invalidateQueries({ queryKey: ["collections"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); qc.invalidateQueries({ queryKey: ["greenscore"] }); qc.invalidateQueries({ queryKey: ["my-listings"] }); toast.success("Request updated"); },
    onError: (e) => toast.error(errText(e)),
  });
  if (q.isLoading) return <FullPageSpinner />;
  if (q.isError || !q.data) return <EmptyState title="Request not found">It doesn't exist or you aren't part of it.<div className="mt-4"><Link to="/collections" className="btn-primary">Back to collections</Link></div></EmptyState>;
  const c = q.data;
  const who = (r: string | null) => (r === null ? "System" : r === c.role ? "You" : c.other_party_name || (r === "owner" ? "The lister" : "The requester"));

  return (
    <div className="max-w-2xl">
      <Link to="/collections" className="text-sm font-semibold text-primary underline">← All collections</Link>
      <div className="mt-3 flex flex-wrap items-center gap-2"><h1 className="text-3xl font-bold">{c.listing_title}</h1><span className="badge">{STATUS[c.status]}</span></div>
      <dl className="card mt-4 grid grid-cols-2 gap-3 text-sm">
        <div><dt className="text-muted">{c.role === "requester" ? "Lister" : "Requested by"}</dt><dd>{c.other_party_name || "A TRASHMORPH member"}</dd></div>
        <div><dt className="text-muted">Quantity</dt><dd>{c.quantity}</dd></div>
        <div><dt className="text-muted">Preferred date</dt><dd>{c.requested_date}</dd></div>
        <div><dt className="text-muted">Time window</dt><dd>{WINDOW_LABEL[c.time_window]}</dd></div>
        {c.instructions && <div className="col-span-2"><dt className="text-muted">Instructions</dt><dd className="whitespace-pre-line">{c.instructions}</dd></div>}
      </dl>
      {c.allowed_actions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {c.allowed_actions.map((s) => (
            <button key={s} className={s === "cancelled" || s === "rejected" ? "btn-outline" : "btn-primary"} disabled={change.isPending}
              onClick={() => { if (!CONFIRM.has(s) || window.confirm(`${ACTION[s]}?`)) change.mutate(s); }}>{ACTION[s]}</button>
          ))}
        </div>
      )}
      {c.status === "in_progress" && c.role === "requester" && <p className="mt-3 text-sm text-muted">The lister marks the request completed once the handover has happened.</p>}
      <h2 className="mt-8 text-xl font-bold">History</h2>
      <ol className="mt-3 space-y-3 border-l-2 border-line pl-4">
        {c.history.map((h, i) => (
          <li key={i}><p className="font-semibold">{STATUS[h.new_status]}</p><p className="text-sm text-muted">{who(h.changed_by_role)} · {timeAgo(h.created_at)}</p></li>
        ))}
      </ol>
    </div>
  );
}
