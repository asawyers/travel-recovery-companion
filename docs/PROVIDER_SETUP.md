# Provider setup after the Task 10 build

Live provider calls are disabled by default. After the build, the user enabled Routes API in an existing Google project, saved its key in Supabase and explicitly authorized Google pay-as-you-go usage without a daily cap. The user confirmed setting the activation switch to true. Google live coverage verification is still pending; FlightAware account/key setup is pending. No daily quota was configured. Fixture tests establish code behavior; they do not establish real flight/route coverage or account permissions.

Start with Google Routes, then FlightAware. Use the existing Brave dashboard window and enter secrets directly into the relevant provider/Supabase dashboard, never into chat or Git. We can walk through one dashboard at a time.

## 1. Agree on a small usage limit

Choose the acceptable daily/monthly cost or explicitly accept pay-as-you-go usage without a cap for each provider before activation. Google usage without a daily cap has been authorized for this challenge; that decision does not authorize FlightAware costs. One explicit investigation can use one FlightAware query and up to three Google Routes requests. Priority-only refinement reuses facts in the current tab without new requests; public visitors can start separate investigations.

The application switch and per-investigation limits are not an aggregate spending cap. Prefer an account/API quota or spending control; if it is deferred, obtain explicit authorization for uncapped pay-as-you-go usage before enabling that provider. A Google alerts-only budget sends notifications and does not itself stop spending; verify the available quota and any eligible spend-cap support in your account. [Google budget guidance](https://docs.cloud.google.com/billing/docs/how-to/budgets), [Routes quotas](https://developers.google.com/maps/documentation/routes/usage-and-billing).

## 2. Create Google Routes access

1. Open [Google Cloud Console](https://console.cloud.google.com/) and select the existing project you chose for this app. A separate project is optional; quotas in a shared project affect its other Routes users. Review the billing requirement before connecting a billing account.
2. Enable **Routes API** for that project. Do not enable unrelated APIs for this adapter.
3. Create a server API key. Under API restrictions, restrict it to **Routes API**. Browser-referrer restrictions are for browser keys and will not authorize this Edge Function. Apply IP restrictions only if your backend has a verified stable outbound IP; do not guess a Supabase address.
4. Under Google Maps Platform → Quotas, set any request limits agreed on and verify they are active; the user has deferred this step for now. Review the current feature/SKU prices; free allowances and budget alerts are not blanket permission for unlimited calls.
5. Keep the key ready for direct entry into Supabase; do not paste it here.

Google requires billing and credentials for Routes requests and documents server-key restrictions. [Routes setup](https://developers.google.com/maps/documentation/routes/get-api-key), [key guidance](https://developers.google.com/maps/api-security-best-practices).

Initial coverage is deliberately narrow: direct Concord bus or Amtrak/Downeaster rail via North Station, with supported access/final walks. Other operators and multi-vehicle routes are omitted instead of being mapped to an incorrect booking link. Estimates and transit schedules do not prove seats, fares or taxi availability. Google-derived route content is transient and is not written into device-saved itinerary snapshots. Attribution and public terms/privacy links are included. [Routes content policy](https://developers.google.com/maps/documentation/routes/policies).

## 3. Create FlightAware AeroAPI access

1. Open the [AeroAPI product page](https://www.flightaware.com/commercial/aeroapi/) and sign in/create your own FlightAware account.
2. Review the tier's allowed use, billing and query fees before subscribing. The Personal tier lists no monthly minimum and limited query credits, but its use/storage/distribution permissions are restricted; confirm your public coding-challenge use fits. Do not select Standard/Premium or accept a recurring charge without explicitly choosing that cost.
3. Create a dedicated AeroAPI v4 key through the developer portal. Confirm the available account usage/rate/spending controls. A credit allowance or per-minute rate limit is not a hard total-cost limit; if an enforceable control is unavailable, keep public activation disabled and discuss a bounded alternative first.
4. Keep the key ready for direct entry into Supabase, never chat.

The implemented lookup is one page for an explicitly supplied SAN→BOS flight number and San Diego departure date. Provider lookup windows are limited; the adapter conservatively rejects unsupported dates. Actual and estimated gate arrival are distinct from scheduled gate time and runway touchdown. Ambiguity, diversion, tracking cancellation or missing gate data retain the traveler's fallback. No booking endpoint is used. [Official AeroAPI schema](https://www.flightaware.com/commercial/aeroapi/resources/aeroapi-openapi.yml).

## 4. Save backend secrets and leave activation off

In the existing Supabase Travel Recovery Companion project `isclmlhsktuocgdoizmc`, open Edge Functions → Secrets. Store only the keys for providers whose account access and usage terms have been authorized:

| Secret | Value entered privately |
| --- | --- |
| `GOOGLE_ROUTES_API_KEY` | The restricted Google server key |
| `FLIGHTAWARE_API_KEY` | The dedicated AeroAPI key |
| `RECOVERY_PROVIDER_USAGE_APPROVED` | Set `true` only after intended usage is authorized; user has authorized Google without a daily cap |

These are backend secrets. Nothing belongs in a `VITE_` variable, frontend source, GitHub issue or chat message. The existing Vercel public endpoint setting and scoped GitHub Supabase deployment credential do not need replacing.

## 5. Activate and verify only after setup is complete

Once the configured providers have approved limits or explicit pay-as-you-go authorization, change `RECOVERY_PROVIDER_USAGE_APPROVED` to `true` and ensure the running function has loaded the configuration. If a redeploy is needed, use the existing GitHub backend workflow. Each provider still requires its own key; missing keys remain unavailable.

We will then perform one explicitly authorized lookup for a real supported flight/service date, check route coverage and source labels, and record actual evidence. Until that succeeds, Task10 live acceptance stays pending. Return the switch to `false` to stop new provider attempts. Manual and fictional planning remain available throughout.
