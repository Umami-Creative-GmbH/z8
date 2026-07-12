"use client";

import { IconAlertCircle } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useReducer, useRef, useState } from "react";
import { getSurchargeCalculationsForPeriod } from "@/app/[locale]/(app)/settings/surcharges/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SurchargeCalculationWithDetails } from "@/lib/surcharges/validation";
import { SURCHARGE_REPORT_ROW_LIMIT } from "./constants";
import { getDefaultFilters, parseFilterDate } from "./helpers";
import { SurchargeResultsTable } from "./results-table";
import { SurchargeSummaryCards } from "./summary-cards";
import type { FilterValues, SurchargeReportsProps } from "./types";

interface SurchargeReportState {
	activeFilters: FilterValues;
	dateError: string | null;
	error: string | null;
	expandedId: string | null;
	isLoading: boolean;
	isShowingPreviousResults: boolean;
	loadedRowsOrganizationId: string | null;
	rows: SurchargeCalculationWithDetails[];
}

type SurchargeReportAction =
	| { type: "invalidRange"; message: string }
	| { type: "requestFailed"; message: string; retainRows: boolean }
	| { type: "requestStarted"; organizationId: string; shouldClearRows: boolean }
	| { type: "requestSucceeded"; organizationId: string; rows: SurchargeCalculationWithDetails[] }
	| { type: "setActiveFilters"; filters: FilterValues }
	| { type: "setExpandedId"; id: string | null };

function surchargeReportReducer(
	state: SurchargeReportState,
	action: SurchargeReportAction,
): SurchargeReportState {
	switch (action.type) {
		case "invalidRange":
			return {
				...state,
				dateError: action.message,
				error: null,
				expandedId: null,
				isLoading: false,
				isShowingPreviousResults: false,
				loadedRowsOrganizationId: null,
				rows: [],
			};
		case "requestStarted":
			return {
				...state,
				dateError: null,
				error: null,
				expandedId: action.shouldClearRows ? null : state.expandedId,
				isLoading: true,
				isShowingPreviousResults: false,
				rows: action.shouldClearRows ? [] : state.rows,
			};
		case "requestSucceeded":
			return {
				...state,
				expandedId: action.rows.some((row) => row.id === state.expandedId)
					? state.expandedId
					: null,
				isLoading: false,
				loadedRowsOrganizationId: action.organizationId,
				rows: action.rows,
			};
		case "requestFailed":
			return {
				...state,
				error: action.message,
				expandedId: action.retainRows ? state.expandedId : null,
				isLoading: false,
				isShowingPreviousResults: action.retainRows,
				rows: action.retainRows ? state.rows : [],
			};
		case "setActiveFilters":
			return { ...state, activeFilters: action.filters };
		case "setExpandedId":
			return { ...state, expandedId: action.id };
	}
}

export function SurchargeReports({ organizationId }: SurchargeReportsProps) {
	const { t } = useTranslate();
	const [defaultFilters] = useState(getDefaultFilters);
	const [state, dispatch] = useReducer(surchargeReportReducer, defaultFilters, (activeFilters) => ({
		activeFilters,
		dateError: null,
		error: null,
		expandedId: null,
		isLoading: true,
		isShowingPreviousResults: false,
		loadedRowsOrganizationId: null,
		rows: [],
	}));
	const loadedRowsOrganizationIdRef = useRef<string | null>(null);
	const latestRequestId = useRef(0);

	const loadCalculations = useEffectEvent(async (filters: FilterValues) => {
		const requestId = latestRequestId.current + 1;
		latestRequestId.current = requestId;
		const startDate = parseFilterDate(filters.startDate, "start");
		const endDate = parseFilterDate(filters.endDate, "end");

		if (!startDate.isValid || !endDate.isValid || startDate > endDate) {
			loadedRowsOrganizationIdRef.current = null;
			dispatch({
				type: "invalidRange",
				message: t(
					"settings.surcharges.reports.errors.invalidDateRange",
					"Start date must be on or before end date.",
				),
			});
			return;
		}

		dispatch({
			type: "requestStarted",
			organizationId,
			shouldClearRows: loadedRowsOrganizationIdRef.current !== organizationId,
		});

		const employeeId = filters.employeeId.trim() || undefined;
		const result = await getSurchargeCalculationsForPeriod(
			organizationId,
			startDate.toJSDate(),
			endDate.toJSDate(),
			employeeId,
		).catch(() => ({
			success: false as const,
			error: "Failed to load surcharge calculations.",
		}));
		const isLatestRequest = requestId === latestRequestId.current;

		if (!isLatestRequest) {
			return;
		}

		if (result.success) {
			loadedRowsOrganizationIdRef.current = organizationId;
			dispatch({ type: "requestSucceeded", organizationId, rows: result.data });
		} else {
			dispatch({
				type: "requestFailed",
				retainRows: loadedRowsOrganizationIdRef.current === organizationId,
				message:
					result.error ||
					t(
						"settings.surcharges.reports.errors.loadFailed",
						"Failed to load surcharge calculations.",
					),
			});
		}
	});

	const form = useForm({
		defaultValues: defaultFilters,
		onSubmit: async ({ value }) => {
			dispatch({ type: "setActiveFilters", filters: { ...value } });
		},
	});

	useEffect(() => {
		if (!organizationId) {
			return;
		}

		const nextFilters = state.activeFilters;
		queueMicrotask(() => {
			void loadCalculations(nextFilters);
		});
	}, [organizationId, state.activeFilters]);

	const displayRows = state.loadedRowsOrganizationId === organizationId ? state.rows : [];
	const totals = displayRows.reduce(
		(accumulator, row) => ({
			baseMinutes: accumulator.baseMinutes + row.baseMinutes,
			qualifyingMinutes: accumulator.qualifyingMinutes + row.qualifyingMinutes,
			surchargeMinutes: accumulator.surchargeMinutes + row.surchargeMinutes,
		}),
		{ baseMinutes: 0, qualifyingMinutes: 0, surchargeMinutes: 0 },
	);

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader>
					<CardTitle>{t("settings.surcharges.reports.title", "Surcharge reports")}</CardTitle>
				</CardHeader>
				<CardContent>
					<form
						data-testid="surcharge-report-filters"
						className="grid gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))_auto]"
						onSubmit={form.handleSubmit}
					>
						<form.Field name="startDate">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor={field.name}>
										{t("settings.surcharges.reports.filters.startDate", "Start date")}
									</Label>
									<Input
										id={field.name}
										name={field.name}
										type="date"
										autoComplete="off"
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="endDate">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor={field.name}>
										{t("settings.surcharges.reports.filters.endDate", "End date")}
									</Label>
									<Input
										id={field.name}
										name={field.name}
										type="date"
										autoComplete="off"
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
									/>
								</div>
							)}
						</form.Field>

						<form.Field name="employeeId">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor={field.name}>
										{t("settings.surcharges.reports.filters.employeeId", "Employee ID")}
									</Label>
									<Input
										id={field.name}
										name={field.name}
										autoComplete="off"
										spellCheck={false}
										value={field.state.value}
										onBlur={field.handleBlur}
										onChange={(event) => field.handleChange(event.target.value)}
									/>
								</div>
							)}
						</form.Field>

						<div className="flex items-end">
							<Button type="submit" disabled={state.isLoading}>
								{t("settings.surcharges.reports.filters.apply", "Apply filters")}
							</Button>
						</div>
						{state.dateError ? (
							<p role="alert" className="text-destructive text-sm md:col-span-4">
								{state.dateError}
							</p>
						) : null}
					</form>
				</CardContent>
			</Card>

			{state.error ? (
				<Alert variant="destructive">
					<IconAlertCircle aria-hidden="true" />
					<AlertTitle>
						{t("settings.surcharges.reports.errors.loadTitle", "Unable to load calculations")}
					</AlertTitle>
					<AlertDescription>{state.error}</AlertDescription>
				</Alert>
			) : null}
			{state.isShowingPreviousResults ? (
				<Alert>
					<AlertTitle>
						{t("settings.surcharges.reports.previousResults.title", "Showing previous results.")}
					</AlertTitle>
					<AlertDescription>
						{t(
							"settings.surcharges.reports.previousResults.description",
							"The latest request failed, so the previous successful results remain visible.",
						)}
					</AlertDescription>
				</Alert>
			) : null}
			{displayRows.length >= SURCHARGE_REPORT_ROW_LIMIT ? (
				<Alert>
					<AlertDescription>
						{t(
							"settings.surcharges.reports.rowLimitNotice",
							"Showing the first 500 matching calculations. Narrow the date or employee filters to refine totals.",
						)}
					</AlertDescription>
				</Alert>
			) : null}
			{state.isLoading && displayRows.length > 0 ? (
				<output aria-live="polite" className="sr-only">
					{t("settings.surcharges.reports.loading", "Loading calculations…")}
				</output>
			) : null}

			<SurchargeSummaryCards calculationCount={displayRows.length} totals={totals} />

			<Card>
				<CardContent>
					<SurchargeResultsTable
						isLoading={state.isLoading}
						rows={displayRows}
						expandedId={state.expandedId}
						onExpandedChange={(id) => dispatch({ type: "setExpandedId", id })}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
