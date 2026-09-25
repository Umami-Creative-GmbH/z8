# Mobile clock client: retired (#283 / T19)

## Decision

On 2026-09-25 the user decided that the mobile app is discontinued, as the browser
extension was ([extension record](extension-clock-client-retirement-282.md)). No
mobile client adopts the version 2 frozen clock commands.
[#283](https://github.com/Umami-Creative-GmbH/z8/issues/283) closes as not planned.
It is traceable under [parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264)
and the canonical resolutions of
[#263](https://github.com/Umami-Creative-GmbH/z8/issues/263#issuecomment-5654640636) and
[#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).
#259 asks that every retained entry point record participation or effective
disable/retirement evidence, and the checks that exercise it.

The server-side mobile protocol ticket
[#278](https://github.com/Umami-Creative-GmbH/z8/issues/278) is coordinated below.

Basis:

- `4722f938` (2026-09-10, "chore: remove mobile and browser extension apps")
  removed `apps/mobile`. The last source exists only in history
  (`4722f938^:apps/mobile/…`).
- No repository workflow builds, signs or distributes the app. Store listings,
  signed binaries and their source commits are unknown (C266-M in
  [the #266 register](audits/266-client-preservation-controls.md)).
- #283 requires the verified mobile source/build. None exists to adopt.

## What retirement does not do

Removing the source does not remove installed apps. Installed binaries keep their
bearer tokens and keep calling `/api/mobile/*`. They are **old consumers, not
supported clients**. Retirement also does not disable the routes. Any bearer session
that sends `X-Z8-App-Type: mobile` still reaches them, until an explicit gate or
removal decides otherwise (#329).

The mobile risk profile differs from the extension's:

- **No stored rows in committed source.** The last committed app has no clock queue.
  `offline-queue-contract.test.ts` asserted that. Clock actions post directly to
  `/api/mobile/time-clock`. The stored-row preservation obligations are therefore not
  applicable to committed source. An older or externally built binary with a queue
  cannot be ruled out without the C266-M distribution evidence. Such a build would
  meet the route's plain 400s.
- **In-flight uncertainty remains.** Clock-in carries no operation ID, and clock-out
  mints a new `submissionId` on each press. After a lost response, a user retry is a
  new command. No client-side fix will ship.
- **Fixed server binding.** `EXPO_PUBLIC_WEBAPP_URL` is fixed at build time, so each
  binary talks to one server. There is no in-app updater (`expo-updates` is absent),
  remote config or kill switch.

## Retained entry points

| Entry point | State after retirement | Checks that exercise it | Disposition |
| --- | --- | --- | --- |
| `POST /api/mobile/time-clock` | Legacy mobile clock adapter. It calls the shared `clockIn`/`clockOut` actions with `deviceInfo: "mobile"`. In adopted organizations, clock-outs therefore commit `web_clock_out` receipts (`liveClockOutWriter`); mobile has no receipt writer of its own. Clock-ins carry no identity, so a lost clock-in response cannot be recovered. Skew, offset, timezone and schema failures answer with plain 400s. It has no version 2 capture, lookup or delayed admission. | `route.test.ts` (mocked), plus the committed clock-out replay fix above (unit and PostgreSQL). No installed binary was run. | #327: confirm its participation in adopted organizations, or gate it. #329: decide whether to disable it. |
| `GET /api/mobile/home`, `/schedule`, `/my-requests`, `/session` | Read-only views for the app. | Route tests (mocked); `sso-summary.test.ts`. | Keep while installed apps exist; the decision goes with #329 communication. |
| `GET`/`POST /api/mobile/absences`, `POST /api/mobile/absences/{absenceId}/cancel` | Absence requests and cancellation from the app. They are not clock writers. | Route tests (mocked). | Outside the clock scope. Keep or disable together with the other mobile routes (#329). |
| App sign-in handoff: `/api/auth/app-login` (defaults to `mobile`), `/api/auth/app-exchange`, `z8mobile://auth/callback` in `lib/auth/app-redirect.ts`, the `app_auth_type` enum value `mobile` | Issues bearer sessions to installed apps. | Route tests (mocked). | Keep while installed apps exist. Disabling the handoff stops new mobile sessions but not existing tokens. Decide in #329. |
| `capacitor://localhost` in the `organizations/switch` CORS allow-list | Commented "Mobile app (if used)". The Expo app sends bearer requests, not Capacitor ones. | None. | Probably dead. Check it in the #329 cleanup. |
| User and technical docs: `guide/user-guide/getting-started.mdx` (Mobile App), `time-tracking.mdx` (Mobile Clock In/Out), `vacation.mdx` (Requesting Time Off on Mobile), `tech/technical/index.mdx`, `tech/technical/authentication.mdx` | Still describe the app. | Not applicable. | Replace them with retirement guidance in #329. |

## #278 coordination

#278 was to build the bearer-authenticated version 2 mobile adapter on the server. Its
acceptance criteria say "do not claim the mobile application is adopted by server
delegation alone". With no mobile client, the adapter would have no caller.

The #278 session had implemented it locally when it was paused: version 2 routes under
`/api/mobile/time-clock/commands`, a `mobile_clock` receipt writer with a migration, and
a PostgreSQL suite. None of that was pushed. The user decided:

- **Dropped:** the version 2 mobile routes, the `mobile_clock` writer and its
  migration, and the small #275 refactors that came with them. #278 closes as not
  planned.
- **Shipped separately:** a preservation fix on the legacy `POST /api/mobile/time-clock`
  for installed apps. A clock-out whose `submissionId` already committed as an entry
  in the caller's organization and employee skips the 5-minute skew check and replays
  through the unchanged legacy matcher. Before the fix it failed with 400 "outside the
  allowed skew" once 5 minutes had passed. This mirrors #275's committed recovery on
  the legacy direct route and #259's rule that fresh validation must not invalidate
  committed recovery. It is linked from the #278 closing comment.

## Items moved to the activation tickets

**#329 (old-consumer control and pilot):**

- The inventory of installed apps: store listings, signed binaries and their source
  commits, confirmation that no distributed build has a queue (C266-M), and the
  servers each binary is bound to.
- Store delisting, or confirmation that no listing exists. Delisting does not
  uninstall existing copies.
- The disposition of the mobile routes, the sign-in handoff and the docs listed
  above, with user-facing retirement communication.
- In-flight uncertainty of legacy mobile clock commands (no operation ID on clock-in,
  a new `submissionId` per clock-out press). This belongs to the in-flight
  classification before stricter admission.
- If any distributed build turns out to have a queue, the same proof as for the
  extension: installed readers cannot destructively process unresolved rows. Accepting
  residual risk would need a separate focused decision.

**#327 (writers and drain):** confirm that `POST /api/mobile/time-clock` participates
in the adopted clock-in and clock-out operations through the shared actions, or gate
it before an organization adopts.

**#331 (rollback):** there is no mobile adapter to roll back. The legacy mobile route
keeps its current behaviour in every rollback target.

## Acceptance criteria of #283

| Criterion | Disposition |
| --- | --- |
| Use the verified mobile source/build and record capability/version ownership | Not applicable: no source/build exists and none will. |
| Durable frozen identity, instant/zone, context and intended work before send; immediate/delayed; dependencies | Not applicable: there is no mobile client. |
| Scoped lookup/exact resubmission, unsupported-version pause, receipt before removal, actionable failures | Not applicable. |
| Real storage/crash/context-switch and upgrade scenarios; old-client control | Storage and crash cases: not applicable. Old-client control moved to #329. |
| Canonical scenarios through the real boundary | Not applicable to a retired client. For installed apps, only the server routes are exercised, with mocked sessions. The removed app code was never run, so no runtime guarantee about it is claimed. |

## Verification

This change is documentation only. No tests, builds, database operations,
deployment or activation ran.
