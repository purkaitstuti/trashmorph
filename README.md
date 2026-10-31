# TRASHMORPH — Stages 1 to 9

Stack: React + TypeScript + Vite + Tailwind (frontend), FastAPI (backend), Supabase (Postgres, Auth, Storage), Render (hosting).

## What's in Stage 1
- Light/dark/system theme (no flash on load, persisted, shared by every page)
- Supabase email/password sign-up, email verification, login, Google OAuth, forgot/reset password, logout, session restore
- Protected routes (UX gate) plus backend JWT verification and database Row-Level Security (real enforcement)
- Profile (name, location, photo upload), settings (theme, notification preferences), password reset, account deletion
- Public pages: home, about, recycling guide (searchable), contact (stored in the database), privacy, terms
- SQL migration with RLS, `render.yaml`, tests

## Added in Stage 2: listings, marketplace, notifications
- Create, edit, publish, mark reserved/collected/completed/unavailable, and delete your own listings (up to 5 photos each). Status changes are checked by the API and again by a database trigger.
- Public marketplace with search, category/type/location/max-price filters, sorting and pagination; listing detail pages with seller name and photo only (no email).
- Save/unsave listings, send one inquiry per listing (optional reply-contact text the sender chooses to share), report a listing.
- In-app notifications created by the database when someone sends you an inquiry (respecting your in-app preference), unread badge, mark read/all read.
- Dashboard numbers come only from your own records.
- **Run `supabase/migrations/0002_marketplace.sql` in the SQL editor after 0001.**
- Reports are stored but there is no admin review screen yet. Photos of deleted listings stay in storage until you delete your account; priced listings are display-only (no payments).

## Added in Stage 3: recyclers map, collections, GreenScore
- **Run `supabase/migrations/0003_collections_greenscore_recyclers.sql` after 0002**, then `npm install` in `frontend` (new deps: leaflet, react-leaflet) and commit the updated `package-lock.json`.
- **Recyclers:** Leaflet + OpenStreetMap map and list, filters by material and type, search by place or your location with a radius, directions links. Only records in your database are shown; nothing is seeded. Signed-in users can suggest a recycler; suggestions are `pending` and visible only to the submitter until you review them in the Supabase SQL editor:
  `update public.recyclers set verification_status = 'community' where id = '<id>';` (use `'verified'` for places you've checked yourself, `'rejected'` to decline).
- **Collections:** from a listing, request a collection (date, time window, instructions). The lister accepts or declines, then marks scheduled, in progress and completed; either side can cancel after acceptance, and only the requester can cancel before. All changes go through one database function that checks who may do what, reserves/releases the listing, writes the timestamped history and notifies the other person. This is coordination only; TRASHMORPH doesn't arrange or guarantee pickups.
- **GreenScore:** points are awarded only by the database: 5 for publishing a listing (3/day), 20 for collecting and 15 for handing over when the lister completes a request (5/day each), once per event. Clients can't write points. Badges and levels use fixed thresholds shown on the page. It is an engagement score, not an environmental measurement. Two cooperating accounts could still inflate scores within the daily limits.
- **Location button on listings** now fills the location box (via OpenStreetMap's Nominatim reverse lookup) as well as saving coordinates. Nominatim and the OSM tile servers are free public services with usage policies; they're fine for development and small sites, but a busy production site should use its own tile/geocoding provider.
- Existing Stage 2 listings don't get retroactive points.

## Added in Stage 4: AI scanner and analytics
- **Run `supabase/migrations/0004_scanner.sql` after 0003**, `pip install -r requirements.txt` again (adds Pillow and python-multipart), and `npm install` in `frontend` (adds chart.js and react-chartjs-2); commit the updated lockfile.
- **Scanner:** upload or take a photo, see an overall suggestion and four image-region suggestions, each with confidence and guidance. Select region suggestions, edit the item and listing details, and publish multiple separate active listings from one scan. Region suggestions come from a material classifier, not an object detector; the same item may appear in multiple regions, so review selections and crops before publishing. Uploads are validated by their real content, size-limited and rate-limited. Results below the confidence threshold are reported as "Not sure". History keeps private photos (optional, per scan) with short-lived signed links, and every scan can be deleted.
- **Local scanner model:** this workspace has a 5.81 MB ONNX waste classifier in `backend/model/` (weights are ignored by Git; see `backend/ml_training/README.md` to fetch it again). Install the backend and scanner dependencies in the same Python environment that runs Uvicorn with `pip install -r requirements.txt -r requirements-ml.txt`. The classifier uses `backend/model/` by default; production still needs a model artifact configured as described in `DEPLOY.md`.
- **Run this workspace's backend:** from `backend`, use `\.venv\Scripts\python.exe -m uvicorn app.main:app --reload`. This selects the configured CPython environment with the JWT crypto and ONNX dependencies installed.
- **Analytics:** six charts (listings by category and per week, collection requests by status and per week, GreenScore points per week, scans by category) with date and category filters, a data table under each chart, and empty states. They count events from your own records only, never weights, carbon or landfill estimates.
- **Deploying:** see `DEPLOY.md`. These appear as "Coming soon" and nothing fakes them.

## Added in Stage 5: Food Rescue
- **Run `supabase/migrations/0005_food_rescue.sql` after 0004 and `0006_food_rescue_show_review_queue.sql` after 0005.** No new npm or Python dependencies are needed.
- **Food Rescue:** an independent food donation flow, separate from recyclable listings. Authenticated donors can list, edit, cancel, remove, and mark food as donor-reported donated. Food details include preparation time, storage conditions, allergens, a pickup deadline, and an optional photo. The database enforces ownership and status rules; outcomes are never presented as independently verified.
- **Organization directory:** the migration intentionally contains no invented NGO seed records. Platform staff add organizations in Supabase. `needs_review` entries display with a clear warning; `verified` means the directory details were checked, not that the organization agreed to accept a specific donation. Maintain contact details, operating hours, known requirements, and source notes.
- **Location privacy:** donation coordinates are rounded to two decimal places in both the API and database. Public listings omit donor IDs and show an approximate pickup area only. Donors should enter a neighborhood or public meeting area, not a home address.
- **Discovery and tracking:** the public page reuses the Leaflet/OpenStreetMap map and geocoding services. Donors contact organizations directly and record outcomes themselves. Donor-reported handovers may earn 10 GreenScore points, once per donation and subject to a database-enforced daily cap.
- **Food safety:** storage, preparation, allergens, and pickup deadline are shown to potential recipients. TRASHMORPH does not certify food safety or arrange or guarantee collection. Signed-in users can report unsafe or misleading listings.

## Added in Stage 8: Household Waste Pickup
- Run `supabase/migrations/0008_household_waste_pickup.sql` after migrations 0001 to 0007. It enables Supabase `pg_cron` for automatic 35-day retention cleanup.
- Sign-up distinguishes household members from recyclers. Recycler registration requires organization name, location, and contact details.
- Household members can add one daily log with separate biodegradable and non-biodegradable items. Logs stay private to that household and recycler accounts, never appear in the normal marketplace, and are automatically deleted after 35 days.
- Recycler accounts can browse active logs, request pickup, and mark accepted pickups as collected. The household must accept a request before pickup is confirmed. See `DEPLOY.md` for details.

## Added in Stage 9: Recycler access
- Run `supabase/migrations/0009_recycler_access.sql` after 0008. It backfills recycler signup metadata, adds profile activation for existing users, enforces household-only marketplace visibility for recycler accounts, and provides a role-checked RPC for recycler access to household logs.
- **Food Rescue dashboard:** shows counts, reported quantities, activity, and categories from the signed-in donor's actual records. Reported totals are labeled as donor-reported, not independently verified.

## Added in Stage 7: inquiry replies
- **Run `supabase/migrations/0007_inquiry_replies.sql` after 0006.** Donors can open and reply to each inquiry directly from its notification. Replies are stored as a private conversation visible only to the original inquiry parties; each reply notifies the other person. The Inquiries page also includes the thread and reply form.

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
