import { useQuery } from "@tanstack/react-query";
import { BarChart3, BookOpen, Heart, Inbox, Leaf, List, Plus, ScanLine, Store, Truck, Utensils } from "lucide-react";
import { Link } from "react-router-dom";
import { ListingCard } from "../components/listing";
import { ErrorNote, PageHeader, Spinner } from "../components/ui";
import { api, type Profile } from "../lib/api";
import type { Listing } from "../lib/listings";
import { useAuth } from "../providers/AuthProvider";

type Summary = { listings_total: number; listings_active: number; new_inquiries: number; favorites: number; unread_notifications: number; recent_listings: Listing[]; greenscore: number; open_collections: number; scans: number };

export function DashboardPage() {
  const { user } = useAuth();
  const profile = useQuery({ queryKey: ["profile", user?.id], queryFn: () => api<Profile>("/api/v1/profiles/me"), enabled: !!user });
  const s = useQuery({ queryKey: ["dashboard", user?.id], queryFn: () => api<Summary>("/api/v1/dashboard/summary"), enabled: !!user });
  const name = profile.data?.full_name?.split(" ")[0] ?? user?.email ?? "there";
  const stats: [string, number | undefined, string][] = [["Your listings", s.data?.listings_total, "/my-listings"], ["Active now", s.data?.listings_active, "/my-listings"], ["New inquiries", s.data?.new_inquiries, "/inquiries"], ["Saved", s.data?.favorites, "/saved"], ["Open collections", s.data?.open_collections, "/collections"], ["GreenScore", s.data?.greenscore, "/greenscore"], ["Scans", s.data?.scans, "/scanner"]];
  
  return (
    <>
      <PageHeader title={`Welcome, ${name}`}>Here's what's happening with your listings.</PageHeader>
      {s.isError && <div className="mb-6 space-y-2"><ErrorNote>{(s.error as Error).message}</ErrorNote><button className="btn-outline" onClick={() => s.refetch()}>Try again</button></div>}
      <section aria-label="Summary" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map(([label, n, to]) => <Link key={label} to={to} className="card hover:border-primary"><p className="text-sm text-muted">{label}</p><p className="font-display text-3xl font-bold">{s.isLoading ? <Spinner label="" /> : n ?? "–"}</p></Link>)}
      </section>
      <section aria-label="Quick actions" className="card mt-4">
        <h2 className="font-semibold">Quick actions</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Link to="/my-listings/new" className="btn-primary"><Plus className="h-4 w-4" aria-hidden />List waste</Link>
          <Link to="/marketplace" className="btn-outline"><Store className="h-4 w-4" aria-hidden />Browse marketplace</Link>
          <Link to="/my-listings" className="btn-outline"><List className="h-4 w-4" aria-hidden />My listings</Link>
          <Link to="/saved" className="btn-outline"><Heart className="h-4 w-4" aria-hidden />Saved listings</Link>
          <Link to="/inquiries" className="btn-outline"><Inbox className="h-4 w-4" aria-hidden />Inquiries</Link>
          <Link to="/food-rescue" className="btn-outline"><Utensils className="h-4 w-4" aria-hidden />Food Rescue</Link>
          <Link to="/collections" className="btn-outline"><Truck className="h-4 w-4" aria-hidden />Track collections</Link>
          <Link to="/greenscore" className="btn-outline"><Leaf className="h-4 w-4" aria-hidden />GreenScore</Link>
          <Link to="/recycling-guide" className="btn-outline"><BookOpen className="h-4 w-4" aria-hidden />Recycling guide</Link>
          <Link to="/scanner" className="btn-outline"><ScanLine className="h-4 w-4" aria-hidden />Scan waste</Link>
          <Link to="/analytics" className="btn-outline"><BarChart3 className="h-4 w-4" aria-hidden />Analytics</Link>
          <Link to="/waste-pickup" className="btn-outline"><Leaf className="h-4 w-4" aria-hidden />Waste Pickup</Link>
        </div>
      </section>
      <section aria-label="Recent listings" className="mt-6">
        <h2 className="text-xl font-bold">Recent listings</h2>
        {s.data && s.data.recent_listings.length === 0 && <p className="mt-2 text-muted">You haven't created a listing yet. <Link to="/my-listings/new" className="font-semibold text-primary underline">Create your first one</Link>.</p>}
        <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{s.data?.recent_listings.map((l) => <ListingCard key={l.id} l={l} showStatus />)}</div>
      </section>
    </>
  );
}
