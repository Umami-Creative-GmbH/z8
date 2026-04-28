# Certification & Qualification Tracking Design

## Purpose

Extend Z8's existing skills infrastructure into a fuller certification and qualification tracking feature. Organizations need to track required licenses, safety training, medical checks, role qualifications, evidence files, and expiry dates per employee. Scheduling should warn or block when a person is assigned to work they are not qualified to perform.

This design builds on the current `skill`, `employeeSkill`, subarea/template requirement, and shift validation system. User-facing language should move toward "qualifications" where the workflow is compliance-oriented, while internal table names can remain unchanged unless a targeted rename is justified later.

## Goals

- Let organization admins manage qualification types in an organization-scoped catalog.
- Let admins and managers assign, renew, and review employee qualifications within their permitted employee scope.
- Let employees view their own qualifications and submit renewal evidence for review.
- Store evidence files in object storage with metadata in Postgres.
- Support per-qualification expiry warning windows instead of a fixed 30-day threshold.
- Let scheduling requirements decide whether missing or expired qualifications are warnings with override or hard blockers.
- Preserve an audit trail for scheduling overrides and renewal review decisions.

## Non-Goals

- Do not create a parallel certification domain that duplicates the existing skills system.
- Do not allow employee uploads to immediately update active qualification records.
- Do not implement automated notifications or renewal task reminders in the first slice.
- Do not use environment variables for tenant-specific qualification rules. Organization-specific settings belong in the database.

## Existing Context

The webapp already has a `skill` schema file with organization-level skill catalog records, employee skill assignments, subarea requirements, shift template requirements, and scheduling override audit records. The settings area already includes a skill catalog page and an employee detail card for "Skills & Qualifications." Shift creation/update logic already checks assigned employee skills against subarea and template requirements and can return warnings for missing or expired skills.

The design should therefore extend these boundaries instead of replacing them.

## Architecture

The feature has five focused parts:

- `Qualification catalog`: organization-scoped qualification definitions, categories, expiry requirements, and default warning windows.
- `Employee qualification`: the current qualification state for a specific employee, including issue/expiry metadata and accepted evidence.
- `Qualification evidence`: metadata for uploaded files, with file bytes stored in object storage such as S3 or RustFS.
- `Renewal request`: employee-submitted renewal evidence that awaits manager/admin review.
- `Scheduling guard`: reusable validation used by scheduling flows before assigning or publishing shifts.

All data access must be organization-scoped. Employee-facing reads must only expose the current employee's qualification records and evidence metadata. Manager/admin reads and writes must reuse the existing settings employee access checks so managers can only manage employees in their allowed scope.

## Data Model

Extend existing tables:

- `skill`: keep as the internal qualification type table. Add `expiryWarningDays` so each qualification type can define when "expiring soon" starts. Existing `requiresExpiry` remains the source of whether an expiry date is mandatory.
- `employeeSkill`: keep as the employee qualification assignment table. Add structured fields for `issuedAt`, `issuer`, `certificateNumber`, `status`, `renewedAt`, and `renewedBy`. The current `expiresAt` and `notes` fields remain valid.
- `subareaSkillRequirement` and `shiftTemplateSkillRequirement`: add an enforcement mode such as `warning` or `blocking`. Keep `isRequired` to distinguish required vs preferred qualification matching.
- `skillRequirementOverride`: keep as the scheduling override audit record. Expand only if needed to capture the requirement context used by warning-mode overrides.

Add new tables:

- `qualificationEvidence`: stores `id`, `organizationId`, `employeeSkillId`, `uploadedBy`, `fileKey`, `fileName`, `mimeType`, `fileSize`, optional checksum, and timestamps.
- `qualificationRenewalRequest`: stores `id`, `organizationId`, `employeeId`, `employeeSkillId`, requested issue/expiry metadata, submitted evidence references, status, reviewer, reviewedAt, review notes, and timestamps.

File bytes are stored in object storage. Postgres stores metadata and object keys only. Download/read actions must verify organization and employee access before returning signed URLs or file streams.

Date calculations in application and UI logic should use Luxon. Drizzle timestamp/date columns can remain the persistence representation, but business logic should avoid native `Date` arithmetic where possible.

## Permissions

- Organization admins can create, edit, deactivate, and configure qualification types.
- Managers can view the catalog but cannot change catalog definitions.
- Admins and managers can assign qualifications to employees they are authorized to manage.
- Admins and managers can renew employee qualifications directly when they have reviewed evidence out of band.
- Employees can view their own qualification status, expiry dates, and evidence metadata.
- Employees can submit renewal evidence, but submissions create review requests and do not mutate the active qualification immediately.
- Managers/admins can approve or reject renewal requests for employees they are authorized to manage.

## Workflows

### Catalog Management

Admins define qualification types with name, category, description, whether expiry is required, and the qualification-specific warning window in days. Deactivation should prevent new assignments while preserving historical employee records and existing audit trails.

### Employee Qualification Management

Admins and managers assign qualifications from the catalog to an employee. For qualification types requiring expiry, assignment and renewal must include an expiry date. Optional structured metadata includes issue date, issuer, certificate number, notes, and accepted evidence files.

### Employee Renewal Submission

Employees can open their own qualifications, upload renewal evidence, and provide requested renewal metadata. The submission creates a pending renewal request. The current qualification remains unchanged while the request is pending.

### Renewal Review

Managers/admins review pending requests from the employee profile and from a compact review queue. Approval updates the current employee qualification metadata, attaches accepted evidence, records reviewer and review time, and marks the request approved. Rejection records the reviewer, review time, and rejection reason while leaving the current qualification unchanged.

### Scheduling Validation

Shift assignment validation checks requirements from the assigned subarea and shift template. It evaluates missing qualifications, expired qualifications, and qualifications inside their warning window. Required missing or expired qualifications use the requirement's enforcement mode:

- `warning`: allow assignment only when the manager provides an override reason, and create an audit record.
- `blocking`: prevent assignment until the employee qualification is updated.

Soon-expiring qualifications should warn by default. They should only block if the requirement is explicitly configured to treat warning-window expiry as blocking.

Preferred qualification gaps should be reported as informational warnings and should not block scheduling.

## UI

### Settings Qualification Catalog

The existing skills settings page should use qualification-oriented copy where appropriate. It should expose expiry requirement and warning-window configuration. Requirement configuration UI for subareas/templates should expose warning vs blocking behavior.

### Employee Detail Page

The current "Skills & Qualifications" card should become a clearer qualifications card with groups for valid, expiring soon, expired, and pending renewal. Admins/managers can assign, renew, remove, and inspect accepted evidence according to their permissions.

### Employee Self-Service

Employees should get a "My Qualifications" view or section that lists current qualification status, expiry dates, and evidence metadata. They can submit renewal evidence for review from this view.

### Renewal Review Queue

Managers/admins should have a lightweight list of pending renewal submissions with employee, qualification, expiry status, submitted evidence, and approve/reject actions.

### Scheduling

Scheduling assignment UI should show qualification issues before saving or publishing shifts. Warning-mode violations require an override reason. Blocking-mode violations disable the assignment path and explain what qualification must be updated.

## Error Handling

- Missing object storage configuration should fail uploads clearly.
- Uploads should reject unsupported MIME types and oversized files before storing bytes.
- Permission failures must not reveal file names, evidence records, or qualification records from another organization.
- Review actions must handle stale requests, already-reviewed requests, missing files, inactive qualification types, and deleted employee qualification records.
- Scheduling validation must distinguish missing, expired, expiring soon, preferred, warning-mode, and blocking-mode results so the UI can explain decisions precisely.

## Testing

- Schema/service tests for organization scoping, expiry warning windows, renewal approval/rejection, and evidence metadata creation.
- Permission tests for admin, manager, and employee access boundaries.
- Scheduling validation tests for warning vs blocking requirements, expired qualifications, soon-expiring qualifications, preferred requirements, and override audit creation.
- UI tests for employee qualification display, renewal submission, review decisions, and scheduling warning/block states.
- Upload tests for MIME type, file size, metadata persistence, and object-storage adapter behavior with mocked storage.

## Implementation Notes

- Keep changes incremental and avoid unrelated refactors.
- Reuse existing settings employee access utilities where possible.
- Reuse existing query keys and cache tag patterns for skill/employee skill data, adding qualification-specific tags only where current tags are insufficient.
- Do not edit `src/db/auth-schema.ts`; it is generated.
- Any required system-level storage credentials are environment/Phase configuration and cannot be accessed by agents. Implementation should be able to use an existing storage adapter or include a skipped-task notice if live storage verification requires unavailable secrets.
