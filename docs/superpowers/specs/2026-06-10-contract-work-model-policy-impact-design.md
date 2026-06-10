# Contract Work Model Policy Impact Design

## Goal

Make the employee `Contract & Work Model` timeline materially affect expected-hours and work-balance calculations instead of acting only as display history.

## Design

Confirmed `employee_employment_history` rows become the employee-specific contract override timeline. For any date range, Z8 resolves the effective contract rows by `organizationId`, `employeeId`, `reviewState = confirmed`, `validFrom`, and `validUntil`.

For fixed contracts, the row's `workPolicyId` selects the employee-specific work policy for that contract period. If it is missing, Z8 falls back to the current employee/team/organization policy resolver. The row's `weeklyContractMinutes` overrides the selected policy's simple weekly schedule total for that employee only.

For hourly contracts, expected hours continue to come from published shifts. Hourly contract rows still provide timeline coverage and rate context.

`workModel` and probation dates remain metadata in this slice. They must not silently change presence or compliance rules until product semantics are explicit.

## Data Flow

1. The employee detail card loads active work policies and lets org admins choose a policy per contract row, or leave it empty to inherit.
2. Contract rows are stored in `employee_employment_history.workPolicyId`.
3. Daily requirement generation loads confirmed overlapping contract rows and builds requirements by contract slice.
4. Work-balance recalculation is marked dirty from changed contract effective dates so expected-hours changes are picked up.

## Constraints

- All reads and writes remain organization-scoped.
- Date math uses Luxon and employee/business dates, not viewer timezone meaning.
- `work_policy_assignment` remains the global/team/manual assignment layer; contract history is the employee-specific override layer.
- Existing absence and holiday adjustments continue to apply after base requirements are built.

## Verification

- Unit tests cover fixed contract rows overriding weekly policy minutes.
- Unit tests cover hourly contract rows using published shifts.
- Action tests cover work-balance dirty marking on create/confirm/cancel.
- Component or hook tests cover policy selection submission.
