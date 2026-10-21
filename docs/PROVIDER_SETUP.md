# Provider and assistant setup after the build

The traveler supplies the revised gate-arrival time. Recovery planning does not verify a flight delay. Flight-status lookup and its account/key requirements are outside the current implementation; the README retains a future FlightAware notification note only.

Google Routes is already configured and enabled in the existing project chosen by the user. Earlier real hosted API and Brave form checks returned two bus plans with Google schedule evidence. The user explicitly authorized Google pay-as-you-go without a daily cap and deferred quota setup. Leave this existing Google project, approval and key unchanged.

Hotel discovery/property handoffs and actual OpenAI Agents SDK orchestration are implemented and covered by injected provider/model tests. Their live account/configuration acceptance remains pending. Those tests do not establish live rates, paid model usage or deployment of the new revision. Complete the build and browser checks before the activation decisions below.

## Backend configuration

Use the user's preferred manual dashboard flow in Brave. Open Supabase project [`isclmlhsktuocgdoizmc`](https://supabase.com/dashboard/project/isclmlhsktuocgdoizmc), then **Edge Functions → Secrets**. Store every provider/model key only there, never in chat, Git or `VITE_` variables.

| Secret | Value and purpose |
| --- | --- |
| `GOOGLE_ROUTES_API_KEY` | Existing server key restricted to Routes API; keep unchanged. |
| `RECOVERY_PROVIDER_USAGE_APPROVED` | Existing `true` approval enables route discovery; `false` stops new Google attempts. |
| `RECOVERY_HOTEL_USAGE_APPROVED` | Default off; set `true` only after explicit hotel API usage approval. |
| `RECOVERY_HOTEL_PUBLIC_RATES_APPROVED` | Default off; set `true` only after confirming the account permits these public rates and its SSP/markup/hosted-price configuration is compatible. |
| `LITEAPI_ENVIRONMENT` | Must be exactly `production` for live hotel discovery. |
| `LITEAPI_KEY` | Authorized production LiteAPI key; sandbox keys/results cannot represent live inventory. |
| `LITEAPI_BOOKING_ORIGIN` | Optional assigned bare HTTPS origin, such as `https://<assigned-subdomain>.nuitee.link`; no trailing slash, path, port, credentials, query, fragment or wildcard. |
| `RECOVERY_MODEL_USAGE_APPROVED` | Default off; set `true` only after explicit paid model usage approval. |
| `OPENAI_API_KEY` | Key for the user's existing authorized OpenAI API account/project. |

All four hotel requirements must hold together: both hotel approvals equal `true`, `LITEAPI_ENVIRONMENT=production`, and a production `LITEAPI_KEY` is present. Model activation independently requires `RECOVERY_MODEL_USAGE_APPROVED=true` and `OPENAI_API_KEY`; the model is selected by the server registry. Missing configuration produces an explicit unavailable fallback while the deterministic planner remains usable.

The existing Vercel public endpoint setting and scoped GitHub Supabase deployment credential remain in use. Native Vercel Git integration deploys the frontend; GitHub Actions deploys the recovery function. Secret configuration does not itself prove that the intended code revision was deployed.

## Hotel access and activation

No LiteAPI account, key, public-rate approval or usage approval has been supplied. Account creation and paid provider calls are not authorized by this guide. After the implementation is reviewable, obtain the user's explicit decision about hotel account access/setup and acceptable API usage before doing either. If the user already has an account, use that account rather than assuming a new one is needed.

1. With authorized access, open the LiteAPI dashboard in Brave and establish the account's production access and applicable API usage terms. Do not paste credentials into the conversation or commit them.
2. Verify the account's public-channel eligibility, suggested selling price (SSP) requirements, account markup and the assigned hosted site's payable-price behavior. The app has no login-based closed user group. It does not manufacture markup to make a rate public-safe; returned SSP values above the quoted room total cause that offer to be omitted. Missing SSP does not remove the need for operator approval. Review [rates structure](https://docs.liteapi.travel/docs/hotel-rates-api-json-data-structure) and [revenue/commission guidance](https://docs.liteapi.travel/docs/revenue-management-and-commission).
3. After separate usage and public-rate approval, save the production key, environment and both hotel approval switches in the target project's Edge Function secrets. Keep the switches off until those decisions are complete.
4. Optionally copy the exact account-assigned whitelabel origin into `LITEAPI_BOOKING_ORIGIN`. An owned custom domain must already be configured with the provider. Without a valid exact origin, the app uses Google hotel search. See [whitelabel configuration](https://docs.liteapi.travel/docs/configuring-your-liteapi-powered-white-label-booking-site).
5. After authorization, make an explicit real-mode investigation with overnight permission, one adult/room/night and traveler-entered nationality. Check the normalized property identity, stay, room, USD charges, fees, cancellation terms and production timestamps. A failure or sandbox/unmarked response must remain unavailable; do not substitute fictional inventory.
6. Select a returned property and enter its two specific transfers, including waiting/travel time and known or unknown fares, check-in allowance and hotel departure time. Add the actual checkout-date train/bus service and its final destination transfer. Investigate again to assess the complete journey using current hotel facts. A fresh current-tab offer can be reused before evidence expiry; a new explicit investigation refreshes rates.
7. Check the handoff opens the same property with the intended dates and one-adult occupancy. Confirm the final room, cancellation policy, late check-in and payable price on the provider site. Do not follow a checkout/prebook route or purchase a room during acceptance.

Discovery uses [`POST /hotels/rates`](https://docs.liteapi.travel/reference/post_hotels-rates) and at most one leading-property [`GET /data/hotel`](https://docs.liteapi.travel/reference/get_data-hotel). It returns at most three hotel offers with one rate each. Offers alone are not complete recovery plans. Hotel availability does not establish airport/hotel transfers, next-day schedules, seats, available vehicles or late check-in. Unknown charges remain unknown, included taxes are not counted twice, and a hard budget cannot pass with an incomplete total.

Property handoffs use `/hotels/{hotelId}` with check-in/check-out and base64 JSON-array occupancy only. There is no nationality, identity, offer ID, prebook ID or payment payload in the URL. The exact configured origin is checked at rendering; arbitrary provider-supplied links are not used. `/booking?offerId=...` can trigger prebooking and is excluded. See [documented property deeplinks](https://docs.liteapi.travel/docs/deeplinking-to-whitelabel).

Hotel evidence uses a five-minute app freshness window. This is not a provider quote expiry or a price guarantee; absent provider expiry remains explicitly unknown. Restored historical plans use the general hotel-search fallback rather than a persisted booking origin.

## Model choice and activation

The user has an existing OpenAI account and explicitly chose `gpt-6-luna`. The server-owned `MODEL_REGISTRY.recovery` in `supabase/functions/_shared/server/model-registry.ts` records its provider and exact model ID. There is no `OPENAI_MODEL` environment setting or environment override; an old setting, if present, is ignored and can be deleted. Change the registry in source to change the model.

Create or select an API key in the existing OpenAI project and save only `OPENAI_API_KEY` privately in the target Supabase Edge Function secrets. Do not create a new account or paste the key into chat. The separate `RECOVERY_MODEL_USAGE_APPROVED` switch must equal `true` before the application reads the key or enables model requests. A missing/false switch leaves assistance unavailable while deterministic planning continues; setting it false is also a quick off switch.

That switch records explicit authorization for paid model use; it is not authentication, a billing check, a rate limit or an aggregate spending cap. Paid use for the public demo has not yet been confirmed. Explain that distinction and obtain the user's usage decision before enabling it. Confirm any requested account-level spend controls separately. After activation, validate one explicitly authorized assistance request against the deployed revision, confirming that it uses assessed plan identifiers and that unavailable/limited responses preserve deterministic results. No live paid model acceptance has been performed yet.

The implementation uses `@openai/agents` 0.20.0 with actual `Agent`, `Runner`, schema-defined tools and structured output, backed by the `openai` 7.39.0 client. Tests inject an SDK model and exercise SDK execution; this is distinct from paid API acceptance. Tools discover transport/hotel offers for the fixed request and invoke the deterministic planner. Only explicitly requested driving permission and ranking priority changes are accepted. Dates, destination, arrival, deadline, budget, overnight permission, stay and traveler facts require editing the form.

A request has a shared 30-second deadline, six model turns, twelve attempted tool calls and at most one repair. Tracing, response storage, parallel tool dispatch and automatic model retries are disabled. Raw provider text, provider URLs and guest data do not enter model discovery summaries; the app stores no prompt/chat history. A recommendation must refer to an eligible plan from the latest deterministic assessment. Invalid output or exhausted limits yield an explicit limited/unavailable result, with no automatic purchase, contact or constraint relaxation.

## Usage boundaries and route coverage

Provider discovery is memoized per request, including failures. One explicit investigation makes at most three Google Routes requests, one hotel rates request and one leading-property details request even when SDK tools repeat. These activation switches and request limits are not aggregate spending caps. Repeated user investigations are separate requests.

Synthetic mode never calls providers or the model. `investigate=false` prevents provider requests; a separately requested and authorized model refinement may still assess supplied facts. Priority-only deterministic refinement reuses eligible current-tab facts without another request. Other edits or expiry require reassessment.

Supported Google discovery covers direct Concord bus or Amtrak/Downeaster rail via North Station, with validated access/final walking. Other operators and multi-vehicle journeys are omitted rather than assigned an incorrect booking link. Google times are schedules/estimates; missing fares stay unknown, and no seats, available taxi or rental inventory are claimed. Hotel transfers and actual checkout-date service must be supplied separately; the existing three Google calls do not silently expand to acquire them. No purchases are made.

Google-derived route content is transient and excluded from device-saved itinerary snapshots. Attribution and public terms/privacy links are included. Manual and explicitly fictional planning remain usable without provider/model access. [Routes content policy](https://developers.google.com/maps/documentation/routes/policies).

The user's existing Google setup has no daily cap. If quotas are configured later, the shared project's limits affect other apps using Routes. Alerts-only budgets do not stop spending. [Routes quotas](https://developers.google.com/maps/documentation/routes/usage-and-billing), [Google budget guidance](https://docs.cloud.google.com/billing/docs/how-to/budgets).

## If configuring Google in another environment

Select the intended Google Cloud project, enable Routes API and create a server key restricted to Routes API. Apply an IP restriction only with a verified fixed backend outbound IP; browser-referrer restrictions do not fit server requests. Confirm billing/usage authorization, save the key privately in that environment's Supabase Edge secrets, then enable `RECOVERY_PROVIDER_USAGE_APPROVED`. This does not authorize changing the existing project's setup. [Routes setup](https://developers.google.com/maps/documentation/routes/get-api-key), [key guidance](https://developers.google.com/maps/api-security-best-practices).
