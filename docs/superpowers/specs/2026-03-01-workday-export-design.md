# Workday Payroll Export Design

## Objective

Add Workday export support to Payroll Export so organizations can export attendance and absences via Workday API, in addition to existing DATEV, Lexware, Sage, Personio, and SAP SuccessFactors options.

## Scope

V1 includes:

- Workday API integration (no CSV fallback in V1).
- Attendance and absence export.
- Org-configurable employee matching strategy (`employeeNumber` or `email`).
- OAuth2 client credentials authentication.
- New Workday settings tab and export format selection in the Export tab.
- Reuse of existing retry and sync-status tracking behavior.

V1 excludes:

- Workday CSV formatter.
- New microservice boundary for integrations.
- Connector abstraction for file-based formatters.

## Confirmed Product Decisions

- **Selected approach:** Build a generic HRIS connector adapter layer first, then add Workday on top.
- **Integration mode:** API only in V1.
- **Export scope:** Attendance + absences.
- **Employee matching:** Configurable per org (`employeeNumber` or `email`).
- **Auth:** OAuth2 client credentials.
- **Retry model:** Reuse existing transient retry and sync-record model.
- **UI exposure:** New Workday tab and inclusion in Export format selector.

## Approaches Considered

### A) Native Workday in Existing API Export Path

Add Workday directly to current exporter registry without connector refactor.

Pros:

- Fastest path to ship.
- Lowest immediate code churn.

Cons:

- Missed opportunity to improve long-term connector architecture.

### B) Generic HRIS Connector Adapter Layer, Then Workday (Selected)

Introduce a shared connector contract for API integrations, adapt Personio/SAP API to it, then implement Workday on the same contract.

Pros:

- Better architectural consistency for additional HRIS connectors.
- Clear separation between orchestration and connector-specific behavior.

Cons:

- Larger scope than direct Workday-only addition.
- Requires careful regression validation for existing API integrations.

### C) External Integration Service

Delegate Workday sync to a separate service while Z8 handles UI/orchestration.

Pros:

- Strong isolation of vendor-specific complexity.

Cons:

- Added operational complexity and service boundary overhead for V1.

## Architecture

- Add a connector abstraction for API-based payroll integrations (for example, `PayrollConnector`) with standardized capabilities: config validation, connection test, export execution, sync threshold, and metadata.
- Refactor existing Personio and SAP SuccessFactors API implementations behind this connector contract.
- Keep file-based formatters (DATEV/Lexware/Sage/SF CSV) on existing formatter path for V1.
- Add new `workday_api` connector implementation to the connector registry.
- Update export orchestration to resolve API exports through the connector registry while preserving current job lifecycle and schema usage.
- Update settings page to include a Workday tab and make Export tab target selectable (instead of hardcoded DATEV).
- Preserve strict multi-tenant behavior: all actions, jobs, and secrets are organization-scoped.

## Components

- **Connector core**
  - Shared connector interfaces/types.
  - API connector registry and resolution path.
- **Connector implementations**
  - Personio adapter.
  - SAP SuccessFactors API adapter.
  - New Workday connector:
    - OAuth2 token client.
    - Employee matching strategy handling.
    - Attendance and absence transformers.
    - Batched sync executor.
- **Server actions**
  - Add Workday config/credential/test actions.
  - Extend export start action to receive selected target format.
- **UI**
  - New Workday config tab.
  - Export form target selector with dynamic export button text.
- **Data model**
  - Reuse `payroll_export_format`, `payroll_export_config`, `payroll_export_job`, `payroll_export_sync_record`.
  - Add Workday-specific mapping fields only if required by payload mapping in V1.

## Data Flow

1. Admin configures Workday in Payroll Export settings and stores OAuth credentials via org-scoped vault secrets.
2. Admin runs Test Connection, which authenticates and performs a lightweight Workday API probe.
3. Admin starts export from Export tab, selecting Workday as target plus date range/filters.
4. Server action creates export job with `workday_api` format id and org-scoped filters.
5. Job processor resolves Workday connector via registry, fetches source data/mappings, transforms payloads, and syncs in batches.
6. Per-record status is persisted (`synced`, `failed`, `skipped`) for partial success tracking.
7. Export history shows aggregate results and errors using existing API export UX patterns.

## Error Handling

- Reuse current retry model for transient failures (for example, timeout, 429, 5xx).
- Keep per-record result tracking for partial success and auditability.
- Fail closed on identity matching; unmatched workers are marked skipped with explicit reason.
- Validate required Workday config before live export.
- Log structured diagnostics without leaking credentials or tokens.
- Keep all retries and token usage tenant-isolated.

## Testing Strategy

### Contract Tests

- Verify connector contract behavior across Personio, SAP API, and Workday.

### Unit Tests

- Workday config validation.
- Employee matching (`employeeNumber` vs `email`).
- Attendance/absence payload transformation.
- Retryability classification for Workday error responses.

### Integration Tests

- Export action accepts selected format and no longer hardcodes DATEV.
- Org-scoped Workday config and credentials retrieval.
- End-to-end job processing for `workday_api` with sync record persistence.

### Regression Tests

- Personio/SAP API behavior unchanged after adapter refactor.
- File-based formatters unaffected.

### UI Tests

- Workday tab configuration and connection test flow.
- Export form format selector and target-specific label behavior.

### Security Tests

- No secret leakage in responses/logs.
- Organization boundary checks enforced in all actions and processing paths.

## Success Criteria

- Admin can configure and test Workday connection per organization.
- Admin can export attendance and absences to Workday from existing Export workflow.
- Export results provide partial success visibility with actionable failure details.
- Existing Personio/SAP API exports remain stable after connector abstraction.
