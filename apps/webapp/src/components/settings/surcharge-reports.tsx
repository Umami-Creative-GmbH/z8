"use client";

import {
	IconAlertCircle,
	IconChevronDown,
	IconChevronRight,
	IconFileAnalytics,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
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
	const firstName = calculation.employee.firstName?.trim();
	const lastName = calculation.employee.lastName?.trim();
	const name = [firstName, lastName].filter(Boolean).join(" ");

	return name || calculation.employee.id;
}

export function SurchargeReports({ organizationId }: SurchargeReportsProps) {
	const [rows, setRows] = useState<SurchargeCalculationWithDetails[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [dateError, setDateError] = useState<string | null>(null);
	const [expandedId, setExpandedId] = useState<string | null>(null);
	const latestRequestId = useRef(0);

	const form = useForm({
		defaultValues: getDefaultFilters(),
		onSubmit: async ({ value }) => {
			await loadCalculations(value);
		},
	});

	const loadCalculations = useCallback(
		async (filters: FilterValues) => {
			const requestId = latestRequestId.current + 1;
			latestRequestId.current = requestId;
			const startDate = parseFilterDate(filters.startDate, "start");
			const endDate = parseFilterDate(filters.endDate, "end");

			if (!startDate.isValid || !endDate.isValid || startDate > endDate) {
				setDateError("Start date must be on or before end date.");
				setIsLoading(false);
				return;
			}

			setDateError(null);
			setError(null);
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
				setExpandedId((current) =>
					result.data.some((row) => row.id === current) ? current : null,
				);
			} else {
				setError(result.error || "Failed to load surcharge calculations.");
			}

			setIsLoading(false);
		},
		[organizationId],
	);

	useEffect(() => {
		loadCalculations(form.state.values);
	}, [form.state.values, loadCalculations]);

	const totals = rows.reduce(
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
					<CardTitle>Surcharge reports</CardTitle>
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
									<Label htmlFor={field.name}>Start date</Label>
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
									<Label htmlFor={field.name}>End date</Label>
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
									<Label htmlFor={field.name}>Employee ID</Label>
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
								Apply filters
							</Button>
						</div>
						{dateError ? (
							<p aria-live="polite" className="text-destructive text-sm md:col-span-4">
								{dateError}
							</p>
						) : null}
					</form>
				</CardContent>
			</Card>

			{error ? (
				<Alert variant="destructive">
					<IconAlertCircle aria-hidden="true" />
					<AlertTitle>Unable to load calculations</AlertTitle>
					<AlertDescription>{error}</AlertDescription>
				</Alert>
			) : null}

			<div className="grid gap-4 md:grid-cols-4">
				<SummaryCard
					label="Calculations"
					value={`${rows.length} calculation${rows.length === 1 ? "" : "s"}`}
				/>
				<SummaryCard label="Base hours" value={formatMinutes(totals.baseMinutes)} />
				<SummaryCard
					label="Qualifying surcharge hours"
					value={formatMinutes(totals.qualifyingMinutes)}
				/>
				<SummaryCard
					label="Credited surcharge hours"
					value={formatMinutes(totals.surchargeMinutes)}
				/>
			</div>

			<Card>
				<CardContent>
					{isLoading && rows.length === 0 ? (
						<div className="py-8 text-center text-muted-foreground text-sm">
							Loading calculations...
						</div>
					) : rows.length === 0 ? (
						<Empty>
							<EmptyHeader>
								<EmptyMedia variant="icon">
									<IconFileAnalytics aria-hidden="true" />
								</EmptyMedia>
								<EmptyTitle>No surcharge calculations found</EmptyTitle>
								<EmptyDescription>
									No surcharge calculations matched the selected filters.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : (
						<Table>
							<TableHeader>
								<TableRow>
									<TableHead className="w-10" />
									<TableHead>Date</TableHead>
									<TableHead>Employee</TableHead>
									<TableHead>Base</TableHead>
									<TableHead>Qualifying</TableHead>
									<TableHead>Credit</TableHead>
									<TableHead>Percentage</TableHead>
									<TableHead>Created</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{rows.map((calculation) => {
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
														aria-label={`${isExpanded ? "Hide" : "Show"} details for ${employeeName}`}
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
	const details = calculation.calculationDetails;

	return (
		<TableRow id={detailsId} className="bg-muted/30 hover:bg-muted/30">
			<TableCell />
			<TableCell colSpan={7} className="whitespace-normal">
				<div className="grid gap-4 py-2 text-sm">
					<div className="grid gap-2 md:grid-cols-3">
						<div>
							<div className="font-medium">Work period</div>
							<div className="text-muted-foreground">
								{details
									? `${formatTimestamp(details.workPeriodStartTime)} - ${formatTimestamp(details.workPeriodEndTime)}`
									: "-"}
							</div>
						</div>
						<div>
							<div className="font-medium">Calculated at</div>
							<div className="text-muted-foreground">
								{details ? formatTimestamp(details.calculatedAt) : "-"}
							</div>
						</div>
						<div>
							<div className="font-medium">Overlap policy: {details?.overlapPolicy ?? "-"}</div>
						</div>
					</div>

					<div className="space-y-2">
						<div className="font-medium">Applied rules</div>
						{details?.rulesApplied.length ? (
							<div className="grid gap-2">
								{details.rulesApplied.map((rule) => (
									<div key={rule.ruleId} className="rounded-md border p-3">
										<div className="flex flex-wrap items-center gap-2">
											<span className="font-medium">{rule.ruleName}</span>
											<Badge variant="secondary">{rule.ruleType}</Badge>
										</div>
										<div className="mt-2 grid gap-2 text-muted-foreground text-sm md:grid-cols-3">
											<div>Qualifying: {formatMinutes(rule.qualifyingMinutes)}</div>
											<div>Surcharge: {formatMinutes(rule.surchargeMinutes)}</div>
											<div>Percentage: {formatPercentage(rule.percentage)}</div>
										</div>
									</div>
								))}
							</div>
						) : (
							<div className="text-muted-foreground">No applied rules recorded.</div>
						)}
					</div>
				</div>
			</TableCell>
		</TableRow>
	);
}
