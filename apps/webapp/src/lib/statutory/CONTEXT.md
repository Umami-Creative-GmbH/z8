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

**Daytime band** (working student):
The local wall-clock hours of a lecture-period weekday whose work counts against the 20-hour rule
(§ 6 Abs. 1 Nr. 3 SGB V); work outside it (evenings, nights), weekends and lecture-free days do
not. An organization statutory preference beside the warning tiers and the JArbSchG publish
block, not a statutory baseline: the law names no hour and health insurers read "evening and
night" differently, so each organization sets the band its insurer and payroll advisor accept
(Settings → Contracts → statutory limits, org admins only, audited with what it replaced).
Default 06:00–18:00; whole quarter hours, start before end, 00:00 to 24:00 (24:00 is the next
day's start, also across a DST change). An edge in the hour clocks skip starts or ends at the first
minute after the gap, and a band wholly inside the gap leaves that day without daytime; the rest of
the day is evening/night, so no minute counts twice. Every working-student evaluation reads it with the other
preferences, loaded once per evaluation. It is part of the lecture-week input fingerprint, so
changing it makes that week's acknowledgement stale (changing it back makes it current again), and
it decides the week's core minutes, the finding's breach depth.
_Avoid_: core hours, hardcoding 06:00–18:00

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

**Breach depth**:
How far a finding goes past its visible limit: `used` and `limit` in the same unit once past it
(above a ceiling, below a floor), and the work it covers (`coveredMinutes`). Only what restricted
readers see counts: an earnings-derived finding has its tier alone. A running clock-in counts
without the minutes it grows by (`stableDepth`, server-only): its time inside planned shifts
counts to the shift's end, also once it runs past it, on the shift's own day and week (an on-call
clock-in from Sunday evening running into Monday's shift counts that shift's time on Monday);
only its minutes outside them (clocked in early, between shifts, or past the shift's end) grow,
on the clock-in's start day, whether or not the clock has reached the shift (on-call: the
**call-off day**, the same for finished work). A week's figures depend neither on the window it is
judged in nor on other employees. While nobody is clocked in, a started shift still counts its rest from the end of its last
recorded work, or from its start, until it ends: a break, a late start or a missed shift holds the
figures. A breach the rules attribute by position (a minor's rest
period or shift span) is matched by its day or week when the running work carries it. The planner's publish acknowledgement goes stale when a finding's severity, tier,
acknowledgement, publication block or breach depth changes, not while the clock runs.
_Avoid_: input fingerprint (that one documents an org admin's acknowledgement)

**Review inbox**:
Settings → Contracts → Reviews & Conflicts and the Compliance Command Center's workforce card
(`review-inbox.ts`), org admins only. Per **review domain** (Minijob, short-term, working student,
on-call, youth & apprentice: JArbSchG and BBiG share one) it holds the **open** findings (not
documented by an acknowledgement, as the monitor judges it: a Minijob month acknowledged before it
became a third exceedance or went above twice the cap stays open and critical, its acknowledgement
**no longer applies**), the **pending** acknowledgements (acknowledgeable, none recorded) and the
**stale** ones (acknowledgeable again, but invalidated by newer work, shifts or figures; a finding
that can no longer be acknowledged never counts as stale). What needs review is each monitor's own
review list's decision; findings that cannot be acknowledged (Minijob tiers and rolling cap,
short-term limits, JArbSchG hard limits, apprentice release conflicts) come from the monitors over
the planning horizon (the last week to eight weeks ahead, `review-window.ts`). Every review list
covers the whole horizon (the Minijob list every month it touches), and one load evaluates each
of the Minijob and JArbSchG/BBiG monitors once for both. The Command Center shows counts only and
reads no names; an acknowledgement's history (who, when, reason, legal note, current /
invalidated / no longer applies / earlier) is read per subject and never carries fingerprints.
_Avoid_: queue (the migration & departure reviews), dismissed

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

**Call-off day** (on-call):
The day and compliance week work counts on for the weekly call-off band, calls and their breach
depth. Minutes inside a planned shift count on that shift's date; minutes outside every shift on the
day the work started. One rule for running and finished work, so clocking out moves no minute
between weeks: a clock-in at Sunday 23:45 for Monday's 00:00–06:00 shift counts 15 minutes on Sunday
and the shift on Monday, before and after it clocks out. Only shifts dated up to the day after the
work's start day take its minutes, so a clock-in left running for days counts on its start day in
any window. It does not work a later shift it runs through: that shift's rest stays planned until
the shift ends, as for a shift nobody clocked into, and the clock-in's minutes inside it stop
growing once it has ended. The § 12 Abs. 4–5 TzBfG reference period that pays released days
(`reference-period.ts`) is a different figure: continued pay averages the hours worked per calendar
day, so it splits work at local midnight (`allocateTrackedDailyWorkMinutes`) and ignores shifts.
_Avoid_: bucketing on-call band work by its start day alone

**Block-week training allowance**:
In a full block-release week (at least 25 hours of lessons on at least five days), additional
in-company training events of up to two hours a week are allowed (§ 9 Abs. 1 Nr. 3 JArbSchG,
§ 15 Abs. 1 Satz 3 BBiG). Up to 120 minutes of planned work on the week's block days,
earliest first and work that overlapping shifts share counted once, are no release conflict;
for a minor they also stay outside the § 8 JArbSchG day and week totals: they come on top of the
block week, which § 9 Abs. 2 Nr. 2 JArbSchG credits with the average weekly working time. Only the work past them conflicts, on the block day it
falls on.

**Shift span** (*Schichtzeit*, § 12 JArbSchG):
A minor's working time plus breaks on a local day, from the start of the first work to the end of
the last, planned and recorded work alike. At most 10 hours; 11 hours in hospitality,
agriculture, animal husbandry and on construction and assembly sites, which an org admin
documents by acknowledging the span as a sector exception. A span over 11 hours cannot be
acknowledged. `executive_exempt` does not change it. The acknowledgement documents the day's
planned shifts and stays current while the day is worked roughly as planned (clocked in a few
minutes early, out a few minutes late); other shifts, or a span 15 minutes or more past the
planned shifts' span, make it stale.

**Night-work sector hours** (§ 14 Abs. 2, 3, 5, 6 JArbSchG):
Minors may work only from 06:00 to 20:00 (§ 14 Abs. 1). An org admin's sector exception covers
night work only inside the union of the hours § 14 lets the employer use for the minor's age
without the supervisory authority's approval: from 15 05:00 to 21:00 (a minor still in full-time compulsory schooling gets none, § 2 Abs. 3, except in a school-holiday job of at most four weeks per calendar year, § 5 Abs. 4: the admin confirms it; a child under 15 gets none here: § 7 S. 2 would extend § 14 to a child past full-time schooling, which Z8 deliberately does not support, so that case stays blocked) (Abs. 5 S. 1: until 21:00
where the usual working time ends after 20:00 for transport reasons, after notice to the
authority; Abs. 6: from 05:00 in the warm season in workplaces with extraordinary heat); from the
16th birthday 05:00 to 23:30 (Abs. 2: hospitality and fairgrounds until 22:00, multi-shift
operations until 23:00, agriculture from 05:00 or until 21:00, bakeries from 05:00; Abs. 5 S. 2:
multi-shift operations from 05:30 or until 23:30 after notice); from the 17th birthday also from
04:00 (Abs. 3, bakeries). The evening is judged by the age that day, the early morning by the age
that morning. Night work outside them cannot be acknowledged, as a span over 11 hours cannot:
the finding stays and blocks publication like a hard limit, and the planner names only its
minutes outside the hours (`beyondSectorHours`). Abs. 5 needs only a notice to the authority,
which the admin confirms; Abs. 7 (performances until 23:00) needs the authority's approval and is
out of scope. Which permission applies, and that § 14 Abs. 4 does not exclude it (no Abs. 2
Nr. 1–3 work after 20:00 on the day before a vocational school day whose lessons start before
09:00), is what the acknowledgement confirms: lesson start times of school days are optional, block
weeks carry none and minors at school need not be recorded as apprentices, so Abs. 4 is not
judged automatically.
_Avoid_: one acknowledgement lifting night work at any hour or age

## Relationships

- **Contracts → Statutory Compliance**: a monitor applies to an employee through the effective
  contract's employment profile, ArbZG scope and on-call terms; Statutory Compliance never changes them
- **Statutory Compliance → Scheduling**: monitors contribute wage-free `statutory` findings to the
  schedule compliance evaluation and Staffing suggestions through the contributor registry. Staffing
  shows a finding a proposal changes (severity, tier, acknowledgement, block) or deepens past its
  visible `limit` (same unit: `used` grows above a ceiling, or falls below a floor when the summary
  says `limitDirection: "floor"`, e.g. a youth rest period or break, an on-call notice, call or
  week below its minimum). It judges each suggestion without and
  with the proposal on one request-scoped `memoizedReader`, so the persisted data both runs read is
  loaded once. The planner's publish acknowledgement covers each finding's **breach depth**. The
  JArbSchG publish block refuses an edit or a publication by the same rule (a publication's two
  runs share one `memoizedReader`; an edit's do not, as the save lies between them), running only
  the monitors that can block publication
  (`statutoryBlockingScheduleContributors`). It counts only breaches on what goes live (the
  edited shift, the range's drafts, published shifts); a breach on a draft outside the range is
  judged when that draft is published. A breach is the same before and after only within its
  scope (`breachScopeOf`, `causedBlockingFindings`): a rest-period, daily, shift-span, weekly or
  days-per-week breach its judged day (or week), whichever shift a reordered day moves it to;
  work past a block week's training allowance its compliance week, whichever block day it falls
  on (its summary holds the week's work on its block days as `used`, the 120 minutes as `limit`:
  more work in the week is caused, moving work between its block days is not); an apprentice
  release conflict its release day (for a night shift into a school morning, the next day), not
  the day its shift starts nor the rule it cites (a minor's shift before early lessons on a full
  school day cites § 9 Abs. 1 Nr. 1, shortened past the lessons' start § 9 Abs. 1 Nr. 2: still the
  same day's conflict); any other breach (night, weekend, holiday work, breaks) its own shift
  on its local day. Within the scope a change is caused only when it goes deeper than every
  breach the scope had (for a weekend or holiday breach counted in days: more work on that day).
  A release conflict is as deep as the planned work inside the conflicting release time (the
  exam, the lessons and the time before lessons starting before 09:00, or the whole day released
  in full; `coveredMinutes`) on its release day; on a block day only the work past the week's
  training allowance, the allowed training is not covered. A shift that conflicts with two release days (a
  night shift through two block days) has a conflict on each, dated that day, covering only its
  work there and citing that day's rule, so moving work from one release day into the other is a
  deeper conflict on the second. A release day is judged by the total of all its conflicts, work
  that overlapping shifts share counted once: more of it, on the edited shift or on one moved in,
  is caused; the same or less is not. A shift published across the first 15 minutes of an exam
  may be shortened, not lengthened, and no other shift may be moved into the exam
  beside it. Sector exceptions are judged the same way, though their scope holds one shift:
  the work of all its pieces (worked before a lunch break and the rest still planned) counts.
  A breach whose block an acknowledged sector exception lifted counts as one the scope had: the
  edit makes the acknowledgement stale and the new state cannot be acknowledged before it is
  saved, so easing it saves and extending it is refused. A breach carried to a day or week that
  had none is new there, at any figures: moving a published 10 h Tuesday to Wednesday at 9 h is
  refused, shortening it to 9 h on Tuesday saves
- **Statutory Compliance → Contracts reviews**: acknowledgements live in
  `contract_review_acknowledgement` beside Milestone 1's contract review notices
- **Scheduling findings list** (#2026): the compliance banner, the publish dialog and the
  publish-block refusal list the statutory findings behind their counts
  (`scheduling/findings-list-view.ts`): employee name, the wage-free projection and the period
  each judges. A scoped manager gets only the employees of their `ManagedScope` (manager links);
  the rest is counted, never named. An org admin or workforce admin gets every employee, and only an
  org admin the link to the finding's Reviews & Conflicts domain. Org admins get the projection too:
  amounts stay in Reviews & Conflicts. The counts and the publish fingerprint stay organization-wide

## Decisions

Confirmed as intended in the final review of PR #2007 and made visible in the product (#2023).

**Executive exemption switches off all adult ArbZG handling.** `arbzg_scope = 'executive_exempt'`
marks leitende Angestellte as defined in § 5 Abs. 3 BetrVG, whom § 18 Abs. 1 Nr. 1 ArbZG takes out of the ArbZG entirely. So it
suppresses adult ArbZG findings and also the automatic ArbZG break deductions and break
reminders: none of them has a legal basis for these employees. JArbSchG is a separate law that
§ 18 ArbZG does not touch, so a minor marked exempt keeps every youth-protection check. Explained
beside the ArbZG scope wherever an admin sets or sees it (effective contract terms, the change form,
contract templates).

**The on-call sick-pay line is guidance, not a payroll calculation.** The payroll reference card
states whether § 3 EFZG continued pay is owed for an own illness (owed, waiting time of § 3 Abs. 3,
six weeks of § 3 Abs. 1 exhausted, not owed). Z8 does not see everything that decides the claim
(a new illness or a continuation of an earlier one, § 3 Abs. 1 Satz 2; fault), so the line is labelled
"Guidance for payroll" and the card says the payroll system decides. It changes no figure.

**The block-week training allowance stays out of a minor's § 8 totals.** In a full block-release
week, § 9 Abs. 1 Nr. 3 JArbSchG and § 15 Abs. 1 Satz 3 BBiG allow in-company training of up to
two hours a week, in addition to the block week, which § 9 Abs. 2 Nr. 2 JArbSchG credits with the
average weekly working time (Z8 uses 40 hours when the terms give none). For a full-time minor that
already reaches the § 8 weekly maximum, so counting the allowed minutes as well would breach § 8 and
the allowance could never be used. They are therefore left out of a minor's day and week totals (see
**Block-week training allowance**). Said where the allowance shows: the apprentice's block-week
release credit and the release-conflict warning in Staffing and Reviews & Conflicts.

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
month's shifts, wages or cap change, closed work outside shifts or beyond shifts that are over
grows by a material step of 15 minutes, or its total rises more than 15 minutes' pay (at the
month's highest wage) above the documented one, as for Minijob exceedances. Work in progress never
enters the fingerprint by its minutes: an open clock-in outside any shift counts by its id, and a
shift whose clock-in is still open past its end is not over yet. Its growth shows in the total;
the clock-out that fixes its minutes may make the acknowledgement stale. A shift worked a few
minutes off its plan (early in, late out, a break) keeps it.
