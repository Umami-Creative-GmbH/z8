# Settled days record payouts and do not freeze data

A settled day is one employee's calendar day, in that employee's timezone, whose worked hours and absences have been paid. Settling exists to prevent double payouts. A day is settled either by confirming a payroll export as paid or by settling it manually, for organisations that pay from the PDF or outside Z8. Settling keeps a copy of the day's values at that moment. Later payroll files leave settled days out. A day whose data has changed since settling is changed since settled; it raises a blocker and is not exported automatically. Settling is deliberately separate from closed months: it does not freeze the day's data and does not require the month to be closed. Freezing stays with Time Tracking, which defines closing as independent of any payroll export, and auto-close is off by default, so many organisations never close months.

## Considered Options

- **Reuse closed months as "settled".** Rejected. A closed month is a data freeze owned by Time Tracking, scoped to whole months and to organisation, team or location. A payout is per employee and per day, and it belongs to payroll.
- **Make settling freeze the data.** Rejected. Freezing would duplicate closed months and block legitimate corrections. Detecting changes since settling keeps corrections possible while still making them visible before they are paid.
- **Export the change since settling automatically as correction lines.** Deferred. How corrections work differs between payroll targets, so for now the operator handles each change on purpose.

## Consequences

- Settled days cover only worked hours and absences. Overtime payouts and travel-expense reimbursements keep their own safeguards: the balance adjustment ledger and confirmed payroll runs.
- Unsettling needs a reason and is audited. The days keep their settlement history.
- A reissue that includes settled days has to be chosen explicitly and comes with a warning.
