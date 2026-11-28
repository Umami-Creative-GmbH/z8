---
status: accepted
---

# Leave keeps its earning year and earning policy

German law lets statutory leave lapse only once the employer has asked the employee in time to take it and warned that it would lapse (CJEU C-684/16; BAG 9 AZR 423/16), and contractual leave above the minimum follows the same rule unless the parties clearly agreed otherwise (BAG 9 AZR 266/20). A vacation policy's carryover cap and deadline cannot establish either condition (#2057, #2080).

HR therefore designates, once per vacation policy, whether German leave-expiry rules apply to the leave earned under it (`vacation_policy_expiry_classification`). The designation lives outside `vacation_allowance`, so the policy revision trigger never time-slices it: it covers every year of leave earned under the policy. It is final; a database trigger refuses changes. Without a designation the policy is unclassified, and its unused days stay outstanding.

Year-end no longer pools leave. A committed transfer writes one `vacation_earning_year_leave` row per earning year and portion, with the earning policy, the carried and forfeited days and the policy's configured deadline. Carrying the same leave again writes a successor row (`carried_from_id`), so earning year and earning policy survive any number of year-ends and policy changes. The year's own leave is earned under the policy in effect on 31 December.

How a row is treated follows its earning policy's designation, resolved when read:

| Designation | Cap and permission at year-end | Configured deadline |
| --- | --- | --- |
| Unclassified | not applied, all unused days carry | not established |
| German rules | not applied | not established (notice- and illness-based expiry follow in #2084/#2085) |
| German rules, extra days with separate terms | applied to the extra days only | established for the extra days only |
| Policy terms | applied | established |

Separate terms need HR's explicit record and its basis; a cap or deadline setting alone never establishes them. The split uses the year's statutory minimum ÷ reference allowance, so separately termed extra days are charged before statutory days of the same year.

Vacation is charged day by day in one order (Absences CONTEXT): earliest established deadline first, then undated leave, older leave year first; a day after a deadline never uses that leave. Readers, year-end and the expiry job share this allocation (`earning-year-leave.ts`), so the job debits only the unused days of rows whose deadline is established, once per row (`expired_at`), and leaves protected rows untouched.

## Consequences

- This amends ADR 0005: the committed amount and configured deadline stay frozen, but a frozen deadline applies only where the earning policy's designation establishes it. Existing transfers became one earning-year row of their source year (migration 0346); their unclassified policies now keep the days outstanding. Already expired transfers keep their debit; restoring them is the historical loss review (#2087).
- Designating a policy after year-end applies its rules to leave still outstanding: a policy-terms designation makes the frozen deadline apply, but never re-applies the year-end cap to a committed amount.
- Legacy carryover without a transfer keeps its company-default treatment only once that policy is designated for its own terms; otherwise it stays outstanding without a deadline.
- A later manual carryover amount stays final. Readers treat it as one item with the strongest protection of the transfer's rows, and the expiry job never debits it.
