# Approval Routing Policy Matcher Design

## Goal

Add the first Phase 3 routing boundary: a pure, organization-scoped matcher that selects persisted approval policies for canonical workflow types without changing legacy policy behavior during shadow migration.

## Scope

- Add canonical routing context and policy matcher modules under `src/lib/approvals/routing/`.
- Delegate the legacy policy matcher to the canonical implementation through an explicit context adapter.
- Extend policy settings validation to accept canonical workflow types and reject unsupported stage fallback values.
- Preserve existing persisted policy rows, priority semantics, and legacy service contracts.

## Non-Goals

- No source adapters, reviewer resolution, workflow materialization, or domain cutover.
- No policy schema migration or persisted policy rewrite.
- No change to legacy decision authority or production read paths.

## Routing Context

`ApprovalRoutingContext` contains verified data only:

- `organizationId`, canonical `workflowType`, and source `{ type, id }`.
- `requesterEmployeeId`, `teamIds`, `locationId`, and `absenceCategoryId`.
- `travelExpenseAmount`, `overtimeRisk`, and `employeeGroupIds`.

Source-specific code will construct this context in later Phase 3 work. The matcher performs no database I/O and never fills absent values from unrelated records.

## Matching Rules

Only active policies from the same organization are eligible. Policies are ordered by ascending priority and the first policy for which every condition matches wins. Equal priorities keep stable persisted ordering; tests use distinct priorities unless a deterministic tie fixture specifies the expected policy ID.

Persisted legacy approval-type conditions remain valid through these aliases:

| Canonical workflow type | Legacy approval type |
| --- | --- |
| `absence` | `absence_entry` |
| `travel_expense` | `travel_expense_claim` |
| `time_correction` | `time_entry` |
| `manual_time_submission` | `time_entry` |
| `policy_clock_out` | `time_entry` |

`shift_request` and `compliance_exception` have no legacy alias. New canonical-specific conditions may target any canonical workflow type. A broad legacy condition and a canonical-specific condition can both match; normal priority and first-match semantics decide the winner.

String and list conditions support `equals` and `in`; travel amount supports `gte`, `lte`, and inclusive `between`. Empty-condition active policies are valid catch-alls. Any malformed persisted condition or unsupported stage fallback is rejected with an actionable routing validation error rather than coerced or silently routed through a fallback.

## Compatibility Boundary

The existing `approvals/policies/matcher.ts` remains the compatibility import surface for legacy chain-service and settings preview callers. It adapts `ApprovalPolicyEvaluationContext` to `ApprovalRoutingContext` and delegates matching and validation to the new pure module. This keeps legacy callers behaviorally stable while making the canonical matcher the only implementation of condition semantics.

## Policy Settings

Settings input accepts the seven canonical workflow types. Existing legacy values remain accepted for existing rows and previews. All referenced teams, locations, absence categories, employee groups, and specific employees remain validated within the current organization. Valid stage fallback values are exactly `fail`, `default_manager`, and `organization_admin`; any other value is rejected at input validation and again when persisted policy data is activated.

## Tests

- Unit tests cover every supported condition and operator, canonical aliases, canonical-specific time policies, no-match behavior, and deterministic priority selection.
- Tenant tests prove foreign-organization policies and references cannot match.
- Validation tests cover malformed persisted conditions, invalid references, and unsupported fallback values.
- Compatibility tests prove legacy matcher callers and policy previews retain their current outputs.

## Verification

Run focused routing matcher and approval-policy settings tests, webapp typecheck, Biome for touched files, and `git diff --check`. No database migration or external service is required for this increment.
