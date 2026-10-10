---
status: accepted
---

# Closed months are fixed at close and refused by the database

A closed month must stay exactly what payroll was given for it. Payroll counts each employee's month in that employee's timezone, so the month cannot be one organization-wide range. We decided that closing a month records, for each employee it covers, the month in their timezone as fixed instants. It also records the team membership the close relied on. A later change of timezone or team does not move or lift the close. An organization-wide close also covers employees added later, at the range their timezone gives when they are first covered. A change is refused if the work or absence touches a closed range, before or after the change, even in part. Writers refuse with a typed "month closed" refusal. Behind them, the database refuses any write to work records or absences inside a closed range, so a writer outside the work-transaction coordinator, such as an absence writer, a raw-SQL path or a future writer, cannot get past it (#762).

## Considered Options

- **Derive the range at write time from the employee's current timezone and team.** Rejected: a timezone or team change after the close would silently move the frozen window away from what payroll exported.
- **Allow changes that leave the closed part unchanged.** For example, a night shift whose April end is moved. Rejected: every writer would need to compute what payroll counts in the closed month, which is easy to get subtly wrong. Work crossing month-end needs a reopen instead.
- **Refuse in the writers only.** Rejected: absence writers and some maintenance paths do not run in a work transaction. The issue's guarantee that no writer can bypass the close would then depend on every future writer remembering the check.
- **Move every absence writer onto the coordinator first.** Deferred: it is a large migration of its own, and the database refusal gives the guarantee without it.

## Consequences

- Closed months are organization configuration. Closing and reopening hold its guard exclusively, so they serialize with every coordinator writer that holds it shared. A writer that holds no organization guard, such as a departure's work transaction (`organization: "none"`, ADR-0003), relies on the database refusal. So do absence writers, which must also serialize with close and reopen in their own way.
- Erasing an employee or an organization entirely, including its cascades and demo resets, is not a change to a closed month and must pass the database refusal. Deleting a single record through a correction or an absence mutation is still refused.
- Balance adjustments (ADR-0008) are dated on a local day, so like absences they are matched to the closed month of that day. Recording or cancelling one there is refused by its writer, which holds the organization guard shared, and by the database (#804).
- Because a close is refused while work that started in the month is still live, a clock-out never ends work that began in a closed month.
