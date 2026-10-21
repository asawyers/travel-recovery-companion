# Travel Recovery Companion

An account-free coding-challenge prototype for recovering from disrupted travel between Boston Logan and Portland, Maine. Compare complete train, bus, rental-car and optional hotel-plus-next-day journeys, refine constraints, choose an itinerary and follow verified provider links. All travel information appears in the app.

The motivation is the author's San Diego → Portland journey: a delay on the San Diego → Boston flight caused them to miss all Boston → Portland trains, so they drove. Initial recovery coverage is the onward ground connection from Boston.

## Current state

The local planner supports traveler-confirmed train/bus details, explicit car estimates, complete-journey comparison, meaningful constraint changes, no-plan recovery, selection and verified handoffs. Daytime and overnight fictional examples are clearly labeled. Device-local save, historical restore and explicit deletion work locally. Public server comparison and current-tab priority reuse are implemented locally; optional live integrations and hosted deployment remain pending.

There is no sign-in or email workflow. Saving keeps one chosen itinerary on this device's browser profile, with original evidence timestamps and an explicit delete action. It does not sync across devices or purchase tickets/reservations. A restored itinerary is historical until explicitly refreshed.

## Run locally

Use Node 24 (see `.nvmrc`):

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. The core planner requires no cloud or travel-provider keys. Choose the synthetic example explicitly to explore fictional regression data; missing live services never substitute those examples automatically.

```sh
npm run test
npm run build
npm run test:e2e -- tests/e2e/guest.spec.ts
```

The account-free core passes 108 unit tests, five real HTTP integration tests, 25 configured-backend Brave cases, 14 local-only Brave cases, and a TypeScript/Vite production build. Browser tests use installed Brave; its macOS default is `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`. Set `PLAYWRIGHT_BROWSER_EXECUTABLE_PATH` for a different Brave installation. The final reviewed revision and counts are recorded in the verification status. See [verification status](docs/VERIFICATION.md) for evidence and pending work.

## Stack and backend direction

React/Vite/TypeScript, shadcn/ui and Tailwind share a pure validated planner with an intentionally public stateless Supabase Edge Function. No frontend Supabase SDK, product Auth or application database is needed. Optional `VITE_RECOVERY_API_URL` configures the full public recovery endpoint; without it the local planner remains usable. Provider/model credentials belong only on the server, never in `VITE_` variables.

The local backend validates bounded requests, sanitizes traveler-provided evidence and returns normalized facts. It passes five real HTTP integration cases without credentials. Browser comparisons use that public endpoint when configured. Priority-only refinements reuse eligible facts in the current tab without another HTTP/provider/model call. Other edits or expiry require reassessment. Native Vercel Git integration is the deployment target, with lean functions-only backend CI.

Live/schedule/traveler-confirmed/estimated/synthetic facts remain distinct. Unknown charges remain unknown. Optional provider/model access requires actual configured usage limits; no paid calls, purchases or reservations are implied. This is a challenge prototype. Two hours is an effort estimate, not a hard timer.

## Optional local backend

Install Docker Desktop, Supabase CLI 2.120.0 and Deno 2.9.1. Start the local stack, excluding services this prototype does not use:

```sh
supabase start --exclude realtime,storage-api,imgproxy,postgres-meta,studio,logflare,vector,supavisor
cp .env.functions.example .env.functions.local
cp .env.integration.example .env.integration.local
supabase functions serve recovery --env-file .env.functions.local
```

In another terminal, run `npm run test:integration`. The recovery endpoint is `http://127.0.0.1:54321/functions/v1/recovery`. It is intentionally public; no user token or Supabase client key is needed, and it creates no application database rows. Provider/model adapters remain unavailable.

The browser endpoint setting is optional: set `VITE_RECOVERY_API_URL=http://127.0.0.1:54321/functions/v1/recovery` in ignored `.env.local`, then restart Vite. Leaving the setting empty uses the local planner; frontend-only previews need no backend credentials. Never put provider credentials in frontend environment variables.

## Deployment status and setup

[Public source](https://github.com/asawyers/travel-recovery-companion) is the target repository. Hosted frontend/backend URLs and Git-triggered deployment evidence are pending. A local build is not a deployed application.

Connect only this repository to a new personal Vercel project using [Vercel’s native GitHub integration](https://vercel.com/docs/git/vercel-for-github). Use the Vite preset, repository root, Node 24, `npm ci`, `npm run build`, `dist` and production branch `main`. Main pushes should produce production deployments; branch/PR pushes should produce previews and GitHub deployment status. Verify both deployed commit SHAs. No Vercel token or custom deploy Action is needed.

Leave `VITE_RECOVERY_API_URL` empty for local-only previews. Once a dedicated backend is available, set its full HTTPS function URL in the Vercel production environment and redeploy. Set server-only `RECOVERY_ALLOWED_ORIGINS` to the exact production origin; explicitly approve any preview origins that need backend access. No product Auth callbacks, email settings or frontend Supabase keys are required.

The GitHub workflow checks Node 24 install, unit tests and build on pushes/PRs. Its production backend job stays disabled until the repository variable `SUPABASE_DEPLOY_ENABLED=true` and production-environment secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` are deliberately configured. It deploys only `recovery`, with JWT verification disabled for this intentionally public endpoint. There are no application tables or migrations to apply. Vercel frontend and backend delivery are separate; a successful frontend build does not prove backend deployment.

## Challenge submission checklist

- Provide an accessible deployed URL and this source repository.
- Confirm manual and explicit fictional comparison, constraints, selection, device save, reload and delete at the deployed URL.
- Record frontend/backend revisions, actual checks, unfinished features and deployment blockers in [verification status](docs/VERIFICATION.md).
- Explain local run commands and source labels; the author must understand the code even when AI is used.
- Authentication is intentionally omitted by the author’s scope decision. Live inventory and the optional agent remain unavailable until authorized access and usage limits exist.
