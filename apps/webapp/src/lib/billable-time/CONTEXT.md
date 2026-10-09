# Billable Time

Which of an organization's work is chargeable to its customers, at what price, and how it is handed to the organization's accounting tool as invoice drafts. Z8 never issues invoices itself.

## Language

### Prices

**Billable currency**:
The one currency in which an organization's billable rates, cost rates, revenue and margin are expressed.

**Billable rate**:
The price per hour an organization charges a customer for work. It is set at one of the rate levels and is effective-dated.
_Avoid_: Billing rate, sell rate, price, rate (alone)

**Rate level**:
Where a billable rate is set: employee on a project, project, customer, or employee. The most specific level that has a rate in effect wins, in that order, so rates agreed with a customer beat an employee's list rate.
_Avoid_: Rate tier, rate scope

**Applicable rate**:
The billable rate that applies to a piece of billable work. It is the winning rate level's rate in effect at the instant the work started, looked up when the work is read, until the work is invoiced.
_Avoid_: Effective rate, current rate

**Unpriced work**:
Billable work for which no rate level has a rate in effect. It is never priced at zero; it is shown as needing a rate.
_Avoid_: Zero-rate work, missing rate

**Cost rate**:
An employee's fully loaded internal cost per hour, effective-dated, used only to compute margin. It is separate from the employee's wage.
_Avoid_: Hourly rate, wage, internal rate

### Work

**Billable work**:
Completed work on a customer's project that is chargeable to that project's current customer. Work without a project, or on a project without a customer, is never billable.
_Avoid_: Billable hours (for the work itself), chargeable time

**Billable default**:
A project's setting for whether new work on it starts as billable work. Changing it never changes existing work.
_Avoid_: Billable flag (for the project setting)

**Revenue**:
Billable work's hours multiplied by its applicable rate.
_Avoid_: Turnover, sales

**Margin**:
Revenue minus the cost of the same work at the employees' cost rates. Margin is unknown, not total, while any of that work has no cost rate.
_Avoid_: Profit

### Hand-off

**Hand-off**:
Creating one invoice draft for one customer from its un-invoiced billable work in a chosen period.
_Avoid_: Export, sync, invoicing run

**Invoice draft**:
A draft invoice Z8 creates in the organization's accounting tool from billable work. Each of its lines records the project, rate, hours and amount it was created with; later rate changes never alter invoiced work.
_Avoid_: Invoice, bill

**Invoiced work**:
Billable work included in an invoice draft that has not been released.
_Avoid_: Billed work, locked work

**Held-back work**:
Billable work a hand-off leaves out because a correction or submission for it is still pending.
_Avoid_: Blocked work, skipped work

**Changed after invoicing**:
The mark on invoiced work whose times, project or billability were corrected after its hand-off. Corrections are never blocked by invoicing; the mark stays until an admin clears it.
_Avoid_: Dirty, out of sync, invoice conflict

**Release**:
Withdrawing an invoice draft in Z8, typically because it was deleted in the accounting tool, so that its work is un-invoiced again.
_Avoid_: Cancel, void, undo hand-off

**Accounting connection**:
An organization's authorized link to its accounting tool, such as Lexware Office or sevdesk. An organization has at most one active accounting connection.
_Avoid_: Accounting integration, invoice connector

**Tax treatment**:
How an invoice draft is taxed, such as domestic standard rate, EU reverse charge or third-country service, together with its rate. The accounting connection has a default; a customer may override it.
_Avoid_: Tax rate (alone), VAT setting

**Timesheet**:
The itemized list of the work behind one hand-off, which Z8 provides for the organization to send alongside the invoice.
_Avoid_: Attachment, work report

**Contact link**:
The association of a Z8 customer with an existing contact in the accounting tool. A customer needs one before its first hand-off; Z8 never creates contacts in the accounting tool.
_Avoid_: Customer mapping, customer sync
