# Travel Expenses

Employees report what they spent on business, or drove or travelled for it, so the organization can review and reimburse it.

## Language

### Reports

**Expense report**:
An employee's request to be reimbursed for one or more expense items, either a trip report or a standalone report.
_Avoid_: claim, travel expense claim (the legacy model)

**Trip report**:
An expense report for one business trip, with a purpose, destination, travel dates and its own timezone.
_Avoid_: travel report

**Standalone report**:
An expense report for a single expense item outside any trip. It has no travel dates and no timezone of its own.
_Avoid_: receipt report, single expense

**Expense item**:
One receipt, mileage or per diem entry of an expense report.
_Avoid_: line, position, expense (unqualified)

**Project attribution**:
The project an expense item is charged to, either taken from its trip report or chosen for the item itself. A receipt or mileage item may name its own project; a per diem always takes its trip's.
_Avoid_: project assignment (that is employee membership in a project), cost allocation

### Dates

**Expense date**:
The calendar day a receipt was issued or a mileage drive took place. It is a plain day, not tied to any timezone.
_Avoid_: receipt date, transaction date

**Travel dates**:
The first and last travel day of a trip report, as calendar days in the trip's timezone. The last one is the **trip end**.
_Avoid_: trip period, trip range

**Per diem itinerary**:
The **departure** and **return** of a per diem, each a local date and time in its own timezone. Its days must match the trip's travel dates.
_Avoid_: per diem period, travel times

**Future-dated**:
Said of an expense item or trip that has not happened yet: an expense date or trip end later than the current date anywhere on earth, or a per diem return that has not passed.
_Avoid_: post-dated, early

### Submission

**Still needed**:
What keeps an expense report from being submitted, listed per trip and per expense item. A future-dated item or trip is still needed until it has happened.
_Avoid_: blockers, missing fields, validation errors

**Submission**:
Handing an expense report to approval, possible only when nothing is still needed. A draft may hold anything, including future dates while a trip is planned.
_Avoid_: send, file

### After approval

**Expense officer**:
A person granted access to approved expense reports within their officer scope, allowed to export them, record reimbursements, or both. Granted separately from payroll access, so one person may hold either, both or neither.
_Avoid_: finance user, accountant, payroll officer (that is payroll access)

**Officer scope**:
Which expense reports an expense officer handles: all of them, or those of named employees and of the teams the employee belonged to when the report was approved. A report keeps its scope when the employee changes team or leaves.
_Avoid_: finance scope, visibility

**Export**:
A file of approved expense reports and their receipts handed to bookkeeping. An export moves no money and does not make a report reimbursed.
_Avoid_: booking, transfer

**Reimbursement**:
Money the organization paid out to an employee for an approved expense report, recorded with its amount, date and reference.
_Avoid_: payment, payout

**Recovery**:
Money an employee paid back because more was reimbursed than they were owed.
_Avoid_: refund, chargeback

**Reimbursed**:
Said of an approved expense report whose reimbursements, less recoveries, cover everything owed to the employee. A later adjustment can make it owed again.
_Avoid_: paid (that names who paid a receipt), settled

**Awaiting reimbursement**:
Said of an approved expense report that still owes the employee money, in full or in part.
_Avoid_: unpaid, open

**Coverage gap**:
The expense reports awaiting reimbursement that no expense officer who can record reimbursements has in their officer scope, other than for their own reports. Owners and admins still handle them. An organization without expense officers has no coverage gap.
_Avoid_: unassigned reports, orphaned reports
