# Calendar Employee Route Manual Entry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/calendar` route-owned for selected employees and allow day/week grid range selection to prefill manual entries, including approved manager-created staff entries.

**Architecture:** Reuse the existing calendar data API, employee selector, Schedule-X wrapper, and manual time entry sheet. Add a dynamic calendar route that passes `initialSelectedEmployeeId`, make employee selection navigate between routes, add a small calendar selection bridge, and extend the canonical manual entry server action to optionally target an authorized staff employee.

**Tech Stack:** Next.js App Router, React client components, Schedule-X, TanStack Form, TanStack Query, Drizzle ORM, Luxon, Vitest, Testing Library, pnpm.

---

## File Structure

- Modify `apps/webapp/src/app/[locale]/(app)/calendar/page.tsx`: export shared `CalendarPageContent` with optional `selectedEmployeeId` and keep `/calendar` as own-calendar route.
- Create `apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]/page.tsx`: parse the employee UUID route segment and render shared calendar content.
- Modify `apps/webapp/src/components/calendar/calendar-view.tsx`: accept `initialSelectedEmployeeId`, derive selected employee display data, navigate on employee changes, and open `ManualTimeEntryDialog` from selected ranges.
- Modify `apps/webapp/src/components/calendar/calendar-employee-selector.tsx`: pass selected employee metadata to the parent when the selector changes.
- Modify `apps/webapp/src/components/calendar/schedule-x-wrapper.tsx`: pass a new `onTimeRangeSelect` callback through the dynamic wrapper.
- Modify `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`: detect empty time-grid pointer selections in day/week view and emit normalized `{ start, end }` dates.
- Modify `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx`: support optional controlled open state, hidden trigger mode, default date/times, target employee label, and target employee submission.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts`: add optional `employeeId` to `ManualTimeEntryInput`.
- Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`: resolve authorized target employee, use target context for manual entries, and skip approval for manager-on-behalf entries.
- Modify tests near the touched code: `calendar-view.test.tsx`, `manual-time-entry-dialog` test if present or create one, and `actions/clocking.test.ts`.

---

### Task 1: Route-Owned Calendar Employee Selection

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/calendar/page.tsx`
- Create: `apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]/page.tsx`
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx`
- Modify: `apps/webapp/src/components/calendar/calendar-employee-selector.tsx`
- Test: `apps/webapp/src/components/calendar/calendar-view.test.tsx`

- [ ] **Step 1: Write failing tests for initial selected employee and route navigation**

Update `apps/webapp/src/components/calendar/calendar-view.test.tsx` so the mocks capture filters and employee changes:

```tsx
/** @vitest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { CalendarFilters } from "@/hooks/use-calendar-data";
import { CalendarView } from "./calendar-view";

const refetch = vi.fn();
const push = vi.fn();
let latestFilters: CalendarFilters | null = null;

vi.mock("@/navigation", () => ({
	useRouter: () => ({ push }),
}));

vi.mock("@/hooks/use-organization", () => ({
	useOrganization: () => ({ isManagerOrAbove: true }),
}));

vi.mock("@/hooks/use-calendar-data", () => ({
	useCalendarData: ({ filters }: { filters: CalendarFilters }) => {
		latestFilters = filters;
		return {
			events: [],
			dailyRequirements: {},
			dailyActualMinutes: {},
			workBalance: null,
			isLoading: false,
			error: null,
			refetch,
		};
	},
}));

vi.mock("@/components/work-balance/work-balance-card", () => ({
	WorkBalanceCard: () => <div data-testid="work-balance-card" />,
}));

vi.mock("./calendar-employee-selector", () => ({
	CalendarEmployeeSelector: ({ onEmployeeChange }: { onEmployeeChange: (employeeId: string | null) => void }) => (
		<div data-testid="employee-selector">
			<button type="button" onClick={() => onEmployeeChange("employee-2")}>Select staff</button>
			<button type="button" onClick={() => onEmployeeChange("employee-1")}>Select me</button>
		</div>
	),
}));

vi.mock("./calendar-filters", () => ({
	CalendarFiltersComponent: () => <div data-testid="calendar-filters" />,
}));

vi.mock("./calendar-legend", () => ({
	CalendarLegend: () => <div data-testid="calendar-legend" />,
}));

vi.mock("./event-details-panel", () => ({
	EventDetailsPanel: () => <div data-testid="event-details" />,
}));

vi.mock("./work-period-edit-dialog", () => ({
	WorkPeriodEditDialog: () => <div data-testid="work-period-edit" />,
}));

vi.mock("./split-work-period-dialog", () => ({
	SplitWorkPeriodDialog: () => <div data-testid="split-work-period" />,
}));

vi.mock("./delete-work-period-dialog", () => ({
	DeleteWorkPeriodDialog: () => <div data-testid="delete-work-period" />,
}));

vi.mock("./year-calendar-view", () => ({
	YearCalendarView: () => <div data-testid="year-calendar-view" />,
}));

vi.mock("./schedule-x-wrapper", () => ({
	ScheduleXWrapper: ({ onViewModeChange, viewMode }: { onViewModeChange: (mode: "month") => void; viewMode: string }) => (
		<div data-testid="schedule-x-wrapper" data-view-mode={viewMode}>
			<button type="button" onClick={() => onViewModeChange("month")}>Month</button>
		</div>
	),
}));

vi.mock("./month-work-summary-view", () => ({
	MonthWorkSummaryView: ({ onRefresh, viewMode }: { onRefresh: () => void; viewMode: string }) => (
		<div data-testid="month-work-summary-view" data-view-mode={viewMode}>
			<button type="button" onClick={onRefresh}>Refresh month</button>
		</div>
	),
}));

describe("CalendarView", () => {
	beforeEach(() => {
		latestFilters = null;
		push.mockClear();
		refetch.mockClear();
	});

	it("initializes filters from the route-selected employee", () => {
		render(
			<CalendarView
				organizationId="org-1"
				currentEmployeeId="employee-1"
				initialSelectedEmployeeId="employee-2"
			/>,
		);

		expect(latestFilters?.employeeId).toBe("employee-2");
	});

	it("navigates staff selection to the employee calendar route", () => {
		render(<CalendarView organizationId="org-1" currentEmployeeId="employee-1" />);

		fireEvent.click(screen.getByRole("button", { name: "Select staff" }));

		expect(push).toHaveBeenCalledWith("/calendar/employee-2");
		expect(latestFilters?.employeeId).toBe("employee-2");
	});

	it("navigates own selection back to /calendar", () => {
		render(
			<CalendarView
				organizationId="org-1"
				currentEmployeeId="employee-1"
				initialSelectedEmployeeId="employee-2"
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "Select me" }));

		expect(push).toHaveBeenCalledWith("/calendar");
		expect(latestFilters?.employeeId).toBe("employee-1");
	});

	it("renders the work summary month view outside Schedule-X when month mode is selected", () => {
		render(<CalendarView organizationId="org-1" currentEmployeeId="employee-1" />);

		fireEvent.click(screen.getByRole("button", { name: "Month" }));

		expect(screen.getByTestId("month-work-summary-view").getAttribute("data-view-mode")).toBe("month");
		expect(screen.getByTestId("work-balance-card")).toBeTruthy();
		expect(screen.queryByTestId("schedule-x-wrapper")).toBeNull();

		fireEvent.click(screen.getByRole("button", { name: "Refresh month" }));

		expect(refetch).toHaveBeenCalledTimes(1);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/webapp/src/components/calendar/calendar-view.test.tsx`

Expected: FAIL because `CalendarView` does not accept `initialSelectedEmployeeId` and does not use `useRouter`.

- [ ] **Step 3: Add shared page content and dynamic route**

Replace `apps/webapp/src/app/[locale]/(app)/calendar/page.tsx` with:

```tsx
import { connection } from "next/server";
import { Suspense } from "react";
import { CalendarView } from "@/components/calendar/calendar-view";
import { NoEmployeeError } from "@/components/errors/no-employee-error";
import { Skeleton } from "@/components/ui/skeleton";
import { getAuthContext } from "@/lib/auth-helpers";

export async function CalendarPageContent({ selectedEmployeeId }: { selectedEmployeeId?: string }) {
	await connection();

	const authContext = await getAuthContext();

	if (!authContext?.employee) {
		return (
			<div className="flex flex-1 items-center justify-center p-6">
				<NoEmployeeError feature="view the calendar" />
			</div>
		);
	}

	return (
		<CalendarView
			organizationId={authContext.employee.organizationId}
			currentEmployeeId={authContext.employee.id}
			initialSelectedEmployeeId={selectedEmployeeId}
		/>
	);
}

function CalendarPageLoading() {
	return (
		<div className="flex flex-1 flex-col p-4">
			<div className="space-y-4">
				<Skeleton className="h-8 w-52" />
				<Skeleton className="h-5 w-80" />
				<Skeleton className="h-[560px] w-full" />
			</div>
		</div>
	);
}

export default function CalendarPage() {
	return (
		<Suspense fallback={<CalendarPageLoading />}>
			<CalendarPageContent />
		</Suspense>
	);
}
```

Create `apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]/page.tsx`:

```tsx
import { Suspense } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { CalendarPageContent } from "../page";

function CalendarPageLoading() {
	return (
		<div className="flex flex-1 flex-col p-4">
			<div className="space-y-4">
				<Skeleton className="h-8 w-52" />
				<Skeleton className="h-5 w-80" />
				<Skeleton className="h-[560px] w-full" />
			</div>
		</div>
	);
}

export default async function EmployeeCalendarPage({ params }: { params: Promise<{ employeeId: string }> }) {
	const { employeeId } = await params;

	return (
		<Suspense fallback={<CalendarPageLoading />}>
			<CalendarPageContent selectedEmployeeId={employeeId} />
		</Suspense>
	);
}
```

- [ ] **Step 4: Update employee selector callback signature**

Modify `apps/webapp/src/components/calendar/calendar-employee-selector.tsx`:

```tsx
import { useTranslate } from "@tolgee/react";
import { EmployeeSingleSelect } from "@/components/employee-select";
import type { SelectableEmployee } from "@/components/employee-select/types";
import { Skeleton } from "@/components/ui/skeleton";
import { useCalendarEmployees } from "@/hooks/use-calendar-employees";

interface CalendarEmployeeSelectorProps {
	currentEmployeeId?: string;
	selectedEmployeeId: string | null;
	onEmployeeChange: (employeeId: string | null, employee?: SelectableEmployee) => void;
	isManagerOrAbove: boolean;
}

export function CalendarEmployeeSelector({
	currentEmployeeId,
	selectedEmployeeId,
	onEmployeeChange,
	isManagerOrAbove,
}: CalendarEmployeeSelectorProps) {
	const { t } = useTranslate();
	const { employees, isLoading, error } = useCalendarEmployees(currentEmployeeId);

	if (!isManagerOrAbove) return null;

	if (isLoading) {
		return (
			<div className="space-y-2">
				<Skeleton className="h-4 w-24" />
				<Skeleton className="h-10 w-full" />
			</div>
		);
	}

	if (error) {
		return <div className="text-sm text-muted-foreground">{t("calendar.employeeSelector.error", "Unable to load team members")}</div>;
	}

	if (employees.length <= 1) {
		return <div className="text-sm text-muted-foreground">{t("calendar.employeeSelector.myCalendar", "My Calendar")}</div>;
	}

	return (
		<EmployeeSingleSelect
			value={selectedEmployeeId}
			onChange={(employeeId) => onEmployeeChange(employeeId, employees.find((employee) => employee.id === employeeId))}
			employees={employees}
			showFilters={false}
			label={t("calendar.employeeSelector.label", "View Calendar")}
			placeholder={t("calendar.employeeSelector.placeholder", "Select team member...")}
			className="w-full"
		/>
	);
}
```

- [ ] **Step 5: Update CalendarView routing state**

Modify `apps/webapp/src/components/calendar/calendar-view.tsx` imports and state:

```tsx
import { useState } from "react";
import { WorkBalanceCard } from "@/components/work-balance/work-balance-card";
import type { SelectableEmployee } from "@/components/employee-select/types";
import type { CalendarFilters } from "@/hooks/use-calendar-data";
import { useCalendarData } from "@/hooks/use-calendar-data";
import { useOrganization } from "@/hooks/use-organization";
import type { CalendarEvent } from "@/lib/calendar/types";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import { buildDailyWorkHoursSummaries } from "@/lib/calendar/work-hours-summary";
import { useRouter } from "@/navigation";
```

Update props and selected employee initialization:

```tsx
interface CalendarViewProps {
	organizationId: string;
	currentEmployeeId?: string;
	initialSelectedEmployeeId?: string;
}

export function CalendarView({ organizationId, currentEmployeeId, initialSelectedEmployeeId }: CalendarViewProps) {
	const { isManagerOrAbove } = useOrganization();
	const router = useRouter();
	const initialEmployeeId = initialSelectedEmployeeId ?? currentEmployeeId ?? null;
	const [viewMode, setViewMode] = useState<ViewMode>("week");
	const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(initialEmployeeId);
	const [selectedEmployeeName, setSelectedEmployeeName] = useState<string | null>(null);
	const [currentMonth, setCurrentMonth] = useState<Date>(new Date());
	const [currentYear, setCurrentYear] = useState<number>(() => new Date().getFullYear());
	const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
	const [showSplitDialog, setShowSplitDialog] = useState(false);
	const [showDeleteDialog, setShowDeleteDialog] = useState(false);
	const [filters, setFilters] = useState<CalendarFilters>({
		showHolidays: true,
		showAbsences: true,
		showTimeEntries: false,
		showWorkPeriods: true,
		employeeId: initialEmployeeId ?? undefined,
	});
```

Replace `handleEmployeeChange`:

```tsx
	const handleEmployeeChange = (employeeId: string | null, employee?: SelectableEmployee) => {
		const nextEmployeeId = employeeId ?? currentEmployeeId ?? null;
		setSelectedEmployeeId(nextEmployeeId);
		setSelectedEmployeeName(employee ? buildAuthUserDisplayName(employee.user) : null);
		setFilters((prev) => ({ ...prev, employeeId: nextEmployeeId ?? undefined }));

		if (!nextEmployeeId || nextEmployeeId === currentEmployeeId) {
			router.push("/calendar");
			return;
		}

		router.push(`/calendar/${nextEmployeeId}`);
	};
```

Do not add `ManualTimeEntryDialog` in this task. It is added in Task 4 after Task 2 extends the dialog props.

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm vitest run apps/webapp/src/components/calendar/calendar-view.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/webapp/src/app/[locale]/(app)/calendar/page.tsx apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]/page.tsx apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/calendar-employee-selector.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx
git commit -m "feat: persist calendar employee selection in route"
```

Expected: commit succeeds with only the listed files.

---

### Task 2: Manual Entry Sheet Defaults And Target Employee

**Files:**
- Modify: `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx`
- Test: `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx`

- [ ] **Step 1: Create failing tests for defaults, hidden trigger, and target employee submission**

Create `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx`:

```tsx
/** @vitest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { ManualTimeEntryDialog } from "./manual-time-entry-dialog";

const createManualTimeEntry = vi.fn();
const refresh = vi.fn();

vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({ t: (_key: string, fallback: string, values?: Record<string, string>) => fallback.replace("{employee}", values?.employee ?? "") }),
}));

vi.mock("@/navigation", () => ({ useRouter: () => ({ refresh }) }));
vi.mock("@/components/providers/user-preferences-provider", () => ({ useTimeFormat: () => "24h" }));
vi.mock("@/lib/time-tracking/timezone-utils", () => ({
	formatTimeInZone: (_value: string) => "09:00",
	getTimezoneAbbreviation: () => "UTC",
}));
vi.mock("@/components/time-tracking/project-selector", () => ({ ProjectSelector: () => <div data-testid="project-selector" /> }));
vi.mock("@/components/time-tracking/work-category-selector", () => ({ WorkCategorySelector: () => <div data-testid="work-category-selector" /> }));
vi.mock("@/app/[locale]/(app)/time-tracking/actions", () => ({
	createManualTimeEntry: (...args: unknown[]) => createManualTimeEntry(...args),
}));

describe("ManualTimeEntryDialog", () => {
	beforeEach(() => {
		createManualTimeEntry.mockResolvedValue({ success: true, data: { requiresApproval: false } });
		createManualTimeEntry.mockClear();
		refresh.mockClear();
	});

	it("renders without trigger and pre-fills range defaults when controlled open", () => {
		render(
			<ManualTimeEntryDialog
				employeeId="employee-2"
				employeeTimezone="UTC"
				hasManager={false}
				open
				onOpenChange={() => undefined}
				hideTrigger
				targetEmployeeId="employee-2"
				targetEmployeeName="Jane Doe"
				defaultDate="2026-05-29"
				defaultClockInTime="10:15"
				defaultClockOutTime="12:45"
			/>,
		);

		expect(screen.queryByRole("button", { name: "Add Manual Entry" })).toBeNull();
		expect(screen.getByText("Add Manual Time Entry for Jane Doe")).toBeTruthy();
		expect(screen.getByDisplayValue("2026-05-29")).toBeTruthy();
		expect(screen.getByDisplayValue("10:15")).toBeTruthy();
		expect(screen.getByDisplayValue("12:45")).toBeTruthy();
	});

	it("submits target employee id with manual entry data", async () => {
		render(
			<ManualTimeEntryDialog
				employeeId="employee-2"
				employeeTimezone="UTC"
				hasManager={false}
				open
				onOpenChange={() => undefined}
				hideTrigger
				targetEmployeeId="employee-2"
				defaultDate="2026-05-29"
				defaultClockInTime="10:15"
				defaultClockOutTime="12:45"
			/>,
		);

		fireEvent.change(screen.getByLabelText("Reason"), { target: { value: "Forgot to clock in" } });
		fireEvent.click(screen.getByRole("button", { name: "Create Entry" }));

		await waitFor(() => expect(createManualTimeEntry).toHaveBeenCalled());
		expect(createManualTimeEntry).toHaveBeenCalledWith(
			expect.objectContaining({
				employeeId: "employee-2",
				date: "2026-05-29",
				clockInTime: "10:15",
				clockOutTime: "12:45",
				reason: "Forgot to clock in",
			}),
		);
	});
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx`

Expected: FAIL because the component does not accept the new props or submit `employeeId`.

- [ ] **Step 3: Implement controlled/default/target props**

Modify `apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx` props:

```tsx
interface Props {
	employeeId: string;
	employeeTimezone: string;
	hasManager: boolean;
	onSuccess?: () => void;
	targetEmployeeId?: string;
	targetEmployeeName?: string;
	defaultDate?: string;
	defaultClockInTime?: string;
	defaultClockOutTime?: string;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	hideTrigger?: boolean;
}
```

Update destructuring and open state:

```tsx
export function ManualTimeEntryDialog({
	employeeId,
	employeeTimezone,
	hasManager: _hasManager,
	onSuccess,
	targetEmployeeId,
	targetEmployeeName,
	defaultDate,
	defaultClockInTime,
	defaultClockOutTime,
	open: controlledOpen,
	onOpenChange,
	hideTrigger = false,
}: Props) {
	const { t } = useTranslate();
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const open = controlledOpen ?? uncontrolledOpen;
	const router = useRouter();
	const timeFormat = useTimeFormat();
	const timezoneAbbr = getTimezoneAbbreviation(employeeTimezone);
```

Update `getDefaultValues`:

```tsx
	const getDefaultValues = (): FormValues => {
		const today = DateTime.now().setZone(employeeTimezone).toISODate() || "";
		return {
			date: defaultDate ?? today,
			clockInTime: defaultClockInTime ?? "09:00",
			clockOutTime: defaultClockOutTime ?? "17:00",
			reason: "",
			projectId: undefined,
			workCategoryId: undefined,
		};
	};
```

Update server action call:

```tsx
			const result = await createManualTimeEntry({
				employeeId: targetEmployeeId,
				date: value.date,
				clockInTime: value.clockInTime,
				clockOutTime: value.clockOutTime,
				reason: value.reason,
				projectId: value.projectId,
				workCategoryId: value.workCategoryId,
			});
```

Update open change:

```tsx
	const handleOpenChange = (isOpen: boolean) => {
		if (isOpen) form.reset(getDefaultValues());
		if (controlledOpen === undefined) setUncontrolledOpen(isOpen);
		onOpenChange?.(isOpen);
	};
```

Wrap the trigger so it can be hidden:

```tsx
		<ActionPanel open={open} onOpenChange={handleOpenChange}>
			{!hideTrigger && (
				<ActionPanelTrigger asChild>
					<Button aria-label={t("timeTracking.manualEntry.addButton", "Add Manual Entry")} className="size-8" variant="outline" size="icon">
						<IconPlus aria-hidden="true" className="size-4" />
					</Button>
				</ActionPanelTrigger>
			)}
```

Update the title:

```tsx
					<ActionPanelTitle>
						{targetEmployeeName
							? t("timeTracking.manualEntry.titleForEmployee", "Add Manual Time Entry for {employee}", { employee: targetEmployeeName })
							: t("timeTracking.manualEntry.title", "Add Manual Time Entry")}
					</ActionPanelTitle>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 5: Run existing calendar test after prop changes**

Run: `pnpm vitest run apps/webapp/src/components/calendar/calendar-view.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

Run:

```bash
git add apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx
git commit -m "feat: prefill manual entry sheet from calendar"
```

Expected: commit succeeds.

---

### Task 3: Manager-On-Behalf Manual Entry Action

**Files:**
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts`
- Modify: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`
- Test: `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts`

- [ ] **Step 1: Write failing action tests**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts`, add tests inside the existing `describe("createManualTimeEntry", ...)` block. Use the file's existing mocks and fixtures; add these assertions to the nearest compatible setup:

```ts
it("creates manager staff manual entries as approved without approval requests", async () => {
	const result = await createManualTimeEntry({
		employeeId: "staff-employee-id",
		date: "2026-05-20",
		clockInTime: "09:00",
		clockOutTime: "11:00",
		reason: "Manager correction",
	});

	expect(result.success).toBe(true);
	expect(db.insert).toHaveBeenCalledWith(workPeriod);
	expect(insertedWorkPeriodValues).toEqual(
		expect.objectContaining({
			employeeId: "staff-employee-id",
			approvalStatus: "approved",
			pendingChanges: null,
		}),
	);
	expect(createManualEntryApprovalRequest).not.toHaveBeenCalled();
});

it("rejects manual entries for unauthorized target employees", async () => {
	mockManagedEmployeeIds([]);

	const result = await createManualTimeEntry({
		employeeId: "staff-employee-id",
		date: "2026-05-20",
		clockInTime: "09:00",
		clockOutTime: "11:00",
		reason: "Manager correction",
	});

	expect(result).toEqual({ success: false, error: "Not authorized to create time entries for this employee" });
});
```

If the current test file has different mock helper names, create local helpers in the test file with these exact behaviors:

```ts
function mockManagedEmployeeIds(employeeIds: string[]) {
	vi.mocked(db.query.employeeManagers.findMany).mockResolvedValue(employeeIds.map((employeeId) => ({ employeeId })));
}

let insertedWorkPeriodValues: unknown;
vi.mocked(db.insert).mockImplementation((table) => ({
	values: (values: unknown) => {
		if (table === workPeriod) insertedWorkPeriodValues = values;
		return { returning: async () => [{ id: "work-period-id", ...(values as object) }] };
	},
}) as never);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts -- createManualTimeEntry`

Expected: FAIL because `ManualTimeEntryInput` lacks `employeeId`, the action always uses the current employee, and approval is not skipped for manager targets.

- [ ] **Step 3: Add optional employeeId to input type**

Modify `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts`:

```ts
export interface ManualTimeEntryInput {
	employeeId?: string;
	date: string;
	clockInTime: string;
	clockOutTime: string;
	reason: string;
	projectId?: string;
	workCategoryId?: string;
}
```

- [ ] **Step 4: Implement target employee authorization helper**

In `apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts`, update imports:

```ts
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { employee, employeeManagers, workPeriod } from "@/db/schema";
import { asAppSubject, defineAbilityFor, type PrincipalContext } from "@/lib/authorization";
```

Add below `const APPROVAL_POLICY_CHECK_ERROR`:

```ts
type ManualEntryEmployeeContext = {
	id: string;
	organizationId: string;
	teamId: string | null;
	role: "admin" | "manager" | "employee";
	userId: string;
};

async function resolveManualEntryTargetEmployee(params: {
	currentEmployee: ManualEntryEmployeeContext;
	targetEmployeeId?: string;
	userId: string;
}): Promise<ServerActionResult<{ targetEmployee: ManualEntryEmployeeContext; isManagerEntry: boolean }>> {
	if (!params.targetEmployeeId || params.targetEmployeeId === params.currentEmployee.id) {
		return { success: true, data: { targetEmployee: params.currentEmployee, isManagerEntry: false } };
	}

	const targetEmployee = await db.query.employee.findFirst({
		where: and(
			eq(employee.id, params.targetEmployeeId),
			eq(employee.organizationId, params.currentEmployee.organizationId),
			eq(employee.isActive, true),
		),
		columns: { id: true, organizationId: true, teamId: true, role: true, userId: true },
	});

	if (!targetEmployee) {
		return { success: false, error: "Not authorized to create time entries for this employee" };
	}

	const managedRecords = await db.query.employeeManagers.findMany({
		where: eq(employeeManagers.managerId, params.currentEmployee.id),
		columns: { employeeId: true },
	});

	const principal: PrincipalContext = {
		userId: params.userId,
		isPlatformAdmin: false,
		activeOrganizationId: params.currentEmployee.organizationId,
		orgMembership: null,
		employee: {
			id: params.currentEmployee.id,
			organizationId: params.currentEmployee.organizationId,
			role: params.currentEmployee.role,
			teamId: params.currentEmployee.teamId,
		},
		permissions: { orgWide: null, byTeamId: new Map() },
		managedEmployeeIds: managedRecords.map((record) => record.employeeId),
		customRoles: [],
	};

	const ability = defineAbilityFor(principal);
	const canCreateForTarget = ability.can(
		"read",
		asAppSubject("Employee", {
			id: targetEmployee.id,
			employeeId: targetEmployee.id,
			organizationId: targetEmployee.organizationId,
			teamId: targetEmployee.teamId,
		}),
	);

	if (!canCreateForTarget) {
		return { success: false, error: "Not authorized to create time entries for this employee" };
	}

	return { success: true, data: { targetEmployee, isManagerEntry: true } };
}
```

- [ ] **Step 5: Use target employee throughout createManualTimeEntry**

In `createManualTimeEntry`, after `currentEmployee` is loaded, add:

```ts
	const targetResult = await resolveManualEntryTargetEmployee({
		currentEmployee,
		targetEmployeeId: data.employeeId,
		userId: session.user.id,
	});
	if (!targetResult.success) return targetResult;
	const { targetEmployee, isManagerEntry } = targetResult.data;
```

Replace usages in `createManualTimeEntry`:

```ts
// Before
currentEmployee.id
currentEmployee.organizationId
currentEmployee.teamId

// After, only inside createManualTimeEntry
targetEmployee.id
targetEmployee.organizationId
targetEmployee.teamId
```

Keep `createdBy: session.user.id` unchanged.

Replace approval policy block with:

```ts
	let requiresApproval = false;
	if (!isManagerEntry) {
		let editCapability;
		try {
			editCapability = await getEditCapabilityForPeriod({
				employeeId: targetEmployee.id,
				workPeriodEndTime: clockOutDate,
				timezone,
			});
		} catch (error) {
			logger.error({ error }, "Failed to check edit capability for manual entry");
			return { success: false, error: APPROVAL_POLICY_CHECK_ERROR };
		}

		if (editCapability.type === "forbidden") {
			return {
				success: false,
				error: `Entries older than ${editCapability.daysBack} days can only be created by admins or team leads.`,
			};
		}

		requiresApproval = editCapability.type === "approval_required";
	}
```

Replace manager resolution with:

```ts
		const managerId = requiresApproval
			? await getPrimaryEligibleManagerIdForRequester({
					db,
					requesterEmployeeId: targetEmployee.id,
					organizationId: targetEmployee.organizationId,
				})
			: null;
```

Ensure `approvalStatus` remains:

```ts
					approvalStatus: requiresApproval ? "pending" : "approved",
					pendingChanges: requiresApproval
```

- [ ] **Step 6: Run focused action tests**

Run: `pnpm vitest run apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts -- createManualTimeEntry`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts
git commit -m "feat: allow managers to create approved staff entries"
```

Expected: commit succeeds.

---

### Task 4: Calendar Day/Week Range Selection Bridge

**Files:**
- Modify: `apps/webapp/src/components/calendar/schedule-x-wrapper.tsx`
- Modify: `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`
- Modify: `apps/webapp/src/components/calendar/calendar-view.tsx`
- Test: `apps/webapp/src/components/calendar/calendar-view.test.tsx`

- [ ] **Step 1: Add failing test for range opening manual entry**

Update the `ScheduleXWrapper` mock in `calendar-view.test.tsx`:

```tsx
vi.mock("./schedule-x-wrapper", () => ({
	ScheduleXWrapper: ({ onViewModeChange, onTimeRangeSelect, viewMode }: { onViewModeChange: (mode: "month") => void; onTimeRangeSelect?: (range: { start: Date; end: Date }) => void; viewMode: string }) => (
		<div data-testid="schedule-x-wrapper" data-view-mode={viewMode}>
			<button type="button" onClick={() => onViewModeChange("month")}>Month</button>
			<button
				type="button"
				onClick={() =>
					onTimeRangeSelect?.({
						start: new Date("2026-05-29T12:45:00.000Z"),
						end: new Date("2026-05-29T10:15:00.000Z"),
					})
				}
			>
				Select range
			</button>
		</div>
	),
}));
```

Update the manual dialog mock:

```tsx
vi.mock("@/components/time-tracking/manual-time-entry-dialog", () => ({
	ManualTimeEntryDialog: (props: { open?: boolean; defaultDate?: string; defaultClockInTime?: string; defaultClockOutTime?: string; targetEmployeeId?: string }) => (
		<div
			data-testid="manual-time-entry-dialog"
			data-open={String(props.open)}
			data-date={props.defaultDate}
			data-clock-in={props.defaultClockInTime}
			data-clock-out={props.defaultClockOutTime}
			data-target-employee-id={props.targetEmployeeId}
		/>
	),
}));
```

Add test:

```tsx
it("opens the manual entry sheet with normalized selected range", () => {
	render(
		<CalendarView
			organizationId="org-1"
			currentEmployeeId="employee-1"
			initialSelectedEmployeeId="employee-2"
		/>,
	);

	fireEvent.click(screen.getByRole("button", { name: "Select range" }));

	const dialog = screen.getByTestId("manual-time-entry-dialog");
	expect(dialog.getAttribute("data-open")).toBe("true");
	expect(dialog.getAttribute("data-date")).toBe("2026-05-29");
	expect(dialog.getAttribute("data-clock-in")).toBe("10:15");
	expect(dialog.getAttribute("data-clock-out")).toBe("12:45");
	expect(dialog.getAttribute("data-target-employee-id")).toBe("employee-2");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run apps/webapp/src/components/calendar/calendar-view.test.tsx`

Expected: FAIL because range selection is not wired.

- [ ] **Step 3: Thread callback through wrapper types**

Modify `apps/webapp/src/components/calendar/schedule-x-wrapper.tsx`:

```tsx
interface ScheduleXWrapperProps {
	events: CalendarEvent[];
	isLoading?: boolean;
	viewMode: ViewMode;
	onViewModeChange: (mode: ViewMode) => void;
	onEventClick?: (event: CalendarEvent) => void;
	onRangeChange?: (range: { start: Date; end: Date }) => void;
	onTimeRangeSelect?: (range: { start: Date; end: Date }) => void;
	onRefresh?: () => void;
	workHoursData?: DailyWorkHoursSummaries;
}
```

Modify `ScheduleXCalendarWrapperProps` in `schedule-x-calendar.tsx` the same way and destructure `onTimeRangeSelect`.

- [ ] **Step 4: Add CalendarView range state and dialog control**

In `apps/webapp/src/components/calendar/calendar-view.tsx`, import Luxon and the manual entry dialog:

```tsx
import { DateTime } from "luxon";
import { ManualTimeEntryDialog } from "@/components/time-tracking/manual-time-entry-dialog";
```

Add state:

```tsx
	const [manualEntryOpen, setManualEntryOpen] = useState(false);
	const [manualEntryDefaults, setManualEntryDefaults] = useState<{
		date: string;
		clockInTime: string;
		clockOutTime: string;
	} | null>(null);
```

Add handler:

```tsx
	const handleTimeRangeSelect = (range: { start: Date; end: Date }) => {
		const startMillis = range.start.getTime();
		const endMillis = range.end.getTime();
		if (startMillis === endMillis) return;

		const clockIn = DateTime.fromJSDate(startMillis < endMillis ? range.start : range.end);
		const clockOut = DateTime.fromJSDate(startMillis < endMillis ? range.end : range.start);

		setManualEntryDefaults({
			date: clockIn.toISODate() ?? "",
			clockInTime: clockIn.toFormat("HH:mm"),
			clockOutTime: clockOut.toFormat("HH:mm"),
		});
		setManualEntryOpen(true);
	};
```

Pass it to `ScheduleXWrapper`:

```tsx
						<ScheduleXWrapper
							events={events}
							isLoading={isLoading}
							viewMode={viewMode}
							onViewModeChange={setViewMode}
							onEventClick={handleEventClick}
							onRangeChange={handleRangeChange}
							onTimeRangeSelect={handleTimeRangeSelect}
							onRefresh={refetch}
							workHoursData={workHoursData}
						/>
```

Update the `ManualTimeEntryDialog` props:

```tsx
			<ManualTimeEntryDialog
				employeeId={selectedEmployeeId ?? currentEmployeeId ?? ""}
				employeeTimezone="UTC"
				hasManager={false}
				targetEmployeeId={selectedEmployeeId ?? undefined}
				targetEmployeeName={selectedEmployeeName ?? undefined}
				defaultDate={manualEntryDefaults?.date}
				defaultClockInTime={manualEntryDefaults?.clockInTime}
				defaultClockOutTime={manualEntryDefaults?.clockOutTime}
				open={manualEntryOpen}
				onOpenChange={setManualEntryOpen}
				hideTrigger
				onSuccess={refetch}
			/>
```

- [ ] **Step 5: Implement Schedule-X pointer selection**

In `apps/webapp/src/components/calendar/schedule-x-calendar.tsx`, add state:

```tsx
	const selectionStartRef = useRef<Date | null>(null);
```

Add this helper inside `ScheduleXCalendarWrapper` below `visibleRequirementDates` so it can use the component's `timeZone` value:

```tsx
function getSelectionDateFromPointer(container: HTMLDivElement, event: PointerEvent): Date | null {
	const target = event.target as HTMLElement | null;
	if (!target || target.closest(".sx__event")) return null;
	const gridDay = target.closest<HTMLElement>("[data-time-grid-date]");
	const dateValue = gridDay?.dataset.timeGridDate;
	if (!dateValue) return null;

	const dayRect = gridDay.getBoundingClientRect();
	const clampedY = Math.max(dayRect.top, Math.min(event.clientY, dayRect.bottom));
	const ratio = (clampedY - dayRect.top) / Math.max(dayRect.height, 1);
	const minutes = Math.round((ratio * 24 * 60) / 15) * 15;
	const baseDate = DateTime.fromISO(dateValue, { zone: timeZone }).startOf("day");
	if (!baseDate.isValid) return null;
	return baseDate.plus({ minutes }).toJSDate();
}
```

Add effect inside `ScheduleXCalendarWrapper`:

```tsx
	useEffect(() => {
		const container = calendarContainerRef.current;
		if (!container || !onTimeRangeSelect || (viewMode !== "day" && viewMode !== "week")) return;

		const handlePointerDown = (event: PointerEvent) => {
			selectionStartRef.current = getSelectionDateFromPointer(container, event);
		};

		const handlePointerUp = (event: PointerEvent) => {
			const start = selectionStartRef.current;
			selectionStartRef.current = null;
			if (!start) return;
			const end = getSelectionDateFromPointer(container, event);
			if (!end || end.getTime() === start.getTime()) return;
			onTimeRangeSelect({ start, end });
		};

		container.addEventListener("pointerdown", handlePointerDown);
		container.addEventListener("pointerup", handlePointerUp);
		return () => {
			container.removeEventListener("pointerdown", handlePointerDown);
			container.removeEventListener("pointerup", handlePointerUp);
		};
	}, [onTimeRangeSelect, timeZone, viewMode]);
```

- [ ] **Step 6: Run component tests**

Run: `pnpm vitest run apps/webapp/src/components/calendar/calendar-view.test.tsx apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx`

Expected: PASS.

- [ ] **Step 7: Commit**

Run:

```bash
git add apps/webapp/src/components/calendar/schedule-x-wrapper.tsx apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/calendar-view.test.tsx
git commit -m "feat: open manual entry from calendar range selection"
```

Expected: commit succeeds.

---

### Task 5: Final Verification

**Files:**
- Verify only; no planned source edits.

- [ ] **Step 1: Run focused tests**

Run:

```bash
pnpm vitest run apps/webapp/src/components/calendar/calendar-view.test.tsx apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts
```

Expected: PASS for all focused tests.

- [ ] **Step 2: Run the repository production build**

Run: `CI=true pnpm build`

Expected: build completes successfully. If it fails for missing environment variables, record the missing variables and do not claim the build passed.

- [ ] **Step 3: Inspect changed files**

Run: `git status --short`

Expected: only intended files are modified or committed; unrelated untracked docs from other work may still exist and must not be staged.

- [ ] **Step 4: Commit verification fixes only if needed**

If verification required fixes, run:

```bash
git add apps/webapp/src/app/[locale]/(app)/calendar/page.tsx apps/webapp/src/app/[locale]/(app)/calendar/[employeeId]/page.tsx apps/webapp/src/components/calendar/calendar-view.tsx apps/webapp/src/components/calendar/calendar-employee-selector.tsx apps/webapp/src/components/calendar/schedule-x-wrapper.tsx apps/webapp/src/components/calendar/schedule-x-calendar.tsx apps/webapp/src/components/time-tracking/manual-time-entry-dialog.tsx apps/webapp/src/app/[locale]/(app)/time-tracking/actions/types.ts apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.ts apps/webapp/src/components/calendar/calendar-view.test.tsx apps/webapp/src/components/time-tracking/manual-time-entry-dialog.test.tsx apps/webapp/src/app/[locale]/(app)/time-tracking/actions/clocking.test.ts
git commit -m "fix: complete calendar staff manual entry flow"
```

Expected: commit includes only files for this feature.
