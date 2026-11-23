"use client";

import {
	IconAlertCircle,
	IconAlertTriangle,
	IconChecks,
	IconCircleCheck,
	IconConfetti,
	IconLoader2,
} from "@tabler/icons-react";
import { useLocale } from "next-intl";
import { useId, useMemo, useReducer, useState } from "react";
import {
	type PayrollSettleSpecificDaysRequest,
	previewSettleSpecificPayrollDaysAction,
	settleSpecificPayrollDaysAction,
} from "@/app/[locale]/(app)/payroll/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useIsMobile } from "@/hooks/use-mobile";
import type { PayrollPeriodDay, PayrollPeriodEmployee } from "@/lib/payroll-period/types";
import { PayrollDayPanel, type PayrollDaySelection } from "./payroll-day-panel";
import {
	currentDaySelection,
	EMPTY_DAY_SELECTION,
	payrollDayKey,
	payrollDaySelectionReducer,
	settleableGroups,
} from "./payroll-day-selection";
import { PayrollDaySettlement } from "./payroll-day-settlement";
import { type PayrollDayPicking, PayrollDaysGrid } from "./payroll-days-grid";
import { payrollDaysFormat } from "./payroll-day-format";
import { PayrollDaysList } from "./payroll-days-list";
import { datesWithEntries, useHideEmptyPayrollDays } from "./payroll-empty-days";
import { PayrollSettleConfirmDialog, usePayrollSettle } from "./payroll-settle-dialog";
import { PayrollPlaceholderTab } from "./payroll-workspace-tabs";
import type { PayrollPeriodRequest, PayrollTranslate } from "./state";
import { usePayrollPeriod } from "./use-payroll-period";

const SKELETON_ROWS = ["first", "second", "third", "fourth", "fifth", "sixth"] as const;

/**
 * The Days tab: credited hours per employee and local day, with required hours, the
 * difference, absences and holidays. Everything shown comes from the payroll period read.
 * A day opens a read-only side panel; below the mobile breakpoint the grid becomes a list
 * of days for one employee at a time (#1894). "Select days to settle" picks unsettled
 * days with entries and settles exactly those, after a preview. "Hide days without
 * entries" drops the dates nobody shown recorded anything on (the list: the employee's
 * own empty days); totals still cover the whole period.
 */
export function PayrollDaysTab({
	filtersHaveNoMatches,
	refreshedAt,
	request,
	t,
}: {
	filtersHaveNoMatches: boolean;
	refreshedAt: string;
	request: PayrollPeriodRequest;
	t: PayrollTranslate;
}) {
	const locale = useLocale();
	const isMobile = useIsMobile();
	const format = useMemo(() => payrollDaysFormat(locale), [locale]);
	const { data, error, isPending } = usePayrollPeriod(request, refreshedAt);
	const [selection, setSelection] = useState<PayrollDaySelection | null>(null);
	const selectDay = (employee: PayrollPeriodEmployee, day: PayrollPeriodDay) =>
		setSelection({ employee, day });
	// Picking days to settle: leaving the mode drops the picked days.
	const [picking, setPicking] = useState(false);
	const [picked, dispatchPicked] = useReducer(payrollDaySelectionReducer, EMPTY_DAY_SELECTION);
	const [hideEmptyDays, setHideEmptyDays] = useHideEmptyPayrollDays();
	const hideEmptyDaysId = useId();
	// Each row's and column's pickable days, once per read rather than on every toggle.
	const loadedEmployees = data?.employees;
	const groups = useMemo(
		() => (picking ? settleableGroups(loadedEmployees ?? []) : null),
		[picking, loadedEmployees],
	);
	const settle = usePayrollSettle<PayrollSettleSpecificDaysRequest>({
		preview: previewSettleSpecificPayrollDaysAction,
		settle: settleSpecificPayrollDaysAction,
		onSettled: () => dispatchPicked({ type: "clear" }),
		t,
	});
	function togglePicking() {
		if (picking) dispatchPicked({ type: "clear" });
		else setSelection(null);
		setPicking(!picking);
	}

	if (filtersHaveNoMatches) {
		return (
			<PayrollPlaceholderTab
				description={t(
					"payroll.filters.noMatchingEmployees",
					"No employees match the selected payroll filters.",
				)}
			/>
		);
	}
	if (error) {
		return (
			<Alert variant="destructive">
				<IconAlertTriangle aria-hidden="true" />
				<AlertTitle>{t("payroll.days.loadFailed", "Hours per day could not be loaded")}</AlertTitle>
				<AlertDescription>{error.message}</AlertDescription>
			</Alert>
		);
	}
	if (isPending || !data) {
		return (
			<div className="flex flex-col gap-2" aria-busy="true">
				<span className="sr-only">{t("payroll.days.loading", "Loading hours per day")}</span>
				{SKELETON_ROWS.map((row) => (
					<Skeleton key={row} className="h-14 w-full" />
				))}
			</div>
		);
	}
	if (data.employees.length === 0) {
		return (
			<PayrollPlaceholderTab
				description={t("payroll.days.empty", "No employees in scope for this period.")}
			/>
		);
	}

	const periodDates = data.employees[0]?.days.map((day) => day.date) ?? [];
	const dates = hideEmptyDays ? datesWithEntries(periodDates, data.employees) : periodDates;
	// The open day follows refetches of the period, for example after unsettling it.
	const currentSelection = selection ? currentDay(data.employees, selection) : null;
	// Picked days survive refetches while they can still be settled.
	const pickedDays = currentDaySelection(picked, data.employees);
	const employees = data.employees;
	const pickingControls: PayrollDayPicking | undefined = groups
		? {
				selected: new Set(pickedDays.map((day) => payrollDayKey(day.employeeId, day.date))),
				groups,
				onToggleDay: (employee, day, extend) =>
					dispatchPicked({ type: "toggleDay", employee, date: day.date, extend }),
				onToggleEmployee: (employee) => dispatchPicked({ type: "toggleEmployee", employee }),
				onToggleDate: (date) => dispatchPicked({ type: "toggleDate", date, employees }),
			}
		: undefined;
	return (
		<div className="flex min-w-0 flex-col gap-3">
			<div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
				<PayrollDaysLegend t={t} />
				<div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 self-start">
					<div className="flex items-center gap-2">
						<Switch
							id={hideEmptyDaysId}
							checked={hideEmptyDays}
							onCheckedChange={(checked) => setHideEmptyDays(checked === true)}
						/>
						<Label htmlFor={hideEmptyDaysId} className="font-normal text-sm">
							{t("payroll.days.hideEmptyDays", "Hide days without entries")}
						</Label>
					</div>
					<Button
						type="button"
						size="sm"
						variant={picking ? "secondary" : "outline"}
						aria-pressed={picking}
						onClick={togglePicking}
					>
						<IconChecks aria-hidden="true" className="size-4" />
						{t("payroll.days.select.toggle", "Select days to settle")}
					</Button>
				</div>
			</div>
			{picking ? (
				<p className="text-muted-foreground text-xs">
					{isMobile
						? t(
								"payroll.days.select.hintList",
								"Tap unsettled days with entries to select them for settling.",
							)
						: t(
								"payroll.days.select.hint",
								"Click unsettled days with entries to select them. Click a name or a date to select its row or column; Shift-click selects a range in a row.",
							)}
				</p>
			) : null}
			{isMobile ? (
				<PayrollDaysList
					employees={employees}
					format={format}
					hideEmptyDays={hideEmptyDays}
					onSelectDay={selectDay}
					picking={pickingControls}
					t={t}
				/>
			) : dates.length === 0 ? (
				<PayrollPlaceholderTab
					description={t(
						"payroll.days.noDaysWithEntries",
						"Nobody recorded anything in this period. Turn off “Hide days without entries” to see every day.",
					)}
				/>
			) : (
				<PayrollDaysGrid
					dates={dates}
					employees={employees}
					format={format}
					onSelectDay={selectDay}
					picking={pickingControls}
					t={t}
				/>
			)}
			{picking ? (
				<PayrollDaySelectionBar
					count={pickedDays.length}
					isPreviewing={settle.isPreviewing}
					onClear={() => dispatchPicked({ type: "clear" })}
					onSettle={() => settle.requestPreview({ days: pickedDays })}
					t={t}
				/>
			) : null}
			<PayrollSettleConfirmDialog
				description={t(
					"payroll.days.select.confirmDescription",
					"Settling records that the selected days' worked hours and approved absences have been paid.",
				)}
				settle={settle}
				t={t}
			/>
			<PayrollDayPanel
				format={format}
				onClose={() => setSelection(null)}
				refreshedAt={refreshedAt}
				selection={currentSelection}
				settlementHistory={
					currentSelection ? (
						<PayrollDaySettlement
							day={currentSelection.day}
							employeeId={currentSelection.employee.id}
							format={format}
							t={t}
						/>
					) : null
				}
				t={t}
			/>
		</div>
	);
}

function currentDay(
	employees: readonly PayrollPeriodEmployee[],
	selection: PayrollDaySelection,
): PayrollDaySelection {
	const employee = employees.find((row) => row.id === selection.employee.id);
	const day = employee?.days.find((row) => row.date === selection.day.date);
	return employee && day ? { employee, day } : selection;
}

/** The sticky bar of the picked days: how many, settling them, and clearing the selection. */
function PayrollDaySelectionBar({
	count,
	isPreviewing,
	onClear,
	onSettle,
	t,
}: {
	count: number;
	isPreviewing: boolean;
	onClear: () => void;
	onSettle: () => void;
	t: PayrollTranslate;
}) {
	return (
		<section
			aria-label={t("payroll.days.select.barLabel", "Selected days")}
			className="sticky bottom-4 z-30 flex flex-wrap items-center gap-3 rounded-lg border bg-background/95 px-4 py-2 shadow-lg backdrop-blur"
		>
			<span className="font-medium text-sm tabular-nums" aria-live="polite">
				{t("payroll.days.select.count", "{count} days selected", { count })}
			</span>
			<span className="ml-auto flex gap-2">
				<Button type="button" variant="ghost" size="sm" disabled={count === 0} onClick={onClear}>
					{t("payroll.days.select.clear", "Clear")}
				</Button>
				<Button type="button" size="sm" disabled={count === 0 || isPreviewing} onClick={onSettle}>
					{isPreviewing ? (
						<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
					) : (
						<IconCircleCheck aria-hidden="true" className="size-4" />
					)}
					{t("payroll.days.select.settle", "Settle…")}
				</Button>
			</span>
		</section>
	);
}

function PayrollDaysLegend({ t }: { t: PayrollTranslate }) {
	return (
		<p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-muted-foreground text-xs">
			<span>
				{t(
					"payroll.days.legend.hours",
					"Worked hours, then required hours and the difference. Days are each employee's local days.",
				)}
			</span>
			<span className="inline-flex items-center gap-1">
				<IconConfetti aria-hidden="true" className="size-3.5 text-amber-600" />
				{t("payroll.days.legend.holiday", "Holiday")}
			</span>
			<span className="inline-flex items-center gap-1">
				<IconCircleCheck
					aria-hidden="true"
					className="size-3.5 text-emerald-600 dark:text-emerald-400"
				/>
				{t("payroll.days.legend.settled", "Settled")}
			</span>
			<span className="inline-flex items-center gap-1">
				<IconAlertCircle
					aria-hidden="true"
					className="size-3.5 text-amber-600 dark:text-amber-400"
				/>
				{t("payroll.days.legend.changedSinceSettled", "Changed since settled")}
			</span>
			<span className="inline-flex items-center gap-1">
				<span
					aria-hidden="true"
					className="inline-block h-3 w-4 rounded-sm border"
					style={{
						backgroundImage:
							"repeating-linear-gradient(135deg, transparent 0 3px, color-mix(in oklab, currentColor 30%, transparent) 3px 4px)",
					}}
				/>
				{t("payroll.days.legend.pending", "Pending absence")}
			</span>
		</p>
	);
}
