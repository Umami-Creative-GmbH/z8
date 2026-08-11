# TanStack Table v9 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the webapp to `@tanstack/react-table` v9.1.2 and migrate every table to native v9 `useTable`, explicit feature sets, and feature-first public types.

**Architecture:** Each table owns a static `tableFeatures()` object containing only its required state APIs and client row models. The shared server/client table exports one shared feature type for its helper components and external column definitions; standalone tables keep focused local feature contracts. The v8 compiler workaround is deleted because v9 `useTable` supplies React-compatible store state directly.

**Tech Stack:** React 19, Next.js 16, TypeScript, TanStack Table 9.1.2, Vitest, Testing Library, pnpm

---

## File Structure

- Create `apps/webapp/src/components/data-table-server/data-table-features.ts` for the shared table's static v9 features and exported feature type.
- Create `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-table-features.ts` for the employee directory's shared feature contract.
- Delete `apps/webapp/src/components/use-compiler-safe-react-table.ts`; all five consumers move to `useTable`.
- Keep standalone feature objects in `data-table.tsx`, `license-table.tsx`, and `team-members-list.tsx` because no external runtime component needs them.
- Add focused integration tests beside the standalone draggable table, license table, and employee page client.
- Update shared column modules only to carry the shared feature type; do not restructure their behavior.

## Task 1: Restore v9 and Capture the Failing Baseline

**Files:**
- Modify: `apps/webapp/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `apps/webapp/src/components/approvals/absence-approvals-table.test.tsx`
- Test: `apps/webapp/src/components/organization/members-table.test.tsx`

- [ ] **Step 1: Restore the v9 dependency**

Change the dependency to:

```json
"@tanstack/react-table": "^9.1.2"
```

- [ ] **Step 2: Refresh the lockfile and installed modules**

Run:

```bash
pnpm install
```

Expected: pnpm installs `@tanstack/react-table@9.1.2` and `@tanstack/table-core@9.1.2` without changing unrelated dependency declarations.

- [ ] **Step 3: Verify the v9 package surface**

Run:

```bash
pnpm --filter webapp exec node -e "import('@tanstack/react-table').then(m => { if (typeof m.useTable !== 'function' || typeof m.tableFeatures !== 'function' || typeof m.getCoreRowModel !== 'undefined') process.exit(1) })"
```

Expected: exit code 0.

- [ ] **Step 4: Run the existing regression tests and confirm the expected red state**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/approvals/absence-approvals-table.test.tsx src/components/organization/members-table.test.tsx
```

Expected: FAIL from the v8 table API, initially `TypeError: getCoreRowModel is not a function` or `TypeError: createTable is not a function`. This proves the existing tests exercise the broken runtime path.

## Task 2: Migrate the Shared DataTable Runtime

**Files:**
- Create: `apps/webapp/src/components/data-table-server/data-table-features.ts`
- Modify: `apps/webapp/src/components/data-table-server/data-table.tsx`
- Delete: `apps/webapp/src/components/use-compiler-safe-react-table.ts`

- [ ] **Step 1: Define the shared static v9 feature set**

Create `data-table-features.ts`:

```ts
import {
	columnFilteringFeature,
	columnVisibilityFeature,
	createFilteredRowModel,
	createPaginatedRowModel,
	createSortedRowModel,
	filterFn_arrIncludes,
	filterFn_equals,
	filterFn_inDateRange,
	filterFn_inNumberRange,
	filterFn_includesString,
	filterFn_weakEquals,
	rowPaginationFeature,
	rowSelectionFeature,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_basic,
	sortFn_datetime,
	sortFn_text,
	tableFeatures,
} from "@tanstack/react-table";

export const dataTableFeatures = tableFeatures({
	columnFilteringFeature,
	columnVisibilityFeature,
	rowPaginationFeature,
	rowSelectionFeature,
	rowSortingFeature,
	filteredRowModel: createFilteredRowModel(),
	paginatedRowModel: createPaginatedRowModel(),
	sortedRowModel: createSortedRowModel(),
	filterFns: {
		arrIncludes: filterFn_arrIncludes,
		equals: filterFn_equals,
		inDateRange: filterFn_inDateRange,
		inNumberRange: filterFn_inNumberRange,
		includesString: filterFn_includesString,
		weakEquals: filterFn_weakEquals,
	},
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		basic: sortFn_basic,
		datetime: sortFn_datetime,
		text: sortFn_text,
	},
});

export type DataTableFeatures = typeof dataTableFeatures;
```

- [ ] **Step 2: Migrate the shared component imports and public column type**

In `data-table.tsx`, remove all v8 row-model factories and the custom hook import. Import `useTable`, `dataTableFeatures`, and `DataTableFeatures`:

```ts
import {
	type ColumnDef,
	type ColumnFiltersState,
	flexRender,
	type OnChangeFn,
	type PaginationState,
	type RowSelectionState,
	type SortingState,
	useTable,
	type VisibilityState,
} from "@tanstack/react-table";
import {
	dataTableFeatures,
	type DataTableFeatures,
} from "@/components/data-table-server/data-table-features";
```

Change the columns property to:

```ts
columns: ColumnDef<DataTableFeatures, TData, TValue>[];
```

- [ ] **Step 3: Replace the v8 table constructor**

Replace `useCompilerSafeReactTable({...})` with:

```ts
const table = useTable({
	features: dataTableFeatures,
	data,
	columns,
	pageCount: manualPagination ? pageCount : undefined,
	state: {
		sorting,
		columnVisibility,
		rowSelection,
		columnFilters,
		pagination: currentPagination,
	},
	getRowId,
	enableRowSelection,
	manualPagination,
	manualSorting,
	manualFiltering,
	onRowSelectionChange: onRowSelectionChange ?? setInternalRowSelection,
	onSortingChange: onSortingChange ?? setInternalSorting,
	onColumnFiltersChange: setColumnFilters,
	onColumnVisibilityChange: setColumnVisibility,
	onPaginationChange: onPaginationChange ?? setInternalPagination,
});
```

Do not pass core, filtered, sorted, paginated, or faceted row-model options at runtime. Row models are static feature slots, core is automatic, and faceting is unused.

- [ ] **Step 4: Remove the custom compiler wrapper**

Delete `apps/webapp/src/components/use-compiler-safe-react-table.ts` after confirming all remaining imports are listed in Tasks 5-7.

- [ ] **Step 5: Run the shared regression tests to expose type-helper work**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/approvals/absence-approvals-table.test.tsx src/components/organization/members-table.test.tsx
```

Expected: the original missing-function error is gone. Any remaining failures must identify a concrete helper type or v9 state API still pending in Task 3.

## Task 3: Migrate Shared Helpers and Column Contracts

**Files:**
- Modify: `apps/webapp/src/components/data-table-server/data-table-pagination.tsx`
- Modify: `apps/webapp/src/components/data-table-server/data-table-column-header.tsx`
- Modify: `apps/webapp/src/components/data-table-server/selection-column.tsx`
- Modify: `apps/webapp/src/components/settings/holiday/holiday-list.tsx`
- Modify: all shared-column files listed below
- Test: shared table suites listed in Step 5

Shared-column files:

```text
apps/webapp/src/components/organization/members-table.tsx
apps/webapp/src/components/time-tracking/time-entries-table-columns.tsx
apps/webapp/src/components/approvals/time-correction-approvals-table.tsx
apps/webapp/src/components/approvals/absence-approvals-table.tsx
apps/webapp/src/components/settings/vacation/vacation-policies-table.tsx
apps/webapp/src/components/settings/holiday/holiday-list.tsx
apps/webapp/src/components/settings/change-policy/change-policy-table.tsx
apps/webapp/src/components/settings/category-manager.tsx
apps/webapp/src/components/settings/absence-category/absence-categories-table.tsx
apps/webapp/src/components/absences/absence-entries-table.tsx
apps/webapp/src/components/reports/projects/project-portfolio-table.tsx
apps/webapp/src/components/settings/work-policy/work-policy-table-columns.tsx
apps/webapp/src/components/settings/work-policy/work-policy-table-columns.test.tsx
```

- [ ] **Step 1: Migrate the pagination helper type and render state reads**

Use the React table type because the helper reads subscribed `table.state`:

```ts
import type { ReactTable, RowData } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";

interface DataTablePaginationProps<TData extends RowData> {
	table: ReactTable<DataTableFeatures, TData>;
	totalRows?: number;
}
```

Replace:

```ts
const { pageIndex, pageSize } = table.getState().pagination;
```

with:

```ts
const { pageIndex, pageSize } = table.state.pagination;
```

- [ ] **Step 2: Migrate the sortable header type**

Use:

```ts
import type { Column, RowData } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";

interface DataTableColumnHeaderProps<TData extends RowData, TValue> {
	column: Column<DataTableFeatures, TData, TValue>;
	title: string;
	className?: string;
}
```

Keep `getCanSort`, `getIsSorted`, `toggleSorting`, and `clearSorting` calls unchanged.

- [ ] **Step 3: Migrate the selection column factory**

Use:

```ts
import type { ColumnDef, RowData } from "@tanstack/react-table";
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";

export function createSelectionColumn<TData extends RowData>(): ColumnDef<
	DataTableFeatures,
	TData
> {
	return {
		id: "select",
		header: ({ table }) => (
			<Checkbox
				aria-label="Select all"
				checked={table.getIsAllPageRowsSelected() || (table.getIsSomePageRowsSelected() && "indeterminate")}
				onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
			/>
		),
		cell: ({ row }) => (
			<Checkbox
				aria-label="Select row"
				checked={row.getIsSelected()}
				onCheckedChange={(value) => row.toggleSelected(!!value)}
			/>
		),
		enableSorting: false,
		enableHiding: false,
	};
}
```

- [ ] **Step 4: Propagate the shared feature generic through external columns**

In each shared-column file, import:

```ts
import type { DataTableFeatures } from "@/components/data-table-server/data-table-features";
```

Convert each v8 declaration using this exact generic order:

```ts
ColumnDef<DataTableFeatures, RowType>
ColumnDef<DataTableFeatures, RowType, ValueType>
CellContext<DataTableFeatures, RowType, ValueType>
```

Do not change cell behavior, accessors, permission checks, or localization.

- [ ] **Step 5: Update the holiday pagination shim**

Replace the fake table's `getState` member with the v9 React state surface:

```ts
state: { pagination },
```

Keep its existing pagination methods and empty row-model methods. Cast the complete shim to `ReactTable<DataTableFeatures, HolidayRow>` only at the call boundary; do not weaken the production helper type to `Partial`.

- [ ] **Step 6: Run all shared table regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/components/organization/members-table.test.tsx \
  src/components/absences/absence-entries-table.test.tsx \
  src/components/approvals/absence-approvals-table.test.tsx \
  src/components/approvals/time-correction-approvals-table.test.tsx \
  src/components/settings/absence-category/absence-categories-table.test.tsx \
  src/components/settings/work-policy/work-policy-table-columns.test.tsx
```

Expected: all listed tests pass with no unhandled React table errors.

## Task 4: Migrate the Team Members Table

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/team/team-members-list.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/team/team-members-list.test.tsx`

- [ ] **Step 1: Run the direct team table test under v9 and confirm red**

Run:

```bash
pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/team/team-members-list.test.tsx'
```

Expected: FAIL because the file still imports v8 factories or the deleted custom wrapper.

- [ ] **Step 2: Define the focused team feature set**

Add outside the component:

```ts
const teamTableFeatures = tableFeatures({
	columnVisibilityFeature,
	rowPaginationFeature,
	rowSortingFeature,
	paginatedRowModel: createPaginatedRowModel(),
	sortedRowModel: createSortedRowModel(),
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		basic: sortFn_basic,
		text: sortFn_text,
	},
});
```

Import those features, factories, `tableFeatures`, and `useTable`. Remove `getCoreRowModel`, `getFilteredRowModel`, `getPaginationRowModel`, `getSortedRowModel`, and the custom hook import.

- [ ] **Step 3: Migrate columns and construction**

Change the existing columns declaration's annotation from `ColumnDef<ManagedEmployeeWithPresence>[]` to:

```ts
ColumnDef<typeof teamTableFeatures, ManagedEmployeeWithPresence>[]
```

Replace the table construction with:

```ts
const table = useTable({
	features: teamTableFeatures,
	data: employees,
	columns,
	onSortingChange: setSorting,
	state: { sorting },
	initialState: { pagination: { pageSize: 10 } },
});
```

The component already filters the employee array before constructing the table, so do not register column filtering or a filtered row model.

- [ ] **Step 4: Replace pagination render reads**

Replace every `table.getState().pagination` expression with `table.state.pagination`.

- [ ] **Step 5: Verify team rendering and sorting**

Run:

```bash
pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/team/team-members-list.test.tsx'
```

Expected: all team members tests pass, including table mode and ascending balance sorting.

## Task 5: Migrate the Employee Directory

**Files:**
- Create: `apps/webapp/src/app/[locale]/(app)/settings/employees/employee-table-features.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/employees/columns.test.tsx`
- Test: `apps/webapp/src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx`

- [ ] **Step 1: Add a focused full-table source regression before migration**

Extend `employees-page-client.test.tsx` with a source boundary test that fails until native v9 is used:

```ts
it("uses the native TanStack Table v9 API", async () => {
	const source = await readFile(
		join(process.cwd(), "src/app/[locale]/(app)/settings/employees/employees-page-client.tsx"),
		"utf8",
	);

	expect(source).toContain("useTable({");
	expect(source).toContain("features: employeeTableFeatures");
	expect(source).toContain("table.state.pagination");
	expect(source).not.toContain("useCompilerSafeReactTable");
	expect(source).not.toContain("getCoreRowModel");
});
```

- [ ] **Step 2: Run the new test and verify red**

Run:

```bash
pnpm --filter webapp exec vitest run 'src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx'
```

Expected: FAIL because the source still uses the v8 wrapper and factories.

- [ ] **Step 3: Define employee table features**

Create `employee-table-features.ts`:

```ts
import {
	columnVisibilityFeature,
	createSortedRowModel,
	rowPaginationFeature,
	rowSortingFeature,
	sortFn_alphanumeric,
	sortFn_basic,
	sortFn_text,
	tableFeatures,
} from "@tanstack/react-table";

export const employeeTableFeatures = tableFeatures({
	columnVisibilityFeature,
	rowPaginationFeature,
	rowSortingFeature,
	sortedRowModel: createSortedRowModel(),
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		basic: sortFn_basic,
		text: sortFn_text,
	},
});

export type EmployeeTableFeatures = typeof employeeTableFeatures;
```

- [ ] **Step 4: Migrate employee columns**

In `columns.tsx` and its test casts, use:

```ts
ColumnDef<EmployeeTableFeatures, EmployeeDirectoryRow>
```

Import `EmployeeTableFeatures` from `employee-table-features.ts`. Keep all cell and lifecycle behavior unchanged.

- [ ] **Step 5: Migrate the employee table instance**

Replace the v8 construction with:

```ts
const table = useTable({
	features: employeeTableFeatures,
	data: employees,
	columns,
	state: { sorting, pagination },
	onSortingChange: setSorting,
	onPaginationChange: setPagination,
	manualPagination: true,
	pageCount,
});
```

Remove `manualFiltering`; filtering is performed by the employee query, and no TanStack filter state is used. Replace `table.getState().pagination` with `table.state.pagination`.

- [ ] **Step 6: Verify employee tests**

Run:

```bash
pnpm --filter webapp exec vitest run \
  'src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx' \
  'src/app/[locale]/(app)/settings/employees/columns.test.tsx'
```

Expected: both files pass.

## Task 6: Migrate and Test the License Table

**Files:**
- Modify: `apps/webapp/src/components/licenses/license-table.tsx`
- Create: `apps/webapp/src/components/licenses/license-table.test.tsx`

- [ ] **Step 1: Add a focused rendering and filtering regression**

Create `license-table.test.tsx` using the existing jsdom and Tolgee mocking pattern:

```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { LicenseTable } from "./license-table";

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

it("filters licenses through the native table model", () => {
	render(
		<LicenseTable
			licenses={[
				{ name: "alpha", version: "1.0.0", license: "MIT" },
				{ name: "beta", version: "2.0.0", license: "Apache-2.0" },
			]}
		/>,
	);

	expect(screen.getByText("alpha")).toBeTruthy();
	expect(screen.getByText("beta")).toBeTruthy();
	fireEvent.change(screen.getByRole("textbox"), { target: { value: "Apache" } });
	expect(screen.queryByText("alpha")).toBeNull();
	expect(screen.getByText("beta")).toBeTruthy();
});
```

- [ ] **Step 2: Run the new test and verify red under the v8 implementation**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/licenses/license-table.test.tsx
```

Expected: FAIL from the deleted wrapper or removed v8 factory exports.

- [ ] **Step 3: Define the focused license feature set**

Add outside the component:

```ts
const licenseTableFeatures = tableFeatures({
	columnFilteringFeature,
	globalFilteringFeature,
	columnVisibilityFeature,
	rowSortingFeature,
	filteredRowModel: createFilteredRowModel(),
	sortedRowModel: createSortedRowModel(),
	filterFns: { includesString: filterFn_includesString },
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		text: sortFn_text,
	},
});
```

- [ ] **Step 4: Migrate columns and construction**

Change the existing columns declaration's annotation from `ColumnDef<LicenseInfo>[]` to:

```ts
ColumnDef<typeof licenseTableFeatures, LicenseInfo>[]
```

Replace the table construction with:

```ts
const table = useTable({
	features: licenseTableFeatures,
	data: licenses,
	columns,
	state: { sorting, columnFilters, globalFilter },
	onSortingChange: setSorting,
	onColumnFiltersChange: setColumnFilters,
	onGlobalFilterChange: setGlobalFilter,
});
```

Remove v8 row-model option properties and the custom hook import.

- [ ] **Step 5: Verify license behavior**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/licenses/license-table.test.tsx
```

Expected: the render and filtering regression passes.

## Task 7: Migrate and Test the Standalone Draggable DataTable

**Files:**
- Modify: `apps/webapp/src/components/data-table.tsx`
- Create: `apps/webapp/src/components/data-table.test.tsx`

- [ ] **Step 1: Add a focused render and pagination regression**

Create `data-table.test.tsx` with jsdom, mock Tolgee with fallback strings, and render 11 rows matching the file's existing Zod schema. Assert that the first page renders 10 body rows, the second-page control is enabled, clicking next displays the eleventh row, and selecting the first row updates the selected-row summary.

Define the fixture factory with every schema field and vary only `id` and `header`:

```tsx
function makeRow({ id, header }: { id: number; header: string }) {
	return {
		id,
		header,
		type: "Technical",
		status: "In Process",
		target: "10",
		limit: "20",
		reviewer: "Eddie Lake",
	};
}

const rows = Array.from({ length: 11 }, (_, index) =>
	makeRow({ id: index + 1, header: `Task ${index + 1}` }),
);

render(<DataTable data={rows} />);
expect(screen.getByText("Task 1")).toBeTruthy();
expect(screen.queryByText("Task 11")).toBeNull();
await user.click(screen.getByRole("button", { name: /next/i }));
expect(screen.getByText("Task 11")).toBeTruthy();
```

Mock the dynamically imported chart modules and drawer-only content so the test exercises the table rather than chart rendering.

- [ ] **Step 2: Run the test and verify red**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/data-table.test.tsx
```

Expected: FAIL from v8 imports or the deleted custom wrapper.

- [ ] **Step 3: Define the standalone feature set**

Add outside the component:

```ts
const draggableTableFeatures = tableFeatures({
	columnFilteringFeature,
	columnVisibilityFeature,
	rowPaginationFeature,
	rowSelectionFeature,
	rowSortingFeature,
	filteredRowModel: createFilteredRowModel(),
	paginatedRowModel: createPaginatedRowModel(),
	sortedRowModel: createSortedRowModel(),
	filterFns: { includesString: filterFn_includesString },
	sortFns: {
		alphanumeric: sortFn_alphanumeric,
		basic: sortFn_basic,
		text: sortFn_text,
	},
});
```

Do not retain unused faceting features or factories.

- [ ] **Step 4: Migrate all local table types**

Use these exact type forms:

```ts
ColumnDef<typeof draggableTableFeatures, Data>
Row<typeof draggableTableFeatures, Data>
```

Keep the existing column and draggable-row behavior unchanged.

- [ ] **Step 5: Migrate construction and state reads**

Use:

```ts
const table = useTable({
	features: draggableTableFeatures,
	data,
	columns,
	state: {
		sorting,
		columnVisibility,
		rowSelection,
		columnFilters,
		pagination,
	},
	getRowId: (row) => row.id.toString(),
	enableRowSelection: true,
	onRowSelectionChange: setRowSelection,
	onSortingChange: setSorting,
	onColumnFiltersChange: setColumnFilters,
	onColumnVisibilityChange: setColumnVisibility,
	onPaginationChange: setPagination,
});
```

Replace all `table.getState().pagination` reads with `table.state.pagination`.

- [ ] **Step 6: Verify standalone table behavior**

Run:

```bash
pnpm --filter webapp exec vitest run src/components/data-table.test.tsx
```

Expected: render, pagination, and selection assertions pass.

## Task 8: Remove Remaining v8 API and Complete Verification

**Files:**
- Modify: any remaining `apps/webapp/src/**/*.{ts,tsx}` identified by the scans below
- Verify: `apps/webapp` tests, typecheck, build, and React diagnostics

- [ ] **Step 1: Scan for forbidden migration leftovers**

Run:

```bash
rg -n "useCompilerSafeReactTable|getCoreRowModel|getFilteredRowModel|getPaginationRowModel|getSortedRowModel|getFacetedRowModel|getFacetedUniqueValues|\.getState\(\)|@tanstack/react-table/legacy" apps/webapp/src
```

Expected: no v8 constructor/factory/option imports, no table `getState()` reads, and no legacy entrypoint. Calls such as `table.getFilteredRowModel()` are valid v9 instance APIs and must be reviewed rather than mechanically removed.

Also run:

```bash
rg -n "sortingFn|getSortingFn|getAutoSortingFn|enablePinning|columnSizingInfo|setColumnSizingInfo|onColumnSizingInfoChange|createColumnHelper<|declare module ['\"]@tanstack/react-table" apps/webapp/src
```

Expected: no removed v8 names. Any `createColumnHelper` or module augmentation includes the v9 feature generic.

- [ ] **Step 2: Scan all public table types for feature-first generics**

Run:

```bash
rg -n "\b(ColumnDef|Column|Table|Row|CellContext)<" apps/webapp/src
```

Expected: every TanStack public table type includes its feature type as the first generic. State-only types such as `PaginationState` and `SortingState` need no change.

- [ ] **Step 3: Run targeted table regressions**

Run:

```bash
pnpm --filter webapp exec vitest run \
  src/components/data-table.test.tsx \
  src/components/licenses/license-table.test.tsx \
  src/components/organization/members-table.test.tsx \
  src/components/absences/absence-entries-table.test.tsx \
  src/components/approvals/absence-approvals-table.test.tsx \
  src/components/approvals/time-correction-approvals-table.test.tsx \
  src/components/settings/absence-category/absence-categories-table.test.tsx \
  'src/app/[locale]/(app)/team/team-members-list.test.tsx' \
  'src/app/[locale]/(app)/settings/employees/employees-page-client.test.tsx' \
  'src/app/[locale]/(app)/settings/employees/columns.test.tsx'
```

Expected: all listed test files pass with no unhandled exceptions.

- [ ] **Step 4: Run webapp typecheck**

Run:

```bash
pnpm --filter webapp typecheck
```

Expected: exit code 0. If concurrent unrelated TypeScript work fails, record the exact unrelated files; do not modify them as part of this migration.

- [ ] **Step 5: Run the full webapp test suite**

Run:

```bash
pnpm --filter webapp test
```

Expected: exit code 0 with no failing tests or unhandled table errors.

- [ ] **Step 6: Run the production build**

Run:

```bash
CI=true pnpm --filter webapp build
```

Expected: exit code 0.

- [ ] **Step 7: Run changed-scope React diagnostics**

Run from `apps/webapp`:

```bash
pnpm dlx react-doctor@latest --verbose --scope changed
```

Expected: no new React Doctor errors or score regression attributable to the migration.

- [ ] **Step 8: Inspect the final diff**

Run:

```bash
git diff --check
```

Expected: only the v9 dependency, native table migration, focused regressions, and approved design/plan documents are present. Do not commit unless the user explicitly requests it.
