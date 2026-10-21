# Verification status

This is a coding-challenge prototype under active implementation. The Vercel frontend and its local-planner flow are verified publicly; the hosted backend is deployed and directly verified; browser connection and live-provider integrations remain pending.

## Verified locally

Application revision: `4c9c9c71fa44727925c4bf1a288b445b6e831966` (application reviewed at `f0f3836`; subsequent browser configuration selects Brave). Runtime: Node 24.22.0. Implementation branch: `feat/travel-recovery-companion`.

- `npm run test`: 108 tests pass across contracts, time/money, planner, overnight, reducer, form adapter, device storage and server handlers.
- `npm run build`: TypeScript and production Vite build pass. The main-chunk size warning is recorded; this is not a runtime failure.
- Brave Browser 154.1.96.60: 25 configured-backend and 14 local-only browser cases pass. These are the current browser acceptance runs; older Chrome evidence below is historical.
- Independent spec and code-quality reviews passed for Tasks 1–8 application behavior.
- Manual and fictional guest comparisons use the same deterministic planner. Manual train/bus/car input, unknown prices, seconds, DST rejection, stale-result protection, constraint changes, no-plan recovery and selection were checked.
- Desktop and 390/320 px mobile layouts, keyboard selection, full hotel metadata and persistent fictional-data labels were inspected. No console errors were observed in the final guest browser checks.

The explicit fictional fixtures reproduce $72/12:50 train, $47/12:10 bus, $145/11:45 car, and $202/10:40 next-day hotel-plus-bus totals/arrivals. These are regression examples, not real schedules, quotes or availability.

## Pending

- Manually confirm the dashboard Production/Preview labels for the verified main/branch Git-triggered deployments. The public frontend smoke checks passed.
- Rebuild Vercel with its saved production endpoint setting, then run configured hosted browser acceptance.
- Optional FlightAware, Google Routes, LiteAPI/Nuitee and model integrations; credentials and actual usage limits have not been configured or authorized merely by planning them.

Existing hosted setup blockers remain recorded in the local session handoff. Frontend and direct backend deployment checks are verified below; configured browser-to-backend acceptance is pending. Local Docker has six healthy Supabase services (API 54321, DB 54322, Mailpit 54324); the public recovery function is locally and directly hosted verified; browser connection is pending. Local Auth is unused by this app.

## Reproduce the current local app

Use the Node version in `.nvmrc`, then run `npm ci`, `npm run test`, `npm run build` and `npm run dev`. The app is served at `http://127.0.0.1:5173/`. The user requested Brave for browser testing. Playwright uses the installed Brave executable; prior Chrome results remain historical evidence. `PLAYWRIGHT_BROWSER_EXECUTABLE_PATH` overrides the default macOS Brave path.

No hard build timer was started. The user clarified that two hours is an effort estimate; no measured total or historical timer result is asserted.

## Provider entry pages checked on 2026-10-21

Read-only inspection verified the official [Amtrak entry page](https://www.amtrak.com/home.html), [Concord trip form](https://concordcoachlines.com/book-your-trip/), [KAYAK Boston Logan car search](https://www.kayak.com/Boston-Logan-Intl-Airport-Car-Rentals.BOS.cap.ksp), and [Google Maps URL documentation](https://developers.google.com/maps/documentation/urls/get-started). No actual inventory, timetables, quotes, purchases or reservations were verified. Concord warns that Boston/Logan tickets do not reserve a specific date or seat.

[Google Hotels](https://www.google.com/travel/hotels) resolved to official Google Travel but the inspection client received an unsupported-browser page. It is offered only as generic hotel discovery, with manual property/area and stay-date instructions. A Nuitée assigned hotel-booking origin has not been configured or verified.

## Acceptance scope

The author removed authentication and email delivery from this challenge. Browser acceptance is account-free compare/refine/select/device-save/reload/historical-restore/delete, with all feedback in-app. No account or session isolation is claimed. Local Supabase Auth is unused tooling, not part of the product.

## Account-free local saving verified

Revision `fc5e7491da149c1bfad0b68d5acaf46d2b94a0b4` removes sign-in UI and adds one device-local snapshot with historical restore, explicit delete and guarded refresh. Independent spec and quality reviews passed. All 74 unit tests, TypeScript/build, five existing guest Chrome scenarios and seven save/history/storage-error Chrome scenarios passed. The initial 11-scenario browser run was followed by the two updated malformed/version-2 recovery cases; the spec reviewer then reran all seven save scenarios. A controller check at 320px confirmed unchanged snapshot/metadata after reload, zero sign-in buttons, no horizontal overflow and no console errors.

## Historical public stateless HTTP gate

Revision `42eb7be5032cf225a63bfa5eaf50d8f7b8ff31cb`: independent spec and quality reviews passed. Captured checks: 95 unit tests (21 handler cases), TypeScript/build, Deno entrypoint check and five real loopback HTTP integration tests. Independent daytime and overnight HTTP responses deeply matched the same pure planner; no credentials, app users or database rows were used.

| Gate criterion | Captured evidence |
| --- | --- |
| Public validated planner | Synthetic and manual POST 200; three daytime plans/candidates; pure-planner daytime/overnight equality |
| Untrusted browser provenance | Nested hotel/access/final-transfer/next-day cases relabeled API claims; original evidence times retained |
| HTTP boundaries | Allowed OPTIONS 204, unlisted OPTIONS/POST 403, GET 405, invalid JSON/fields 400, declared/chunked oversized body 413 |
| Disabled providers and useful failures | Zero calls with investigation off; unavailable/failing investigation preserves manual/no-plan 200 |
| Strict normalized facts and expiry | Runtime schema cases retain original timestamps, five-minute/earliest-quote expiry and public-manual-v1 revision |
| Actual local execution | Five loopback node:test cases and Deno check passed independently against the running function |

Historical behavior at `42eb7be` (superseded by the public CORS amendment below): the local Supabase Kong gateway rewrites `Access-Control-Allow-Origin` to `*`, including error responses. Exact-origin handler unit checks pass, and actual unlisted-origin requests still return 403. This platform behavior is documented rather than changed. CORS is not caller authentication; the endpoint is intentionally public. All provider/model adapters remain disabled/unavailable, and injected tests are not live-provider acceptance.

## Browser/backend integration checks

Revision `f0f3836d3711c299385b2c212fc167a24b2773f3`: implementation checks pass for 108 unit tests, five real HTTP integration cases, 25 configured-endpoint Chrome cases, 14 no-config Chrome cases and TypeScript/build. Independent spec and quality reviews passed the application changes, including 38 focused tests and four targeted refresh regressions.

The configured browser sends only `{request, investigate}` with no Authorization, API key or cookies. A priority-only change reranks normalized facts locally without another POST; factual changes request a new comparison. Original evidence times are retained, and real wall-clock expiry disables stale selection/saving. Late responses cannot replace a newer comparison or cache. Errors preserve inputs and show controlled messages; fetch and response parsing have one 35-second deadline.

Refresh is an explicit configured investigation (providers remain unavailable), consumes investigation intent once, and preserves traveler inputs for later refinement. A manual compare/save/refresh/cheapest regression records two POSTs with option counts `[1,1]`; the final priority change adds zero requests. Local-only refresh adds zero requests. Saved snapshot storage remains unchanged until another explicit save/delete. A controller check independently observed initial/cheapest/no-driving POST counts of 1/1/2, no auth header, zero sign-in controls, a 320px layout without overflow and no app console errors.

## Brave browser verification

At `4c9c9c71fa44727925c4bf1a288b445b6e831966`, installed Brave Browser `154.1.96.60` passed all 25 configured-backend cases (26.6 seconds) and all 14 local-only cases (14.5 seconds). Playwright launched the explicit Brave executable using isolated temporary profiles; no personal browser profile was accessed. No Chrome fallback is configured. These runs supersede Chrome as the current browser acceptance evidence.

## Public source and GitHub checks

Source was published to `asawyers/travel-recovery-companion` on `main` and `feat/travel-recovery-companion`. [Main CI run 39659316788](https://github.com/asawyers/travel-recovery-companion/actions/runs/39659316788) passed at `904555c98b94ecdec337710b3570d9747236a296` on 2026-10-21: Node setup, dependency installation, unit tests and build all succeeded. `deploy-backend` was skipped as designed because hosted deployment is not enabled. The subsequently recorded documentation update does not change application behavior. Workflow/configuration and public documentation passed independent spec and quality review.

Pre-publication checks covered explicit staged paths, 117 historical Git blobs, secret patterns, and exclusion of local environment files, Superpowers documents and private transferred references. No matching secrets or private reference paths were found in that scan. Original references remain on disk.

The user created a dedicated project. The management connector remains unavailable for it, while a separately authorized project-scoped GitHub deployment credential successfully deployed the recovery function. Vercel and direct backend evidence are recorded below; configured browser acceptance is pending. Optional provider/model adapters remain disabled while access and authorized usage limits are unavailable.

## Public Vercel frontend verified

The author created the Vercel project. `https://travel-recovery-companion.vercel.app/` returned HTTP200 with the expected app title. GitHub’s Vercel commit status reports success at `e563c76a4ff333925ee12269e16384378776736c`; the matching project overview was located in the author’s existing Brave window.

Against that stable HTTPS frontend, all 14 Brave guest/device-save tests passed in 11.8seconds: explicit fictional and traveler-entered comparisons, constraints and selection, 320/390px layouts, controlled errors, historical save/reload/delete, malformed/versioned storage preservation, quota failures and manual refresh/priority refinement. Test storage used isolated profiles, without modifying the author’s personal saved plans.

This is frontend acceptance with the local planner, not hosted Edge or live-provider acceptance. Feature-branch push `384bbca02b7eedc4d1f12d6c68dbb0f73d2ab333` subsequently generated a new successful Vercel deployment automatically: [deployment details](https://vercel.com/rito-labs-2cc43421/travel-recovery-companion/5g6C41No8r14evVB27ctYe3jzjyL). Main was still at `e563c76` when that branch status was observed. Subsequent main push `2eb20c1a30efa7b0c13771635d4ebe16f7cd5466` also triggered a successful [Vercel deployment](https://vercel.com/rito-labs-2cc43421/travel-recovery-companion/DQZF57AoQJKm6dzWijtAB2Xhp5VJ). Exact dashboard Production/Preview labels remain to be checked manually.

## Historical checkpoint: initial hosted backend deployment

The user created project `isclmlhsktuocgdoizmc` and entered a project-scoped deployment token directly into GitHub’s production environment. No token value was read into chat or committed. Repository deployment gate is enabled. Main [run39665108179](https://github.com/asawyers/travel-recovery-companion/actions/runs/39665108179), rerun at source `2eb20c1a30efa7b0c13771635d4ebe16f7cd5466`, passed install/tests/build and the recovery function deployment (job119456275061). No database, migration, application-user or provider/model setup was performed.

Actual HTTPS endpoint: `https://isclmlhsktuocgdoizmc.supabase.co/functions/v1/recovery`. Credential-free daytime and overnight POSTs returned200 with three and two plans respectively, runtime-validated responses and exact pure-planner plan parity. Manual real-mode test input returned200, downgraded browser-live claims and removed provider URLs. Unlisted origin OPTIONS403, GET405 and malformedJSON400 passed. Revision is `public-manual-v1`.

At source2eb20c1, production-origin OPTIONS returned403. The user subsequently removed the origin-allowlist requirement for this challenge: wildcard credential-free CORS was awaiting publication at that checkpoint. The frontend remains on its working local planner until the revised backend and configured production browser checks pass. No live inventory acceptance is claimed.


## Historical checkpoint: local CORS simplification

The author removed the origin-registration requirement for this stateless coding challenge. Source `828ba97be49db908d32b775b01f4650acd0329da` removes the origin allowlist, environment setting and obsolete server environment example. Browser responses use `Access-Control-Allow-Origin: *` without credential support. Local verification passed 111 unit tests, typecheck/build, Deno check and five actual loopback HTTP cases, including arbitrary/null/absent origins and unchanged validation/method/body-limit behavior. Hosted publication and configured Brave acceptance were pending at that checkpoint; hosted CORS results follow below.


## Hosted public CORS verified

Source `828ba97be49db908d32b775b01f4650acd0329da` was published to main and the implementation branch. Main [run39669510342](https://github.com/asawyers/travel-recovery-companion/actions/runs/39669510342) passed checks and functions-only deployment (job119463508662). Independent spec and quality reviews approved the amendment. Actual hosted HTTPS checks passed: production/arbitrary/literal-null OPTIONS204; daytime POST200 with three plans; overnight POST200 with two plans; both runtime-schema validated and exactly matching the pure planner; GET405, malformedJSON400 and oversized413. All responses include wildcard CORS and omit credential support. No origin-registration setting is needed.

The user reported saving Production `VITE_RECOVERY_API_URL`. Git-triggered Vercel deployments report success, but the stable HTTPS frontend still served `/assets/index-BrOvtPI5.js` without the backend address at this checkpoint. Production environment targeting and main deployment labels are being checked manually. Configured full-stack browser acceptance is not yet claimed.
