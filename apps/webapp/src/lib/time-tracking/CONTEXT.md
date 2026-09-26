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

**Break**:
In clocking, ending the current live work and resuming new live work after the break interval.
_Avoid_: Pause

**On-behalf clock-out**:
A clock-out a manager performs for an employee's live work.
_Avoid_: Manager clock-out, forced clock-out

**Departure clock-out**:
The clock-out of a departing employee's live work, performed as part of offboarding.
_Avoid_: Offboarding clock-out
