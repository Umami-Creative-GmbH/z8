# Browser frozen clock commands (#279 / T15)

## Delivery and activation status

The web clock (widget, popover, offline controls) freezes each clock action as a
version 2 command (#275) and stores it in IndexedDB before the first request. The
service worker then sends it to `POST /api/time-entries/commands`. Online and offline
actions use the same path. A command leaves the active queue only when its committed
receipt or its resolution is stored.

The path is gated twice and is off in production today:

- **Server.** `GET /api/time-entries/commands` must report `submit: "available"`
  for exactly the signed-in account, organization and page origin. That requires the
  organization's `time_entry_append_control` row. No code sets that row.
- **Worker.** The controlling service worker must report
  `clockCommandMode: "frozen-v2"`. Pages running on an older worker keep the legacy
  path.

When either gate is closed, clocking behaves as before: online actions use
`/api/time-clock`, and offline actions are kept as review-only evidence. An action
that was never frozen is not a downgrade. A frozen command is never sent anywhere
else.

References: [#279](https://github.com/Umami-Creative-GmbH/z8/issues/279),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), the resolutions
of [#263](https://github.com/Umami-Creative-GmbH/z8/issues/263#issuecomment-5654640636)
and [#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145),
and the transport in [direct-clock-commands-275.md](direct-clock-commands-275.md).

```text
lib/time-tracking/browser-clock-command.ts  # page: when to freeze, the capture request, result mapping
public/lib/offline-queue-db.js              # IndexedDB v2: upgrade, capture transaction, lifecycle writes
public/lib/clock-command-dispatch.js        # worker: canonical command, send/lookup, typed outcomes
public/sw.js                                # CAPTURE_CLOCK_COMMAND, DISPATCH_CLOCK_COMMANDS, counts, inspection
hooks/use-offline-clock.ts                  # capabilities, capture then attended dispatch
lib/query/use-time-clock.ts                 # chooses frozen or legacy per action
```

## Capture: frozen before the first request

The page fixes the action identity (`crypto.randomUUID()`), the UTC instant
(Temporal, millisecond precision), the IANA event zone and the server-derived
context: user, organization, employee and server origin. It does this when the
button is pressed, after any timezone confirmation. The attribution intent keeps
omission (`preserve`), clearing and replacement distinct. Every browser command
declares `admission: "delayed"`, because a stored command may legitimately arrive
after a transport failure.

The worker stores the command in a single readwrite transaction on
`clock-commands`. In that transaction it:

1. Returns the stored record unchanged if the same request is captured again (a
   lost acknowledgment). A different request under the same identity is
   `identity_conflict`.
2. Binds a clock-out to its target. An unconfirmed clock-in on this device wins
   (`target.clockInOperationId` plus a stored dependency). Next comes the period
   the page last saw active, then the period of the latest committed local
   clock-in. It never falls back to whatever is active later. With no target the
   capture fails with `no_target`. A second clock-in while one is unconfirmed is
   `clock_in_pending`.
3. Serializes the command once, with a fixed key order, and stores those bytes.
   Every attempt sends exactly these bytes.

If the transaction fails, the page reports a failure and nothing is sent. The
reply field is `message`, not `error`, because the page treats `error` as an
unanswered worker. A capture whose acknowledgment is lost reads as "could not
confirm the save", never as queued.

## Dispatch

One sender per worker. Runs are serialized. A run first reads the capabilities and
the server-derived context once. It then walks the active records in local enqueue
order:

| Condition | Result |
| --- | --- |
| Command version not offered | hold `unsupported_version`, nothing sent |
| Captured context differs from the current session | hold `context_mismatch` with the differing fields, nothing sent |
| Predecessor clock-in still pending | hold `predecessor_waiting` |
| Predecessor held for review, rejected, archived or exhausted | hold `predecessor_blocked`; independent commands continue |
| Fresh submission unavailable | uncertain command: lookup only; otherwise hold `not_adopted` |
| Otherwise | send |

Before each send, the record is stored with `uncertain: true` and the attempt
counted, so a crash after this point leaves an uncertain record, never one that
looks unsent. The outcome is then stored:

- `executed`/`replayed` → `committed` with the receipt, in one write. This write
  lands even if the record was archived meanwhile, because archiving never cancels
  a remote commit.
- `unauthorized`, `billing_required`, `access_denied`, `not_adopted`,
  `context_mismatch`, `unsupported_version` → a hold. The record stays pending
  and is retried when the condition clears.
- Any other rejection → `review_required`. The one exception is a first,
  never-uncertain attempt that the user saw (the attended dispatch): it resolves
  as `rejected` and the page shows the server's reason.
- Network failure, a cut response, 5xx, `approval_policy_unavailable` →
  transient. After 5 transient failures the record is `exhausted`, which stops
  automatic attempts but keeps the record. An explicit "Refresh status" resumes it.

A rejection after an uncertain attempt stays `review_required` with
`uncertain: true`. Each later run looks it up and marks it `committed` if the earlier
attempt did commit. Committed and rejected records are removed 7 days after their
resolution was stored. Unresolved records are never removed by age or retry count.

Triggers: the attended dispatch after capture, page load and reconnect, Background
Sync (registered when the run finds no network), and the banner's explicit retry.

## Upgrade and old consumers

IndexedDB moves from version 1 to 2 in one `versionchange` transaction. It creates
`clock-commands` (unique `operationId` index) and classifies unclassified legacy
rows with their original fields preserved. If the upgrade is interrupted, the
database stays at version 1 with its rows untouched. Legacy rows stay in
`clock-events` and are not converted into commands.

A version-1 reader cannot open a version-2 database (`VersionError`), so an older
worker, including one restored by a rollback, fails closed instead of reading or
deleting frozen commands. `GET_VERSION` keeps
`clockQueueMode: "preservation-only-v1"`, so the #266 takeover rules and older page
bundles are unchanged, and adds `clockCommandMode: "frozen-v2"`.

## Inspection, export and archive

`GET_QUEUE_RECORDS` returns legacy rows and frozen commands. Both are scoped by the
authenticated recovery context (user, organization, origin) and use `id` as the
local recovery ID. The dialog shows each command's exact state: waiting, the hold
reason, review with the server code, exhausted, saved on the server, refused or
archived. Export uses `z8-browser-recovery-v2`. Archiving a frozen command
(`archivedFrom` keeps its prior state) stops automatic sending and nothing else.

## Verification (2026-09-25)

### Composed: real Chromium, real worker, real route, PostgreSQL 16

Suite: `src/app/api/time-entries/commands/browser.integration.test.ts`, registered in
the runner and the CI integration job. It is skipped without `Z8_TEST_CHROME_PATH`,
and CI does not set that variable. Real `sw.js`, IndexedDB and dispatcher in
Chromium talk to the real `/api/time-entries/commands` handlers on the disposable
database. Replaced: session, billing provisioning, notification delivery, public
origin.

- A captured clock-in commits (`start_live_work`, writer `direct_http`, entry ID =
  operation ID), and its receipt is stored locally.
- Lost response after the commit: the command stays pending and uncertain. The resend
  sends identical bytes, the route returns `replayed`, and the database is unchanged
  (one entry, one receipt).
- Clock-in and clock-out captured while offline are sent in dependency order. The
  clock-out targets `clockInOperationId`, and the period closes with exactly that
  pair.
- Signed in as another user in the same organization: hold `context_mismatch`
  (`userId`, `employeeId`), with no request and no writes. The command commits after
  switching back.
- Adoption off: an uncertain command is recovered by lookup, not resent. A fresh
  command holds `not_adopted` with no request and no writes.

Run with the #275 suite: **21/21** (fresh container, migration recovery check,
container verified and removed).

### Real Chromium and IndexedDB (no application database)

`src/lib/__tests__/clock-commands.browser.test.ts`, **9/9**, opt-in via
`Z8_TEST_CHROME_PATH`:

- An interrupted v1→v2 upgrade (thrown in `versionchange`) leaves version 1 and the
  row byte-identical. The next open upgrades and keeps the original evidence.
- An aborted capture transaction is reported as a failure and leaves no record.
- Idempotent re-capture, `identity_conflict`, `clock_in_pending`, and clock-out
  binding to the queued clock-in.
- A receipt write aborted after the server committed: the record stays pending and
  uncertain; the next run resends and stores the replayed receipt.
- Server commit with a cut response, then a worker stopped
  (`ServiceWorker.stopAllWorkers`) with a second request in flight. After a reload,
  both commit and every resend is byte-identical.
- Browser process killed (`SIGKILL`) with a request in flight. After a restart with
  the same profile, the record keeps its identity and bytes and commits by replay.
- Context pause and resume; a refused clock-in blocks its clock-out; scoped counts,
  inspection, archive, and no disclosure to another user.
- Uncertain command with submission unavailable: lookup only.

Finding: Chromium silently resends a POST when a reused connection resets before any
response byte arrives. The stand-in first dropped the socket and saw two requests. A
frozen identity makes that resend a replay. The identity-less legacy web clock-in
has no such protection.

### Database-free

- `browser-clock-command.test.ts` (20): when a command may be frozen, the capture
  request, and result mapping. After a save, the result is never a failure.
- `clock-command-dispatch.test.ts` (19): canonical bytes, attempt before send, byte-exact
  resend, bounded retries, holds, dependency order, attended versus unattended
  rejections, lookup of uncertain records, serialized runs. Six mutations (no
  dependency hold, resolving uncertain rejections, no context check, resending when
  submission is unavailable, not marking the attempt uncertain before sending,
  resolving every rejection) each failed at least one test.
- `use-offline-clock.test.tsx` and `use-time-clock.frozen.test.tsx`: gates, a failed
  save as a failure, dispatch outcomes, the legacy fallback, and clock-out binding to
  the known period.
- Existing suites updated for DB version 2 and the new worker file:
  `offline-queue.browser.test.ts` (7/7), `service-worker-takeover.browser.test.ts`
  and `offline-worker.test.ts` pass.

`pnpm run typecheck` passes.

## Remaining activation blockers

This slice closes on implementation. Activation items move to #327, #329 and #331.

- **Adoption (#327).** The path runs only where the organization's append control is
  active. The legacy direct writer and identity-less `/api/time-clock` clock-in still
  write outside the frozen protocol and must be drained or gated first.
- **Old consumers (#329).** Pages on a pre-`frozen-v2` worker keep the legacy path
  until the new worker controls them. The `preservation-only-v1` worker update still
  waits for the user's reload (#266 rules). Deployed-worker inventory and effective
  update control are needed before strict admission.
- **Writer provenance (#329).** Browser commands commit with writer `direct_http`
  and timezone source `browser`. A distinct browser writer needs a migration that
  widens the receipt writer check.
- **Manual pilot (#329).** Verify the offline controls, toasts, banner and recovery
  dialog in a deployed browser (service worker and IndexedDB, not the dev preview
  pane), including a real account switch and a real reconnect.
- **Rollback (#331).** Returning an organization to inactive holds fresh commands
  (`not_adopted`) and keeps lookup and replay. A rollback to a version-1 worker
  cannot open the database and fails closed. Records stay stored until a compatible
  worker returns.
