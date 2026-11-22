"use client";

import {
	IconAlertTriangle,
	IconBuilding,
	IconCheck,
	IconEye,
	IconLoader2,
	IconRocket,
	IconUsersGroup,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
	getContractDefaultsAction,
	previewContractDefaultChangeAction,
	scheduleContractDefaultAction,
} from "@/app/[locale]/(app)/settings/contracts/actions";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
import { getWorkPolicies } from "@/app/[locale]/(app)/settings/work-policies/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import type {
	BalanceMode,
	ContractDefaultScope,
	PresenceOverride,
	TemplateScheduleMode,
} from "@/db/schema/contract-types";
import type {
	HydratedContractDefault,
	PreviewContractDefaultChangeResult,
} from "@/lib/contracts/contract-defaults";
import type { CustomWorkDay, WorkModel } from "@/lib/contracts/types";
import {
	formatContractMinutes,
	hoursInputToIntegerMinutes,
	integerMinutesToHoursInput,
	todayIsoDate,
	useContractLabels,
} from "./contract-formatters";
import {
	CustomDaysGrid,
	createDefaultCustomDays,
	validateCustomDaysGrid,
} from "./custom-days-grid";

const NO_POLICY = "__none__";
const NO_WORK_MODEL = "__unset__";

interface DefaultFormValues {
	scope: ContractDefaultScope;
	teamId: string;
	effectiveFromDate: string;
	workPolicyId: string;
	weeklyHours: string;
	scheduleMode: TemplateScheduleMode;
	customDays: CustomWorkDay[];
	workModel: WorkModel | "";
	presenceOverride: PresenceOverride;
	balanceMode: BalanceMode;
	scheduleSource: "policy" | "published_shifts";
}

function buildPayloadSignature(values: DefaultFormValues): string {
	return JSON.stringify({
		scope: values.scope,
		teamId: values.scope === "team" ? values.teamId : null,
		effectiveFromDate: values.effectiveFromDate,
		workPolicyId: values.workPolicyId === NO_POLICY ? null : values.workPolicyId,
		weeklyHours: values.weeklyHours,
		scheduleMode: values.scheduleMode,
		customDays: values.scheduleMode === "custom_days" ? values.customDays : [],
		workModel: values.workModel || null,
		presenceOverride: values.presenceOverride,
		balanceMode: values.balanceMode,
		scheduleSource: values.scheduleSource,
	});
}

function toSchedulePayload(values: DefaultFormValues) {
	const weeklyMinutes = hoursInputToIntegerMinutes(values.weeklyHours);
	return {
		scope: values.scope,
		teamId: values.scope === "team" ? values.teamId || null : null,
		effectiveFromDate: values.effectiveFromDate,
		workPolicyId: values.workPolicyId === NO_POLICY ? null : values.workPolicyId,
		weeklyContractMinutes: weeklyMinutes,
		scheduleMode: values.scheduleMode,
		customDays: values.scheduleMode === "custom_days" ? values.customDays : null,
		workModel: (values.workModel || null) as WorkModel | null,
		presenceOverride: values.presenceOverride,
		balanceMode: values.balanceMode,
		scheduleSource: values.scheduleSource,
	};
}

export interface ContractsDefaultsTabProps {
	organizationId: string;
}

export function ContractsDefaultsTab({ organizationId }: ContractsDefaultsTabProps) {
	const { t } = useTranslate();
	const labels = useContractLabels();
	const queryClient = useQueryClient();
	const [previewResult, setPreviewResult] = useState<PreviewContractDefaultChangeResult | null>(
		null,
	);
	const [previewSignature, setPreviewSignature] = useState<string | null>(null);
	const [previewError, setPreviewError] = useState<string | null>(null);
	const [showQuickSetup, setShowQuickSetup] = useState(false);

	const defaultsQuery = useQuery({
		queryKey: ["contracts", "defaults", organizationId],
		queryFn: async () => {
			const result = await getContractDefaultsAction({});
			if (!result.success) throw new Error(result.error || "Failed to load defaults");
			return result.data;
		},
		staleTime: 30 * 1000,
	});

	const policiesQuery = useQuery({
		queryKey: ["contracts", "work-policies", organizationId],
		queryFn: async () => {
			const result = await getWorkPolicies();
			if (!result.success) throw new Error(result.error || "Failed to load work policies");
			return result.data.filter((p) => p.isActive);
		},
		staleTime: 60 * 1000,
	});

	const teamsQuery = useQuery({
		queryKey: ["contracts", "teams", organizationId],
		queryFn: async () => {
			const result = await listTeams();
			if (!result.success) throw new Error(result.error || "Failed to load teams");
			return result.data;
		},
		staleTime: 60 * 1000,
	});

	const orgDefaults = useMemo(
		() => (defaultsQuery.data ?? []).filter((d) => d.scope === "organization"),
		[defaultsQuery.data],
	);
	const teamDefaults = useMemo(
		() => (defaultsQuery.data ?? []).filter((d) => d.scope === "team"),
		[defaultsQuery.data],
	);
	const hasOrgDefault = orgDefaults.length > 0;

	const defaultValues: DefaultFormValues = useMemo(
		() => ({
			scope: "organization",
			teamId: "",
			effectiveFromDate: todayIsoDate(),
			workPolicyId: NO_POLICY,
			weeklyHours: "40",
			scheduleMode: "policy",
			customDays: createDefaultCustomDays(2400),
			workModel: "hybrid",
			presenceOverride: "inherit",
			balanceMode: "tracked",
			scheduleSource: "policy",
		}),
		[],
	);

	const previewMutation = useMutation({
		mutationFn: async (values: DefaultFormValues) => {
			const result = await previewContractDefaultChangeAction(toSchedulePayload(values));
			if (!result.success) throw new Error(result.error || "Failed to preview default change");
			return { data: result.data, signature: buildPayloadSignature(values) };
		},
		onSuccess: ({ data, signature }) => {
			setPreviewError(null);
			setPreviewResult(data);
			setPreviewSignature(signature);
		},
		onError: (err) => {
			setPreviewError(
				err instanceof Error
					? err.message
					: t("settings.contracts.defaults.previewFailed", "Could not preview affected employees."),
			);
		},
	});

	const scheduleMutation = useMutation({
		mutationFn: async (values: DefaultFormValues) => {
			const result = await scheduleContractDefaultAction(toSchedulePayload(values));
			if (!result.success) throw new Error(result.error || "Failed to save default contract");
			return result.data;
		},
		onSuccess: (data) => {
			toast.success(
				data.scope === "organization"
					? t(
							"settings.contracts.defaults.orgSaved",
							"Organization default contract scheduled for {date}",
							{ date: data.effectiveFromDate },
						)
					: t(
							"settings.contracts.defaults.teamSaved",
							"Primary team default contract scheduled for {date}",
							{ date: data.effectiveFromDate },
						),
			);
			setShowQuickSetup(false);
			setPreviewResult(null);
			setPreviewSignature(null);
			void queryClient.invalidateQueries({ queryKey: ["contracts", "defaults", organizationId] });
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.defaults.saveFailed", "Could not save default contract."),
			);
		},
	});

	const form = useForm({
		defaultValues,
		onSubmit: async ({ value }) => {
			if (value.scope === "team" && !value.teamId) {
				toast.error(
					t(
						"settings.contracts.defaults.teamRequired",
						"Choose a primary team for a team default override.",
					),
				);
				return;
			}
			if (value.scheduleMode === "custom_days" && validateCustomDaysGrid(value.customDays)) {
				toast.error(
					t(
						"settings.contracts.customDays.fixValidation",
						"Fix the highlighted custom working days before saving.",
					),
				);
				return;
			}
			await scheduleMutation.mutateAsync(value);
		},
	});

	const currentValues = useStore(form.store, (state) => state.values);
	const currentSignature = buildPayloadSignature(currentValues);
	const isPreviewStale = Boolean(previewResult && previewSignature !== currentSignature);

	const loadExistingIntoEditor = (entry: HydratedContractDefault) => {
		form.setFieldValue("scope", entry.scope);
		form.setFieldValue("teamId", entry.teamId ?? "");
		form.setFieldValue("effectiveFromDate", entry.effectiveFromDate);
		form.setFieldValue("workPolicyId", entry.workPolicyId ?? NO_POLICY);
		form.setFieldValue("weeklyHours", integerMinutesToHoursInput(entry.weeklyContractMinutes));
		form.setFieldValue("scheduleMode", entry.scheduleMode);
		form.setFieldValue(
			"customDays",
			entry.customDays.length > 0 ? [...entry.customDays] : createDefaultCustomDays(2400),
		);
		form.setFieldValue("workModel", entry.workModel ?? "");
		form.setFieldValue("presenceOverride", entry.presenceOverride);
		form.setFieldValue("balanceMode", entry.balanceMode);
		form.setFieldValue(
			"scheduleSource",
			entry.scheduleSource === "published_shifts" ? "published_shifts" : "policy",
		);
	};

	const policies = policiesQuery.data ?? [];
	const teams = teamsQuery.data ?? [];

	return (
		<div className="space-y-6">
			{/* 1-Step 5-Person Org Default Setup Card */}
			{(!hasOrgDefault || showQuickSetup) && (
				<QuickOrgDefaultSetupCard
					policies={policies}
					isPending={scheduleMutation.isPending}
					onSave={async (quickValues) => {
						await scheduleMutation.mutateAsync({
							...defaultValues,
							scope: "organization",
							effectiveFromDate: quickValues.effectiveFromDate,
							workPolicyId: quickValues.workPolicyId,
							weeklyHours: quickValues.weeklyHours,
							workModel: quickValues.workModel,
							presenceOverride: quickValues.workModel === "remote" ? "exempt" : "inherit",
							balanceMode: quickValues.balanceMode,
						});
					}}
					onDismiss={hasOrgDefault ? () => setShowQuickSetup(false) : undefined}
				/>
			)}

			{hasOrgDefault && !showQuickSetup && (
				<div className="flex justify-end">
					<Button type="button" variant="outline" size="sm" onClick={() => setShowQuickSetup(true)}>
						<IconRocket className="mr-1.5 size-4" aria-hidden="true" />
						{t("settings.contracts.defaults.openQuickSetup", "1-Step Quick Setup")}
					</Button>
				</div>
			)}

			{/* Date-Effective Org / Primary Team Default Editor */}
			<Card>
				<CardHeader>
					<CardTitle>
						{t("settings.contracts.defaults.editorTitle", "Schedule Default Contract")}
					</CardTitle>
					<CardDescription>
						{t(
							"settings.contracts.defaults.editorDescription",
							"Define date-effective operational defaults for your organization or override them for a primary team. Individual employee divergences remain intact.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<form
						className="space-y-5"
						onSubmit={(event) => {
							event.preventDefault();
							event.stopPropagation();
							void form.handleSubmit();
						}}
					>
						<div className="grid gap-4 sm:grid-cols-3">
							<form.Field name="scope">
								{(field) => (
									<div className="space-y-1.5">
										<Label htmlFor="contract-default-scope">
											{t("settings.contracts.defaults.scope", "Scope")}
										</Label>
										<Select
											value={field.state.value}
											onValueChange={(val) => {
												field.handleChange(val as ContractDefaultScope);
												if (val === "organization") form.setFieldValue("teamId", "");
											}}
										>
											<SelectTrigger id="contract-default-scope">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="organization">
													{t("settings.contracts.defaults.scopeOrg", "Organization default")}
												</SelectItem>
												<SelectItem value="team">
													{t("settings.contracts.defaults.scopeTeam", "Primary team default")}
												</SelectItem>
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>

							{currentValues.scope === "team" && (
								<form.Field name="teamId">
									{(field) => (
										<div className="space-y-1.5">
											<Label htmlFor="contract-default-team">
												{t("settings.contracts.defaults.primaryTeam", "Primary team")}
											</Label>
											<Select value={field.state.value} onValueChange={field.handleChange}>
												<SelectTrigger id="contract-default-team">
													<SelectValue
														placeholder={t("settings.contracts.defaults.selectTeam", "Select team")}
													/>
												</SelectTrigger>
												<SelectContent>
													{teams.map((teamItem) => (
														<SelectItem key={teamItem.id} value={teamItem.id}>
															{teamItem.name}
														</SelectItem>
													))}
												</SelectContent>
											</Select>
										</div>
									)}
								</form.Field>
							)}

							<form.Field name="effectiveFromDate">
								{(field) => (
									<div className="space-y-1.5">
										<Label htmlFor="contract-default-effective-date">
											{t("settings.contracts.defaults.effectiveFrom", "Effective from")}
										</Label>
										<Input
											id="contract-default-effective-date"
											type="date"
											required
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
										/>
									</div>
								)}
							</form.Field>
						</div>

						<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
							<form.Field name="workPolicyId">
								{(field) => (
									<div className="space-y-1.5">
										<Label htmlFor="contract-default-policy">
											{t("settings.contracts.fields.workPolicy", "Work policy")}
										</Label>
										<Select value={field.state.value} onValueChange={field.handleChange}>
											<SelectTrigger id="contract-default-policy">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value={NO_POLICY}>
													{t("settings.contracts.values.noPolicy", "No work policy")}
												</SelectItem>
												{policies.map((policy) => (
													<SelectItem key={policy.id} value={policy.id}>
														{policy.name}
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
										<Label htmlFor="contract-default-weekly-hours">
											{t("settings.contracts.fields.weeklyHours", "Weekly hours")}
										</Label>
										<Input
											id="contract-default-weekly-hours"
											type="number"
											inputMode="decimal"
											min={0}
											max={168}
											step={0.25}
											value={field.state.value}
											onChange={(event) => field.handleChange(event.target.value)}
											placeholder="40"
											className="tabular-nums"
										/>
									</div>
								)}
							</form.Field>

							<form.Field name="scheduleMode">
								{(field) => (
									<div className="space-y-1.5">
										<Label htmlFor="contract-default-schedule-mode">
											{t("settings.contracts.fields.scheduleMode", "Schedule mode")}
										</Label>
										<Select
											value={field.state.value}
											onValueChange={(val) => field.handleChange(val as TemplateScheduleMode)}
										>
											<SelectTrigger id="contract-default-schedule-mode">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="policy">{labels.scheduleMode("policy")}</SelectItem>
												<SelectItem value="hours_only">
													{labels.scheduleMode("hours_only")}
												</SelectItem>
												<SelectItem value="custom_days">
													{labels.scheduleMode("custom_days")}
												</SelectItem>
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>

							<form.Field name="workModel">
								{(field) => (
									<div className="space-y-1.5">
										<Label htmlFor="contract-default-work-model">
											{t("settings.contracts.fields.workModel", "Work model")}
										</Label>
										<Select
											value={field.state.value || NO_WORK_MODEL}
											onValueChange={(val) => {
												const nextModel = val === NO_WORK_MODEL ? "" : (val as WorkModel);
												field.handleChange(nextModel);
												if (
													nextModel === "remote" &&
													currentValues.presenceOverride === "inherit"
												) {
													form.setFieldValue("presenceOverride", "exempt");
												}
											}}
										>
											<SelectTrigger id="contract-default-work-model">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value={NO_WORK_MODEL}>
													{t("settings.contracts.values.notSet", "Not set")}
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
										<Label htmlFor="contract-default-presence">
											{t("settings.contracts.fields.presenceOverride", "Presence override")}
										</Label>
										<Select
											value={field.state.value}
											onValueChange={(val) => field.handleChange(val as PresenceOverride)}
										>
											<SelectTrigger id="contract-default-presence">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="inherit">
													{labels.presenceOverride("inherit")}
												</SelectItem>
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
										<Label htmlFor="contract-default-balance-mode">
											{t("settings.contracts.fields.balanceMode", "Balance mode")}
										</Label>
										<Select
											value={field.state.value}
											onValueChange={(val) => field.handleChange(val as BalanceMode)}
										>
											<SelectTrigger id="contract-default-balance-mode">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="tracked">{labels.balanceMode("tracked")}</SelectItem>
												<SelectItem value="trust_based">
													{labels.balanceMode("trust_based")}
												</SelectItem>
											</SelectContent>
										</Select>
									</div>
								)}
							</form.Field>

							<form.Field name="scheduleSource">
								{(field) => (
									<div className="space-y-1.5">
										<Label htmlFor="contract-default-schedule-source">
											{t("settings.contracts.fields.scheduleSource", "Schedule source")}
										</Label>
										<Select
											value={field.state.value}
											onValueChange={(val) =>
												field.handleChange(val as "policy" | "published_shifts")
											}
										>
											<SelectTrigger id="contract-default-schedule-source">
												<SelectValue />
											</SelectTrigger>
											<SelectContent>
												<SelectItem value="policy">{labels.scheduleSource("policy")}</SelectItem>
												<SelectItem value="published_shifts">
													{labels.scheduleSource("published_shifts")}
												</SelectItem>
											</SelectContent>
										</Select>
										<p className="text-muted-foreground text-xs">
											{t(
												"settings.contracts.defaults.onCallForbiddenNote",
												"On-call (§ 12 TzBfG) requires an individual employee agreement and cannot be inherited.",
											)}
										</p>
									</div>
								)}
							</form.Field>
						</div>

						{currentValues.workModel === "remote" && (
							<Alert role="status">
								<AlertTitle>
									{t(
										"settings.contracts.remotePresence.title",
										"Remote work model defaults on-site presence to exempt",
									)}
								</AlertTitle>
								<AlertDescription>
									{currentValues.presenceOverride === "require_onsite"
										? t(
												"settings.contracts.remotePresence.overrideOnsite",
												"On-site presence is explicitly required despite the remote work model.",
											)
										: t(
												"settings.contracts.remotePresence.exemptPreview",
												"Employees inheriting this remote default will be exempt from on-site presence requirements unless explicitly overridden.",
											)}
								</AlertDescription>
							</Alert>
						)}

						{currentValues.scheduleMode === "custom_days" && (
							<form.Field name="customDays">
								{(field) => (
									<div className="space-y-1.5">
										<Label>
											{t(
												"settings.contracts.customDays.sectionLabel",
												"Custom working days per week",
											)}
										</Label>
										<CustomDaysGrid
											value={field.state.value}
											onChange={field.handleChange}
											ariaLabel={t(
												"settings.contracts.defaults.customDaysAria",
												"Default contract custom working days",
											)}
										/>
									</div>
								)}
							</form.Field>
						)}

						{previewError && (
							<Alert variant="destructive" role="alert">
								<IconAlertTriangle className="size-4" aria-hidden="true" />
								<AlertDescription>{previewError}</AlertDescription>
							</Alert>
						)}

						{/* Affected Employee Preview Panel */}
						{previewResult && (
							<div className="space-y-3 rounded-lg border bg-muted/20 p-4">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<h4 className="font-medium text-sm">
										{t(
											"settings.contracts.defaults.previewHeading",
											"Affected employee preview as of {date}",
											{ date: previewResult.effectiveFromDate },
										)}
									</h4>
									{isPreviewStale && (
										<Badge
											variant="outline"
											className="border-amber-500 text-amber-700 dark:text-amber-300"
										>
											{t(
												"settings.contracts.previewStale",
												"Preview out of date — refresh preview",
											)}
										</Badge>
									)}
								</div>

								<div className="flex flex-wrap gap-2 text-xs">
									<Badge variant="default">
										{t(
											"settings.contracts.defaults.inheritingCount",
											"{count} inheriting changes",
											{ count: previewResult.inheritingCount },
										)}
									</Badge>
									<Badge variant="secondary">
										{t(
											"settings.contracts.defaults.divergedCount",
											"{count} keeping personal divergences",
											{ count: previewResult.divergedCount },
										)}
									</Badge>
									<Badge variant="outline">
										{t("settings.contracts.defaults.unchangedCount", "{count} unchanged", {
											count: previewResult.unchangedCount,
										})}
									</Badge>
									{previewResult.mismatchWarningCount > 0 && (
										<Badge variant="destructive">
											{t(
												"settings.contracts.defaults.mismatchCount",
												"{count} weekly-hours mismatch warnings",
												{ count: previewResult.mismatchWarningCount },
											)}
										</Badge>
									)}
								</div>

								{previewResult.inheritingEmployees.length > 0 && (
									<div className="space-y-1">
										<p className="font-medium text-xs text-muted-foreground">
											{t(
												"settings.contracts.defaults.inheritingSample",
												"Employees inheriting this update",
											)}
										</p>
										<ul className="max-h-40 space-y-1 overflow-y-auto text-xs">
											{previewResult.inheritingEmployees.slice(0, 15).map((emp) => (
												<li
													key={emp.employeeId}
													className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background px-2.5 py-1.5"
												>
													<span className="font-medium">
														{[emp.firstName, emp.lastName].filter(Boolean).join(" ") ||
															emp.employeeId}
													</span>
													<span className="text-muted-foreground">
														{emp.changes
															.map((c) => labels.operationalFieldName(c.field))
															.join(", ")}
													</span>
												</li>
											))}
										</ul>
									</div>
								)}

								{previewResult.divergedEmployees.length > 0 && (
									<div className="space-y-1">
										<p className="font-medium text-xs text-muted-foreground">
											{t(
												"settings.contracts.defaults.divergedSample",
												"Employees keeping personal overrides",
											)}
										</p>
										<ul className="max-h-32 space-y-1 overflow-y-auto text-xs">
											{previewResult.divergedEmployees.slice(0, 10).map((emp) => (
												<li
													key={emp.employeeId}
													className="flex flex-wrap items-center justify-between gap-2 rounded border bg-background px-2.5 py-1.5"
												>
													<span>
														{[emp.firstName, emp.lastName].filter(Boolean).join(" ") ||
															emp.employeeId}
													</span>
													<span className="text-muted-foreground">
														{emp.preservedDivergenceFields
															.map((f) => labels.operationalFieldName(f))
															.join(", ")}
													</span>
												</li>
											))}
										</ul>
									</div>
								)}
							</div>
						)}

						<div className="flex flex-wrap justify-end gap-2">
							<Button
								type="button"
								variant="outline"
								disabled={previewMutation.isPending || scheduleMutation.isPending}
								onClick={() => previewMutation.mutate(currentValues)}
							>
								{previewMutation.isPending ? (
									<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
								) : (
									<IconEye className="mr-1.5 size-4" aria-hidden="true" />
								)}
								{t("settings.contracts.defaults.previewAffected", "Preview affected employees")}
							</Button>
							<Button type="submit" disabled={scheduleMutation.isPending}>
								{scheduleMutation.isPending ? (
									<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
								) : (
									<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
								)}
								{t("settings.contracts.defaults.scheduleButton", "Schedule default")}
							</Button>
						</div>
					</form>
				</CardContent>
			</Card>

			{/* Configured Org & Primary Team Defaults Timeline */}
			<div className="grid gap-4 lg:grid-cols-2">
				<DefaultsListCard
					title={t("settings.contracts.defaults.orgTimelineTitle", "Organization Defaults")}
					icon={<IconBuilding className="size-4" aria-hidden="true" />}
					items={orgDefaults}
					isLoading={defaultsQuery.isLoading}
					emptyText={t(
						"settings.contracts.defaults.noOrgDefaults",
						"No organization default contract scheduled yet.",
					)}
					onLoad={loadExistingIntoEditor}
				/>
				<DefaultsListCard
					title={t(
						"settings.contracts.defaults.teamTimelineTitle",
						"Primary Team Default Overrides",
					)}
					icon={<IconUsersGroup className="size-4" aria-hidden="true" />}
					items={teamDefaults}
					isLoading={defaultsQuery.isLoading}
					emptyText={t(
						"settings.contracts.defaults.noTeamDefaults",
						"No primary team overrides configured. All teams inherit the organization default.",
					)}
					onLoad={loadExistingIntoEditor}
				/>
			</div>
		</div>
	);
}

function QuickOrgDefaultSetupCard({
	policies,
	isPending,
	onSave,
	onDismiss,
}: {
	policies: readonly { id: string; name: string }[];
	isPending: boolean;
	onSave: (values: {
		effectiveFromDate: string;
		workPolicyId: string;
		weeklyHours: string;
		workModel: WorkModel;
		balanceMode: BalanceMode;
	}) => Promise<void>;
	onDismiss?: () => void;
}) {
	const { t } = useTranslate();
	const labels = useContractLabels();

	const quickForm = useForm({
		defaultValues: {
			effectiveFromDate: todayIsoDate(),
			workPolicyId: policies[0]?.id ?? NO_POLICY,
			weeklyHours: "40",
			workModel: "hybrid" as WorkModel,
			balanceMode: "tracked" as BalanceMode,
		},
		onSubmit: async ({ value }) => {
			await onSave(value);
		},
	});

	return (
		<Card className="border-primary/30 bg-primary/5">
			<CardHeader>
				<div className="flex flex-wrap items-center justify-between gap-2">
					<CardTitle className="flex items-center gap-2 text-base">
						<IconRocket className="size-5 text-primary" aria-hidden="true" />
						{t("settings.contracts.defaults.quickSetupTitle", "1-Step Organization Default Setup")}
					</CardTitle>
					{onDismiss && (
						<Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
							{t("common.close", "Close")}
						</Button>
					)}
				</div>
				<CardDescription>
					{t(
						"settings.contracts.defaults.quickSetupDescription",
						"Set your standard weekly hours, work policy, work model, and balance mode once so every employee automatically inherits them.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<form
					className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
					onSubmit={(event) => {
						event.preventDefault();
						event.stopPropagation();
						void quickForm.handleSubmit();
					}}
				>
					<quickForm.Field name="weeklyHours">
						{(field) => (
							<div className="space-y-1.5">
								<Label htmlFor="quick-default-hours">
									{t("settings.contracts.fields.weeklyHours", "Weekly hours")}
								</Label>
								<Input
									id="quick-default-hours"
									type="number"
									min={0}
									max={168}
									step={0.5}
									value={field.state.value}
									onChange={(e) => field.handleChange(e.target.value)}
									className="tabular-nums"
								/>
							</div>
						)}
					</quickForm.Field>

					<quickForm.Field name="workPolicyId">
						{(field) => (
							<div className="space-y-1.5">
								<Label htmlFor="quick-default-policy">
									{t("settings.contracts.fields.workPolicy", "Work policy")}
								</Label>
								<Select value={field.state.value} onValueChange={field.handleChange}>
									<SelectTrigger id="quick-default-policy">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={NO_POLICY}>
											{t("settings.contracts.values.noPolicy", "No work policy")}
										</SelectItem>
										{policies.map((p) => (
											<SelectItem key={p.id} value={p.id}>
												{p.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							</div>
						)}
					</quickForm.Field>

					<quickForm.Field name="workModel">
						{(field) => (
							<div className="space-y-1.5">
								<Label htmlFor="quick-default-model">
									{t("settings.contracts.fields.workModel", "Work model")}
								</Label>
								<Select
									value={field.state.value}
									onValueChange={(v) => field.handleChange(v as WorkModel)}
								>
									<SelectTrigger id="quick-default-model">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="onsite">{labels.workModel("onsite")}</SelectItem>
										<SelectItem value="hybrid">{labels.workModel("hybrid")}</SelectItem>
										<SelectItem value="remote">{labels.workModel("remote")}</SelectItem>
										<SelectItem value="flexible">{labels.workModel("flexible")}</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</quickForm.Field>

					<quickForm.Field name="balanceMode">
						{(field) => (
							<div className="space-y-1.5">
								<Label htmlFor="quick-default-balance">
									{t("settings.contracts.fields.balanceMode", "Balance mode")}
								</Label>
								<Select
									value={field.state.value}
									onValueChange={(v) => field.handleChange(v as BalanceMode)}
								>
									<SelectTrigger id="quick-default-balance">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value="tracked">{labels.balanceMode("tracked")}</SelectItem>
										<SelectItem value="trust_based">{labels.balanceMode("trust_based")}</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</quickForm.Field>

					<div className="flex items-end">
						<Button type="submit" className="w-full" disabled={isPending}>
							{isPending && (
								<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
							)}
							{t("settings.contracts.defaults.quickSetupSubmit", "Save org default")}
						</Button>
					</div>
				</form>
			</CardContent>
		</Card>
	);
}

function DefaultsListCard({
	title,
	icon,
	items,
	isLoading,
	emptyText,
	onLoad,
}: {
	title: string;
	icon: React.ReactNode;
	items: readonly HydratedContractDefault[];
	isLoading: boolean;
	emptyText: string;
	onLoad: (item: HydratedContractDefault) => void;
}) {
	const { t } = useTranslate();
	const labels = useContractLabels();

	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2 text-base">
					{icon}
					{title}
				</CardTitle>
			</CardHeader>
			<CardContent>
				{isLoading ? (
					<div className="flex items-center gap-2 text-muted-foreground text-sm">
						<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
						{t("common.loading", "Loading…")}
					</div>
				) : items.length === 0 ? (
					<p className="text-muted-foreground text-sm">{emptyText}</p>
				) : (
					<ul className="space-y-2.5">
						{items.map((item) => (
							<li key={item.id} className="rounded-lg border p-3 text-sm">
								<div className="flex flex-wrap items-center justify-between gap-2">
									<div className="flex flex-wrap items-center gap-2">
										{item.teamName && <Badge variant="secondary">{item.teamName}</Badge>}
										<span className="font-medium tabular-nums">
											{item.effectiveFromDate}
											{item.effectiveUntilDate ? ` → ${item.effectiveUntilDate}` : " → ∞"}
										</span>
									</div>
									<Button type="button" variant="ghost" size="sm" onClick={() => onLoad(item)}>
										{t("settings.contracts.defaults.loadIntoEditor", "Edit / supersede")}
									</Button>
								</div>
								<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-muted-foreground text-xs">
									<span>
										{t("settings.contracts.fields.weeklyHours", "Weekly hours")}:{" "}
										{formatContractMinutes(item.weeklyContractMinutes)}
									</span>
									<span>
										{t("settings.contracts.fields.workPolicy", "Work policy")}:{" "}
										{item.workPolicyName ?? t("settings.contracts.values.none", "None")}
									</span>
									<span>{labels.workModel(item.workModel)}</span>
									<span>{labels.balanceMode(item.balanceMode)}</span>
									<span>{labels.scheduleSource(item.scheduleSource)}</span>
								</div>
							</li>
						))}
					</ul>
				)}
			</CardContent>
		</Card>
	);
}
