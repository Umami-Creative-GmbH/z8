"use client";

import { IconAlertCircle } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
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

export function SurchargeReports({ organizationId }: SurchargeReportsProps) {
	const { t } = useTranslate();
	const [defaultFilters] = useState(getDefaultFilters);
	const [rows, setRows] = useState<SurchargeCalculationWithDetails[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [dateError, setDateError] = useState<string | null>(null);
	const [isShowingPreviousResults, setIsShowingPreviousResults] = useState(false);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [activeFilters, setActiveFilters] = useState(defaultFilters);
	const [loadedRowsOrganizationId, setLoadedRowsOrganizationId] = useState<string | null>(null);
	const loadedRowsOrganizationIdRef = useRef<string | null>(null);
	const latestRequestId = useRef(0);

	const loadCalculations = useEffectEvent(async (filters: FilterValues) => {
		const requestId = latestRequestId.current + 1;
		latestRequestId.current = requestId;
		const startDate = parseFilterDate(filters.startDate, "start");
		const endDate = parseFilterDate(filters.endDate, "end");

		if (!startDate.isValid || !endDate.isValid || startDate > endDate) {
			setRows([]);
			setExpandedId(null);
			loadedRowsOrganizationIdRef.current = null;
			setLoadedRowsOrganizationId(null);
			setError(null);
			setIsShowingPreviousResults(false);
			setDateError(
				t(
					"settings.surcharges.reports.errors.invalidDateRange",
					"Start date must be on or before end date.",
				),
			);
			setIsLoading(false);
			return;
		}

		setDateError(null);
		setError(null);
		setIsShowingPreviousResults(false);
		if (loadedRowsOrganizationIdRef.current !== organizationId) {
			setRows([]);
			setExpandedId(null);
		}
		setIsLoading(true);

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
			setRows(result.data);
			loadedRowsOrganizationIdRef.current = organizationId;
			setLoadedRowsOrganizationId(organizationId);
			setExpandedId((current) => (result.data.some((row) => row.id === current) ? current : null));
		} else {
			if (loadedRowsOrganizationIdRef.current === organizationId) {
				setIsShowingPreviousResults(true);
			} else {
				setRows([]);
				setExpandedId(null);
			}
			setError(
				result.error ||
					t(
						"settings.surcharges.reports.errors.loadFailed",
						"Failed to load surcharge calculations.",
					),
			);
		}

		setIsLoading(false);
	});

	const form = useForm({
		defaultValues: defaultFilters,
		onSubmit: async ({ value }) => {
			setActiveFilters({ ...value });
		},
	});

	useEffect(() => {
		if (!organizationId) {
			return;
		}

		const nextFilters = activeFilters;
		queueMicrotask(() => {
			void loadCalculations(nextFilters);
		});
	}, [activeFilters, organizationId]);

	const displayRows = loadedRowsOrganizationId === organizationId ? rows : [];
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
							<Button type="submit" disabled={isLoading}>
								{t("settings.surcharges.reports.filters.apply", "Apply filters")}
							</Button>
						</div>
						{dateError ? (
							<p role="alert" className="text-destructive text-sm md:col-span-4">
								{dateError}
							</p>
						) : null}
					</form>
				</CardContent>
			</Card>

			{error ? (
				<Alert variant="destructive">
					<IconAlertCircle aria-hidden="true" />
					<AlertTitle>
						{t("settings.surcharges.reports.errors.loadTitle", "Unable to load calculations")}
					</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}
			{isShowingPreviousResults ? (
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
			{isLoading && displayRows.length > 0 ? (
				<output aria-live="polite" className="sr-only">
					{t("settings.surcharges.reports.loading", "Loading calculations…")}
				</output>
			) : null}

			<SurchargeSummaryCards calculationCount={displayRows.length} totals={totals} />

			<Card>
				<CardContent>
					<SurchargeResultsTable
						isLoading={isLoading}
						rows={displayRows}
						expandedId={expandedId}
						onExpandedChange={setExpandedId}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
