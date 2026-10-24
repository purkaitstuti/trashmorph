import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { Link, useNavigate } from "react-router-dom";
import { EmptyState, Pagination } from "../components/listing";
import { ErrorNote, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { timeAgo, type AppNotification, type Inquiry, type Page } from "../lib/listings";

const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

export function NotificationsPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["notifications", page], queryFn: () => api<Page<AppNotification>>(`/api/v1/notifications?page=${page}&page_size=20`) });
  const done = () => { qc.invalidateQueries({ queryKey: ["notifications"] }); qc.invalidateQueries({ queryKey: ["unread"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const readOne = useMutation({ mutationFn: (id: string) => api(`/api/v1/notifications/${id}/read`, { method: "POST" }), onSuccess: done });
  const readAll = useMutation({ mutationFn: () => api("/api/v1/notifications/read-all", { method: "POST" }), onSuccess: done, onError: (e) => toast.error(errText(e)) });
  const hasUnread = q.data?.items.some((n) => !n.read_at);

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3"><PageHeader title="Notifications" />{hasUnread && <button className="btn-outline" disabled={readAll.isPending} onClick={() => readAll.mutate()}>Mark all as read</button>}</div>
      {q.isLoading && <Spinner />}
      {q.isError && <div className="space-y-2"><ErrorNote>{errText(q.error)}</ErrorNote><button className="btn-outline" onClick={() => q.refetch()}>Try again</button></div>}
      {q.data && q.data.items.length === 0 && <EmptyState title="You're all caught up">Updates about your listings and inquiries will show up here.</EmptyState>}
      <ul className="space-y-3">
        {q.data?.items.map((n) => (
          <li key={n.id}>
            <button className={`card flex w-full items-start gap-3 text-left ${n.read_at ? "" : "border-primary"}`} onClick={() => { if (!n.read_at) readOne.mutate(n.id); if (n.notification_type === "inquiry") navigate("/inquiries"); else if (n.notification_type === "collection" && n.reference_id) navigate(`/collections/${n.reference_id}`); }}>
              <Bell className={`mt-1 h-5 w-5 shrink-0 ${n.read_at ? "text-muted" : "text-primary"}`} aria-hidden />
              <span><span className="block font-semibold">{n.title}{!n.read_at && <span className="sr-only"> (unread)</span>}</span><span className="block text-muted">{n.message}</span><span className="block text-xs text-muted">{timeAgo(n.created_at)}</span></span>
            </button>
          </li>
        ))}
      </ul>
      {q.data && <Pagination page={page} total={q.data.total} pageSize={20} onPage={setPage} />}
    </>
  );
}

export function InquiriesPage() {
  const qc = useQueryClient();
  const [box, setBox] = useState<"received" | "sent">("received");
  const [page, setPage] = useState(1);
  const q = useQuery({ queryKey: ["inquiries", box, page], queryFn: () => api<Page<Inquiry>>(`/api/v1/inquiries?box=${box}&page=${page}&page_size=20`) });
  const markRead = useMutation({ mutationFn: (id: string) => api(`/api/v1/inquiries/${id}/read`, { method: "POST" }), onSuccess: () => { qc.invalidateQueries({ queryKey: ["inquiries"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); } });
  return (
    <>
      <PageHeader title="Inquiries" />
      <div role="tablist" className="mb-4 flex gap-2">
        {(["received", "sent"] as const).map((b) => <button key={b} role="tab" aria-selected={box === b} className={box === b ? "btn-primary capitalize" : "btn-outline capitalize"} onClick={() => { setBox(b); setPage(1); }}>{b}</button>)}
      </div>
      {q.isLoading && <Spinner />}
      {q.isError && <ErrorNote>{errText(q.error)}</ErrorNote>}
      {q.data && q.data.items.length === 0 && <EmptyState title={box === "received" ? "No inquiries yet" : "You haven't sent any inquiries"}>{box === "sent" && <Link to="/marketplace" className="btn-primary mt-2">Browse marketplace</Link>}</EmptyState>}
      <ul className="space-y-3">
        {q.data?.items.map((i) => (
          <li key={i.id} className="card">
            <p className="text-sm text-muted">{box === "received" ? "From" : "To the lister of"} <strong className="text-ink">{box === "received" ? i.other_party_name || "A TRASHMORPH member" : i.listing_title}</strong>{box === "received" && <> about <Link className="underline" to={`/marketplace/${i.listing_id}`}>{i.listing_title}</Link></>} · {timeAgo(i.created_at)}</p>
            <p className="mt-2 whitespace-pre-line">{i.message}</p>
            {i.reply_contact && <p className="mt-2 text-sm"><span className="text-muted">Reach them at: </span>{i.reply_contact}</p>}
            {box === "received" && i.status === "new" && <button className="btn-outline mt-3" disabled={markRead.isPending} onClick={() => markRead.mutate(i.id)}>Mark as read</button>}
          </li>
        ))}
      </ul>
      {q.data && <Pagination page={page} total={q.data.total} pageSize={20} onPage={setPage} />}
    </>
  );
}
