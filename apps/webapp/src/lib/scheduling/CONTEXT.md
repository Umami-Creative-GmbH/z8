# Scheduling

Planners put employees on shifts ahead of time so every subarea is staffed. A shift is planned work; the work actually done is a work period in Time Tracking.

## Language

### Shifts

**Shift**:
A planned stretch of work in one subarea on one day, assigned to one employee or open.
_Avoid_: work period (that is recorded work in Time Tracking), roster entry

**Open shift**:
A shift with no assigned employee, whether draft or published.
_Avoid_: unassigned shift, vacant shift

**Pickup request**:
An employee's request to be assigned a published open shift, which a planner approves or rejects.
_Avoid_: claim, shift application

**Planner**:
An employee with the manager or admin role who creates shifts and assigns employees to them.
_Avoid_: scheduler, shift manager

### Staffing

**Staffing suggestion**:
A ranked list of employees who could take one open shift, each shown with the reasons for its place and any warnings. A planner picks from it; it is never applied automatically and never stored.
_Avoid_: recommendation, auto-assignment, auto-schedule

**Staffing blocker**:
A fact that rules an employee out of an open shift entirely: not employed on the shift date, an approved absence covering the shift, or an overlapping shift.
_Avoid_: conflict, disqualification

**Staffing warning**:
A problem shown next to a suggested employee that the planner may knowingly accept, such as a missing required skill, a compliance finding or a pending absence.
_Avoid_: blocker, error

**Remaining contracted hours**:
An employee's contracted target for the shift's week minus the hours already planned for them that week.
_Avoid_: capacity, free hours
