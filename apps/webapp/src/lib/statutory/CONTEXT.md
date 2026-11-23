# Statutory Compliance

Monitors German statutory employment limits (Minijob, short-term employment, working students,
§ 12 TzBfG on-call work, JArbSchG youth protection, BBiG apprentice release) against recorded work
and planned shifts. Advisory: it warns and documents decisions; it never blocks clocking, changes
contracts or touches payroll.

## Language

**Statutory baseline**:
A platform-managed, effective-dated legal value in `statutory_threshold` (`organization_id IS NULL`),
such as the Minijob monthly limit. Read for the day being judged; tenants cannot change it.
_Avoid_: hardcoded limit, setting

**Warning tiers**:
An organization's warning and critical percentages of a statutory limit (default 80 % / 95 %).
_Avoid_: thresholds (ambiguous with baselines)

**Statutory context**:
Per-employee facts a monitor needs beyond Z8's own records: external or prior-employment offsets,
lecture-free periods, apprentice school and exam releases. Voided, never edited.

**Statutory finding**:
One monitor result for one employee and one subject (a month, week, year or shift), with a
wage-free summary and admin-only detail.

**Subject**:
What a finding judges, written as its subject key: `2026-03`, `2026-W10`, `2026`, `shift:<id>`.

**Input fingerprint**:
A deterministic hash of everything a finding's decision depends on — not of how far a plan has
been worked, so a shift worked as planned leaves it unchanged.

**Statutory acknowledgement**:
An org admin's immutable, reasoned record that a finding was reviewed, tied to its input
fingerprint. **Current** while the fingerprint still matches; **stale** once inputs change. A
current acknowledgement documents a finding only while the finding still qualifies for it; it
never softens one that has turned critical.
_Avoid_: dismissal, resolution

**Restricted audience**:
Everyone below org admin (scoped managers, planners, the employee). Sees summaries only, never EUR
amounts, wages, external earnings or EUR baselines.

## Relationships

- **Contracts → Statutory Compliance**: a monitor applies to an employee through the effective
  contract's employment profile, ArbZG scope and on-call terms; Statutory Compliance never changes them
- **Statutory Compliance → Scheduling**: monitors contribute wage-free `statutory` findings to the
  schedule compliance evaluation and Staffing suggestions through the contributor registry. Staffing
  shows a finding a proposal changes (severity, tier, acknowledgement, block) or deepens past its
  visible `limit` (`used` grows above it, same unit)
- **Statutory Compliance → Contracts reviews**: acknowledgements live in
  `contract_review_acknowledgement` beside Milestone 1's contract review notices
