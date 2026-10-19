---
status: accepted
---

# Vacation allowances use a five-day reference week

Absence days count only the days an employee works, so the policy allowance and statutory-minimum setting must use the same unit. Both are reference amounts for a five-day working week. Convert each by the employee's effective scheduled working days divided by five: 30 reference days become 24 for a four-day week and 36 for a six-day week. Scheduled days count equally regardless of hours, and public holidays do not reduce the weekly count. A custom allowance is final and never converted.

Combine effective vacation-policy and work-schedule periods using the same monthly weighting as policy assignment resolution (#989). Each full calendar month contributes 1/12; within a month, weight by the calendar days covered by each combined period, using that month's actual length. Sum at full precision and round the combined allowance once to two decimal places. For a full-year employee on a 30-day reference policy, five days through 30 June and four from 1 July gives 30 × 6/12 + 24 × 6/12 = 27 days. Do not apply the final schedule to earlier periods or round conversion results up to half days. Start/exit-year proration keeps its separate rounding rules.

Convert the allowance and statutory-minimum annual rates before applying employment proration. Each employment stint's rate averages its combined policy/schedule periods over the dates employed in that stint, normalizing the same monthly weights within those dates; it is not an additional reduction for days not employed. Keep existing employment-month and waiting-period clocks, employment-proration rounding and separate rehire calculations. Sum the stint results, capped at the converted full-year rate averaged across all employed dates with the same normalized monthly weights.

## Consequences

- Resolve the work policy effective in each period, using the same schedule interpretation as absence counting (ADR 0001). No schedule means Monday to Friday. An explicitly configured schedule with zero working days is a configuration error to show for review, and automated vacation postings are skipped until it is corrected.
- Apply conversion to 2026 and later. Earlier years, stored carryover and already-posted accrual entries retain their values. Corrections to posted accrual entries require an explicit reviewed action.
- Newly generated monthly/biweekly accrual entries use the schedule effective in the accrual period. Existing posts are not rewritten automatically.
- Admins see whose allowance decreases and who becomes overdrawn. Vacation already taken is never automatically reclaimed. Approved and pending absence records remain unchanged; existing submission/approval checks continue to apply.

These decisions were confirmed by the maintainer during triage of #990 on 17 October 2026. Application implementation is separate from this decision record.
