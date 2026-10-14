# Employment terms are the only wage history

An hourly employee's wage is part of their confirmed employment terms. The wage in force on a day is the wage in the confirmed hourly terms for that day, and a wage change is new terms from a calendar date. Earnings, cost-rate suggestions and exports read the wage from the terms, and every writer of a wage writes terms. The separate rate history (`employee_rate_history`) is merged into the terms once and then retired; the denormalized `employee.current_hourly_rate` is dropped.

Before this, the wage lived in three places that drifted apart: the rate history fed the employee report, the terms timeline fed `employee.current_hourly_rate`, and neither wrote the other (#814). We rejected keeping the rate history as a projection that every terms write keeps in sync: it leaves two stores, and every future writer must remember the projection. We also rejected making the rate history canonical: a rate there has no contract type, review state or employment period, so it can contradict the terms it is paid under, and it would contradict the contract work model design, which makes the terms the source of truth for contract state.

## Consequences

- Changing a wage is an org-admin action, like every other change to employment terms. Managers lose the wage edit they had through the rate history card.
- A wage changes at local midnight of its date, measured with each work period's captured offsets in the same way as surcharge boundaries; a work period across that midnight is paid at both wages.
- Rate history rows are merged into the terms by "latest written wins", with conflicts and skipped rows reported, and the old table is dropped only after the merge is verified in production.
