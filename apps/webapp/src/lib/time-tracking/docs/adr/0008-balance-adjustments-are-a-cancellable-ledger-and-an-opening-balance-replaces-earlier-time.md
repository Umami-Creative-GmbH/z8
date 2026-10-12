---
status: accepted
---

# Balance adjustments are a cancellable ledger, and an opening balance replaces earlier time

The work balance is a projection: completed work minus required time, stored per month and rebuilt from scratch whenever its inputs change. A full rebuild deletes the stored rows. We decided that opening balances and overtime payouts are kept as balance adjustments, in their own insert-only records that the projection adds in, and are never written into the stored balance. A mistaken adjustment is cancelled, never edited or deleted. The cancellation records who cancelled it and why, and the adjustment stays visible as cancelled. We also decided that an opening balance replaces the work balance up to and including its day instead of adding to it. Work and required time before then stay on record but no longer count (#804).

## Considered Options

- **Write payouts into the stored balance.** Rejected: the next full rebuild erases them, and nothing would record who settled what.
- **Correct a payout with a negative counter-payout.** Rejected: two rows that cancel each other out are harder to read than one cancelled payout, and payroll exports would have to net them out.
- **Add the opening balance on top of the computed balance.** Rejected: the balance counts from the employee's start date, so an employee who joined years before their time was kept in Z8 already carries years of unworked required time. Imported work for the days the opening balance covers would also count twice. Changing start dates instead would disturb vacation and other features that rely on them.
- **Free-form manual corrections.** Rejected: they would invite fixing the balance instead of the work records behind it.

## Consequences

- The projection must read the opening balance in effect, start counting the day after it, and subtract every uncancelled overtime payout from the end of its day. Every place that shows a work balance reads the same projection, including the yearly team balance.
- Cancelling an opening balance brings back the full calculation from the employee's start.
- A payout on or before the day of the opening balance in effect would no longer count. Recording either is therefore refused when it would make an uncancelled payout stop counting, and nothing quietly drops out of the balance.
- Balance adjustments are never dated in the future.
- Balance adjustments touch the month of their day, so a closed month freezes them like work and absences (ADR-0004).
