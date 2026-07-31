# Approval Transition Batches And Cutover Authority Design

## Goal

Make multi-pass stage activation receipt-safe and ensure the canonical transition engine runs only when canonical state is authoritative.

## Scope

- Represent one command as an ordered batch of one or more materialized transition passes.
- Build the command result from the final snapshot plus every event produced by the batch.
- Validate and serialize command results whose events span consecutive workflow versions.
- Enforce canonical decision authority before any canonical command mutation or domain finalization.
- Mirror canonical results to legacy state only in the canonical lifecycle mode.

## Non-Goals

- No schema or migration changes.
- No change to event identity, per-version event indexes, CAS semantics, or append-only persistence.
- No change to legacy-to-canonical observation logic used by shadow and ready modes.
- No collapsing multiple activation passes into one synthetic workflow version.
- No change to reviewer resolution or stage activation policy.

## Transition Batch Model

A command may produce an initial transition followed by one or more automatic stage-activation transitions. Each pass remains an independent canonical transition:

- It advances the workflow version exactly once.
- Its events retain that resulting version.
- Its event indexes start at zero and are contiguous within that version.
- It is materialized and persisted before the next pass is planned.

The engine retains every materialized pass in execution order. `ApprovalTransitionResultBuilder` receives the complete non-empty batch and optional terminal finalization. It uses the last pass for the final workflow snapshot, projection, and final next-action state, while flattening every pass's events in pass order for the command result and outbox descriptions.

The command result remains one replayable receipt value. It describes the final snapshot and all durable events caused by that command, including automatic activations.

## Receipt Validation

`ApprovalCommandResult.events` may span multiple versions. Validation requires:

- Every event belongs to the result snapshot's organization and workflow.
- Event versions form contiguous, strictly increasing groups in array order.
- The first event version is greater than zero and no version group repeats after a later version starts.
- Within each version group, `eventIndex` starts at zero and increments without gaps.
- The last event version equals the final snapshot version.
- No event version exceeds the final snapshot version.
- Every outbox record references an event in the same result by ID and event type.

A single-pass result remains valid under these rules. Serialization preserves original event versions and indexes exactly; replay returns the same command result.

## Canonical Authority

The transition engine acquires the organization/workflow-type write gate before claiming a command or invoking domain preflight/finalization.

The engine proceeds only when both `gate.behavior.decideCanonical` and `gate.behavior.writeCanonical` are true. Any inconsistent or non-authoritative behavior fails closed before command receipt reservation, CAS, source finalization, projection, outbox, or compatibility writes.

Lifecycle behavior is therefore explicit:

- `legacy`: canonical transition engine rejects the command. Legacy paths remain authoritative.
- `shadow`: canonical transition engine rejects the command. Verified legacy transitions mirror to canonical through `mirrorLegacyToCanonical`.
- `ready`: same command behavior as shadow after reconciliation readiness.
- `canonical`: canonical engine executes and calls `mirrorCanonicalToLegacy` after building the canonical result.
- `complete`: canonical engine executes without a compatibility mirror.

The engine triggers canonical-to-legacy mirroring only when `gate.behavior.mirror === "canonical_to_legacy"`. `writeLegacy` alone is not sufficient because shadow and ready require the opposite mirror direction, driven by observed legacy transitions outside this engine.

## Transaction And Failure Semantics

All transition passes, finalization, compatibility writes, projection, outbox, and receipt completion remain in the caller-owned transaction. Any activation, codec, mirror, projection, outbox, or receipt failure rolls back every pass.

Version CAS still occurs once per pass. A conflict at any pass aborts the transaction. No partial batch result or command receipt is committed.

## Tests

- Unit tests prove a command plus one or more auto-activation passes returns all events and outbox records with original versions and per-version indexes.
- Repository codec tests accept valid multi-version results, reject repeated/out-of-order/gapped version groups, reject non-contiguous per-version indexes, and round-trip the exact event sequence.
- PostgreSQL integration tests prove a multi-pass command completes and replays its receipt without codec failure, with all aggregate/event rows committed atomically.
- Cutover tests prove legacy, shadow, and ready reject canonical execution before receipt claim or source mutation.
- Cutover tests prove canonical executes and mirrors canonical to legacy exactly once, while complete executes without mirroring.
- Tests prove shadow/ready legacy-to-canonical observation remains unchanged.
- Run focused transition-engine, repository codec, compatibility, cutover, and available PostgreSQL integration suites, plus typecheck, Biome on changed files, and `git diff --check`.
