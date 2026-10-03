# Excel Loading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove ExcelJS from initial Reports navigation without changing exported report contents.

**Architecture:** Import the existing Excel exporter and filename function only inside the Excel handler branch. Keep existing asynchronous result handling, loading state, toasts, and download cleanup.

**Tech Stack:** React, Next.js dynamic import, ExcelJS 4.4, Vitest/jsdom.

**Spec:** [Section 3](../specs/2026-10-02-navigation-performance-design.md); follow the [delivery checklist](2026-10-02-navigation-performance.md).

## Global Constraints

- Preserve current data freshness, authorization, organization isolation, timekeeping results, preference defaults, translation keys, and page layout.
- No exporter rewrite, dependency addition, or mount/prefetch warming. CSV/PDF paths and filenames remain unchanged.
- Source paths are relative to `apps/webapp`; inherit the delivery plan's constraints and verification gates. Fixture exports only.

## Review Focus

1. Mounting Reports without exporting must not load ExcelJS.
2. Missing Excel chunk/import must show the existing failure toast and restore controls.
3. Workbook-generation rejection must allow retry and create no leaked download URL.
4. Repeated exports must retain filenames/MIME and clean up each URL.
5. CSV/PDF exports must not trigger the Excel module and must retain their content.

### Task 1: Defer Excel exporter loading

**Files:** Modify `src/components/reports/export-buttons.tsx`; create `src/components/reports/export-buttons.test.tsx` and `src/lib/reports/exporters/excel-exporter.test.ts`. Existing exporter source and `ReportData` type stay unchanged unless a demonstrated pre-existing defect blocks equivalence; report such a defect separately before changing scope.

**Interfaces:** Existing public `ExportButtons({reportData}: {reportData: ReportData})`. Inside the Excel branch use `const { exportToExcel, generateExcelFilename } = await import('@/lib/reports/exporters/excel-exporter')`. Consume existing `exportToExcel(reportData): Promise<Buffer>` and `generateExcelFilename(reportData): string`; return the same data/filename/MIME result object to the current download handler. No new public loader interface.

- [ ] **Step 1: Add behavior tests.** In jsdom, mock Tolgee/display context and exporter modules. The Excel module's mock factory records when it is evaluated; reset the module registry between import-timing scenarios. Assert mounting and CSV/PDF clicks do not evaluate it, Excel click does, controls are disabled during a held export, failures show error and restore controls, and retry succeeds. Mock `URL.createObjectURL`, `revokeObjectURL`, and anchor click; assert download and cleanup:

```ts
expect(excelModuleEvaluated).toBe(false); // after mounting and a CSV export
expect(downloadAnchor.download).toMatch(/^report-fixture-user-\d+\.xlsx$/);
expect(blob.type).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:fixture');
expect(exportButton.disabled).toBe(false); // after import/generation failure
```

Test import rejection by rejecting the mocked dynamic module, not only its export function. Generation failure gets its own scenario. The workbook test creates a fictional `ReportData` with monthly work, absence categories, and home office date rows, opens the generated buffer using ExcelJS, and asserts worksheets `Summary`, `Work Hours`, `Absences`, `Home Office (Tax)` and fixture totals. Pin time for filename/generated timestamp; compare cells, not binary XLSX bytes.

- [ ] **Step 2: Run to verify failure.** `pnpm exec vitest run --project unit 'src/components/reports/export-buttons.test.tsx' 'src/lib/reports/exporters/excel-exporter.test.ts'`. Expected: the lazy-import assertion fails on the current static import; workbook characterization passes unchanged.
- [ ] **Step 3: Change the import site.** Remove both static Excel imports and place the dynamic import inside the existing Excel branch, after loading is set and within the promise/error handling. Preserve CSV/PDF branches, timestamp generation, result shape, and download lifecycle. Use no eager preload or filename-only static import.
- [ ] **Step 4: Verify behavior and bundle boundary.** Rerun step 2 and shared checks. In the production build inspect Reports' initial client dependency graph and browser loaded chunks: initial Reports navigation plus CSV/PDF must exclude ExcelJS; first Excel click must request its deferred chunk and download a valid fixture workbook. Module-level unit mocks do not prove bundle splitting. Compare loaded JS bytes with the predecessor; report actual byte change and measure whether other routes retain unrelated ExcelJS consumers. Test a failed chunk request followed by restored network/retry in the disposable browser.
- [ ] **Step 5: Commit and deliver change 3.** Stage only these files; `git commit -m 'perf: load Excel exporter on demand'`. Record bundle/runtime evidence in change-3 results and create its independent PR.
