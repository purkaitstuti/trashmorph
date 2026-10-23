# TRASHMORPH — Stage 1 (foundation and authentication)

Stack: React + TypeScript + Vite + Tailwind (frontend), FastAPI (backend), Supabase (Postgres, Auth, Storage), Render (hosting).

## What's in Stage 1
- Light/dark/system theme (no flash on load, persisted, shared by every page)
- Supabase email/password sign-up, email verification, login, Google OAuth, forgot/reset password, logout, session restore
- Protected routes (UX gate) plus backend JWT verification and database Row-Level Security (real enforcement)
- Profile (name, location, photo upload), settings (theme, notification preferences), password reset, account deletion
- Public pages: home, about, recycling guide (searchable), contact (stored in the database), privacy, terms
- SQL migration with RLS, `render.yaml`, tests

Not built yet (Stage 2): scanner, listings, recyclers map, marketplace, collections, GreenScore, analytics, notifications. These appear as "Coming soon" and nothing fakes them.

## Setup
1. **Supabase**: create a project. In the SQL editor run `supabase/migrations/0001_foundation.sql`.
2. **Auth settings** (Authentication > URL Configuration): Site URL = your frontend URL. Add redirect URLs:
   `http://localhost:5173/auth/callback`, `http://localhost:5173/reset-password`, and the same two paths on your production URL.
3. **Google OAuth**: Google Cloud Console > APIs & Services > Credentials > OAuth client (Web). Authorized redirect URI = `https://<project-ref>.supabase.co/auth/v1/callback`. Paste the client ID and secret into Supabase > Authentication > Providers > Google. The secret stays in Supabase, never in this repo.
4. **Backend**: `cd backend && python -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt`, copy `.env.example` to `.env`, fill it in, then `uvicorn app.main:app --reload`. Tests: `pytest`.
   - `SUPABASE_JWT_SECRET` is only needed if your project still uses the legacy HS256 secret. Newer projects use asymmetric keys, verified through the JWKS URL automatically.
   - `SUPABASE_SERVICE_ROLE_KEY` is server-only. It is used just for account deletion and contact messages. Without it those two features return a clear error.
5. **Frontend**: `cd frontend && cp .env.example .env`, fill it in, `npm install` (this creates `package-lock.json`; commit it, Render uses `npm ci`), then `npm run dev`. Tests: `npm test`.

## Deploy on Render
Push to GitHub, then Render > New > Blueprint and select the repo (`render.yaml` defines both services). Set the secret env vars in the dashboard:
- API: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, optionally `SUPABASE_JWT_SECRET`, and `CORS_ORIGINS` = your static site URL (exact origin, no trailing slash).
- Web: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL` = your API URL.
Then add the production URLs to Supabase's redirect list. The SPA rewrite for React Router is already in `render.yaml`. The free web tier sleeps when idle, so the first request can be slow.

## Verify after deploy (checklist)
Frontend loads and deep links survive refresh; `/health` returns ok; sign-up, verification email, login, logout; Google login; password reset; `/dashboard` redirects when signed out; profile edit and photo upload; contact form saves a row; theme persists after refresh; a second account cannot read the first account's profile.

## Known limitations
- Contact rate limit is in memory (per server instance).
- Privacy and Terms pages are plain-language drafts, not legal advice. Have them reviewed before launch.
- Email notifications are not implemented; the setting is stored only.

## Tests: status
Written but **not run in the environment that generated this code** (no network to install dependencies). Run `pytest` and `npm test` locally and fix anything that surfaces.
