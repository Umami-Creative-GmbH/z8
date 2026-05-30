# Demo Pending Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic demo-data options that generate pending absence approvals and pending time-correction approvals for testing the notification center and approvals inbox.

**Architecture:** Extend the existing demo wizard, step server actions, and `demo-data.service.ts` rather than adding a parallel seed system. The new generators are organization-scoped, return count objects, and safely return zero when prerequisites are missing.

**Tech Stack:** Next.js server actions, React client component, Drizzle ORM, Luxon, Vitest, Testing Library, pnpm.

---

## File Map

- Modify `apps/webapp/src/lib/demo/demo-data.service.ts`: add result fields plus two focused generator functions for pending approval demo records.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/demo/actions.ts`: add step input flags and two server actions that call the new generators after permission checks.
- Modify `apps/webapp/src/components/settings/demo-data-wizard.tsx`: add wizard state, options, generation steps, execution flow, result aggregation, and disabled-button logic.
- Modify `apps/webapp/src/components/settings/demo-data-wizard.test.tsx`: assert the new UI options render.
- Modify `apps/webapp/src/app/[locale]/(app)/settings/demo/actions.test.ts` if present; otherwise add source-level test coverage near existing action tests only if the repo already has this pattern.

## Task 1: Wizard UI Options

**Files:**
- Modify: `apps/webapp/src/components/settings/demo-data-wizard.tsx`
- Test: `apps/webapp/src/components/settings/demo-data-wizard.test.tsx`

- [ ] **Step 1: Add failing UI test**

Add this test to `apps/webapp/src/components/settings/demo-data-wizard.test.tsx` inside `describe("DemoDataWizard", () => { ... })`:

```tsx
it("renders approval testing options", () => {
	render(
		<DemoDataWizard
			employees={[
				{ id: "emp_1", name: "Ada Lovelace" },
				{ id: "emp_2", name: "Grace Hopper" },
			]}
			organizationId="org_1"
		/>,
	);

	expect(screen.getByText("Approvals Testing")).toBeTruthy();
	expect(screen.getByText("Pending absence approvals")).toBeTruthy();
	expect(screen.getByText("Pending time correction approvals")).toBeTruthy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @z8/webapp test src/components/settings/demo-data-wizard.test.tsx`

Expected: FAIL because `Approvals Testing` is not rendered.

- [ ] **Step 3: Add state and UI controls**

In `apps/webapp/src/components/settings/demo-data-wizard.tsx`, add state near the other generation option state:

```tsx
const [includePendingAbsenceApprovals, setIncludePendingAbsenceApprovals] = useState(false);
const [includePendingTimeCorrectionApprovals, setIncludePendingTimeCorrectionApprovals] = useState(false);
```

Add an `Approvals Testing` section after the existing `Data Types` section and before the generate button:

```tsx
<div className="space-y-4">
	<Label>{t("settings.demo.form.approvalsTesting.label", "Approvals Testing")}</Label>
	<div className="grid gap-4 md:grid-cols-2">
		<div
			role="checkbox"
			aria-checked={includePendingAbsenceApprovals}
			tabIndex={0}
			className={cn(
				"flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
				includePendingAbsenceApprovals ? "border-primary bg-primary/5" : "hover:bg-muted/50",
			)}
			onClick={() => setIncludePendingAbsenceApprovals(!includePendingAbsenceApprovals)}
			onKeyDown={(event) =>
				handleSelectableCardKeyDown(event, () =>
					setIncludePendingAbsenceApprovals(!includePendingAbsenceApprovals),
				)
			}
		>
			<Checkbox
				checked={includePendingAbsenceApprovals}
				onCheckedChange={(v) => setIncludePendingAbsenceApprovals(v === true)}
			/>
			<div className="space-y-1">
				<div className="flex items-center gap-2 font-medium">
					<IconUserCheck className="size-4" />
					{t(
						"settings.demo.form.approvalsTesting.pendingAbsences.title",
						"Pending absence approvals",
					)}
				</div>
				<p className="text-xs text-muted-foreground">
					{t(
						"settings.demo.form.approvalsTesting.pendingAbsences.description",
						"Create absence requests waiting for manager approval",
					)}
				</p>
			</div>
		</div>

		<div
			role="checkbox"
			aria-checked={includePendingTimeCorrectionApprovals}
			tabIndex={0}
			className={cn(
				"flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
				includePendingTimeCorrectionApprovals
					? "border-primary bg-primary/5"
					: "hover:bg-muted/50",
			)}
			onClick={() =>
				setIncludePendingTimeCorrectionApprovals(!includePendingTimeCorrectionApprovals)
			}
			onKeyDown={(event) =>
				handleSelectableCardKeyDown(event, () =>
					setIncludePendingTimeCorrectionApprovals(!includePendingTimeCorrectionApprovals),
				)
			}
		>
			<Checkbox
				checked={includePendingTimeCorrectionApprovals}
				onCheckedChange={(v) => setIncludePendingTimeCorrectionApprovals(v === true)}
			/>
			<div className="space-y-1">
				<div className="flex items-center gap-2 font-medium">
					<IconClock className="size-4" />
					{t(
						"settings.demo.form.approvalsTesting.pendingTimeCorrections.title",
						"Pending time correction approvals",
					)}
				</div>
				<p className="text-xs text-muted-foreground">
					{t(
						"settings.demo.form.approvalsTesting.pendingTimeCorrections.description",
						"Create time corrections waiting for manager approval",
					)}
				</p>
			</div>
		</div>
	</div>
</div>
```

Update the generate button disabled expression to include the two new options:

```tsx
disabled={
	!includeTimeEntries &&
	!includeAbsences &&
	!includeTeams &&
	!includeProjects &&
	!includeLocations &&
	!includeWorkCategories &&
	!includeChangePolicies &&
	!includeShifts &&
	!includePendingAbsenceApprovals &&
	!includePendingTimeCorrectionApprovals
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @z8/webapp test src/components/settings/demo-data-wizard.test.tsx`

Expected: PASS.

## Task 2: Service Result Types and Pending Absence Generator

**Files:**
- Modify: `apps/webapp/src/lib/demo/demo-data.service.ts`

- [ ] **Step 1: Add result fields and imports**

Update the import list from `@/db/schema` to include `approvalRequest` if it is not already imported:

```ts
import {
	absenceCategory,
	absenceEntry,
	approvalRequest,
	changePolicy,
	changePolicyAssignment,
	employee,
	employeeManagers,
	...
} from "@/db/schema";
```

Add fields to `DemoDataResult`:

```ts
pendingAbsenceApprovalsCreated: number;
pendingTimeCorrectionApprovalsCreated: number;
```

- [ ] **Step 2: Add pending absence generator**

Add this function after `generateDemoAbsences` in `apps/webapp/src/lib/demo/demo-data.service.ts`:

```ts
export async function generateDemoPendingAbsenceApprovals(
	options: DemoDataOptions,
): Promise<{ pendingAbsenceApprovalsCreated: number }> {
	const employees = await db.query.employee.findMany({
		where: options.employeeIds?.length
			? and(
					eq(employee.organizationId, options.organizationId),
					inArray(employee.id, options.employeeIds),
				)
			: eq(employee.organizationId, options.organizationId),
	});

	if (employees.length < 2) {
		return { pendingAbsenceApprovalsCreated: 0 };
	}

	await ensureDefaultAbsenceCategories(options.organizationId);

	const categories = await db.query.absenceCategory.findMany({
		where: and(
			eq(absenceCategory.organizationId, options.organizationId),
			eq(absenceCategory.isActive, true),
		),
	});
	const category = categories.find((entry) => entry.type === "vacation") ?? categories[0];

	if (!category) {
		return { pendingAbsenceApprovalsCreated: 0 };
	}

	const employeeIds = employees.map((entry) => entry.id);
	const managerAssignments = await db.query.employeeManagers.findMany({
		where: inArray(employeeManagers.employeeId, employeeIds),
	});

	let pendingAbsenceApprovalsCreated = 0;
	const requesters = employees.slice(0, Math.min(5, employees.length));
	const baseDate = DateTime.utc().plus({ days: 14 }).startOf("day");

	for (let index = 0; index < requesters.length; index++) {
		const requester = requesters[index];
		const assignedManager = managerAssignments.find(
			(entry) => entry.employeeId === requester.id && entry.managerId !== requester.id,
		);
		const fallbackApprover = employees.find((entry) => entry.id !== requester.id);
		const approverId = assignedManager?.managerId ?? fallbackApprover?.id;

		if (!approverId) {
			continue;
		}

		const startDate = baseDate.plus({ days: index * 3 }).toISODate()!;
		const endDate = baseDate.plus({ days: index * 3 + 1 }).toISODate()!;
		const [absence] = await db
			.insert(absenceEntry)
			.values({
				employeeId: requester.id,
				categoryId: category.id,
				organizationId: options.organizationId,
				startDate,
				endDate,
				status: "pending",
				notes: "Demo data - Pending approval request",
			})
			.returning({ id: absenceEntry.id });

		if (!absence) {
			continue;
		}

		await db.insert(approvalRequest).values({
			organizationId: options.organizationId,
			entityType: "absence_entry",
			entityId: absence.id,
			requestedBy: requester.id,
			approverId,
			status: "pending",
			reason: "Demo data - Pending absence approval",
		});

		pendingAbsenceApprovalsCreated++;
	}

	return { pendingAbsenceApprovalsCreated };
}
```

- [ ] **Step 3: Typecheck the service**

Run: `pnpm --filter @z8/webapp exec tsc --noEmit`

Expected: Either PASS, or only pre-existing unrelated errors. If this task introduced errors, fix them before continuing.

## Task 3: Pending Time Correction Generator

**Files:**
- Modify: `apps/webapp/src/lib/demo/demo-data.service.ts`

- [ ] **Step 1: Add generator function**

Add this function after `generateDemoPendingAbsenceApprovals`:

```ts
export async function generateDemoPendingTimeCorrectionApprovals(
	options: DemoDataOptions,
): Promise<{ pendingTimeCorrectionApprovalsCreated: number }> {
	const employees = await db.query.employee.findMany({
		where: options.employeeIds?.length
			? and(
					eq(employee.organizationId, options.organizationId),
					inArray(employee.id, options.employeeIds),
				)
			: eq(employee.organizationId, options.organizationId),
	});

	if (employees.length < 2) {
		return { pendingTimeCorrectionApprovalsCreated: 0 };
	}

	const employeeIds = employees.map((entry) => entry.id);
	const periods = await db.query.workPeriod.findMany({
		where: and(
			eq(workPeriod.organizationId, options.organizationId),
			eq(workPeriod.isActive, false),
			inArray(workPeriod.employeeId, employeeIds),
		),
		limit: 20,
	});

	if (periods.length === 0) {
		return { pendingTimeCorrectionApprovalsCreated: 0 };
	}

	const periodIds = periods.map((period) => period.id);
	const existingPendingApprovals = await db.query.approvalRequest.findMany({
		where: and(
			eq(approvalRequest.organizationId, options.organizationId),
			eq(approvalRequest.entityType, "time_entry"),
			eq(approvalRequest.status, "pending"),
			inArray(approvalRequest.entityId, periodIds),
		),
	});
	const pendingPeriodIds = new Set(existingPendingApprovals.map((entry) => entry.entityId));
	const managerAssignments = await db.query.employeeManagers.findMany({
		where: inArray(employeeManagers.employeeId, employeeIds),
	});

	let pendingTimeCorrectionApprovalsCreated = 0;

	for (const period of periods) {
		if (pendingTimeCorrectionApprovalsCreated >= 5 || pendingPeriodIds.has(period.id)) {
			continue;
		}

		const requester = employees.find((entry) => entry.id === period.employeeId);
		if (!requester) {
			continue;
		}

		const assignedManager = managerAssignments.find(
			(entry) => entry.employeeId === requester.id && entry.managerId !== requester.id,
		);
		const fallbackApprover = employees.find((entry) => entry.id !== requester.id);
		const approverId = assignedManager?.managerId ?? fallbackApprover?.id;

		if (!approverId) {
			continue;
		}

		const correctedStart = DateTime.fromJSDate(period.startTime, { zone: "utc" }).plus({ minutes: 15 });
		const correctedTimestamp = dateToDB(correctedStart)!;
		const correctionHash = calculateHash({
			employeeId: requester.id,
			type: "correction",
			timestamp: correctedStart.toISO()!,
		});

		const [correctionEntry] = await db
			.insert(timeEntry)
			.values({
				employeeId: requester.id,
				organizationId: options.organizationId,
				type: "correction",
				timestamp: correctedTimestamp,
				hash: correctionHash,
				replacesEntryId: period.clockInId,
				notes: "Demo data - Pending time correction",
				createdBy: options.createdBy,
			})
			.returning({ id: timeEntry.id });

		if (!correctionEntry) {
			continue;
		}

		await db.insert(approvalRequest).values({
			organizationId: options.organizationId,
			entityType: "time_entry",
			entityId: period.id,
			requestedBy: requester.id,
			approverId,
			status: "pending",
			reason: "Demo data - Pending time correction approval",
			metadata: {
				timeCorrection: {
					clockInCorrectionId: correctionEntry.id,
				},
			},
		});

		pendingTimeCorrectionApprovalsCreated++;
	}

	return { pendingTimeCorrectionApprovalsCreated };
}
```

- [ ] **Step 2: Initialize aggregate result fields**

In `generateDemoData`, add the new generator calls and result aggregation near the existing time and absence generation:

```ts
const pendingAbsenceApprovalResult = await generateDemoPendingAbsenceApprovals(options);
const pendingTimeCorrectionApprovalResult = await generateDemoPendingTimeCorrectionApprovals(options);
```

Return the new fields in the `DemoDataResult` object:

```ts
pendingAbsenceApprovalsCreated: pendingAbsenceApprovalResult.pendingAbsenceApprovalsCreated,
pendingTimeCorrectionApprovalsCreated:
	pendingTimeCorrectionApprovalResult.pendingTimeCorrectionApprovalsCreated,
```

If `generateDemoData` should not always generate these rows, guard these calls behind new optional `DemoDataOptions` booleans added in Task 4.

- [ ] **Step 3: Typecheck the service**

Run: `pnpm --filter @z8/webapp exec tsc --noEmit`

Expected: PASS, or only pre-existing unrelated errors. Fix introduced errors before continuing.

## Task 4: Server Actions and Wizard Execution Flow

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/demo/actions.ts`
- Modify: `apps/webapp/src/components/settings/demo-data-wizard.tsx`

- [ ] **Step 1: Add options and result fields**

In `DemoDataOptions`, add:

```ts
includePendingAbsenceApprovals?: boolean;
includePendingTimeCorrectionApprovals?: boolean;
```

In every `DemoDataResult` initialization in `demo-data-wizard.tsx`, add:

```ts
pendingAbsenceApprovalsCreated: 0,
pendingTimeCorrectionApprovalsCreated: 0,
```

- [ ] **Step 2: Add action imports and input flags**

In `apps/webapp/src/app/[locale]/(app)/settings/demo/actions.ts`, import the service functions:

```ts
generateDemoPendingAbsenceApprovals,
generateDemoPendingTimeCorrectionApprovals,
```

Add fields to `StepGenerationInput`:

```ts
includePendingAbsenceApprovals?: boolean;
includePendingTimeCorrectionApprovals?: boolean;
```

- [ ] **Step 3: Add two server actions**

Add these actions after `generateAbsencesStepAction`:

```ts
export async function generatePendingAbsenceApprovalsStepAction(
	input: StepGenerationInput,
): Promise<ServerActionResult<{ pendingAbsenceApprovalsCreated: number }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const hasPermission = yield* _(Effect.promise(() => canUseDemoData(input.organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		return yield* _(
			Effect.promise(() =>
				generateDemoPendingAbsenceApprovals({
					organizationId: input.organizationId,
					dateRange,
					includeTimeEntries: false,
					includeAbsences: false,
					includeTeams: false,
					includeProjects: false,
					employeeIds: input.employeeIds,
					createdBy: session.user.id,
				}),
			),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}

export async function generatePendingTimeCorrectionApprovalsStepAction(
	input: StepGenerationInput,
): Promise<ServerActionResult<{ pendingTimeCorrectionApprovalsCreated: number }>> {
	const effect = Effect.gen(function* (_) {
		const authService = yield* _(AuthService);
		const session = yield* _(authService.getSession());
		const hasPermission = yield* _(Effect.promise(() => canUseDemoData(input.organizationId)));

		if (!hasPermission) {
			yield* _(
				Effect.fail(
					new AuthorizationError({
						message: "Insufficient permissions - admin role required",
						userId: session.user.id,
						resource: "demo_data",
						action: "generate",
					}),
				),
			);
		}

		const dateRange = calculateDateRange(input.dateRangeType);
		return yield* _(
			Effect.promise(() =>
				generateDemoPendingTimeCorrectionApprovals({
					organizationId: input.organizationId,
					dateRange,
					includeTimeEntries: false,
					includeAbsences: false,
					includeTeams: false,
					includeProjects: false,
					employeeIds: input.employeeIds,
					createdBy: session.user.id,
				}),
			),
		);
	}).pipe(Effect.provide(AppLayer));

	return runServerActionSafe(effect);
}
```

- [ ] **Step 4: Wire wizard imports and input**

In `demo-data-wizard.tsx`, import:

```tsx
generatePendingAbsenceApprovalsStepAction,
generatePendingTimeCorrectionApprovalsStepAction,
```

Add flags to `input`:

```tsx
includePendingAbsenceApprovals,
includePendingTimeCorrectionApprovals,
```

- [ ] **Step 5: Add active steps**

In `handleGenerate`, after the normal absences step, add:

```tsx
if (includePendingAbsenceApprovals) {
	activeSteps.push({
		id: "pending-absence-approvals",
		label: t("settings.demo.steps.pendingAbsenceApprovals.label", "Pending Absence Approvals"),
		description: t(
			"settings.demo.steps.pendingAbsenceApprovals.description",
			"Creating pending absence approval requests",
		),
		icon: <IconUserCheck className="size-4" />,
		status: "pending",
	});
}

if (includePendingTimeCorrectionApprovals) {
	activeSteps.push({
		id: "pending-time-correction-approvals",
		label: t(
			"settings.demo.steps.pendingTimeCorrectionApprovals.label",
			"Pending Time Correction Approvals",
		),
		description: t(
			"settings.demo.steps.pendingTimeCorrectionApprovals.description",
			"Creating pending time correction approval requests",
		),
		icon: <IconClock className="size-4" />,
		status: "pending",
	});
}
```

- [ ] **Step 6: Execute approval testing steps**

After Phase 3 and before Phase 4 in `handleGenerate`, add:

```tsx
if (!hasError) {
	const approvalTestingSteps = activeSteps.filter(
		(s) =>
			s.id === "pending-absence-approvals" ||
			s.id === "pending-time-correction-approvals",
	);

	if (approvalTestingSteps.length > 0) {
		const approvalTestingResults = await Promise.all(
			approvalTestingSteps.map((step) => {
				if (step.id === "pending-absence-approvals") {
					return executeStep(
						step.id,
						() => generatePendingAbsenceApprovalsStepAction(input),
						(data) => {
							const d = data as { pendingAbsenceApprovalsCreated: number };
							return {
								result: `${d.pendingAbsenceApprovalsCreated} pending approvals`,
								updates: {
									pendingAbsenceApprovalsCreated: d.pendingAbsenceApprovalsCreated,
								},
							};
						},
					);
				}

				return executeStep(
					step.id,
					() => generatePendingTimeCorrectionApprovalsStepAction(input),
					(data) => {
						const d = data as { pendingTimeCorrectionApprovalsCreated: number };
						return {
							result: `${d.pendingTimeCorrectionApprovalsCreated} pending approvals`,
							updates: {
								pendingTimeCorrectionApprovalsCreated:
									d.pendingTimeCorrectionApprovalsCreated,
							},
						};
					},
				);
			}),
		);
		if (approvalTestingResults.some((r) => !r)) hasError = true;
	}
}
```

- [ ] **Step 7: Update action test mock**

In `demo-data-wizard.test.tsx`, add the two mocked action names:

```ts
generatePendingAbsenceApprovalsStepAction: vi.fn(),
generatePendingTimeCorrectionApprovalsStepAction: vi.fn(),
```

- [ ] **Step 8: Run focused tests**

Run: `pnpm --filter @z8/webapp test src/components/settings/demo-data-wizard.test.tsx`

Expected: PASS.

## Task 5: Final Verification and Cleanup

**Files:**
- Review: `apps/webapp/src/lib/demo/demo-data.service.ts`
- Review: `apps/webapp/src/app/[locale]/(app)/settings/demo/actions.ts`
- Review: `apps/webapp/src/components/settings/demo-data-wizard.tsx`
- Review: `apps/webapp/src/components/settings/demo-data-wizard.test.tsx`

- [ ] **Step 1: Run formatting/check command available in the repo**

Run: `pnpm --filter @z8/webapp test src/components/settings/demo-data-wizard.test.tsx`

Expected: PASS.

- [ ] **Step 2: Run TypeScript verification**

Run: `pnpm --filter @z8/webapp exec tsc --noEmit`

Expected: PASS, or only pre-existing unrelated errors. Any errors introduced by these files must be fixed.

- [ ] **Step 3: Inspect diff for accidental unrelated changes**

Run: `git diff -- docs/superpowers/specs/2026-05-29-demo-pending-approvals-design.md docs/superpowers/plans/2026-05-29-demo-pending-approvals.md apps/webapp/src/lib/demo/demo-data.service.ts apps/webapp/src/app/[locale]/(app)/settings/demo/actions.ts apps/webapp/src/components/settings/demo-data-wizard.tsx apps/webapp/src/components/settings/demo-data-wizard.test.tsx`

Expected: Diff only contains the pending approval demo-data changes.

## Self-Review Notes

- Spec coverage: UI options, server action wiring, organization-scoped generators, safe zero-count returns, and verification are covered by Tasks 1-5.
- Placeholder scan: This plan intentionally avoids open-ended implementation placeholders; each code-changing step includes concrete snippets.
- Type consistency: Result names are `pendingAbsenceApprovalsCreated` and `pendingTimeCorrectionApprovalsCreated` across service, server actions, and wizard aggregation.
- Commit handling: The writing-plans skill normally asks for frequent commits, but this repository requires explicit user approval before committing, so commit steps are intentionally omitted.
