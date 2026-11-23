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

## Short-term employment

§ 8 Abs. 1 Nr. 2 SGB IV (*kurzfristige Beschäftigung*), judged per calendar year in the
organization's calendar timezone.

**Short-term day**:
An organization-local calendar day under short-term terms with completed work, an open clock-in
or a shift that has not ended. Counted once, however many work periods or shifts it has. Work that
belongs to a shift counts on the shift's date (a clock-in at 23:50 for a 00:00 shift counts on the
shift's day); other work on its clock-in's day.

**Short-term employment**:
Confirmed short-term terms of one employment period that follow each other without a gap, as in
force after later confirmed terms supersede them. A new wage or week does not end it; other terms
or a gap do. Terms that end only because later terms supersede them mark where the short-term
terms stop; they do not make the employment fixed-term. **Fixed-term** when its employment
period's current employment agreement (the last link of its `employment_term_agreement` chain) is
fixed-term; it then ends on the agreement's last day, or where later terms take over if that is
earlier. Else an open-ended **framework agreement**.

**Agreed length**:
A fixed-term employment is judged on its whole agreed length, from its first day to its agreed
end: § 8 Abs. 1 Nr. 2 SGB IV asks whether the employment is limited *in advance by contract*, and
the Geringfügigkeits-Richtlinien apply that to an employment across the year end too. So the
agreed length counts as soon as it is agreed, before any shift is planned, and in every calendar
year it touches: a fixed term from 1 November to 28 February is over 3 months in both years.
Under the 70-working-day limit its agreed working days (see **70-working-day limit**) and its
short-term days in the other calendar year count as well.
The ticket's "reset on January 1" applies to adding up separate employments within a calendar
year, not to one continuing fixed-term employment.

**Stint**:
The part of the employment that counts towards the limit. A fixed-term employment is one stint
over its whole agreed length, pauses included (see **Agreed length**). Under a framework
agreement, and for short-term days after an agreed end, a run of the year's short-term days no
more than 14 calendar days apart is a stint, and a longer pause starts a new one. Separate
employments are separate stints, and only those of the calendar year are added up.
_Avoid_: contract, assignment

**3-month limit**:
Applies when the employee works a continuous week of 5 or more days. Counted in calendar days. One
stint alone is measured in **time months** (*Zeitmonate*) from its first day (§§ 187 Abs. 2,
188 Abs. 2 and 3 BGB): the period ends on the day before the day with the start's number in the
third following month, or on that month's last day if it has no such day. 15 June – 14 September
is 3 months, 31 January – 30 April too (90 days), and a fixed-term employment from 1 June to
31 August uses all 92 days even with July off. A fixed term agreed for longer than 3 time months
is exceeded from the day it is agreed (reason `agreed_fixed_term_exceeds_limit` in the finding's
admin detail). Several stints, prior employers' included, are added up against **90 calendar days**, a full
calendar month counting as 30; the time between stints never counts.

**70-working-day limit**:
Applies to a week of fewer than 5 days or an irregular week, and to the whole year as soon as any
stint has one. Counts short-term days. A fixed-term employment whose terms plan the employee's own
week counts its **agreed working days** instead: every calendar day of its agreed length that the
week in force that day plans (a multi-week rota by its mean), plus short-term days the week does
not plan. The week in force can change with a new terms row, an individual work-policy assignment
starting or ending, or a new version of the employee's own policy. Like the agreed length, they count as soon as it is agreed: a fixed term from 1 March to
28 February planning Monday and Tuesday holds 104 working days and is exceeded before any shift is
planned (reason `agreed_fixed_term_exceeds_working_days`, with `agreedWorkingDays`, in the
finding's admin detail). Without an own week, only its short-term days count.

**Limit choice**:
Taken from the employee's own planned week: custom days or a work policy set on their terms or
assigned to them. A week inherited from a team or organization default, weekly hours alone,
published shifts and on-call terms are no agreed week; the limit then follows the mean full week
observed in each stint's short-term days worked or planned under them, stint by stint: one stint
of a four-day week puts the year under 70 working days however many six-day weeks another stint
has. A week off inside a stint, and a
week left short by an approved absence (sickness, leave; not home office), are not observed
weeks: they say nothing about the week. Open-ended framework terms with no short-term days say
nothing about the week and do not choose the limit, whether or not they plan an own week; a
fixed-term employment's own week does, as it is agreed in advance. A fixed-term employment across
the year end is one employment with one limit: both calendar years read its week from its whole
agreed length (its terms and short-term days in either year), so a December of five-day weeks
chooses 3 months for January too. A shorter week in either year, also another stint's, puts both
years under 70 working days: the fixed term counts in both with its working days.

**Prior-employer offset**:
Short-term working days or months another employer used in the same calendar year, recorded as
statutory context. Recorded working days switch the year to the 70-working-day limit; recorded
months count as 30 calendar days each (or 70 / 3 working days each under that limit).

**Berufsmäßigkeit verification**:
When a month's short-term earnings exceed the Minijob monthly limit, the employer must verify that
the employment is not *berufsmäßig* (not the person's livelihood). Z8 prompts and an org admin
documents the verification as an acknowledgement; Z8 never decides social-security status. The
acknowledgement documents the month's total as the admin was shown it, and goes stale when the
month's work, shifts, wages or cap change, or its total rises more than 15 minutes' pay (at the
month's highest wage) above the documented one, as for Minijob exceedances.
