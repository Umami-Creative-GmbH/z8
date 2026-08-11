# TanStack Table v9 Migration Design

## Goal

Upgrade the webapp to `@tanstack/react-table` v9 and migrate every table to the native v9 API without using the deprecated legacy entrypoint or retaining a custom v8 compatibility wrapper.

## Scope

The migration covers every runtime and type-only `@tanstack/react-table` use under `apps/webapp/src`, including:

- The shared server/client `DataTable` and its pagination, sorting-header, and selection helpers.
- The standalone draggable `DataTable`.
- The license table.
- The employee directory table.
- The team members table.
- All column-definition modules, tests, and query-state types affected by v9's feature-first generics.
- The dependency declaration and pnpm lockfile.

The migration does not redesign table UI, alter server query contracts, or add unrelated table features.

## Architecture

Each table implementation will define a static, focused `tableFeatures()` object outside its React component. Feature objects will register only the state APIs and client row models used by that table. This preserves v9 feature-level tree-shaking and keeps each table's feature type explicit.

Tables using automatic sorting or filtering will also register the individual built-in `sortFn_*` and `filterFn_*` functions that automatic resolution can select. The migration will not import the deprecated full function registries. Generic shared tables will register the built-ins needed for string, numeric, date, array, and object values; tables with known value types will use narrower registries.

The shared `DataTable` will export its feature type for column definitions and helper components. Standalone tables will keep their feature object and feature type local unless another module needs the type. This avoids coupling unrelated tables to a single feature superset.

The custom `useCompilerSafeReactTable` wrapper will be removed. All table instances will use v9's `useTable`, which already constructs a stable table instance, updates options during render, integrates TanStack Store, and subscribes React to selected state.

## Feature Sets

### Shared DataTable

Register:

- `columnFilteringFeature`
- `columnVisibilityFeature`
- `rowPaginationFeature`
- `rowSelectionFeature`
- `rowSortingFeature`
- `createFilteredRowModel()`
- `createPaginatedRowModel()`
- `createSortedRowModel()`
- Individual automatic filter functions: string inclusion, array inclusion, equality, numeric range, date range, and weak equality fallback.
- Individual automatic sort functions: alphanumeric, text, datetime, and basic comparison.

The client row models remain statically registered. Existing `manualFiltering`, `manualPagination`, and `manualSorting` options determine whether client processing is bypassed for server-backed consumers. Unused faceting factories will be removed because no shared-table consumer uses faceting APIs.

### Standalone Draggable DataTable

Register filtering, visibility, pagination, selection, and sorting features with their client row models and the automatic string/basic comparison functions required by its schema. Remove unused faceting configuration. Preserve row drag-and-drop, selection, sorting, visibility, and client pagination behavior.

### License Table

Register column filtering, global filtering, column visibility, and row sorting, plus filtered and sorted row models, string inclusion filtering, and text/alphanumeric sorting. Keep global package/license search and sorting behavior unchanged.

### Employee Directory

Register row sorting, row pagination, and column visibility. Register a sorted row model and the text/alphanumeric/basic automatic sort functions, but no paginated row model because pagination remains server-side. Keep controlled sorting and pagination state and `manualPagination` behavior.

### Team Members Table

Register row sorting, row pagination, and column visibility with sorted and paginated row models and text/alphanumeric/basic automatic sort functions. Remove the redundant TanStack filtered row model because search filtering occurs before data is passed to the table.

## API Migration

- Replace `useCompilerSafeReactTable(options)` with `useTable({ ...options, features })`.
- Remove `createTable`, `TableOptionsResolved`, `renderFallbackValue`, and top-level `onStateChange` compatibility code.
- Remove explicit `getCoreRowModel`; v9 supplies the core row model automatically.
- Replace v8 row-model factories with `createFilteredRowModel`, `createSortedRowModel`, and `createPaginatedRowModel` in `tableFeatures()`.
- Register individually imported built-in filter and sort functions under the conventional keys used by v9 automatic resolution; do not import the full `filterFns` or `sortFns` registries.
- Replace React render reads from `table.getState()` with `table.state`.
- Retain feature-specific controlled callbacks such as `onSortingChange` and `onPaginationChange`.
- Propagate v9's feature-first generic order through `ColumnDef`, `Table`, `Column`, `Row`, and `CellContext`.
- Preserve method receiver calls such as `row.getVisibleCells()` and avoid destructuring prototype methods.

## Data Flow

Controlled state continues to live in each React component. The component passes its state slices and feature-specific update callbacks to `useTable`. V9 publishes controlled state to its store and exposes subscribed render state through `table.state`.

For server-backed tables, query hooks remain responsible for fetching the requested page and sort order. TanStack pagination and sorting features provide state and interaction APIs, while `manual*` options prevent client-side transformation of already-processed data.

For client-backed tables, registered row models apply filtering, sorting, and pagination in the same order as the current v8 implementation.

## Error Handling

The migration introduces no new runtime error channel. Compile-time feature validation is the primary guard: `tableFeatures()` requires each row-model slot and dependent feature to have its prerequisite feature registered. Existing loading, empty-state, and action error behavior remains unchanged.

## Testing

Use red-green migration checks around the existing runtime failure and feature behavior:

- Shared table: members, absence entries, absence approvals, time-correction approvals, and absence-category suites.
- Team table: direct table-mode rendering and sorting suite.
- Employee columns: existing cell/action compatibility suite plus a focused full-table rendering regression.
- License table: add a focused render, filter, and sort regression.
- Standalone draggable table: add a focused render and pagination/selection regression without exercising unrelated chart behavior.

Verification gates:

1. Targeted table suites pass with no unhandled React errors.
2. No v8 runtime APIs or deprecated `/legacy` imports remain.
3. Webapp typecheck passes for v9 feature generics.
4. Full webapp tests pass.
5. `CI=true pnpm build` passes.
6. React Doctor changed-scope diagnostics do not regress.

## Acceptance Criteria

- `apps/webapp` depends on `@tanstack/react-table` `^9.1.2`.
- All table instances use native v9 `useTable` and explicit `tableFeatures()` objects.
- `use-compiler-safe-react-table.ts` is deleted and has no remaining imports.
- No code imports `@tanstack/react-table/legacy`.
- No v8 row-model option names, `getState()`, or old feature-less table generics remain.
- Manual server table behavior and client table behavior remain functionally unchanged.
- Targeted regressions, full tests, typecheck, build, and changed-scope React diagnostics complete successfully, with unrelated concurrent failures reported separately rather than modified.
