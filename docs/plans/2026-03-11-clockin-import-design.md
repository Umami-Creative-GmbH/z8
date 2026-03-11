# Clockin Import Design

## Goal

Add a Clockin importer to the webapp while unifying the existing Clockodo importer and the new Clockin flow under one shared settings area.

The resulting UX should expose a single admin-only import section with tabs for `Clockodo` and `Clockin`, preserve the current Clockodo migration flow, and introduce a Clockin flow that imports time data plus absence and schedule-related data where the Clockin API supports it clearly.

## Current State

- The webapp currently exposes a dedicated settings entry at `apps/webapp/src/components/settings/settings-config.ts` for `/settings/clockodo-import`.
- The page at `apps/webapp/src/app/[locale]/(app)/settings/clockodo-import/page.tsx` performs the org/admin gate and renders a provider-specific Clockodo wizard.
- The Clockodo wizard at `apps/webapp/src/components/settings/clockodo-import/clockodo-import-wizard.tsx` already provides a multi-step import flow with preview, employee mapping, selection, import execution, and completion states.
- Server actions for Clockodo already enforce organization scoping and admin access in `apps/webapp/src/app/[locale]/(app)/settings/clockodo-import/actions.ts`.

## Chosen Approach

Create a shared import hub in settings with provider tabs, then keep provider-specific import logic isolated behind that shared shell.

This approach gives the product a unified import UX without forcing Clockodo and Clockin into a premature common data abstraction. It also minimizes regression risk for the existing Clockodo importer by allowing it to be embedded into the new section with as few behavior changes as possible.

## Alternatives Considered

### 1. Generic importer engine with provider adapters

Build one abstract importer framework first and implement both Clockodo and Clockin as adapters.

This would be attractive if more providers were imminent, but it adds upfront architecture cost and creates pressure to normalize provider differences before there is enough evidence that a generic model will hold.

### 2. UI-only merge with fully separate implementations

Create one page with tabs but otherwise keep two largely separate page-level implementations.

This is the fastest path, but it would likely duplicate page framing, state handling, and error presentation while making future consistency harder.

## Proposed Architecture

### Settings entry and route

- Replace the single `Clockodo Import` settings entry with a broader admin-only entry such as `Import Data` in the existing data group.
- Route that entry to a new shared import page, for example `/settings/import`.
- The shared page owns:
  - title and descriptive copy
  - admin/org access gate
  - provider tab navigation
  - any shared informational or warning UI

### Provider tabs

- `Clockodo` tab:
  - reuses the existing Clockodo wizard inside the shared page shell
  - keeps current provider-specific actions, data types, and orchestration intact unless small adaptations are needed for embedding
- `Clockin` tab:
  - renders a new Clockin wizard that follows the same high-level product rhythm as Clockodo
  - keeps its own API client, server actions, validation, mapping, and import orchestration

### Shared shell responsibilities

The shared shell should stay intentionally thin. It should not attempt to own provider-specific field schemas, result structures, or import semantics.

Its responsibility is limited to consistent navigation and framing, while each provider owns:

- credential requirements
- preview data loading
- employee matching
- entity-specific selection rules
- import execution and result reporting

## Clockin Flow

Clockin should follow a preview-first migration flow similar to Clockodo so admins understand scope before writes begin.

Recommended wizard stages:

1. `Connect`
   - collect and validate Clockin credentials or access details required by the API
   - verify admin access and organization context before any downstream work
2. `Preview`
   - fetch counts and high-level metadata for supported entities
   - show what can be imported and any relevant caveats
3. `Employee Mapping`
   - match Clockin users to Z8 employees
   - support auto-match where reliable, with manual correction before import
4. `Selection / Review`
   - confirm import scope for supported Clockin entities
   - emphasize duplicate handling and any entities that will be skipped
5. `Import`
   - execute import in provider-specific phases
   - surface progress and current phase clearly
6. `Complete`
   - show imported, skipped, and failed counts with reasons

## Data Scope

The first Clockin version should target:

- time data
- absences
- schedule-related data if the Clockin customer API exposes it in a way that maps safely into existing Z8 concepts

The implementation should stay conservative where the upstream API shape is ambiguous. If a Clockin entity cannot be mapped confidently into an existing Z8 model, the importer should exclude it from the first release rather than guessing.

## Data Flow And Safety Rules

### Organization scoping

Every query, mapping lookup, preview, and write must be constrained by `organizationId`.

This preserves the project-wide SaaS rule that all imported records and employee associations are organization-scoped and prevents cross-tenant data access through tampered requests.

### Provider-specific mappings

Clockodo and Clockin should not share one generic remote-user mapping model unless both providers eventually require the exact same shape and lifecycle.

For now, any persisted mapping for Clockin should be provider-specific so the system can evolve each importer independently without schema coupling.

### Duplicate handling

Clockin imports should default to `skip duplicates`.

If a matching Z8 record already exists for the same employee and relevant date or time window, the importer should:

- leave the existing Z8 record unchanged
- mark the incoming Clockin record as skipped
- include the skip reason in the final result summary

This avoids destructive updates to historical records and makes reruns safer.

## UI Structure

The new import page should feel like a deliberate hub rather than two unrelated tools placed side by side.

Recommended structure:

- page header with one clear explanation of the import area
- provider tabs immediately below the header
- active tab content shown in a single consistent content region
- provider-specific warning and credential guidance near the top of each tab
- import results displayed within the active tab so context remains clear

Tab switching should not leak state across providers. Credentials, preview data, mapping selections, and import results must remain isolated per tab.

## Error Handling

### Validation and connection errors

- validate credentials before preview or import execution
- return provider-specific error messages for authentication failure, permission issues, rate limiting, and malformed upstream responses where distinguishable
- keep failure messages actionable for admins

### Import execution errors

- report results by entity type or phase where possible
- distinguish clearly between `imported`, `skipped`, and `failed`
- call out duplicate skips explicitly rather than burying them inside generic counts
- if a full all-or-nothing transaction is not realistic, favor restartable phased imports with transparent partial-success reporting

### Access control errors

- preserve the existing admin-only access pattern used by Clockodo
- reject requests early when the authenticated user is not an owner or admin in the active organization

## Testing And Verification

At minimum, verify the new import hub and Clockin flow with:

- settings navigation coverage for the new shared import entry
- admin and organization authorization checks for the new route and all Clockin actions
- provider tab rendering and tab-state isolation
- regression verification that the Clockodo flow still works inside the new import section
- Clockin credential validation behavior
- employee mapping behavior, including auto-match and manual correction paths
- duplicate-skip behavior for existing Z8 records
- result summaries for successful, skipped, failed, and mixed import runs

Recommended project-level checks after implementation:

- `pnpm test`
- `pnpm build`

## Non-Goals

- rewriting the existing Clockodo import domain model into a generic cross-provider importer framework
- introducing destructive upsert behavior for Clockin in the first release
- importing Clockin entities whose API semantics do not map clearly to existing Z8 concepts
- expanding the settings IA beyond the new shared import section

## Open Questions For Implementation Planning

- Which exact Clockin customer API endpoints correspond to time entries, absences, and schedules in a way that maps cleanly to existing Z8 tables?
- Which Clockin identifiers are stable enough to use for duplicate detection and optional persisted mapping?
- Whether schedule-related imports should create work policies, planned shifts, or a narrower intermediate representation based on the actual API payloads available

These are implementation-planning questions rather than product-design blockers. The approved product direction remains a shared import hub with provider-specific internals and a conservative, skip-duplicates-first Clockin importer.
