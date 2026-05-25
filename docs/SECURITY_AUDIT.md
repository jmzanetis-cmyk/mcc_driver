# Security Audit — W-FIX-5

**Date:** 2026-05-25
**Scope:** All source files excluding `node_modules/` and `.git/`

---

## 1. Hardcoded Secret Scan

Patterns searched: `sk_live`, `sk_test`, `sbp_`, `eyJ` (JWT prefix), `AKIA` (AWS key), `ghp_` (GitHub PAT)

**Result: No hardcoded secret values found.**

All sensitive strings appear only as environment-variable *names* (e.g. `process.env.STRIPE_SECRET_KEY`), never as values. The `.env.example` files contain only empty placeholders.

Confirmed clean files include:
- `artifacts/api-server/src/**` — API routes, Stripe webhook, Supabase admin client
- `artifacts/driver/src/**` — client app, auth, edge functions
- `lib/db/src/**` — Drizzle schema (no credentials needed)
- `scripts/**`

---

## 2. .env File Gitignore Status

| File | On disk? | Git-tracked? | Gitignored? |
|------|----------|--------------|-------------|
| `artifacts/driver/.env.local` | Yes (stub for local snapshot builds) | No | **Yes** (fixed 2026-05-25) |
| `artifacts/driver/.env.example` | Yes | Yes (intentional) | No |
| `.env` (root) | No | No | Yes (fixed 2026-05-25) |

**Fix applied:** Added `.env`, `.env.local`, `.env.*.local`, `.env.production`, `.env.staging` to both:
- `/Users/jordanzanetis/mcc_driver/.gitignore`
- `/Users/jordanzanetis/mcc_driver/artifacts/driver/.gitignore`

The `artifacts/driver/.env.local` that exists on disk contains only stub/placeholder Supabase credentials used for local Playwright snapshot generation (`https://placeholder.supabase.co`). It contains no real credentials and is now explicitly gitignored.

---

## 3. Git History Scan

Command run:
```
git log --all -p --diff-filter=A -- "*.ts" "*.js" "*.json" "*.env" \
  | grep -i "sk_live|service_role|SUPABASE_SERVICE_ROLE|sk_test"
```

**Result: No secret values found in git history.**

Matches found were all variable name references (e.g. `requireEnv("SUPABASE_SERVICE_ROLE_KEY")`, `process.env.SUPABASE_SERVICE_ROLE_KEY`), not actual key values.

---

## 4. Secrets Inventory

All secrets are injected at runtime via environment variables. None are committed to the repo.

| Secret | Used by | Injection method |
|--------|---------|-----------------|
| `SUPABASE_URL` | API server, Driver app | Env var / Replit secret |
| `SUPABASE_SERVICE_ROLE_KEY` | API server only (admin writes) | Env var / Replit secret |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | Driver app, API server | Env var / Replit secret |
| `STRIPE_SECRET_KEY` | API server (payments) | Env var / Replit secret |
| `STRIPE_WEBHOOK_SECRET` | API server (webhook verification) | Env var / Replit secret |
| `DISPATCH_API_KEY` | API server (privileged dispatch endpoints) | Env var / Replit secret |
| `VITE_GOOGLE_MAPS_API_KEY` | Driver app (map views) | Env var / Replit secret |
| `SENTRY_AUTH_TOKEN` | Build-time source map upload | Env var / CI secret |

---

## 5. Rotation Recommendations

| Priority | Secret | Reason | Action |
|----------|--------|--------|--------|
| Low | All | No leaks found | Rotate on a regular schedule (90-day) |
| Medium | `STRIPE_SECRET_KEY` | Highest blast radius if leaked | Rotate before production launch; use restricted keys per environment |
| Medium | `SUPABASE_SERVICE_ROLE_KEY` | Bypasses row-level security | Ensure it's never exposed to client bundles (it isn't — API server only) |
| Low | `DISPATCH_API_KEY` | Internal service credential | Rotate if any third party has ever seen the value |
| Low | `VITE_GOOGLE_MAPS_API_KEY` | Bundle-embedded; restrict by referrer | Add HTTP referrer restrictions in Google Cloud Console before launch |

---

## 6. Emergency Response Plan

### If a secret is leaked (committed to git or exposed in logs):

1. **Immediately revoke the compromised key** in the issuing service's dashboard:
   - Stripe: dashboard.stripe.com → Developers → API keys → Roll key
   - Supabase: app.supabase.com → Project Settings → API → Regenerate
   - GitHub: github.com → Settings → Developer settings → Personal access tokens

2. **Issue a new key** and update all environments (Replit secrets, CI/CD, production server env).

3. **Purge from git history** using `git filter-repo` or BFG Repo Cleaner, then force-push. Treat the old history as permanently compromised regardless.

4. **Audit logs** in the affected service for unauthorized usage in the window between exposure and revocation.

5. **Notify affected parties** per your incident response policy:
   - If `STRIPE_SECRET_KEY` leaked: notify Stripe and check for unauthorized charges
   - If `SUPABASE_SERVICE_ROLE_KEY` leaked: audit all database writes in the exposure window

6. **Post-incident:** add the leaked pattern to the pre-commit secret scanner (e.g. `gitleaks`, `trufflehog`).

### Recommended prevention tooling (not yet in place):

- [ ] Add `gitleaks` pre-commit hook to block future accidental commits
- [ ] Add `trufflehog` to CI pipeline to scan PRs
- [ ] Restrict `VITE_GOOGLE_MAPS_API_KEY` to HTTP referrers before launch
- [ ] Create separate Stripe restricted keys per environment (dev/staging/prod)
