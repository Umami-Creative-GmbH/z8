"use client";

import {
	IconAlertCircle,
	IconChevronDown,
	IconChevronRight,
	IconFileAnalytics,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { DateTime } from "luxon";
import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { getSurchargeCalculationsForPeriod } from "@/app/[locale]/(app)/settings/surcharges/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { buildAuthUserDisplayName } from "@/lib/auth/derived-user-name";
import type { SurchargeCalculationWithDetails } from "@/lib/surcharges/validation";

type SurchargeReportsProps = {
	organizationId: string;
};

type FilterValues = {
	startDate: string;
	endDate: string;
	employeeId: string;
};

const DATE_FORMAT = "yyyy-MM-dd";
const SURCHARGE_REPORT_ROW_LIMIT = 500;

function getDefaultFilters(): FilterValues {
	const now = DateTime.now();

	return {
		startDate: now.startOf("month").toFormat(DATE_FORMAT),
		endDate: now.endOf("month").toFormat(DATE_FORMAT),
		employeeId: "",
	};
}

function parseFilterDate(value: string, boundary: "start" | "end") {
	const parsed = DateTime.fromFormat(value, DATE_FORMAT, { zone: "local" });

	return boundary === "start" ? parsed.startOf("day") : parsed.endOf("day");
}

function formatMinutes(minutes: number) {
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;

	return `${hours}h ${remainingMinutes}m`;
}

function formatMinutesCell(minutes: number) {
	return `${minutes} min`;
}

function formatDate(value: Date) {
	return DateTime.fromJSDate(value).toLocaleString(DateTime.DATE_MED);
}

function formatTimestamp(value: Date | string) {
	const dateTime = typeof value === "string" ? DateTime.fromISO(value) : DateTime.fromJSDate(value);

	return dateTime.isValid ? dateTime.toLocaleString(DateTime.DATETIME_MED) : "-";
}

function formatPercentage(value: number | string) {
	const numeric = typeof value === "string" ? Number.parseFloat(value) : value;

	if (!Number.isFinite(numeric)) {
		return "-";
	}

	return `${Math.round(numeric * 100)}%`;
}

function getEmployeeName(calculation: SurchargeCalculationWithDetails) {
	return buildAuthUserDisplayName(calculation.employee) || calculation.employee.id;
}

export function SurchargeReports({ organizationId }: SurchargeReportsProps) {
	const { t } = useTranslate();
	const [defaultFilters] = useState(getDefaultFilters);
	const [rows, setRows] = useState<SurchargeCalculationWithDetails[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [dateError, setDateError] = useState<string | null>(null);
	const [isShowingPreviousResults, setIsShowingPreviousResults] = useState(false);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const [loadedRowsOrganizationId, setLoadedRowsOrganizationId] = useState<string | null>(null);
	const appliedFilters = useRef(defaultFilters);
	const loadedRowsOrganizationIdRef = useRef<string | null>(null);
	const latestRequestId = useRef(0);

	const loadCalculations = useCallback(
		async (filters: FilterValues) => {
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
					t("surcharges.reports.errors.invalidDateRange", "Start date must be on or before end date."),
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
			).catch(() => ({ success: false as const, error: "Failed to load surcharge calculations." }));

			if (requestId !== latestRequestId.current) {
				return;
			}

			if (result.success) {
				setRows(result.data);
				loadedRowsOrganizationIdRef.current = organizationId;
				setLoadedRowsOrganizationId(organizationId);
				setExpandedId((current) =>
					result.data.some((row) => row.id === current) ? current : null,
				);
			} else {
				if (loadedRowsOrganizationIdRef.current === organizationId) {
					setIsShowingPreviousResults(true);
				} else {
					setRows([]);
					setExpandedId(null);
				}
				setError(
					result.error || t("surcharges.reports.errors.loadFailed", "Failed to load surcharge calculations."),
				);
			}

			setIsLoading(false);
		},
		[organizationId, t],
	);

	const form = useForm({
		defaultValues: defaultFilters,
		onSubmit: async ({ value }) => {
			appliedFilters.current = value;
			await loadCalculations(value);
		},
	});

	useEffect(() => {
		loadCalculations(appliedFilters.current);
	}, [loadCalculations]);

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
					<CardTitle>{t("surcharges.reports.title", "Surcharge reports")}</CardTitle>
				</CardHeader>
				<CardContent>
					<form
						data-testid="surcharge-report-filters"
						className="grid gap-4 md:grid-cols-[repeat(3,minmax(0,1fr))_auto]"
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							form.handleSubmit();
						}}
					>
						<form.Field name="startDate">
							{(field) => (
								<div className="grid gap-2">
									<Label htmlFor={field.name}>
										{t("surcharges.reports.filters.startDate", "Start date")}
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
										{t("surcharges.reports.filters.endDate", "End date")}
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
										{t("surcharges.reports.filters.employeeId", "Employee ID")}
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
								{t("surcharges.reports.filters.apply", "Apply filters")}
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
						{t("surcharges.reports.errors.loadTitle", "Unable to load calculations")}
					</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}
			{isShowingPreviousResults ? (
				<Alert role="status" aria-live="polite">
					<AlertTitle>
						{t("surcharges.reports.previousResults.title", "Showing previous results.")}
					</AlertTitle>
					<AlertDescription>
						{t(
							"surcharges.reports.previousResults.description",
							"The latest request failed, so the previous successful results remain visible.",
						)}
					</AlertDescription>
				</Alert>
			) : null}
			{displayRows.length >= SURCHARGE_REPORT_ROW_LIMIT ? (
				<Alert role="status" aria-live="polite">
					<AlertDescription>
						{t(
							"surcharges.reports.rowLimitNotice",
							"Showing the first 500 matching calculations. Narrow the date or employee filters to refine totals.",
						)}
					</AlertDescription>
				</Alert>
			) : null}
			{isLoading && displayRows.length > 0 ? (
				<div role="status" aria-live="polite" className="sr-only">
					{t("surcharges.reports.loading", "Loading calculations…")}
				</div>
			) : null}

			<div className="grid gap-4 md:grid-cols-4">
				<SummaryCard
					label={t("surcharges.reports.summary.calculations", "Calculations")}
					value={`${displayRows.length} calculation${displayRows.length === 1 ? "" : "s"}`}
				/>
				<SummaryCard
					label={t("surcharges.reports.summary.baseHours", "Base hours")}
					value={formatMinutes(totals.baseMinutes)}
				/>
				<SummaryCard
					label={t("surcharges.reports.summary.qualifyingHours", "Qualifying surcharge hours")}
					value={formatMinutes(totals.qualifyingMinutes)}
				/>
				<SummaryCard
					label={t("surcharges.reports.summary.creditedHours", "Credited surcharge hours")}
					value={formatMinutes(totals.surchargeMinutes)}
				/>
			</div>

			<Card>
				<CardContent>
					{isLoading && displayRows.length === 0 ? (
						<div
							role="status"
							aria-live="polite"
							className="py-8 text-center text-muted-foreground text-sm"
						>
							{t("surcharges.reports.loading", "Loading calculations…")}
						</div>
					) : displayRows.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<IconFileAnalytics aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>
									{t("surcharges.reports.empty.title", "No surcharge calculations found")}
								</EmptyTitle>
								<EmptyDescription>
									{t(
										"surcharges.reports.empty.description",
										"No surcharge calculations matched the selected filters.",
									)}
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-10">
										<span className="sr-only">
											{t("surcharges.reports.table.details", "Details")}
										</span>
									</TableHead>
									<TableHead>{t("surcharges.reports.table.date", "Date")}</TableHead>
									<TableHead>{t("surcharges.reports.table.employee", "Employee")}</TableHead>
									<TableHead>{t("surcharges.reports.table.base", "Base")}</TableHead>
									<TableHead>{t("surcharges.reports.table.qualifying", "Qualifying")}</TableHead>
									<TableHead>{t("surcharges.reports.table.credit", "Credit")}</TableHead>
									<TableHead>{t("surcharges.reports.table.percentage", "Percentage")}</TableHead>
									<TableHead>{t("surcharges.reports.table.created", "Created")}</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{displayRows.map((calculation) => {
									const employeeName = getEmployeeName(calculation);
									const isExpanded = expandedId === calculation.id;
									const detailsId = `surcharge-calculation-${calculation.id}-details`;

									return (
										<Fragment key={calculation.id}>
											<TableRow className="tabular-nums">
												<TableCell>
													<Button
														type="button"
														variant="ghost"
														size="icon"
														aria-controls={detailsId}
														aria-expanded={isExpanded}
														aria-label={t(
															isExpanded
																? "surcharges.reports.details.hideForEmployee"
																: "surcharges.reports.details.showForEmployee",
															`${isExpanded ? "Hide" : "Show"} details for ${employeeName}`,
														)}
														onClick={() => setExpandedId(isExpanded ? null : calculation.id)}
													>
														{isExpanded ? (
															<IconChevronDown aria-hidden="true" />
														) : (
															<IconChevronRight aria-hidden="true" />
														)}
													</Button>
												</TableCell>
												<TableCell>{formatDate(calculation.calculationDate)}</TableCell>
												<TableCell>{employeeName}</TableCell>
												<TableCell>{formatMinutesCell(calculation.baseMinutes)}</TableCell>
												<TableCell>{formatMinutesCell(calculation.qualifyingMinutes)}</TableCell>
												<TableCell>{formatMinutesCell(calculation.surchargeMinutes)}</TableCell>
												<TableCell>{formatPercentage(calculation.appliedPercentage)}</TableCell>
												<TableCell>{formatTimestamp(calculation.createdAt)}</TableCell>
											</TableRow>
											{isExpanded ? (
												<CalculationDetails calculation={calculation} detailsId={detailsId} />
											) : null}
										</Fragment>
									);
								})}
							</TableBody>
						</Table>
					)}
				</CardContent>
			</Card>
		</div>
	);
}

function SummaryCard({ label, value }: { label: string; value: string }) {
	return (
		<Card>
			<CardContent className="space-y-1">
				<div className="text-muted-foreground text-sm">{label}</div>
				<div className="font-semibold text-2xl">{value}</div>
			</CardContent>
		</Card>
	);
}

function CalculationDetails({
	calculation,
	detailsId,
}: {
	calculation: SurchargeCalculationWithDetails;
	detailsId: string;
}) {
	const { t } = useTranslate();
	const details = calculation.calculationDetails;

	return (
		<TableRow id={detailsId} className="bg-muted/30 hover:bg-muted/30">
			<TableCell />
			<TableCell colSpan={7} className="whitespace-normal">
				<div className="grid gap-4 py-2 text-sm">
					<div className="grid gap-2 md:grid-cols-3">
						<div>
							<div className="font-medium">
								{t("surcharges.reports.details.workPeriod", "Work period")}
							</div>
							<div className="text-muted-foreground">
								{details
									? `${formatTimestamp(details.workPeriodStartTime)} - ${formatTimestamp(details.workPeriodEndTime)}`
									: "-"}
							</div>
						</div>
						<div>
							<div className="font-medium">
								{t("surcharges.reports.details.calculatedAt", "Calculated at")}
							</div>
							<div className="text-muted-foreground">
								{details ? formatTimestamp(details.calculatedAt) : "-"}
							</div>
						</div>
						<div>
							<div className="font-medium">
								{t("surcharges.reports.details.overlapPolicy", "Overlap policy")}:{" "}
								{details?.overlapPolicy ?? "-"}
							</div>
						</div>
					</div>

					<div className="space-y-2">
						<div className="font-medium">
							{t("surcharges.reports.details.appliedRules", "Applied rules")}
						</div>
						{details?.rulesApplied.length ? (
							<div className="grid gap-2">
								{details.rulesApplied.map((rule) => (
									<div key={rule.ruleId} className="rounded-md border p-3">
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-medium">{rule.ruleName}</span>
											<Badge variant="secondary">{rule.ruleType}</Badge>
										</div>
										<div className="mt-2 grid gap-2 text-muted-foreground text-sm md:grid-cols-3">
											<div>
												{t("surcharges.reports.details.qualifying", "Qualifying")}:{" "}
												{formatMinutes(rule.qualifyingMinutes)}
											</div>
											<div>
												{t("surcharges.reports.details.surcharge", "Surcharge")}:{" "}
												{formatMinutes(rule.surchargeMinutes)}
											</div>
											<div>
												{t("surcharges.reports.details.percentage", "Percentage")}:{" "}
												{formatPercentage(rule.percentage)}
											</div>
										</div>
									</div>
								))}
							</div>
						) : (
							<div className="text-muted-foreground">
								{t("surcharges.reports.details.noAppliedRules", "No applied rules recorded.")}
							</div>
						)}
					</div>
				</div>
			</TableCell>
		</TableRow>
	);
}
