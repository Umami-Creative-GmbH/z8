# Time Tracking

How an employee's working time is started, ended and kept as work records, with canonical instants and the event-local offset of each entry.

## Language

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
