import { useQuery } from "@tanstack/react-query";
import { Award, Check } from "lucide-react";
import { useState } from "react";
import { EmptyState, Pagination } from "../components/listing";
import { ErrorNote, PageHeader, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { timeAgo, type Page } from "../lib/listings";

type Summary = {
  total: number;
  level: { name: string; min_points: number; next_name: string | null; next_at: number | null };
  breakdown: { activity_type: string; points: number; events: number }[];
  badges: { key: string; label: string; criteria: string; earned: boolean }[];
  policy: { activity_type: string; label: string; points: number; daily_cap: number; verification: string }[];
};
type Tx = { id: string; points: number; activity_type: string; description: string; verification: string; created_at: string };
const VERIF: Record<string, string> = { user_reported: "Self-reported", counterparty_confirmed: "Confirmed by the other person" };

export function GreenScorePage() {
  const [page, setPage] = useState(1);
  const s = useQuery({ queryKey: ["greenscore"], queryFn: () => api<Summary>("/api/v1/greenscore") });
  const h = useQuery({ queryKey: ["greenscore-history", page], queryFn: () => api<Page<Tx>>(`/api/v1/greenscore/history?page=${page}&page_size=20`) });
  if (s.isLoading) return <Spinner />;
  if (s.isError || !s.data) return <div className="space-y-2"><ErrorNote>{(s.error as Error)?.message ?? "Couldn't load your GreenScore."}</ErrorNote><button className="btn-outline" onClick={() => s.refetch()}>Try again</button></div>;
  const d = s.data;
  const pct = d.level.next_at ? Math.min(100, Math.round(((d.total - d.level.min_points) / (d.level.next_at - d.level.min_points)) * 100)) : 100;
  const label = (t: string) => d.policy.find((p) => p.activity_type === t)?.label ?? t;

  return (
    <>
      <PageHeader title="GreenScore">Points for recorded reuse and recycling activity on TRASHMORPH. They're an engagement score, not a measurement of environmental impact.</PageHeader>
      <section className="card" aria-label="Your score">
        <p className="text-sm text-muted">Your score</p>
        <p className="font-display text-5xl font-bold">{d.total}</p>
        <p className="mt-1 font-semibold">{d.level.name}</p>
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-subtle" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Progress to next level"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
        <p className="mt-1 text-sm text-muted">{d.level.next_at ? `${d.level.next_at - d.total} points to ${d.level.next_name}` : "You've reached the highest level."}</p>
      </section>

      <section className="mt-6" aria-label="Badges">
        <h2 className="text-xl font-bold">Badges</h2>
        <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {d.badges.map((b) => (
            <li key={b.key} className={`card flex items-start gap-3 ${b.earned ? "border-primary" : "opacity-70"}`}>
              {b.earned ? <Check className="mt-1 h-5 w-5 text-primary" aria-hidden /> : <Award className="mt-1 h-5 w-5 text-muted" aria-hidden />}
              <div><p className="font-semibold">{b.label}{b.earned && <span className="sr-only"> (earned)</span>}</p><p className="text-sm text-muted">{b.criteria}</p></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-6" aria-label="Breakdown">
        <h2 className="text-xl font-bold">Breakdown</h2>
        {d.breakdown.length === 0 ? <p className="mt-2 text-muted">No points yet. Publish a listing or complete a collection to earn your first points.</p> : (
          <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b border-line text-muted"><th className="py-2 pr-4">Activity</th><th className="py-2 pr-4">Times</th><th className="py-2">Points</th></tr></thead>
            <tbody>{d.breakdown.map((b) => <tr key={b.activity_type} className="border-b border-line"><td className="py-2 pr-4">{label(b.activity_type)}</td><td className="py-2 pr-4">{b.events}</td><td className="py-2 font-semibold">{b.points}</td></tr>)}</tbody></table></div>
        )}
      </section>

      <section className="mt-6" aria-label="History">
        <h2 className="text-xl font-bold">History</h2>
        {h.data && h.data.items.length === 0 && <EmptyState title="Nothing yet">Your earned points will be listed here.</EmptyState>}
        <ul className="mt-3 space-y-2">{h.data?.items.map((t) => <li key={t.id} className="card flex flex-wrap items-center justify-between gap-2"><span><span className="block font-semibold">{t.description}</span><span className="block text-xs text-muted">{VERIF[t.verification]} · {timeAgo(t.created_at)}</span></span><span className="font-display text-lg font-bold text-primary">+{t.points}</span></li>)}</ul>
        {h.data && <Pagination page={page} total={h.data.total} pageSize={20} onPage={setPage} />}
      </section>

      <section className="card mt-6" aria-label="How points work">
        <h2 className="text-xl font-bold">How points work</h2>
        <ul className="mt-3 space-y-2 text-sm">{d.policy.map((p) => <li key={p.activity_type}><strong>+{p.points}</strong> {p.label}. {VERIF[p.verification]}. Up to {p.daily_cap} per day.</li>)}</ul>
        <p className="mt-3 text-sm text-muted">Points are calculated and recorded by the server, once per event, and can't be edited from your account. Collection points are awarded only when the lister marks the handover completed. Because two accounts could cooperate to inflate scores, daily limits apply, and we may adjust the rules as the platform grows.</p>
      </section>
    </>
  );
}
