# Agent rules — restaurant-pos

## Deployment policy (standing, user-mandated)

- **Never deploy to production unless the user explicitly says "deploy"** (or equivalent).
- Production = Render services `thetwoyaarcafe-api` / `thetwoyaarcafe-web` (branch `release_v1.1`, autoDeploy on push). Pushing to `release_v1.1` IS a deploy — do not push there casually.
- **Test locally first**: `pnpm dev` runs backend (Nest, :4000) + web (Next, :3000) against the local Postgres (`localhost:5432/nodedr_restaurant`, service `postgresql-x64-17`). Local `.env` files keep dev fully isolated from the Supabase production DB.
- Backend tests: `pnpm --filter @nodedr-restaurant/backend test`.
