"use client";

import {
	IconAlertTriangle,
	IconCalendarTime,
	IconCheck,
	IconEye,
	IconGitCommit,
	IconLoader2,
	IconPlus,
	IconRestore,
	IconSparkles,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	adoptEmployeeContractDefaultAction,
	commitEmployeeContractChangeAction,
	createInitialEmploymentAgreementAction,
	getEmployeeEffectiveContractAction,
	listEmployeeTermAgreementsAction,
	previewEmployeeContractChangeAction,
	recordFixedTermExtensionAction,
	resetEmployeeContractDivergencesAction,
} from "@/app/[locale]/(app)/settings/contracts/actions";
import type { EmploymentHistoryEntry } from "@/components/settings/employee-employment-history/types";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type {
	ArbzgScope,
	BalanceMode,
	EmploymentProfile,
	EmploymentTermAgreementKind,
	OnCallHoursKind,
	PresenceOverride,
	ScheduleMode,
	ScheduleSource,
} from "@/db/schema/contract-types";
import type { PreviewEmployeeContractChangeResult } from "@/lib/contracts/commit-contract-change";
import type { FixedTermDepartureSyncAction } from "@/lib/contracts/fixed-term-agreements";
import type {
	ContractFieldSource,
	CustomWorkDay,
	EffectiveContractOnDay,
	WorkModel,
} from "@/lib/contracts/types";
import type { ContractType } from "@/lib/validations/employee";
import {
	formatContractMinutes,
	hoursInputToIntegerMinutes,
	integerMinutesToHoursInput,
	todayIsoDateInTimezone,
	useContractLabels,
} from "./contract-formatters";
import {
	CustomDaysGrid,
	createDefaultCustomDays,
	validateCustomDaysGrid,
} from "./custom-days-grid";

const INHERIT_VALUE = "__inherit__";

interface ChangePanelFormValues {
	validFromDate: string;
	workPolicyId: string;
	weeklyHours: string;
	scheduleMode: ScheduleMode;
	customDays: CustomWorkDay[];
	workModel: WorkModel | "";
	presenceOverride: PresenceOverride;
	balanceMode: BalanceMode | "";
	scheduleSource: ScheduleSource | "";
	contractType: ContractType;
	hourlyRate: string;
	currency: string;
	employmentProfile: EmploymentProfile;
	arbzgScope: ArbzgScope;
	onCallHoursKind: OnCallHoursKind;
	onCallWeeklyHours: string;
	onCallDailyMinutes: string;
	changeReason: string;
}

function buildChangePayload(employeeId: string, values: ChangePanelFormValues) {
	const isOnCall = values.scheduleSource === "on_call";
	const weeklyMinutes = hoursInputToIntegerMinutes(values.weeklyHours);
	const onCallWeeklyMinutes =
		isOnCall && values.onCallHoursKind !== "unspecified"
			? hoursInputToIntegerMinutes(values.onCallWeeklyHours)
			: null;
	const onCallDailyMinutes =
		isOnCall && values.onCallDailyMinutes.trim() !== ""
			? Number.parseInt(values.onCallDailyMinutes, 10)
			: null;

	return {
		employeeId,
		validFromDate: values.validFromDate,
		reviewState: "confirmed" as const,
		workPolicyId: values.workPolicyId === INHERIT_VALUE ? null : values.workPolicyId,
		clearPersonalPolicyPin: values.workPolicyId === INHERIT_VALUE,
		weeklyContractMinutes: weeklyMinutes,
		scheduleMode: values.scheduleMode === "inherit" ? null : values.scheduleMode,
		customDays: values.scheduleMode === "custom_days" ? values.customDays : null,
		workModel: (values.workModel || null) as WorkModel | null,
		presenceOverride: values.presenceOverride,
		balanceMode: (values.balanceMode || null) as BalanceMode | null,
		scheduleSource: (values.scheduleSource || null) as ScheduleSource | null,
		contractType: values.contractType,
		hourlyRate:
			values.contractType === "hourly" && values.hourlyRate.trim() !== ""
				? Number(values.hourlyRate)
				: null,
		currency: values.currency.trim() || "EUR",
		employmentProfile: values.employmentProfile,
		arbzgScope: values.arbzgScope,
		onCallHoursKind: isOnCall ? values.onCallHoursKind : null,
		onCallWeeklyMinutes,
		onCallDailyMinutes,
		changeReason: values.changeReason.trim() || null,
	};
}

function buildPrefilledValues(
	effective: EffectiveContractOnDay | null,
	organizationTimezone: string,
): ChangePanelFormValues {
	const weeklyDays: CustomWorkDay[] =
		effective?.scheduleMode === "custom_days" && effective.weeklyScheduleDays.length > 0
			? effective.weeklyScheduleDays.map((d) => ({
					dayOfWeek: d.dayOfWeek,
					minutesPerDay: d.minutesPerDay,
					isWorkDay: d.isWorkDay,
					latestClockIn: d.latestClockIn,
				}))
			: createDefaultCustomDays(effective?.weeklyContractMinutes ?? 2400);

	return {
		validFromDate: todayIsoDateInTimezone(organizationTimezone),
		workPolicyId:
			effective?.workPolicySource === "employee_override" && effective.workPolicy
				? effective.workPolicy.policyId
				: INHERIT_VALUE,
		weeklyHours:
			effective?.weeklyContractMinutesSource === "employee_override"
				? integerMinutesToHoursInput(effective.weeklyContractMinutes)
				: "",
		scheduleMode:
			effective?.scheduleModeSource === "employee_override" ? effective.scheduleMode : "inherit",
		customDays: weeklyDays,
		workModel:
			effective?.workModelSource === "employee_override" ? (effective.workModel ?? "") : "",
		presenceOverride:
			effective?.presenceOverrideSource === "employee_override"
				? effective.presenceOverride
				: "inherit",
		balanceMode:
			effective?.balanceModeSource === "employee_override" && effective.balanceMode !== "excluded"
				? effective.balanceMode
				: "",
		scheduleSource:
			effective?.scheduleSourceSource === "employee_override" ? effective.scheduleSource : "",
		contractType: effective?.contractType ?? "fixed",
		hourlyRate:
			effective?.hourlyRate !== null && effective?.hourlyRate !== undefined
				? String(effective.hourlyRate)
				: "",
		currency: effective?.currency ?? "EUR",
		employmentProfile: effective?.employmentProfile ?? "regular",
		arbzgScope: effective?.arbzgScope ?? "standard",
		onCallHoursKind: effective?.onCallTerms?.hoursKind ?? "exact",
		onCallWeeklyHours: integerMinutesToHoursInput(effective?.onCallTerms?.weeklyMinutes ?? 1200),
		onCallDailyMinutes:
			effective?.onCallTerms?.dailyMinutes !== null &&
			effective?.onCallTerms?.dailyMinutes !== undefined
				? String(effective.onCallTerms.dailyMinutes)
				: "",
		changeReason: "",
	};
}

export interface EmployeeContractTabProps {
	organizationId: string;
	organizationTimezone: string;
	employeeId: string;
	workPolicies: readonly { id: string; name: string }[];
	employmentHistory: readonly EmploymentHistoryEntry[];
	onContractMutated?: () => void;
}

export function EmployeeContractTab({
	organizationId,
	organizationTimezone,
	employeeId,
	workPolicies,
	employmentHistory,
	onContractMutated,
}: EmployeeContractTabProps) {
	const { t } = useTranslate();
	const labels = useContractLabels();
	const queryClient = useQueryClient();
	const [asOfDate, setAsOfDate] = useState(() => todayIsoDateInTimezone(organizationTimezone));
	const [changePanelOpen, setChangePanelOpen] = useState(false);
	const [agreementDialogMode, setAgreementDialogMode] = useState<"initial" | "extension" | null>(
		null,
	);

	const effectiveQuery = useQuery({
		queryKey: ["contracts", "employee-effective", organizationId, employeeId, asOfDate],
		queryFn: async () => {
			const result = await getEmployeeEffectiveContractAction({ employeeId, asOfDate });
			if (!result.success) throw new Error(result.error || "Failed to resolve effective contract");
			return result.data;
		},
		staleTime: 15 * 1000,
	});

	const agreementsQuery = useQuery({
		queryKey: ["contracts", "employee-agreements", organizationId, employeeId],
		queryFn: async () => {
			const result = await listEmployeeTermAgreementsAction({ employeeId });
			if (!result.success) throw new Error(result.error || "Failed to load employment agreements");
			return result.data;
		},
		staleTime: 15 * 1000,
	});

	const refreshAll = () => {
		void Promise.all([
			queryClient.invalidateQueries({
				queryKey: ["contracts", "employee-effective", organizationId, employeeId],
			}),
			queryClient.invalidateQueries({
				queryKey: ["contracts", "employee-agreements", organizationId, employeeId],
			}),
		]);
		onContractMutated?.();
	};

	const adoptMutation = useMutation({
		mutationFn: async () => {
			const result = await adoptEmployeeContractDefaultAction({
				employeeId,
				effectiveFromDate: asOfDate,
			});
			if (!result.success) throw new Error(result.error || "Failed to adopt default");
			return result.data;
		},
		onSuccess: () => {
			toast.success(
				t("settings.contracts.employee.adoptedDefault", "Adopted Org/Team default contract"),
			);
			refreshAll();
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.employee.adoptFailed", "Could not adopt default contract"),
			);
		},
	});

	const resetMutation = useMutation({
		mutationFn: async () => {
			const result = await resetEmployeeContractDivergencesAction({
				employeeId,
				effectiveFromDate: asOfDate,
			});
			if (!result.success) throw new Error(result.error || "Failed to reset divergences");
			return result.data;
		},
		onSuccess: () => {
			toast.success(
				t("settings.contracts.employee.resetSuccess", "Operational overrides reset to default"),
			);
			refreshAll();
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.employee.resetFailed", "Could not reset overrides"),
			);
		},
	});

	const effective = effectiveQuery.data ?? null;
	const agreements = agreementsQuery.data?.agreements ?? [];
	const pendingDeparture = agreementsQuery.data?.pendingScheduledDeparture ?? null;

	const hasAnyOverride =
		effective !== null &&
		(effective.workPolicySource === "employee_override" ||
			effective.weeklyContractMinutesSource === "employee_override" ||
			effective.scheduleModeSource === "employee_override" ||
			effective.workModelSource === "employee_override" ||
			effective.presenceOverrideSource === "employee_override" ||
			effective.balanceModeSource === "employee_override" ||
			effective.scheduleSourceSource === "employee_override");

	const termRows: readonly {
		key: string;
		label: string;
		value: string;
		source: ContractFieldSource;
	}[] = effective
		? [
				{
					key: "workPolicy",
					label: t("settings.contracts.fields.workPolicy", "Work policy"),
					value: effective.workPolicy?.policyName ?? t("settings.contracts.values.none", "None"),
					source: effective.workPolicySource,
				},
				{
					key: "weeklyHours",
					label: t("settings.contracts.fields.weeklyHours", "Weekly hours"),
					value: formatContractMinutes(effective.weeklyContractMinutes),
					source: effective.weeklyContractMinutesSource,
				},
				{
					key: "scheduleMode",
					label: t("settings.contracts.fields.scheduleMode", "Schedule mode"),
					value: labels.scheduleMode(effective.scheduleMode),
					source: effective.scheduleModeSource,
				},
				{
					key: "workModel",
					label: t("settings.contracts.fields.workModel", "Work model"),
					value: labels.workModel(effective.workModel),
					source: effective.workModelSource,
				},
				{
					key: "presence",
					label: t("settings.contracts.fields.presenceStatus", "On-site presence"),
					value: `${labels.presenceStatus(effective.presenceStatus)} (${labels.presenceOverride(effective.presenceOverride)})`,
					source: effective.presenceOverrideSource,
				},
				{
					key: "balanceMode",
					label: t("settings.contracts.fields.balanceMode", "Balance mode"),
					value: labels.balanceMode(effective.balanceMode),
					source: effective.balanceModeSource,
				},
				{
					key: "scheduleSource",
					label: t("settings.contracts.fields.scheduleSource", "Schedule source"),
					value: labels.scheduleSource(effective.scheduleSource),
					source: effective.scheduleSourceSource,
				},
				{
					key: "contractType",
					label: t("settings.contracts.fields.contractType", "Contract type"),
					value:
						effective.contractType === "hourly" && effective.hourlyRate !== null
							? `${labels.contractType("hourly")} (${effective.hourlyRate} ${effective.currency}/h)`
							: labels.contractType(effective.contractType),
					source: "employee_term",
				},
				{
					key: "employmentProfile",
					label: t("settings.contracts.fields.employmentProfile", "Employment profile"),
					value: labels.employmentProfile(effective.employmentProfile),
					source: "employee_term",
				},
				{
					key: "arbzgScope",
					label: t("settings.contracts.fields.arbzgScope", "ArbZG scope"),
					value: labels.arbzgScope(effective.arbzgScope),
					source: "employee_term",
				},
			]
		: [];

	// Group confirmed employment history by stint (`employmentPeriodId`)
	const stintGroups = useMemo(() => {
		const groups = new Map<string, EmploymentHistoryEntry[]>();
		for (const entry of employmentHistory) {
			if (entry.reviewState !== "confirmed") continue;
			const stintKey = entry.employmentPeriodId ?? "legacy";
			const list = groups.get(stintKey) ?? [];
			list.push(entry);
			groups.set(stintKey, list);
		}
		return [...groups.entries()].map(([periodId, entries]) => ({
			periodId,
			period: entries[0]?.employmentPeriod ?? null,
			entries: [...entries].sort(
				(a, b) => new Date(b.validFrom).getTime() - new Date(a.validFrom).getTime(),
			),
		}));
	}, [employmentHistory]);

	return (
		<div className="space-y-6">
			{/* Effective Contract Card with As-Of Date Switcher & Term / Value / Source Table */}
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-4">
						<div>
							<CardTitle className="flex items-center gap-2">
								<IconCalendarTime className="size-5" aria-hidden="true" />
								{t("settings.contracts.employee.effectiveTitle", "Effective Contract")}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.contracts.employee.effectiveDescription",
									"Inspect resolved operational rules and employee-owned legal terms as of any past, current, or future date.",
								)}
							</CardDescription>
						</div>

						<div className="flex flex-wrap items-end gap-2">
							<div className="space-y-1">
								<Label htmlFor="contract-as-of-date" className="text-xs">
									{t("settings.contracts.employee.asOfDate", "As of date")}
								</Label>
								<Input
									id="contract-as-of-date"
									type="date"
									value={asOfDate}
									onChange={(e) => setAsOfDate(e.target.value)}
									className="h-8 w-44"
								/>
							</div>
							<Button type="button" size="sm" onClick={() => setChangePanelOpen(true)}>
								<IconPlus className="mr-1.5 size-4" aria-hidden="true" />
								{t("settings.contracts.employee.changeContract", "Change contract")}
							</Button>
						</div>
					</div>
				</CardHeader>

				<CardContent className="space-y-4">
					{effective?.migratedLegacyTerms && (
						<Alert role="status" className="border-primary/30 bg-primary/5">
							<IconSparkles className="size-4 text-primary" aria-hidden="true" />
							<AlertTitle>
								{t("settings.contracts.employee.legacyTermsTitle", "Preserved pre-migration terms")}
							</AlertTitle>
							<AlertDescription className="mt-1 flex flex-wrap items-center justify-between gap-3">
								<span>
									{t(
										"settings.contracts.employee.legacyTermsBody",
										"This employee still uses preserved legacy values. Opt into live Org/Primary Team default inheritance in one click.",
									)}
								</span>
								<Button
									type="button"
									size="sm"
									disabled={adoptMutation.isPending}
									onClick={() => adoptMutation.mutate()}
								>
									{adoptMutation.isPending && (
										<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
									)}
									{t("settings.contracts.employee.adoptDefault", "Adopt Org/Team default")}
								</Button>
							</AlertDescription>
						</Alert>
					)}

					{effective?.mismatchWarning && (
						<Alert variant="destructive" role="alert">
							<IconAlertTriangle className="size-4" aria-hidden="true" />
							<AlertTitle>
								{t(
									"settings.contracts.employee.mismatchTitle",
									"Weekly hours differ from work policy day sum",
								)}
							</AlertTitle>
							<AlertDescription>
								{t(
									"settings.contracts.employee.mismatchBody",
									"Contract weekly hours ({contractHours}) differ from the detailed work policy total ({policyHours}). Work days are scaled proportionally until aligned.",
									{
										contractHours: formatContractMinutes(
											effective.mismatchWarning.employeeWeeklyMinutes,
										),
										policyHours: formatContractMinutes(
											effective.mismatchWarning.policyDetailedDaySumMinutes,
										),
									},
								)}
							</AlertDescription>
						</Alert>
					)}

					{effectiveQuery.isLoading ? (
						<div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
							<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
							{t("common.loading", "Loading…")}
						</div>
					) : !effective ? (
						<p className="text-muted-foreground text-sm">
							{t(
								"settings.contracts.employee.noEffectiveContract",
								"No contract could be resolved for this date.",
							)}
						</p>
					) : (
						<>
							<div className="overflow-x-auto rounded-lg border">
								<table className="w-full text-left text-sm">
									<thead className="border-b bg-muted/40 text-muted-foreground text-xs">
										<tr>
											<th className="px-3 py-2 font-medium">
												{t("settings.contracts.employee.colTerm", "Term")}
											</th>
											<th className="px-3 py-2 font-medium">
												{t("settings.contracts.employee.colValue", "Value")}
											</th>
											<th className="px-3 py-2 font-medium">
												{t("settings.contracts.employee.colSource", "Source")}
											</th>
										</tr>
									</thead>
									<tbody className="divide-y">
										{termRows.map((row) => (
											<tr key={row.key}>
												<td className="px-3 py-2 font-medium">{row.label}</td>
												<td className="px-3 py-2">{row.value}</td>
												<td className="px-3 py-2">
													<Badge
														variant={
															row.source === "employee_override"
																? "default"
																: row.source === "employee_term"
																	? "secondary"
																	: "outline"
														}
													>
														{labels.fieldSource(row.source)}
													</Badge>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>

							{effective.onCallTerms && (
								<Alert role="status">
									<AlertTitle>
										{t("settings.contracts.onCall.summaryTitle", "§ 12 TzBfG On-Call Agreement")}
									</AlertTitle>
									<AlertDescription className="space-y-1 text-xs">
										<p>{labels.onCallHoursKind(effective.onCallTerms.hoursKind)}</p>
										{effective.onCallTerms.dailyMinutes === null ? (
											<p>
												{t(
													"settings.contracts.onCall.statutoryMinDaily",
													"No per-call duration agreed — at least three consecutive hours per call-in applies under § 12(1) TzBfG",
												)}
											</p>
										) : (
											<p>
												{t(
													"settings.contracts.onCall.agreedDailyMinutes",
													"Agreed per-call duration: {duration}",
													{ duration: formatContractMinutes(effective.onCallTerms.dailyMinutes) },
												)}
											</p>
										)}
									</AlertDescription>
								</Alert>
							)}

							{hasAnyOverride && (
								<div className="flex justify-end">
									<Button
										type="button"
										variant="outline"
										size="sm"
										disabled={resetMutation.isPending}
										onClick={() => resetMutation.mutate()}
									>
										{resetMutation.isPending ? (
											<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
										) : (
											<IconRestore className="mr-1.5 size-4" aria-hidden="true" />
										)}
										{t("settings.contracts.employee.resetToDefault", "Reset to default")}
									</Button>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>

			{/* Fixed-Term Linear Agreement Chain */}
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-start justify-between gap-3">
						<div>
							<CardTitle className="text-base">
								{t(
									"settings.contracts.agreements.title",
									"Employment Agreements & Fixed-Term Chain",
								)}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.contracts.agreements.description",
									"Track permanent or fixed-term agreements per stint and extend fixed terms with explicit departure synchronization.",
								)}
							</CardDescription>
						</div>
						<div className="flex gap-2">
							{agreements.length === 0 ? (
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() => setAgreementDialogMode("initial")}
								>
									<IconPlus className="mr-1.5 size-4" aria-hidden="true" />
									{t("settings.contracts.agreements.recordInitial", "Record agreement")}
								</Button>
							) : (
								<Button
									type="button"
									size="sm"
									variant="outline"
									onClick={() => setAgreementDialogMode("extension")}
								>
									<IconGitCommit className="mr-1.5 size-4" aria-hidden="true" />
									{t("settings.contracts.agreements.recordExtension", "Record extension")}
								</Button>
							)}
						</div>
					</div>
				</CardHeader>
				<CardContent>
					{agreementsQuery.isLoading ? (
						<p className="text-muted-foreground text-sm">{t("common.loading", "Loading…")}</p>
					) : agreements.length === 0 ? (
						<p className="text-muted-foreground text-sm">
							{t(
								"settings.contracts.agreements.empty",
								"No permanent or fixed-term agreement recorded yet for this employee.",
							)}
						</p>
					) : (
						<ol className="space-y-2">
							{agreements.map((agreement) => (
								<li
									key={agreement.id}
									className="flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm"
								>
									<div className="flex flex-wrap items-center gap-2">
										<Badge variant="outline">#{agreement.sequenceNumber}</Badge>
										<Badge variant={agreement.kind === "fixed_term" ? "secondary" : "default"}>
											{agreement.kind === "fixed_term"
												? t("settings.contracts.agreements.fixedTerm", "Fixed-term")
												: t("settings.contracts.agreements.permanent", "Permanent")}
										</Badge>
										<span className="tabular-nums">
											{agreement.startsOn}
											{agreement.endsOn ? ` → ${agreement.endsOn}` : ""}
										</span>
									</div>
									{agreement.reason && (
										<span className="text-muted-foreground text-xs">{agreement.reason}</span>
									)}
								</li>
							))}
						</ol>
					)}
				</CardContent>
			</Card>

			{/* Stint-Grouped Confirmed Contract Change Timeline */}
			{stintGroups.length > 0 && (
				<Card>
					<CardHeader>
						<CardTitle className="text-base">
							{t("settings.contracts.timeline.title", "Stint-Grouped Contract Timeline")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.contracts.timeline.description",
								"Confirmed contract changes grouped by employment period.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{stintGroups.map((group, idx) => (
							<div key={group.periodId} className="space-y-2 rounded-lg border p-3">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<span className="font-medium text-sm">
										{t("settings.contracts.timeline.stintLabel", "Employment period #{index}", {
											index: stintGroups.length - idx,
										})}
									</span>
									{group.period && (
										<Badge variant={group.period.status === "open" ? "default" : "secondary"}>
											{group.period.status}
										</Badge>
									)}
								</div>
								<ul className="space-y-1.5 text-xs">
									{group.entries.map((entry) => (
										<li
											key={entry.id}
											className="flex flex-wrap items-center justify-between gap-2 rounded bg-muted/30 px-2.5 py-1.5"
										>
											<span className="font-medium tabular-nums">
												{new Date(entry.validFrom).toISOString().slice(0, 10)}
												{entry.validUntil
													? ` → ${new Date(entry.validUntil).toISOString().slice(0, 10)}`
													: ""}
											</span>
											<span className="text-muted-foreground">
												{labels.contractType(entry.contractType)} ·{" "}
												{entry.weeklyContractMinutes !== null
													? formatContractMinutes(entry.weeklyContractMinutes)
													: t("settings.contracts.values.inherited", "Inherited")}{" "}
												·{" "}
												{entry.workModel
													? labels.workModel(entry.workModel)
													: t("settings.contracts.values.inherited", "Inherited")}
											</span>
										</li>
									))}
								</ul>
							</div>
						))}
					</CardContent>
				</Card>
			)}

			{/* Pre-Filled Contract Change ActionPanel */}
			<ActionPanel open={changePanelOpen} onOpenChange={setChangePanelOpen}>
				<ActionPanelContent size="wide">
					<ActionPanelHeader>
						<ActionPanelTitle>
							{t("settings.contracts.employee.changePanelTitle", "Change Employee Contract")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.contracts.employee.changePanelDescription",
								"Leave operational fields set to Inherit to follow your organization or primary team defaults; set only personal divergences.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody>
						{changePanelOpen && (
							<EmployeeContractChangeForm
								key={`${employeeId}:${effective?.employmentHistoryId ?? "none"}`}
								organizationTimezone={organizationTimezone}
								employeeId={employeeId}
								effective={effective}
								workPolicies={workPolicies}
								onSaved={() => {
									setChangePanelOpen(false);
									refreshAll();
								}}
								onCancel={() => setChangePanelOpen(false)}
							/>
						)}
					</ActionPanelBody>
				</ActionPanelContent>
			</ActionPanel>

			{/* Initial Agreement / Fixed-Term Extension ActionPanel */}
			<ActionPanel
				open={agreementDialogMode !== null}
				onOpenChange={(open) => {
					if (!open) setAgreementDialogMode(null);
				}}
			>
				<ActionPanelContent>
					<ActionPanelHeader>
						<ActionPanelTitle>
							{agreementDialogMode === "extension"
								? t("settings.contracts.agreements.extensionTitle", "Record Fixed-Term Extension")
								: t("settings.contracts.agreements.initialTitle", "Record Employment Agreement")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{agreementDialogMode === "extension"
								? t(
										"settings.contracts.agreements.extensionDescription",
										"Append the next link to this employment period's linear agreement chain and choose how to synchronize any pending leaving date.",
									)
								: t(
										"settings.contracts.agreements.initialDescription",
										"Record whether this employment period starts as permanent or fixed-term.",
									)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody>
						{agreementDialogMode && (
							<FixedTermAgreementForm
								mode={agreementDialogMode}
								organizationTimezone={organizationTimezone}
								employeeId={employeeId}
								pendingDeparture={pendingDeparture}
								onSaved={() => {
									setAgreementDialogMode(null);
									refreshAll();
								}}
								onCancel={() => setAgreementDialogMode(null)}
							/>
						)}
					</ActionPanelBody>
				</ActionPanelContent>
			</ActionPanel>
		</div>
	);
}

function EmployeeContractChangeForm({
	organizationTimezone,
	employeeId,
	effective,
	workPolicies,
	onSaved,
	onCancel,
}: {
	organizationTimezone: string;
	employeeId: string;
	effective: EffectiveContractOnDay | null;
	workPolicies: readonly { id: string; name: string }[];
	onSaved: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const labels = useContractLabels();
	const [preview, setPreview] = useState<PreviewEmployeeContractChangeResult | null>(null);
	const [previewSnapshot, setPreviewSnapshot] = useState<string | null>(null);

	const previewMutation = useMutation({
		mutationFn: async (values: ChangePanelFormValues) => {
			const payload = buildChangePayload(employeeId, values);
			const result = await previewEmployeeContractChangeAction(payload);
			if (!result.success) throw new Error(result.error || "Failed to preview contract change");
			return { data: result.data, snapshot: JSON.stringify(values) };
		},
		onSuccess: ({ data, snapshot }) => {
			setPreview(data);
			setPreviewSnapshot(snapshot);
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.employee.previewFailed", "Could not preview change"),
			);
		},
	});

	const commitMutation = useMutation({
		mutationFn: async (values: ChangePanelFormValues) => {
			const payload = buildChangePayload(employeeId, values);
			const result = await commitEmployeeContractChangeAction(payload);
			if (!result.success) throw new Error(result.error || "Failed to save contract change");
			return result.data;
		},
		onSuccess: () => {
			toast.success(t("settings.contracts.employee.saved", "Contract change saved"));
			onSaved();
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.employee.saveFailed", "Could not save contract change"),
			);
		},
	});

	const form = useForm({
		defaultValues: buildPrefilledValues(effective, organizationTimezone),
		onSubmit: async ({ value }) => {
			if (value.scheduleMode === "custom_days" && validateCustomDaysGrid(value.customDays)) {
				toast.error(
					t(
						"settings.contracts.customDays.fixValidation",
						"Fix the highlighted custom working days before saving.",
					),
				);
				return;
			}
			await commitMutation.mutateAsync(value);
		},
	});

	const values = useStore(form.store, (s) => s.values);
	const isPreviewStale = Boolean(preview && previewSnapshot !== JSON.stringify(values));

	return (
		<form
			className="space-y-5"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field name="validFromDate">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="emp-contract-valid-from">
								{t("settings.contracts.defaults.effectiveFrom", "Effective from")}
							</Label>
							<Input
								id="emp-contract-valid-from"
								type="date"
								required
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
							/>
						</div>
					)}
				</form.Field>

				<form.Field name="workPolicyId">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="emp-contract-policy">
								{t("settings.contracts.fields.workPolicy", "Work policy")}
							</Label>
							<Select value={field.state.value} onValueChange={field.handleChange}>
								<SelectTrigger id="emp-contract-policy">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={INHERIT_VALUE}>
										{t("settings.contracts.values.inheritDefault", "Inherit from Org/Team default")}
									</SelectItem>
									{workPolicies.map((p) => (
										<SelectItem key={p.id} value={p.id}>
											{p.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					)}
				</form.Field>

				<form.Field name="weeklyHours">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="emp-contract-weekly-hours">
								{t(
									"settings.contracts.employee.weeklyHoursOverride",
									"Weekly hours override (blank to inherit)",
								)}
							</Label>
							<Input
								id="emp-contract-weekly-hours"
								type="number"
								min={0}
								max={168}
								step={0.25}
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								placeholder={t("settings.contracts.values.inherited", "Inherited")}
								className="tabular-nums"
							/>
						</div>
					)}
				</form.Field>

				<form.Field name="scheduleMode">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="emp-contract-schedule-mode">
								{t("settings.contracts.fields.scheduleMode", "Schedule mode")}
							</Label>
							<Select
								value={field.state.value}
								onValueChange={(v) => field.handleChange(v as ScheduleMode)}
							>
								<SelectTrigger id="emp-contract-schedule-mode">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="inherit">{labels.scheduleMode("inherit")}</SelectItem>
									<SelectItem value="policy">{labels.scheduleMode("policy")}</SelectItem>
									<SelectItem value="hours_only">{labels.scheduleMode("hours_only")}</SelectItem>
									<SelectItem value="custom_days">{labels.scheduleMode("custom_days")}</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
				</form.Field>

				<form.Field name="workModel">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="emp-contract-work-model">
								{t("settings.contracts.fields.workModel", "Work model")}
							</Label>
							<Select
								value={field.state.value || INHERIT_VALUE}
								onValueChange={(v) => {
									const next = v === INHERIT_VALUE ? "" : (v as WorkModel);
									field.handleChange(next);
									// A5: selecting remote defaults presence override to exempt with explicit override toggle
									if (next === "remote" && values.presenceOverride === "inherit") {
										form.setFieldValue("presenceOverride", "exempt");
									}
								}}
							>
								<SelectTrigger id="emp-contract-work-model">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={INHERIT_VALUE}>
										{t("settings.contracts.values.inheritDefault", "Inherit from Org/Team default")}
									</SelectItem>
									<SelectItem value="onsite">{labels.workModel("onsite")}</SelectItem>
									<SelectItem value="hybrid">{labels.workModel("hybrid")}</SelectItem>
									<SelectItem value="remote">{labels.workModel("remote")}</SelectItem>
									<SelectItem value="flexible">{labels.workModel("flexible")}</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
				</form.Field>

				<form.Field name="presenceOverride">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="emp-contract-presence-override">
								{t("settings.contracts.fields.presenceOverride", "Presence override")}
							</Label>
							<Select
								value={field.state.value}
								onValueChange={(v) => field.handleChange(v as PresenceOverride)}
							>
								<SelectTrigger id="emp-contract-presence-override">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="inherit">{labels.presenceOverride("inherit")}</SelectItem>
									<SelectItem value="exempt">{labels.presenceOverride("exempt")}</SelectItem>
									<SelectItem value="require_onsite">
										{labels.presenceOverride("require_onsite")}
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
				</form.Field>

				<form.Field name="balanceMode">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="emp-contract-balance-mode">
								{t("settings.contracts.fields.balanceMode", "Balance mode")}
							</Label>
							<Select
								value={field.state.value || INHERIT_VALUE}
								onValueChange={(v) =>
									field.handleChange(v === INHERIT_VALUE ? "" : (v as BalanceMode))
								}
							>
								<SelectTrigger id="emp-contract-balance-mode">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={INHERIT_VALUE}>
										{t("settings.contracts.values.inheritDefault", "Inherit from Org/Team default")}
									</SelectItem>
									<SelectItem value="tracked">{labels.balanceMode("tracked")}</SelectItem>
									<SelectItem value="trust_based">{labels.balanceMode("trust_based")}</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
				</form.Field>

				<form.Field name="scheduleSource">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="emp-contract-schedule-source">
								{t("settings.contracts.fields.scheduleSource", "Schedule source")}
							</Label>
							<Select
								value={field.state.value || INHERIT_VALUE}
								onValueChange={(v) =>
									field.handleChange(v === INHERIT_VALUE ? "" : (v as ScheduleSource))
								}
							>
								<SelectTrigger id="emp-contract-schedule-source">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={INHERIT_VALUE}>
										{t("settings.contracts.values.inheritDefault", "Inherit from Org/Team default")}
									</SelectItem>
									<SelectItem value="policy">{labels.scheduleSource("policy")}</SelectItem>
									<SelectItem value="published_shifts">
										{labels.scheduleSource("published_shifts")}
									</SelectItem>
									<SelectItem value="on_call">{labels.scheduleSource("on_call")}</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
				</form.Field>
			</div>

			{/* A5 Remote → Presence Exempt Default Preview */}
			{values.workModel === "remote" && (
				<Alert role="status">
					<AlertTitle>
						{t(
							"settings.contracts.remotePresence.title",
							"Remote work model defaults on-site presence to exempt",
						)}
					</AlertTitle>
					<AlertDescription>
						{values.presenceOverride === "require_onsite"
							? t(
									"settings.contracts.remotePresence.overrideOnsite",
									"On-site presence is explicitly required despite the remote work model.",
								)
							: t(
									"settings.contracts.remotePresence.employeeExemptPreview",
									"This remote employee will be exempt from on-site attendance requirements unless you choose Require on-site presence above.",
								)}
					</AlertDescription>
				</Alert>
			)}

			{/* Shared ARIA Custom-Days Grid */}
			{values.scheduleMode === "custom_days" && (
				<form.Field name="customDays">
					{(field) => (
						<div className="space-y-1.5">
							<Label>
								{t("settings.contracts.customDays.sectionLabel", "Custom working days per week")}
							</Label>
							<CustomDaysGrid
								value={field.state.value}
								onChange={field.handleChange}
								ariaLabel={t(
									"settings.contracts.employee.customDaysAria",
									"Employee custom working days",
								)}
							/>
						</div>
					)}
				</form.Field>
			)}

			{/* 4-Kind § 12 TzBfG On-Call Radio */}
			{values.scheduleSource === "on_call" && (
				<div className="space-y-4 rounded-lg border p-4">
					<form.Field name="onCallHoursKind">
						{(field) => (
							<fieldset className="space-y-2">
								<legend className="font-medium text-sm">
									{t(
										"settings.contracts.onCall.radioLegend",
										"On-call weekly hours agreement (§ 12 TzBfG)",
									)}
								</legend>
								<RadioGroup
									value={field.state.value}
									onValueChange={(v) => field.handleChange(v as OnCallHoursKind)}
								>
									{(["exact", "minimum", "maximum", "unspecified"] as const).map((kind) => (
										<div key={kind} className="flex items-center gap-2">
											<RadioGroupItem value={kind} id={`emp-oncall-${kind}`} />
											<Label htmlFor={`emp-oncall-${kind}`}>{labels.onCallHoursKind(kind)}</Label>
										</div>
									))}
								</RadioGroup>
							</fieldset>
						)}
					</form.Field>

					<div className="grid gap-4 sm:grid-cols-2">
						{values.onCallHoursKind !== "unspecified" && (
							<form.Field name="onCallWeeklyHours">
								{(field) => (
									<div className="space-y-1.5">
										<Label htmlFor="emp-oncall-weekly-hours">
											{t("settings.contracts.onCall.weeklyHours", "Agreed weekly hours")}
										</Label>
										<Input
											id="emp-oncall-weekly-hours"
											type="number"
											min={0.5}
											max={168}
											step={0.5}
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
											className="tabular-nums"
										/>
									</div>
								)}
							</form.Field>
						)}

						<form.Field name="onCallDailyMinutes">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor="emp-oncall-daily-minutes">
										{t(
											"settings.contracts.onCall.dailyMinutes",
											"Per-call daily duration (min, optional)",
										)}
									</Label>
									<Input
										id="emp-oncall-daily-minutes"
										type="number"
										min={1}
										max={1440}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										placeholder="180"
										className="tabular-nums"
									/>
								</div>
							)}
						</form.Field>
					</div>

					{values.onCallDailyMinutes.trim() === "" && (
						<p className="text-muted-foreground text-xs" role="note">
							{t(
								"settings.contracts.onCall.statutoryMinDaily",
								"No per-call duration agreed — at least three consecutive hours per call-in applies under § 12(1) TzBfG",
							)}
						</p>
					)}
				</div>
			)}

			{/* Employee-Owned Legal & Pay Terms */}
			<div className="grid gap-4 rounded-lg border p-4 sm:grid-cols-2">
				<form.Field name="contractType">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="emp-contract-type">
								{t("settings.contracts.fields.contractType", "Contract type")}
							</Label>
							<Select
								value={field.state.value}
								onValueChange={(v) => field.handleChange(v as ContractType)}
							>
								<SelectTrigger id="emp-contract-type">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="fixed">{labels.contractType("fixed")}</SelectItem>
									<SelectItem value="hourly">{labels.contractType("hourly")}</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
				</form.Field>

				{values.contractType === "hourly" && (
					<form.Field name="hourlyRate">
						{(field) => (
							<div className="space-y-1.5">
								<Label htmlFor="emp-contract-hourly-rate">
									{t("settings.contracts.fields.hourlyRate", "Hourly rate")}
								</Label>
								<Input
									id="emp-contract-hourly-rate"
									type="number"
									min={0}
									step={0.01}
									required
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									className="tabular-nums"
								/>
							</div>
						)}
					</form.Field>
				)}

				<form.Field name="employmentProfile">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="emp-contract-profile">
								{t("settings.contracts.fields.employmentProfile", "Employment profile")}
							</Label>
							<Select
								value={field.state.value}
								onValueChange={(v) => field.handleChange(v as EmploymentProfile)}
							>
								<SelectTrigger id="emp-contract-profile">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="regular">{labels.employmentProfile("regular")}</SelectItem>
									<SelectItem value="minijob">{labels.employmentProfile("minijob")}</SelectItem>
									<SelectItem value="short_term">
										{labels.employmentProfile("short_term")}
									</SelectItem>
									<SelectItem value="working_student">
										{labels.employmentProfile("working_student")}
									</SelectItem>
									<SelectItem value="apprentice">
										{labels.employmentProfile("apprentice")}
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
				</form.Field>

				<form.Field name="arbzgScope">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="emp-contract-arbzg">
								{t("settings.contracts.fields.arbzgScope", "ArbZG scope")}
							</Label>
							<Select
								value={field.state.value}
								onValueChange={(v) => field.handleChange(v as ArbzgScope)}
							>
								<SelectTrigger id="emp-contract-arbzg">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="standard">{labels.arbzgScope("standard")}</SelectItem>
									<SelectItem value="executive_exempt">
										{labels.arbzgScope("executive_exempt")}
									</SelectItem>
								</SelectContent>
							</Select>
						</div>
					)}
				</form.Field>
			</div>

			<form.Field name="changeReason">
				{(field) => (
					<div className="space-y-1.5">
						<Label htmlFor="emp-contract-reason">
							{t("settings.contracts.employee.changeReason", "Change reason (optional)")}
						</Label>
						<Textarea
							id="emp-contract-reason"
							rows={2}
							value={field.state.value}
							onChange={(e) => field.handleChange(e.target.value)}
						/>
					</div>
				)}
			</form.Field>

			{/* Retained Preview Diff Panel with Stale Indicator */}
			{preview && (
				<div
					className="space-y-2 rounded-lg border bg-muted/20 p-3 text-xs"
					data-testid="contract-change-preview"
				>
					<div className="flex flex-wrap items-center justify-between gap-2">
						<span className="font-medium">
							{t("settings.contracts.employee.previewTitle", "Change preview for {date}", {
								date: preview.validFromDate,
							})}
						</span>
						{isPreviewStale && (
							<Badge
								variant="outline"
								className="border-amber-500 text-amber-700 dark:text-amber-300"
								data-testid="stale-preview-badge"
							>
								{t("settings.contracts.previewStale", "Preview out of date — refresh preview")}
							</Badge>
						)}
					</div>
					<p>
						{t("settings.contracts.employee.previewDivergences", "Personal overrides: {fields}", {
							fields:
								preview.divergenceFields.length > 0
									? preview.divergenceFields.map((f) => labels.operationalFieldName(f)).join(", ")
									: t("settings.contracts.values.none", "None"),
						})}
					</p>
					<p className="text-muted-foreground">
						{t("settings.contracts.employee.previewInherited", "Inherited fields: {fields}", {
							fields:
								preview.inheritedFields.length > 0
									? preview.inheritedFields.map((f) => labels.operationalFieldName(f)).join(", ")
									: t("settings.contracts.values.none", "None"),
						})}
					</p>
					{preview.customDaysTotalMinutes !== null && (
						<p className="tabular-nums">
							{t(
								"settings.contracts.employee.previewCustomTotal",
								"Custom days weekly total: {total}",
								{
									total: formatContractMinutes(preview.customDaysTotalMinutes),
								},
							)}
						</p>
					)}
				</div>
			)}

			<div className="flex flex-wrap justify-end gap-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={previewMutation.isPending || commitMutation.isPending}
					onClick={() => previewMutation.mutate(values)}
				>
					{previewMutation.isPending ? (
						<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconEye className="mr-1.5 size-4" aria-hidden="true" />
					)}
					{t("settings.contracts.employee.previewButton", "Preview change")}
				</Button>
				<Button type="submit" disabled={commitMutation.isPending}>
					{commitMutation.isPending ? (
						<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
					)}
					{t("settings.contracts.employee.saveButton", "Save contract change")}
				</Button>
			</div>
		</form>
	);
}

function FixedTermAgreementForm({
	mode,
	organizationTimezone,
	employeeId,
	pendingDeparture,
	onSaved,
	onCancel,
}: {
	mode: "initial" | "extension";
	organizationTimezone: string;
	employeeId: string;
	pendingDeparture: { id: string; lastWorkingDay: string | null } | null;
	onSaved: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslate();

	const saveMutation = useMutation({
		mutationFn: async (values: {
			kind: EmploymentTermAgreementKind;
			startsOn: string;
			endsOn: string;
			reason: string;
			notes: string;
			departureSyncAction: FixedTermDepartureSyncAction;
		}) => {
			if (mode === "initial") {
				const result = await createInitialEmploymentAgreementAction({
					employeeId,
					kind: values.kind,
					startsOn: values.startsOn,
					endsOn: values.kind === "fixed_term" ? values.endsOn || null : null,
					reason: values.kind === "fixed_term" ? values.reason.trim() || null : null,
					notes: values.notes.trim() || null,
				});
				if (!result.success) throw new Error(result.error || "Failed to record agreement");
				return result.data;
			}
			const result = await recordFixedTermExtensionAction({
				employeeId,
				kind: values.kind,
				startsOn: values.startsOn,
				endsOn: values.kind === "fixed_term" ? values.endsOn || null : null,
				reason: values.kind === "fixed_term" ? values.reason.trim() || null : null,
				notes: values.notes.trim() || null,
				departureSyncAction: values.departureSyncAction,
			});
			if (!result.success) throw new Error(result.error || "Failed to record extension");
			return result.data;
		},
		onSuccess: () => {
			toast.success(
				mode === "extension"
					? t("settings.contracts.agreements.extensionSaved", "Fixed-term extension recorded")
					: t("settings.contracts.agreements.initialSaved", "Employment agreement recorded"),
			);
			onSaved();
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.agreements.saveFailed", "Could not save agreement"),
			);
		},
	});

	const form = useForm({
		defaultValues: {
			kind: "fixed_term" as EmploymentTermAgreementKind,
			startsOn: todayIsoDateInTimezone(organizationTimezone),
			endsOn: "",
			reason: "",
			notes: "",
			departureSyncAction: "update_leaving_date" as FixedTermDepartureSyncAction,
		},
		onSubmit: async ({ value }) => {
			await saveMutation.mutateAsync(value);
		},
	});

	const kind = useStore(form.store, (s) => s.values.kind);

	return (
		<form
			className="space-y-4"
			onSubmit={(event) => {
				event.preventDefault();
				event.stopPropagation();
				void form.handleSubmit();
			}}
		>
			<form.Field name="kind">
				{(field) => (
					<div className="space-y-1.5">
						<Label htmlFor="agreement-kind">
							{t("settings.contracts.agreements.kindLabel", "Agreement kind")}
						</Label>
						<Select
							value={field.state.value}
							onValueChange={(v) => {
								const next = v as EmploymentTermAgreementKind;
								field.handleChange(next);
								if (next === "permanent") {
									form.setFieldValue("departureSyncAction", "cancel_departure");
								}
							}}
						>
							<SelectTrigger id="agreement-kind">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="fixed_term">
									{t("settings.contracts.agreements.fixedTerm", "Fixed-term")}
								</SelectItem>
								<SelectItem value="permanent">
									{t("settings.contracts.agreements.permanent", "Permanent")}
								</SelectItem>
							</SelectContent>
						</Select>
					</div>
				)}
			</form.Field>

			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field name="startsOn">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="agreement-starts-on">
								{t("settings.contracts.agreements.startsOn", "Starts on")}
							</Label>
							<Input
								id="agreement-starts-on"
								type="date"
								required
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
							/>
						</div>
					)}
				</form.Field>

				{kind === "fixed_term" && (
					<form.Field name="endsOn">
						{(field) => (
							<div className="space-y-1.5">
								<Label htmlFor="agreement-ends-on">
									{t("settings.contracts.agreements.endsOn", "Ends on")}
								</Label>
								<Input
									id="agreement-ends-on"
									type="date"
									required
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
								/>
							</div>
						)}
					</form.Field>
				)}
			</div>

			{kind === "fixed_term" && (
				<form.Field name="reason">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="agreement-reason">
								{t("settings.contracts.agreements.reason", "Fixed-term reason (optional)")}
							</Label>
							<Input
								id="agreement-reason"
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
							/>
						</div>
					)}
				</form.Field>
			)}

			{mode === "extension" && (
				<form.Field name="departureSyncAction">
					{(field) => (
						<fieldset className="space-y-2 rounded-lg border p-3">
							<legend className="font-medium text-sm">
								{t(
									"settings.contracts.agreements.departureSyncLegend",
									"Pending scheduled departure handling",
								)}
							</legend>
							{pendingDeparture && (
								<p className="text-muted-foreground text-xs">
									{t(
										"settings.contracts.agreements.pendingDepartureNotice",
										"A departure is currently scheduled for {date}.",
										{ date: pendingDeparture.lastWorkingDay ?? "—" },
									)}
								</p>
							)}
							<RadioGroup
								value={field.state.value}
								onValueChange={(v) => field.handleChange(v as FixedTermDepartureSyncAction)}
							>
								<div className="flex items-center gap-2">
									<RadioGroupItem
										value="update_leaving_date"
										id="sync-update-leaving"
										disabled={kind === "permanent"}
									/>
									<Label htmlFor="sync-update-leaving">
										{t(
											"settings.contracts.agreements.syncUpdate",
											"Update pending leaving date to match the new end date",
										)}
									</Label>
								</div>
								<div className="flex items-center gap-2">
									<RadioGroupItem value="cancel_departure" id="sync-cancel-departure" />
									<Label htmlFor="sync-cancel-departure">
										{t(
											"settings.contracts.agreements.syncCancel",
											"Cancel pending scheduled departure",
										)}
									</Label>
								</div>
								<div className="flex items-center gap-2">
									<RadioGroupItem value="leave_unchanged" id="sync-leave-unchanged" />
									<Label htmlFor="sync-leave-unchanged">
										{t(
											"settings.contracts.agreements.syncLeaveUnchanged",
											"Leave pending departure unchanged (flags for review)",
										)}
									</Label>
								</div>
							</RadioGroup>
						</fieldset>
					)}
				</form.Field>
			)}

			<div className="flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button type="submit" disabled={saveMutation.isPending}>
					{saveMutation.isPending && (
						<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
					)}
					{t("common.save", "Save")}
				</Button>
			</div>
		</form>
	);
}
