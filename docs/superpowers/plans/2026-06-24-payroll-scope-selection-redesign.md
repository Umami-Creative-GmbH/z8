# Payroll Scope Selection Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluttered always-visible payroll scope checkbox lists with a compact card and Apply/Cancel side sheets for selecting specific teams and employees.

**Architecture:** Keep the payroll access and server-action contracts unchanged. `PayrollWorkspace` continues to own committed filter state, while `PayrollScopeCard` owns temporary sheet draft state and calls existing filter handlers only when users click `Apply`.

**Tech Stack:** Next.js client component, React reducer/transition state, Luxon date handling already in place, `@/components/ui/sheet`, `@/components/ui/button`, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/components/payroll/payroll-workspace.tsx`
  - Add sheet imports from `@/components/ui/sheet`.
  - Replace the current `PayrollScopeCard` checkbox grids with a compact summary and two sheet-based selectors.
  - Preserve `selectedEmployeeIds`, `selectedTeamNames`, `toggleEmployeeFilter`, `toggleTeamFilter`, and the existing `refreshSummary` flow.
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`
  - Update existing assertions that expect always-visible scope checkboxes.
  - Add tests for employee sheet opening, team sheet opening, draft-only checkbox behavior, cancel behavior, apply behavior, summary text, and no-match blocking.
- Reference only: `docs/superpowers/specs/2026-06-24-payroll-scope-selection-redesign-design.md`
  - Approved design source for exact behavior and wording.

## Task 1: Update Initial Render Expectations

**Files:**
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`

- [ ] **Step 1: Write the failing initial render assertions**

In `renders summary cards, employee rows, period controls, and blockers`, replace the current scope checkbox expectations:

```tsx
expect(screen.getByText("Payroll scope")).toBeTruthy();
expect(screen.getByLabelText("Ada Lovelace")).toBeTruthy();
expect(screen.getByLabelText("Grace Hopper")).toBeTruthy();
expect(screen.getByLabelText("Ops")).toBeTruthy();
expect(screen.getByLabelText("Engineering")).toBeTruthy();
```

with:

```tsx
expect(screen.getByText("Payroll scope")).toBeTruthy();
expect(screen.getByText("All employees and teams I manage")).toBeTruthy();
expect(screen.getByRole("button", { name: "Specific teams" })).toBeTruthy();
expect(screen.getByRole("button", { name: "Specific employees" })).toBeTruthy();
expect(screen.queryByLabelText("Ada Lovelace")).toBeNull();
expect(screen.queryByLabelText("Grace Hopper")).toBeNull();
expect(screen.queryByLabelText("Ops")).toBeNull();
expect(screen.queryByLabelText("Engineering")).toBeNull();
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```bash
pnpm --filter webapp test -- payroll-workspace.test.tsx -t "renders summary cards"
```

Expected: FAIL because the component still renders the old always-visible checkboxes and does not render `All employees and teams I manage`, `Specific teams`, or `Specific employees`.

- [ ] **Step 3: Import sheet components and replace the scope card layout**

In `apps/webapp/src/components/payroll/payroll-workspace.tsx`, add this import after the `Select` import block:

```tsx
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
```

Replace the current `PayrollScopeCard` function with this compact version. This first version renders the compact card and non-interactive sheet shells; later tasks add full checkbox behavior.

```tsx
function PayrollScopeCard({
	filtersHaveNoMatches,
	isPending,
	onToggleEmployee,
	onToggleTeam,
	scopedEmployees,
	selectedEmployeeIds,
	selectedTeamNames,
	teamOptions,
	t,
}: {
	filtersHaveNoMatches: boolean;
	isPending: boolean;
	onToggleEmployee: (employeeId: string, checked: boolean) => void;
	onToggleTeam: (teamName: string, checked: boolean) => void;
	scopedEmployees: PayrollWorkspaceSummary["employees"];
	selectedEmployeeIds: string[];
	selectedTeamNames: string[];
	teamOptions: string[];
	t: PayrollTranslate;
}) {
	void onToggleEmployee;
	void onToggleTeam;

	const scopeSummary = getPayrollScopeSummary({ selectedEmployeeIds, selectedTeamNames, t });

	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("payroll.scope.title", "Payroll scope")}</CardTitle>
				<CardDescription>
					{t(
						"payroll.scope.description",
						"Narrow this payroll workspace by assigned employees or teams.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="rounded-lg border bg-muted/40 p-4">
					<div className="font-medium text-sm">
						{t("payroll.scope.currentScope", "Current scope")}
					</div>
					<p className="mt-1 text-muted-foreground text-sm">{scopeSummary}</p>
				</div>

				<div className="flex flex-col gap-2 sm:flex-row">
					<Sheet>
						<SheetTrigger asChild>
							<Button disabled={isPending} type="button" variant="outline">
								{t("payroll.scope.specificTeams", "Specific teams")}
							</Button>
						</SheetTrigger>
						<SheetContent className="overflow-y-auto">
							<SheetHeader>
								<SheetTitle>{t("payroll.scope.specificTeams", "Specific teams")}</SheetTitle>
								<SheetDescription>
									{t("payroll.scope.specificTeamsDescription", "Choose teams to include in this payroll scope.")}
								</SheetDescription>
							</SheetHeader>
							<div className="px-4 pb-4">
								{teamOptions.length > 0 ? null : (
									<p className="text-muted-foreground text-sm">
										{t("payroll.scope.noAssignedTeams", "No assigned teams in this payroll scope.")}
									</p>
								)}
							</div>
							<SheetFooter>
								<Button disabled={isPending} type="button">
									{t("payroll.scope.apply", "Apply")}
								</Button>
								<Button disabled={isPending} type="button" variant="outline">
									{t("payroll.scope.cancel", "Cancel")}
								</Button>
							</SheetFooter>
						</SheetContent>
					</Sheet>

					<Sheet>
						<SheetTrigger asChild>
							<Button disabled={isPending} type="button" variant="outline">
								{t("payroll.scope.specificEmployees", "Specific employees")}
							</Button>
						</SheetTrigger>
						<SheetContent className="overflow-y-auto">
							<SheetHeader>
								<SheetTitle>{t("payroll.scope.specificEmployees", "Specific employees")}</SheetTitle>
								<SheetDescription>
									{t(
										"payroll.scope.specificEmployeesDescription",
										"Choose employees to include in this payroll scope.",
									)}
								</SheetDescription>
							</SheetHeader>
							<div className="px-4 pb-4">
								{scopedEmployees.length > 0 ? null : (
									<p className="text-muted-foreground text-sm">
										{t(
											"payroll.scope.noAssignedEmployees",
											"No assigned employees in this payroll scope.",
										)}
									</p>
								)}
							</div>
							<SheetFooter>
								<Button disabled={isPending} type="button">
									{t("payroll.scope.apply", "Apply")}
								</Button>
								<Button disabled={isPending} type="button" variant="outline">
									{t("payroll.scope.cancel", "Cancel")}
								</Button>
							</SheetFooter>
						</SheetContent>
					</Sheet>
				</div>

				{filtersHaveNoMatches ? (
					<p className="text-destructive text-sm">
						{t(
							"payroll.filters.noMatchingEmployees",
							"No employees match the selected payroll filters.",
						)}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
```

Add this helper below `PayrollScopeCard`:

```tsx
function getPayrollScopeSummary({
	selectedEmployeeIds,
	selectedTeamNames,
	t,
}: {
	selectedEmployeeIds: string[];
	selectedTeamNames: string[];
	t: PayrollTranslate;
}) {
	if (selectedEmployeeIds.length === 0 && selectedTeamNames.length === 0) {
		return t("payroll.scope.allManaged", "All employees and teams I manage");
	}

	const parts: string[] = [];

	if (selectedTeamNames.length > 0) {
		parts.push(
			t("payroll.scope.selectedTeamsCount", "{count} teams", {
				count: selectedTeamNames.length,
			}),
		);
	}

	if (selectedEmployeeIds.length > 0) {
		parts.push(
			t("payroll.scope.selectedEmployeesCount", "{count} employees", {
				count: selectedEmployeeIds.length,
			}),
		);
	}

	return t("payroll.scope.selectedSummary", "{summary} selected", {
		summary: parts.join(", "),
	});
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```bash
pnpm --filter webapp test -- payroll-workspace.test.tsx -t "renders summary cards"
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```bash
git add "apps/webapp/src/components/payroll/payroll-workspace.tsx" "apps/webapp/src/components/payroll/payroll-workspace.test.tsx"
git commit -m "feat(payroll): compact scope card shell"
```

Expected: commit succeeds. Stage only these two files and do not stage unrelated existing worktree changes.

## Task 2: Add Employee Sheet Draft Selection

**Files:**
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.tsx`
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`

- [ ] **Step 1: Write failing tests for employee sheet draft behavior**

Add these tests after `renders summary cards, employee rows, period controls, and blockers`:

```tsx
it("opens employee scope selection without refreshing until apply", async () => {
	render(
		<PayrollWorkspace
			initialSummary={summary}
			exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Specific employees" }));

	const sheet = await screen.findByRole("dialog");
	expect(within(sheet).getByRole("heading", { name: "Specific employees" })).toBeTruthy();
	fireEvent.click(within(sheet).getByLabelText("Ada Lovelace"));

	expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();

	fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));

	await waitFor(() => {
		expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
			expect.objectContaining({ employeeIds: ["employee-1"] }),
		);
	});
	expect(screen.getByText("1 employees selected")).toBeTruthy();
});

it("discards employee draft selections when cancelled", async () => {
	render(
		<PayrollWorkspace
			initialSummary={summary}
			exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Specific employees" }));

	const sheet = await screen.findByRole("dialog");
	fireEvent.click(within(sheet).getByLabelText("Ada Lovelace"));
	fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));

	await waitFor(() => {
		expect(screen.queryByRole("dialog")).toBeNull();
	});
	expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();
	expect(screen.getByText("All employees and teams I manage")).toBeTruthy();
});
```

- [ ] **Step 2: Run the employee sheet tests and verify they fail**

Run:

```bash
pnpm --filter webapp test -- payroll-workspace.test.tsx -t "employee scope"
```

Expected: FAIL because the sheet has no employee checkboxes and Apply/Cancel do not commit or discard drafts yet.

- [ ] **Step 3: Import React state and sheet close support**

In `apps/webapp/src/components/payroll/payroll-workspace.tsx`, change the React import:

```tsx
import { useReducer, useState, useTransition } from "react";
```

Add `SheetClose` to the sheet import list:

```tsx
import {
	Sheet,
	SheetClose,
	SheetContent,
	SheetDescription,
	SheetFooter,
	SheetHeader,
	SheetTitle,
	SheetTrigger,
} from "@/components/ui/sheet";
```

- [ ] **Step 4: Add employee draft state and handlers inside `PayrollScopeCard`**

Inside `PayrollScopeCard`, remove these temporary unused-handler lines:

```tsx
void onToggleEmployee;
void onToggleTeam;
```

Then add state and helpers immediately after `const scopeSummary = ...`:

```tsx
	const [employeeSheetOpen, setEmployeeSheetOpen] = useState(false);
	const [draftEmployeeIds, setDraftEmployeeIds] = useState(selectedEmployeeIds);

	function openEmployeeSheet(open: boolean) {
		setEmployeeSheetOpen(open);
		if (open) {
			setDraftEmployeeIds(selectedEmployeeIds);
		}
	}

	function toggleDraftEmployee(employeeId: string, checked: boolean) {
		setDraftEmployeeIds((currentIds) =>
			checked
				? [...currentIds, employeeId]
				: currentIds.filter((currentId) => currentId !== employeeId),
		);
	}

	function applyEmployeeDraft() {
		const addedEmployeeId = draftEmployeeIds.find(
			(employeeId) => !selectedEmployeeIds.includes(employeeId),
		);
		const removedEmployeeId = selectedEmployeeIds.find(
			(employeeId) => !draftEmployeeIds.includes(employeeId),
		);
		const changedEmployeeId = addedEmployeeId ?? removedEmployeeId;

		if (changedEmployeeId) {
			onToggleEmployee(changedEmployeeId, Boolean(addedEmployeeId));
		}

		setEmployeeSheetOpen(false);
	}
```

- [ ] **Step 5: Replace the employee sheet JSX with draft checkboxes**

In the `Specific employees` sheet, change `<Sheet open...>` wrapper and content to this:

```tsx
					<Sheet onOpenChange={openEmployeeSheet} open={employeeSheetOpen}>
						<SheetTrigger asChild>
							<Button disabled={isPending} type="button" variant="outline">
								{t("payroll.scope.specificEmployees", "Specific employees")}
							</Button>
						</SheetTrigger>
						<SheetContent className="overflow-y-auto">
							<SheetHeader>
								<SheetTitle>{t("payroll.scope.specificEmployees", "Specific employees")}</SheetTitle>
								<SheetDescription>
									{t(
										"payroll.scope.specificEmployeesDescription",
										"Choose employees to include in this payroll scope.",
									)}
								</SheetDescription>
							</SheetHeader>
							<div className="grid gap-2 px-4 pb-4">
								{scopedEmployees.length > 0 ? (
									scopedEmployees.map((employee) => (
										<label key={employee.id} className="flex items-center gap-2 text-sm">
											<input
												checked={draftEmployeeIds.includes(employee.id)}
												className="size-4 rounded border-input accent-primary"
												disabled={isPending}
												onChange={(event) => toggleDraftEmployee(employee.id, event.target.checked)}
												type="checkbox"
											/>
											<span>{employee.name}</span>
										</label>
									))
								) : (
									<p className="text-muted-foreground text-sm">
										{t(
											"payroll.scope.noAssignedEmployees",
											"No assigned employees in this payroll scope.",
										)}
									</p>
								)}
							</div>
							<SheetFooter>
								<Button disabled={isPending} onClick={applyEmployeeDraft} type="button">
									{t("payroll.scope.apply", "Apply")}
								</Button>
								<SheetClose asChild>
									<Button disabled={isPending} type="button" variant="outline">
										{t("payroll.scope.cancel", "Cancel")}
									</Button>
								</SheetClose>
							</SheetFooter>
						</SheetContent>
					</Sheet>
```

- [ ] **Step 6: Run the employee sheet tests and verify they pass**

Run:

```bash
pnpm --filter webapp test -- payroll-workspace.test.tsx -t "employee scope"
```

Expected: PASS.

- [ ] **Step 7: Commit Task 2**

Run:

```bash
git add "apps/webapp/src/components/payroll/payroll-workspace.tsx" "apps/webapp/src/components/payroll/payroll-workspace.test.tsx"
git commit -m "feat(payroll): add employee scope sheet"
```

Expected: commit succeeds. Stage only these two files.

## Task 3: Add Team Sheet Draft Selection And Multi-Change Apply

**Files:**
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.tsx`
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`

- [ ] **Step 1: Write failing tests for team sheet apply and cancel**

Replace the old `passes scoped employee ids when employee and team filters change` test with these tests:

```tsx
it("applies team scope selections from the team sheet", async () => {
	render(
		<PayrollWorkspace
			initialSummary={summary}
			exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Specific teams" }));

	const sheet = await screen.findByRole("dialog");
	fireEvent.click(within(sheet).getByLabelText("Ops"));
	expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();

	fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));

	await waitFor(() => {
		expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
			expect.objectContaining({ employeeIds: ["employee-1"] }),
		);
	});
	expect(screen.getByText("1 teams selected")).toBeTruthy();
});

it("discards team draft selections when cancelled", async () => {
	render(
		<PayrollWorkspace
			initialSummary={summary}
			exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Specific teams" }));

	const sheet = await screen.findByRole("dialog");
	fireEvent.click(within(sheet).getByLabelText("Ops"));
	fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));

	await waitFor(() => {
		expect(screen.queryByRole("dialog")).toBeNull();
	});
	expect(actionMocks.getPayrollWorkspaceSummaryAction).not.toHaveBeenCalled();
	expect(screen.getByText("All employees and teams I manage")).toBeTruthy();
});
```

- [ ] **Step 2: Run the team sheet tests and verify they fail**

Run:

```bash
pnpm --filter webapp test -- payroll-workspace.test.tsx -t "team"
```

Expected: FAIL because the team sheet still has no draft checkboxes or apply behavior.

- [ ] **Step 3: Add generic array-diff helper for one or more changed selections**

Add this helper below `getPayrollScopeSummary`:

```tsx
function getSelectionChanges(currentIds: string[], nextIds: string[]) {
	return {
		addedIds: nextIds.filter((nextId) => !currentIds.includes(nextId)),
		removedIds: currentIds.filter((currentId) => !nextIds.includes(currentId)),
	};
}
```

Then replace `applyEmployeeDraft` from Task 2 with this multi-change version:

```tsx
	function applyEmployeeDraft() {
		const { addedIds, removedIds } = getSelectionChanges(selectedEmployeeIds, draftEmployeeIds);

		for (const employeeId of addedIds) {
			onToggleEmployee(employeeId, true);
		}

		for (const employeeId of removedIds) {
			onToggleEmployee(employeeId, false);
		}

		setEmployeeSheetOpen(false);
	}
```

- [ ] **Step 4: Add team draft state and handlers inside `PayrollScopeCard`**

Add this state and handlers next to the employee draft state:

```tsx
	const [teamSheetOpen, setTeamSheetOpen] = useState(false);
	const [draftTeamNames, setDraftTeamNames] = useState(selectedTeamNames);

	function openTeamSheet(open: boolean) {
		setTeamSheetOpen(open);
		if (open) {
			setDraftTeamNames(selectedTeamNames);
		}
	}

	function toggleDraftTeam(teamName: string, checked: boolean) {
		setDraftTeamNames((currentNames) =>
			checked
				? [...currentNames, teamName]
				: currentNames.filter((currentName) => currentName !== teamName),
		);
	}

	function applyTeamDraft() {
		const { addedIds, removedIds } = getSelectionChanges(selectedTeamNames, draftTeamNames);

		for (const teamName of addedIds) {
			onToggleTeam(teamName, true);
		}

		for (const teamName of removedIds) {
			onToggleTeam(teamName, false);
		}

		setTeamSheetOpen(false);
	}
```

- [ ] **Step 5: Replace the team sheet JSX with draft checkboxes**

Change the `Specific teams` sheet wrapper and content to this:

```tsx
					<Sheet onOpenChange={openTeamSheet} open={teamSheetOpen}>
						<SheetTrigger asChild>
							<Button disabled={isPending} type="button" variant="outline">
								{t("payroll.scope.specificTeams", "Specific teams")}
							</Button>
						</SheetTrigger>
						<SheetContent className="overflow-y-auto">
							<SheetHeader>
								<SheetTitle>{t("payroll.scope.specificTeams", "Specific teams")}</SheetTitle>
								<SheetDescription>
									{t("payroll.scope.specificTeamsDescription", "Choose teams to include in this payroll scope.")}
								</SheetDescription>
							</SheetHeader>
							<div className="grid gap-2 px-4 pb-4">
								{teamOptions.length > 0 ? (
									teamOptions.map((teamName) => (
										<label key={teamName} className="flex items-center gap-2 text-sm">
											<input
												checked={draftTeamNames.includes(teamName)}
												className="size-4 rounded border-input accent-primary"
												disabled={isPending}
												onChange={(event) => toggleDraftTeam(teamName, event.target.checked)}
												type="checkbox"
											/>
											<span>{teamName}</span>
										</label>
									))
								) : (
									<p className="text-muted-foreground text-sm">
										{t("payroll.scope.noAssignedTeams", "No assigned teams in this payroll scope.")}
									</p>
								)}
							</div>
							<SheetFooter>
								<Button disabled={isPending} onClick={applyTeamDraft} type="button">
									{t("payroll.scope.apply", "Apply")}
								</Button>
								<SheetClose asChild>
									<Button disabled={isPending} type="button" variant="outline">
										{t("payroll.scope.cancel", "Cancel")}
									</Button>
								</SheetClose>
							</SheetFooter>
						</SheetContent>
					</Sheet>
```

- [ ] **Step 6: Run the team sheet tests and verify they pass**

Run:

```bash
pnpm --filter webapp test -- payroll-workspace.test.tsx -t "team"
```

Expected: PASS.

- [ ] **Step 7: Run the employee sheet tests again**

Run:

```bash
pnpm --filter webapp test -- payroll-workspace.test.tsx -t "employee scope"
```

Expected: PASS.

- [ ] **Step 8: Commit Task 3**

Run:

```bash
git add "apps/webapp/src/components/payroll/payroll-workspace.tsx" "apps/webapp/src/components/payroll/payroll-workspace.test.tsx"
git commit -m "feat(payroll): add team scope sheet"
```

Expected: commit succeeds. Stage only these two files.

## Task 4: Preserve No-Match Blocking And Empty Scope States

**Files:**
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx`
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.tsx` if the tests expose missing behavior

- [ ] **Step 1: Update the no-match test to use sheet Apply flow**

Replace the body of `disables PDF and export actions when filters produce no matches` with:

```tsx
render(
	<PayrollWorkspace
		initialSummary={summary}
		exportFormats={[{ id: "datev_lohn", label: "DATEV" }]}
	/>,
);

fireEvent.click(screen.getByRole("button", { name: "Specific employees" }));
let sheet = await screen.findByRole("dialog");
fireEvent.click(within(sheet).getByLabelText("Ada Lovelace"));
fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));

await waitFor(() => {
	expect(actionMocks.getPayrollWorkspaceSummaryAction).toHaveBeenCalledWith(
		expect.objectContaining({ employeeIds: ["employee-1"] }),
	);
});

fireEvent.click(screen.getByRole("button", { name: "Specific teams" }));
sheet = await screen.findByRole("dialog");
fireEvent.click(within(sheet).getByLabelText("Engineering"));
fireEvent.click(within(sheet).getByRole("button", { name: "Apply" }));

await waitFor(() => {
	expect(screen.getAllByText("No employees match the selected payroll filters.").length).toBeGreaterThan(
		0,
	);
});
const employeesSummaryCard = screen.getByText("Employees").closest('[data-slot="card"]');
expect(employeesSummaryCard).toBeTruthy();
expect(within(employeesSummaryCard as HTMLElement).getByText("0")).toBeTruthy();
const employeeTotalsCard = screen.getByText("Employee totals").closest('[data-slot="card"]');
expect(employeeTotalsCard).toBeTruthy();
expect(within(employeeTotalsCard as HTMLElement).queryByText("E-1")).toBeNull();
expect((screen.getByRole("button", { name: "Download PDF" }) as HTMLButtonElement).disabled).toBe(
	true,
);
expect((screen.getByRole("button", { name: "Trigger export" }) as HTMLButtonElement).disabled).toBe(
	true,
);
```

- [ ] **Step 2: Add empty options tests**

Add this test near the scope sheet tests:

```tsx
it("shows empty states when no teams or employees are assigned", async () => {
	const emptySummary = buildSummary({
		totals: { employeeCount: 0, totalWorkedHours: 0, blockerCount: 0 },
		employees: [],
		blockers: [],
	});

	render(<PayrollWorkspace initialSummary={emptySummary} exportFormats={[]} />);

	fireEvent.click(screen.getByRole("button", { name: "Specific teams" }));
	let sheet = await screen.findByRole("dialog");
	expect(within(sheet).getByText("No assigned teams in this payroll scope.")).toBeTruthy();
	fireEvent.click(within(sheet).getByRole("button", { name: "Cancel" }));

	await waitFor(() => {
		expect(screen.queryByRole("dialog")).toBeNull();
	});

	fireEvent.click(screen.getByRole("button", { name: "Specific employees" }));
	sheet = await screen.findByRole("dialog");
	expect(within(sheet).getByText("No assigned employees in this payroll scope.")).toBeTruthy();
});
```

- [ ] **Step 3: Run the no-match and empty-state tests and verify results**

Run:

```bash
pnpm --filter webapp test -- payroll-workspace.test.tsx -t "filters produce no matches|empty states"
```

Expected: PASS. If it fails because dialog close animation leaves the old dialog in the DOM briefly, keep the `waitFor(() => expect(screen.queryByRole("dialog")).toBeNull())` pattern from the snippet.

- [ ] **Step 4: Commit Task 4**

Run:

```bash
git add "apps/webapp/src/components/payroll/payroll-workspace.tsx" "apps/webapp/src/components/payroll/payroll-workspace.test.tsx"
git commit -m "test(payroll): cover scope sheet edge cases"
```

Expected: commit succeeds. Stage only these two files.

## Task 5: Final Payroll Workspace Regression Pass

**Files:**
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.tsx` only if final tests expose defects
- Modify: `apps/webapp/src/components/payroll/payroll-workspace.test.tsx` only if final tests expose outdated expectations

- [ ] **Step 1: Run the full payroll workspace component test**

Run:

```bash
pnpm --filter webapp test -- payroll-workspace.test.tsx
```

Expected: PASS.

- [ ] **Step 2: Run formatting/lint checks available for the package**

Run:

```bash
pnpm --filter webapp lint
```

Expected: PASS. If the package has no `lint` script, record that output and run the full test command in Step 3.

- [ ] **Step 3: Run the project test command if time allows**

Run:

```bash
pnpm test
```

Expected: PASS. If unrelated tests fail, capture the failing test names and confirm the payroll workspace test still passes.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff -- "apps/webapp/src/components/payroll/payroll-workspace.tsx" "apps/webapp/src/components/payroll/payroll-workspace.test.tsx"
```

Expected: diff only contains the compact payroll scope card, sheet selector behavior, and corresponding tests.

- [ ] **Step 5: Commit final fixes if any were needed**

If Steps 1-4 required additional edits, run:

```bash
git add "apps/webapp/src/components/payroll/payroll-workspace.tsx" "apps/webapp/src/components/payroll/payroll-workspace.test.tsx"
git commit -m "fix(payroll): stabilize compact scope selection"
```

Expected: commit succeeds only if there are new staged changes. Do not create an empty commit.

## Self-Review

- Spec coverage: The plan covers compact scope card rendering, `All employees and teams I manage`, `Specific teams`, `Specific employees`, Apply/Cancel draft behavior, unchanged server contracts, no-match blocking, empty sheet states, accessibility through existing sheet components, and regression tests.
- Red-flag scan: No incomplete sections or unspecified test/code steps remain.
- Type consistency: The plan uses existing `selectedEmployeeIds`, `selectedTeamNames`, `PayrollWorkspaceSummary["employees"]`, `PayrollTranslate`, `onToggleEmployee`, and `onToggleTeam` names from the component.
