---
status: accepted
---

# Vacation policy eligibility keeps effective history from rollout

Vacation policies resolve for one employee and an organization-local calendar date: direct assignment, all applicable teams, organization assignment, then company default. Identical team policies coalesce; differing policies require review. A valid direct assignment takes precedence. Uncovered dates are explicit gaps, never an invented allowance (#989).

Assignments, vacation team eligibility and policy terms retain half-open calendar windows: start included, end excluded. Policy `validUntil` and the public period reader's `endDate` stay inclusive at their existing boundaries. Replacing or ending an assignment or membership closes its window. Policy edits retain earlier terms, including its company-default role. Live team deletion does not erase prior eligibility. Every database writer, including compatibility and bulk membership writes, captures history and validates the final transaction against the same resolver; validation coalesces once per affected organization and transaction.

Existing undated assignments and known memberships begin at each organization's rollout date. An admin may explicitly review an assignment backdate to 2026 or later. That review affects only its target; a team assignment cannot establish membership before recorded eligibility. Earlier dates retain the legacy company-default calculation. Pre-2026 behavior, stored carryover and already-posted accrual amounts remain outside recalculation.

Changing calculation method or the joiner/leaver proration switch requires 1 January, including changes induced by assignment, team eligibility, policy expiry or fallback. Missing or conflicting dates do not erase a known method earlier in that year. Existing incompatible undated assignments surface a configuration conflict during the remaining rollout year, instead of silently applying a mixed method or preventing the whole migration. Admins can review the assignment explicitly. Annual-day amount changes may take effect within a year.

## Consequences

- PostgreSQL snapshots and transition constraints protect every writer. The shared date resolver supplies both the preview and the interval reader, so automated consumers can use the same policy selection without duplicating precedence.
- Policy edits and company-default replacement commit atomically with transition validation. Concurrent configuration changes serialize by organization.
- This first implementation slice stages management and preview. Balance readers and automated postings activate together after #1370 and #1371; until then they retain their existing calculation. No posted amount is rewritten by the history migration.
- The five-day reference-week conversion decision (ADR 0003, #990) remains separate implementation work. This history change does not convert allowances for part-time schedules.
