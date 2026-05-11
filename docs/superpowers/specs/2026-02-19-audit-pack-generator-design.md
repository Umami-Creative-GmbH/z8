# Audit Pack Generator Design

## Goal

Provide a one-click GoBD audit pack export for admins that produces a hardened bundle containing:

- signed entry-chain evidence,
- complete correction lineage,
- approval history (all states), and
- audit-log timeline,

for a selected date range, while preserving multi-tenant boundaries and cryptographic verifiability.

## Approved Decisions

- Entry point: Admin UI button (one-click trigger).
- Scope: date-range export.
- Bundle format: ZIP with JSON and CSV.
- Signature model: existing entry hash-chain integrity + package-level signature/timestamp hardening.
- Correction lineage: include full lineage, even when linked nodes fall outside requested range.
- Approval coverage: include submitted, approved, and rejected states.
- Execution model: async job with status tracking and notification.
- Architecture choice: dedicated audit-pack orchestrator that reuses existing hardening/signing infrastructure.

## Architecture

Introduce a dedicated `AuditPackOrchestrator` pipeline for evidence collection and bundle assembly, then reuse existing audit-export cryptographic hardening (manifest, signature, RFC 3161 timestamp, WORM retention).

Core characteristics:

- fully organization-scoped processing (`organizationId` required at every step),
- deterministic artifact generation for reproducible hashes,
- persisted package metadata for auditability and replay diagnostics,
- date-range primary scope with automatic chain/lineage expansion for proof completeness.

## Components and Data Model

### Trigger Layer

- Admin UI action initiates pack generation.
- API endpoint creates request and immediately returns job id/status handle.

### Orchestration Layer

`AuditPackOrchestrator` stages:

1. Collect base in-range records.
2. Expand full hash/correction lineage.
3. Collect approvals (all states).
4. Collect audit timeline events.
5. Assemble canonical JSON + CSV views.
6. Hand off to hardening/signing/timestamp/WORM pipeline.

### Evidence Builders

- `entry-chain-builder`: time-entry integrity data and chain continuity.
- `correction-lineage-builder`: replacement/supersede graph with external-range inclusions.
- `approval-evidence-builder`: submitted/approved/rejected events with actor and time.
- `audit-timeline-builder`: normalized, ordered timeline across sources.

### Proposed Persistence

- `audit_pack_request`: request scope, status, requester, failure details, timestamps.
- `audit_pack_artifact`: produced counts, expansion diagnostics, storage pointers.
- Optional `audit_pack_coverage`: transparency details for out-of-range included nodes.

`audit_pack_artifact` references existing `audit_export_package` so verification and cryptographic proof handling remain unified.

## Data Flow and Bundle Contract

### Processing State Machine

`requested -> collecting -> lineage_expanding -> assembling -> hardening -> completed|failed`

Each transition is persisted for observability and resumable retries.

### Inclusion Rules

- Start with date-range records.
- Recursively include linked nodes via `previousEntryId`, `replacesEntryId`, and `supersededById` until continuity is complete.
- Include approval events for included entities across all statuses.
- Build deterministic timeline from audit logs and domain milestones.

### Bundle Layout

- `evidence/entries.json`
- `evidence/corrections.json`
- `evidence/approvals.json`
- `evidence/audit-timeline.json`
- `views/*.csv`
- `meta/scope.json` (requested window + actual included span)
- `audit/manifest.json`
- `audit/signature.json`
- `audit/timestamp.json`
- `audit/timestamp.tsr`
- `audit/README.txt`

All JSON outputs must use stable ordering and canonical serialization.

## Error Handling and Compliance Guardrails

- Stage-specific error codes (for example: `scope_invalid`, `lineage_broken`, `approval_fetch_failed`, `hardening_failed`).
- Fail closed on broken lineage or missing cryptographic continuity (no partial compliance pack).
- Per-stage diagnostics persisted for troubleshooting and safe retries.
- Strict org-boundary checks during lineage expansion; cross-org linkage is rejected and logged as security anomaly.
- Audit logging for generate/retry/download actions.
- RBAC-restricted access for generation and artifact retrieval.

## Testing Strategy

- Unit: lineage expansion and closure logic.
- Unit: deterministic serialization and ordering.
- Integration: async workflow transitions and retry behavior.
- Integration: multi-tenant boundary enforcement.
- End-to-end: generated package verifies through existing hardening verification path.

## Non-Goals (V1)

- Per-entry detached signatures.
- Qualified external trust-service signatures.
- Automatic scheduled generation as the primary trigger.

## Open Implementation Notes

- Reuse existing worker/export infrastructure where possible to minimize operational overhead.
- Ensure UI status surfaces stage-level progress and terminal diagnostics.
- Keep CSV views auditor-friendly while avoiding unnecessary PII exposure.
