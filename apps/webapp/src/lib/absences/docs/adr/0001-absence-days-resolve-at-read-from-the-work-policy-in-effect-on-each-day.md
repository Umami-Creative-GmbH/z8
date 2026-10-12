---
status: accepted
---

# Absence days resolve at read from the work policy in effect on each day

An absence takes as many absence days as it covers working days. Whether a day is a working day depends on the employee's work policy in effect on that day, and on their public holidays. We decided that absence days are never stored. Every reader resolves them when it needs them, from the work policy assigned on each day of the absence and the holidays assigned to the employee, as the vacation balance already does for holidays. Time Tracking captures the policy as evidence instead (Time Tracking ADR-0003), because there the policy decides what happens to work that is already recorded. Here it only measures it (#979).

## Considered Options

- **Snapshot absence days when an absence is approved.** Rejected: later holiday corrections would no longer reach the balance, every reader would become a migration with a backfill, and pending requests would still need resolving at read.
- **Use the work policy in effect on the absence's start date for the whole absence, or the one in effect today.** Rejected: an absence spanning a policy change would count the days on one side of the change under the wrong schedule.
- **Weight each working day by its scheduled hours.** Rejected: vacation allowances are given in days, and morning and afternoon halves have no meaning on a weighted day.

## Consequences

- Editing a work policy's schedule in place changes the absence days, and so the vacation balance, of every past absence of every employee on that policy. A schedule change meant to apply from a date is a new policy assigned from that date.
- A closed month (Time Tracking ADR-0004) freezes absences but not their absence days. Payroll lays absences out by calendar day and never reads absence days, so what payroll was given does not move.
- Refusing a vacation request that covers no working day decides from the schedule without the organization configuration guard. ADR-0003 still holds: nothing derived from the schedule is stored, so a request admitted or refused next to a concurrent policy change is counted correctly at its next read.
- Year-end carryover is the one value written from absence days. It keeps the value it was written with.
