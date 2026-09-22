# Client ownership and preservation controls — #266

Date: 2026-09-13. Ticket: [#266](https://github.com/Umami-Creative-GmbH/z8/issues/266).
Parent: [#264](https://github.com/Umami-Creative-GmbH/z8/issues/264), slice T02.
Inspected source baseline: `35fa37b438c99a473596dfac2a861a79fdfd538d`.

## Disposition

**Source investigation recorded; ticket completion and affected activation remain blocked.**
The user selected “Record blockers and commit” after being asked for the missing
client repositories and release-owner evidence. Keep #266 open. None of the
client scopes below has verified deployed coverage or an effective preservation
control established by this investigation.

The binding contracts are [#263, offline compatibility](https://github.com/Umami-Creative-GmbH/z8/issues/263#issuecomment-5654640636)
and [#259, adoption handoff](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).
The broader writer/configuration/worker inventory belongs to
[#265](https://github.com/Umami-Creative-GmbH/z8/issues/265). Its reported dossier
is not present at this checkout baseline; its issue status does not certify the
client controls here.

This document records source observations, limited GitHub release metadata and
explicit evidence requests. It adds no runtime gate, queue migration, persistence
owner, cleanup policy or protocol. Proposed controls below are acceptance
obligations, not installed mechanisms or authorization to operate production.

## Evidence boundary and ownership

Line references describe the pinned baseline. Full paths are repository-relative;
abbreviated citations use these explicit roots:

- Browser `src/…`, `public/…` and `next.config.ts`: `apps/webapp/`.
- Browser `offline-queue-db.js` and `sync-service.js`: `apps/webapp/public/lib/`;
  `sw.js`: `apps/webapp/public/`; `use-offline-clock.ts`:
  `apps/webapp/src/hooks/`; `sw-update-prompt.tsx`:
  `apps/webapp/src/components/offline/`.
- Desktop `src-tauri/…`: `apps/desktop/`; bare Rust filenames such as
  `commands.rs`, `offline.rs` and `clock.rs`: `apps/desktop/src-tauri/src/`;
  `tauri.conf.json`: `apps/desktop/src-tauri/`.

An implementation location identifies where changes belong; it does
not identify the person authorized to build, sign, distribute or disable a client.
The ticket is assigned to `KaiSoellch`; that is investigation ownership, not
verified release authority.

Read-only inventory performed:

- `git ls-files apps/extension apps/mobile`: no tracked files. The workspace
  `apps/` directory contains `desktop`, `docs`, `marketing` and `webapp`; extension
  and mobile directories, including the earlier extension artifacts, are absent.
- `git ls-files '*CODEOWNERS*'`: no tracked ownership manifest found.
- `git ls-files .github/workflows`: seven workflows; none supplies a desktop,
  extension or mobile application release pipeline. The webapp image workflow is
  identified below. External pipelines remain unknown.
- `gh release list --limit 20 --json tagName,name,isDraft,isPrerelease,publishedAt`
  returned one release: `v0.9.0`, “RC v0.9.0”, prerelease, published
  `2026-07-21T06:44:32Z`.
- `gh release view v0.9.0 --json url,tagName,targetCommitish,assets` identified
  [that release](https://github.com/Umami-Creative-GmbH/z8/releases/tag/v0.9.0),
  `targetCommitish: main`, and no attached assets. This does not inventory GHCR,
  app stores, organization downloads, installations or supported client versions.

No production endpoint, device queue, database, store dashboard or deployment
system was inspected. No production prevalence or historical incident is inferred.

| Client scope | Source/build evidence | Release ownership and supported deployed versions |
| --- | --- | --- |
| Browser page + PWA/service worker, per server origin/profile | `apps/webapp/src/lib/query/use-time-clock.ts`; `src/hooks/use-offline-clock.ts`; `public/sw.js` and `public/lib/{offline-queue-db,sync-service}.js`. `.github/workflows/publish-images.yml:49–58,97–109,155–160,260–285` builds amd64/arm64 webapp images, passes commit build arguments, records digest artifacts and publishes tags. `docker/Dockerfile.webapp:66–75,93–100` builds Next and copies public worker files into the image. | Source and build recipe located in this repository. Named release/operator owner, actual image digest per origin, deployed page/worker combinations and supported versions **unknown**. A workflow definition is not a successful build or rollout record. |
| Desktop, per installation/server destination | `apps/desktop/package.json:1–9` declares `0.1.0`, Vite/TypeScript build and Tauri CLI. `src-tauri/Cargo.toml:1–5` and `tauri.conf.json:3–10,38–59` declare `0.1.0`, identifier `com.z8.timer`, frontend build and Windows MSI/NSIS targets. | Source and local build recipe located. Named builder/signer/distributor, release pipeline, installed binary hashes/platforms, update authority and supported versions **unknown**. The manifest version is not a deployed-version census. |
| Extension, per extension ID/store or unpacked channel/profile/server | No application source or build artifacts in this checkout. Webapp routes are server evidence only. #263 records an earlier artifact-only inspection at another baseline. | Repository, source/build owner, extension IDs, signing/publishing identity, store/unpacked versions and support policy **unknown**. Earlier compiled artifacts cannot prove source ownership or current application coverage. |
| Mobile, per app ID/platform/distribution channel/server | No mobile application source/build manifest in this checkout. `apps/webapp/src/app/api/mobile/time-clock/route.ts` and `apps/webapp/src/app/api/mobile/shared.ts` describe only the server adapter. Historical Expo plans are not implementation evidence; the Tauri mobile entry-point attribute is not a verified mobile product build. | Repository, source/build owner, app IDs, signing/distribution owner, installed/native/OTA versions and support policy **unknown**. Server-route coverage cannot satisfy application coverage. |

## Caller, stored evidence and transport register

### Browser page and service worker

The browser has two distinct producers, both feeding the same worker-owned store:

1. `apps/webapp/src/lib/query/use-time-clock.ts:114–165,185–236` queues when the
   hook considers the browser offline. It captures action timestamp in epoch
   milliseconds, active organization and browser timezone, with applicable
   location/project/category intent. Online calls use server actions, without
   this durable pre-send queue. The offline clock-out branch does not retain the
   supplied online `submissionId` or intended work-period identity.
2. `apps/webapp/public/sw.js:150–211` intercepts same-origin
   `POST /api/time-entries` and queues only after fetch throws. It copies selected
   fields, parses timestamps, substitutes failure-time `Date.now()` if missing,
   defaults organization to `"unknown"`, and drops incoming action ID, offset and
   replay fields. A synthetic HTTP 202 means locally queued, not remotely committed.

`apps/webapp/public/lib/offline-queue-db.js:8–11,30–46,73–110,118–140`
defines IndexedDB database `z8-offline-queue`, version `1`, store `clock-events`,
key path `id`, indexes `createdAt` and `organizationId`. Stored fields are:

```text
id: locally generated Date.now()/random string
type, timestamp, organizationId
notes, location, projectId, workCategoryId, workLocationType
browserTimezone: provided value or null
retryCount: initially 0
createdAt: enqueue-time epoch milliseconds
```

No captured account, employee, server assertion, stable business operation ID,
command/evidence version, intended-period/dependency, durable failure or committed
receipt is stored. Origin-local storage is not captured account/organization
binding. `getPending()` reads the whole `createdAt` index; the organization index
does not partition processing or recovery disclosure.

`apps/webapp/public/lib/sync-service.js:24–54,124–204` submits to same-origin
`/api/time-entries` using the **current cookies**, serializes timestamp to ISO,
transmits the organization field, drops falsey optional fields and normalizes
`field` to `remote`. It sends no business ID. Sequential iteration does not bind
dependants: a transient predecessor failure still allows subsequent requests.
These transformations must not become the matching rule for preserved historical
commands; original values/omissions and provenance must remain available.

There is a composed destructive source path:

```text
queued organizationId (including "unknown")
  -> sync-service sends organizationId
  -> time-entries route rejects supplied organizationId with HTTP 400
  -> sync-service classifies 400 as conflict and removes the local row
```

Sources: `sync-service.js:37,81–87,167–180` and
`apps/webapp/src/app/api/time-entries/route.ts:244–260`.
This is a statically traced path, not an executed reproduction. Removing the
assertion would lose captured-context protection and is not a compatibility fix.

Recovery UI currently exposes aggregate queue count and in-memory error/sync
status (`apps/webapp/src/hooks/use-offline-clock.ts:65–71,108–151,244–266`).
`TRIGGER_SYNC` waits for a port reply (`:193–203`), whereas
`apps/webapp/public/sw.js:389–391,441–449` does not send it. Successful individual
sync handling does not persist receipts. Queue insertion resolves on the add
request's success rather than transaction completion
(`offline-queue-db.js:95–110`); an acknowledgment is not proof against later abort.

### Desktop queue and ordinary/break transport

`apps/desktop/src-tauri/src/offline.rs:21–29,64–83,88–106` uses
`offline_queue.db` in the app data directory, table `queue`:

```text
id INTEGER PRIMARY KEY AUTOINCREMENT
action_type TEXT NOT NULL         # JSON enum: "ClockIn"/"ClockOut"/"ClockOutWithBreak"
timestamp INTEGER NOT NULL        # seconds, not browser milliseconds
payload TEXT                     # optional; keep original text
retry_count INTEGER DEFAULT 0
created_at INTEGER NOT NULL       # enqueue-time seconds
index idx_queue_created_at(created_at)
```

The inspected initializer has no schema/command version or migration journal.
Rows lack original account/organization/server/employee, event-time zone, business
identity, intended work, dependency, substep receipt and resolution evidence.

| Action/format | Meaning evidenced by current source |
| --- | --- |
| Ordinary `ClockIn` | `commands.rs:99–110` records timestamp after string-matched network failure, payload is the work-location string. `offline.rs:208–225` converts seconds to RFC3339 and submits it; absent/unrecognized location defaults to office. It is not proven original click-time capture. |
| Ordinary `ClockOut` | `commands.rs:158–164` records failure-time seconds with no payload. `offline.rs:229–230` calls ordinary `clock_out`; `clock.rs:151–175` sends only `type`. The saved timestamp is ignored; do not reclassify historical closes as using it. |
| JSON `ClockOutWithBreak` | `commands.rs:225–241` stores failure-time seconds plus `breakStartTime` and `workLocationType`. `offline.rs:232–255` uses stored seconds for resumed clock-in and payload for close. `clock.rs:179–229` performs two HTTP requests without atomicity or durable partial-success checkpoint. |
| Legacy bare break timestamp | `offline.rs:38–49` accepts RFC3339 text and supplies office as a compatibility default. That default and UTC serialization do not establish original location or event-time timezone. |
| Malformed type/payload or exhausted row | `offline.rs:112–120` logs/skips malformed action types; `:196–205` skips rows at five retries; payload failures increment retries. Rows remain, but count-only recovery does not make their evidence inspectable. |

The background processor starts in `src-tauri/src/lib.rs:89–93`, wakes every
30 seconds, reads current token/server URL and all queued rows
(`offline.rs:158–187`), and continues after predecessor failures. Requests carry
Bearer auth to configured `/api/time-entries`; no action ID or zone/offset capture
is sent (`clock.rs:72–85,120–229`). Status is a separate GET.

Context transitions are unbound to rows: `state.rs:10–17,33–54,58–83` stores token,
settings and queue separately; `auth.rs:314–327` clears token on logout and retains
the queue; `commands.rs:304–327` changes destination; and
`apps/desktop/src/hooks/useOrganizations.ts:33–46,71–83` switches the current server
session organization without rebinding or pausing queued work. Logout cannot
cancel a request already using a cloned token.

`commands.rs:99–121,158–174,225–249` ignores enqueue errors and can report apparent
success. `:87–97,147–156,214–223` can report status-fetch failure after a successful
write. Queue deletion/retry-update errors are ignored (`offline.rs:259–268`).
`idle.rs:63–78` estimates idle start on detected return; `apps/desktop/src/App.tsx:86–96`
forwards start but no detected-return endpoint. These records cannot justify a
blind replacement command or replay of an uncertain two-request break.

### Direct HTTP, extension and mobile distinctions

`apps/webapp/src/app/api/time-entries/route.ts:202–212,244–293` derives actor and
organization from cookie/Bearer session, checks membership/active employee and
billing, and rejects supplied ownership fields. `:295–343,396–412` supports
optional UUID `id`, timestamp, `browserTimezone`, integer `utcOffsetMinutes` and
`replay`. Captured evidence selects five-minute admission or seven-day replay
window; identity-less legacy requests do not use that same window. These are
current optional-field branches, **not negotiated versioned clock capabilities**.
Validation precedes the shared service call. The response is `{ entry }`, not the
new submitted-command/receipt/outcome-lookup contract. Preserve existing scoped
committed matching when #275 introduces that contract; status or interval matches
cannot establish noncommitment for identity-less records.

The #263 artifact report describes extension UUID/UTC/zone/offset capture, mutable
server URL, missing captured account/organization binding and deletion on
success/400. This is **inherited artifact-only evidence**, not reinspection here.
Exact deployed storage keys/schema, bytes, retry/upgrade behavior and transport
coverage remain unknown. Do not synthesize fixtures or an upgrade from this summary.

Mobile server evidence is narrower still:
`apps/webapp/src/app/api/mobile/shared.ts:25–79` requires Bearer auth,
`x-z8-app-type: mobile`, matching active membership and employee.
`apps/webapp/src/app/api/mobile/time-clock/route.ts:16–37,65–122` accepts strict action shapes,
UTC `Z` timestamp, IANA zone and checked offset; clock-out requires `submissionId`,
clock-in has no operation ID, and skew is limited to five minutes. There is no
explicit delayed mode in that schema. App-type headers do not identify a
deployed release. Application queue storage, captured context, retries,
offline support, updater and native/OTA compatibility are **unknown**.

## Effective old-consumer controls: none verified

| Scope/control found | Why it does not discharge the activation gate | Evidence still required |
| --- | --- | --- |
| Browser SW registration and optional update | `use-offline-clock.ts:52–54` registers `/sw.js` at `/`. `public/sw.js:47–70,78–105,365–395` waits for `SKIP_WAITING`, cleans aged rows on activation and reports cache names via `GET_VERSION`. `sw-update-prompt.tsx:127–150` offers Reload **and Later**. Neither cache/DB version nor page refresh proves that all old workers/readers are gone. | Per-origin/profile/page/worker/imported-script identity and controller evidence; old background sync, cached pages, dormant/offline profiles, waiting workers and overlapping readers included. Demonstrate effective replacement or disable before strict responses can reach destructive consumers. |
| Browser deployment-refresh prompt | `src/components/deployment-refresh/deployment-refresh-checker.tsx:12,59–118` checks on foreground events subject to a six-hour cooldown and offers Reload/Later. `src/app/api/app-version/route.ts:9–13` returns a build hash only. `next.config.ts:16–33,72–75` uses a shortened hash. | Full source-to-image-to-served-script provenance and observed consumer control; this advisory UI is not command capability negotiation or a kill switch. |
| Desktop packaging/startup/logout/quit | `src-tauri/Cargo.toml:15–38`, `tauri.conf.json:54–60` and `apps/desktop/src-tauri/src/lib.rs:22–53` contain no updater dependency/configuration/plugin. The processor starts with the application; logout pauses later loops only while there is no token. `tray.rs:13–15,47–49` supplies a manual **Quit** action calling `app.exit(0)`, without queue deletion in that handler. This is a source-observed process-exit control, not verified fleet enforcement, relaunch prevention or resolution of already-sent work. `startup.rs:25–44,57–68` disables the Windows startup registry entry (non-Windows is a stub); it does not terminate a running process. | Named installation-management owner, signed package/build mapping and actual update/stop evidence for each platform/channel, including running/tray processes, relaunch and interrupted installations. Preserve app-data queues during update/disable/rollback. |
| Desktop documentation claims | `apps/docs/content/docs/desktop/getting-started/installation.mdx:13–21,58–60` describes multiple platforms and automatic update prompts; inspected bundle config lists Windows targets and has no configured updater. | Resolve documentation versus actual distribution with the release owner. Documentation is not evidence of an updater; update affected guidance with the verified preservation delivery (#268). |
| Extension store/manual distribution | `apps/docs/content/docs/guide/user-guide/browser-extension.mdx:26–65` links store landing pages and describes unpacked installs, without product IDs or release evidence. | Actual extension ID, store/policy/unpacked channel and owner; background/popup consumers, failed/disabled automatic updates, dormant profiles and storage-preserving disable behavior verified for each supported version. A new store release alone is insufficient. |
| Mobile distribution | Only server adapter and historical plans found. | Actual app IDs, source and signed native/OTA builds, platform/channel support and effective control of old/offline clients, with queues surviving interrupted update/rollback. Do not assume OTA can replace every native consumer. |

For an old destructive browser/extension reader, changing a server status is not
a preservation mechanism: browser 400/409 deletes immediately, other retrying
errors can lead to exhaustion deletion, and age cleanup requires no server
response at all. Returning success to stop retries can also acknowledge/drop
unresolved work. Database-version bump, cache clearing, token revocation,
uninstall or optional reload alone cannot establish retained evidence and
exclusive safe consumer ownership. No such operational action was attempted.

## Preservation proof obligations

The mechanism required by #263 is preservation-first reader replacement,
restart-safe upgrades and retained recovery, followed by verified control of old
consumers. **It has not been demonstrated here.** The table is the required
caller-to-outcome verification at real storage/transport seams, not passing tests.
All rows are outstanding; new runtime evidence and cleanup must belong to the
existing client recovery/completed-work lifecycle rather than a competing store.

| Failure boundary | Current evidence | Required retained outcome and proof | Delivery slice |
| --- | --- | --- | --- |
| Validation, conflict or upgrade-required response | Browser `sync-service.js:81–87,167–180` removes 400/409; extension artifact report describes deletion on 400. Mobile unknown; desktop stops after bounded retries without actionable recovery. | Original row/fields/identity survive exact real adapter responses; durable actionable hold, authenticated inspection/export, dependent commands paused. Unsupported commands never downgrade. Prove old consumers cannot receive/process these rows destructively. | #267, #268, #282, #283; control evidence stays in #266 |
| Age or retry exhaustion | Browser `offline-queue-db.js:249–287` deletes by enqueue age; `sw.js:97–102,393–395,455–463` invokes cleanup; `sync-service.js:137–151` removes exhausted rows. Desktop retains/skips at five. | Beyond seven days and at/above retry limit, automatic attempts stop but original unresolved evidence stays inspectable. Exercise activation cleanup, explicit clear-old message, background and manual paths. | #267, #268 |
| Persistence/upgrade abort or interrupted restart | Browser enqueue acknowledges request success before transaction commit; desktop ignores enqueue error. Neither inspected format implements the required versioned upgrade. | Abort/crash before and after storage commit; atomic stable recovery-ID assignment, original raw fields/text preserved, repeat upgrade does not regenerate identity. Unsupported/malformed rows survive. No accepted-queue UI before commit. A failed upgrade never falls back to a destructive reader. | #267, #268, #279, #280, #282, #283 |
| Old reader coexistence | Browser active/waiting workers and desktop background loop are source-observed; deployed cohorts unknown. | Real old/new page, worker, extension and binary coexistence with pending records, multiple tabs, dormant return and in-flight requests. Effective update/disable must precede stricter admission; a previously captured read must not later delete the retained copy. | #266, #329 |
| Remote commit, lost response, receipt save or local acknowledgment crash | Browser removes success without durable receipt; desktop removes successful actions and has no persisted break substep. | Same frozen identity/command survives uncertainty. Durably persist committed receipt/resolution before active removal. Crash at each boundary; status/delivery failure never creates replacement work. Unknown legacy outcome never proves absence. | #275, #279–#283 |
| Account/organization/server switch | Browser all-queue/current-cookie processing and desktop current-token/server processing; extension/mobile captured bindings unverified. | Pause on mismatch; do not rewrite destination/assertions. Authorized same-context inspection/recovery only, including lost membership. Preserve uncertain in-flight status and known-work/predecessor binding; never target whichever period is now active. | #275, #278–#283 |
| Archive, cleanup, rollback | Browser exports `clearAll()` (`offline-queue-db.js:291–326`); no caller was established by inspected worker dispatch. Age deletion is reachable. Desktop queue shares app data with settings. | Visible archive retains unresolved evidence, not cancellation. Inventory actual clear/uninstall/settings-reset callers before accepting a control. New linked evidence participates in authorized tenant cleanup before capture. Compatible rollback or paused processing preserves receipts/rows; never restore a destructive reader. | #267, #268, #279–#283, #306, #331 |

## Activation-scoped blocker register

Scope is the **affected employee/work graph plus every reachable client and
storage consumer**, not merely one upgraded page or a channel flag. Browser
processing spans organizations in a shared profile; legacy desktop rows lack
organization binding. Unknown relevance must block conservatively. A pilot
organization is not isolated if an old unbound client can still mutate its graph.

| ID | Blocked scope | Missing evidence and responsible follow-up |
| --- | --- | --- |
| C266-B | Browser/PWA clock adoption and stricter direct admission for affected origins/profiles | #266 investigation owner must obtain named web release/operator ownership, supported/deployed image + page/SW/script mapping, old-consumer control and preserved in-flight queues. #267 supplies early preservation; #279 supplies durable adoption; #329 verifies the scoped pilot. **Blocked.** |
| C266-D | Desktop ordinary clocking and breaks for affected installations/graphs | #266 must obtain named build/signing/distribution/device owner, installed version/binary inventory and actual storage-preserving stop/update evidence. #268 supplies early correction; #280 durable commands; #281 atomic breaks and legacy partial-outcome handling. **Blocked.** |
| C266-E | Extension adoption and shared direct-HTTP strict admission | #266 must obtain application repository, build/publisher ownership, exact stored formats, extension IDs/channels/versions and effective old background/popup consumer controls. #282 depends natively on #266 and cannot claim verified application coverage yet. **Blocked.** |
| C266-M | Mobile application adoption, including explicit delayed protocol | #266 must obtain mobile repository, build/signing/distribution ownership, app IDs/native/OTA versions, actual context/storage/transport behavior and preservation-safe update/disable. #278 is server-only; #283 depends natively on #266 for verified application coverage. **Blocked.** |
| C266-X | Work graphs reachable by any combination above; pilot/rollback | #275 capabilities/outcome recovery and applicable completed-work operations, #265/#327 writer/configuration/worker participation and drain, history/in-flight classification, linked cleanup, real client/database verification and #329 pilot evidence are still required. #331 must prove compatible rollback. Source inventory alone closes none of these gates. **Blocked.** |

### Evidence packet needed to unblock each cohort

The accountable release/operator owner must supply a dated record for each
supported and legacy cohort. Use authorized evidence references, not credentials,
tokens or raw tenant work in this repository or public issue comments.

1. **Ownership/provenance:** named source maintainer, repository + full commit,
   build pipeline/run + inputs, artifact digest/signature, distribution identity
   and named operator authorized to update/disable it. Explain any source/artifact
   gap rather than assigning ownership from commit authorship.
2. **Actual scope:** server origins, organization/employee reachability, app or
   extension IDs, platform/channel and supported/deployed versions; page, worker,
   imported scripts and native/OTA combinations distinguished. Record how the
   inventory covers dormant/offline, unpacked/self-hosted and older consumers.
3. **Storage/transport:** original queue schema/format versions and representative
   authorized fixtures with provenance, context binding, request/response behavior,
   retry/age/upgrade rules, all producers/readers/deleters and in-flight uncertainty.
   A queue-local recovery ID never establishes a legacy business operation ID.
4. **Effective control:** the chosen mechanism and operator-owned evidence showing
   old consumers cannot process affected unresolved rows; timing relative to
   stricter admission, remaining exclusions/holds, interruption/restart and
   compatible rollback results. Server denial alone is insufficient.
5. **Preservation verification:** real storage abort/process loss/old-new coexistence
   results for the matrix above, exact retained evidence and durable outcomes,
   linked cleanup participation, scoped access and limited pilot observations.
   Database-dependent operation checks require restored access and authorization.

If effective control cannot be established for a cohort, keep its affected scope
inactive. If investigation demonstrates the agreed preservation contract cannot
be met, raise a focused decision as required by #259 rather than silently
weakening retention, replay or ownership requirements.

## Acceptance and verification status

| #266 acceptance criterion | Status |
| --- | --- |
| Actual source/build owners, supported deployed versions, context, queue and transport for every client | **Partial / blocked:** browser/desktop source formats and server adapters traced; release owners/deployed support unverified, extension/mobile application source absent. |
| Effective update/disable of every affected old consumer, including interrupted upgrades | **Blocked:** existing mechanisms and their limitations recorded; no effective deployed mechanism demonstrated. |
| Preservation cannot delete unresolved rows on validation, upgrade errors, age or exhaustion | **Blocked:** destructive paths identified and required proof specified; no preservation release/runtime result claimed. |
| Evidence and remaining access/ownership blockers by activation scope | **Recorded above:** C266-B/D/E/M/X, with delivery slices and the owner evidence packet. |

Documentation-only delivery. No application code changed. No TDD seam was
implemented; typechecking and application test suites do not establish the
missing ownership/deployment/storage guarantees. No tests, builds, database
operations, repairs, continuation, deployment or activation were executed.
Precommit standards review reported no findings. Spec review identified the
omitted desktop Quit control and ambiguous source citation roots; both were
corrected, including the remaining mobile citation found on recheck.
`git diff --cached --check` passed. Required runtime acceptance remains outstanding.
