# Organization Fiscal Year Start Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an owner-only organization fiscal year start month setting, defaulting to January, and use it for business-year date ranges.

**Architecture:** Store the setting on the Better Auth `organization` table and hydrate it through the existing organization settings flow. Add one focused Luxon utility for fiscal ranges, then update organization settings UI, reports presets, absence page loading, and vacation/carryover helpers to consume that utility without changing visual calendar-year screens.

**Tech Stack:** Next.js App Router, React, TypeScript, Drizzle ORM, Better Auth, Zustand, Luxon, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify: `apps/webapp/src/lib/auth.ts` to add the Better Auth organization field definition.
- Generate/modify: `apps/webapp/src/db/auth-schema.ts` via `pnpm --dir apps/webapp auth:generate`; do not hand-edit except to resolve generator formatting conflicts if the command cannot run.
- Create: `apps/webapp/src/lib/fiscal-year.ts` for month normalization, fiscal ranges, labels, and carryover expiry date calculation.
- Create: `apps/webapp/src/lib/fiscal-year.test.ts` for fiscal range edge cases.
- Modify: `apps/webapp/src/stores/organization-settings-store.ts` and create `apps/webapp/src/stores/organization-settings-store.test.ts` to hydrate and expose `fiscalYearStartMonth`.
- Modify: `apps/webapp/src/hooks/use-organization.ts` and `apps/webapp/src/app/api/auth/context/route.ts` to include the setting in auth context hydration.
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts` and add tests in `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.fiscal-year.test.ts` for validation and owner-only authorization.
- Create: `apps/webapp/src/components/organization/organization-fiscal-year-card.tsx` and test `apps/webapp/src/components/organization/organization-fiscal-year-card.test.tsx`.
- Modify: `apps/webapp/src/components/organization/organization-tab.tsx` to render the new card near timezone.
- Modify: `apps/webapp/src/lib/reports/date-ranges.ts` and create/update `apps/webapp/src/lib/reports/date-ranges.test.ts` to support fiscal-aware `last_year`, `current_year`, and `ytd` presets.
- Modify: `apps/webapp/src/components/reports/date-range-picker.tsx`, `apps/webapp/src/components/reports/report-filters.tsx`, and `apps/webapp/src/app/[locale]/(app)/analytics/vacation-trends/page.tsx` so report presets use hydrated organization settings.
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/page.tsx` to load annual absence/vacation data using the current fiscal year span.
- Modify: `apps/webapp/src/lib/absences/date-utils.ts`, `apps/webapp/src/lib/query/vacation.queries.ts`, `apps/webapp/src/lib/absences/vacation.service.ts`, and `apps/webapp/src/lib/jobs/carryover-automation.ts` to route business-year boundaries through the fiscal utility.

---

### Task 1: Fiscal Year Utility

**Files:**
- Create: `apps/webapp/src/lib/fiscal-year.ts`
- Create: `apps/webapp/src/lib/fiscal-year.test.ts`

- [ ] **Step 1: Write the failing utility tests**

Create `apps/webapp/src/lib/fiscal-year.test.ts`:

```ts
import { DateTime } from "luxon";
import { describe, expect, it } from "vitest";
import {
	calculateFiscalCarryoverExpiryDate,
	getCurrentFiscalYearLabel,
	getFiscalYearRangeForDate,
	getFiscalYearToDateRange,
	normalizeFiscalYearStartMonth,
} from "./fiscal-year";

describe("fiscal-year utilities", () => {
	it("normalizes invalid fiscal start months to January", () => {
		expect(normalizeFiscalYearStartMonth(undefined)).toBe(1);
		expect(normalizeFiscalYearStartMonth(null)).toBe(1);
		expect(normalizeFiscalYearStartMonth(0)).toBe(1);
		expect(normalizeFiscalYearStartMonth(13)).toBe(1);
		expect(normalizeFiscalYearStartMonth(4.5)).toBe(1);
		expect(normalizeFiscalYearStartMonth(4)).toBe(4);
	});

	it("returns calendar-year boundaries for January fiscal years", () => {
		const range = getFiscalYearRangeForDate(DateTime.fromISO("2026-05-12", { zone: "UTC" }), 1);

		expect(range.labelYear).toBe(2026);
		expect(range.start.toISO()).toBe("2026-01-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-12-31T23:59:59.999Z");
	});

	it("returns current fiscal year spanning two calendar years", () => {
		const range = getFiscalYearRangeForDate(DateTime.fromISO("2026-03-31", { zone: "UTC" }), 4);

		expect(range.labelYear).toBe(2025);
		expect(range.start.toISO()).toBe("2025-04-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-03-31T23:59:59.999Z");
	});

	it("starts the new fiscal year on the configured month boundary", () => {
		const range = getFiscalYearRangeForDate(DateTime.fromISO("2026-04-01", { zone: "UTC" }), 4);

		expect(range.labelYear).toBe(2026);
		expect(range.start.toISO()).toBe("2026-04-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2027-03-31T23:59:59.999Z");
	});

	it("handles December fiscal years", () => {
		const range = getFiscalYearRangeForDate(DateTime.fromISO("2026-11-30", { zone: "UTC" }), 12);

		expect(range.labelYear).toBe(2025);
		expect(range.start.toISO()).toBe("2025-12-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-11-30T23:59:59.999Z");
	});

	it("returns fiscal year-to-date through the provided date", () => {
		const range = getFiscalYearToDateRange(DateTime.fromISO("2026-05-12T15:30:00", { zone: "UTC" }), 4);

		expect(range.start.toISO()).toBe("2026-04-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-05-12T15:30:00.000Z");
	});

	it("returns the current fiscal year label", () => {
		expect(getCurrentFiscalYearLabel(DateTime.fromISO("2026-03-31", { zone: "UTC" }), 4)).toBe(2025);
		expect(getCurrentFiscalYearLabel(DateTime.fromISO("2026-04-01", { zone: "UTC" }), 4)).toBe(2026);
	});

	it("calculates carryover expiry from fiscal year start", () => {
		const expiry = calculateFiscalCarryoverExpiryDate(2026, 4, 3);

		expect(expiry.toISO()).toBe("2026-06-30T23:59:59.999Z");
	});
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/fiscal-year.test.ts`

Expected: FAIL with an import error for `./fiscal-year`.

- [ ] **Step 3: Implement the utility**

Create `apps/webapp/src/lib/fiscal-year.ts`:

```ts
import { DateTime } from "luxon";

export interface FiscalYearRange {
	start: DateTime;
	end: DateTime;
	labelYear: number;
}

export function normalizeFiscalYearStartMonth(month: number | null | undefined): number {
	return Number.isInteger(month) && month >= 1 && month <= 12 ? month : 1;
}

export function getFiscalYearRangeForDate(
	date: DateTime = DateTime.utc(),
	fiscalYearStartMonth: number | null | undefined = 1,
): FiscalYearRange {
	const startMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);
	const normalizedDate = date.isValid ? date : DateTime.utc();
	const labelYear = normalizedDate.month >= startMonth ? normalizedDate.year : normalizedDate.year - 1;
	const start = DateTime.utc(labelYear, startMonth, 1).startOf("day");
	const end = start.plus({ years: 1 }).minus({ milliseconds: 1 });

	return { start, end, labelYear };
}

export function getFiscalYearRangeForLabelYear(
	labelYear: number,
	fiscalYearStartMonth: number | null | undefined = 1,
): FiscalYearRange {
	const startMonth = normalizeFiscalYearStartMonth(fiscalYearStartMonth);
	const start = DateTime.utc(labelYear, startMonth, 1).startOf("day");
	const end = start.plus({ years: 1 }).minus({ milliseconds: 1 });

	return { start, end, labelYear };
}

export function getFiscalYearToDateRange(
	date: DateTime = DateTime.utc(),
	fiscalYearStartMonth: number | null | undefined = 1,
): FiscalYearRange {
	const range = getFiscalYearRangeForDate(date, fiscalYearStartMonth);
	return { ...range, end: date.isValid ? date : DateTime.utc() };
}

export function getCurrentFiscalYearLabel(
	date: DateTime = DateTime.utc(),
	fiscalYearStartMonth: number | null | undefined = 1,
): number {
	return getFiscalYearRangeForDate(date, fiscalYearStartMonth).labelYear;
}

export function calculateFiscalCarryoverExpiryDate(
	labelYear: number,
	fiscalYearStartMonth: number | null | undefined,
	expiryMonths: number,
): DateTime {
	const { start } = getFiscalYearRangeForLabelYear(labelYear, fiscalYearStartMonth);
	return start.plus({ months: expiryMonths }).minus({ days: 1 }).endOf("day");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --dir apps/webapp test src/lib/fiscal-year.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/webapp/src/lib/fiscal-year.ts apps/webapp/src/lib/fiscal-year.test.ts
git commit -m "feat: add fiscal year date utilities"
```

---

### Task 2: Persist and Hydrate Organization Setting

**Files:**
- Modify: `apps/webapp/src/lib/auth.ts`
- Modify/generated: `apps/webapp/src/db/auth-schema.ts`
- Modify: `apps/webapp/src/app/api/auth/context/route.ts`
- Modify: `apps/webapp/src/hooks/use-organization.ts`
- Modify: `apps/webapp/src/stores/organization-settings-store.ts`
- Create: `apps/webapp/src/stores/organization-settings-store.test.ts`

- [ ] **Step 1: Write the failing store test**

Create `apps/webapp/src/stores/organization-settings-store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { useOrganizationSettings } from "./organization-settings-store";

describe("organization settings store", () => {
	it("defaults fiscal year start month to January", () => {
		useOrganizationSettings.getState().reset();

		expect(useOrganizationSettings.getState().fiscalYearStartMonth).toBe(1);
	});

	it("hydrates fiscal year start month", () => {
		useOrganizationSettings.getState().hydrate({
			organizationId: "org_1",
			shiftsEnabled: false,
			projectsEnabled: false,
			surchargesEnabled: false,
			demoDataEnabled: true,
			timezone: "UTC",
			fiscalYearStartMonth: 4,
			deletedAt: null,
		});

		expect(useOrganizationSettings.getState().fiscalYearStartMonth).toBe(4);
		expect(useOrganizationSettings.getState().isHydrated).toBe(true);
	});
});
```

- [ ] **Step 2: Run store test to verify it fails**

Run: `pnpm --dir apps/webapp test src/stores/organization-settings-store.test.ts`

Expected: FAIL because `fiscalYearStartMonth` is not on the store type/state.

- [ ] **Step 3: Add Better Auth field configuration**

In `apps/webapp/src/lib/auth.ts`, inside `organization({ schema: { organization: { additionalFields: { ... }}}})`, add this field after `timezone`:

```ts
						fiscalYearStartMonth: {
							type: "number",
							required: false,
							defaultValue: 1,
							input: true,
						},
```

- [ ] **Step 4: Generate auth schema**

Run: `pnpm --dir apps/webapp auth:generate`

Expected: `apps/webapp/src/db/auth-schema.ts` contains `fiscalYearStartMonth: integer("fiscal_year_start_month").default(1)` or the generated Better Auth equivalent.

- [ ] **Step 5: Update store and hydration types**

In `apps/webapp/src/stores/organization-settings-store.ts`, add `fiscalYearStartMonth`:

```ts
export interface OrganizationSettings {
	organizationId: string | null;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	demoDataEnabled: boolean;
	timezone: string;
	fiscalYearStartMonth: number;
	deletedAt: string | null;
	isHydrated: boolean;
}

const initialState: OrganizationSettings = {
	organizationId: null,
	shiftsEnabled: false,
	projectsEnabled: false,
	surchargesEnabled: false,
	demoDataEnabled: true,
	timezone: "UTC",
	fiscalYearStartMonth: 1,
	deletedAt: null,
	isHydrated: false,
};

export const useOrganizationFiscalYearStartMonth = () =>
	useOrganizationSettings((state) => state.fiscalYearStartMonth);
```

In `apps/webapp/src/hooks/use-organization.ts`, extend `OrganizationSettingsResponse`:

```ts
interface OrganizationSettingsResponse {
	organizationId: string;
	shiftsEnabled: boolean;
	projectsEnabled: boolean;
	surchargesEnabled: boolean;
	demoDataEnabled: boolean;
	timezone: string;
	fiscalYearStartMonth: number;
	deletedAt: string | null;
}
```

In `apps/webapp/src/app/api/auth/context/route.ts`, include the column and response field:

```ts
columns: {
	id: true,
	shiftsEnabled: true,
	projectsEnabled: true,
	surchargesEnabled: true,
	demoDataEnabled: true,
	timezone: true,
	fiscalYearStartMonth: true,
	deletedAt: true,
},
```

```ts
organizationSettings = {
	organizationId: org.id,
	shiftsEnabled: org.shiftsEnabled ?? false,
	projectsEnabled: org.projectsEnabled ?? false,
	surchargesEnabled: org.surchargesEnabled ?? false,
	demoDataEnabled: org.demoDataEnabled ?? true,
	timezone: org.timezone ?? "UTC",
	fiscalYearStartMonth: org.fiscalYearStartMonth ?? 1,
	deletedAt: org.deletedAt?.toISOString() ?? null,
};
```

- [ ] **Step 6: Run store test**

Run: `pnpm --dir apps/webapp test src/stores/organization-settings-store.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/webapp/src/lib/auth.ts apps/webapp/src/db/auth-schema.ts apps/webapp/src/app/api/auth/context/route.ts apps/webapp/src/hooks/use-organization.ts apps/webapp/src/stores/organization-settings-store.ts apps/webapp/src/stores/organization-settings-store.test.ts
git commit -m "feat: hydrate organization fiscal year setting"
```

---

### Task 3: Owner-Only Server Action

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`
- Create: `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.fiscal-year.test.ts`

- [ ] **Step 1: Write source-level tests for validation and authorization**

Create `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.fiscal-year.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/app/[locale]/(app)/settings/organizations/actions.ts"), "utf8");

describe("updateOrganizationFiscalYearStartMonth source", () => {
	it("exports an owner-only fiscal year server action", () => {
		expect(source).toContain("export async function updateOrganizationFiscalYearStartMonth");
		expect(source).toContain('if (memberRecord.role !== "owner")');
		expect(source).toContain("Only owners can change organization fiscal year settings");
	});

	it("validates month range before updating", () => {
		expect(source).toContain("Number.isInteger(month)");
		expect(source).toContain("month < 1 || month > 12");
		expect(source).toContain("Invalid fiscal year start month");
	});

	it("updates only fiscalYearStartMonth on the scoped organization", () => {
		expect(source).toContain(".set({ fiscalYearStartMonth: month })");
		expect(source).toContain(".where(eq(authSchema.organization.id, organizationId))");
	});
});
```

- [ ] **Step 2: Run action test to verify it fails**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/settings/organizations/actions.fiscal-year.test.ts'`

Expected: FAIL because the action does not exist.

- [ ] **Step 3: Add the server action**

In `apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts`, add this function after `updateOrganizationTimezone`:

```ts
/**
 * Update organization fiscal year start month.
 * Requires owner role.
 */
export async function updateOrganizationFiscalYearStartMonth(
	organizationId: string,
	month: number,
): Promise<ServerActionResult<void>> {
	const tracer = trace.getTracer("organizations");

	const effect = tracer.startActiveSpan(
		"updateOrganizationFiscalYearStartMonth",
		{
			attributes: {
				"organization.id": organizationId,
				month,
			},
		},
		(span) => {
			return Effect.gen(function* (_) {
				const authService = yield* _(AuthService);
				const session = yield* _(authService.getSession());
				const dbService = yield* _(DatabaseService);

				if (!Number.isInteger(month) || month < 1 || month > 12) {
					yield* _(
						Effect.fail(
							new ValidationError({
								message: "Invalid fiscal year start month",
								field: "fiscalYearStartMonth",
								value: month,
							}),
						),
					);
				}

				const memberRecord = yield* _(
					dbService.query("getCurrentMember", async () => {
						return await db.query.member.findFirst({
							where: and(
								eq(authSchema.member.userId, session.user.id),
								eq(authSchema.member.organizationId, organizationId),
							),
						});
					}),
					Effect.flatMap((member) =>
						member
							? Effect.succeed(member)
							: Effect.fail(
									new NotFoundError({
										message: "You are not a member of this organization",
										entityType: "member",
									}),
								),
					),
				);

				if (memberRecord.role !== "owner") {
					yield* _(
						Effect.fail(
							new AuthorizationError({
								message: "Only owners can change organization fiscal year settings",
								userId: session.user.id,
								resource: "organization",
								action: "update",
							}),
						),
					);
				}

				yield* _(
					Effect.tryPromise({
						try: async () => {
							await db
								.update(authSchema.organization)
								.set({ fiscalYearStartMonth: month })
								.where(eq(authSchema.organization.id, organizationId));
						},
						catch: (error) => {
							return new ValidationError({
								message:
									error instanceof Error
										? error.message
										: "Failed to update organization fiscal year setting",
								field: "fiscalYearStartMonth",
							});
						},
					}),
				);

				logger.info(
					{ organizationId, fiscalYearStartMonth: month },
					`Organization fiscal year start month updated to ${month}`,
				);

				span.setStatus({ code: SpanStatusCode.OK });
			}).pipe(
				Effect.catchAll((error) =>
					Effect.gen(function* (_) {
						span.recordException(error as Error);
						span.setStatus({ code: SpanStatusCode.ERROR, message: String(error) });
						logger.error(
							{ error, organizationId, fiscalYearStartMonth: month },
							"Failed to update organization fiscal year setting",
						);
						return yield* _(Effect.fail(error as AnyAppError));
					}),
				),
				Effect.onExit(() => Effect.sync(() => span.end())),
				Effect.provide(AppLayer),
			);
		},
	);

	return runServerActionSafe(effect);
}
```

- [ ] **Step 4: Run action test**

Run: `pnpm --dir apps/webapp test 'src/app/[locale]/(app)/settings/organizations/actions.fiscal-year.test.ts'`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.fiscal-year.test.ts'
git commit -m "feat: add fiscal year organization action"
```

---

### Task 4: Organization Settings UI

**Files:**
- Create: `apps/webapp/src/components/organization/organization-fiscal-year-card.tsx`
- Create: `apps/webapp/src/components/organization/organization-fiscal-year-card.test.tsx`
- Modify: `apps/webapp/src/components/organization/organization-tab.tsx`

- [ ] **Step 1: Write the failing UI test**

Create `apps/webapp/src/components/organization/organization-fiscal-year-card.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationFiscalYearCard } from "./organization-fiscal-year-card";

const updateOrganizationFiscalYearStartMonth = vi.fn();
const refresh = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string) => fallback }),
}));

vi.mock("@/navigation", () => ({
	useRouter: () => ({ refresh }),
}));

vi.mock("@/app/[locale]/(app)/settings/organizations/actions", () => ({
	updateOrganizationFiscalYearStartMonth: (...args: unknown[]) =>
		updateOrganizationFiscalYearStartMonth(...args),
}));

describe("OrganizationFiscalYearCard", () => {
	beforeEach(() => {
		updateOrganizationFiscalYearStartMonth.mockReset();
		refresh.mockReset();
	});

	it("disables editing for non-owners", () => {
		render(
			<OrganizationFiscalYearCard
				organizationId="org_1"
				fiscalYearStartMonth={1}
				currentMemberRole="admin"
			/>,
		);

		expect(screen.getByRole("combobox", { name: /Fiscal year start month/i })).toBeDisabled();
		expect(screen.getByText("Only organization owners can change the fiscal year setting.")).toBeInTheDocument();
	});

	it("updates fiscal year start month for owners", async () => {
		updateOrganizationFiscalYearStartMonth.mockResolvedValue({ success: true });
		const user = userEvent.setup();

		render(
			<OrganizationFiscalYearCard
				organizationId="org_1"
				fiscalYearStartMonth={1}
				currentMemberRole="owner"
			/>,
		);

		await user.selectOptions(screen.getByRole("combobox", { name: /Fiscal year start month/i }), "4");

		expect(updateOrganizationFiscalYearStartMonth).toHaveBeenCalledWith("org_1", 4);
	});
});
```

- [ ] **Step 2: Run UI test to verify it fails**

Run: `pnpm --dir apps/webapp test src/components/organization/organization-fiscal-year-card.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the card**

Create `apps/webapp/src/components/organization/organization-fiscal-year-card.tsx`:

```tsx
"use client";

import { IconCalendarStats, IconLoader2 } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { updateOrganizationFiscalYearStartMonth } from "@/app/[locale]/(app)/settings/organizations/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useRouter } from "@/navigation";
import { useOrganizationSettings } from "@/stores/organization-settings-store";

const MONTHS = [
	{ value: 1, label: "January" },
	{ value: 2, label: "February" },
	{ value: 3, label: "March" },
	{ value: 4, label: "April" },
	{ value: 5, label: "May" },
	{ value: 6, label: "June" },
	{ value: 7, label: "July" },
	{ value: 8, label: "August" },
	{ value: 9, label: "September" },
	{ value: 10, label: "October" },
	{ value: 11, label: "November" },
	{ value: 12, label: "December" },
];

interface OrganizationFiscalYearCardProps {
	organizationId: string;
	fiscalYearStartMonth: number;
	currentMemberRole: "owner" | "admin" | "member";
}

export function OrganizationFiscalYearCard({
	organizationId,
	fiscalYearStartMonth,
	currentMemberRole,
}: OrganizationFiscalYearCardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const [isPending, startTransition] = useTransition();
	const [month, setMonth] = useState(String(fiscalYearStartMonth || 1));
	const setOrgSettings = useOrganizationSettings((state) => state.setSettings);
	const canEdit = currentMemberRole === "owner";

	const handleMonthChange = async (newValue: string) => {
		if (!canEdit) return;

		const previousMonth = month;
		const nextMonth = Number.parseInt(newValue, 10);

		setMonth(newValue);
		setOrgSettings({ fiscalYearStartMonth: nextMonth });

		const result = await updateOrganizationFiscalYearStartMonth(organizationId, nextMonth);

		if (result.success) {
			toast.success(t("organization.fiscalYear.updated", "Fiscal year setting updated"));
			startTransition(() => {
				router.refresh();
			});
			return;
		}

		setMonth(previousMonth);
		setOrgSettings({ fiscalYearStartMonth: Number.parseInt(previousMonth, 10) });
		toast.error(
			result.error ||
				t("organization.fiscalYear.updateFailed", "Failed to update fiscal year setting"),
		);
	};

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconCalendarStats className="h-5 w-5" aria-hidden="true" />
					{t("organization.fiscalYear.title", "Fiscal year")}
				</CardTitle>
				<CardDescription>
					{t(
						"organization.fiscalYear.description",
						"Set the month your organization's business year starts. Reports, vacation, and carryover calculations use this setting.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex flex-col gap-2">
					<div className="flex items-center justify-between">
						<Label htmlFor="fiscal-year-start-month">
							{t("organization.fiscalYear.startMonth", "Fiscal year start month")}
						</Label>
						{isPending && <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
					</div>
					<Select value={month} onValueChange={handleMonthChange} disabled={!canEdit || isPending}>
						<SelectTrigger id="fiscal-year-start-month" aria-label="Fiscal year start month">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							{MONTHS.map((item) => (
								<SelectItem key={item.value} value={String(item.value)}>
									{item.label}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>

				{!canEdit && (
					<p className="text-xs text-muted-foreground">
						{t(
							"organization.fiscalYear.ownerOnly",
							"Only organization owners can change the fiscal year setting.",
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
```

- [ ] **Step 4: Render the card in the organization tab**

In `apps/webapp/src/components/organization/organization-tab.tsx`, add the import:

```ts
import { OrganizationFiscalYearCard } from "./organization-fiscal-year-card";
```

Render it immediately after `OrganizationTimezoneCard`:

```tsx
<OrganizationFiscalYearCard
	organizationId={organization.id}
	fiscalYearStartMonth={organization.fiscalYearStartMonth ?? 1}
	currentMemberRole={currentMemberRole}
/>
```

- [ ] **Step 5: Run UI test**

Run: `pnpm --dir apps/webapp test src/components/organization/organization-fiscal-year-card.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/components/organization/organization-fiscal-year-card.tsx apps/webapp/src/components/organization/organization-fiscal-year-card.test.tsx apps/webapp/src/components/organization/organization-tab.tsx
git commit -m "feat: add fiscal year organization setting card"
```

---

### Task 5: Fiscal-Aware Report Presets

**Files:**
- Modify: `apps/webapp/src/lib/reports/date-ranges.ts`
- Create or modify: `apps/webapp/src/lib/reports/date-ranges.test.ts`
- Modify: `apps/webapp/src/components/reports/date-range-picker.tsx`
- Modify: `apps/webapp/src/components/reports/report-filters.tsx`
- Modify: `apps/webapp/src/app/[locale]/(app)/analytics/vacation-trends/page.tsx`

- [ ] **Step 1: Write failing report date-range tests**

Create `apps/webapp/src/lib/reports/date-ranges.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { getDateRangeForPreset } from "./date-ranges";

describe("getDateRangeForPreset", () => {
	it("uses fiscal years for current_year", () => {
		vi.setSystemTime(new Date("2026-05-12T12:00:00.000Z"));

		const range = getDateRangeForPreset("current_year", { fiscalYearStartMonth: 4 });

		expect(range.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
		expect(range.end.toISOString()).toBe("2027-03-31T23:59:59.999Z");
	});

	it("uses fiscal year-to-date for ytd", () => {
		vi.setSystemTime(new Date("2026-05-12T12:00:00.000Z"));

		const range = getDateRangeForPreset("ytd", { fiscalYearStartMonth: 4 });

		expect(range.start.toISOString()).toBe("2026-04-01T00:00:00.000Z");
		expect(range.end.toISOString()).toBe("2026-05-12T12:00:00.000Z");
	});

	it("uses previous fiscal year for last_year", () => {
		vi.setSystemTime(new Date("2026-03-31T12:00:00.000Z"));

		const range = getDateRangeForPreset("last_year", { fiscalYearStartMonth: 4 });

		expect(range.start.toISOString()).toBe("2024-04-01T00:00:00.000Z");
		expect(range.end.toISOString()).toBe("2025-03-31T23:59:59.999Z");
	});
});
```

- [ ] **Step 2: Run report tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/reports/date-ranges.test.ts`

Expected: FAIL because `getDateRangeForPreset` does not accept the options object.

- [ ] **Step 3: Update date range utility**

In `apps/webapp/src/lib/reports/date-ranges.ts`, update the signature and year cases:

```ts
import { DateTime } from "luxon";
import {
	getFiscalYearRangeForDate,
	getFiscalYearRangeForLabelYear,
	getFiscalYearToDateRange,
} from "@/lib/fiscal-year";
import type { DateRange, PeriodPreset } from "./types";

interface DateRangePresetOptions {
	year?: number;
	fiscalYearStartMonth?: number;
}

export function getDateRangeForPreset(
	preset: PeriodPreset,
	optionsOrYear?: DateRangePresetOptions | number,
): DateRange {
	const now = DateTime.now();
	const options = typeof optionsOrYear === "number" ? { year: optionsOrYear } : (optionsOrYear ?? {});
	const targetYear = options.year ?? now.year;
	const fiscalYearStartMonth = options.fiscalYearStartMonth ?? 1;

	switch (preset) {
		case "last_year": {
			const currentFiscalYear = getFiscalYearRangeForDate(now, fiscalYearStartMonth);
			const lastFiscalYear = getFiscalYearRangeForLabelYear(
				currentFiscalYear.labelYear - 1,
				fiscalYearStartMonth,
			);
			return { start: lastFiscalYear.start.toJSDate(), end: lastFiscalYear.end.toJSDate() };
		}

		case "current_year": {
			const fiscalYear = getFiscalYearRangeForDate(now, fiscalYearStartMonth);
			return { start: fiscalYear.start.toJSDate(), end: fiscalYear.end.toJSDate() };
		}

		case "ytd": {
			const fiscalYtd = getFiscalYearToDateRange(now, fiscalYearStartMonth);
			return { start: fiscalYtd.start.toJSDate(), end: fiscalYtd.end.toJSDate() };
		}

		case "last_month": {
			const lastMonth = now.minus({ months: 1 });
			return {
				start: lastMonth.startOf("month").toJSDate(),
				end: lastMonth.endOf("month").toJSDate(),
			};
		}

		case "current_month":
			return {
				start: now.startOf("month").toJSDate(),
				end: now.endOf("month").toJSDate(),
			};

		case "q1": {
			const qStart = DateTime.local(targetYear, 1, 1);
			return { start: qStart.startOf("quarter").toJSDate(), end: qStart.endOf("quarter").toJSDate() };
		}

		case "q2": {
			const qStart = DateTime.local(targetYear, 4, 1);
			return { start: qStart.startOf("quarter").toJSDate(), end: qStart.endOf("quarter").toJSDate() };
		}

		case "q3": {
			const qStart = DateTime.local(targetYear, 7, 1);
			return { start: qStart.startOf("quarter").toJSDate(), end: qStart.endOf("quarter").toJSDate() };
		}

		case "q4": {
			const qStart = DateTime.local(targetYear, 10, 1);
			return { start: qStart.startOf("quarter").toJSDate(), end: qStart.endOf("quarter").toJSDate() };
		}

		default:
			return {
				start: now.startOf("month").toJSDate(),
				end: now.endOf("month").toJSDate(),
			};
	}
}
```

Leave the existing `last_month`, `current_month`, `q1`, `q2`, `q3`, `q4`, and default branches exactly as they are in the current file, except for reading `targetYear` from `options.year` instead of the old positional `year` parameter.

- [ ] **Step 4: Wire client report pickers to the store**

In `apps/webapp/src/components/reports/date-range-picker.tsx`, read the setting and pass it to `getDateRangeForPreset`:

```ts
import { useOrganizationFiscalYearStartMonth } from "@/stores/organization-settings-store";

export function DateRangePicker({ value, onChange }: DateRangePickerProps) {
	const fiscalYearStartMonth = useOrganizationFiscalYearStartMonth();

	const handlePresetChange = (newPreset: PeriodPreset) => {
		setPreset(newPreset);

		if (newPreset !== "custom") {
			const range = getDateRangeForPreset(newPreset, { fiscalYearStartMonth });
			onChange(range);
			setIsCalendarOpen(false);
		} else {
			setIsCalendarOpen(true);
		}
	};
}
```

In `apps/webapp/src/components/reports/report-filters.tsx`, initialize with the hydrated setting:

```ts
import { useOrganizationFiscalYearStartMonth } from "@/stores/organization-settings-store";

const fiscalYearStartMonth = useOrganizationFiscalYearStartMonth();
const [dateRange, setDateRange] = useState<DateRange>(() =>
	getDateRangeForPreset("current_month", { fiscalYearStartMonth }),
);
```

In `apps/webapp/src/app/[locale]/(app)/analytics/vacation-trends/page.tsx`, do the same for the `current_year` default:

```ts
import { useOrganizationFiscalYearStartMonth } from "@/stores/organization-settings-store";

const fiscalYearStartMonth = useOrganizationFiscalYearStartMonth();
const [dateRange, setDateRange] = useState<DateRange>(() =>
	getDateRangeForPreset("current_year", { fiscalYearStartMonth }),
);
```

- [ ] **Step 5: Run report tests**

Run: `pnpm --dir apps/webapp test src/lib/reports/date-ranges.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/webapp/src/lib/reports/date-ranges.ts apps/webapp/src/lib/reports/date-ranges.test.ts apps/webapp/src/components/reports/date-range-picker.tsx apps/webapp/src/components/reports/report-filters.tsx 'apps/webapp/src/app/[locale]/(app)/analytics/vacation-trends/page.tsx'
git commit -m "feat: make report year presets fiscal-aware"
```

---

### Task 6: Absence and Vacation Business-Year Boundaries

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/absences/page.tsx`
- Modify: `apps/webapp/src/lib/absences/date-utils.ts`
- Modify: `apps/webapp/src/lib/query/vacation.queries.ts`
- Modify: `apps/webapp/src/lib/absences/vacation.service.ts`
- Modify: `apps/webapp/src/lib/jobs/carryover-automation.ts`

- [ ] **Step 1: Extend absence date utility tests**

Create `apps/webapp/src/lib/absences/date-utils.test.ts` with the imports shown here:

```ts
import { describe, expect, it } from "vitest";
import { calculateCarryoverExpiryDate, getYearRange } from "./date-utils";

describe("absence date utils fiscal year support", () => {
	it("keeps getYearRange calendar-year based by default", () => {
		const range = getYearRange(2026);

		expect(range.start.toISO()).toBe("2026-01-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2026-12-31T23:59:59.999Z");
	});

	it("supports fiscal year ranges when a start month is provided", () => {
		const range = getYearRange(2026, 4);

		expect(range.start.toISO()).toBe("2026-04-01T00:00:00.000Z");
		expect(range.end.toISO()).toBe("2027-03-31T23:59:59.999Z");
	});

	it("calculates carryover expiry from fiscal year start", () => {
		const expiry = calculateCarryoverExpiryDate(2026, 3, 4);

		expect(expiry.toISO()).toBe("2026-06-30T23:59:59.999Z");
	});
});
```

- [ ] **Step 2: Run absence utility tests to verify they fail**

Run: `pnpm --dir apps/webapp test src/lib/absences/date-utils.test.ts`

Expected: FAIL because `getYearRange` and `calculateCarryoverExpiryDate` do not accept fiscal year start months.

- [ ] **Step 3: Update absence date utility wrappers**

In `apps/webapp/src/lib/absences/date-utils.ts`, import fiscal helpers:

```ts
import {
	calculateFiscalCarryoverExpiryDate,
	getFiscalYearRangeForLabelYear,
} from "@/lib/fiscal-year";
```

Update the year range and expiry functions:

```ts
export function getYearRange(
	year: number,
	fiscalYearStartMonth: number | null | undefined = 1,
): { start: DateTime; end: DateTime } {
	const range = getFiscalYearRangeForLabelYear(year, fiscalYearStartMonth);
	return { start: range.start, end: range.end };
}

export function calculateCarryoverExpiryDate(
	year: number,
	expiryMonths: number,
	fiscalYearStartMonth: number | null | undefined = 1,
): DateTime {
	return calculateFiscalCarryoverExpiryDate(year, fiscalYearStartMonth, expiryMonths);
}
```

- [ ] **Step 4: Update vacation queries to accept fiscal range parameters**

In `apps/webapp/src/lib/query/vacation.queries.ts`, import the utility:

```ts
import { getFiscalYearRangeForLabelYear } from "@/lib/fiscal-year";
```

Update legacy helpers so callers can pass fiscal start month without breaking existing callers:

```ts
export async function getVacationAllowance(
	organizationId: string,
	year: number,
	fiscalYearStartMonth: number | null | undefined = 1,
): Promise<VacationAllowanceRecord | null> {
	const { start } = getFiscalYearRangeForLabelYear(year, fiscalYearStartMonth);
	return getActivePolicyForDate(organizationId, start.toISODate()!);
}

export async function getVacationAllowanceRange(
	organizationId: string,
	startYear: number,
	endYear: number,
	fiscalYearStartMonth: number | null | undefined = 1,
): Promise<VacationAllowanceRecord[]> {
	const startRange = getFiscalYearRangeForLabelYear(startYear, fiscalYearStartMonth);
	const endRange = getFiscalYearRangeForLabelYear(endYear, fiscalYearStartMonth);
	return getPoliciesInDateRange(organizationId, startRange.start.toISODate()!, endRange.end.toISODate()!);
}

export async function getVacationTakenInYear(
	employeeId: string,
	year: number,
	fiscalYearStartMonth: number | null | undefined = 1,
): Promise<VacationTakenResult> {
	const { start, end } = getFiscalYearRangeForLabelYear(year, fiscalYearStartMonth);
	const startOfYear = start.toISODate()!;
	const endOfYear = end.toISODate()!;

	const entries = await db
		.select({
			id: absenceEntry.id,
			startDate: absenceEntry.startDate,
			startPeriod: absenceEntry.startPeriod,
			endDate: absenceEntry.endDate,
			endPeriod: absenceEntry.endPeriod,
			status: absenceEntry.status,
			countsAgainstVacation: absenceCategory.countsAgainstVacation,
		})
		.from(absenceEntry)
		.innerJoin(absenceCategory, eq(absenceEntry.categoryId, absenceCategory.id))
		.where(
			and(
				eq(absenceEntry.employeeId, employeeId),
				eq(absenceEntry.status, "approved"),
				eq(absenceCategory.countsAgainstVacation, true),
				gte(absenceEntry.startDate, startOfYear),
				lte(absenceEntry.startDate, endOfYear),
			),
		);

	const result = entries.map((entry) => {
		const days = calculateBusinessDaysWithHalfDays(
			entry.startDate,
			entry.startPeriod,
			entry.endDate,
			entry.endPeriod,
			[],
		);
		return {
			id: entry.id,
			startDate: entry.startDate,
			startPeriod: entry.startPeriod,
			endDate: entry.endDate,
			endPeriod: entry.endPeriod,
			status: entry.status,
			days,
		};
	});

	return {
		totalDays: result.reduce((sum, e) => sum + e.days, 0),
		entries: result,
	};
}
```

Replace `getCarryoverBalance` with this fiscal-aware version:

```ts
export async function getCarryoverBalance(
	employeeId: string,
	year: number,
	currentDate: Date = new Date(),
	fiscalYearStartMonth: number | null | undefined = 1,
): Promise<CarryoverBalanceResult> {
	const allowance = await getEmployeeVacationAllowance(employeeId, year);

	if (!allowance?.customCarryoverDays) {
		return { balance: 0, expiresAt: null, isExpired: false };
	}

	const emp = await db.query.employee.findFirst({
		where: eq(employee.id, employeeId),
	});

	if (!emp) {
		return { balance: 0, expiresAt: null, isExpired: false };
	}

	const policy = await getVacationAllowance(emp.organizationId, year, fiscalYearStartMonth);
	const carryoverDays = parseFloat(allowance.customCarryoverDays);

	if (!policy?.carryoverExpiryMonths) {
		return { balance: carryoverDays, expiresAt: null, isExpired: false };
	}

	const expiresAt = calculateFiscalCarryoverExpiryDate(
		year,
		fiscalYearStartMonth,
		policy.carryoverExpiryMonths,
	).toJSDate();
	const isExpired = currentDate > expiresAt;

	return {
		balance: isExpired ? 0 : carryoverDays,
		expiresAt,
		isExpired,
	};
}
```

Replace `getEmployeesWithExpiringCarryover` with this fiscal-aware version:

```ts
export async function getEmployeesWithExpiringCarryover(
	organizationId: string,
	year: number,
	daysUntilExpiry: number = 30,
	fiscalYearStartMonth: number | null | undefined = 1,
): Promise<
	Array<{
		employeeId: string;
		employeeName: string;
		carryoverDays: number;
		expiresAt: Date;
		daysUntilExpiry: number;
	}>
> {
	const policy = await getVacationAllowance(organizationId, year, fiscalYearStartMonth);

	if (!policy?.allowCarryover || !policy.carryoverExpiryMonths) {
		return [];
	}

	const expiresAt = calculateFiscalCarryoverExpiryDate(
		year,
		fiscalYearStartMonth,
		policy.carryoverExpiryMonths,
	).toJSDate();
	const now = new Date();
	const maxDate = new Date(now);
	maxDate.setDate(maxDate.getDate() + daysUntilExpiry);

	if (expiresAt > maxDate || expiresAt < now) {
		return [];
	}

	const allowances = await getAllEmployeeVacationAllowances(organizationId, year);

	return allowances
		.filter((a) => a.customCarryoverDays && parseFloat(a.customCarryoverDays) > 0)
		.map((a) => ({
			employeeId: a.employeeId,
			employeeName: a.employeeName || "Unknown",
			carryoverDays: parseFloat(a.customCarryoverDays || "0"),
			expiresAt,
			daysUntilExpiry: Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
		}));
}
```

- [ ] **Step 5: Update vacation service and carryover job to read organization fiscal setting**

In `apps/webapp/src/lib/absences/vacation.service.ts`, import `organization` and fiscal helpers:

```ts
import { organization } from "@/db/auth-schema";
import { getCurrentFiscalYearLabel } from "@/lib/fiscal-year";
```

Add a local helper near the logger:

```ts
async function getOrganizationFiscalYearStartMonth(organizationId: string): Promise<number> {
	const org = await db.query.organization.findFirst({
		where: eq(organization.id, organizationId),
		columns: { fiscalYearStartMonth: true },
	});

	return org?.fiscalYearStartMonth ?? 1;
}
```

In `expireCarryoverDays`, replace `const currentYear = currentDate.getFullYear();` with:

```ts
const fiscalYearStartMonth = await getOrganizationFiscalYearStartMonth(organizationId);
const currentYear = getCurrentFiscalYearLabel(DateTime.fromJSDate(currentDate, { zone: "UTC" }), fiscalYearStartMonth);
```

Then pass `fiscalYearStartMonth` into `getVacationAllowance`, `calculateCarryoverExpiryDate`, and `getEmployeesWithVacationData` call sites that work on the current business year.

In `apps/webapp/src/lib/jobs/carryover-automation.ts`, when iterating each organization, use `org.fiscalYearStartMonth ?? 1` to decide the fiscal year label and pass it into vacation helper calls. Keep the public `targetYear` parameter as the fiscal label year.

- [ ] **Step 6: Update absences page fiscal-year loading**

In `apps/webapp/src/app/[locale]/(app)/absences/page.tsx`, import `DateTime`, `eq`, `organization`, and fiscal helper as needed. Fetch organization fiscal month after `employee` is loaded:

```ts
const org = await db.query.organization.findFirst({
	where: eq(organization.id, employee.organizationId),
	columns: { fiscalYearStartMonth: true },
});
const fiscalYear = getFiscalYearRangeForDate(DateTime.utc(), org?.fiscalYearStartMonth ?? 1);
const currentYear = fiscalYear.labelYear;
const startOfYear = fiscalYear.start.toISODate()!;
const endOfYear = fiscalYear.end.toISODate()!;
const yearStart = fiscalYear.start.toJSDate();
const yearEnd = fiscalYear.end.toJSDate();
```

Keep `AbsencesViewContainer currentYear={currentYear}` so vacation balance and annual labels use the fiscal label year.

- [ ] **Step 7: Run absence/vacation tests**

Run: `pnpm --dir apps/webapp test src/lib/absences/date-utils.test.ts src/lib/fiscal-year.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add 'apps/webapp/src/app/[locale]/(app)/absences/page.tsx' apps/webapp/src/lib/absences/date-utils.ts apps/webapp/src/lib/absences/date-utils.test.ts apps/webapp/src/lib/query/vacation.queries.ts apps/webapp/src/lib/absences/vacation.service.ts apps/webapp/src/lib/jobs/carryover-automation.ts
git commit -m "feat: apply fiscal years to absence vacation boundaries"
```

---

### Task 7: Final Verification

**Files:**
- No planned source changes unless verification finds failures.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm --dir apps/webapp test src/lib/fiscal-year.test.ts src/lib/reports/date-ranges.test.ts src/stores/organization-settings-store.test.ts src/components/organization/organization-fiscal-year-card.test.tsx 'src/app/[locale]/(app)/settings/organizations/actions.fiscal-year.test.ts' src/lib/absences/date-utils.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run broader test suite**

Run: `pnpm --dir apps/webapp test`

Expected: PASS.

- [ ] **Step 3: Run production build**

Run: `CI=true pnpm --dir apps/webapp build`

Expected: PASS. If this fails due missing Phase CLI secrets or database environment variables, do not invent env vars; record the skipped build and exact missing variables in the final response.

- [ ] **Step 4: Inspect git status**

Run: `git status --short`

Expected: only intentional files are modified, with any unrelated pre-existing holiday changes still untouched.

- [ ] **Step 5: Commit verification fixes if needed**

If verification required fixes, commit only the files changed for this fiscal-year feature:

```bash
git add apps/webapp/src/lib/fiscal-year.ts apps/webapp/src/lib/fiscal-year.test.ts apps/webapp/src/lib/auth.ts apps/webapp/src/db/auth-schema.ts apps/webapp/src/app/api/auth/context/route.ts apps/webapp/src/hooks/use-organization.ts apps/webapp/src/stores/organization-settings-store.ts apps/webapp/src/stores/organization-settings-store.test.ts 'apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.ts' 'apps/webapp/src/app/[locale]/(app)/settings/organizations/actions.fiscal-year.test.ts' apps/webapp/src/components/organization/organization-fiscal-year-card.tsx apps/webapp/src/components/organization/organization-fiscal-year-card.test.tsx apps/webapp/src/components/organization/organization-tab.tsx apps/webapp/src/lib/reports/date-ranges.ts apps/webapp/src/lib/reports/date-ranges.test.ts apps/webapp/src/components/reports/date-range-picker.tsx apps/webapp/src/components/reports/report-filters.tsx 'apps/webapp/src/app/[locale]/(app)/analytics/vacation-trends/page.tsx' 'apps/webapp/src/app/[locale]/(app)/absences/page.tsx' apps/webapp/src/lib/absences/date-utils.ts apps/webapp/src/lib/absences/date-utils.test.ts apps/webapp/src/lib/query/vacation.queries.ts apps/webapp/src/lib/absences/vacation.service.ts apps/webapp/src/lib/jobs/carryover-automation.ts
git commit -m "fix: stabilize fiscal year setting implementation"
```

Expected: commit succeeds. Do not stage or commit unrelated holiday preset files.

---

## Self-Review

- Spec coverage: the plan covers persistence, owner-only permissions, organization settings UI, hydration, fiscal range utility, report presets, absence page annual loading, vacation/carryover boundaries, error handling, and focused tests.
- Scope: the plan keeps visual calendars, holiday imports, generic date pickers, and historical data migration out of scope.
- Type consistency: the setting name is consistently `fiscalYearStartMonth`; the database column is generated as `fiscal_year_start_month`; the server action is `updateOrganizationFiscalYearStartMonth`.
- Multi-tenancy: every database read/write is scoped by `organizationId`, active organization context, or current organization membership.
