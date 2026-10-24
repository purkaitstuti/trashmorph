import { useQuery } from "@tanstack/react-query";
import { ArcElement, BarElement, CategoryScale, Chart as ChartJS, Legend, LineElement, LinearScale, PointElement, Tooltip, type ChartOptions } from "chart.js";
import { useEffect, useState, type ReactNode } from "react";
import { Bar, Doughnut, Line } from "react-chartjs-2";
import { EmptyState } from "../components/listing";
import { ErrorNote, Field, PageHeader, Select, Spinner } from "../components/ui";
import { api } from "../lib/api";
import { CATEGORIES, categoryLabel } from "../lib/listings";
import { useTheme } from "../providers/ThemeProvider";

ChartJS.register(ArcElement, BarElement, CategoryScale, Legend, LineElement, LinearScale, PointElement, Tooltip);

type Data = {
  range: { from: string; to: string };
  totals: { listings: number; collection_requests: number; completed_collections: number; points: number; scans: number };
  listings_by_category: { key: string; count: number }[];
  listings_over_time: { week: string; value: number }[];
  collections_by_status: { status: string; as_requester: number; as_owner: number }[];
  collections_over_time: { week: string; requested: number; completed: number }[];
  points_over_time: { week: string; value: number }[];
  scans_by_category: { key: string; count: number }[];
  truncated: boolean;
};

const PALETTE = ["#10b981", "#0ea5e9", "#f59e0b", "#8b5cf6", "#ef4444", "#14b8a6", "#ec4899", "#84cc16", "#64748b", "#f97316", "#06b6d4"];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const weekLabel = (w: string) => new Date(`${w}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const statusLabel = (s: string) => s.replace("_", " ").replace(/^./, (c) => c.toUpperCase());

function readColors() {
  const css = getComputedStyle(document.documentElement);
  const rgb = (v: string) => `rgb(${css.getPropertyValue(v).trim().replace(/ /g, ",")})`;
  return { text: rgb("--text"), muted: rgb("--muted"), grid: rgb("--border") };
}

// Re-read the theme colours after the theme class has been applied to <html>.
function useChartTheme() {
  const { resolved } = useTheme();
  const [colors, setColors] = useState(readColors);
  useEffect(() => {
    const id = requestAnimationFrame(() => setColors(readColors()));
    return () => cancelAnimationFrame(id);
  }, [resolved]);
  return colors;
}

function ChartCard({ title, note, empty, table, children }: { title: string; note?: string; empty: boolean; table: { head: string[]; rows: (string | number)[][] }; children: ReactNode }) {
  return (
    <section className="card" aria-label={title}>
      <h2 className="font-semibold">{title}</h2>
      {note && <p className="text-sm text-muted">{note}</p>}
      {empty ? <p className="mt-6 text-muted">No data in this range yet.</p> : (
        <>
          <div className="relative mt-3 h-64" role="img" aria-label={`${title} chart. A data table follows.`}>{children}</div>
          <details className="mt-3 text-sm"><summary className="cursor-pointer font-semibold">View data table</summary>
            <div className="mt-2 overflow-x-auto"><table className="w-full text-left"><thead><tr>{table.head.map((h) => <th key={h} className="py-1 pr-4">{h}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, i) => <tr key={i} className="border-t border-line">{r.map((c, j) => <td key={j} className="py-1 pr-4">{c}</td>)}</tr>)}</tbody></table></div></details>
        </>
      )}
    </section>
  );
}

export function AnalyticsPage() {
  const t = useChartTheme();
  const today = new Date();
  const [from, setFrom] = useState(iso(new Date(today.getTime() - 90 * 86400000)));
  const [to, setTo] = useState(iso(today));
  const [category, setCategory] = useState("");
  const qs = new URLSearchParams({ from, to, ...(category ? { category } : {}) });
  const q = useQuery({ queryKey: ["analytics", from, to, category], queryFn: () => api<Data>(`/api/v1/analytics?${qs}`), enabled: !!from && !!to, retry: false });

  const axes: ChartOptions<"bar" | "line"> = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { labels: { color: t.text } } },
    scales: { x: { ticks: { color: t.muted }, grid: { color: t.grid } }, y: { beginAtZero: true, ticks: { color: t.muted, precision: 0 }, grid: { color: t.grid } } },
  };
  const d = q.data;
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  return (
    <>
      <PageHeader title="Analytics">Charts of your own activity on TRASHMORPH. They count events (listings, requests, scans), not weights, and don't estimate carbon or landfill savings. A scan or a listing isn't counted as recycled material.</PageHeader>
      <form className="card mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4" onSubmit={(e) => e.preventDefault()}>
        <Field label="From" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        <Field label="To" type="date" value={to} min={from} max={iso(today)} onChange={(e) => setTo(e.target.value)} />
        <Select label="Category (listings and scans)" value={category} onChange={(e) => setCategory(e.target.value)} options={CATEGORIES} placeholder="All categories" />
      </form>
      {q.isLoading && <Spinner />}
      {q.isError && <div className="space-y-2"><ErrorNote>{(q.error as Error).message}</ErrorNote><button className="btn-outline" onClick={() => q.refetch()}>Try again</button></div>}
      {d && (
        <>
          {d.truncated && <p className="mb-4 text-sm text-muted" role="status">You have a lot of records in this range, so charts use the first 2,000 of each type. Narrow the dates for exact figures.</p>}
          {sum([d.totals.listings, d.totals.collection_requests, d.totals.points, d.totals.scans]) === 0 && <div className="mb-6"><EmptyState title="Nothing to chart in this range">Publish a listing, request a collection or scan an item and it will show up here.</EmptyState></div>}
          <dl className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
            {([["Listings", d.totals.listings], ["Collection requests", d.totals.collection_requests], ["Completed", d.totals.completed_collections], ["Points earned", d.totals.points], ["Scans", d.totals.scans]] as const).map(([k, v]) => <div key={k} className="card !p-3"><dt className="text-sm text-muted">{k}</dt><dd className="font-display text-2xl font-bold">{v}</dd></div>)}
          </dl>
          <div className="grid gap-4 lg:grid-cols-2">
            <ChartCard title="Listings by category" empty={d.listings_by_category.length === 0} table={{ head: ["Category", "Listings"], rows: d.listings_by_category.map((r) => [categoryLabel(r.key), r.count]) }}>
              <Doughnut data={{ labels: d.listings_by_category.map((r) => categoryLabel(r.key)), datasets: [{ data: d.listings_by_category.map((r) => r.count), backgroundColor: PALETTE, borderColor: t.grid }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: t.text } } } }} />
            </ChartCard>
            <ChartCard title="Listings created per week" empty={sum(d.listings_over_time.map((r) => r.value)) === 0} table={{ head: ["Week starting", "Listings"], rows: d.listings_over_time.map((r) => [r.week, r.value]) }}>
              <Bar data={{ labels: d.listings_over_time.map((r) => weekLabel(r.week)), datasets: [{ label: "Listings", data: d.listings_over_time.map((r) => r.value), backgroundColor: PALETTE[0] }] }} options={axes as ChartOptions<"bar">} />
            </ChartCard>
            <ChartCard title="Collection requests by status" note="Counted separately for requests you made and requests for your listings." empty={sum(d.collections_by_status.map((r) => r.as_requester + r.as_owner)) === 0} table={{ head: ["Status", "As requester", "As lister"], rows: d.collections_by_status.map((r) => [statusLabel(r.status), r.as_requester, r.as_owner]) }}>
              <Bar data={{ labels: d.collections_by_status.map((r) => statusLabel(r.status)), datasets: [{ label: "As requester", data: d.collections_by_status.map((r) => r.as_requester), backgroundColor: PALETTE[1] }, { label: "As lister", data: d.collections_by_status.map((r) => r.as_owner), backgroundColor: PALETTE[2] }] }} options={axes as ChartOptions<"bar">} />
            </ChartCard>
            <ChartCard title="Collection activity per week" empty={sum(d.collections_over_time.map((r) => r.requested + r.completed)) === 0} table={{ head: ["Week starting", "Requested", "Completed"], rows: d.collections_over_time.map((r) => [r.week, r.requested, r.completed]) }}>
              <Line data={{ labels: d.collections_over_time.map((r) => weekLabel(r.week)), datasets: [{ label: "Requested", data: d.collections_over_time.map((r) => r.requested), borderColor: PALETTE[1], backgroundColor: PALETTE[1] }, { label: "Completed", data: d.collections_over_time.map((r) => r.completed), borderColor: PALETTE[0], backgroundColor: PALETTE[0] }] }} options={axes as ChartOptions<"line">} />
            </ChartCard>
            <ChartCard title="GreenScore points earned per week" empty={sum(d.points_over_time.map((r) => r.value)) === 0} table={{ head: ["Week starting", "Points"], rows: d.points_over_time.map((r) => [r.week, r.value]) }}>
              <Line data={{ labels: d.points_over_time.map((r) => weekLabel(r.week)), datasets: [{ label: "Points", data: d.points_over_time.map((r) => r.value), borderColor: PALETTE[3], backgroundColor: PALETTE[3] }] }} options={axes as ChartOptions<"line">} />
            </ChartCard>
            <ChartCard title="Scans by category" empty={d.scans_by_category.length === 0} table={{ head: ["Category", "Scans"], rows: d.scans_by_category.map((r) => [r.key === "uncertain" ? "Not sure" : categoryLabel(r.key), r.count]) }}>
              <Bar data={{ labels: d.scans_by_category.map((r) => (r.key === "uncertain" ? "Not sure" : categoryLabel(r.key))), datasets: [{ label: "Scans", data: d.scans_by_category.map((r) => r.count), backgroundColor: PALETTE[4] }] }} options={axes as ChartOptions<"bar">} />
            </ChartCard>
          </div>
        </>
      )}
    </>
  );
}
