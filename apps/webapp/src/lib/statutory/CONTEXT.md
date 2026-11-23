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

## Relationships

- **Contracts → Statutory Compliance**: a monitor applies to an employee through the effective
  contract's employment profile, ArbZG scope and on-call terms; Statutory Compliance never changes them
- **Statutory Compliance → Scheduling**: monitors contribute wage-free `statutory` findings to the
  schedule compliance evaluation and Staffing suggestions through the contributor registry
- **Statutory Compliance → Contracts reviews**: acknowledgements live in
  `contract_review_acknowledgement` beside Milestone 1's contract review notices

## Short-term employment

§ 8 Abs. 1 Nr. 2 SGB IV (*kurzfristige Beschäftigung*), judged per calendar year in the
organization's calendar timezone.

**Short-term day**:
An organization-local calendar day under short-term terms with completed work, an open clock-in
or a shift that has not ended. Counted once, however many work periods or shifts it has.

**Stint**:
A run of short-term days no more than 14 calendar days apart within one employment period. A
longer pause or a new employment period starts a new stint.
_Avoid_: contract, assignment

**3-month limit**:
Applies when the employee works a continuous week of 5 or more days. Counted in calendar days. One
stint alone is measured in **time months** (*Zeitmonate*) from its first day: 15 June – 14 September
is 3 months. Several stints, prior employers' included, are added up against **90 calendar days**,
a full calendar month counting as 30; the pauses between stints never count.

**70-working-day limit**:
Applies to a week of fewer than 5 days or an irregular week, and to the whole year as soon as any
stint has one. Counts short-term days.

**Limit choice**:
Taken from the employee's own planned week: custom days or a work policy set on their terms or
assigned to them. A week inherited from a team or organization default, weekly hours alone,
published shifts and on-call terms are no agreed week; the limit then follows the mean full week
observed in the counted days.

**Prior-employer offset**:
Short-term working days or months another employer used in the same calendar year, recorded as
statutory context. Recorded working days switch the year to the 70-working-day limit; recorded
months count as 30 calendar days each (or 70 / 3 working days each under that limit).

**Berufsmäßigkeit verification**:
When a month's short-term earnings exceed the Minijob monthly limit, the employer must verify that
the employment is not *berufsmäßig* (not the person's livelihood). Z8 prompts and an org admin
documents the verification as an acknowledgement; Z8 never decides social-security status.
