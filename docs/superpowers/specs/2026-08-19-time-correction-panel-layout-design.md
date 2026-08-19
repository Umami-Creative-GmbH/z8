# Time Correction Panel Layout Design

## Goal

Make the time correction action panel compact and consistently aligned, and allow a correction to include the work period's work location and work category. Metadata changes must follow the same approval and transaction semantics as time changes.

## Current Problem

`ActionPanelBody` is a flex child that fills the available panel height. The correction form adds `display: grid` without top-aligning its grid content, so implicit rows stretch across that height and produce large vertical gaps. Date and time fields are also laid out as four independent grid cells, which weakens the relationship between each clock event's date and time.

The correction request currently carries only clock timestamps and a reason. Although work periods already store `workLocationType` and `workCategoryId`, the panel cannot edit them and the correction approval workflow does not carry proposed metadata changes.

## Panel Layout

The body uses a top-aligned, compact vertical layout. It keeps the existing header, timezone note, scrolling behavior, and fixed footer.

The time controls are grouped into two semantic rows:

- Clock in: date and time
- Clock out: date and time, when the period is complete

At panel widths that can support three columns, each row uses a stable label column followed by equal date and time columns. At narrower widths, the row label appears above a two-column date/time control group. Date and time fields retain explicit accessible labels even when compact visual labels are shared or visually hidden.

The remaining controls follow immediately with the standard form gap:

1. Work location
2. Work category, when categories are available
3. Reason or optional note

The reason textarea remains two rows high. There are no spacer elements or distributed vertical alignment. The footer remains fixed at the bottom with Cancel and Submit/Save actions.

## Existing Selectors

The location field uses the established Office, Home, Remote, and Other options and visual treatment from `WorkLocationSelector`.

The category field uses `WorkCategorySelector` and loads only categories available to the authenticated employee. The correction dialog receives the employee ID required by that selector.

Both fields are initialized from the selected work period:

- `workLocationType` uses the period's current value, with the existing application fallback only if historical data has no value.
- `workCategoryId` uses the period's current category or the existing no-category value.

Opening the panel again resets all controls to the current work period values.

## Correction Semantics

Location and category are part of the same correction command as the timestamps and reason. They are not updated through a separate client request.

For a permitted direct same-day edit, the selected metadata is validated and applied in the same database transaction as the time correction.

For an approval-required correction, proposed metadata is persisted in the correction workflow's trusted metadata. The current work period remains unchanged while approval is pending. Approval applies timestamps, work location, and work category atomically; rejection or cancellation applies none of them.

A correction is valid when at least one supported value changes: a timestamp, work location, or work category. Metadata-only corrections therefore remain possible and use the same policy decision as time corrections.

## Validation And Security

All reads and writes remain scoped by `organizationId` and employee ownership.

The server validates `workLocationType` against the existing domain values. A non-null category must belong to the organization, be active and available to the employee according to the existing category access rules. The server does not trust selector options or submitted IDs.

Replay identity includes the proposed metadata so a durable submission token cannot be reused with a different location or category payload. Existing correction replay and conflict behavior remains intact.

## Approval Presentation

Approval details include work location or category changes when their proposed values differ from the current work period. Unchanged metadata does not add noise to the approval display.

## Error Handling

Invalid or inaccessible metadata returns a field-specific validation error without modifying the work period. Transaction failures preserve the existing generic client response and server-side diagnostic cause. Failed, rejected, or cancelled requests leave all original values intact.

## Testing

Component tests cover compact grouping, current-value prefilling, selector submission, reset-on-reopen behavior, narrow-screen structure, and metadata-only submissions.

Server tests cover organization scoping, category access, location validation, direct atomic updates, pending-request immutability, approval application, rejection/cancellation behavior, metadata-aware replay identity, and metadata-only corrections.

Existing timestamp, timezone evidence, idempotency, and approval workflow tests remain green.
