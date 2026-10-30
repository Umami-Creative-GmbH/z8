---
status: accepted
date: 2026-10-23
---

# Deactivation makes a former employee, with the same consequences as a departure

Admins deactivate employees who have left, and the offboarding workflow is not yet released, so deactivation is how most organizations record a leaver. It used to only switch the employee's access off: the person stayed on teams, as manager of their reports, on planned shifts and absences, in pickers, in notifications and on the bill. Both a deactivation and a departure that takes effect now make a **former employee**, and one current-roster rule decides who works here now. A former employee has the moment they left: the cutoff of their departure, or the moment they were deactivated.

Deactivation has the same consequences as a departure taking effect, at the moment of deactivation. Approval duties are handed over. Reports left without a current manager need a replacement before the deactivation is confirmed. Planned shifts after that moment become open shifts. Absences starting after it are cancelled. Held access grants, driving authorizations and kiosk badges end. The person's report share links are revoked, and the paid seat is released. Personnel file retention starts. Reactivation restores none of this. It clears the moment they left, records both events in the employment history, and lists what was ended so an admin can grant it again on purpose.

## Considered Options

- **Filter the views that leak and keep deactivation a flag.** That fixes what people see but keeps billing the seat, keeps former managers as approvers and keeps former employees staffed on future shifts. "Former" would also mean something different depending on which button was used.
- **Replace deactivation with the departure workflow now.** That is the long-term direction, but the departure workflow waits on its own release verification. Organizations need leavers handled correctly before then, and the current-roster rule already covers both.
- **Have deactivation end only access and leave grants, badges and authorizations in place.** The access check already stops a deactivated holder, but the grants would still show as held and would come back on reactivation without anyone deciding it.

## Consequences

- Deactivation shows a preview before it is confirmed, listing everything above. The server recomputes it on submit, like the departure preview.
- The employee edit form no longer switches someone active or inactive. Only the deactivate and reactivate actions do, with their checks.
- Views of the past keep former employees, marked as former. Everything about the present (teams, presence, planning, pickers, recipients, counts and seats) uses the current-roster rule, and a test refuses roster queries that bypass it.
- Employees deactivated before this decision get the moment they left from their last deactivation record, or *date not recorded*. A one-off backfill applies the same consequences, reported in a dry run first. Admins are told about reports who are left without a current manager.
