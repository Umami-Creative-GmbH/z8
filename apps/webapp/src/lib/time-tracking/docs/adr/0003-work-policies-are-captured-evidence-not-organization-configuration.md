---
status: accepted
---

# Work policies are captured evidence, not organization configuration

The organization configuration guard exists so that a writer of configuration can rely on one fact: once it commits, no work is still being decided under the old configuration. Holidays, change policies, eligibility, authorization, timezone and billing need that, because manual preparation and routing decide from them. Work policies (their regulations, break rules and assignments) and surcharge models do not. Manual preparation never reads them. The readers that do, the policy clock-out break snapshot and the automatic break adjustment, capture the policy in effect when the work ended, record it as evidence, and lock the rows they read. Nothing re-evaluates past work when a policy changes, so a policy written just before such a read and one written just after lead to the same outcome. We decided that work-policy and surcharge writers do not take the organization configuration guard (#494).

## Considered Options

- **Guard every work-policy writer exclusively.** Rejected: it would serialize policy settings, onboarding, lifecycle commands and departures against every work transaction in the organization, and buy no guarantee, because no reader decides from the policy under that guard.

## Consequences

- A departure's work transaction keeps `organization: "none"`, even though it deactivates the employee's work policy assignments.
- A new team-level or organization-level assignment is not blocked by the row locks of a concurrent break snapshot. The snapshot applies the policy it saw and records it; this is accepted.
- The clock-out compliance check also reads the policy assigned as of the work's end, without locking it, and records violations that are never re-evaluated (#548). It decides nothing about the work itself, so it does not need the guard either.
- If a reader ever starts deciding from work policies in a way that must not interleave with a policy change (for example a manual rejection or an approval route based on the schedule), revisit this decision and move work policies into organization configuration.
