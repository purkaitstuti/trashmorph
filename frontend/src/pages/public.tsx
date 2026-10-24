import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowRight, BarChart3, Leaf, MapPin, ScanLine, ShoppingBag, Truck } from "lucide-react";
import { useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import toast from "react-hot-toast";
import { Link } from "react-router-dom";
import type { z } from "zod";
import { ErrorNote, Field, PageHeader } from "../components/ui";
import { ApiError, api } from "../lib/api";
import { contactSchema } from "../lib/schemas";
import { useAuth } from "../providers/AuthProvider";

const features = [
  { icon: ScanLine, title: "AI waste scanner", text: "Photograph an item and get a suggested category and disposal guidance.", live: true, badge: "Works once a model is configured" },
  { icon: MapPin, title: "Recycler discovery", text: "Find recycling and reuse options on a map, filtered by material.", live: true },
  { icon: ShoppingBag, title: "Reuse marketplace", text: "List items you no longer need and find reusable materials from others.", live: true },
  { icon: Truck, title: "Collection tracking", text: "Coordinate pickups and follow each request from start to finish.", live: true },
  { icon: Leaf, title: "GreenScore", text: "Earn points for recorded recycling and reuse activity.", live: true },
  { icon: BarChart3, title: "Impact analytics", text: "See your activity over time, built only from your own records.", live: true },
];

const journey = ["Plastic bottle", "Sorted and washed", "Shredded into flakes", "Spun into fibre", "Fleece jacket"];

export function HomePage() {
  const { user } = useAuth();
  return (
    <>
      <section className="grid items-center gap-10 py-6 lg:grid-cols-2">
        <div>
          <h1 className="text-4xl font-bold leading-[1.05] sm:text-6xl">Give your waste a second life.</h1>
          <p className="mt-5 max-w-xl text-lg text-muted">Identify waste with AI, discover nearby recycling opportunities, connect with recyclers, and track your environmental impact—all in one place.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to={user ? "/dashboard" : "/register"} className="btn-primary">Get started<ArrowRight className="h-4 w-4" aria-hidden /></Link>
            <a href="#features" className="btn-outline">Explore features</a>
          </div>
        </div>
        <figure className="card">
          <figcaption className="mb-4 text-sm text-muted">One example of what recycling can turn a bottle into:</figcaption>
          <ol className="space-y-0">
            {journey.map((step, i) => (
              <li key={step} className="flex items-center gap-3 py-2.5">
                <span className={`h-3 w-3 shrink-0 rounded-full ${i === journey.length - 1 ? "bg-primary" : "border-2 border-primary"}`} aria-hidden />
                <span className={i === journey.length - 1 ? "font-display text-xl font-bold" : ""}>{step}</span>
              </li>
            ))}
          </ol>
        </figure>
      </section>

      <section id="features" className="scroll-mt-24 py-14">
        <h2 className="text-3xl font-bold">What you can do</h2>
        <p className="mt-2 max-w-2xl text-muted">Some features depend on how the site is set up. Where that applies, the card says so.</p>
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, text, live, badge }: { icon: typeof ScanLine; title: string; text: string; live: boolean; badge?: string }) => (
            <article key={title} className="card">
              <Icon className="h-6 w-6 text-primary" aria-hidden />
              <h3 className="mt-3 text-lg font-semibold">{title}</h3>
              <p className="mt-1 text-muted">{text}</p>
              {(!live || badge) && <span className="badge mt-3">{badge ?? "Coming soon"}</span>}
            </article>
          ))}
        </div>
      </section>

      <section className="py-10">
        <h2 className="text-3xl font-bold">How it works</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {[["Identify", "Scan an item to see what it is and how to dispose of it."], ["Connect", "Find a recycler, or list the item for someone to reuse."], ["Track", "Follow the request and see your activity add up."]].map(([t, d], i) => (
            <li key={t} className="card"><span className="font-display text-2xl font-bold text-primary">{i + 1}</span><h3 className="mt-1 text-lg font-semibold">{t}</h3><p className="mt-1 text-muted">{d}</p></li>
          ))}
        </ol>
      </section>

      <section className="card mt-6">
        <h2 className="text-2xl font-bold">Honest numbers only</h2>
        <p className="mt-2 max-w-3xl text-muted">TRASHMORPH never shows invented statistics. Impact figures appear only when they come from real recorded activity, and any estimate will state how it was calculated. A scan or a listing is not counted as recycled material.</p>
      </section>
    </>
  );
}

export function AboutPage() {
  return (
    <article className="max-w-3xl space-y-6">
      <PageHeader title="About TRASHMORPH">Waste is easier to reduce when sorting, reuse and recycling are easy to find.</PageHeader>
      <section><h2 className="text-2xl font-bold">The problem</h2><p className="mt-2 text-muted">Many people aren't sure what an item is made of, whether it can be recycled, or where to take it. Reusable items and materials often end up as general waste because nobody nearby knew they were available.</p></section>
      <section><h2 className="text-2xl font-bold">What the platform does</h2><p className="mt-2 text-muted">TRASHMORPH brings together an image-based waste scanner, a map of recycling and reuse options, a listing board for reusable materials, and collection tracking, with a record of your own activity.</p></section>
      <section><h2 className="text-2xl font-bold">The role of AI</h2><p className="mt-2 text-muted">The scanner will suggest a waste category from a photo. It is guidance, not a guarantee: results can be wrong, and local recycling rules decide what is actually accepted. Low-confidence results will be labelled as uncertain.</p></section>
      <section><h2 className="text-2xl font-bold">Why recycle and reuse</h2><p className="mt-2 text-muted">Reuse keeps items in circulation, and recycling recovers materials that would otherwise be made from new resources. Reusing something is usually better than recycling it, and recycling is better than sending it to landfill.</p></section>
    </article>
  );
}

const guide = [
  { name: "Paper and cardboard", sort: "Keep dry and clean. Flatten boxes.", prep: "Remove tape and plastic windows where practical. Greasy or food-soiled paper (such as pizza box lids) usually can't be recycled.", where: "Kerbside paper collection or a local recycling point." },
  { name: "Plastic", sort: "Check the number in the recycling symbol and your local rules; not every type is accepted.", prep: "Empty and rinse. Leave caps on only if your local scheme says so.", where: "Kerbside collection or a plastics drop-off point." },
  { name: "Glass", sort: "Separate by colour if your local scheme asks you to.", prep: "Empty and rinse. Remove lids. Don't mix in ceramics, mirrors or window glass.", where: "Bottle banks or kerbside glass collection." },
  { name: "Metal", sort: "Cans and clean foil are widely recyclable. Larger scrap metal can be sold.", prep: "Rinse food cans. Crush aluminium cans only if local guidance allows.", where: "Kerbside collection or a scrap dealer for larger items." },
  { name: "Electronic waste", sort: "Keep separate from household waste. It can contain hazardous materials.", prep: "Back up and wipe personal data from devices. Keep items intact where possible.", where: "Authorised e-waste collection points, retailer take-back schemes, or repair and donation first." },
  { name: "Batteries", sort: "Never put batteries in general waste or recycling bins. They can start fires.", prep: "Tape the terminals of lithium batteries. Store in a dry, non-metal container.", where: "Battery drop-off bins at shops or collection points." },
  { name: "Organic waste", sort: "Food scraps, garden waste and other biodegradable material.", prep: "Remove packaging. Avoid meat and dairy in home compost.", where: "Home composting, a council food-waste service, or a community composting site." },
  { name: "Textiles", sort: "Wearable items can be donated. Worn-out items may go to textile recycling.", prep: "Wash and dry. Keep pairs of shoes together.", where: "Charity shops, clothing banks, or repair and swap events." },
  { name: "General waste", sort: "Items that can't be reused or recycled locally.", prep: "Bag securely. Check first whether the item has another option.", where: "Your normal household or council collection." },
];

export function RecyclingGuidePage() {
  const [q, setQ] = useState("");
  const items = useMemo(() => guide.filter((g) => `${g.name} ${g.sort} ${g.prep} ${g.where}`.toLowerCase().includes(q.trim().toLowerCase())), [q]);
  return (
    <>
      <PageHeader title="Recycling guide">General guidance for common materials. Recycling rules differ by area, so always follow your local authority's instructions.</PageHeader>
      <div className="max-w-md"><Field label="Search the guide" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. batteries, glass" /></div>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        {items.map((g) => (
          <article key={g.name} className="card">
            <h2 className="text-xl font-semibold">{g.name}</h2>
            <dl className="mt-3 space-y-2 text-sm">
              <div><dt className="font-semibold">Sorting</dt><dd className="text-muted">{g.sort}</dd></div>
              <div><dt className="font-semibold">Preparing</dt><dd className="text-muted">{g.prep}</dd></div>
              <div><dt className="font-semibold">Where it can go</dt><dd className="text-muted">{g.where}</dd></div>
            </dl>
          </article>
        ))}
      </div>
      {items.length === 0 && <p className="mt-6 text-muted">No guidance matches “{q}”. Try a material like plastic or glass.</p>}
    </>
  );
}

const faqs = [
  ["Is TRASHMORPH free?", "Creating an account and using the available features is free. We'll say clearly if that ever changes."],
  ["Can the scanner be wrong?", "Yes. It gives a suggestion, not a guarantee. Check local rules before disposing of an item."],
  ["Do you arrange pickups?", "Collection tracking is a coordination tool. It doesn't guarantee that a collector will accept a request."],
  ["How do I delete my account?", "Open Settings and choose Delete account. This permanently removes your account and uploaded photo."],
];

export function ContactPage() {
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm<z.infer<typeof contactSchema>>({ resolver: zodResolver(contactSchema) });
  const onSubmit = handleSubmit(async (v) => {
    setError(null);
    try { await api("/api/v1/contact", { method: "POST", body: v, auth: false }); setSent(true); reset(); toast.success("Message sent"); }
    catch (e) { setError(e instanceof ApiError && e.status === 503 ? "Messages can't be received right now. Please try again later." : e instanceof Error ? e.message : "Couldn't send your message."); }
  });
  return (
    <>
      <PageHeader title="Help and contact">Browse the answers below or send us a message.</PageHeader>
      <div className="grid gap-8 lg:grid-cols-2">
        <section aria-labelledby="faq"><h2 id="faq" className="text-2xl font-bold">Frequently asked questions</h2>
          <div className="mt-4 space-y-3">{faqs.map(([q, a]) => <details key={q} className="card"><summary className="cursor-pointer font-semibold">{q}</summary><p className="mt-2 text-muted">{a}</p></details>)}</div>
          <p className="mt-4 text-sm text-muted">Need recycling advice? See the <Link to="/recycling-guide" className="font-semibold text-primary underline">recycling guide</Link>.</p>
        </section>
        <section aria-labelledby="msg"><h2 id="msg" className="text-2xl font-bold">Send a message</h2>
          {sent ? <div className="card mt-4"><p>Thanks. We received your message.</p><button className="btn-outline mt-3" onClick={() => setSent(false)}>Send another</button></div> : (
            <form noValidate onSubmit={onSubmit} className="card mt-4 space-y-4">
              {error && <ErrorNote>{error}</ErrorNote>}
              <Field label="Name" autoComplete="name" error={errors.name?.message} {...register("name")} />
              <Field label="Email" type="email" autoComplete="email" error={errors.email?.message} {...register("email")} />
              <div><label htmlFor="message" className="mb-1 block text-sm font-semibold">Message</label>
                <textarea id="message" rows={5} className="input" aria-invalid={!!errors.message} {...register("message")} />
                {errors.message && <p role="alert" className="mt-1 text-sm text-danger">{errors.message.message}</p>}</div>
              <button className="btn-primary" disabled={isSubmitting}>{isSubmitting ? "Sending…" : "Send message"}</button>
            </form>
          )}
        </section>
      </div>
    </>
  );
}

export function PrivacyPage() {
  return (
    <article className="max-w-3xl space-y-5">
      <PageHeader title="Privacy Policy">How TRASHMORPH handles your data.</PageHeader>
      {[
        ["What we collect", "Your email address, name and password (handled by our authentication provider, Supabase; we never see or store your password). If you add them, a profile photo and a preferred location. Messages you send through the contact form."],
        ["How we use it", "To run your account, show your profile, and respond to your messages. We don't sell your data."],
        ["Photos", "Your profile photo is stored in a public bucket so it can be displayed. Don't upload anything you don't want to be publicly viewable."],
        ["Location", "We only read your device location when you press a location button, and only after your browser asks permission. To turn coordinates into a place name or to search for a place, your coordinates or search text are sent to OpenStreetMap's Nominatim service. Coordinates you choose to save on a listing or recycler suggestion are stored with it. A preferred location in your profile is text you type and can change or remove at any time."],
        ["Where data is stored", "In Supabase (database, authentication and file storage). Access to your records is restricted to your account by database security rules."],
        ["Deleting your data", "Delete your account in Settings to permanently remove your account, profile, settings and uploaded photo. Contact messages are kept so we can respond and may be removed on request."],
        ["Changes", "We'll update this page if our practices change as new features are added."],
      ].map(([h, p]) => <section key={h}><h2 className="text-xl font-bold">{h}</h2><p className="mt-1 text-muted">{p}</p></section>)}
    </article>
  );
}

export function TermsPage() {
  return (
    <article className="max-w-3xl space-y-5">
      <PageHeader title="Terms of Service">The basic rules for using TRASHMORPH.</PageHeader>
      {[
        ["Using the service", "You must provide accurate account details and keep your password secure. You're responsible for activity on your account."],
        ["Guidance, not guarantees", "Waste classification and recycling guidance are suggestions. Local rules decide what can be recycled. We don't guarantee any item will be accepted."],
        ["Your content", "You're responsible for what you upload or post and must have the right to share it. We may remove content that is unlawful, unsafe or misleading."],
        ["Coordination only", "TRASHMORPH helps people connect. It doesn't process payments or guarantee that a pickup or exchange will happen."],
        ["Ending your account", "You can delete your account at any time in Settings. We may suspend accounts that misuse the service."],
        ["Changes", "We may update these terms as the service grows. Continued use means you accept the updated terms."],
      ].map(([h, p]) => <section key={h}><h2 className="text-xl font-bold">{h}</h2><p className="mt-1 text-muted">{p}</p></section>)}
    </article>
  );
}

export function NotFoundPage() {
  return <div className="py-16 text-center"><h1 className="text-4xl font-bold">Page not found</h1><p className="mt-2 text-muted">That address doesn't exist or has moved.</p><Link to="/" className="btn-primary mt-6">Back to home</Link></div>;
}
