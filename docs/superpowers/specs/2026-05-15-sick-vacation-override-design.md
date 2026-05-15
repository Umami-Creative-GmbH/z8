# Sick Vacation Override Design

## Goal

Allow full-day sickness to override planned vacation so affected vacation days become available again. Sick absences also need a structured detail value such as child sick, with certificate, or without certificate.

## Scope

In scope:

- Add structured sick details to absence entries.
- Require sick details for sick absences in employee and manager/admin absence flows.
- Allow full-day sick absences to overlap vacation absences.
- Adjust overlapping vacation records so the sick-covered vacation days are freed.
- Keep employee-requested and manager-recorded absence behavior consistent.

Out of scope for the first version:

- Half-day sick overrides.
- Configurable organization-specific sick detail values.
- Retrospective migration of existing sick absence notes into sick details.
- Payroll export mapping changes beyond carrying the stored sick detail where existing absence data is already exported.

## Confirmed Decisions

- Sick details are a separate field on the absence entry, not separate absence categories.
- The vacation record should be adjusted rather than left unchanged with balance-only exclusions.
- The first version handles full-day sick absences only.
- Half-day sick overlaps keep the existing conflict behavior.

## Approaches Considered

### A) Adjust vacation records and add a sick detail field (Selected)

When a full-day sick absence overlaps vacation, shorten, split, or remove the affected vacation entry and store a required sick detail on the sick absence.

Pros:

- Vacation balance becomes correct through existing `countsAgainstVacation` calculations.
- Calendars, tables, and reports no longer show vacation on sick days.
- Sick details remain consistent across organizations because they are controlled values.

Cons:

- Requires careful transactional updates to absence entries and canonical time records.

### B) Leave vacation records unchanged and exclude overlaps during balance calculation

Keep the original vacation entry and teach vacation balance/reporting to ignore days that are covered by sickness.

Pros:

- Smaller persistence change.

Cons:

- Every calendar, report, export, and balance query needs to understand the override rule.
- Users would still see vacation and sickness on the same day unless all displays are updated.

### C) Use multiple sick absence categories

Represent child sick, with certificate, and without certificate as separate configurable sick categories.

Pros:

- Reuses existing absence category management.

Cons:

- Mixes legal/medical detail into organization category configuration.
- Makes reporting inconsistent if organizations rename, remove, or duplicate categories.
- Does not match the desired separate detail field model.

## Data Model

Add a nullable `sickDetail` field to `absence_entry`. It is required only when the selected category has `type = "sick"` and must be null for non-sick absences.

Initial controlled values:

- `child_sick`
- `with_certificate`
- `without_certificate`
- `other`

The field should be represented by a database enum or equivalent constrained type to avoid free-form values. Existing absence categories remain organization-scoped and continue to control approval and vacation-balance behavior.

## Override Behavior

When a full-day sick absence is submitted or manager-recorded, the server checks for overlapping pending or approved absences for the same employee in the active organization.

Rules:

- Only `type = "sick"` can override vacation.
- Only full-day sick absences participate in the first version.
- Only vacation-like categories where `countsAgainstVacation = true` are adjusted.
- Pending and approved vacation absences can be adjusted.
- Overlaps with non-vacation absences keep the existing conflict behavior.
- Half-day sick overlaps keep the existing conflict behavior.

Vacation adjustment outcomes:

- Sick fully covers vacation: cancel the vacation using the app's existing cancellation behavior, which deletes the vacation `absence_entry`, removes its linked canonical absence record, and deletes any related approval request.
- Sick overlaps the vacation start: move the vacation start to the first non-sick day.
- Sick overlaps the vacation end: move the vacation end to the last non-sick day.
- Sick falls inside vacation: split the vacation into two vacation records around the sick period.

All changes must happen in one transaction protected by the existing employee-level absence advisory lock pattern. The sick absence insert and vacation adjustments must either all persist or all roll back.

## Canonical Records And Sync

The app stores canonical absence time records alongside `absence_entry`. Vacation adjustments must keep those records consistent:

- Shortened vacation entries update their linked canonical absence record.
- Split vacation entries create a new `absence_entry` and canonical absence record for the second segment.
- Fully covered vacation entries remove their linked canonical absence record and any related approval request before deleting the vacation `absence_entry`.
- Calendar sync jobs are queued for the new sick absence and every adjusted vacation entry.

The adjustment helper should return a structured summary of created, updated, and removed/cancelled vacation entries so callers can trigger downstream sync and notifications without duplicating logic.

## UI And Validation

The employee request dialog and manager/admin record absence dialog show a required `Sick detail` select when the selected category has `type = "sick"`.

Options:

- Child sick
- With certificate
- Without certificate
- Other

Client validation provides immediate feedback, but the server is authoritative:

- Sick categories require `sickDetail`.
- Non-sick categories reject submitted `sickDetail` instead of silently storing or clearing it.
- Full-day sick overlaps with vacation are accepted and adjusted server-side.
- Sick overlaps with non-vacation absences return the existing conflict error.

Absence tables, approval details, and manager absence views should display the sick detail for sick absences. Vacation balance cards need no special UI because adjusted vacation records make the existing calculations correct.

## Data Flow

Employee request flow:

1. The client submits category, date range, periods, notes, and optional sick detail.
2. The server resolves the current employee and active organization.
3. The server loads the category scoped by organization.
4. The server validates date range, sick detail, and full-day override eligibility.
5. The server locks the employee absence stream.
6. The server adjusts overlapping vacation records when the new absence is eligible sick leave.
7. The server inserts the sick absence and creates its canonical record.
8. Existing approval behavior runs based on the sick category's `requiresApproval` setting.
9. Calendar sync jobs are queued for all changed records.

Manager/admin record flow:

1. The client submits target employee, category, date range, periods, notes, and optional sick detail.
2. The server resolves the acting employee and active organization.
3. The server re-checks target employee access and organization scope.
4. The same shared sick-detail validation and vacation-adjustment helper runs.
5. The sick absence is inserted as approved with `approvedBy` and `approvedAt` set to the actor.
6. Canonical records, calendar sync, and employee notification follow existing manager-recorded absence behavior.

## Permissions And Multi-Tenancy

Every read and write must be scoped by `organizationId`.

The override helper must require the caller to pass the active organization and target employee. It must never adjust absence entries that belong to another organization or another employee. Manager/admin entry continues to enforce that managers can only act on managed employees and admins can act only within the active organization.

## Error Handling

Expected errors:

- Missing sick detail for a sick category.
- Sick detail supplied for a non-sick category.
- Half-day sick overlap with an existing absence.
- Sick overlap with a non-vacation absence.
- Invalid or inactive absence category.
- Cross-organization or inaccessible target employee.
- Failure to update canonical records.

Vacation adjustment and sick absence creation must be transactional. If canonical update or split persistence fails, the sick absence should not be created and the original vacation records should remain unchanged.

## Testing Strategy

Server tests should cover the shared override helper first.

Required cases:

- Full-day sick overlapping vacation start shortens the vacation.
- Full-day sick overlapping vacation end shortens the vacation.
- Full-day sick inside vacation splits it into two vacation entries.
- Full-day sick fully covering vacation removes or cancels the vacation.
- Sick absence requires `sickDetail`.
- Non-sick absence rejects `sickDetail`.
- Half-day sick overlap still conflicts.
- Sick overlap with non-vacation absence still conflicts.
- Employee request and manager/admin record flows use the same override behavior.
- All overlap queries and updates are scoped by `organizationId` and employee.

UI tests should cover conditional rendering and validation of the sick detail select in both absence forms.

## Risks And Mitigations

- Risk: split/shorten logic corrupts vacation records.
  Mitigation: isolate the adjustment algorithm in a shared helper with table-driven tests for each overlap shape.
- Risk: canonical records drift from `absence_entry` after adjustment.
  Mitigation: keep adjustment and canonical sync in the same transaction where possible and verify both records in tests.
- Risk: cross-tenant updates through overlap queries.
  Mitigation: require `organizationId` in every adjustment query and mutation.
- Risk: half-day behavior is expected immediately.
  Mitigation: reject half-day overlaps explicitly with a clear error until half-day splitting is designed.

## Success Criteria

- Users can record full-day sickness during planned vacation.
- The affected vacation days are freed by adjusting the vacation absence record.
- Sick absences store a required structured detail.
- Existing vacation balance calculations reflect the freed days without special overlap math.
- Employee and manager/admin flows behave consistently.
- Organization scoping and manager/admin permissions remain enforced.
