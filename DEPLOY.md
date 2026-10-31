# Deploying TRASHMORPH on Render (frontend and backend) with Supabase

Nothing in this repo has been deployed for you. Follow these steps, then run the verification checklist at the end and only call the site live once those checks pass.

## 1. Supabase (production project)
1. Run the migrations in `supabase/migrations/` in order (0001 to 0009) in the SQL editor. Migration 0008 enables the `pg_cron` extension to automatically remove household waste logs after 35 days. Migration 0009 enables existing users to activate recycler profiles, restricts recycler marketplace results to household listings, and provides recycler-only access to household logs.
2. Authentication > URL Configuration: set **Site URL** to your Render frontend URL (known after step 4) and add Redirect URLs `<frontend>/auth/callback` and `<frontend>/reset-password`. Keep the localhost entries for development.
3. Authentication > Providers > Google: paste the Google client ID and secret. In Google Cloud keep the redirect URI `https://<project-ref>.supabase.co/auth/v1/callback`; optionally add your frontend URL to Authorized JavaScript origins.
4. Authentication > Emails: Supabase's built-in sender is rate-limited. For real users configure a custom SMTP provider.

## 2. GitHub
Commit everything (including both `package-lock.json` files if present) and push. Check `git status` first: no `.env` files may be committed.

## 3. Backend: Render Web Service
Use the Blueprint (`render.yaml`) or create manually: root directory `backend`, build `pip install -r requirements.txt`, start `uvicorn app.main:app --host 0.0.0.0 --port $PORT`, health check `/health`, Python 3.12.
Environment variables: `ENVIRONMENT=production`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server only), `SUPABASE_JWT_SECRET` only if your project uses the legacy HS256 secret, optional `SUPABASE_JWKS_URL` if your project's JWKS endpoint is not the standard Supabase URL, and `CORS_ORIGINS` (the exact frontend origin, no trailing slash). `PyJWT[crypto]` and `cryptography` are installed by the backend requirements for Supabase ES256/RS256 token verification. Deploy, then open `<api>/health`.

## 4. Frontend: Render Static Site
Root directory `frontend`, build `npm ci && npm run build`, publish directory `dist`, rewrite rule `/*` to `/index.html` (already in `render.yaml`). Variables: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` (public anon key only), `VITE_API_BASE_URL` (the API's https URL), `VITE_CURRENCY`. These are baked in at build time, so redeploy after changing them.

## 5. Close the loop
Put the frontend URL into the API's `CORS_ORIGINS` and Supabase's Site URL/Redirect URLs, then redeploy the API. Never put the service-role key or Google secret in any `VITE_` variable.

## 6. Optional: AI scanner in production
1. Obtain or train a model (`backend/ml_training/README.md`), zip the folder (`model.onnx` + `model_meta.json`), and host it at an HTTPS URL the Render build can access. Compute its SHA-256. The repository does not include model weights, so scanner inference remains unavailable until you supply this artifact.
2. The local classifier uses ONNX Runtime on CPU, which avoids the large TensorFlow runtime and works on the Render Python 3.12 setup.
3. Configure Render's build command as `pip install -r requirements.txt -r requirements-ml.txt && python scripts/fetch_model.py`, set `MODEL_PATH=/opt/render/project/src/backend/model`, and set `MODEL_URL` and `MODEL_SHA256`. The SHA-256 is checked before extraction. Redeploy after setting these variables.
4. Open the Scanner page: it shows whether the model loaded.
Render's disk is ephemeral, which is why the model is downloaded at every build. Limits: scans are processed two at a time and rate-limited per user in memory (per instance).

## 7. Reviewing community recyclers
New suggestions are `pending` and visible only to their submitter. Review them in the Supabase SQL editor: `update public.recyclers set verification_status = 'community' where id = '...';` (or `'verified'`, `'rejected'`).

## 8. Household Waste Pickup
Household and recycler account types are selected at sign-up. Recycler accounts provide an organization name, location, and contact details. Households can log biodegradable and non-biodegradable waste once per day; recyclers can browse active household logs and request pickups. Household approval is required to confirm a request. Supabase `pg_cron` deletes cycles and their logs after 35 days.

Existing household accounts that need recycler access can activate a recycler profile from the Profile page. Their marketplace view will then show household listings only.

## 8. Verification checklist (do these on the deployed URLs)
- [ ] Frontend loads, and refreshing a nested URL such as `/marketplace` works
- [ ] `<api>/health` returns `{"status":"ok"}`; the browser console shows no CORS errors
- [ ] Register, receive the verification email, log in, log out; Google sign-in; password reset
- [ ] `/dashboard` redirects to login when signed out
- [ ] With two accounts: neither can read the other's profile, scans, notifications or collection requests; only the owner can edit a listing
- [ ] Create, edit, publish and cancel a listing with photos; send an inquiry; the recipient gets a notification
- [ ] Collection request: accept, schedule, start, complete; GreenScore changes once for each side; a second completion attempt doesn't award again
- [ ] Recyclers page shows only reviewed records; suggest one, approve it in SQL, see it on the map
- [ ] Scanner: shows "not set up" without a model; with a model, returns a result and saves a private history item
- [ ] Analytics charts load and show empty states for a new account
- [ ] Light and dark themes persist after refresh on every page, and layouts hold at about 360, 768 and 1280 px widths
- [ ] Search the built JavaScript for your service-role key and Google secret: neither may appear
- [ ] No request goes to `localhost` (check the network tab)

## Known limitations
In-memory rate limits are per server instance. Reports are stored but have no admin screen. Priced listings are display-only (no payments). Email notifications aren't implemented. OpenStreetMap's public tile and geocoding services have usage policies; use your own providers for heavy traffic. Privacy and Terms are plain-language drafts to be reviewed by you or a lawyer.
