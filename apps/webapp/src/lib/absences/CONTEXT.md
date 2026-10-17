# Absences

Employees request time away from work, such as vacation or sick leave, and managers approve it. Absences draws the vacation each employee takes from their allowance, and records who covers for an employee while they are away.

## Language

### Changes

**Absence change request**:
An employee's request to change the dates or half-day coverage of, or cancel, their own approved absence, including one recorded on their behalf. It keeps the absence category unchanged and takes effect only after another eligible approver approves it.
_Avoid_: adjustment (reserved for vacation balances), direct edit, sick-day correction

### Counting

**Working day**:
A day the employee's work policy in effect on that day schedules them to work, and that isn't a public holiday for them. An employee whose policy has no schedule works Monday to Friday.
_Avoid_: business day, weekday, workday

**Working days per week**:
The number of distinct days an employee's effective work policy schedules them to work each week, before public holidays are excluded and regardless of hours per day. With no schedule, it is five.
_Avoid_: weekly hours, full-time equivalent

**Absence days**:
How many working days an absence takes. Each working day counts 1, and a morning or afternoon half counts ½, however many hours the day has.
_Avoid_: business days, vacation hours, calendar days

### Vacation

**Reference allowance**:
The vacation days a policy grants for a full year on a five-day working week. The employee's vacation allowance converts it to their scheduled working days per week, with each scheduled day counting equally regardless of hours and without reducing the week for public holidays.
_Avoid_: full-time allowance, organization allowance

**Vacation allowance**:
The absence days an employee may take as vacation in a year, before carryover and adjustments. For a part-time employee it is already reduced to their working days, because absence days count only the days they work. In a year the employee joins or leaves, it is their prorated allowance.
_Avoid_: vacation entitlement, annual hours

**Vacation policy period**:
The organization-local calendar dates during which the same vacation policy applies to an employee. Their direct assignment takes precedence over their applicable teams, then an organization assignment, then the company default. Matching team policies count once; differing team policies are a configuration conflict.
_Avoid_: current team policy, latest policy

**Vacation team eligibility**:
The dates during which an employee belongs to a team for vacation policy selection. Leaving a team preserves its earlier eligibility; today's team does not establish unknown earlier membership.
_Avoid_: compatibility team, reconstructed membership

**Policy coverage gap**:
Dates for which no applicable vacation policy is known. An unknown allowance needs review and cannot be treated as zero days or filled with an unrelated policy.
_Avoid_: zero allowance, no vacation

**Custom allowance**:
A vacation allowance an admin sets for one employee and one year in place of their policy's. It is final: it is never prorated.
_Avoid_: override, manual allowance

**Prorated allowance**:
The vacation allowance of a year the employee joins or leaves: 1/12 for each full employment month they work in that year, with a fraction of ½ day or more rounded up to a whole day. It never drops below the statutory minimum once the employee completes the waiting period in that year and does not leave by 30 June. Each employment of a rehired employee is prorated separately, and together they never exceed the full allowance.
_Avoid_: pro-rata vacation, partial vacation, "Teilurlaub" in English copy

**Employment month**:
A month counted from the day an employment starts, such as 15 October to 14 November. Days left over at the end of the year or before the last working day do not make an employment month.
_Avoid_: calendar month, month worked

**Waiting period**:
The first six months of an employment. Each rehire starts a new one.
_Avoid_: probation, probationary period

**Statutory minimum**:
A policy's minimum annual vacation allowance, stated for a five-day working week and converted to the employee's working days per week. The prorated allowance never cuts below it once the waiting period is complete, unless the employee leaves by 30 June.
_Avoid_: legal allowance, minimum vacation

**Overdrawn vacation**:
Vacation an employee has already taken beyond their prorated allowance. It is shown but never reclaimed.
_Avoid_: negative balance, vacation debt

**Vacation balance**:
An employee's vacation allowance plus carryover and adjustments, minus the absence days of their approved and pending vacation in that year. On an accrual policy it starts at 0 instead of the allowance, and the accrual adjustments carry the allowance. The policy applicable to the employee supplies their allowance; a missing policy or conflicting team policies require review.
_Avoid_: remaining vacation, leave account

**Accrual policy**:
A vacation policy that grants its allowance in monthly or biweekly shares instead of all at once on 1 January.
_Avoid_: accrual type monthly (in prose)

**Adjustment**:
A signed number of vacation days added to one employee's balance for one year. A **manual adjustment** is made by an admin or manager and appears in the adjustment history. An **accrual adjustment** is one month's share of an accrual policy's allowance for the days of the month the employee is employed, leavers included, written by the system on the month's first day; an employee has at most one per month, and together they are the employee's accrual to date.
_Avoid_: correction, bonus days

### Cover

**Deputy**:
The colleague an employee names on an absence to cover for them while they are away. Naming a deputy needs no acceptance from them, and the deputy is not part of what the absence's approver approves. Being someone's deputy shows no more about their absence than the deputy could already see.
_Avoid_: substitute, stand-in, delegate, proxy; "Vertretung" (unqualified) in German copy, use "Abwesenheitsvertretung"

**Deputy required**:
An absence category whose absences must always name a deputy. Sick leave never requires one.
_Avoid_: mandatory deputy, deputy rule

A deputy is not the escalation **backup manager** (who takes over one overdue approval) and not the offboarding **replacement** (who permanently takes over a departed employee's duties).
