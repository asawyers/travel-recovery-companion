# Verification status

The account-free challenge app is deployed at [travel-recovery-companion.vercel.app](https://travel-recovery-companion.vercel.app) and connected to its public Supabase recovery function. Production and Preview Git deployments are confirmed. The independent technical gate passed, including all 25 configured hosted Brave cases; optional live travel and model integrations remain unavailable.

## Revisions

- Deployed application: `6af5d8c775c64d702210a3a37bbe618cb1bcfde7`; stable frontend asset `/assets/index-DJ4PH_o5.js` includes the public backend address.
- Backend behavior: public CORS amendment `828ba97be49db908d32b775b01f4650acd0329da`, also deployed through the docs-only source `6af5d8c`. Facts revision is `public-manual-v1`.
- Acceptance tests: `cb9b7bed1971741e46cfc8dd7d5aba5d7d22eaa6`, a test synchronization correction with no application change.
- Runtime: Node 24.22.0, Deno 2.9.1, Brave 154.1.96.60.

## Fresh independent technical gate

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

All direct hosted API acceptance POSTs used `investigate:false`; provider/model integrations remain disabled. There are no application users, database rows, purchases or bookings.

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

Optional FlightAware, Google Routes, LiteAPI/Nuitee rates/hosted-hotel handoff and model-agent acceptance are blocked on authorized credentials and actual usage limits. No accounts, paid calls or spend limit have been authorized merely by this plan. Manual facts and clearly labeled fictional examples remain usable; synthetic examples never masquerade as live inventory. Authentication/email are intentionally omitted. Two hours is an effort estimate, not a measured hard timer.

Superpowers plans, the private handoff, transferred assessment/spec/provenance and local environment files remain ignored. All transferred references are preserved locally. Prior verification checkpoints remain in Git history and the ignored local history folder.


The technical gate also checked keyboard selection, 320/390 px layouts without horizontal overflow, and fixed provider hrefs with safe new-tab attributes. It did not verify live inventory or the author’s personal understanding. The production build retains a nonblocking main-chunk warning above 500 kB; npm reported an unapproved optional `fsevents` install script. Neither prevented the captured install/build/browser checks.
