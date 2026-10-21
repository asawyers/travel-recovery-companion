# Route provider setup

The traveler supplies the revised gate-arrival time. The app accepts the request for recovery options without verifying a flight delay. Flight-status lookup and its account/key requirements were removed from scope at the user's request.

Google Routes is configured and enabled in the existing project chosen by the user. Real hosted API and Brave form checks returned two bus plans with Google schedule evidence. The user explicitly authorized Google pay-as-you-go without a daily cap and deferred quota setup. No new Google project, account or key is needed to continue.

## Backend configuration

In Supabase project `isclmlhsktuocgdoizmc`, Edge Functions → Secrets contains:

| Secret | Purpose |
| --- | --- |
| `GOOGLE_ROUTES_API_KEY` | Server key restricted to Routes API |
| `RECOVERY_PROVIDER_USAGE_APPROVED` | `true` enables configured route discovery; `false` stops new provider attempts |

Keep credentials in the backend dashboard, never chat, Git or `VITE_` variables. The existing Vercel public endpoint setting and scoped GitHub Supabase deployment credential remain in use. Native Vercel Git integration deploys the frontend; GitHub Actions deploys the recovery function.

## Usage and coverage

One explicit investigation makes at most three Google Routes requests. Priority-only refinement reuses eligible current-tab facts without another request. The activation switch and per-investigation limit are not an aggregate spending cap. The user's accepted setup currently has no daily cap. If quotas are configured later, remember that this shared Google project's limits affect other apps using Routes. Alerts-only budgets do not stop spending. [Routes quotas](https://developers.google.com/maps/documentation/routes/usage-and-billing), [Google budget guidance](https://docs.cloud.google.com/billing/docs/how-to/budgets).

Supported discovery covers direct Concord bus or Amtrak/Downeaster rail via North Station, with validated access/final walking. Other operators and multi-vehicle journeys are omitted rather than assigned an incorrect booking link. Google times are schedules/estimates; missing fares stay unknown, and no seats, available taxi or rental inventory are claimed. No purchases are made.

Google-derived route content is transient and excluded from device-saved itinerary snapshots. Attribution and public terms/privacy links are included. Manual and explicitly fictional planning remain usable without provider access. [Routes content policy](https://developers.google.com/maps/documentation/routes/policies).

## If configuring another environment

Select the intended Google Cloud project, enable Routes API and create a server key restricted to Routes API. Apply an IP restriction only with a verified fixed backend outbound IP; browser-referrer restrictions do not fit server requests. Confirm billing/usage authorization, save the key privately in that environment's Supabase Edge secrets, then enable the activation switch. [Routes setup](https://developers.google.com/maps/documentation/routes/get-api-key), [key guidance](https://developers.google.com/maps/api-security-best-practices).

Optional hotel rates and model-assisted orchestration still require separate access and usage authorization. Their absence does not block the traveler-arrival and Google route comparison flow.
