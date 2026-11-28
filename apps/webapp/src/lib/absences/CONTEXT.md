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
The number of distinct days an employee's effective work policy schedules them to work each week, before public holidays are excluded and regardless of hours per day. With no schedule, it is five. A day without any employment period has no working days per week at all: it is not employment, and never a schedule without working days.
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
The organization-local calendar dates during which the same vacation policy applies to an employee. Their direct assignment takes precedence over their applicable teams, then an organization assignment, then the company default. Matching team policies count once; differing team policies are a configuration conflict. Leave earned during a policy period keeps that policy’s designation of whether German leave-expiry rules apply, including after the employee moves to another policy. If the earning policy has no designation, unused days remain visible as outstanding until HR classifies it.
_Avoid_: current team policy, latest policy

**Extra contractual days**:
Vacation days granted above the statutory minimum. Under a vacation policy designated for German leave-expiry rules, these days have the same expiry protections as the statutory days unless HR explicitly records separate terms for them. A general carryover cap or expiry date alone does not establish separate terms.

When an employee takes vacation, days with the earliest established expiry date are used first. Days with no established expiry are used after dated days. When expiry dates match, or neither balance has an established expiry, the older leave year is used first.

**Z8 leave notice**:
In the first release, Z8 prepares the notice with the employee’s outstanding days and proposed deadline. HR reviews it and chooses when to send it. Before sending a German leave notice, HR confirms the expiry date and records why it applies to the covered days. Confirmed delivery to the employee establishes that the notice was given. Z8 retains the exact notice and delivery time. Employee acknowledgement is optional. Queued, failed, and unknown delivery states leave the notice unconfirmed.

**External leave notice**:
A notice given outside Z8 and recorded through a dated HR attestation. HR identifies the employee, when and how the notice was given, the leave year, days covered, and deadline. HR confirms that the notice asked the employee to take those days and warned that unused days could lapse. Supporting documents are optional.

If a delivered notice gave the wrong deadline, Z8 retains the original notice and suspends expiry for the affected days. HR confirms the corrected deadline, gives the employee a corrected notice, and documents their opportunity to take the days by that date before expiry can resume. If HR confirms the error after expiry, Z8 immediately restores the days debited under that notice to their original leave year. They are available to request again, and the balance history shows both the expiry and its reversal.

**Opportunity to take leave**:
For expiry based on an employee notice, HR’s documented finding that the employee could actually take the outstanding days covered by that notice before its deadline. Those days remain outstanding until HR records the basis for that finding. Days added after the notice remain outstanding until a new notice covers them and HR documents the employee’s opportunity to take those additional days.

**Continuous incapacity for leave expiry**:
For the German 15-month rule, HR confirms that the employee was unable to work throughout the leave year and remained so through the deadline 15 months after the end of that year. If the employee worked part of the year or the evidence has a gap, the days remain outstanding for individual review.

A vacation request submitted by the expiry deadline protects the requested days that fall on or before that deadline while approval is pending. Approval charges those days to the original balance. A denial after the deadline returns them to HR for individual review. If approved vacation is cancelled after its original expiry deadline, the returned days are restored to their original leave year and are available to request while HR reviews the circumstances.

After the deadline has passed and HR has documented that the applicable expiry conditions are met, Z8 automatically expires the eligible unused days. Days protected by a timely pending request remain outstanding.

**Historical leave loss review**:
An HR review of identifiable unused days lost before the earning policy was classified. It shows the affected year, number of days, and reason for the loss. HR can restore the days or document why the expiry stands. Previously lost days become available to request once HR restores them. Days still outstanding during an expiry review remain available through the usual vacation request and approval process.

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

**Weighted annual policy allowance**:
The annual allowance combined from an employee's effective vacation policy periods. A full calendar month contributes 1/12 of its annual rate; an intra-month change splits that share by the covered calendar days and the month's actual length. Sum at full precision, then round the combined annual rate and statutory minimum once to two decimals. Apply employment proration afterwards, without restarting employment-month or waiting-period clocks. A custom allowance stays final. Working-week conversion (ADR 0003, #990) converts each combined policy and working-week period by its working days per week ÷ 5, and each employment averages those rates over its own employed dates.
_Avoid_: final policy allowance, latest policy for the whole year

**Vacation balance**:
An employee's vacation allowance plus carryover and adjustments, minus the absence days of their approved and pending vacation in that year. On an accrual policy it starts at 0 instead of the allowance, and the accrual adjustments carry the allowance. The policy applicable to the employee supplies their allowance; a missing policy or conflicting team policies require review.
_Avoid_: remaining vacation, leave account

**Accrual policy**:
A vacation policy that grants its allowance in monthly or biweekly shares instead of all at once on 1 January.
_Avoid_: accrual type monthly (in prose)

**Adjustment**:
A signed number of vacation days added to one employee's balance for one year. A **manual adjustment** is made by an admin or manager and appears in the adjustment history. An **accrual adjustment** is one month's share of the employee's effective accrual-policy periods for the days of the month they are employed, leavers included, written by the system on the month's first day; an employee has at most one per month, and together they are the employee's accrual to date. Amount changes within the month are weighted by the month's actual calendar days; a custom allowance supplies the final annual rate. A posted share stays unchanged on automatic retries or later assignment changes.
_Avoid_: correction, bonus days

**Carryover**:
The unused vacation transferred from one year to the next. The policy effective on 31 December of the source year supplies permission and the cap; the policy effective on 1 January of the receiving year supplies expiry. A newly committed transfer keeps its amount and expiry through later policy or assignment changes, including a committed zero transfer or an explicit absence of expiry. Earlier stored carryover retains its prior expiry treatment unless explicitly reviewed. Carryover keeps each earning year and its earning policy as separate **earning-year leave**; the policy's cap and deadline apply only to leave whose earning policy is designated for the policy's own terms, or to extra contractual days with separately recorded terms. See [ADR 0006](docs/adr/0006-leave-keeps-its-earning-year-and-earning-policy.md).
_Avoid_: recalculated carryover, current-policy carryover

**Earning-year leave**:
The unused days of one leave year that a year-end transfer carried into a later year, with the vacation policy they were earned under. Carrying them again keeps the same earning year and policy.
_Avoid_: carryover bucket, pooled carryover

**Posting configuration problem**:
Missing or conflicting vacation policies for dates needed to calculate an automatic accrual or carryover. The affected employee is skipped with the dates and configuration state visible for review; correctly configured colleagues still process. An unknown allowance is never a zero-day posting.
_Avoid_: zero allowance, organization-wide failure

### Cover

**Deputy**:
The colleague an employee names on an absence to cover for them while they are away. Naming a deputy needs no acceptance from them, and the deputy is not part of what the absence's approver approves. Being someone's deputy shows no more about their absence than the deputy could already see.
_Avoid_: substitute, stand-in, delegate, proxy; "Vertretung" (unqualified) in German copy, use "Abwesenheitsvertretung"

**Deputy required**:
An absence category whose absences must always name a deputy. Sick leave never requires one.
_Avoid_: mandatory deputy, deputy rule

A deputy is not the escalation **backup manager** (who takes over one overdue approval) and not the offboarding **replacement** (who permanently takes over a departed employee's duties).

## Vacation policy calculation rollout

Dated readers and automated postings share the organization-scoped `vacation_policy_rollout.calculations_enabled` gate. Admission activates the period contract for 2026 onward only when both reader and posting consumers are ready. Dates before the organization's known or reviewed eligibility baseline retain legacy company-default selection, and earlier years retain their existing result. Each employee returns an independent resolved, legacy, missing, or conflicting configuration; an unavailable balance is never presented as a zero allowance. Employee, dashboard, manager, admin, reporting and proration-notice readers use the shared balance store.

Automatic accrual resolves the employee's required unposted months. Annual carryover resolves the source balance, source-year-end permission and cap, and receiving-year-start expiry. Jobs delegate employee eligibility to these consumers rather than filtering whole organizations by their company default. Missing or conflicting required coverage produces an employee-specific skipped reason while other employees continue. All calendar boundaries use the organization's timezone.

Admission, policy history and assignment changes never rewrite posted accrual or stored carryover. New carryover commits an immutable outcome, including zero or disallowed carryover, and freezes its expiry or explicit no-expiry terms. Later policy changes cannot create an extra transfer or alter those terms. Legacy carryover retains its prior company-default expiry treatment without inferred snapshots. Balances, expiry processing, reports and the admin detail honor the stored terms. A dated expiry remains valid through its final millisecond; expiry applies after that instant.

Reviewed historical usage, absence reconciliation and employment-date correction retain their preview overrides. Only an explicit reviewed correction may change eligible stored amounts; assignment changes and scheduled jobs never invoke that correction path. Employment-date correction includes policy resolution evidence in its preview fingerprint so stale configuration requires another review. Configuration gaps require review before a correction that needs an allowance can commit. See [ADR 0005](docs/adr/0005-vacation-postings-preserve-committed-amounts-and-expiry.md).
