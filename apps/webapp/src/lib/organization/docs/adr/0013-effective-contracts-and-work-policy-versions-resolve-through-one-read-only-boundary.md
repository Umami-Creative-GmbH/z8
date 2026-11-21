---
status: accepted
date: 2026-11-21
---

# Effective contracts and immutable work policy versions resolve through one read-only boundary

Employment terms, organization and primary-team default contracts, and work policies used to be read independently across calendar requirements, work balance, absences, presence compliance, payroll, staffing, analytics, and exports. Because work policy schedules, regulations, and presence rules were mutated in place and joined directly by `policy_id` (and through reverse `one()` Drizzle relations on `workPolicy`), editing a policy changed historical absence counts and compliance evaluations, while consumers disagreed on precedence and `remote`/`trust_based` behavior.

We decided that:

1. **Immutable effective-dated policy versions (`work_policy_version`)** own `schedule_enabled`, `regulation_enabled`, `presence_enabled`, and every child rule (`work_policy_schedule`, `work_policy_regulation`, `work_policy_presence`, and their grandchildren) via `policy_version_id`. Legacy reverse `one()` relations on `workPolicy` are replaced by version-scoped relations on `workPolicyVersion`.
2. **One strictly read-only contract resolver (`src/lib/contracts/`)** is the sole canonical read boundary for Preview, Work Balance, Absences, Presence status and requirements, Payroll workspace, Staffing, Analytics, Daily digest, Dashboard roster/quick stats, and Exports. It performs zero database writes, unwraps `'inherit'` sentinels strictly in Employee → Primary Team Default → Organization Default order, honors migration `0120`'s primary-team non-inference invariant, and deduplicates same-day departure + rehire boundaries per active `employment_period_id` in the employee's calendar timezone.
3. **`trust_based` working days emit exact `0` work-balance delta** (excluding both actual and required minutes from balance accumulation so prior accrued balance is preserved across mode switches) while retaining full BAG/ArbZG compliance and schedule-based absence day counting.
4. **Organization defaults flow through `contract_default` and `work_policy_assignment`**, never through legacy `syncTermsPolicy` projections or `work_policy.is_default` flags. `work_policy_assignment` remains the canonical dated assignment relation required by transactional clock-out break snapshot locking (Time Tracking ADR-0003) and scoped-manager policy-only assignments.

## Considered Options

- **Keep per-consumer Drizzle queries and add `policy_version_id` joins everywhere.** Rejected: leaves precedence, `unwrapInherit`, `remote` presence exemption, `trust_based` balance rules, and team-history non-inference duplicated across 20+ callers where silent divergence is guaranteed to regress.
- **Drop `work_policy_assignment` completely.** Rejected: breaks transactional clock-out break snapshot locking (`FOR UPDATE OF employee` + `FOR UPDATE OF assignment`, Time Tracking ADR-0003) and scoped-manager wage-free policy assignment.

## Consequences

- A static CI contract-boundary guard (`src/lib/contracts/contract-read-boundary.test.ts`) fails the unit suite if any production file outside the explicit allow-list (`src/lib/contracts/**`, `src/lib/work-policy/**`, `src/lib/locations/location-lifecycle.ts`, and the transactional clock-out allow-list) reads policy/assignment tables directly, joins policy child tables on `policy_id`, uses legacy `with: { schedule | regulation | presence }` on `workPolicy`, or calls `syncTermsPolicy` / `workPolicy.isDefault`.
- Multi-version policies always resolve to exactly one version per calendar date with zero duplicate rows across every consumer.
- Employee lifecycle transitions (departures, retrospective leaving dates, and same-day rehires) bound contract resolution per active `employment_period_id` (`[started_at, ended_at)`) without leaking schedules or requirements across employment gaps.
