---
status: accepted
---

# Rates resolve at read and freeze at hand-off

Billable rates and cost rates are effective-dated, and a piece of work's applicable rate is looked up whenever the work is read, using the rate in effect at the instant the work started. Rates are frozen only when the work goes into an invoice draft: each draft line records the rate, hours and amount it was created with. This deliberately departs from Time Tracking ADR 0003, which captures work policies as evidence with the work. A rate change an admin backdates should reprice work that has not been invoiced, and invoiced work must never change because of one (#768).

## Considered Options

- **Capture the rate onto the work when it is recorded.** Rejected: backdated price changes, which are common when a contract is signed after work starts, would leave un-invoiced work at the old price until someone repriced it by hand.

## Consequences

- Writers of billable rates, cost rates and a project's billable default do not take Time Tracking's organization configuration guard. No reader decides anything about work from rates under that guard. A billable default only affects new work, and work recorded during a concurrent change gets either the old default or the new one, both of which are valid.
- Reports must say which rates they used. Running the same un-invoiced report before and after a rate edit gives different revenue, and that is intended.
