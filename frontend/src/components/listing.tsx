import { ChevronLeft, ChevronRight, Package } from "lucide-react";
import { Link } from "react-router-dom";
import { categoryLabel, priceLabel, STATUS_LABEL, type Listing } from "../lib/listings";

export function ListingCard({ l, showStatus }: { l: Listing; showStatus?: boolean }) {
  return (
    <Link to={`/marketplace/${l.id}`} className="card block overflow-hidden !p-0 transition-colors hover:border-primary">
      {l.images[0] ? <img src={l.images[0]} alt="" loading="lazy" className="h-40 w-full object-cover" /> : <div className="flex h-40 items-center justify-center bg-subtle"><Package className="h-10 w-10 text-muted" aria-hidden /></div>}
      <div className="p-4">
        <h3 className="line-clamp-1 font-semibold">{l.title}</h3>
        <p className="mt-1 text-sm text-muted">{categoryLabel(l.category)} · {l.quantity} {l.unit}</p>
        <p className="mt-1 text-sm text-muted">{l.location_label}</p>
        <div className="mt-3 flex items-center justify-between">
          <span className="font-display text-lg font-bold">{priceLabel(l)}</span>
          {showStatus && <span className="badge">{STATUS_LABEL[l.status] ?? l.status}</span>}
        </div>
      </div>
    </Link>
  );
}

export function Pagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return (
    <nav className="mt-8 flex items-center justify-center gap-3" aria-label="Pagination">
      <button className="btn-outline" disabled={page <= 1} onClick={() => onPage(page - 1)}><ChevronLeft className="h-4 w-4" aria-hidden />Previous</button>
      <span className="text-sm text-muted">Page {page} of {pages}</span>
      <button className="btn-outline" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next<ChevronRight className="h-4 w-4" aria-hidden /></button>
    </nav>
  );
}

export function EmptyState({ title, children }: { title: string; children?: React.ReactNode }) {
  return <div className="card py-10 text-center"><h2 className="text-xl font-semibold">{title}</h2>{children && <div className="mt-2 text-muted">{children}</div>}</div>;
}
