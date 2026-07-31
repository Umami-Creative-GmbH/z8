# Approval Transition Engine Design

## Goal

Provide one organization-scoped transactional command path for canonical approval workflow decisions, idempotency, source finalization, projections, outbox writes, compatibility mirroring, and activation follow-up.

## Boundary

`transition-engine.ts` exposes `executeApprovalCommand`. It accepts a workflow identity, expected version, idempotency key, typed command, and a trusted principal reference. It does not accept caller-supplied employee IDs, authorization decisions, source records, or post-commit handlers.

The engine receives injected ports for:

- Resolving the trusted organization-bound command actor.
- Authorizing the command against the loaded canonical workflow.
- Building projection and outbox payloads from the materialized transition and terminal adapter finalization.
- Reading engine time through an injected clock.

The repository remains the only owner of transaction, receipt, CAS, identity allocation, materialization persistence, and completion records.

## Authorization

- An active pending stage assignment may approve or reject that workflow only.
- An organization-scoped `manage Approval` override may approve, reject, cancel, reassign, or escalate.
- Expiry is system-only.
- Approved cancellation additionally requires the adapter-minted cancellation authorization token.
- All authorization inputs are bound to the loaded workflow organization before any receipt, CAS, source, projection, or outbox write.

## Transaction Order

Within one repository transaction:

1. Resolve trusted actor and acquire the scoped write gate.
2. Claim the organization/workflow/idempotency receipt.
3. Return completed receipt result or reject a fingerprint mismatch; only a local reservation continues.
4. Load the scoped workflow, authorize, run adapter command preflight, and plan the state transition.
5. For terminal transitions, run terminal preflight before CAS.
6. Allocate identities, materialize the transition, CAS the root, and immediately persist the materialized plan.
7. Run terminal source finalization exactly once after canonical persistence.
8. Build and persist projections, canonical-to-legacy compatibility rows when the gate requires them, and transactional outbox rows.
9. Complete the command receipt last. Any failure rolls back CAS, source finalization, projections, outbox, and the reservation.

Activation follow-up drains `needs_activation` through the same transaction flow with a system or authorized manager principal. No post-commit handler executes in the engine.

## Command Fingerprint

The engine derives the receipt command fingerprint from a canonical serialization of workflow ID, expected version, command kind, reason, assignment/stage targets, and all other semantic command fields. Different semantic commands cannot replay the same idempotency key as the same receipt.

## Testing

Unit tests prove organization scoping, trusted actor binding, authority rules, receipt outcomes, preflight/CAS/finalization order, rollback behavior, projection/outbox/compatibility order, activation draining, and absence of post-commit execution.

The existing disposable PostgreSQL runner gains engine integration coverage for concurrent decisions, cancellation versus approval, and rollback of canonical workflow, source, projection, and outbox writes.

## Scope

This design creates no HTTP endpoint and does not cut over existing domains. Domain adapter implementations and post-commit dispatch remain later work.
