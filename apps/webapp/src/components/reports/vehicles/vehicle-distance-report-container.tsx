"use client";

import { IconAlertCircle, IconCar, IconChartBar } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { Fragment, useEffect, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { getVehicleDistanceReport } from "@/app/[locale]/(app)/reports/vehicles/actions";
import { useViewRefresh } from "@/components/providers/view-refresh-provider";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Table,
	TableBody,
	TableCell,
	TableFooter,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDisplayContext } from "@/hooks/use-display-context";
import { useOrganization } from "@/hooks/use-organization";
import { useSession } from "@/lib/auth-client";
import { parsePlainDate, systemClock } from "@/lib/datetime/temporal-core";
import {
	formatInstant,
	formatPlainDate,
	formatPlainDateRange,
} from "@/lib/datetime/temporal-format";
import { getDateRangeForPreset } from "@/lib/reports/date-ranges";
import type { ReportDateRange } from "@/lib/reports/types";
import {
	buildVehicleDistanceReportDocument,
	type VehicleDistanceExportLabels,
	type VehicleDistanceReport,
} from "@/lib/reports/vehicle-distance-report";
import { useOrganizationSettings } from "@/stores/organization-settings-store";
import { VehicleReportExports } from "./vehicle-report-exports";
import { VehicleReportPeriodPicker } from "./vehicle-report-period-picker";

/**
 * The distance per vehicle report (#1129): pick a period, then read whole
 * kilometres per vehicle and employee per month. The server decides whose
 * driving the viewer sees.
 */
export function VehicleDistanceReportContainer() {
	const scope = useOrganization();
	const session = useSession();
	const { t } = useTranslate();
	if (
		scope.isLoading ||
		scope.error ||
		session.isPending ||
		!scope.employeeId ||
		!scope.userId ||
		!scope.activeOrganizationId ||
		session.data?.user.id !== scope.userId ||
		session.data?.session.activeOrganizationId !== scope.activeOrganizationId
	) {
		return (
			<p role="status" className="px-4 lg:px-6">
				{t("reports.vehicles.scopeLoading", "Confirming the current organization and employee…")}
			</p>
		);
	}
	return (
		<VehicleReportArrival
			key={JSON.stringify([scope.userId, scope.activeOrganizationId, scope.employeeId, scope.role])}
		/>
	);
}

function VehicleReportArrival() {
	const { t } = useTranslate();
	const display = useDisplayContext();
	const { locale } = display;
	const { isHydrated, timezone } = useOrganizationSettings(
		useShallow((state) => ({
			isHydrated: state.isHydrated,
			timezone: state.timezone,
		})),
	);
	const hasUserChangedRange = useRef(false);
	const [dateRange, setDateRange] = useState<ReportDateRange | null>(null);
	const generatedRange = useRef<ReportDateRange | null>(null);
	const attemptedRange = useRef<ReportDateRange | null>(null);
	const [report, setReport] = useState<VehicleDistanceReport | null>(null);
	const [isLoading, setIsLoading] = useState(false);
	const [error, setError] = useState<string | null>(null);
	// Every effect setup owns a distinct arrival, including an Activity restore.
	// A retired token is never reactivated, even when the same org/account returns.
	const [lifetime, setLifetime] = useState({ active: false });
	const pending = useRef<object | null>(null);
	const revision = useRef(0);
	const [generation, setGeneration] = useState(0);
	const [generatedAt, setGeneratedAt] = useState<string | null>(null);
	useEffect(() => {
		const token = { active: true };
		setLifetime(token);
		setIsLoading(false);
		setReport(null);
		setError(null);
		generatedRange.current = null;
		pending.current = null;
		return () => {
			token.active = false;
		};
	}, []);

	useEffect(() => {
		if (!isHydrated || hasUserChangedRange.current) return;
		setDateRange(getDateRangeForPreset("current_year", { timezone }));
	}, [isHydrated, timezone]);

	const monthLabel = (month: string) =>
		formatPlainDate(parsePlainDate(`${month}-01`), locale, "monthYear");
	const kilometres = (km: number) =>
		t("reports.vehicles.kilometres", "{distance} km", {
			distance: km.toLocaleString(locale),
		});

	const exportLabels: VehicleDistanceExportLabels = {
		title: t("reports.vehicles.title", "Distance per Vehicle"),
		period: t("reports.vehicles.export.period", "Period"),
		generatedAt: t("reports.vehicles.export.generatedAt", "Generated on"),
		table: t("reports.vehicles.export.table", "Kilometres"),
		vehicle: t("reports.vehicles.table.vehicle", "Vehicle"),
		licencePlate: t("reports.vehicles.table.licencePlate", "Licence plate"),
		employee: t("reports.vehicles.table.employee", "Employee"),
		total: t("reports.vehicles.table.total", "Total"),
		ownVehicle: t("reports.vehicles.ownVehicle", "Own vehicle"),
		archived: t("reports.vehicles.archived", "archived"),
		note: t(
			"reports.vehicles.export.note",
			"Whole kilometres of completed work, counted in the month the work started in (local time where it was recorded).",
		),
		footer: t("reports.vehicles.export.footer", "Generated by Z8"),
		monthLabel,
	};

	useViewRefresh(async () => {
		const range = generatedRange.current;
		if (!range || !report || !lifetime.active || pending.current) return;
		await generate(range, lifetime);
	});

	async function generate(range: ReportDateRange, arrival: { active: boolean }) {
		if (!arrival.active || pending.current) return;
		const request = {};
		pending.current = request;
		revision.current += 1;
		setGeneration(revision.current);
		attemptedRange.current = range;
		setIsLoading(true);
		setError(null);
		try {
			const result = await getVehicleDistanceReport(range.startDate, range.endDate);
			if (!arrival.active || pending.current !== request) return;
			if (!result.success) {
				if (result.code === "AuthorizationError" || result.code === "AuthenticationError")
					setReport(null);
				throw new Error(result.error);
			}
			generatedRange.current = range;
			setGeneratedAt(formatInstant(systemClock.nowInstant(), display, "dateTimeMedium"));
			setReport(result.data);
		} catch (cause) {
			if (arrival.active && pending.current === request)
				setError(
					cause instanceof Error
						? cause.message
						: t(
								"reports.vehicles.failed",
								"The distance per vehicle report could not be generated",
							),
				);
		} finally {
			if (arrival.active && pending.current === request) {
				pending.current = null;
				setIsLoading(false);
			}
		}
	}
	const form = useForm({
		defaultValues: { range: dateRange },
		onSubmitMeta: { arrival: lifetime },
		onSubmit: async ({ value, meta }) => {
			if (value.range) await generate(value.range, meta.arrival);
		},
	});
	const periodLabel = report
		? formatPlainDateRange(
				parsePlainDate(report.period.fromDay),
				parsePlainDate(report.period.toDay),
				locale,
				"dateMedium",
			)
		: null;
	const staged =
		!!report &&
		!!dateRange &&
		(dateRange.startDate !== report.period.fromDay || dateRange.endDate !== report.period.toDay);

	return (
		<div className="space-y-6 px-4 lg:px-6">
			<Card>
				<CardContent className="pt-6">
					<form
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							form.setFieldValue("range", dateRange);
							void form.handleSubmit({ arrival: lifetime });
						}}
					>
						<div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
							<fieldset className="space-y-2">
								<legend className="text-sm font-medium leading-none">
									{t("reports.vehicles.filter.period", "Period")}
								</legend>
								{dateRange ? (
									<VehicleReportPeriodPicker
										value={dateRange}
										onChange={(range) => {
											hasUserChangedRange.current = true;
											setDateRange(range);
										}}
									/>
								) : (
									<p className="text-sm text-muted-foreground">
										{t(
											"reports.filter.loadingSettings",
											"Loading organization settings before enabling presets.",
										)}
									</p>
								)}
							</fieldset>
							<Button
								type="submit"
								disabled={isLoading || !dateRange || !lifetime.active}
								size="lg"
								className="w-full sm:w-auto"
							>
								<IconChartBar aria-hidden="true" className="mr-2 size-4" />
								{isLoading
									? t("reports.vehicles.generating", "Generating report…")
									: t("reports.vehicles.generate", "Generate report")}
							</Button>
						</div>
					</form>
					{staged && (
						<p role="status" className="mt-3 text-sm text-muted-foreground">
							{t(
								"reports.vehicles.staged",
								"Period changed. Generate report to update the results and downloads.",
							)}
						</p>
					)}
				</CardContent>
			</Card>

			{error && (
				<Alert variant="destructive">
					<IconAlertCircle className="size-4" />
					<AlertTitle>{t("reports.vehicles.error", "Error")}</AlertTitle>
					<AlertDescription>
						{error}
						<Button
							variant="outline"
							disabled={isLoading}
							onClick={() => {
								const range = attemptedRange.current ?? dateRange;
								if (range) void generate(range, lifetime);
							}}
						>
							{t("common.retry", "Retry")}
						</Button>
					</AlertDescription>
				</Alert>
			)}

			{isLoading && <p role="status">{t("reports.vehicles.generating", "Generating report…")}</p>}
			{report && (
				<div className="flex flex-wrap items-end justify-between gap-4 rounded-lg border bg-card p-4 sm:p-6">
					<div className="space-y-1">
						<p className="text-sm text-muted-foreground">
							{t("reports.vehicles.table.total", "Total")}
						</p>
						<p className="text-3xl font-semibold tabular-nums">{kilometres(report.totalKm)}</p>
						<p className="text-sm">{periodLabel}</p>
					</div>
					<div className="space-y-2 text-sm">
						<p>{t("reports.vehicles.scope", "Employees available to you in this organization")}</p>
						<p className="text-muted-foreground">
							{t("reports.vehicles.generated", "Generated on {time}", {
								time: generatedAt ?? "",
							})}
						</p>
						{!isLoading && !error && report.vehicles.length > 0 && (
							<VehicleReportExports
								key={generation}
								isCurrent={() => lifetime.active && revision.current === generation}
								buildDocument={() =>
									buildVehicleDistanceReportDocument(report, {
										labels: exportLabels,
										periodLabel: periodLabel ?? "",
										generatedAt: generatedAt ?? "",
									})
								}
							/>
						)}
					</div>
				</div>
			)}
			{!isLoading && !error && report && report.vehicles.length === 0 && (
				<EmptyState
					title={t("reports.vehicles.empty.title", "No driving in this period")}
					description={t(
						"reports.vehicles.empty.description",
						"No completed work with a driven distance was recorded in this period.",
					)}
				/>
			)}

			{report && report.vehicles.length > 0 && (
				<Card>
					<CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
						<CardTitle>
							{t("reports.vehicles.comparison", "Monthly distance by vehicle and employee")}
						</CardTitle>
					</CardHeader>
					<CardContent className="overflow-x-auto">
						<Table
							aria-label={t(
								"reports.vehicles.comparison",
								"Monthly distance by vehicle and employee",
							)}
						>
							<TableHeader>
								<TableRow>
									<TableHead>
										{t("reports.vehicles.table.vehicleAndEmployee", "Vehicle / employee")}
									</TableHead>
									{report.months.map((month) => (
										<TableHead key={month} className="text-right whitespace-nowrap">
											{monthLabel(month)}
										</TableHead>
									))}
									<TableHead className="text-right">
										{t("reports.vehicles.table.total", "Total")}
									</TableHead>
								</TableRow>
							</TableHeader>
							<TableBody>
								{report.vehicles.map((group) => (
									<Fragment
										key={group.vehicle.kind === "own" ? "own" : `organization:${group.vehicle.id}`}
									>
										<TableRow className="bg-muted/50 font-medium">
											<TableCell>
												<div className="flex flex-wrap items-center gap-2">
													<IconCar className="size-4 text-muted-foreground" aria-hidden="true" />
													{group.vehicle.kind === "own" ? (
														exportLabels.ownVehicle
													) : (
														<>
															<span>{group.vehicle.name}</span>
															<span className="text-muted-foreground text-sm">
																{group.vehicle.licencePlate}
															</span>
															{group.vehicle.archived && (
																<Badge variant="secondary">
																	{t("reports.vehicles.archivedBadge", "Archived")}
																</Badge>
															)}
														</>
													)}
												</div>
											</TableCell>
											{group.monthlyKm.map((km, index) => (
												<TableCell key={report.months[index]} className="text-right tabular-nums">
													{kilometres(km)}
												</TableCell>
											))}
											<TableCell className="text-right tabular-nums">
												{kilometres(group.totalKm)}
											</TableCell>
										</TableRow>
										{group.employees.map((row) => (
											<TableRow key={row.employeeId}>
												<TableCell className="pl-10">{row.employeeName}</TableCell>
												{row.monthlyKm.map((km, index) => (
													<TableCell
														key={report.months[index]}
														className="text-right tabular-nums text-muted-foreground"
													>
														{km === 0 ? "–" : kilometres(km)}
													</TableCell>
												))}
												<TableCell className="text-right tabular-nums">
													{kilometres(row.totalKm)}
												</TableCell>
											</TableRow>
										))}
									</Fragment>
								))}
							</TableBody>
							<TableFooter>
								<TableRow>
									<TableCell>{t("reports.vehicles.table.total", "Total")}</TableCell>
									{report.monthlyKm.map((km, index) => (
										<TableCell key={report.months[index]} className="text-right tabular-nums">
											{kilometres(km)}
										</TableCell>
									))}
									<TableCell className="text-right tabular-nums">
										{kilometres(report.totalKm)}
									</TableCell>
								</TableRow>
							</TableFooter>
						</Table>
						<p className="mt-4 text-sm text-muted-foreground">{exportLabels.note}</p>
					</CardContent>
				</Card>
			)}

			{!report && !isLoading && !error && (
				<EmptyState
					title={t("reports.vehicles.noReportYet", "No report generated yet")}
					description={t(
						"reports.vehicles.selectPeriod",
						"Choose a period and generate the report.",
					)}
				/>
			)}
		</div>
	);
}

function EmptyState({ title, description }: { title: string; description: string }) {
	return (
		<Card>
			<CardContent className="flex items-center justify-center py-12">
				<div className="flex flex-col items-center gap-4 text-center">
					<IconCar className="size-6 text-muted-foreground" aria-hidden="true" />
					<div>
						<p className="font-semibold">{title}</p>
						<p className="text-sm text-muted-foreground">{description}</p>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
