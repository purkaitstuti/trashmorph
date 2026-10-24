import { useQuery } from "@tanstack/react-query";
import { Bell, Menu, Recycle, X } from "lucide-react";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { api } from "../lib/api";
import { isSupabaseConfigured } from "../lib/supabase";
import { useAuth } from "../providers/AuthProvider";
import { ThemeToggle } from "./ThemeToggle";

type L = readonly (readonly [string, string])[];
const publicLinks: L = [["/", "Home"], ["/marketplace", "Marketplace"], ["/recyclers", "Recyclers"], ["/recycling-guide", "Recycling guide"], ["/about", "About"], ["/contact", "Contact"]];
const mainLinks: L = [["/dashboard", "Dashboard"], ["/scanner", "Scanner"], ["/marketplace", "Marketplace"], ["/recyclers", "Recyclers"], ["/collections", "Collections"], ["/my-listings", "My listings"]];
const accountLinks: L = [["/greenscore", "GreenScore"], ["/analytics", "Analytics"], ["/saved", "Saved"], ["/inquiries", "Inquiries"], ["/recycling-guide", "Recycling guide"], ["/profile", "Profile"], ["/settings", "Settings"]];

function Logo() {
  return <Link to="/" className="flex items-center gap-2 font-display text-lg font-bold"><Recycle className="h-6 w-6 text-primary" aria-hidden />TRASHMORPH</Link>;
}

export function Layout() {
  const { user, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const navigate = useNavigate();
  useEffect(() => setOpen(false), [pathname]);

  const unread = useQuery({ queryKey: ["unread", user?.id], queryFn: () => api<{ count: number }>("/api/v1/notifications/unread-count"), enabled: !!user, refetchInterval: 60_000 });
  const n = unread.data?.count ?? 0;
  const desktop = user ? mainLinks : publicLinks;
  const mobile = user ? [...mainLinks, ...accountLinks] : publicLinks;
  const cls = ({ isActive }: { isActive: boolean }) => `rounded-md px-3 py-2 text-sm font-semibold ${isActive ? "bg-subtle text-ink" : "text-muted hover:text-ink"}`;

  async function logout() {
    try { await signOut(); navigate("/", { replace: true }); } catch { toast.error("Couldn't sign you out. Try again."); }
  }

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:p-2">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-line bg-bg/95 backdrop-blur" style={{ paddingTop: "env(safe-area-inset-top, 0px)" }}>
        <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-2 px-4" aria-label="Main">
          <Logo />
          <div className="hidden items-center gap-1 xl:flex">
            {desktop.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"} className={cls}>{label}</NavLink>)}
          </div>
          <div className="flex items-center gap-2">
            {user && (
              <Link to="/notifications" className="btn-outline relative h-11 w-11 !p-0" aria-label={n ? `Notifications, ${n} unread` : "Notifications"}>
                <Bell className="h-5 w-5" aria-hidden />
                {n > 0 && <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1.5 text-xs font-bold text-primary-fg">{n > 99 ? "99+" : n}</span>}
              </Link>
            )}
            <ThemeToggle />
            <div className="hidden items-center gap-2 xl:flex">
              {user ? (
                <details key={pathname} className="relative">
                  <summary className="btn-outline cursor-pointer list-none">Account</summary>
                  <div className="absolute right-0 z-50 mt-2 w-48 rounded-lg border border-line bg-surface p-1 shadow-lg">
                    {accountLinks.map(([to, label]) => <Link key={to} to={to} className="block rounded-md px-3 py-2 text-sm hover:bg-subtle">{label}</Link>)}
                    <button className="block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-subtle" onClick={logout}>Sign out</button>
                  </div>
                </details>
              ) : <><Link to="/login" className="btn-outline">Sign in</Link><Link to="/register" className="btn-primary">Get started</Link></>}
            </div>
            <button type="button" className="btn-outline h-11 w-11 !p-0 xl:hidden" aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Close menu" : "Open menu"} onClick={() => setOpen((o) => !o)}>
              {open ? <X className="h-5 w-5" aria-hidden /> : <Menu className="h-5 w-5" aria-hidden />}
            </button>
          </div>
        </nav>
        {open && (
          <div id="mobile-menu" className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-line px-4 py-3 xl:hidden">
            <div className="flex flex-col gap-1">
              {mobile.map(([to, label]) => <NavLink key={to} to={to} end={to === "/"} className={cls}>{label}</NavLink>)}
              {user ? <button className="btn-outline mt-2" onClick={logout}>Sign out</button> : <><Link to="/login" className="btn-outline mt-2">Sign in</Link><Link to="/register" className="btn-primary">Get started</Link></>}
            </div>
          </div>
        )}
      </header>
      {!isSupabaseConfigured && (
        <p role="status" className="bg-subtle px-4 py-2 text-center text-sm">Supabase isn't configured. Copy <code>.env.example</code> to <code>.env</code> and add your project keys to enable sign-in.</p>
      )}
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-10"><Outlet /></main>
      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <div><Logo /><p className="mt-2">Smarter waste management. Cleaner communities. A greener future.</p></div>
          <div className="flex flex-wrap gap-4">
            <Link to="/recycling-guide" className="hover:text-ink">Recycling guide</Link><Link to="/about" className="hover:text-ink">About</Link>
            <Link to="/contact" className="hover:text-ink">Help &amp; contact</Link><Link to="/privacy" className="hover:text-ink">Privacy</Link><Link to="/terms" className="hover:text-ink">Terms</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
