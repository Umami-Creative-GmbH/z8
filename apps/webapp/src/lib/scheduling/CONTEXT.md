# Scheduling

Planners put employees on shifts ahead of time so every subarea is staffed. A shift is planned work; the work actually done is a work period in Time Tracking.

## Language

### Shifts

**Shift**:
A planned stretch of work in one subarea on one day, assigned to one employee or open.
_Avoid_: work period (that is recorded work in Time Tracking), roster entry

**Shift date**:
The calendar day a shift belongs to, in the organization's timezone. It is stored as that day's organization-local midnight, so it is read back in the organization's zone, never as a UTC date (`scheduling/shift-date.ts`).
_Avoid_: shift day in UTC, viewer-local shift date

**Open shift**:
A shift with no assigned employee, whether draft or published.
_Avoid_: unassigned shift, vacant shift

**Pickup request**:
An employee's request to be assigned a published open shift, which a planner approves or rejects.
_Avoid_: claim, shift application

**Planner**:
An employee with the manager or admin role who creates shifts and assigns employees to them.
_Avoid_: scheduler, shift manager

### Skills

**Skill**:
A qualification the organization defines, such as a forklift licence or first-aid training, that shifts and subareas can require.
_Avoid_: qualification, competency, certification (a certificate is a personnel file document)

**Employee skill**:
A skill one employee holds, optionally with an expiry date.
_Avoid_: skill assignment, employee qualification

**Skill expiry date**:
The last day an employee skill is valid, as a plain day on the organization's calendar. It means the same as a personnel file expiry date. While skill certificates name the employee skill, the latest of their expiry dates is the skill expiry date.
_Avoid_: expires at, valid until

**Expired skill**:
An employee skill whose skill expiry date is before the day in question: the shift date when planning a shift, the organization's today for reminders.
_Avoid_: invalid skill, lapsed skill

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
