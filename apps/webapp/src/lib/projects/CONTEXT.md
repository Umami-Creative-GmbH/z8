# Projects

The organization's projects that employees book working time and expenses to, the tasks inside them, and the templates new projects start from.

## Language

**Project**:
A piece of the organization's work, with its own status, budget and deadline, that employees book working time and expenses to. Projects are flat: a project never contains another project.
_Avoid_: Sub-project, parent project, job

**Project assignment**:
A team's or employee's membership in a project, which decides who may book to it.
_Avoid_: Project member (when the booking right is meant), project attribution

**Project manager**:
An employee responsible for a project, who is told when its budget or deadline is at risk.
_Avoid_: Project owner, project lead

**Task**:
A named piece of work inside exactly one project that time booked to the project can be attributed to. A task is not a work category: the work category says how the time counts, the task says what in the project it was spent on.
_Avoid_: Sub-project, activity, service, work category

**Open task** / **Done task**:
An open task can be booked to; a done task keeps what was booked to it but takes no new bookings until it is reopened.
_Avoid_: Archived task, closed task

**Task estimate**:
The hours a task is expected to take, compared with the hours booked to it. Unlike the project budget, it never raises budget alerts.
_Avoid_: Task budget

**Project template**:
A reusable blueprint for new projects. It is never booked to and is not a project; creating a project from it copies its contents once, and later changes to either side do not affect the other.
_Avoid_: Template project, master project

### Sharing reports

**Report share link**:
A secret, expiring URL that lets someone outside Z8 view one shared snapshot without signing in. It covers either one project's report or one customer's billable report, and it is revoked as soon as its creator can no longer see every project in it.
_Avoid_: Public report, guest access, client link, shared report

**Shared snapshot**:
The report content a report share link shows, frozen when the link is created. Later changes to the work behind it never reach it, and it never contains cost or margin.
_Avoid_: Live report, shared view
