# Verification status

## Live flights and origin overnight — 2026-10-22

The flight/overnight flow is deployed and accepted in installed Brave. Start with U.S. cities and an ASAP or destination-local goal, compare ground routes and observed flight quotes, optionally explore one origin night plus next-day flights, confirm a complete journey, then select and save it on this device. Existing provider configuration is working; no further account setup is required.

The tested application revision is `18d941a6bc28098167cc78a900762531ae36b475`. [Main workflow 39731509510](https://github.com/asawyers/travel-recovery-companion/actions/runs/39731509510) passed checks and the scoped Supabase deployment; [feature workflow 39731508695](https://github.com/asawyers/travel-recovery-companion/actions/runs/39731508695) passed. [Native Vercel deployment](https://vercel.com/rito-labs-2cc43421/travel-recovery-companion/8fKaFU1NNs7m7VKN3LkKa35hCBoQ) succeeded. The stable production app served `/assets/index-ChU_ooke.js`. The final record/description update changes no application behavior or JavaScript asset.

| Check | Captured result |
| --- | --- |
| Full unit/domain/provider/controller/actual SDK suite | 965 tests across 47 files passed |
| Production TypeScript/Vite build | Passed; main JS 878.95 kB / 259.63 kB gzip; existing chunk warning remains; city catalog worker is lazy |
| Deno Edge entrypoint | Passed |
| Disabled-provider loopback HTTP | All 25 cases passed across legacy, city and travel endpoints |
| Full frozen-production-preview Brave | All 81 cases passed in 1.5 minutes |
| Travel cases after final clarification guard | All 21 cases passed in 40.4 seconds |
| Full hosted Brave | All 81 cases passed in 3.7 minutes; none skipped or removed |
| Independent review | Every task SPEC/QUALITY gate, final integration review and public-document review approved |

Actual hosted acceptance is separate from injected fixtures. The unmocked Brave run selected San Diego, CA → Portland, ME and returned three observed flights and three origin hotels. It confirmed one origin overnight plus two flight segments, received a completed actual OpenAI Agent/Runner recommendation with the exact eligible journey ID, saved a strict version-3 snapshot, reloaded historical details with zero POSTs and explicitly deleted the snapshot. Exactly five planner POSTs were made: initial ground and flight search, overnight search, journey confirmation and assisted chat. Unknown charges remained unknown; no tickets, hotel arrangements or transfers were actually purchased or reserved. All transfer/stay arrangements in this acceptance were hypothetical verification inputs. The isolated browser closed in `finally`.

A separate actual flight API check passed: three flights in 11,991 ms, selected assessment in 6,412 ms, a selectable nine-leg journey, exact eligible model recommendation and incomplete total retained. Actual source checks also composed a selectable twelve-leg overnight journey with no violations. Changing hotel result pools and pricing separately returned `hotel_missing` or `hotel_changed` with honest reselection; bounded search cannot guarantee continued inventory. No raw provider payload, credential or purchase artifact was retained. Actual scripts/logs are `/tmp/travel-live-browser-acceptance.mjs`, `/tmp/travel-live-final-browser.log` and `/tmp/travel-flight-live-final.log`; the checked historical screenshot is `/tmp/travel-live-saved-history.png`.

Reviewed corrections preserve accepted overnight dates on Recheck and No driving, carry only fresh exact confirmed facts into travel chat, and make changed/missing quotes or newly infeasible assessments authoritative even when assistance asks a clarification. Canceled, edited or expired facts cannot restore an earlier eligible journey. The model receives bounded confirmed facts and distinguishes unknown prices from missing confirmation; hard-budget incomplete prices remain ineligible. Four final controller regressions reproduced the failures before the guard passed. The initial development-server browser run passed 75/76 with a city-picker timeout during concurrent edits; the frozen full run then passed all 81, and the hosted full run passed all 81.

Compatible backend checkpoints were `a709bc78d13e9d11b5f08ddd8547bf7b5c2763c9` (main 39728068889 / feature 39728068506), bounded selected-quote reacquisition `33204be565f144bbb787456ddd58a83732db4b86` (main 39728901492 / feature 39728902320), lowest-price hotel search ordering `15200ee4eafc53c836bd05b3c466fd53b30615f6` (main 39729897344 / feature 39729897177), and confirmed-model-context correction `12bb7ca5370ea837c710c32046123ddabc0d951d` (main 39730669471 / feature 39730669957). All ultimately succeeded; the context main run passed on attempt two after a transient Supabase internal HTTP 500. Frontend `e23c28cdcfaca3d76a90a6ac20b1a6741c553c9a` passed main 39731076046, feature 39731076086 and native Vercel deployment 4JygyR59jfkcjtZQceEFuJAx2BYj before the final guard revision above.

This remains a coding-challenge prototype: one adult, one airport pair, up to three offers per source, one origin overnight, observed quotes rather than guaranteed inventory, and incomplete prices where extras are unknown. Multi-night road-trip recovery and production LiteAPI onboarding remain deferred. The separate Boston sandbox and legacy flows are preserved. Authentication/email were intentionally omitted by user direction; this record does not claim every original assessment requirement or the author's code-understanding review is complete. Two hours is an effort estimate, with no hard build timer recorded.

Temporary task-owned local Vite/Deno servers were stopped and their ports released. Actual acceptance and test browsers closed; the user's Brave window was preserved. Superpowers plans, session handoff and transferred assessment/spec references remain ignored. Historical checkpoints follow.

## Long-distance result visibility repair — 2026-10-22

The reported San Diego, CA → Portland, ME lookup was reproduced against the deployed API: HTTP200 in2,943ms, one Google driving estimate of2,736.8minutes, no validated selectable journey, and one informational rejected route. The UI hid that estimate in a closed disclosure and reported zero options. Drives longer than8hours remain informational until an actual vehicle/rest plan exists; the search did not check flights or national hotel stays.

The repair expands informational routes when no selectable journeys exist, distinguishes their count, labels driving time before breaks/overnights and unknown totalcost, and suppresses misleading uninterrupted multi-day arrival times. The current ground-only coverage is explicit. No planner, provider, backend, save or selection boundary changed. A new exact-citypair48h injected browser regression failed with a hidden card before the fix; three focused unit assertions also failed first. Root verification passed664unit tests, production build/typecheck and all10cityBrave cases locally. Independent specification/quality review approved. Published repair `f28413025ad073c61bc6b4a43b6ecf22182382ac` passed main workflow39721493229, feature workflow39721492955 and native Vercel deployment6y3p1SGGsoirWsA25NZADcWZVE9T. All ten city Brave cases passed locally and hosted; the actual San Diego–Portland informational driving estimate was visible in the hosted UI.

The user subsequently saved the SerpApi key. The following flight/overnight implementation and acceptance are recorded in the current checkpoint above; this historical visibility repair itself did not add those capabilities.

## U.S. city-first recovery — 2026-10-22

The city-first frontend and compatible city API are deployed alongside the legacy flow. All 59 hosted Brave cases, actual national Google/OpenAI acceptance and legacy hotel sandbox UI acceptance passed. Earlier sections describe historical revisions.

The starter asks “Where are you trying to get to?” with searchable From/To selectors, destination-local arrival goals and ASAP selected by default. City-center estimates are disclosed. The GeoNames catalog contains 171,671 populated places across all 50 states, DC and five territories; this is place coverage, not a promise of available ground transport for every pair. National hotel discovery is unavailable; the separate Boston legacy demo retains clearly labeled hotel sandbox support.

| Check | Captured result |
| --- | --- |
| Unit/domain/provider/actual SDK tests | 661 tests across 37 files passed |
| TypeScript/Vite build | Passed; main JS 697.77 kB / 208.36 kB gzip, existing chunk warning; catalog search worker lazy loaded |
| Deno Edge entrypoint | Passed |
| Actual disabled-provider loopback HTTP | All 17 cases passed (nine legacy, eight city) |
| Installed Brave local cases | All 59 cases covered: first run 57 passed; two test-only selector/ISO assumptions corrected and both passed separately |
| Full hosted installed Brave | All 59 cases passed in 2.7 minutes after the reviewed test-only response synchronization fix |
| Visual and keyboard acceptance | Actual catalog keyboard selection, desktop and 390/320 px layouts passed with no horizontal overflow |
| Independent review | Domain, catalog, Google adapter, SDK/HTTP, UI, activation, public docs and final integration specification/quality reviews approved |

Backend `23a984b033001311017a8d7fc587be11e8f91098` passed main workflow 39716748814, branch workflow 39716748878 and native Vercel deployment. Its manual-evidence correction `ca2dcae929b21901221f6e12f447a368a9bae318` passed main workflow 39718447384 (including scoped backend deployment) and branch workflow 39718447265. Actual hosted acceptance preserved a six-minute-old traveler check with null source expiry while giving the new comparison a fresh bounded collection lifetime, without provider/model investigation.

Actual authorized national Google API acceptance returned seven candidates/three plans for New York City–Philadelphia, four/three for Chicago–Indianapolis (different IANA zones), and zero/zero for Anchorage–Honolulu with an honest no-complete-ground-route outcome. Production Google schedule/estimated provenance passed response schemas. No raw provider payload, key or purchase was retained. These API observations are separate from fixture/browser regressions.

All 50 prior browser cases remain, routed to `/legacy`; nine new city cases cover the national flow. No additional cloud setup, authentication or email is required for this approved prototype scope.

## City-first publication and actual UI acceptance

Frontend `85a477b690b3f135c8b5586e3f1ec35edfbaf73e` passed main workflow 39718831436 and branch workflow 39718831139. Native Vercel deployment 4W9H4LQqQeq6ooJ58EhXhcaBW1zf succeeded. Browser title/description were aligned with the national scope in `6883ea5f9f077b57780684f232ce11e5cc8f77c0`; main workflow 39718901506 (661 tests, build and scoped backend deploy), branch workflow 39718900614 and native Vercel deployment J83PtPRC4ynZojaVTh6Sb31XWtZS all passed. Stable production then served `/assets/index-1z-hW_wl.js` and the national metadata.

Actual isolated installed Brave acceptance, without response interception, passed:

- New York City → Philadelphia, ASAP: 4,554 ms, seven Google candidates/three plans, production schedule/estimated provenance, no traveler fixtures or model message.
- Actual model deadline clarification: 4,084 ms, typed deadline question and exact conversation echo, unchanged hard facts and unchanged current cards.
- Structured destination-local deadline: 4,464 ms, correctly converted traveler deadline and seven Google candidates/three plans.
- Actual no-driving/earliest refinement: 7,991 ms, six Google candidates/three plans without driving, completed discovery/assessment/model activity, eligible recommendation and exact echo. A following Cheaper action made zero extra POSTs.
- Google saving was blocked, local/session storage stayed empty, and reload cleared transient trip/chat/results without a POST. Exactly four city POSTs were made, two assisted by the actual model. Script: `/tmp/travel-city-live-ui-check.mjs`; bounded output: `/tmp/travel-city-live-ui-check.log`.
- Separate clean `/legacy` hotel sandbox: 7,448 ms discovery, three estimated sandbox offers, property selection plus explicit fictional transfers produced two plans. Priority/save/reload made zero extra POSTs. Explicit refresh returned three offers while preserving the saved historical JSON and original hotel evidence. No itinerary/saved booking links appeared. Exactly three legacy synthetic+sandbox investigations, no Google/model calls. Script/output: `/tmp/travel-city-legacy-sandbox-check.mjs` and `.log`.

These scripts closed their isolated browsers and retained no raw provider/model payload, credential or purchase artifact. Actual provider/model acceptance is separate from fixture regression coverage. The initial full hosted run passed 58/59 cases in 2.7 minutes. The remaining legacy HTTP case hit its original five-second card assertion: the actual POST took 4,997 ms; the last assertion poll preceded body completion by 189 ms, and the failure snapshot already showed all three cards. The correction waits for the exact successful response/body before preserving every existing plan, security, POST-count and history assertion. Application behavior and provider configuration are unchanged. Independent review approved the test-only fix; three focused repetitions passed in 21.5 seconds, then root ran the complete suite and all 59 cases passed in 2.7 minutes. Final output: `/tmp/travel-city-final-hosted-brave-rerun.log`; artifacts: `/tmp/travel-city-final-hosted-brave-rerun`. No test was skipped or removed. The final verification commit changes only this record and the synchronization test; application source remains the accepted `6883ea5` revision.

Temporary local Vite/Deno verification servers were stopped and their ports released. Actual acceptance browsers closed in `finally`; Playwright closed its isolated test browsers. Private Superpowers, handoff and transferred reference documents remain ignored. Production hotels remain deferred; no author-understanding attestation is made.

# Earlier verification checkpoints

The compact starter-to-chat app is deployed with a v6 backend. Local checks, all 50 hosted Brave cases and actual Google/OpenAI/sandbox acceptance passed as recorded below. Production hotel onboarding remains deferred.

## Starter-to-chat local gate — 2026-10-22

The approved redesign starts with gate arrival and an ASAP/explicit goal, then opens one conversation with contextual hard-fact confirmations, quick replies and a primary route card. Budget, driving, overnight and manual options remain available progressively. Null original departure remains unknown; null deadline uses disclosed 24-elapsed-hour search coverage. Sandbox guidance is deterministic and its transfer defaults are explicitly fictional.

| Check | Captured result |
| --- | --- |
| Full unit/SDK suite | 444 tests across 27 files passed |
| TypeScript/Vite production build | Passed; existing chunk-size warning remains (635.36 kB JS, 190.47 kB gzip) |
| Deno entrypoint check | Passed |
| Real loopback HTTP | Nine cases passed, including minimal nullable starter, exact conversation echo and bounded history rejection |
| Full local installed Brave | All 50 cases passed in approximately one minute |
| Regression preservation | All 39 prior cases retained, plus eleven conversation/guided-hotel workflows; no skips |

Independent domain and backend specification/quality reviews approved. Frontend specification, quality and regression-preservation reviews approved after correcting all findings. Focused regressions exercised invalid explicit deadlines, required stay confirmation, invalid hotel costs/dates, the Enter-submit bypass, same-ID changed-price saved status, typed-result history and both inline deadline/ASAP transitions before their fixes. The final local browser gate includes all corrected flows, stale/late response guards, cache/source boundaries, save/history/storage/expiry/mobile/keyboard behavior. No live provider/model call occurred in these fixture/loopback gates. No credentials were read.


## Starter-to-chat deployed and actual provider acceptance — 2026-10-22

Reviewed implementation `229faf724df586ef555a8d80f47eb42e10aa7870` was pushed to main and the feature branch. [Main workflow 39702713464](https://github.com/asawyers/travel-recovery-companion/actions/runs/39702713464) passed clean install, 444 tests, build and scoped Edge Function deployment. Branch workflow 39702713455 passed. [Native Vercel deployment](https://vercel.com/rito-labs-2cc43421/travel-recovery-companion/ANNHeZM5eys8PU3HKyyvN11rd1g4) succeeded; the stable production app served `/assets/index-DqPxFlpB.js` and returned `public-recovery-v6`.

Actual isolated Brave checks, with no response interception, passed:

- Short custom-arrival/ASAP starter: HTTP 200 in 2,930 ms, two Google schedule candidates/plans, null original departure/connection and null hard deadline.
- Actual GPT-6 Luna clarification: 8,032 ms, typed deadline question, exact turn/revision echo, unchanged hard facts, retained current cards and only model activity. The structured answer then supplied the exact traveler-entered deadline and produced new options.
- Actual GPT-6 Luna preference refinement: 20,559 ms, completed no-driving change with an eligible recommendation and matching echo. A following Cheaper quick reply made zero extra POSTs; no chat or itinerary was saved in that transport profile.
- Actual sandbox discovery: 2,674 ms, three offers with estimated/sandbox provenance. Selected-property guidance and explicit fictional transfer defaults produced two plans, including the selected hotel journey. Priority reranking made zero extra POSTs.
- Sandbox save/reload/refresh: original hotel evidence retained, zero reload POSTs, no booking links and saved historical JSON unchanged after explicit refresh. The successful focused sequence made exactly three synthetic+sandbox investigations with no refinement; refreshed offers remained three.

The actual transport flow and focused sandbox flow ran separately against the same deployed source. Initial harness assumptions about the exact Google attribution label and a shared sandbox/real hotel confirmation control were corrected to match the source before acceptance; these required no application change. The sandbox rerun did not repeat already-passing paid model checks. Temporary scripts `/tmp/travel-hybrid-live-acceptance.mjs` and `/tmp/travel-hybrid-live-sandbox.mjs` closed their isolated browsers; no credential or raw provider/model payload was retained. Sandbox rates are test data, not live production inventory. Production hotel onboarding remains deferred.

## Final hosted browser gate

All 50 configured Brave cases passed against the stable production app in 1.9 minutes. The first hosted run passed 48/50; two manual-route tests incorrectly assumed no additional Google options. The narrow test-only correction targets the exact entered manual card and explicitly verifies investigation remains enabled. It preserves prices, original evidence timestamps, zero-request priority reuse, keyboard selection and validation. Independent regression review approved, the focused two cases passed in 9.5 seconds, then root reran all 50 successfully. No application/provider configuration changed for this correction.

Local 50 cases passed against implementation `229faf7` before the final hosted-only selector correction. Actual-provider acceptance is separate from these fixture/browser regressions. All task-owned loopback servers and isolated browsers were closed; ports 37425/37426 had no listener. Private Superpowers/session/reference documents remain ignored. The remaining production-hotel onboarding and the author's own understanding review are separate from the completed challenge UI/deployment scope.

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


## Model registry amendment — 2026-10-21

The user chose `gpt-6-luna` and requested a server-side registry instead of environment model selection. `MODEL_REGISTRY.recovery` now records the provider/model ID in `server/model-registry.ts`; the Edge entrypoint no longer reads `OPENAI_MODEL`. A regression first failed for an injected environment override, then passed with the registry. Key absence and the independent `RECOVERY_MODEL_USAGE_APPROVED` gate remain covered. The flag remains an activation/off switch, not a spending cap; no paid-use decision or live model call was inferred from the model choice.

All337unit tests across22files, TypeScript/Vite build and Deno entrypoint checking passed; independent review approved. Browser/UI/planner behavior is unchanged, so the previously captured35hostedBrave/7HTTP results were not rerun for this configuration-only amendment. No secret was read, configured or enabled by the agent. The user is adding OPENAI_API_KEY privately.


## Authorized GPT-6 Luna live acceptance — 2026-10-21

After the model/Google activation switches and their lack of a spending cap were explained, the user confirmed setting both `RECOVERY_MODEL_USAGE_APPROVED` and `RECOVERY_PROVIDER_USAGE_APPROVED` to true and requested the remaining plan. The existing private API key was never inspected or retrieved by the agent. The server registry selects `gpt-6-luna`; registry revision `b994fb5d6a929cc774407f068d471df29c4cb34b` deployed successfully through main workflow 39690951463 and native Vercel. No account setup, credential retrieval or further configuration change was needed.

A fresh isolated Brave session used the real deployed UI and public backend, without response interception. A tomorrow-morning BOS→Portland investigation returned HTTP 200, two Google schedule candidates, two eligible plans and two rendered cards. An explicit source-enabled refinement requested no driving and earliest complete arrival. The live agent response completed in 10,561 ms, applied `drivingAllowed:false`, kept the requested earliest priority and selected `google-routes-bus-1` from its eligible result plans. Its observed activity included completed transport discovery, hotel-tool dispatch with overnight disabled, deterministic assessment and model validation. The hotel tool had no permitted overnight search; no hotel API call or availability claim was made.

The page displayed “Refinement complete” and unchecked Allow driving. A subsequent structured priority change to cheapest produced zero additional POSTs, kept usable result cards and wrote no selected-plan/prompt data to localStorage. The SDK model/client call and fixed provider tools were real in this check; this result is separate from the scripted-model and provider-shaped fixture tests. No ticket, reservation, purchase or external message was created. Missing fares remained unknown and the displayed total remained explicitly incomplete.

Temporary acceptance script: `/tmp/travel-live-agent-acceptance.mjs`; the isolated Brave process closed after the check. Raw model/provider payloads and credentials were not persisted. The initial live result proves Task 12's actual discovery→assessment→eligible recommendation path. Hotel live acceptance and the author's personal code-understanding review remain separate pending items.


The final live constraint/timestamp check also passed in Brave (`/tmp/travel-live-agent-constraints.mjs`). GPT-6 Luna completed in 11,276 ms and applied both `drivingAllowed:false` and `priority:cheapest`. Explicit assertions verified unchanged arrival/deadline, budget amount/mode, overnight permission/stay, airport/destination and exit allowance. The recommended plan was selected from its displayed result card. After changing priority back to earliest and selecting that same plan, the rendered arrival/leg source-check timestamps were identical and there were zero additional POSTs. No prompt or chosen plan was stored.

An earlier attempt at this added timestamp check completed the live agent and hard-field assertions, then stopped on a test-harness selector matching two identically named operator buttons. The harness was corrected to select the card by its assessed plan position; the complete check then passed. No application change or provider/model retry behavior was introduced. All isolated Brave processes closed. The user has requested a manual LiteAPI account-setup walkthrough; signup is the next pending action, not an execution denial.


## Explicit hotel sandbox demo — 2026-10-21

The user obtained a sandbox key and explicitly approved “Add labeled sandbox mode”; production onboarding is deferred. Revision `public-recovery-v5` adds `hotelDataMode:sandbox` only for synthetic requests and a dedicated `LITEAPI_SANDBOX_KEY`. Only explicit hotel investigation can reach the sandbox adapter. It requires a sandbox-prefixed key and literal `sandbox:true` response, preserves estimated/sandbox provenance, and never substitutes production rates. Real requests reject the marker; ordinary examples remain offline; sandbox mode cannot call Google Routes or OpenAI. No production hotel settings were changed.

The UI starts a future New York one-night demo using the current clock. Sandbox rates and fictional onward inputs are labeled separately; property names may refer to real hotels. Selected-property transfer facts are required for a complete journey. Test labels persist through saved history and explicit refresh; booking/handoff links and assisted refinement are disabled. Missing-key and expired-offer states remain honest. Unknown costs stay unknown. A review found that a fresh sandbox start after historical refresh could inherit an old hotel candidate; a failing regression reproduced it, and explicit fresh-start inputs fixed it. Independent backend and final UI reviews approved the corrected changes.

Final local checks: **380 unit tests across 24 files**, TypeScript/Vite build, Deno entrypoint checking, and **7 actual loopback HTTP cases** passed. The existing client chunk-size warning remains nonblocking (about614kB uncompressed). All **39 local Brave cases passed in50.8seconds** against the isolated provider-disabled backend, including four new sandbox lifecycle, binding, unavailable-source and expiry cases. Deployment/hosted results follow when captured. These checks use fixtures/disabled local sources; they do not establish actual sandbox response acceptance, production inventory or bookings. Saving `LITEAPI_SANDBOX_KEY` has not yet been confirmed; actual hosted sandbox acceptance is pending, not denied.


Sandbox code `f79272410a700d2b463cb8b1bf4d647a4ec70205` was pushed to main and the implementation branch. [Main workflow39694843533](https://github.com/asawyers/travel-recovery-companion/actions/runs/39694843533) passed clean install/unit/build and deployed the Edge Function. Native Vercel deployment `3dQbCpc2Z6BbKMVQ6ic8hn8J2mpr` succeeded. A real public POST with investigation disabled returned HTTP200, schema-valid `public-recovery-v5` and three fictional plans. Separate hosted isolation requests confirmed sandbox+investigate:false returns HTTP200/no hotel offers, while real+sandbox marker returns HTTP400. These requests made no provider/model investigation.

All **39 hosted Brave cases passed in1.8minutes** at the stable HTTPS URL. The four sandbox cases cover complete journey/zero-POST priority reuse/save/history/current-clock refresh/fresh reset/return-to-real isolation; property and stop binding; unavailable key; and expiry after edits. Sandbox provider responses in these cases were injected fixtures. No actual hotel sandbox call, production hotel access, key inspection or purchase occurred. All root-owned test servers and isolated Brave sessions were closed. The only remaining sandbox acceptance step is user confirmation that `LITEAPI_SANDBOX_KEY` is saved in the target Supabase Edge Function secrets, then an actual sandbox investigation. This is pending setup, not a denied operation.


## Sandbox source diagnosis — 2026-10-21

The user confirmed `LITEAPI_SANDBOX_KEY` was already saved and requested actual verification. An actual hosted Brave demo returned HTTP200/v5 but no offers because the three-second HTTP helper timed out. A second explicit investigation reached the sandbox response and returned no supported normalized offers. Neither result establishes inventory acceptance; no raw payload or credential was inspected or retained.

The [LiteAPI rates reference](https://docs.liteapi.travel/reference/post_hotels-rates) defines the supplier timeout in seconds and notes additional response-return time. Our request uses six seconds. A reviewed correction gives only sandbox rates eight seconds; Google, production hotel rates and hotel details keep their three-second default, and the shared fifteen-second parent bound remains. Fixed sandbox rejection categories/counts distinguish empty results, incompatible rates and missing property metadata without exposing provider identifiers, amounts or messages. Parsing predicates are unchanged pending actual diagnosis. New regressions failed before their changes, then all400unit tests/24files, build/typecheck and Deno passed. Independent backend review approved.


## Actual hotel sandbox acceptance completed — 2026-10-21

The diagnostic revision `7245dec` deployed successfully through main workflow39696691023. An actual Brave response took4699ms and reported three received/inspected records, all rejected by selling-price checks. The production-only SSP check had incorrectly applied to nonbookable sandbox quotes. The narrow correction keeps SSP/public-price checks for production and uses the separately validated USD retail total in sandbox; occupancy, identity, integer cents, consistent totals, test provenance and disabled booking links remain enforced. Higher/unsupported SSP regression cases failed first, then401unit tests/24files, TypeScript/Vite build and Deno passed; independent backend review approved.

Correction `adf534bb0eecdc258ce513ad4876b32e154cf551` was pushed to main/feature. [Main workflow39696938768](https://github.com/asawyers/travel-recovery-companion/actions/runs/39696938768) passed clean checks and deployed the backend; native Vercel `ASEf9AQGpV1sD2Wd8FwQjzrywyu6` succeeded. An isolated actual Brave session, with no response interception, then passed:

- Initial explicit demo: HTTP200/v5 in5198ms, three offers carrying estimated/sandbox evidence and clear test labels. No production booking origin or AI controls/booking links.
- Selected property plus entered fictional20/25-minute transfers,15-minute check-in and checkout-day bus: refreshed three offers and two feasible plans, including the selected hotel journey.
- Priority change: zero additional POSTs; saved hotel evidence retained its original timestamps.
- Device save/reload: sandbox marker and labels retained, no reload POST, no booking links.
- Explicit refresh: one new sandbox investigation, three offers, saved historical JSON unchanged. The successful sequence made exactly three recovery POSTs, all synthetic+sandbox+investigate:true and no refinement.

Acceptance script `/tmp/travel-live-sandbox-acceptance.mjs` closed its isolated Brave process; no raw provider payloads or credentials were retained. Handler/registry tests establish no Google/model/production source crossover for this mode; the observed UI made only explicit sandbox requests. This completes the challenge's approved sandbox scope. These are actual sandbox test responses, not live production inventory or bookable prices. Production onboarding remains deferred, and no purchase was performed. Prior39local/39hostedBrave fixture regressions remain the UI baseline; the focused actual sequence verifies the backend-only amendments without repeating unrelated UI tests.
