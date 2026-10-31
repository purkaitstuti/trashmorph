import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ErrorNote, Field, PageHeader, Spinner } from "../components/ui";
import { api, type Profile } from "../lib/api";
import { useAuth } from "../providers/AuthProvider";

type DailyLog = { id: string; logged_on: string; biodegradable_items: string[]; non_biodegradable_items: string[] };
type Cycle = { id: string; household_id: string; location_label: string; started_at: string; expires_at: string; days_logged: number; target_days: number; logs: DailyLog[] };
type Pickup = { id: string; cycle_id: string; household_id: string; recycler_id: string; message: string | null; status: string; created_at: string; cycle?: { location_label: string; expires_at: string }; other_party?: { full_name?: string; recycler_organization?: string; recycler_location?: string; recycler_contact?: string } | null };
type Overview = { cycles: Cycle[]; requests: Pickup[] };
type Page<T> = { items: T[]; total: number; page: number; page_size: number };

const err = (e: unknown) => e instanceof Error ? e.message : "Something went wrong.";
const lines = (value: string) => value.split("\n").map((s) => s.trim()).filter(Boolean);
const dateLabel = (value: string) => new Date(value).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

function DaysMeter({ cycle }: { cycle: Cycle }) {
  const pct = Math.min(100, (cycle.days_logged / cycle.target_days) * 100);
  return <div className="mt-3"><div className="flex justify-between text-sm"><strong>{cycle.days_logged}/{cycle.target_days} days logged</strong><span className="text-muted">Log window: 35 days</span></div><div className="mt-2 h-2 overflow-hidden rounded-full bg-subtle"><div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} /></div><p className="mt-1 text-xs text-muted">Started {dateLabel(cycle.started_at)} · entries are deleted after {dateLabel(cycle.expires_at)}</p></div>;
}

function ItemGroup({ title, items }: { title: string; items: string[] }) {
  return <div className="rounded-lg bg-subtle p-3"><h4 className="text-sm font-semibold">{title}</h4>{items.length ? <ul className="mt-1 list-inside list-disc text-sm text-muted">{items.map((item, i) => <li key={`${item}-${i}`}>{item}</li>)}</ul> : <p className="mt-1 text-sm text-muted">No items logged</p>}</div>;
}

function HouseholdView({ profile }: { profile: Profile }) {
  const qc = useQueryClient();
  const overview = useQuery({ queryKey: ["household-waste-overview"], queryFn: () => api<Overview>("/api/v1/household-waste/overview") });
  const [bio, setBio] = useState(""); const [nonBio, setNonBio] = useState(""); const [location, setLocation] = useState(profile.preferred_location ?? "");
  const today = new Date().toISOString().slice(0, 10);
  const cycle = overview.data?.cycles[0];
  const todayLog = cycle?.logs.find((log) => log.logged_on === today);
  useEffect(() => { setBio(todayLog?.biodegradable_items.join("\n") ?? ""); setNonBio(todayLog?.non_biodegradable_items.join("\n") ?? ""); }, [todayLog?.id, today]);
  const save = useMutation({
    mutationFn: () => api("/api/v1/household-waste/logs", { method: "POST", body: { location_label: location.trim() || null, biodegradable_items: lines(bio), non_biodegradable_items: lines(nonBio) } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["household-waste-overview"] }); toast.success("Today's household waste was saved."); },
    onError: (e) => toast.error(err(e)),
  });
  const updateRequest = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api(`/api/v1/household-waste/requests/${id}/status`, { method: "POST", body: { status } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["household-waste-overview"] }); toast.success("Pickup request updated."); }, onError: (e) => toast.error(err(e)),
  });
  const activeRequests = overview.data?.requests ?? [];
  return <>
    <PageHeader title="Household Waste Pickup">Log the waste your household produces each day. Only recycler accounts can see active logs and request collection.</PageHeader>
    {overview.isLoading && <Spinner />}{overview.isError && <ErrorNote>{err(overview.error)}</ErrorNote>}
    {cycle && <section className="card mb-5"><h2 className="text-lg font-semibold">Current log · {cycle.location_label}</h2><DaysMeter cycle={cycle} /><div className="mt-4 grid gap-3 md:grid-cols-2">{cycle.logs.map((log) => <article key={log.id} className="rounded-xl border border-line p-3"><h3 className="mb-2 text-sm font-semibold">{dateLabel(`${log.logged_on}T12:00:00`)}</h3><div className="grid gap-2 sm:grid-cols-2"><ItemGroup title="Biodegradable" items={log.biodegradable_items} /><ItemGroup title="Non-biodegradable" items={log.non_biodegradable_items} /></div></article>)}</div></section>}
    {activeRequests.length > 0 && <section className="card mb-5"><h2 className="text-lg font-semibold">Recycler pickup requests</h2><ul className="mt-3 space-y-3">{activeRequests.map((r) => <li key={r.id} className="rounded-xl border border-line p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-semibold">{r.other_party?.recycler_organization || r.other_party?.full_name || "Recycler"} · <span className="capitalize">{r.status}</span></p><p className="text-sm text-muted">{r.other_party?.recycler_location}</p>{r.status !== "requested" && r.other_party?.recycler_contact && <p className="mt-1 text-sm">Contact: {r.other_party.recycler_contact}</p>}{r.message && <p className="mt-2 text-sm">{r.message}</p>}</div>{r.status === "requested" && <div className="flex gap-2"><button className="btn-primary" onClick={() => updateRequest.mutate({ id: r.id, status: "accepted" })}>Accept</button><button className="btn-outline" onClick={() => updateRequest.mutate({ id: r.id, status: "declined" })}>Decline</button></div>}{r.status === "accepted" && <button className="btn-outline" onClick={() => updateRequest.mutate({ id: r.id, status: "cancelled" })}>Cancel</button>}</div></li>)}</ul></section>}
    <section className="card max-w-3xl"><h2 className="text-xl font-semibold">Log today’s items</h2><p className="mt-1 text-sm text-muted">You can edit today's entry during the day. Keep each item on its own line.</p>
      {!cycle && <Field label="Household location" placeholder="City or neighbourhood" value={location} onChange={(e) => setLocation(e.target.value)} hint="Shown to recyclers so they can decide whether they can collect." />}
      <div className="mt-4 grid gap-4 md:grid-cols-2"><label className="block text-sm font-semibold" htmlFor="bio-items">Biodegradable waste<textarea id="bio-items" className="input mt-1 min-h-36" value={bio} onChange={(e) => setBio(e.target.value)} placeholder={'Vegetable peels\nTea leaves'} /></label><label className="block text-sm font-semibold" htmlFor="nonbio-items">Non-biodegradable waste<textarea id="nonbio-items" className="input mt-1 min-h-36" value={nonBio} onChange={(e) => setNonBio(e.target.value)} placeholder={'Plastic packaging\nGlass jar'} /></label></div>
      <button className="btn-primary mt-4" disabled={save.isPending || (!lines(bio).length && !lines(nonBio).length && !todayLog) || (!cycle && location.trim().length < 2)} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : todayLog ? "Update today's log" : "Save today's log"}</button>
    </section>
    {overview.data?.cycles.length === 0 && <p className="mt-3 text-sm text-muted">Your first log starts a 35-day household pickup cycle.</p>}
  </>;
}

function RecyclerView() {
  const qc = useQueryClient();
  const cycles = useQuery({ queryKey: ["household-waste-available"], queryFn: () => api<Page<Cycle>>("/api/v1/household-waste/available") });
  const requests = useQuery({ queryKey: ["household-waste-requests"], queryFn: () => api<{ items: Pickup[] }>("/api/v1/household-waste/requests") });
  const [messages, setMessages] = useState<Record<string, string>>({});
  const create = useMutation({
    mutationFn: (cycle_id: string) => api("/api/v1/household-waste/requests", { method: "POST", body: { cycle_id, message: messages[cycle_id] ?? "" } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["household-waste-available"] }); void qc.invalidateQueries({ queryKey: ["household-waste-requests"] }); toast.success("Pickup request sent to the household."); }, onError: (e) => toast.error(err(e)),
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api(`/api/v1/household-waste/requests/${id}/status`, { method: "POST", body: { status } }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ["household-waste-requests"] }); toast.success("Pickup request updated."); }, onError: (e) => toast.error(err(e)),
  });
  const alreadyRequested = new Set((requests.data?.items ?? []).filter((r) => ["requested", "accepted"].includes(r.status)).map((r) => r.cycle_id));
  return <>
    <PageHeader title="Household Waste Pickup">Browse household daily waste logs and request a collection when your organization can serve the area.</PageHeader>
    <section className="mb-5"><h2 className="mb-3 text-xl font-semibold">Pickup requests</h2>{requests.isLoading && <Spinner />}{requests.isError && <ErrorNote>{err(requests.error)}</ErrorNote>}
      {requests.data?.items.length === 0 && <p className="text-sm text-muted">You haven't requested any household pickups yet.</p>}
      <div className="grid gap-3">{requests.data?.items.map((r) => <article key={r.id} className="card"><p className="font-semibold">{r.other_party?.full_name || "Household"} · <span className="capitalize">{r.status}</span></p><p className="text-sm text-muted">{r.cycle?.location_label}{r.other_party?.recycler_contact ? ` · ${r.other_party.recycler_contact}` : ""}</p>{r.status === "accepted" && <button className="btn-primary mt-3" onClick={() => update.mutate({ id: r.id, status: "completed" })}>Mark collected</button>}{r.status === "requested" && <button className="btn-outline mt-3" onClick={() => update.mutate({ id: r.id, status: "cancelled" })}>Cancel request</button>}</article>)}</div>
    </section>
    <h2 className="mb-3 text-xl font-semibold">Active household logs</h2>{cycles.isLoading && <Spinner />}{cycles.isError && <ErrorNote>{err(cycles.error)}</ErrorNote>}
    {cycles.data?.items.length === 0 && <div className="card text-sm text-muted">No active household waste logs are available right now.</div>}
    <div className="grid gap-4 lg:grid-cols-2">{cycles.data?.items.map((cycle) => <article key={cycle.id} className="card"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wide text-primary">Household pickup</p><h3 className="mt-1 text-lg font-semibold">{cycle.location_label}</h3></div><span className="badge">{cycle.days_logged}/{cycle.target_days} days logged</span></div><DaysMeter cycle={cycle} /><div className="mt-4 space-y-3">{cycle.logs.map((log) => <div key={log.id}><h4 className="mb-1 text-sm font-semibold">{dateLabel(`${log.logged_on}T12:00:00`)}</h4><div className="grid gap-2 sm:grid-cols-2"><ItemGroup title="Biodegradable" items={log.biodegradable_items} /><ItemGroup title="Non-biodegradable" items={log.non_biodegradable_items} /></div></div>)}</div><p className="mt-3 text-xs text-muted">Available until {dateLabel(cycle.expires_at)}. Household approval is required before pickup is confirmed.</p>
      {!alreadyRequested.has(cycle.id) ? <div className="mt-4 space-y-2"><label className="block text-sm font-semibold" htmlFor={`pickup-${cycle.id}`}>Message to household (optional)<textarea id={`pickup-${cycle.id}`} className="input mt-1" rows={2} maxLength={500} value={messages[cycle.id] ?? ""} onChange={(e) => setMessages((prev) => ({ ...prev, [cycle.id]: e.target.value }))} placeholder="Introduce your organization and suggest a pickup time" /></label><button className="btn-primary" disabled={create.isPending} onClick={() => create.mutate(cycle.id)}>Request to collect</button></div> : <p className="mt-4 text-sm font-semibold text-muted">You already have an open request for this household.</p>}
    </article>)}</div>
  </>;
}

export function HouseholdWastePage() {
  const { user } = useAuth();
  const profile = useQuery({ queryKey: ["profile", user?.id], queryFn: () => api<Profile>("/api/v1/profiles/me"), enabled: !!user });
  if (profile.isLoading) return <Spinner />;
  if (profile.isError || !profile.data) return <ErrorNote>{err(profile.error)}</ErrorNote>;
  return profile.data.role === "recycler" ? <RecyclerView /> : profile.data.role === "user" ? <HouseholdView profile={profile.data} /> : <><PageHeader title="Household Waste Pickup" /><ErrorNote>This feature isn't available for administrator accounts.</ErrorNote></>;
}
