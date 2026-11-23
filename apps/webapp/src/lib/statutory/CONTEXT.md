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
A deterministic hash of everything a finding was evaluated from.

**Statutory acknowledgement**:
An org admin's immutable, reasoned record that a finding was reviewed, tied to its input
fingerprint. **Current** while the fingerprint still matches; **stale** once inputs change.
_Avoid_: dismissal, resolution

**Restricted audience**:
Everyone below org admin (scoped managers, planners, the employee). Sees summaries only, never EUR
amounts, wages, external earnings or EUR baselines.

**Released day** (on-call):
A day an on-call employee cannot be called: approved absence that requires no work, or an assigned
public holiday, unless worked or still planned anyway. It leaves the weekly call-off band and the
§ 12 Abs. 4–5 TzBfG reference-period average. A child-sick day (`sick_detail = 'child_sick'`)
releases the employee too, as unpaid release (§ 45 SGB V, Kinderkrankengeld replaces pay): a public
holiday inside it is not paid as a holiday.

**Own illness** (on-call):
Approved sick leave other than child-sick days, back-to-back leave joined into one. Only an own
illness is a § 12 Abs. 4 TzBfG sick-leave event and gets § 3 EFZG continued pay (waiting time, six
weeks); child-sick days around it neither start nor extend it.
_Avoid_: counting `child_sick` absence as sick leave

## Relationships

- **Contracts → Statutory Compliance**: a monitor applies to an employee through the effective
  contract's employment profile, ArbZG scope and on-call terms; Statutory Compliance never changes them
- **Statutory Compliance → Scheduling**: monitors contribute wage-free `statutory` findings to the
  schedule compliance evaluation and Staffing suggestions through the contributor registry. Staffing
  shows a finding a proposal changes (severity, tier, acknowledgement, block) or deepens past its
  visible `limit` (`used` grows above it, same unit)
- **Statutory Compliance → Contracts reviews**: acknowledgements live in
  `contract_review_acknowledgement` beside Milestone 1's contract review notices
