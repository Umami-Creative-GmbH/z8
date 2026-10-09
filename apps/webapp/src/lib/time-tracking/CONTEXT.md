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

**Day total**:
An employee's work within one local day in their timezone: their completed work plus the part of any live work elapsed so far, split at local midnight. It differs from the compliance check's day, which counts each work period whole on the day it started.
_Avoid_: Daily sum, actual hours, today's minutes

**Closed month**:
A calendar month closed for an organization or for a team. For each employee covered, it is that month in the employee's timezone, fixed when the month is closed: a later timezone or team change does not move or lift it. A team close covers the employees whose primary team it was at that moment; an organization close also covers employees added later. Nobody may change work, attribution or absences that touch a closed month, even in part, whoever or whatever is writing; notes are not frozen, and erasing an employee or organization entirely is not a change. Closing is independent of any payroll export, and is refused while requests about the month are undecided or work that started in it is still live.
_Avoid_: Locked period, payroll period, frozen month, closed balance period

**Reopening**:
Lifting a month's close for some or all of the employees it covers, with a stated reason, by someone permitted to reopen. It is the only way to change work inside a closed month, and the month stays open for them until it is closed again.
_Avoid_: Unlock

**Admission**:
How an organization's work records accept new entries: `legacy` or `append`. An organization whose admission is `append` is **adopted**.
_Avoid_: Mode (reserved for an approval kind's lifecycle mode)

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

**Compliance check**:
The clock-out follow-up that judges closed work against the employee's working-time rules and records its violations. It applies the work policy assigned as of the instant the work ended, the instant the policy clock-out break snapshot also reads. It counts the totals of the local day and week in which the work started, and dates each violation at the work's start, so a violation falls on the day and in the week whose total broke the rule. When the check runs never matters, and recorded violations are never re-evaluated.

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
The instant by which an employee's live work is expected to have ended: the end of their published shift, otherwise the moment their day total reaches the day's required hours. A day with neither a shift nor required hours has no expected end.
_Avoid_: Planned end, shift end (when no shift applies)

**Missed clock-in reminder**:
A clocking reminder that the employee has not clocked in by their expected start plus the grace period, on a day without approved absence or public holiday.

**Forgotten clock-out reminder**:
A clocking reminder that the employee is still clocked in past their expected end plus the grace period.
_Avoid_: Still-clocked-in reminder, overtime alert

**Break-due reminder**:
A clocking reminder, shortly before it happens, that the employee's live work is about to break their work policy's break rules for lack of a break.
_Avoid_: Break overrun reminder, end-break reminder

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

**Assigned location**:
A location an employee works at. A kiosk accepts only employees assigned to its location.
_Avoid_: Work location (that is office, home or remote), location supervisor

**Pairing code**:
A single-use, short-lived code with which an admin enrols a kiosk.
_Avoid_: Activation code, link code
