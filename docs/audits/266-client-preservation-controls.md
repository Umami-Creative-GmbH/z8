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

**Refreshed 2026-09-24** — see [the evidence refresh](#evidence-refresh-2026-09-24).
It corrects this document's extension/mobile “source absent” finding (the source
is in repository history), records the desired production release, and applies
the #267/#268 deliveries. All completion and activation gates remain blocked.

**Controls implemented 2026-09-24** — see [old-consumer controls](#old-consumer-controls-2026-09-24).
A server-side fence stops known old browser and extension readers from deleting
rows on direct-route failures. The preserving service worker now replaces a
pre-preservation worker without waiting for the user. The browser controls are
verified in real Chromium against the worker of the *desired* production release
(`66bbc7b5`). The extension fence is verified by route tests and a Chromium
extension-origin probe, not by the removed extension code. Neither control is
deployed, and the residual paths listed there still block activation.

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
| Extension, per extension ID/store or unpacked channel/profile/server | No application source or build artifacts in this checkout. *Corrected 2026-09-24: source is in history until `4722f938`; see refresh.* Webapp routes are server evidence only. #263 records an earlier artifact-only inspection at another baseline. | Repository, source/build owner, extension IDs, signing/publishing identity, store/unpacked versions and support policy **unknown**. Earlier compiled artifacts cannot prove source ownership or current application coverage. |
| Mobile, per app ID/platform/distribution channel/server | No mobile application source/build manifest in this checkout. *Corrected 2026-09-24: source is in history until `4722f938`; see refresh.* `apps/webapp/src/app/api/mobile/time-clock/route.ts` and `apps/webapp/src/app/api/mobile/shared.ts` describe only the server adapter. Historical Expo plans are not implementation evidence; the Tauri mobile entry-point attribute is not a verified mobile product build. | Repository, source/build owner, app IDs, signing/distribution owner, installed/native/OTA versions and support policy **unknown**. Server-route coverage cannot satisfy application coverage. |

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

## Evidence refresh 2026-09-24

Refresh baseline: `dev` at `5767fcbc`. The scope is read-only repository history,
GitHub metadata and one read of the infrastructure repository's desired-release
file. No tests, builds, database operations, repairs, deployment or activation.
Historical citations use the `4722f938^:` prefix, meaning the tree just before
the removal commit. Last-committed source shows what was committed. It does not
show which build was released or installed.

### Correction: extension and mobile source exists in history

`4722f938` (2026-09-10, “chore: remove mobile and browser extension apps”)
deleted `apps/extension` and `apps/mobile`. The original inventory above and the
#265 dossier (`265-activation-dossier.md` inspection step 4) inspected
checkouts made after that commit. Their “no tracked source” statements are true
of the checkout, but the application source for both clients remains in history.

Removing the code from the workspace does not remove installed consumers or their
server surfaces. At the refresh baseline, `/api/extension/projects` and
`/api/mobile/*` still exist. User docs still describe the extension
(`apps/docs/content/docs/guide/user-guide/browser-extension.mdx`) and the mobile
app (`apps/docs/content/docs/guide/user-guide/time-tracking.mdx:41–64`). Repository
workflow history (`git log --all -G… -- .github/workflows`) contains no job that
builds or publishes the extension, mobile or desktop clients. The only match was
`export` matching `expo`. Release pipelines for these clients are external or
manual and remain **unknown**.

### Extension: last-committed source

| Aspect | Source evidence (`4722f938^:apps/extension/…`) |
| --- | --- |
| Identity and build | MV3 “Z8 Time Tracker”, `manifest.json:2–4` version `1.0.1`; `package.json:3` says `1.0.0`. The manifest has no `key` or `update_url`, so the extension ID and update channel cannot be derived from source. `vite.config.ts:28–50` builds `dist/` with popup, options and a background module worker. |
| Version vs format | `manifest.json` has stayed `1.0.1` since creation (`fc0565b9`, 2026-02-01) through removal while queue and transport semantics changed (cohorts below). **The manifest version cannot identify a stored format or reader behaviour.** |
| Server binding | `webappUrl` lives in `chrome.storage.sync` (`src/lib/storage.ts:32–77`), which syncs across the user's signed-in browser profiles. Default is `http://localhost:3000`. Host permissions cover localhost and `*.z8-time.app`; `Options.tsx:45–64` requests any other HTTPS origin at runtime. Changing it redirects every queued row to the new server. |
| Queue storage | `chrome.storage.local` key `actionQueue` holds a JSON array (`storage.ts:79–110`). Each add or remove is a whole-array get-then-set without a lock. Popup enqueue (`src/popup/hooks/useClock.ts:120–136`) and background removal (`src/background/background.ts:121`) run in different contexts, so a lost update can drop a row. This is statically traced, not reproduced. Related keys: `optimisticState`, `lastAction`. |
| Row format | Latest: `{id (crypto.randomUUID), type, timestamp (UTC ISO ms), browserTimezone (IANA, "UTC" fallback), utcOffsetMinutes, projectId?, createdAt}` (`src/lib/clock-action.ts:12–54`, `storage.ts:7–10`). There is no account, organization, employee or server binding. |
| Capture | Rows are queued only when `navigator.onLine` is false (`useClock.ts:178–230`). An online request that fails surfaces as an error and is not queued. |
| Transport | `background.ts:99–112`: `POST {webappUrl}/api/time-entries` with **current cookies**, body = row minus `createdAt` plus `replay: true` and `projectId`. No `organizationId` is sent, so the browser's organization-assertion 400 path does not apply. The alarm runs every minute (`:163–170`), plus on startup and on popup `PROCESS_QUEUE`. |
| Deletion | `background.ts:119–122` removes on any 2xx **or 400**. 401, other statuses and network errors `break`, which retains the row and blocks later rows. There is no local age or exhaustion purge. `src/lib/api.ts:95–111` `processQueuedAction` would remove on any non-network error but has no caller. `storage.clearQueue` also has no caller. |
| Update/disable | No in-source updater, remote config or kill switch. Store installations update at the browser's discretion; unpacked installations never auto-update. |

Source-history cohorts, bounded by commits, not releases:

| Cohort | Commits | Stored row | Reader deletes on |
| --- | --- | --- | --- |
| X1 | `fc0565b9` (2026-02-01) → before `252d5082` (2026-05-09) | `{id, type, projectId?, timestamp, createdAt}` | 2xx, 400, **401** |
| X2 | `252d5082` → before `0ed4c360`/`05a75061` (2026-07-10/11) | same as X1 | 2xx, 400 |
| X3 | `0ed4c360`/`05a75061` → `4722f938^` | adds `browserTimezone`, `utcOffsetMinutes`; replay sends `replay: true` | 2xx, 400 |

Composed destructive paths against the **current** direct route
(`apps/webapp/src/app/api/time-entries/route.ts`), statically traced:

```text
X1/X2 row (UUID id, no zone/offset) read by an X3 reader after upgrade
  -> body {id, type, timestamp, replay: true}
  -> UUID id makes hasCapturedEvidence true; zone/offset missing
  -> 400 "Clock timezone evidence is incomplete" (route.ts:296–313)
  -> extension removes the row

X3 row replayed more than 7 days after its timestamp (offline, dormant or 401-blocked)
  -> 400 "Clock instant is outside the allowed capture window" (route.ts:318–326)
  -> extension removes the row: server validation acts as age deletion

Any row after a server/organization change, or with changed work state
  -> 400 for project scope, category, "No active organization" or
     "No active work period found" (route.ts:244–247, 345–394, 421–422)
  -> extension removes the row
```

403 (`route.ts:252–256`, `414–416`), 404 and 409 (`:417–419`) retain the row for
this source's reader, but leave it blocking the queue head. That observation is
not a preservation control: the deployed readers are unknown and may be X1/X2,
and #263/#259 do not accept server denial as a fence.

### Mobile: last-committed source

| Aspect | Source evidence (`4722f938^:apps/mobile/…`) |
| --- | --- |
| Identity and build | Expo “Z8 Mobile”, slug `z8-mobile`, version `1.0.0`, iOS `bundleIdentifier` and Android `package` `com.z8.mobile` (`app.json:3–5,15–25`). `package.json:11` build is `expo export`. There is no `eas.json` and no `expo-updates` dependency, so the source shows no OTA channel. Native build/signing/distribution is **unknown**. |
| Server binding | `EXPO_PUBLIC_WEBAPP_URL` is fixed at build time (`src/lib/config.ts:3–11`). A binary is bound to one server; the user cannot change it at runtime. |
| Account/session | Bearer token in SecureStore key `z8.mobile.session-token` (`src/lib/auth/session-store.ts:3–15`). Requests send `X-Z8-App-Type: mobile` (`src/lib/api/client.ts:34–49`). The organization comes from the server session. |
| Queue | **None.** Clock actions POST directly to `/api/mobile/time-clock` (`src/features/home/use-home-query.ts:61–76`). `offline-queue-contract.test.ts:6–11` (added `05a75061`) asserts that no queue, AsyncStorage, enqueue or replay code exists. Repository history shows no durable mobile clock queue. TanStack mutations are not retried by default (`src/lib/query/query-client.ts`). |
| Command identity | Clock-in has no operation ID. Clock-out generates a new `submissionId` on each press (`src/features/home/clock-action.ts:31–48`). After a lost response, a user retry is a new command, so in-flight uncertainty remains. There are no stored rows to preserve. |

For last-committed mobile source, the stored-row preservation matrix is
**not applicable**; only in-flight/lost-response uncertainty applies (#275/#283).
Whether distributed binaries match this source is **unknown**. An older or
externally built binary with a queue cannot be ruled out without the C266-M packet.

### Browser: desired production release predates preservation

`ab54db28` (2026-09-16) made `publish-images.yml` record each production core
image digest in `Umami-Creative-GmbH/z8-infra`. Argo CD sync stays manual
(`scripts/ci/update-infra-release.py:1–2,60`), so this is **desired** state, not
proof of what runs on any origin. The read-only record at
`scaleway-kapsule/k8s/overlays/production/release/kustomization.yaml` shows:

- The core source is `66bbc7b5` (run `34777842252`, 2026-09-13, success), with
  `z8-webapp@sha256:11082b0e…b033b`. `66bbc7b5` does **not** contain #267
  (`bf7fdbda`) or #268 (`95bba9ad`). The desired production browser page and
  worker are therefore still the destructive pre-#267 reader.
- The `main` core publish that includes #267 (`20faabc1`, run `35790360811`,
  2026-09-22) failed while prerendering `/[locale]/platform-admin/analytics`
  (`Date.now()` in a Client Component). The release-record job was skipped.
  `ca0d16a4` on `dev` addresses that prerender failure; it has not yet reached `main`.

The post-#267 worker answers `GET_VERSION` with
`clockQueueMode: "preservation-only-v1"` (`apps/webapp/public/sw.js:382–386`).
New callers refuse capture without it (`apps/webapp/src/hooks/use-offline-clock.ts:135–140,224`).
Pre-#267 workers do not report it. A new page can therefore **detect** a
destructive controlling worker, but only for pages that load the new code. It is
not a census of dormant profiles, waiting workers or tabs that are never reloaded,
and it does not disable an old worker's background processing.

### Desktop: versions do not distinguish readers

#268 removed the destructive submit/delete loop but kept the same
`offline_queue.db`/`queue` table (`docs/desktop-clock-preservation-268.md:20–23,72–74,118–122`).
`apps/desktop/src-tauri/tauri.conf.json:4` and `apps/desktop/package.json:3` are
still `0.1.0`, the same as the destructive baseline. **A manifest version cannot
tell a preserving binary from a destructive one.** Build hash or signature
evidence is required. #268 adds no updater; Cargo gains only the default-off
`desktop-recovery-evidence` feature. A reinstalled or rolled-back older binary
would read and delete the preserved table.

### Blocker deltas

| ID | Change from this refresh | Still missing |
| --- | --- | --- |
| C266-B | Desired production release identified; it predates #267. The `preservation-only-v1` marker exists for detection. | Deployed digest per origin, named web release/operator owner, publish and sync of a preserving release, and proof that old workers and dormant profiles cannot process rows. **Blocked.** |
| C266-D | Source-preserving reader exists (#268); versions are indistinguishable. | Builder/signer/distributor, binary hash inventory, update/stop mechanism, and rollback protection against older binaries. **Blocked.** |
| C266-E | Source, stored format, three reader cohorts and composed 400 deletion paths traced from history. | Extension IDs, store/unpacked channels, publisher owner, deployed cohort per installation, and any control that stops X1–X3 readers before rows age out or hit 400. **Blocked.** |
| C266-M | Source traced; no durable queue in any committed version; server fixed per build. | App IDs as distributed, signed binaries and their source commits, confirmation that no distributed build has a queue, and store/native update control. **Blocked**, but the stored-row obligations narrow to in-flight uncertainty if confirmed. |
| C266-X | No change. | Unchanged. **Blocked.** |

Evidence request to the release/operator owner, in addition to the packet above:
(1) the extension ID(s), channels and publish history mapped to the X1–X3
cohorts; (2) mobile store listings/binaries mapped to source commits;
(3) desktop installer hashes mapped to source commits; (4) the digest actually
running on each production and self-hosted origin, and when Argo CD synced it.

## Old-consumer controls 2026-09-24

Baseline: `dev` at `cfd4983c`. The user agreed this scope and authorized tests and
typecheck. There were no database operations, deployment or activation. The
controls are source changes only; the desired production release is still
`66bbc7b5` until the release owner publishes and syncs a later one.

### Direct-route fence for known destructive readers

`apps/webapp/src/app/api/time-entries/legacy-consumer-fence.ts` classifies
cookie-authenticated `POST /api/time-entries` requests. It rewrites **only failure
responses**, keeps the original `error` text and adds `hold`. No request that
succeeds today is refused, and no failure becomes success. Bearer requests
(desktop) are never classified.

| Class | Request signature | Rewrite | Why this status |
| --- | --- | --- | --- |
| `legacy-browser-queue` | `organizationId` present, no `id`, `replay` or `utcOffsetMinutes`. This is the pre-#267 `sync-service.js`, which always sends the queued organization. The route rejects that field, so these requests can never succeed. | Any non-2xx → **401** | The pre-#267 reader deletes on 400/409 and counts every other failure towards the five-retry purge. On 401 it stops the pass, keeps every row and counts nothing (`66bbc7b5:…/sync-service.js`). |
| `legacy-extension-queue` | An extension-scheme `Origin`, or `id`/`replay` present. X1/X2 send only `{type, timestamp, projectId?}`, so they are recognized **only** by `Origin`. X3 also sends `id` and `replay`. | **400 → 409**; other statuses unchanged | X1–X3 delete on 2xx and 400, and X1 also on 401. All keep the row on 409, and none has an age or retry purge. 401 stays 401 so extension login handling still works. |

Side effects and retirement:

- An old browser tab shows "Session expired. Please log in again." after each
  fenced pass, because the pre-#267 reader replaces the text of any 401. The row
  stays at the head of its queue until the preserving worker takes over.
- Rewritten answers carry only `error` and `hold`; other body fields and headers
  of the original failure (for example the billing `reason`) are dropped.
- The fence is unconditional once deployed. It is a preservation control, not
  stricter admission, because it changes only responses that already fail.
  Retire or narrow it when the inventory shows no pre-preservation reader remains,
  or when a new cookie client adopts `id`/`replay`/`organizationId` (for example
  #282), because such a client would be classified by it.

### Preserving worker replaces a destructive worker

`apps/webapp/public/sw.js` still waits for the user's reload between preserving
releases. During install it now asks the active worker for `GET_VERSION`. If the
answer lacks `clockQueueMode: "preservation-only-v1"`, or there is no answer
within three seconds, it calls `skipWaiting()`. Activation then claims open tabs.
Pre-#267 pages under the new worker only reach preserving handlers:
`QUEUE_CLOCK_EVENT` stores for review, `TRIGGER_SYNC` classifies without posting,
and `CLEAR_OLD_QUEUE` no longer deletes.

### Executed verification

The real-browser suite `apps/webapp/src/lib/__tests__/service-worker-takeover.browser.test.ts`
runs the worker of the **desired production release**, copied verbatim from
`66bbc7b5` into `src/lib/__tests__/fixtures/sw-66bbc7b5/`. Whether that worker is
what each origin actually serves is still unverified (C266-B). It uses real Chromium (Edge 64-bit
via `Z8_TEST_CHROME_PATH`) service-worker lifecycle, Background Sync and IndexedDB.
The test server answers with the route's 400 and passes it through the real fence
functions.

| Case | Result |
| --- | --- |
| Baseline: old worker queues through its own page protocol, syncs, gets the route's 400 | Row **deleted**. This reproduces the dossier's statically traced browser path. |
| Same, with the fence | Server answers 401; row **kept**, `retryCount` 0 |
| Old worker controls a tab; the preserving release is published; `registration.update()` | New worker takes control without `SKIP_WAITING`; reports `preservation-only-v1`; the row survives |
| Preserving worker controls a tab; a rebuilt preserving release is published | Update stays **waiting** for the user, as before |
| A minimal MV3 extension (manifest `1.0.1`) posts an X1/X2-shaped body from its background worker | Chromium sends `Origin: chrome-extension://<id>`; the fence answers 409 |

The extension-origin probe also shows that server request logs would reveal the
IDs of deployed extensions, which is one way to obtain the C266-E inventory.
Firefox (`moz-extension://`) and Safari origins were not tested.

Route tests (`route.test.ts`) cover:

- the browser 401 hold;
- the extension 409 hold for an X1/X2 row replayed by an X3 reader, and for an
  id-less X1/X2 request recognized by its extension `Origin`;
- extension sign-in failures staying 401;
- a successful extension capture passing through unchanged;
- Bearer requests keeping the plain 400.

The existing six-case #267 Chromium suite still passes. `pnpm --filter webapp
typecheck` passed.

The full webapp suite (`vitest run`, Edge as the browser) ended with 976 files
passed, 32 failed and 5 skipped; 11,073 tests passed, 143 failed and 283 skipped.
None of the failing files imports a changed module. All 32 files also fail in a
clean `cfd4983c` checkout on the same Windows host, with 144 failed tests there.
The inspected causes are host problems, such as path normalization in the
source-analysis helper and the host timezone. Root `pnpm test` stops earlier, in Docker runtime-script
tests, on Windows paths.

The running dev server serves the main checkout, not this worktree, so it cannot
show these changes. The fence is not exercised against the live Next route, and
the X1–X3 extension readers were not executed; they exist only in history.

### Residual destructive paths (still blocking)

The fence needs a server response, and the takeover needs the browser to fetch
the new script. The following old-consumer deletions reach neither:

1. **Browser age purge.** The old worker deletes rows by 7-day enqueue age on its
   own activation and on the old page's `CLEAR_OLD_QUEUE`. Neither depends on the
   server.
2. **Browser retry purge.** Rows already at `retryCount >= 5` are deleted at the
   start of the next old pass. Network errors still count retries.
3. **Browser rows without `organizationId`.** They are not distinguishable from
   other cookie callers, so they are not classified. A 400/409 still deletes them.
4. **Window before update.** A dormant profile's first sync after deployment runs
   the old code before the browser fetches the new script. The fence covers that
   pass's server answers, but not items 1–3.
5. **Extension X1 on 401** (expired session) still deletes. Held extension rows
   block the queue head, and the extension has no recovery UI.
6. **Unknown deployed builds.** Controls are keyed to last-committed source.
   Builds that differ from it, and any server/origin not running a fenced release,
   remain uncovered.

Desktop is unchanged: old binaries do not delete on failure, and #268 removed
the submit/delete loop. Mobile has no stored rows to fence.

### Blocker deltas (controls)

| ID | Change | Still missing |
| --- | --- | --- |
| C266-B | Fence and takeover implemented and verified against the `66bbc7b5` worker | Release owner to publish and sync a release containing #267 and these controls on every origin; residual paths 1–4 evidence or acceptance; deployed digest per origin. **Blocked.** |
| C266-E | 400 deletion fenced for known cohorts | Extension IDs/channels and deployed cohorts; X1 401 path; hold visibility. **Blocked.** |
| C266-D, C266-M, C266-X | No change | Unchanged. **Blocked.** |

## Acceptance and verification status

| #266 acceptance criterion | Status |
| --- | --- |
| Actual source/build owners, supported deployed versions, context, queue and transport for every client | **Partial / blocked:** browser/desktop source formats and server adapters traced. Extension and mobile last-committed source traced from history (2026-09-24 refresh). Desired browser release identified. Release owners, deployed versions and extension/mobile distribution unverified. |
| Effective update/disable of every affected old consumer, including interrupted upgrades | **Partial / blocked:** browser takeover of a destructive worker implemented and verified in real Chromium against the `66bbc7b5` worker (2026-09-24 controls). Not deployed. Dormant profiles, the pre-update window and extension/desktop/mobile update or disable remain unproven. Preserving browser and desktop source exists (#267/#268) but is not in the desired production release, or is not distinguishable by version. |
| Preservation cannot delete unresolved rows on validation, upgrade errors, age or exhaustion | **Partial / blocked:** the direct-route fence stops validation/conflict deletion by the old browser reader (verified with the desired-release worker) and by known extension cohorts (route tests and a Chromium extension-origin probe; the removed extension code was not run). Old-browser age and retry purges, rows without `organizationId` and the X1 401 path remain; see residual paths. |
| Evidence and remaining access/ownership blockers by activation scope | **Recorded above:** C266-B/D/E/M/X, delivery slices, owner evidence packet, 2026-09-24 deltas and control deltas. |

The original 2026-09-13 delivery was documentation-only. No application code
changed and no TDD seam was implemented; typechecking and application test suites do not establish the
missing ownership/deployment/storage guarantees. No tests, builds, database
operations, repairs, continuation, deployment or activation were executed.
Precommit standards review reported no findings. Spec review identified the
omitted desktop Quit control and ambiguous source citation roots; both were
corrected, including the remaining mobile citation found on recheck.
`git diff --cached --check` passed. Required runtime acceptance remains outstanding.

The 2026-09-24 refresh is also documentation-only. It read repository history, GitHub
run/release metadata and the `z8-infra` desired-release file. It did not
modify infrastructure, trigger workflows, run tests or builds, access a database,
or deploy or activate anything.

The 2026-09-24 controls change application source (route fence, service worker)
and add tests. Tests and typecheck ran with the user's authorization; see
[executed verification](#executed-verification). No database, infrastructure,
deployment or activation operation was performed.

## Closure disposition (2026-09-25)

#266 closes on implementation. The source investigation, the old-consumer controls
(PR #358) and this blocker register are the delivered scope. Everything still
**Blocked** above is activation evidence that a release/operator owner has to
supply. It moves to the tickets that own the activation gates:

| Item | Moves to |
| --- | --- |
| C266-B/D/E/M: owner evidence packet, deployed versions per origin, extension IDs/channels, mobile distribution, desktop install inventory, effective old-consumer update/disable | #329 (acceptance criterion 2: effective control of every old consumer) |
| Residual destructive paths 1–6: evidence or an explicit acceptance decision | #329 |
| C266-X: writer/worker participation, drain and in-flight classification | #327 (writers and drain) and #329 (classification and pilot) |
| Compatible rollback without a destructive reader | #331 |

The register, the evidence packet and the residual path list above stay the working
reference for those tickets.

### Release refresh

The desired production release in `Umami-Creative-GmbH/z8-infra` moved on
2026-09-24 (`c86cb472`, "update core from Z8 run 36034762525"). The core source is
now `9ca3795f` (the `main` merge of `dev` PR #353), with
`z8-webapp@sha256:4424955e…c510c`. `9ca3795f` contains #267 (`9454e1f6`), the
#358 fence and worker takeover, and #360. The `main` publish run for `9ca3795f`
succeeded.

This is still **desired** state. Argo CD sync is manual, and nothing here proves
which build each origin serves. A read-only request for `https://z8-time.app/sw.js`
on 2026-09-25 returned 503, and `app.z8-time.app` did not answer, so the deployed
worker's `preservation-only-v1` capability was not observed. Confirming the
served digest per origin is the first item of the evidence packet in #329.

### Extension retirement (2026-09-25)

The user retired the browser extension, and #282 closes as not planned. No
extension client will adopt version 2 commands, so the #282 references above
(C266-E, the fence retirement trigger) no longer point at planned adoption.
Installed X1–X3 readers remain old consumers under #329. See
[the retirement record](../extension-clock-client-retirement-282.md).
