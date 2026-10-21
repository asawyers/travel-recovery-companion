# Verification status

The account-free app remains at [travel-recovery-companion.vercel.app](https://travel-recovery-companion.vercel.app). The new hotel and OpenAI Agents SDK implementation passes a clean install, 336 unit tests across 22 files, TypeScript/Vite build, Deno checking, seven actual loopback HTTP cases and 35 configured Brave cases. Independent backend and frontend reviews approved their corrected scopes. Publication and hosted checks for this revision are recorded in the latest section below. Hotel/model live activation remains pending separate access/configuration and usage approval. Google Routes remains enabled under the user's existing pay-as-you-go authorization.

## Earlier core revisions

- Deployed application: `6af5d8c775c64d702210a3a37bbe618cb1bcfde7`; stable frontend asset `/assets/index-DJ4PH_o5.js` includes the public backend address.
- Backend behavior: public CORS amendment `828ba97be49db908d32b775b01f4650acd0329da`, also deployed through the docs-only source `6af5d8c`. Facts revision is `public-manual-v1`.
- Acceptance tests: `cb9b7bed1971741e46cfc8dd7d5aba5d7d22eaa6`, a test synchronization correction with no application change.
- Runtime: Node 24.22.0, Deno 2.9.1, Brave 154.1.96.60.

## Earlier core technical gate

| Check | Captured result |
| --- | --- |
| `npm ci` | Passed, 2.42 seconds |
| `npm run test` | 111 tests across 11 files passed |
| `npm run build` | TypeScript and Vite build passed; existing chunk-size warning |
| Deno entrypoint check | Passed |
| Local real HTTP integration | Five guarded loopback cases passed against an isolated Deno server using the real handler |
| Configured hosted Brave suite | All 25 cases passed in 44.6 seconds (45.06 seconds wall) |

The isolated local server was stopped after verification. Local HTTP ran through `node --test tests/integration/core.test.mjs` with an explicit loopback `RECOVERY_API_URL`; it did not target hosted services. The normal local command `npm run test:integration` uses the same test file and a local environment file; that npm wrapper was not rerun in this gate.

## Hosted API acceptance

Endpoint: `https://isclmlhsktuocgdoizmc.supabase.co/functions/v1/recovery`. Independent HTTPS checks passed without Authorization, API keys or cookies:

- Production, arbitrary and literal-null Origin preflights returned 204 with wildcard CORS and no credential allowance. No origin-registration setting is required.
- Daytime POST 200 returned three plans and overnight POST 200 returned two. Both responses passed runtime schema validation and exact pure-planner plan comparison.
- Real-mode manual POST 200 relabeled browser-claimed provider/live facts, cleared the source URL, removed an injected token marker and retained original evidence times.
- GET 405, malformed JSON 400 and 65,537-byte request 413 preserved wildcard CORS without credentials.

Those earlier direct hosted API acceptance POSTs used `investigate:false` while provider/model integrations were disabled; the later Google activation check is recorded below. There are no application users, database rows, purchases or bookings.

## Hosted browser coverage

The real HTTP core case passed compare, priority refinement without another POST, factual constraint changes with another POST, selection, device save, reload as a historical snapshot without HTTP and explicit deletion. Other cases cover no-plan recovery, stale/late responses, cache expiry, source timestamps, manual input, overnight hotel metadata, 320/390 px layouts and storage failures that preserve existing data. Provider-shaped injected responses are test fixtures and do not count as live-provider evidence. Test profiles are isolated from the author's personal Brave storage.

The initial configured hosted run passed 24/25 cases in 45.0 seconds. The remaining investigation test changed priority before the response completed, correctly aborting that investigation. Revision `cb9b7be` waits for the real response body and enabled Compare button before asserting cache reuse. Its original failure was reproduced; five consecutive corrected hosted runs passed in 16.2 seconds. The two-POST assertion remains intact. The subsequent independent complete hosted run passed all 25 cases in 44.6 seconds.

## Native deployment evidence

Public source: [asawyers/travel-recovery-companion](https://github.com/asawyers/travel-recovery-companion). Main and `feat/travel-recovery-companion` use native Vercel Git integration:

- Branch-only `384bbca02b7eedc4d1f12d6c68dbb0f73d2ab333` triggered [a successful deployment](https://vercel.com/rito-labs-2cc43421/travel-recovery-companion/5g6C41No8r14evVB27ctYe3jzjyL) while main remained at `e563c76`.
- Main `2eb20c1a30efa7b0c13771635d4ebe16f7cd5466` separately triggered [a successful deployment](https://vercel.com/rito-labs-2cc43421/travel-recovery-companion/DQZF57AoQJKm6dzWijtAB2Xhp5VJ).
- The rebuilt configured frontend at `6af5d8c` has [successful Vercel status](https://vercel.com/rito-labs-2cc43421/travel-recovery-companion/4cM1yn1CaEudwkLr8P6v99wpuS7H). The author confirmed main Production / Ready and feature Preview / Ready labels.
- Main [GitHub run 39670000927](https://github.com/asawyers/travel-recovery-companion/actions/runs/39670000927) at `6af5d8c` passed install/tests/build and functions-only deployment, job 119465175869. There is no frontend deploy Action, app schema, migration or authentication setup. Frontend and backend delivery are separate.

The author entered the scoped deployment token directly into GitHub. Only secret names were verified; no credential value was read or committed. Management-connector access to the project remains unavailable, but the separately authorized CI credential successfully deploys it. No denied management operation was retried without new access evidence.

## Local run and submission

Use Node 24, then `npm ci`, `npm run test`, `npm run build` and `npm run dev`. [README](../README.md) includes optional local Supabase commands, public endpoint configuration, Brave setup and the UI → Edge → pure planner → device-storage explanation, with one meaningful browser regression. The author should review that explanation and the code before submitting; automated checks do not establish personal understanding.

Device storage holds one selected itinerary on this browser profile. It does not sync devices. Original evidence and selection timestamps survive reload; the restored itinerary is historical until explicitly refreshed. Nothing purchases tickets or reservations.

FlightAware was removed from scope by the user. LiteAPI/Nuitee rates/hosted-hotel handoff and model-agent acceptance remain pending separately authorized access/usage. Google has since been activated and verified under explicit pay-as-you-go authorization without a daily cap; this authorization came directly from the user, not the plan. Manual facts and clearly labeled fictional examples remain usable; synthetic examples never masquerade as live inventory. Authentication/email are intentionally omitted. Two hours is an effort estimate, not a measured hard timer.

Superpowers plans, the private handoff, transferred assessment/spec/provenance and local environment files remain ignored. All transferred references are preserved locally. Prior verification checkpoints remain in Git history and the ignored local history folder.


The technical gate also checked keyboard selection, 320/390 px layouts without horizontal overflow, and fixed provider hrefs with safe new-tab attributes. It did not verify live inventory or the author’s personal understanding. The production build retains a nonblocking main-chunk warning above 500 kB; npm reported an unapproved optional `fsevents` install script. Neither prevented the captured install/build/browser checks.


## Task 10 provider build: local acceptance

The working revision adds server-only FlightAware and Google Routes adapters, bounded HTTP/registry orchestration, strict normalized flight reports, flight input/arrival selection, evidence-aware labels, Google attribution, transient Google data handling and public terms/privacy pages. `RECOVERY_PROVIDER_USAGE_APPROVED` defaults off; no cloud secret or account configuration was performed. Facts revision is now `public-providers-v2`.

After independent spec findings were corrected, fresh checks passed:

| Command/check | Result |
| --- | --- |
| `npm run test` | 212 tests across 15 files passed |
| `npm run build` | TypeScript and Vite passed; existing chunk warning remains |
| Deno entrypoint check | Passed |
| Real loopback HTTP integration | Five cases passed against the restarted provider-v2 handler |
| Local configured Brave suite | All 32 cases passed in 29.8 seconds |

Seven new browser cases cover provider UI and public policy pages; six use explicitly provider-shaped test responses. They cover flight report times/outcomes, separate report and arrival provenance, Google attribution, no Google content in device snapshots, priority-only report reuse, changed flight input causing a new request, and public policy pages. They are not real FlightAware/Google API evidence. Existing manual/fictional HTTP comparison, constraints, stale handling and save/history/delete continue to pass. The handler was exercised on 127.0.0.1:37424 with disabled providers; the frontend used 127.0.0.1:5175.

Spec review corrected late/equal verified arrivals reverting to an earlier fallback, manual/provider ID collisions, missing walking links becoming zero-minute transfers, unrelated arrival evidence on the flight report and attribution details. Regression tests failed before each fix and passed afterward. Trusted planning requests can represent an unreachable deadline while public input remains strict; the planner returns no selectable plan and preserves the deadline. The initial 196-test/31-browser run preceded those corrections; the final counts above supersede it.

Both independent spec scopes and final quality review approved the corrected implementation and setup documentation. The source was subsequently published and hosted verification passed as recorded below. Optional real flight/route acceptance stays blocked on authorized accounts/keys and actual limits; no fixture result closes that gate. The requested next step after the build is the [provider setup guide](PROVIDER_SETUP.md).


## Task 10 publication and hosted acceptance

Reviewed source `93c1548b343a4e3333c14827396bb5e8da569bd3` was published to main and the implementation branch. [Main CI 39676958859](https://github.com/asawyers/travel-recovery-companion/actions/runs/39676958859) passed checks and backend deployment; branch CI 39676955929 passed. [Native Vercel deployment](https://vercel.com/rito-labs-2cc43421/travel-recovery-companion/5p1Xy3LDkR7VmxkzcniJQ1M7bzNT) succeeded. No provider secrets or activation switch were configured.

Fresh complete Brave acceptance against the stable HTTPS frontend passed all 32 cases in 48.0 seconds, output `/tmp/travel-task10-hosted-brave`. Six provider-shaped responses were test fixtures, not real API observations. Independent direct hosted checks passed eight CORS/error cases, real-mode provenance sanitization and a bounded POST explicitly asserting `public-providers-v2`. All direct API acceptance POSTs used `investigate:false`. Frontend, terms/privacy and JS asset `/assets/index-N_FLIvdM.js` returned 200; the bundle contained the correct backend address. Browser policy-page cases verified rendered content, beyond the HTTP app shells.

Task 10 software is implemented, reviewed and deployed. Live FlightAware/Google coverage remains blocked because the user has no provider accounts/keys yet and no actual usage/spend limits have been agreed/configured. The next action is the requested manual setup walkthrough, beginning with a dedicated Google Cloud project. No authentication, email or hard-timer setup is needed.

## Google activation smoke check — 2026-10-21

User confirmed saving the Google Routes key and activation switch directly in Supabase, and explicitly authorized Google pay-as-you-go without a daily cap. A hosted real-mode investigation for BOS to Portland Transportation Center, Portland ME, arrival 2026-10-22 09:00 America/New_York returned HTTP 200 but zero candidates. Manual fallback remained intact. Live route acceptance has not passed.

Diagnostic commit `61b97e6` adds only numeric HTTP status/fixed failure category and avoids labeling a failed-query null as malformed. Three new regression cases first failed, then all215 tests, TypeScript/Vite build and Deno entrypoint check passed; independent review approved. Main workflow39680803649 passed checks and deployed successfully. A fresh hosted investigation confirmed a Google DRIVE HTTP 400 rejection and a separate bus response parsing failure. The actual provider validation detail/response shape remains unresolved; this does not establish a billing or key problem. No credentials or upstream raw error bodies were read or printed. FlightAware and hotel setup remain pending.

## Google request/parser correction and live acceptance — 2026-10-21

Diagnostics `e0df30d` established that the successful bus response contained six routes, exceeding our four-route parser limit. Commit `85db1d3` accepts a bounded 16-route envelope while retaining strict individual route validation, the 128 KiB body limit, three-request ceiling and eight-candidate output cap. It removes the departure timestamp only from the time-independent DRIVE request; TRANSIT departure times and TRAFFIC_UNAWARE pricing remain unchanged. The DRIVE HTTP 400 ceased on the fresh live test after that isolated request change. No account/key/billing change was needed.

Regression tests failed first. All 225 tests across 15 files, TypeScript/Vite production build and Deno entrypoint check then passed. Independent reviews found no blocking regressions. GitHub main workflow 39681507931 successfully deployed the diagnostics; workflow 39681770189 successfully checked and deployed the correction.

Two fresh real-mode investigations were verified: one direct schema-validated hosted POST for BOS to Portland Transportation Center, and one through the deployed app's normal form in isolated headless Brave for its Portland, ME destination. Each returned HTTP 200, two validated bus candidates and two feasible plans. The actual Brave page rendered two option cards. Both carried `Google Maps Routes API` / `schedule` evidence; neither included HTTP 400 or malformed-response warnings. Responses were inspected transiently and raw provider payloads/keys were not retained. No purchase, seat inventory or fare guarantee was tested. This verifies current bus coverage; it does not establish every train/service/date combination or FlightAware/hotel access. Existing unsupported-route/manual-fallback warnings remain accurate.

## Traveler-entered arrival scope amendment — 2026-10-21

The user removed flight-status lookup and delay validation to save coding-challenge effort. Seeking recovery options is sufficient; the entered revised gate-arrival time is authoritative traveler input. Removed the FlightAware adapter, runtime credential read, flight input/date/source controls, status report panel/types/cache, provider arrival enrichment and flight-unavailable warning. Historical request metadata remains readable without triggering a lookup; both new UI comparisons and sanitized API requests clear it to `flight:null`. Real arrival provenance is `traveler_confirmed`. Current-tab facts revision is `public-routes-v3`.

Meaningful removal regressions failed first, including a review-found API metadata edge case. Final local verification: 187 unit tests across 14 files, TypeScript/Vite production build, Deno entrypoint check and five actual loopback HTTP cases passed. All 29 configured local Brave cases passed in two disjoint runs: 14 core/provider cases in 17.6 seconds, 15 guest/save cases in 17.2 seconds. These include absence of retired flight controls, traveler-arrival-only discovery, Google attribution/transient retention, priority reuse, legacy saved refresh preserving original records/timestamps, mobile layouts and storage failures. The final server-only metadata clear was verified with unit/build/Deno; hosted checks are captured after publication. Independent spec and quality reviews approved after that correction. No original source spec/assessment was rewritten.

Published implementation `2c8b7907358439145d12f4927b0ed9c3a92d0a72`: main workflow 39683767155 passed checks and deployed the backend; native Vercel Git status succeeded (2uvAtbaP4VhCJUiy26xmFfa7V8J9). A fresh real investigation through the deployed Brave form returned HTTP 200, two schema-valid Google bus candidates, two plans and two rendered cards. Assertions confirmed absent flight controls/panel, `request.flight === null`, traveler-confirmed arrival, `public-routes-v3` and no flight-unavailable warning.

The first full hosted regression run passed 28/29 cases. The remaining older save test assumed refreshed comparisons would contain only the manual candidate; live Google discovery correctly added two routes. The test now waits for and validates the investigation response, requires the manual candidate, derives the expected rendered count from the assessed plans, and still asserts zero extra priority POSTs and unchanged saved JSON. The targeted hosted case passed in 4.1 seconds; independent review approved this test-only correction. Full hosted rerun is recorded below after completion.

Final hosted rerun: all 29 configured Brave cases passed in 46.6 seconds against the stable HTTPS app. The corrected save test kept every manual option, accepted valid live-added routes and verified no extra priority POST and unchanged saved JSON. The live form smoke separately passed with two Google schedule plans and no flight fields/warnings. Root-owned loopback backend and Vite test servers were stopped. Current code is `2c8b790`; this checkpoint changes only the browser test and documentation. Task 10's revised Google-only scope is complete; optional hotel/model work and the author's understanding review remain separate pending items.


## Hotels and OpenAI Agents SDK — local acceptance, 2026-10-21

The user chose OpenAI Agents SDK, superseding an earlier Vercel AI SDK preference. Actual `Agent`, `Runner` and schema-defined `tool` calls now drive bounded server orchestration. Pinned SDK 0.20.0 and OpenAI client 7.39.0 work with Deno; newer package versions were not used because of the runtime dependency freshness policy. No freshness protection was disabled.

Hotel discovery uses one LiteAPI rates request and at most one leading missing-details lookup, three offers maximum, production/environment and public-rate safeguards, inclusive/unknown fees, conservative cancellation parsing and an exact configured property handoff. Offers are explicitly rates only. A full overnight journey requires selected-property airport/hotel and hotel/boarding-stop transfers, check-in allowance and actual checkout-date train/bus service; no shuttle or next-day timetable is invented. Shared request-scoped promises memoize provider successes and failures.

The assistant accepts only driving/priority patches and selects from the latest deterministic assessment. It has six model turns, twelve attempted tools, one repair and a 30-second request-wide deadline; a shared 15-second provider window and existing individual HTTP bounds remain. Tracing, Responses storage and automatic OpenAI retries are disabled. The response explains actual plan facts and never renders model-authored prices/times/URLs. Missing/limited assistance retains deterministic original-preference results. Synthetic mode makes zero model/provider calls; `investigate=false` prevents provider discovery.

| Final local check | Result |
| --- | --- |
| `npm ci` | Passed, 169 packages installed, zero audit vulnerabilities |
| `npm test` | 336 tests across 22 files passed |
| `npm run build` | TypeScript/Vite passed; existing nonblocking >500 kB main-chunk warning |
| Deno entrypoint check | Passed with pinned SDK/client imports |
| Real local HTTP | Seven cases passed against restarted SDK-loaded Deno handler, 127.0.0.1:37425; no inherited secrets |
| Configured Brave | All 35 cases passed in 50.3 seconds on temporary Vite, 127.0.0.1:5173 |

The HTTP tests ran directly using `RECOVERY_API_URL=http://127.0.0.1:37425/functions/v1/recovery node --test tests/integration/core.test.mjs`; the npm integration wrapper was not used. The SDK suite includes 32 scripted actual-runner tests; another integrated test follows actual SDK Runner → memoized adapter → planner → validated API response and proves repeated discovery calls invoke the adapter once. Mocked OpenAI HTTP failure verifies one request, catching and fixing the client's otherwise automatic retries. These are local fixture tests, not live paid model acceptance.

Review findings were reproduced with failing tests before correction: newly collected hotel evidence was assessed at request-start time; a twelfth input displaced the selected hotel journey; refresh could preserve an old same-ID hotel quote; editing could cancel offer expiry; refinement source consent was unreachable; boarding-stop edits reused old hotel transfer facts; and selected hotels prevented ordinary zero-call priority reuse. Independent reviewers approved the corrected backend and frontend paths. Source/candidate timestamps remain original, while planning uses current assessment time. Saved historical records remain unchanged during refresh.

Six new browser cases cover canonical preference application/cache reuse/no persisted prompt, complete hotel input binding, disabled assistance, stale response rejection, handler-backed explicit source consent, and boarding-stop invalidation. Hotel rate expiry is checked after edits and immediately before selection/handoff. The earlier account-free/save/storage/mobile/Google-attribution cases remain passing. Test provider/model responses are fixtures; no new hotel/model API key, account setup, paid call or live property-page acceptance was performed.

Live activation is pending the exact OpenAI model, privately saved key and paid-use decision; hotel activation additionally needs authorized account/key, public-price/SSP/hosted-markup compatibility, usage approval and optional assigned origin. These are pending setup decisions, not denied operations. Google approval does not cover either service. Supabase management-connector access remains unavailable; authorized scoped GitHub CI is the existing deployment route. Author understanding remains a separate human submission check.


## Hotels and SDK publication and hosted acceptance

Reviewed implementation [`ac5329449b22beb0de92bdcd0798a6c77ee7d196`](https://github.com/asawyers/travel-recovery-companion/commit/ac5329449b22beb0de92bdcd0798a6c77ee7d196) was pushed to main and the implementation branch. [Main workflow39688255247](https://github.com/asawyers/travel-recovery-companion/actions/runs/39688255247) passed clean install/unit/build checks and functions-only backend deployment; feature workflow39688246137 passed. [Native Vercel main deployment](https://vercel.com/rito-labs-2cc43421/travel-recovery-companion/FNpFRR8wEE4NqhwwL2SogadGW25b) succeeded; the preceding feature push also received successful Vercel status. No cloud configuration or provider/model secret was changed.

The full hosted Brave suite passed **35/35 cases in1.7minutes** against the stable HTTPS frontend after backend deployment. Results are in `/tmp/travel-hotels-agent-hosted-brave` with passing `.last-run.json`. This includes real public HTTP comparison, zero-POST priority reuse, device save/history/delete and new injected hotel/SDK-assistance UI regressions. Injected model/provider responses remain fixture coverage, not live paid acceptance.

A separate actual Google investigation through the deployed app's normal Brave form returned HTTP200, two Google schedule candidates, two plans and two rendered cards. Its response validated as `public-recovery-v4`, with traveler-confirmed arrival, flight:null and no retired flight controls/panel or HTTP400/malformed warning. A separate direct deployed refinement with investigate:false returned HTTP200, public-recovery-v4, assistance:unavailable, unchanged original driving preference, empty applied patch and no hotel offers. This confirms honest disabled-model fallback; it does not establish a live model call. No OpenAI/hotel activation occurred.

All task-owned local servers and isolated browser processes were stopped after verification. Public documentation now records the software as implemented/deployed and live model/hotel activation as pending. The author's code-understanding/submission review remains a human check. Superpowers/private handoff/source references remain ignored and were not published.
