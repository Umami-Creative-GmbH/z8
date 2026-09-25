# Durable desktop clock commands (#280 / T16)

Contract: [#280](https://github.com/Umami-Creative-GmbH/z8/issues/280),
[parent #264](https://github.com/Umami-Creative-GmbH/z8/issues/264), and the canonical
resolutions of [#263](https://github.com/Umami-Creative-GmbH/z8/issues/263#issuecomment-5654640636)
and [#259](https://github.com/Umami-Creative-GmbH/z8/issues/259#issuecomment-5654750145).
Server transport: [#275](direct-clock-commands-275.md). Legacy preservation: [#268](desktop-clock-preservation-268.md).

## Delivery and activation status

The desktop app (Tauri) now freezes clock-in and clock-out as version 2 commands in its
device database **before the first network attempt**. It resends each one under the same
identity and bytes until a committed receipt is stored.

The desktop uses this transport only when the server offers it. `GET /api/time-entries/commands`
must report command version 2, both kinds, `submit: "available"` and a server-derived
context that names its origin. Submission is still gated by the per-organization
`time_entry_append_control` row from #273–#275, which no code sets. In production, every
organization therefore keeps the unchanged #268 legacy transport, and no frozen command is
captured. The decision is made before a command is frozen, so a frozen command is never
sent through the legacy transport later.

Breaks (idle "I was on break") keep the two-request legacy transport until the atomic
close/resume operation (#281).

```text
src-tauri/src/frozen_command.rs      # v2 wire command: identity, UTC ms instant, zone, context, target
src-tauri/src/command_store.rs       # SQLite lifecycle next to the legacy queue, restart-safe upgrade
src-tauri/src/command_transport.rs   # capabilities, submit, lookup (HTTP)
src-tauri/src/command_sync.rs        # ordered, context-bound sending; lookup before resend
src-tauri/src/clock_command.rs       # caller: route choice, freeze, capture, send; sync entry
src-tauri/src/clock_journal.rs       # what the UI may show (current context only)
src/hooks/useClock.ts, components/ClockRecoveryNotice.tsx   # offline capture, saved actions, retry/archive/copy
```

## Capture

At the click, before any lock, storage or network work, the native command reads the UTC
instant and the device IANA zone (`iana-time-zone`). The caller then:

1. Stops if identity-less legacy rows exist (unchanged #268 rule).
2. Reads capabilities. When they are fetched, they are cached for this endpoint and session
   (SHA-256 of the token; the token is not stored again). If the server is unreachable, only
   capabilities that this session negotiated earlier may be asserted. Without either, the
   action uses the legacy transport, unless this endpoint has accepted frozen commands on
   this device before (a marker that outlives logout). Then it is refused before sending
   ("connect once"), because an unconfirmed context must not fall back to the legacy writer
   there. Likewise, when the context accepts frozen commands but the device zone cannot be
   read, the action is refused before sending.
   Every desktop command declares `delayed` admission (seven days past, five minutes future),
   online or offline. It is saved before sending and may be delivered late. An `immediate`
   command whose first send failed would be refused after five minutes, and it cannot be
   changed without a new identity. Device clock skew is therefore bounded by the delayed
   window, not by five minutes.
3. Refuses a new action while a command of this context needs review (`rejected` or `stalled`).
4. Binds the intended work:
   - A clock-out after an unsent clock-in targets `{ clockInOperationId }`.
   - Otherwise it targets `{ workPeriodId }` of the status last seen for this employee.
     Employee IDs are organization-specific, so a status from another context is never used.
   - It never targets "the active period" at send time.
   - A clock-in after an unsent clock-out depends on it.
   - A second unsent clock-in, or a second unsent clock-out, is refused.
5. Freezes the command and commits it to SQLite. If the commit fails, the action reports
   that nothing was sent. No request is made.
6. Sends the saved commands of this context in capture order (see below). It then reports
   `committed` (with a status refresh), `savedOnDevice`, or `needsReview`.

Desktop clock-out has no attribution input, so it sends `project` and `workCategory` as
explicit `preserve` intents.

## Device storage

Two tables are added to the existing `offline_queue.db`. The legacy `queue` table is never
read differently, rewritten or converted. `PRAGMA user_version` moves from 0 to 1 in one
`BEGIN IMMEDIATE` transaction. An interrupted upgrade leaves the legacy database exactly
as it was, and a restart completes it. A store written by a newer app version is refused;
clock actions then pause, and the app still starts. Old binaries only know `queue`, so they
cannot process or delete frozen commands.

| Table | Content |
| --- | --- |
| `clock_command` | Local `recovery_id` (never the business identity), `operation_id`, version, kind, endpoint, captured context, instant, zone, `depends_on_operation_id`, the exact command bytes, capture time; lifecycle `state`, `attempts`, `transient_failures`, last failure evidence, receipt, resolution time |
| `clock_context` | Per endpoint: session fingerprint, last capabilities, last status |
| `clock_endpoint` | Endpoints that accepted frozen commands on this device, and when |

Triggers make every frozen column immutable and forbid deleting any command that is not
`committed`. Committed commands are pruned after 30 days unless an unresolved command still
depends on them. Nothing else is deleted: bounded retries stop attempts, never retention.
Logout forgets `clock_context` and leaves every command in place.

States: `pending` (sent automatically), `stalled` (the automatic bound of 8 transient
failures is reached; retried only on request), `rejected` (refused; needs review),
`committed` (receipt stored), `archived` (a command refused without committed work, set
aside; evidence kept).

## Sending and recovery

`command_sync::drain` runs after a capture and on the UI's 30-second poll
(`sync_clock_commands`). It processes only commands whose endpoint and full captured
context (user, organization, employee, server) equal the session's current capabilities.
Commands of another context wait, and the UI shows only their count.

For each command in capture order:

1. A command that is not `pending` stops the run. Every command depends on the one captured
   before it, so a blocked predecessor pauses its dependants.
2. Transient failures back off (30 s doubling, at most 30 min) unless the run is forced by
   a user action or retry.
3. If an attempt was already recorded, the command is **looked up first**:
   - `committed` stores the receipt without resending.
   - `not_committed` resends the same bytes.
   - `conflict` becomes `rejected`.
4. Without `submit: "available"`, nothing fresh is sent (`submit_unavailable`, paused).
5. The attempt is committed to SQLite **before** the request is sent.
6. A receipt counts only if its `operationId` is the command's. It is stored before the
   command leaves the active queue. If storing it fails, the command stays `pending`, and
   the next run finds it by lookup.

| Server answer | Result |
| --- | --- |
| `executed` / `replayed` for this operation | `committed`, receipt stored |
| no answer, `unknown`, 5xx, unreadable 2xx, `approval_policy_unavailable` | transient: same command again |
| `unauthorized`, `access_denied`, `billing_required`, `context_mismatch`, `not_adopted`, `unsupported_version`, other 4xx | paused: waits, no failure counted |
| `collision`, `integrity_review_required`, lookup `conflict` | `rejected`, never archivable: committed work exists under the identity |
| every other typed refusal (`target_unknown`, `target_not_active`, `occupancy_conflict`, `admission_window`, `append_review_required`, …) | `rejected` with the server body as evidence; archivable |

Recovery actions are allowed only for a command whose captured context equals the
session's current context:

- **Retry** puts a `stalled` command back to `pending`. It keeps the identity and bytes and
  looks the command up first.
- **Archive** is allowed only for commands the server refused without any committed work
  under their identity. The store enforces this, not only the UI. A collision, an integrity
  review or a lookup conflict stays active and keeps blocking new actions in its context
  until a reviewed correction resolves it. Archiving cancels nothing on the server, and
  archived commands stay visible.
- **Copy details** exports the exact command, lifecycle and receipt.

The recovery notice shows each action's time in its captured zone, not the viewer's.

While the server is unreachable, the UI enables clocking from the negotiated context.

Whenever commands of the context are unsent (online too), the clock shows their projected
state, and the recovery notice lists them:

- An unsent clock-in shows as clocked in.
- An unsent clock-out shows as clocked out.

The next action then binds the unsent command, not a server period. Offline with nothing
unsent, the last status seen for this employee is shown.

A committed receipt is the original outcome. Current status is always a separate read.

## Legacy behavior kept

The #268 tests pass through the new caller. They cover:

- the ordinary legacy clock-out, which still sends no timestamp;
- failure-time seconds, which remain failure-observation time;
- partial legacy breaks, which are retained;
- identity-less rows, which block clocking.

Legacy rows are never upgraded into frozen commands. They have no business identity, and
their missing context cannot be inferred. They remain byte-identical after the upgrade
(verified), counted, and inspectable in storage. Their authorized resolution stays open
(see blockers).

## Verification (2026-09-25)

**Desktop core** (`pnpm --filter desktop test:clock`, Windows): **48 passed**. Two
subprocess fixtures run through their parent tests. The harness compiles the real
`clock.rs`, `clock_command.rs`, `offline.rs`, `frozen_command.rs`, `command_store.rs`,
`command_transport.rs`, `command_sync.rs` and `clock_journal.rs`. It uses real SQLite
files, triggers and locks, and real HTTP on loopback. Scenarios:

- The server receives exactly the bytes that are already committed locally, with the
  attempt recorded, before its response (checked from the server side).
- A lost response is recovered after a restart by lookup, with no second send. An `unknown`
  response is resent with identical bytes after `not_committed`. A receipt for another
  operation is not accepted.
- Offline clock-in and clock-out are captured as `delayed`. The clock-out targets the
  queued clock-in. After a restart they are sent in order, and the dependant is never sent
  first. An offline clock-out binds the period last seen for the same employee.
- After a context switch, nothing is sent for the old context and its command is not
  retargeted. Work in the new context proceeds, and the old command still waits.
- A rejected predecessor holds its dependant and blocks new capture. Archiving keeps the
  evidence and releases the dependant, which the server then judges.
- Failure injection:
  - A failed capture sends nothing.
  - A failed receipt write keeps the command until lookup confirms it.
  - A capture followed by process exit without destructors survives.
  - An interrupted upgrade rolls back completely.
  - A newer store version is refused.
- Frozen columns are immutable, unresolved commands cannot be deleted, and pruning keeps
  depended-on receipts.
- The server stops accepting fresh commands: no downgrade to the legacy transport for the
  saved command, for new clock-in/out, or for a break.
- An expired session pauses the command without counting a failure. Automatic retries
  back off and stall after the bound without changing the command.
- The journal discloses only the current context. It counts other contexts and projects
  saved work, or the last status offline.
- The unadopted server keeps the legacy transport and freezes nothing. An accepting context
  with an unreadable device zone refuses before sending, with no legacy request. So does a new
  offline session on an endpoint that accepted frozen commands before, while one without that
  history keeps the legacy transport. A collision refusal cannot be archived. A paused command
  reports what it waits for. The #268 legacy scenarios still pass.

Mutations, each run against the whole suite:

| Mutation | Result |
| --- | --- |
| Recording the attempt after sending | failed its test |
| Dropping the context filter | failed its test |
| Dropping the receipt identity check | failed its test |
| Skipping lookup before resend | failed six tests |

An explicit dependency check turned out to be unobservable. The run already stops at the
first unresolved command, and a dependant is always captured after its predecessor. The
check was removed; `depends_on` stays persisted and guards pruning.

**Wire contract.** `frozen_command_tests.rs` pins the exact bytes in
`tests/clock-core/fixtures/desktop-v2-*.json`. The webapp test `clock-command.test.ts`
parses those files with the real `parseClockCommand` and gets them back unchanged.

**PostgreSQL** (disposable PostgreSQL 16 via the label-owned runner, migration chain
verified): `commands/route.integration.test.ts` **17/17**. This includes a new test that
sends commands built from the desktop fixtures through the real routes:

- lookup `not_committed` before the first send;
- a start two days back (the fixture's `delayed` admission), 201;
- lookup `committed` with the verbatim command;
- an identical resend, 200, with every row unchanged;
- the dependent clock-out, closing exactly that work (480 minutes).

The container was verified and removed.

**Desktop app.**

- `cargo check` of the full Tauri crate passes on Windows, with no new warnings (#268
  could not build it on Linux).
- `tsc --noEmit` and `vite build` pass.
- `node --test scripts/*.test.mjs` passes.

## Remaining activation blockers

This slice closes on implementation (see the #264 decision); these move to #327, #329 and
#331:

- **Native runtime and installed client (#329).** The Tauri IPC/webview, tray and an
  installed app's restart and upgrade were not run. The Rust client was not run end to end
  against a live server with an adopted organization. The client side is verified on
  loopback HTTP, and the server side with the same command shape on PostgreSQL.
- **Zone provenance (#329).** The v2 command has no provenance field, so the server records
  desktop captures with the `browser` timezone source (#275). The desktop reads the zone
  from the operating system at action time. Distinguishing that source needs a versioned
  server change.
- **Deployed desktop inventory and old-consumer control (#266, #327).** Old binaries cannot
  see `clock_command`, but they still read and delete the legacy `queue`. Establish deployed
  versions and effective update/disable control before strict admission.
- **Legacy clock-in/out writer (#327).** The legacy transport stays in use where the server
  does not offer v2 submission. On a device that never saw its endpoint accept frozen
  commands, it is also used offline before the session confirms a context. Its failures
  still produce identity-less rows. Gating the legacy route server-side remains #327's.
- **Editing saved commands.** The desktop has no surface that changes a saved action's time,
  zone, target or metadata, so #263 §7's linked replacement identity has no caller here. A
  new action after archiving is a new action, not an edit. Archiving is possible only for
  refusals without committed work, and uncertain or committed-evidence commands keep blocking
  their context. Reconciling those is the webapp's reviewed correction (#301/#323).
- **Legacy rows.** Identity-less rows still block clocking on the installation. Authorized,
  evidence-based resolution and raw export remain open: ownership cannot be established from
  a current login.
- **Breaks (#281).** The legacy two-request break stays in use and is refused while commands
  of the current context are unsent. In an adopted organization it is a non-participating
  writer until #281 replaces it.
- **Lookup fencing.** `not_committed` is not a tombstone (#275). The client only resends
  the same identity, which keeps this safe.
- **Rollback (#331).** A release without this code leaves `clock_command` rows untouched
  and unreadable. Downgrading to it pauses those commands; it does not lose them. The
  rollback release must therefore still include a reader, or be preceded by draining.
