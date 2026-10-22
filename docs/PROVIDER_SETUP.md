# Provider and assistant setup

The national default starts with **Where are you trying to get to?**, US From/To cities and an ASAP goal or destination-local deadline. Leaving defaults to now, editable in the origin's zone. It compares complete city-center journeys for one adult without a flight number, gate arrival or airport allowance. The [README](../README.md) explains the interaction and local run commands; [city data](CITY_DATA.md) documents the pinned GeoNames catalog.

Google Routes, SerpApi flight/hotel search, OpenAI assistance and the separate LiteAPI sandbox key are already configured and authorized in the existing project. **No new setup is needed for the current app.** Preserve the existing accounts, keys and approvals. Production hotel access and public-rate approval remain deferred. Use [verification status](VERIFICATION.md) for exact deployed revisions and separate fixture/live acceptance; configuration alone does not establish acceptance of a UI revision.

## Existing configuration and another environment

For another environment, use the intended Supabase project's **Edge Functions → Secrets** in the manual dashboard flow. The existing project is [`isclmlhsktuocgdoizmc`](https://supabase.com/dashboard/project/isclmlhsktuocgdoizmc). Keep provider/model keys server-side and out of chat, Git and `VITE_` variables.

| Secret | Purpose |
| --- | --- |
| `GOOGLE_ROUTES_API_KEY` | Routes API server key; existing key stays unchanged. |
| `RECOVERY_PROVIDER_USAGE_APPROVED` | Exactly `true` enables Google and SerpApi discovery; false/missing prevents new attempts. |
| `SERPAPI_API_KEY` | Existing SerpApi Free-plan key for Google Flights and Google Hotels search, already saved. |
| `OPENAI_API_KEY` | Key from the existing authorized OpenAI project. |
| `RECOVERY_MODEL_USAGE_APPROVED` | Exactly `true` enables model use independently of Google. |
| `LITEAPI_SANDBOX_KEY` | Separate sandbox-prefixed key used only by the explicit Boston hotel demo. Already saved. |
| `RECOVERY_HOTEL_USAGE_APPROVED` | Production hotel usage approval; default off. |
| `RECOVERY_HOTEL_PUBLIC_RATES_APPROVED` | Production public-rate/SSP/markup compatibility approval; default off. |
| `LITEAPI_ENVIRONMENT` | Exactly `production` for production legacy hotel discovery. |
| `LITEAPI_KEY` | Authorized production hotel key; activation remains deferred. |
| `LITEAPI_BOOKING_ORIGIN` | Optional exact assigned HTTPS whitelabel origin, with no path, trailing slash, port, credentials, query, fragment or wildcard. |

The usage approvals are kill switches, not authentication, rate limits, billing checks or aggregate spending caps. Repeated investigations are separate requests. The user explicitly approved existing Google pay-as-you-go without a daily cap and existing OpenAI usage; neither requires renewed setup for this app. Those approvals do not activate production hotels or authorize purchases. A new environment defaults to no live calls until its own configuration and usage authorization are in place.

Set the frontend's optional `VITE_RECOVERY_API_URL` to the base recovery endpoint, currently `https://isclmlhsktuocgdoizmc.supabase.co/functions/v1/recovery`, then rebuild. The city client appends `/city` and the travel client appends `/travel`; configure only the base recovery URL. The original endpoint retains v1; the city endpoint uses v2 and `public-city-v1`. The new `/travel` endpoint uses strict v3 contracts. All three are intentionally public, with wildcard CORS and no user/Supabase client token. Native Vercel Git integration and the existing functions-only GitHub deployment workflow remain in use; verify frontend/backend revisions separately.

## Google route coverage and limits

City discovery validates complete walking, bus, rail, subway, tram and ferry steps, including multiple vehicles, and deduplicates overlapping results. It resolves city IDs to trusted centers and zones on the server. It does not reuse the Boston airport adapter for arbitrary cities. Unsupported, geographically disconnected or chronologically invalid routes are omitted with warnings rather than fabricated transfers.

One investigation makes at most three Google calls: normal `TRANSIT`, optional `FEWER_TRANSFERS` when that ranking is requested, and `DRIVE` when driving is permitted. Each call has a three-second/128-KiB bound, within a 15-second provider window and 30-second overall server deadline; the browser has a 35-second bound. Request-scoped memoization includes failures, so repeated SDK discovery tools do not increase these limits. The current city UI sends `drivingAllowed: false`, so ordinary searches skip the standalone `DRIVE` request. The shared backend still retains older API/schema and explicit-refinement behavior for compatibility; the current UI filters standalone driving results.

Times remain schedules/estimates, walking times and missing stop-zone assumptions are labeled, and missing fares remain unknown. A hard budget cannot pass with an incomplete total. Driving is traffic-unaware and does not confirm vehicle access, fuel, tolls, parking or rental charges. More than 480 driving minutes is informational and unselectable; a vehicle/rest plan is not established by a duration estimate. No seats, vehicles, reservations or final payable prices are guaranteed.

ASAP has no hard deadline. Complete final arrival must fall inside the disclosed seven-day coverage window after readiness. This bounds assessed journeys, not a promise to enumerate all departures. Explicit deadlines are separate traveler constraints. The provider's supported readiness range is seven days in the past through 100 days ahead; out-of-range lookup remains unavailable.

**Cheaper** and **Fewer changes** rerank only eligible fresh current-tab facts, without POST/provider/model calls. Expired or missing facts require explicit rechecking. Google route content is transient and unsaveable, including alternatives in a saved manual request. Keep attribution and public terms/privacy links. See [Routes content policy](https://developers.google.com/maps/documentation/routes/policies).

For another Google environment, select the intended Cloud project, enable Routes API and create a server key restricted to it. Use an IP restriction only with a verified fixed backend outbound IP; browser-referrer restrictions do not fit server calls. After billing/usage authorization, privately save the key and enable its usage switch. This does not require changing the existing project. See [Routes setup](https://developers.google.com/maps/documentation/routes/get-api-key) and [key guidance](https://developers.google.com/maps/api-security-best-practices). If quotas are added later, shared project limits affect other apps; alerts-only budgets do not stop spending. See [Routes quotas](https://developers.google.com/maps/documentation/routes/usage-and-billing) and [budget guidance](https://docs.cloud.google.com/billing/docs/how-to/budgets).

## SerpApi flight and hotel search

The user selected the Free plan and confirmed `SERPAPI_API_KEY` was saved in the existing Supabase Edge Function secrets. No new cloud project, billing setup or additional approval flag is needed. Existing `RECOVERY_PROVIDER_USAGE_APPROVED=true` activates this adapter alongside Google Routes; it is a kill switch, not a spending cap. Keep the key server-side. The selected Free plan has a shared 250-search monthly quota; consult the account dashboard for remaining usage and [current plans](https://serpapi.com/pricing).

The adapter calls [`google_flights`](https://serpapi.com/google-flights-api) once and, for an explicit origin overnight, [`google_hotels`](https://serpapi.com/google-hotels-api) once per request. Queries are one adult, one-way economy/USD or one room/one adult/exact one-night dates. Hotel searches request documented lowest-price ordering, matching displayed ranking. Results are limited to three offers per source. Selected offers are retained when freshly reacquired within the first 32 inspected results; provider changes beyond that bounded pool can still require reselection. It never paginates, follows booking tokens, requests checkout/prebooking or purchases anything. Request-scoped memoization includes failures; repeated SDK tools cannot multiply these calls.

Each SerpApi HTTP request has an 18-second, 1-MiB bound within a shared 20-second provider window, 30-second server and 35-second browser limit. Flight and hotel lookups for overnight can run concurrently. Original search observation times are preserved, not restamped as freshly fetched; the app accepts at most five minutes of source age. Airport-local dates and hours use the verified departure airport zone, including when it differs from the origin city. Every segment uses its own airport zone; ambiguous or nonexistent local times and unresolved airports are omitted.

Flight fares are observed search quotes with unknown baggage/extras unless explicitly confirmed. Hotel matching requires coordinates within 50 km of the selected origin; its timezone is explicitly estimated from that city. Whole-stay, nightly and before-tax fields retain their qualifications, with missing fees unknown. A property policy is not a confirmed arrival appointment. No results or source outage does not prove that no travel is possible.

Selected IDs and fingerprints are reacquired before complete-journey assessment. Repricing, changed schedules, missing or expired offers require reselection. Source expiry does not reserve inventory. Handoffs are safe Google Travel search links only; recheck the exact trip, room, terms, dates and final payable price on the destination site. Existing LiteAPI sandbox and deferred production LiteAPI configuration remain separate.

## OpenAI assistance

The server-owned [model registry](../supabase/functions/_shared/server/model-registry.ts) selects `gpt-6-luna`. Change source to change the model; there is no `OPENAI_MODEL` environment override. Existing `OPENAI_API_KEY` and `RECOVERY_MODEL_USAGE_APPROVED=true` are already saved. Another environment needs its own private configuration; deterministic planning remains available when assistance is disabled or unavailable.

The implementation runs the actual `@openai/agents` 0.20.0 `Agent`/`Runner` and three schema-defined tools using `openai` 7.39.0. Ground tools discover transport and invoke deterministic assessment. Travel tools discover observed flights/hotels and assess a selected complete flight journey. Each recommendation must refer to the latest eligible assessment; raw quotes remain discovery only. The shared protocol retains driving/ranking preferences for compatibility; the current city UI keeps driving disabled and applies ranking changes. Cities, readiness, deadline, budget and other hard facts remain authoritative structured fields; typed factual changes produce clarification and explicit confirmation. Recommendations must name an eligible plan from the latest assessment.

One request allows six model turns, twelve attempted tool calls and at most one repair within the shared 30 seconds. Tracing, response storage, parallel tool dispatch and automatic model retries are disabled. Raw provider text/URLs and guest data do not enter discovery summaries. Current-tab context is bounded to 12 user/assistant messages, 1,000 characters each and 8,000 total. It is untrusted context, not authority to mutate the trip. Responses echo the exact turn ID/base revision, and the browser rejects mismatched or superseded replies. The app persists no prompt/chat history or saved-itinerary conversation context. Invalid output or exhausted limits produces an explicit fallback without relaxing constraints or buying anything.

## Explicit Boston hotel sandbox

National hotel observations use SerpApi. The separate `/legacy?demo=sandbox` flow uses the existing saved `LITEAPI_SANDBOX_KEY`; no production key, origin or approval switches need changing. `/legacy?demo=daytime` and `/legacy?demo=overnight` remain offline fictional examples.

The sandbox uses future New York-zone stay dates near BOS and a labeled **Demo guide (not a model)**. It requests test rates; property names may be real, but they do not establish live offers. After selecting a property, choose **Use fictional transfer defaults** or edit the supplied facts: 20 minutes airport-to-hotel, 15 minutes check-in, 09:00 hotel departure and 25 minutes to the boarding stop, with $0 test transfer prices. The next-day 10:00–12:00 bus and $35 fare are fictional too. Applying defaults explicitly rechecks sandbox rates and compares the complete test journey. Save/history/refresh preserve these labels. Google, OpenAI, production hotel calls and all booking handoffs remain disabled in this mode.

The server requires a sandbox-prefixed key and explicit sandbox response; production/unmarked results are rejected. Missing configuration stays unavailable. One investigation makes at most one rates and one leading-property details request. Sandbox rates have an eight-second HTTP bound for the six-second supplier window; details retain three seconds within the shared 15-second provider window. Test USD totals are validated separately from production public-rate requirements. No reservation, prebook or purchase occurs.

## Deferred production hotel walkthrough

LiteAPI/Nuitée is one provider account, not two integrations. The legacy adapter exists; production onboarding is deferred and does not activate the separate SerpApi search adapter. The [sandbox guide](https://docs.liteapi.travel/docs/getting-a-sandbox-key) describes test access. Future production work uses the existing account and separate access, public-price and usage decisions.

1. Establish the account's production access and applicable usage terms in its dashboard. This guide does not authorize payment details, wallet funding or bookings.
2. Verify public-channel eligibility, suggested selling price (SSP), account markup and hosted payable-price compatibility. There is no closed-user-group login. The adapter omits an offer whose returned SSP exceeds its quoted total; missing SSP still requires public-rate approval. See [rates structure](https://docs.liteapi.travel/docs/hotel-rates-api-json-data-structure) and [revenue guidance](https://docs.liteapi.travel/docs/revenue-management-and-commission).
3. After separate approvals, save the production key, `LITEAPI_ENVIRONMENT=production` and both production hotel approval flags as `true`. All four requirements must hold together. Keep them off while activation is deferred.
4. Optionally configure the exact account-assigned whitelabel origin. A custom domain must already be provider-configured; otherwise use the Google hotel-search fallback. See [whitelabel configuration](https://docs.liteapi.travel/docs/configuring-your-liteapi-powered-white-label-booking-site).
5. In the legacy real-trip flow, investigate an explicit one-adult/room/night stay with overnight permission and traveler-supplied nationality. Check property identity, room/board, USD charges, cancellation terms and production timestamps. Sandbox/unmarked responses stay unavailable.
6. Select the exact property and supply both transfers, known or unknown fares, check-in allowance, hotel departure, actual checkout-date train/bus service and final transfer. Reassess the complete journey; hotel availability alone does not establish transfers or onward service. Fresh eligible offers may be reused in the current tab; explicit rechecking refreshes them.
7. Verify the handoff's property, dates and occupancy, then check final price, room, late check-in and cancellation terms on the provider site. Acceptance does not include checkout, prebooking or purchase.

Discovery uses [`POST /hotels/rates`](https://docs.liteapi.travel/reference/post_hotels-rates) and at most one [`GET /data/hotel`](https://docs.liteapi.travel/reference/get_data-hotel), returning at most three properties with one rate each. Included taxes are not counted twice; missing charges remain unknown and cannot satisfy a hard budget. The five-minute app freshness policy is separate from quote expiry and does not guarantee price or reserve a room.

Property handoffs use the exact configured origin and `/hotels/{hotelId}`, dates and base64 JSON-array occupancy only. Identity, nationality, offer/prebook IDs and payment payloads are excluded. Arbitrary provider links and `/booking?offerId=...` checkout/prebook routes are not used. Restored historical plans use general hotel search. See [property deeplinks](https://docs.liteapi.travel/docs/deeplinking-to-whitelabel).

FlightAware is a future README note only: flight input plus detected-delay notification could initiate recovery. The current app performs no flight-status lookup or monitoring.
