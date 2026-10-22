# Travel Recovery Companion

An account-free travel recovery prototype. Start with **Where are you trying to get to?**, select US From and To cities, and compare ground routes and observed flight quotes in one conversation. Explore one night near your starting city and a flight the next day, confirm the complete journey, save it on your device, and follow travel search links. The app does not buy tickets or reserve vehicles or rooms.

[Open the app](https://travel-recovery-companion.vercel.app) · [Public source](https://github.com/asawyers/travel-recovery-companion) · [Verification and deployment status](docs/VERIFICATION.md)

The motivation was the author's San Diego → Portland journey: a delay on the San Diego → Boston flight caused them to miss all Boston → Portland trains, so they drove. The current default generalizes recovery to city-to-city travel. The original Boston airport flow and its labeled examples remain at [`/legacy`](https://travel-recovery-companion.vercel.app/legacy). Exact tested revisions, deployment IDs, browser results and separate actual-provider evidence belong in the verification record; source implementation alone does not establish deployed acceptance.

## Using the app

Search either city by place name, county, state name or state code. The pinned offline GeoNames catalog contains 171,671 populated places across all 50 states, Washington DC and five US territories. Small communities are included without a population cutoff. This is broad national coverage, not a guarantee of every settlement or available route. See [city data](docs/CITY_DATA.md) for licensing, source checksums, coverage, regeneration and performance details.

The starter plans for **one adult between estimated city centers**. **As soon as possible** is the default; **By a date and time** requires a deadline in the destination's local time. Leaving defaults to now and can be edited in the origin's time zone. The default flow has no flight number, gate-arrival field or airport-exit allowance. Optional preferences cover budget and ranking. Standalone driving options are excluded from this recovery flow; airport and hotel transfer planning remains available.

**Find my options** opens a conversation workspace: messages and the composer on the left, travel options on the right on desktop, stacked on smaller screens. The desktop panes scroll independently, with more height reserved for message history and the composer kept accessible. Scrolling up to read earlier messages preserves your place when an assistant reply arrives. Loading indicators follow active requests, and returned agent activity shows what was actually checked. Qualified fares and arrival times are emphasized; full dates, connections, charges and source checks remain available in expandable details. Follow-up messages and one-at-a-time fact confirmations help build a complete journey. **Add an option you've checked** progressively opens a manual bus/train editor with service times, access, boarding and final-transfer allowances and costs. Enter zero explicitly for a zero allowance or charge; missing costs remain unknown. Complete journeys must connect in place and time, meet the actual destination deadline and satisfy any hard budget. Unknown prices cannot satisfy a hard budget.

**Cheaper** and **Fewer changes** rerank fresh eligible current-tab facts with zero HTTP POSTs, provider calls or model calls. Missing or expired facts require an explicit **Recheck available sources**. Typed hard-fact changes require structured confirmation. Draft changes to non-city facts retain the existing cards until confirmation; accepting a replacement archives the prior conversation result and clears its selection. Changing either city clears trip facts and results so facts from the previous pair cannot carry over.

ASAP keeps the hard deadline null. Its disclosed coverage is complete journeys arriving within seven days after readiness, including the final transfer; it is not an invented traveler deadline or an exhaustive timetable search. Ordinary searches disable standalone driving discovery and focus on public transit and flights. Previously saved historical records are retained.

## Flights and overnight planning

The starter suggests nearby scheduled airports from a pinned catalog of 642 US/territory airports, with actual names, IATA codes and distance from each city center. Review or change these before searching. City coverage does not guarantee a nearby airport or available flight. See [airport data](docs/AIRPORT_DATA.md) for sources, matching rules, omissions and licensing.

SerpApi supplies Google Flights and Google Hotels search observations using one existing account. Flight searches are one-way, one adult, economy and USD. Each connecting flight keeps its own verified airport time zone and dated departure/arrival; airport changes need a separate explicit transfer. These are observed quotes, not confirmed seats or a final payable price. Each search covers one exact airport pair and at most three offers. The app also checks one nearby large airport within 200 km of the final city, when available—for example, SAN → BOS alongside SAN → PWM for Portland, Maine. These searches are bounded alternatives, not exhaustive coverage or a claim that an airport is an airline hub.

For a nearby-airport flight, confirm how long you need after landing, then check onward options from the actual arrival airport to the original final city. Available Google transit schedules retain their bus/train/walking/waiting steps. A local onward driving estimate is offered separately with explicit vehicle confirmation and unknown driving costs; standalone driving stays excluded. Airport access and endpoints are approximate, service and fares need rechecking, and a missed or unavailable connection is not replaced by an invented schedule. Complete assessment includes onward arrival, all known/unknown costs and the actual deadline. Onward cards and the complete flight timeline lead with arrival time, total duration and clearly qualified cost. Icons identify the main services; expanded transfer details group consecutive walking and waiting into a compact timeline. Readable local clocks, dates and one timezone legend replace repeated machine timestamps. A short access summary stays visible, while unique route qualifications and full costs/sources remain available in disclosures. Original walking and waiting time still counts toward final arrival and connection checks. Google route content stays in the current tab and cannot be saved on the device.

**Explore overnight** searches one night near the starting city and flights the next day. It does not plan a sequence of overnight stops across a long drive. Hotel results keep the exact dates, property location and estimated origin-city time zone. Missing room, cancellation, check-in/checkout policies, taxes or fees remain unknown.

Choose a flight and, for an overnight, a hotel to open a short sequence of journey questions. Confirm access, airport processing, connections, arrival transfer and any hotel arrival/departure arrangements. Planning allowances are explicit; hotel policies do not establish actual access. The server reacquires the selected quote and checks its identity and fingerprint before assessing the connected itinerary. Changed, missing or expired quotes require reselection. Unknown extra charges cannot satisfy a hard budget. Google Travel handoffs open search pages for your own review; nothing is booked.

## Sources, assistance and saving

Google Routes supports validated walking, bus, rail, subway, tram and ferry steps, including multiple vehicles, with standalone driving discovery disabled in ordinary city searches. Overlapping query results are deduplicated. Times are schedules or estimates, with labeled assumptions for missing stop zones and walking times. Missing fares remain unknown. Invalid or disconnected routes are omitted. No results does not prove that transportation is unavailable; schedules do not establish seats, vehicle inventory or final payable prices.

The actual OpenAI Agents SDK assistant uses `@openai/agents` 0.20.0 (`Agent`, `Runner` and three tools) with `openai` 7.39.0. The server [model registry](supabase/functions/_shared/server/model-registry.ts) selects `gpt-6-luna`; no `OPENAI_MODEL` setting is needed. Ground tools discover transportation and assess ground journeys. Separate travel tools discover flight/hotel quotes and assess confirmed complete flight journeys with the deterministic planner. A raw quote cannot be recommended as a complete journey. The current UI accepts ranking preferences and keeps standalone driving disabled. Cities, times, deadline, budget and other hard facts require traveler confirmation. A recommendation must reference an eligible plan from the latest assessment.

Each assisted request has at most six model turns, twelve attempted tool calls and one repair within the shared 30-second server deadline. Context is ephemeral: at most 12 user/assistant messages, 1,000 characters each and 8,000 total. The canonical trip remains authoritative. Exact turn-ID and trip-revision echoes reject outdated or mismatched replies. Tracing, response storage and automatic model retries are disabled. Provider failures or invalid/limited model output show an explicit fallback and retain deterministic planning; fictional examples are never silently substituted.

Saving keeps one selected manual ground itinerary or confirmed complete flight itinerary in this browser's local storage, with its original trip dates and evidence-check timestamps. Version 3 flight snapshots, version 2 city snapshots and version 1 legacy snapshots share the existing storage key. A flight snapshot includes only its selected normalized flight, optional selected hotel, confirmed facts and assessed itinerary; other quotes and raw responses are excluded. Reloaded plans are historical until explicitly refreshed; refreshing does not reconfirm old manual evidence. Legacy refresh opens `/legacy?refreshSaved=1` and preserves its original airport and exit allowances. Unsupported saved versions block overwrite until explicit deletion. Failed or expired results remain readable but cannot be selected or saved.

Google Maps route content is transient and cannot be saved; Google Travel observations from SerpApi are a separate source and retain their original evidence in an eligible flight snapshot; saving a manual itinerary also filters Google alternatives from its stored request. Chat messages are never included in saved snapshots. There is no account, cross-device sync, sign-in or email workflow. Public [terms](https://travel-recovery-companion.vercel.app/terms) and [privacy](https://travel-recovery-companion.vercel.app/privacy) explain provider content and device storage.

## Legacy examples and hotels

The explicit examples are `/legacy?demo=daytime`, `/legacy?demo=overnight` and `/legacy?demo=sandbox`. Ordinary fictional examples are offline. National hotel search observations use SerpApi and the selected origin city. They never substitute Boston sandbox results for another city.

The separate Boston hotel sandbox uses the already-saved server-side `LITEAPI_SANDBOX_KEY`. It requests test rates for a future one-night stay and labels the conversation **Demo guide (not a model)**. Property names may be real, but rates and onward inputs are test data. After choosing a property, **Use fictional transfer defaults** supplies 20 minutes airport-to-hotel, 15 minutes check-in, a 09:00 hotel departure and 25 minutes to the boarding stop, with $0 test transfer charges. The next-day service and fare are fictional too. Applying defaults explicitly rechecks sandbox rates; labels survive save/history/refresh. This mode disables Google, OpenAI and all booking handoffs.

LiteAPI/Nuitée is one hotel provider. Its legacy adapter supports bounded rates/property discovery and safe property handoffs, but production access, public SSP/markup compatibility, key and usage approval remain deferred. An offer alone is not a complete journey: specific transfers, check-in allowance and actual checkout-date onward service are required. See [provider setup](docs/PROVIDER_SETUP.md) for the existing configuration, sandbox behavior and deferred production walkthrough.

## Run locally

Use Node 24 (`.nvmrc`):

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5173. Manual planning and explicit fictional legacy examples need no provider keys. Without an endpoint, the pure local planner remains usable; missing live services stay visibly unavailable.

```sh
npm run test
npm run build
npm run test:e2e
```

The browser suite uses installed Brave, defaulting on macOS to `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`. Set `PLAYWRIGHT_BROWSER_EXECUTABLE_PATH` for another installation. Fixture coverage verifies behavior, not live inventory or paid API acceptance; consult [verification status](docs/VERIFICATION.md) for actual results.

For an optional local backend, install Docker Desktop, Supabase CLI 2.120.0 and Deno 2.9.1:

```sh
supabase start --exclude realtime,storage-api,imgproxy,postgres-meta,studio,logflare,vector,supavisor
cp .env.integration.example .env.integration.local
supabase functions serve recovery
```

In another terminal, check the Edge source and run all three loopback integration suites:

```sh
deno check --config supabase/functions/recovery/deno.json supabase/functions/recovery/index.ts
node --env-file=.env.integration.local --test tests/integration/core.test.mjs tests/integration/city.test.mjs tests/integration/travel.test.mjs
```

These suites cover original, city and travel HTTP behavior and reject non-loopback targets. `npm run test:integration` runs the original suite only. The base endpoint is `http://127.0.0.1:54321/functions/v1/recovery`; city requests append `/city`, and flight/hotel requests append `/travel`. No user token, frontend Supabase key or application database rows are needed. Keep provider/model usage disabled in this local test environment.

To connect Vite, set `VITE_RECOVERY_API_URL=http://127.0.0.1:54321/functions/v1/recovery` in ignored `.env.local` and restart it. Use the base endpoint, since the clients append `/city` and `/travel`. Provider/model keys belong only on the server, never in `VITE_` variables.

## Code and deployment

The stack is React/Vite/TypeScript, shadcn/ui, Tailwind and a public stateless Supabase Edge Function. DM Sans and Sora are served locally with their [bundled font licenses](docs/FONT_LICENSES.md); no third-party font request is required. The full-stack path is React → validated public HTTP → Google/SerpApi/actual Agents SDK → deterministic shared planner → browser storage. There is no frontend Supabase SDK, product Auth or application database.

| Entry point | Responsibility |
| --- | --- |
| `src/App.tsx` | National default, explicit `/legacy`, terms/privacy routes. |
| `src/features/city/CityRecoveryApp.tsx`, `session.ts` | Starter/chat state, draft confirmation, cancellation, freshness and local reranking. |
| `formModel.ts`, `manualModel.ts`, `savedSelection.ts` in that folder | Canonical trip construction, checked options and versioned history. |
| `src/lib/city-api.ts`, `src/lib/travel-api.ts` | Endpoint construction, bounded requests, exact bindings and response validation. |
| `src/features/travel/` | Flight/hotel discovery, progressive journey facts, independent travel session and version 3 history. |
| `supabase/functions/recovery/index.ts`, `_shared/server/app-router.ts` | Environment wiring and original/city/travel endpoint routing. |
| `_shared/server/city-handlers.ts`, `city-google-routes.ts`, `city-agent.ts` | Ground ID resolution, sanitized evidence, bounded discovery and SDK orchestration. |
| `_shared/server/travel-handlers.ts`, `serpapi-travel.ts`, `travel-agent.ts` | Observed flight/hotel search, authoritative airports, quote revalidation and travel SDK tools. |
| `_shared/domain/travel-contracts.ts`, `travel-planner.ts`, `airport-metadata.ts` | Strict v3 contracts, full flight/stay composition and verified airport zones. |
| `_shared/domain/city-contracts.ts`, `city-planner.ts`, `city-resolver.ts` | Strict v2 contracts, complete-journey feasibility/ranking and authoritative city metadata. |

The `_shared` paths above are under `supabase/functions/`. The original `/recovery` v1 contract remains available; `/recovery/city` uses v2 with adapter revision `public-city-v1`; `/recovery/travel` uses v3 without changing the older contracts. The server resolves selected IDs instead of trusting caller coordinates, relabels browser evidence as traveler input and validates bounded requests. The browser validates responses before use. The author should review and be able to explain this flow; this documentation does not attest that review occurred.

The existing Vercel project uses [native GitHub integration](https://vercel.com/docs/git/vercel-for-github): Vite preset, repository root, Node 24, `npm ci`, `npm run build`, output `dist`, production branch `main`. Main pushes produce production deployments; feature pushes produce previews. Set `VITE_RECOVERY_API_URL=https://isclmlhsktuocgdoizmc.supabase.co/functions/v1/recovery` and rebuild for the public backend, or leave it empty for local-only previews. No Vercel token/custom deployment Action is needed.

The existing GitHub workflow checks install/tests/build and deploys only the `recovery` function on `main` when `SUPABASE_DEPLOY_ENABLED=true`. Its production environment uses scoped `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID` secrets; the token needs Project Settings read and Edge Functions read-write permissions and must be renewed before expiry. JWT verification is disabled for this intentionally public endpoint, which uses wildcard CORS without credentials. No migrations, Auth callbacks or email settings are required. Frontend and backend delivery are separate: verify both deployed revisions in the status record.

Google, OpenAI and SerpApi keys and existing usage approvals, plus the sandbox key, are already configured; no new setup is needed for the current app. Usage switches are kill switches, not authentication or aggregate spending caps. Google pay-as-you-go without a daily cap was explicitly approved. [Provider setup](docs/PROVIDER_SETUP.md) separates another environment's setup from deferred production hotels.

## Future build and submission

A future FlightAware integration could accept a flight and date, detect a delay, then notify the traveler with an action that starts recovery using the updated arrival. Flight lookup, monitoring and delay notifications are not implemented or scheduled now.

For challenge submission:

- Supply an accessible deployed app, public source and the local instructions above.
- Confirm comparison, constraints, selection and eligible device save/reload/delete at the submitted revision.
- Include a status note with tested frontend/backend revisions, actual-provider evidence and known limitations in [verification status](docs/VERIFICATION.md).
- Explain the code and evidence labels; AI assistance does not replace the author's understanding.
- Disclose that authentication/email were intentionally omitted by the author's scope decision, and production hotels remain deferred. Do not claim all original assessment requirements are met.

Two hours is an effort estimate, not a hard timer.
