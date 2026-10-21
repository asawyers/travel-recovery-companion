# Travel Recovery Companion

An account-free coding-challenge prototype for recovering from disrupted travel between Boston Logan and Portland, Maine. Compare complete train, bus, rental-car and optional hotel-plus-next-day journeys, refine constraints, choose an itinerary and follow verified provider links. All travel information appears in the app.

The motivation is the author's San Diego → Portland journey: a delay on the San Diego → Boston flight caused them to miss all Boston → Portland trains, so they drove. Initial recovery coverage is the onward ground connection from Boston.

## Current state

[Open the deployed app](https://travel-recovery-companion.vercel.app). The hosted frontend is connected to the deployed backend, and the traveler-arrival flow passes the configured Brave regression checks, including explicit Google-shaped fixtures. A real Google Routes investigation now passes both direct API and deployed Brave form checks, returning two bus plans with schedule evidence. The traveler supplies their revised gate-arrival time; no flight lookup or delay verification is required.

The local planner supports traveler-confirmed train/bus details, explicit car estimates, complete-journey comparison, meaningful constraint changes, no-plan recovery, selection and verified handoffs. Daytime and overnight fictional examples are clearly labeled. Device-local save, historical restore and explicit deletion are verified on the deployed app. Public server comparison and current-tab priority reuse are implemented. The backend is deployed through GitHub Actions and the production frontend is connected. Google Routes is enabled and verified against the live API. LiteAPI hotel discovery, property-page handoffs and an actual OpenAI Agents SDK assistant are now implemented with injected provider/model regression coverage. Hotel access, public-rate approval and paid model usage have not been authorized or activated; the new hotel/assistant revision has not yet been verified live or deployed.

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

This revision passes a clean install, 336 unit tests across 22 files, TypeScript/Vite build, Deno checking, seven real loopback HTTP cases and all 35 configured Brave cases. Hotel/model fixtures exercise the implementation without paid API calls. Fixture results do not establish live hotel inventory or paid model acceptance. Deployment evidence is recorded in verification status. Flight-specific tests were removed alongside the retired feature. Browser tests use installed Brave; its macOS default is `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`. Set `PLAYWRIGHT_BROWSER_EXECUTABLE_PATH` for another Brave installation. See [verification status](docs/VERIFICATION.md) for current evidence and historical runs.

## Stack and backend direction

React/Vite/TypeScript, shadcn/ui and Tailwind share a pure validated planner with an intentionally public stateless Supabase Edge Function. No frontend Supabase SDK, product Auth or application database is needed. Optional `VITE_RECOVERY_API_URL` configures the full public recovery endpoint; without it the local planner remains usable. Provider/model credentials belong only on the server, never in `VITE_` variables.

The backend validates bounded requests, sanitizes traveler-provided evidence and returns normalized facts. It passes seven real HTTP integration cases without credentials. Browser comparisons use that public endpoint when configured. Priority-only refinements reuse eligible facts in the current tab without another HTTP/provider/model call. Other edits or expiry require reassessment. Native Vercel Git integration is the deployment target, with lean functions-only backend CI.

Live/schedule/traveler-confirmed/estimated/synthetic facts remain distinct. Unknown charges remain unknown. Optional provider/model access requires explicit usage authorization. Google pay-as-you-go requests without a daily cap have been authorized. Hotel and model implementations remain disabled until their separate post-build access, configuration and usage decisions are complete. No purchases or reservations are made. This is a challenge prototype. Two hours is an effort estimate, not a hard timer.

## Arrival input and route discovery

Enter the revised gate-arrival time you expect or have confirmed. Asking for recovery options is sufficient; the app does not verify a flight delay or require a flight number, departure date, flight API account or flight-status lookup. It labels that time as traveler-provided and adds airport exit, access, boarding and final-mile time when comparing complete journeys.

Google Routes can supply supported Concord bus and Amtrak/Downeaster rail schedules, including estimated North Station access and final walking. Unsupported multi-vehicle journeys are omitted. Missing fares stay unknown. These schedules/estimates do not establish seats or vehicle inventory. Google-sourced plans remain transient: they can be compared and opened, while device-save is refused with an explanation. Manual saves filter Google alternatives from the stored request.

A new environment defaults to no live calls. The existing deployed Google configuration remains enabled under its earlier authorization: backend-only `GOOGLE_ROUTES_API_KEY` plus `RECOVERY_PROVIDER_USAGE_APPROVED=true`. One investigation is bounded to at most three Google requests; the switch is not an aggregate spending cap. Fixture tests establish no credentials, provider accounts, paid usage or live coverage. Follow the [post-build setup walkthrough](docs/PROVIDER_SETUP.md) before activation. Public [terms](https://travel-recovery-companion.vercel.app/terms) and [privacy](https://travel-recovery-companion.vercel.app/privacy) pages accompany provider content.

## Hotel offers and optional AI assistance

Hotel discovery searches LiteAPI for at most three properties with one room rate each, for one adult, one room and one explicit night near BOS. A single investigation uses at most one rates request and one leading-property details request. Room/board information, included and excluded charges, cancellation terms, production provenance and original timestamps are preserved. Missing charges remain unknown. The five-minute app freshness policy is separate from a provider quote expiry; rates do not reserve a room or guarantee the hosted payable price.

An offer is not a complete journey. Select the exact property, supply airport-to-hotel and hotel-to-boarding-stop transfer facts, check-in allowance and departure time, and a confirmed train/bus service for the checkout date. The deterministic planner requires continuous places/times and checks the complete arrival, price and constraints. It never invents hotel transfer durations, fares, taxi/shuttle availability or a next-day timetable. The existing three-call Google allowance is unchanged. Fresh offers stay in the current tab for explicit reuse; renewed investigation refreshes provider facts.

An operator-configured exact `LITEAPI_BOOKING_ORIGIN` enables the documented Nuitee hotel property page with dates and occupancy only. Without it, the app offers the existing Google hotel-search fallback. Handoffs exclude personal information, offer/prebook identifiers and checkout routes; opening a property page does not book anything. Historical restored plans use the search fallback. Hotel activation also requires explicit public-rate approval after checking LiteAPI suggested-selling-price (SSP), account markup and hosted-price compatibility.

The assistant uses `@openai/agents` 0.20.0 (`Agent`, `Runner` and real SDK tools) with the `openai` 7.39.0 client. It can discover options and request deterministic assessment; its only permitted preference edits are driving permission and ranking priority. Dates, destination, deadline, budget, overnight permission and traveler facts stay fixed. Recommendations must reference an eligible plan from the latest assessment; unsupported edits direct the traveler back to the form.

One request has a shared 30-second deadline, at most six model turns, twelve attempted tool calls and one repair. Discovery promises are memoized per request, including failures, so repeated SDK tool calls do not increase Google or hotel call limits. Tracing, response storage and automatic model retries are disabled; no prompt/chat history is persisted by the app. Synthetic mode does not run the model or providers. Disabling investigation prevents provider requests; an explicitly requested, configured assistant can still assess supplied facts. Missing configuration or invalid/limited model output produces an explicit fallback and retains deterministic plans.

Hotel and model switches default off independently. After the build, follow the [manual dashboard activation guide](docs/PROVIDER_SETUP.md): hotel account/key/public-price verification and usage approval remain outstanding; the existing OpenAI account still needs an explicit model choice and acceptable paid-usage decision. No model name, paid allowance or new-account permission is assumed.

## How a comparison works

The form sends validated trip facts to the public Edge Function. The function limits request size, validates the envelope and relabels browser-supplied provider claims as traveler-confirmed or estimated facts. The shared pure planner builds complete journeys, checks boarding cutoffs and constraints, and ranks them using timestamps and integer USD cents.

The browser validates the response and keeps fresh route facts in the current tab. Legacy saved flight metadata remains readable as history, but new comparisons discard it and use traveler-confirmed arrival. A priority-only change reranks those facts without another request. Saving writes one selected itinerary and its original evidence timestamps to this browser’s local storage; reloading restores a historical snapshot without fetching or booking anything.

The hosted browser regression checks this complete flow: compare over real HTTP, change priority with zero extra requests, change a factual constraint with a new request, select/save, reload without HTTP, and explicitly delete. Provider-shaped test fixtures are labeled test evidence, not live inventory.

## Optional local backend

Install Docker Desktop, Supabase CLI 2.120.0 and Deno 2.9.1. Start the local stack, excluding services this prototype does not use:

```sh
supabase start --exclude realtime,storage-api,imgproxy,postgres-meta,studio,logflare,vector,supavisor
cp .env.integration.example .env.integration.local
supabase functions serve recovery
```

In another terminal, run `npm run test:integration`. The recovery endpoint is `http://127.0.0.1:54321/functions/v1/recovery`. It is intentionally public; no user token or Supabase client key is needed, and it creates no application database rows. New environments keep provider/model calls disabled until configured. The existing deployed Google configuration has fixture and live coverage; hotel and model activation remain pending separately.

The browser endpoint setting is optional: set `VITE_RECOVERY_API_URL=http://127.0.0.1:54321/functions/v1/recovery` in ignored `.env.local`, then restart Vite. Leaving the setting empty uses the local planner; frontend-only previews need no backend credentials. Never put provider credentials in frontend environment variables.

## Deployment status and setup

[Public source](https://github.com/asawyers/travel-recovery-companion) is published on `main` and `feat/travel-recovery-companion`. GitHub checks and functions-only backend deployment passed. All 29 current configured Brave cases passed against the stable HTTPS frontend, including real backend comparison and device save/reload/delete. Native main/branch Git deployments were observed; the author confirmed Production / Ready and Preview / Ready labels. The deployed public API uses wildcard CORS without an origin allowlist. No core hosting blocker remains.

This repository is connected to its dedicated Vercel project using [Vercel’s native GitHub integration](https://vercel.com/docs/git/vercel-for-github). Use the Vite preset, repository root, Node 24, `npm ci`, `npm run build`, `dist` and production branch `main`. Main pushes should produce production deployments; branch/PR pushes should produce previews and GitHub deployment status. Verify both deployed commit SHAs. No Vercel token or custom deploy Action is needed.

Leave `VITE_RECOVERY_API_URL` empty for local-only previews. Set `VITE_RECOVERY_API_URL=https://isclmlhsktuocgdoizmc.supabase.co/functions/v1/recovery` in the Vercel production environment, then rebuild through a Git push or redeployment. The deployed endpoint uses wildcard CORS without an origin-registration setting. No product Auth callbacks, email settings or frontend Supabase keys are required.

The GitHub workflow checks Node 24 install, unit tests and build on pushes/PRs. Its main-only production backend job is enabled by repository variable `SUPABASE_DEPLOY_ENABLED=true`, with production-environment secrets `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID`. Use a scoped deployment token limited to this project with Project Settings read and Edge Functions read-write permissions; renew it before its chosen expiry. It deploys only `recovery`, with JWT verification disabled for this intentionally public endpoint. There are no application tables or migrations to apply. Vercel frontend and backend delivery are separate; a successful frontend build does not prove backend deployment.

## Future builds

**Proactive flight-delay recovery:** In a future build, let a traveler enter their flight and travel date, monitor its status through FlightAware, and notify them when a delay is detected. The notification should offer an action to start the travel recovery process using the updated arrival time. Notification channels, delay thresholds and monitoring cadence can be designed in that future build. This is a future enhancement note, not part of the current challenge implementation.

## Challenge submission checklist

- Provide an accessible deployed URL and this source repository.
- Confirm manual and explicit fictional comparison, constraints, selection, device save, reload and delete at the deployed URL.
- Record frontend/backend revisions, actual checks, unfinished features and deployment blockers in [verification status](docs/VERIFICATION.md).
- Explain local run commands and source labels; the author must understand the code even when AI is used.
- Authentication is intentionally omitted by the author’s scope decision. Record live Google evidence separately from the implemented hotel/SDK paths whose activation and live acceptance are still pending.

Hosted recovery endpoint: `https://isclmlhsktuocgdoizmc.supabase.co/functions/v1/recovery`. Direct unauthenticated daytime, overnight and manual-input requests passed runtime validation; daytime and overnight plans matched the pure planner. The production frontend includes this address, and its configured hosted browser acceptance passed.
