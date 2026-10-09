"use client";

import { IconPlus } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Temporal } from "temporal-polyfill";
import {
	BillableRateActionPanel,
	BillableRateSeries,
} from "@/components/billable-time/billable-rate-series";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import { useDisplayContext } from "@/hooks/use-display-context";
import { RATE_LEVELS, type RateLevel } from "@/lib/billable-time/applicable-rate";
import type {
	BillableRateSeriesSummary,
	BillableRateTargetOptions,
} from "@/lib/billable-time/billable-rates";
import { formatBillableAmount, formatRateDate, periodContains } from "@/lib/billable-time/format";
import type { BillableRateTarget } from "@/lib/billable-time/rate-target";
import { useRouter } from "@/navigation";

function useLevelLabels(): Record<RateLevel, { title: string; description: string }> {
	const { t } = useTranslate();
	return {
		employee_project: {
			title: t("settings.billableTime.rates.level.employeeProject", "Employee on a project"),
			description: t(
				"settings.billableTime.rates.level.employeeProjectDescription",
				"Wins over every other rate for this employee's work on this project.",
			),
		},
		project: {
			title: t("settings.billableTime.rates.level.project", "Project"),
			description: t(
				"settings.billableTime.rates.level.projectDescription",
				"Applies to all work on the project without an employee-on-project rate.",
			),
		},
		customer: {
			title: t("settings.billableTime.rates.level.customer", "Customer"),
			description: t(
				"settings.billableTime.rates.level.customerDescription",
				"Applies to work on the customer's projects without a project rate.",
			),
		},
		employee: {
			title: t("settings.billableTime.rates.level.employee", "Employee"),
			description: t(
				"settings.billableTime.rates.level.employeeDescription",
				"The employee's list rate, used when no more specific rate applies.",
			),
		},
	};
}

function targetOf(series: BillableRateSeriesSummary): BillableRateTarget | null {
	switch (series.level) {
		case "employee_project":
			return series.employeeId && series.projectId
				? { level: series.level, employeeId: series.employeeId, projectId: series.projectId }
				: null;
		case "project":
			return series.projectId ? { level: series.level, projectId: series.projectId } : null;
		case "customer":
			return series.customerId ? { level: series.level, customerId: series.customerId } : null;
		case "employee":
			return series.employeeId ? { level: series.level, employeeId: series.employeeId } : null;
	}
}

function targetName(series: BillableRateSeriesSummary): string {
	switch (series.level) {
		case "employee_project":
			return `${series.employeeName ?? "?"} · ${series.projectName ?? "?"}`;
		case "project":
			return series.projectName ?? "?";
		case "customer":
			return series.customerName ?? "?";
		case "employee":
			return series.employeeName ?? "?";
	}
}

export function BillableRatesOverview({
	currency,
	series,
	options,
}: {
	currency: string;
	series: BillableRateSeriesSummary[];
	options: BillableRateTargetOptions;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const { locale, timezone } = useDisplayContext();
	const labels = useLevelLabels();
	const today = Temporal.Now.plainDateISO(timezone).toString();
	const [selected, setSelected] = useState<{ target: BillableRateTarget; title: string } | null>(
		null,
	);
	const [adding, setAdding] = useState(false);

	return (
		<div className="space-y-6">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<p className="max-w-xl text-sm text-muted-foreground">
					{t(
						"settings.billableTime.rates.intro",
						"Rates are in {currency} per hour. For each piece of work the most specific rate in effect on the day it started applies: employee on a project, then project, then customer, then employee.",
						{ currency },
					)}
				</p>
				<Button onClick={() => setAdding(true)}>
					<IconPlus aria-hidden="true" className="mr-2 size-4" />
					{t("settings.billableTime.rates.add", "Add rate")}
				</Button>
			</div>

			{RATE_LEVELS.map((level) => {
				const rows = series
					.filter((entry) => entry.level === level)
					.map((entry) => ({ entry, name: targetName(entry) }))
					.sort((left, right) => left.name.localeCompare(right.name));
				return (
					<Card key={level}>
						<CardHeader>
							<CardTitle className="text-base">{labels[level].title}</CardTitle>
							<CardDescription>{labels[level].description}</CardDescription>
						</CardHeader>
						<CardContent>
							{rows.length === 0 ? (
								<p className="text-sm text-muted-foreground">
									{t("settings.billableTime.rates.noneAtLevel", "No rates at this level yet")}
								</p>
							) : (
								<Table>
									<TableHeader>
										<TableRow>
											<TableHead>{t("settings.billableTime.rates.for", "For")}</TableHead>
											<TableHead>{t("settings.billableTime.rates.today", "Today")}</TableHead>
											<TableHead className="sr-only">
												{t("settings.billableTime.rates.actions", "Actions")}
											</TableHead>
										</TableRow>
									</TableHeader>
									<TableBody>
										{rows.map(({ entry, name }) => {
											const target = targetOf(entry);
											const current = entry.periods.find((period) => periodContains(period, today));
											const next = entry.periods
												.filter((period) => period.effectiveFrom > today)
												.at(-1);
											return (
												<TableRow key={entry.periods[0]?.id ?? name}>
													<TableCell className="font-medium">{name}</TableCell>
													<TableCell className="tabular-nums">
														{current
															? t("settings.billableTime.rates.ratePerHour", "{rate}/h", {
																	rate: formatBillableAmount(locale, current.hourlyRate, currency),
																})
															: next
																? t("settings.billableTime.rates.startsOn", "Starts {date}", {
																		date: formatRateDate(locale, next.effectiveFrom),
																	})
																: t("settings.billableTime.rates.noRateToday", "No rate")}
													</TableCell>
													<TableCell className="text-right">
														{target && (
															<Button
																variant="outline"
																size="sm"
																onClick={() => setSelected({ target, title: name })}
															>
																{t("settings.billableTime.rates.history", "History")}
															</Button>
														)}
													</TableCell>
												</TableRow>
											);
										})}
									</TableBody>
								</Table>
							)}
						</CardContent>
					</Card>
				);
			})}

			<BillableRateActionPanel
				open={selected !== null}
				onOpenChange={(open) => {
					if (!open) setSelected(null);
				}}
				target={selected?.target ?? null}
				title={selected?.title ?? ""}
				description={selected ? labels[selected.target.level].title : undefined}
				onChanged={() => router.refresh()}
			/>

			<AddRatePanel
				open={adding}
				onOpenChange={setAdding}
				options={options}
				onChanged={() => router.refresh()}
			/>
		</div>
	);
}

const NONE = "";

function AddRatePanel({
	open,
	onOpenChange,
	options,
	onChanged,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	options: BillableRateTargetOptions;
	onChanged: () => void;
}) {
	const { t } = useTranslate();
	const labels = useLevelLabels();
	const [level, setLevel] = useState<RateLevel>("project");
	const [employeeId, setEmployeeId] = useState(NONE);
	const [projectId, setProjectId] = useState(NONE);
	const [customerId, setCustomerId] = useState(NONE);

	const needsEmployee = level === "employee" || level === "employee_project";
	const needsProject = level === "project" || level === "employee_project";
	const target: BillableRateTarget | null =
		level === "employee_project" && employeeId && projectId
			? { level, employeeId, projectId }
			: level === "project" && projectId
				? { level, projectId }
				: level === "customer" && customerId
					? { level, customerId }
					: level === "employee" && employeeId
						? { level, employeeId }
						: null;

	return (
		<ActionPanel
			open={open}
			onOpenChange={(next) => {
				onOpenChange(next);
				if (!next) {
					setEmployeeId(NONE);
					setProjectId(NONE);
					setCustomerId(NONE);
				}
			}}
		>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>{t("settings.billableTime.rates.add", "Add rate")}</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.billableTime.rates.addDescription",
							"Choose the rate level and what the rate is for.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<ActionPanelBody className="space-y-4">
					<div className="space-y-2">
						<Label htmlFor="billable-rate-level">
							{t("settings.billableTime.rates.levelLabel", "Rate level")}
						</Label>
						<Select value={level} onValueChange={(value) => setLevel(value as RateLevel)}>
							<SelectTrigger id="billable-rate-level" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{RATE_LEVELS.map((option) => (
									<SelectItem key={option} value={option}>
										{labels[option].title}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						<p className="text-sm text-muted-foreground">{labels[level].description}</p>
					</div>
					{needsEmployee && (
						<TargetSelect
							id="billable-rate-employee"
							label={t("settings.billableTime.rates.employee", "Employee")}
							placeholder={t("settings.billableTime.rates.chooseEmployee", "Choose an employee")}
							value={employeeId}
							onChange={setEmployeeId}
							options={options.employees.map((option) => ({
								id: option.id,
								label: option.name,
							}))}
						/>
					)}
					{needsProject && (
						<TargetSelect
							id="billable-rate-project"
							label={t("settings.billableTime.rates.project", "Project")}
							placeholder={t("settings.billableTime.rates.chooseProject", "Choose a project")}
							value={projectId}
							onChange={setProjectId}
							options={options.projects.map((option) => ({
								id: option.id,
								label: option.customerName
									? `${option.name} · ${option.customerName}`
									: option.name,
							}))}
						/>
					)}
					{level === "customer" && (
						<TargetSelect
							id="billable-rate-customer"
							label={t("settings.billableTime.rates.customer", "Customer")}
							placeholder={t("settings.billableTime.rates.chooseCustomer", "Choose a customer")}
							value={customerId}
							onChange={setCustomerId}
							options={options.customers.map((option) => ({
								id: option.id,
								label: option.name,
							}))}
						/>
					)}
					{open && target && (
						<BillableRateSeries
							key={JSON.stringify(target)}
							target={target}
							title={null}
							bare
							onChanged={onChanged}
						/>
					)}
				</ActionPanelBody>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function TargetSelect({
	id,
	label,
	placeholder,
	value,
	onChange,
	options,
}: {
	id: string;
	label: string;
	placeholder: string;
	value: string;
	onChange: (value: string) => void;
	options: { id: string; label: string }[];
}) {
	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{label}</Label>
			<Select value={value} onValueChange={onChange}>
				<SelectTrigger id={id} className="w-full">
					<SelectValue placeholder={placeholder} />
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option.id} value={option.id}>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	);
}
