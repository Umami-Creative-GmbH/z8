# Time Tracking

How an employee's working time is started, ended and kept as work records, with canonical instants and the event-local offset of each entry.

## Language

### Coordinating writers

**Work transaction**:
One atomic change to time data, carried out under the acquisition protocol for a declared scope.
_Avoid_: coordinated transaction, outer transaction

**Coordinator**:
The single owner of a work transaction: it establishes the scope, takes every guard in rank order and hands the writer a sealed scope.
_Avoid_: transaction owner, wrapper

**Acquisition protocol**:
The fixed order in which a work transaction takes its guards, so that concurrent writers can never wait on each other in a cycle.
_Avoid_: lock order, #264 order

**Rank**:
A guard's position in the acquisition protocol: adoption gate, approval write gate, organization configuration, user configuration/access, employee coordination, source identity, then rows. A work transaction never takes a guard of lower rank after one of higher rank.

**Guard**:
A named protection a work transaction holds until commit, either shared (many readers) or exclusive (one writer).
_Avoid_: lock (when the rank matters)

**Organization configuration**:
The organization's settings that decide whether new work is accepted and how it is routed when it is recorded: timezone, holidays, change policies, project and work-category eligibility, organization-wide authorization, billing entitlement and closed months. Work policies and surcharge models are not organization configuration: they are evidence captured with the work they apply to.
_Avoid_: org settings, policy configuration

**Adoption gate**:
The organization-wide guard every writer of time data holds shared, and that switching an organization's admission holds exclusively. A work transaction reads the admission once, under this gate; in an adopted organization, writers outside a work transaction are refused.

**Scope**:
The organization, users and employees a work transaction protects, as decided by scope routing.

**Scope routing**:
Deciding, from current data, which users and employees a write depends on, and which of those employees are its write targets.

**Write target**:
An employee whose work a work transaction may change. Every write target is in the scope, but not every employee in the scope is a write target: some are protected only because authorization reads them.

**Scope change**:
The routed scope differs once the guards are held, so the work transaction restarts rather than take an earlier-ranked guard late.
_Avoid_: scope drift

### Work

**Work period**:
One stretch of an employee's work from clock-in to clock-out.
_Avoid_: Session, shift, time entry pair

**Live work**:
A work period that has started and not yet ended; the employee is clocked in.
_Avoid_: Active session, running timer

**Completed work**:
A work period that has ended and now counts in the employee's work record.
_Avoid_: Finished entries, closed session

**Work attribution**:
What a work period is recorded against: its project, work category, work location, vehicle use and whether it is billable. Changing it is an amendment of completed work, under the same change policy for every part.
_Avoid_: Work metadata, tags

**Canonical work record**:
The record of a completed work period that payroll reads, kept beside the work period in both admissions. Every completed work period has exactly one, except history written before that rule in a closed month, which gets its record when the month is reopened.
_Avoid_: Canonical record (alone; Approvals has canonical workflows), time record, shadow record, mirror

**Record agreement**:
A completed work period and its canonical work record matching on interval, duration, approval state and work attribution. Every writer of completed work keeps it, and work whose records disagree is not changed until it has been reviewed.
_Avoid_: Sync, consistency, drift

**Day total**:
An employee's work within one local day in their timezone: their completed work plus the part of any live work elapsed so far, split at local midnight. It differs from the compliance check's day, which counts each work period whole on the day it started.
_Avoid_: Daily sum, actual hours, today's minutes

**Closed month**:
A calendar month closed for an organization, a team or a location. A location close covers the employees assigned there when it is closed, including inactive or departed employees whose assignment remains, and freezes each covered employee's whole month, including work at other locations. Later assignment changes do not move or lift it. For each employee covered, it is that month in the employee's timezone, fixed when the month is closed: a later timezone or team change does not move or lift it. A team close covers the employees whose primary team it was at that moment; an organization close also covers employees added later. Nobody may change work, attribution, absences or balance adjustments that touch a closed month, even in part, whoever or whatever is writing; notes are not frozen, and erasing an employee or organization entirely is not a change. Closing is independent of any payroll export, and is refused while requests about the month are undecided or work that started in it is still live.
_Avoid_: Locked period, payroll period, frozen month, closed balance period

**Reopening**:
Lifting a month's close for some or all of the employees it covers, with a stated reason, by someone permitted to reopen. It is the only way to change work inside a closed month, and the month stays open for them until it is closed again.
_Avoid_: Unlock

### Feature assignments

**Global feature switch**:
The organization's control that switches vehicle use or position capture off for everyone, regardless of their feature assignments. Switching it on allows the assignments to decide who the feature applies to.

**Feature assignment**:
The vehicle-use mode or position-capture setting for an organization, primary team or employee. An employee's own assignment overrides their primary team's, which overrides the organization default; an explicit off assignment excludes its scope, and removing an override restores inheritance.

### Driving

**Vehicle use**:
The part of a work period's attribution saying which vehicle the employee drove during it, with its odometer readings and driven distance, in whole kilometres. A break carries the vehicle over to the resumed work, and one reading at the break ends the first work period's readings and starts the next.
_Avoid_: Trip, drive, mileage entry

**Odometer reading**:
The kilometre count an employee reads off a vehicle's odometer and records with a work period: a start reading when it starts and an end reading when it ends.
_Avoid_: Meter reading, km reading, mileage

**Vehicle use expected**:
An employee the organization expects to record vehicle use on every work period, as opposed to one who is only asked. It never refuses or delays a clock command.
_Avoid_: Mandatory mileage, required vehicle

**Driving details missing**:
A work period of an employee with vehicle use expected that lacks its vehicle or a reading. It stays visible to the employee and their manager until completed.
_Avoid_: Incomplete mileage, missing km

**Driven distance**:
The kilometres an employee drove in one vehicle during one work period: the end reading minus the start reading, or the distance they entered themselves when the start reading is missing. A work period has at most one vehicle; Z8 keeps no tax logbook of trips.
_Avoid_: Mileage (a travel-expense item), trip, logbook, Fahrtenbuch

**Own vehicle**:
The employee's private vehicle, recorded on work without identifying it. Only distance driven in an own vehicle can pre-fill a travel-expense mileage item.
_Avoid_: Private car, personal vehicle

### Work balance

**Required time**:
The work an employee's work policy expects of them on a local day, less what public holidays and approved absences release. Time off in lieu releases none.
_Avoid_: Target hours, expected hours, Sollzeit

**Work balance**:
An employee's completed work minus their required time, accumulated since they started, together with their balance adjustments.
_Avoid_: Overtime account, time account, flextime balance

**Balance adjustment**:
A recorded change to an employee's work balance that is neither work nor required time: an opening balance or an overtime payout. It counts from the end of its day, carries who recorded it and why, and is never edited; a mistaken one is cancelled, and stays visible as cancelled.
_Avoid_: Manual correction, balance edit, booking

**Opening balance**:
The work balance an employee brings from before their time was kept in Z8, as of a day; it may be negative. It replaces their work balance up to and including that day: earlier work and required time stay on record but no longer count. An employee has at most one in effect.
_Avoid_: Carry-over (reserved for vacation), starting balance, initial balance

**Overtime payout**:
A balance adjustment recording that part of an employee's positive work balance was paid as wages. It lowers the work balance by that time, and is never recorded for more than the work balance on its day; later corrections to work may still leave the balance negative.
_Avoid_: Payout (alone), cash-out, overtime settlement

**Time off in lieu**:
An absence taken against the work balance instead of against vacation. No work is expected on it, yet its required time still counts, so the work balance falls by that time.
_Avoid_: TOIL, compensatory leave, overtime reduction

**Admission**:
How an organization's work records accept new entries: `legacy` or `append`. An organization whose admission is `append` is **adopted**.
_Avoid_: Mode (reserved for an approval kind's lifecycle mode)

### Period submissions

**Period submission**:
An employee's confirmation that their work and absences for one submission period are complete and correct, which an approver then accepts or rejects. Any later change to that work or those absences sends the period back to the employee to submit again; only a closed month freezes it.
_Avoid_: Timesheet (Billable Time's itemized list for an invoice), timesheet submission, period sign-off

**Submission period**:
The week or calendar month, in the employee's timezone, that one period submission covers, clipped to their employment. Its range is fixed once submitted: a later timezone change does not move it.
_Avoid_: Timesheet period, pay period

**Submission cadence**:
An organization's choice of week or calendar month as its submission period, with the day its weeks start for a weekly cadence. Organizations without one do not collect period submissions.
_Avoid_: Submission frequency, timesheet interval

**Submission readiness**:
Whether an employee's submission period currently meets every precondition for submission, including its timing, submission status, undecided requests, live work and an eligible approver. Being ready does not confirm that the employee's records are complete or correct, and readiness can change before they submit.
_Avoid_: Completeness check, payroll readiness, period approval

**Sent back after a change**:
A submitted period whose work, work attribution or absences changed afterwards, or whose work's approval state was decided again, by any writer, even in part; notes do not count. A pending period submission is withdrawn automatically (its approval is cancelled); an approved one goes out of date, and its approval stays as history. Either way the period awaits submission again, and the employee is told once.
_Avoid_: Rejected (an approver's decision), reopened (a closed month's term), invalidated

### Clocking

**Clocking**:
Starting, interrupting or ending an employee's live work, by the employee or on their behalf.
_Avoid_: Punching, time clock

**Clock command**:
One request to change an employee's live work: clock in, clock out or break. It names who asks, for whom, when it happened and its operation identity.
_Avoid_: Clock request, clock action

**Frozen clock command**:
A clock command fixed on the employee's device when it happened and submitted later, possibly delayed or offline.
_Avoid_: v2 command, direct command

**Legacy clock command**:
A clock command from an old consumer of the legacy direct route, such as the legacy desktop or an old browser queue. It commits only while the organization is not adopted; afterwards only its committed actions are answered.
_Avoid_: v1 command, old command

**Break**:
In clocking, ending the current live work and resuming new live work after the break interval.
_Avoid_: Pause

**Manual break**:
A break the employee starts explicitly and ends by explicitly resuming work. The employee may instead end their working day without resuming.
_Avoid_: Pause, idle break

**Break in progress**:
A manual break that has started and not yet ended, recorded with the employee's live work so that any device can resume it or end the day from it.
_Avoid_: On-break flag, pause, paused work

**Idle-confirmed break**:
A past break interval suggested by device inactivity and explicitly confirmed by the employee. Device inactivity alone does not establish that the employee was on break.
_Avoid_: Automatic break, manual break

**On-behalf clock-out**:
A clock-out whose subject is another employee's named live work, performed by an organization owner, an admin or the employee's direct manager; never by the employee themselves.
_Avoid_: Manager clock-out, forced clock-out

**Compliance week**:
The local calendar interval from Monday midnight up to the following Monday midnight, used by the compliance check and Scheduling. Personal calendar preferences and an organization's submission cadence do not change it.

**Compliance check**:
The clock-out follow-up that judges closed work against the employee's working-time rules and records its violations. It applies the work policy assigned as of the instant the work ended, the instant the policy clock-out break snapshot also reads. It counts the totals of the local day and compliance week in which the work started, and dates each violation at the work's start, so a violation falls on the day and in the week whose total broke the rule. When the check runs never matters, and recorded violations are never re-evaluated.

**Position stamp**:
The device-reported position (coordinates, accuracy and fix time) recorded as evidence with one of an employee's own clock commands, captured on their device when the event happened. It is never added, edited or moved afterwards, and a clock command without one is accepted unchanged.
_Avoid_: Location stamp, GPS stamp, geotag (a **work location** is the office/home/remote choice; a **location** is a site)

**Position consent**:
An employee's own recorded agreement that their clock commands may carry position stamps. Position stamps are captured only while it is active and the organization has switched capture on for that employee; the employee may withdraw it at any time.
_Avoid_: GPS opt-in, tracking consent

**Position notice**:
The versioned text an employee agrees to when giving position consent: what is captured, when, for how long, who may see it and why. A consent is valid only for the notice version it was given against.
_Avoid_: Privacy notice, consent text

**Departure clock-out**:
The clock-out of a departing employee's live work, performed as part of offboarding. Its principal is the departure, which runs only enlisted in its own departure's work transaction and is exempt from billing; its follow-ups (except compliance advice) are staged as durable work.
_Avoid_: Offboarding clock-out

### Reminders

**Clocking reminder**:
A notification to an employee that their own clocking has fallen behind what their shift or work policy expects. It never changes work records.
_Avoid_: Nudge, alert, timer reminder

**Expected start**:
The instant by which an employee is expected to have clocked in on a local day in their timezone: the start of their published shift, otherwise their work policy's latest clock-in for that weekday. A day with neither has no expected start.
_Avoid_: Planned start, scheduled start

**Latest clock-in**:
An optional time of day on a work policy's schedule day by which employees on that policy are expected to have clocked in. A policy without one, such as flextime, expects no particular start.
_Avoid_: Core time start, start time

**Expected end**:
The instant by which an employee's live work is expected to have ended: the end of their published shift, otherwise the moment the work counted for the local day the live work started reaches that day's required hours. That count is the compliance check's: every work period that started that day, whole, plus the live work elapsed so far, so live work past midnight still belongs to the day it started. A day with neither a shift nor required hours has no expected end.
_Avoid_: Planned end, shift end (when no shift applies)

**Missed clock-in reminder**:
A clocking reminder that the employee has not clocked in by their expected start plus the grace period, on a day without approved absence or public holiday.

**Forgotten clock-out reminder**:
A clocking reminder that the employee is still clocked in past their expected end plus the grace period.
_Avoid_: Still-clocked-in reminder, overtime alert

**Break-due reminder**:
A clocking reminder, shortly before it happens, that the employee's live work is about to break their work policy's break rules for lack of a break.
_Avoid_: Break overrun reminder, end-break reminder

**Period submission reminder**:
A reminder to the employee to submit an expected submission period that has ended without a pending or approved period submission: once when the period ends in their timezone, and once more after the organization's reminder delay. It is delivered like a clocking reminder, at most once each, and never submits anything.
_Avoid_: Timesheet reminder, submission deadline

### Kiosks

**Kiosk**:
A shared device enrolled to one location of an organization, on which employees clock with their kiosk PIN. It acts as itself, never as a signed-in user.
_Avoid_: Terminal, shared device, clock-in station

**Kiosk clocking**:
Clocking at a kiosk. It is the employee's own clocking, authorized by the kiosk together with the employee's kiosk PIN; never on behalf.

**Kiosk PIN**:
An employee's personal secret that proves at a kiosk which employee is clocking.
_Avoid_: Password, passcode

**Kiosk-only employee**:
An employee who has no sign-in and clocks only at kiosks.
_Avoid_: Terminal user, offline employee

**Kiosk seat**:
A billable seat held by a kiosk-only employee, charged at the cheaper kiosk seat price on the organization's subscription.
_Avoid_: Kiosk license, terminal seat

**Full seat**:
A billable seat held by anyone who is not a kiosk-only employee, charged at the ordinary seat price.
_Avoid_: Normal seat, standard license

**Assigned location**:
A location an employee works at. A kiosk accepts only employees assigned to its location.
_Avoid_: Work location (that is office, home or remote), location supervisor

**Pairing code**:
A single-use, short-lived code with which an admin enrols a kiosk.
_Avoid_: Activation code, link code

**Offline kiosk clocking**:
Kiosk clocking captured while the kiosk cannot reach Z8, kept on the kiosk as frozen clock commands and confirmed only once they reach Z8, where the kiosk PIN is checked. Only kiosks switched to offline mode in adopted organizations clock offline.
_Avoid_: Offline mode (alone), queued kiosk clocking, offline employee
