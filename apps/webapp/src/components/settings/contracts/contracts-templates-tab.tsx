"use client";

import {
	IconArchive,
	IconCheck,
	IconEye,
	IconFilePlus,
	IconLoader2,
	IconSend,
	IconVersions,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	archiveContractTemplateAction,
	createContractTemplateAction,
	listContractTemplatesAction,
	publishContractTemplateVersionAction,
} from "@/app/[locale]/(app)/settings/contracts/actions";
import {
	previewBulkContractActionAction,
	submitBulkContractActionAction,
} from "@/app/[locale]/(app)/settings/contracts/bulk-actions";
import { listTeams } from "@/app/[locale]/(app)/settings/teams/actions";
import { getWorkPolicies } from "@/app/[locale]/(app)/settings/work-policies/actions";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
	OnCallHoursKind,
	PresenceOverride,
	ScheduleSource,
	TemplateScheduleMode,
} from "@/db/schema/contract-types";
import type { PreviewBulkContractActionResult } from "@/lib/contracts/bulk-operations";
import type { HydratedContractTemplateSummary } from "@/lib/contracts/contract-templates";
import type { CustomWorkDay, WorkModel } from "@/lib/contracts/types";
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
import { ExecutiveExemptNote } from "./executive-exempt-note";

const NO_VALUE = "__none__";

export interface ContractsTemplatesTabProps {
	organizationId: string;
	organizationTimezone: string;
}

export function ContractsTemplatesTab({
	organizationId,
	organizationTimezone,
}: ContractsTemplatesTabProps) {
	const { t } = useTranslate();
	const labels = useContractLabels();
	const queryClient = useQueryClient();
	const [editorTarget, setEditorTarget] = useState<
		{ mode: "create" } | { mode: "version"; template: HydratedContractTemplateSummary } | null
	>(null);
	const [applyTarget, setApplyTarget] = useState<HydratedContractTemplateSummary | null>(null);

	const templatesQuery = useQuery({
		queryKey: ["contracts", "templates", organizationId],
		queryFn: async () => {
			const result = await listContractTemplatesAction({ includeInactive: false });
			if (!result.success) throw new Error(result.error || "Failed to load contract templates");
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

	const archiveMutation = useMutation({
		mutationFn: async (templateId: string) => {
			const result = await archiveContractTemplateAction(templateId);
			if (!result.success) throw new Error(result.error || "Failed to archive template");
		},
		onSuccess: () => {
			toast.success(t("settings.contracts.templates.archived", "Template archived"));
			void queryClient.invalidateQueries({ queryKey: ["contracts", "templates", organizationId] });
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.templates.archiveFailed", "Could not archive template"),
			);
		},
	});

	const templates = templatesQuery.data ?? [];

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<p className="text-muted-foreground text-sm">
					{t(
						"settings.contracts.templates.intro",
						"Templates are immutable stamping presets. Publishing a new version never mutates existing employees until you explicitly apply it.",
					)}
				</p>
				<Button type="button" onClick={() => setEditorTarget({ mode: "create" })}>
					<IconFilePlus className="mr-1.5 size-4" aria-hidden="true" />
					{t("settings.contracts.templates.newTemplate", "New template")}
				</Button>
			</div>

			{templatesQuery.isLoading ? (
				<div className="flex items-center gap-2 py-8 text-muted-foreground text-sm">
					<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
					{t("common.loading", "Loading…")}
				</div>
			) : templates.length === 0 ? (
				<Card>
					<CardContent className="py-10 text-center text-muted-foreground text-sm">
						{t(
							"settings.contracts.templates.empty",
							"No contract templates yet. Create reusable presets like Full-Time Office, Minijob Retail, Working Student, or On-Call.",
						)}
					</CardContent>
				</Card>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					{templates.map((template) => {
						const v = template.latestVersion;
						return (
							<Card key={template.id}>
								<CardHeader>
									<div className="flex flex-wrap items-start justify-between gap-2">
										<div>
											<CardTitle className="text-base">{template.name}</CardTitle>
											{template.description && (
												<CardDescription className="mt-1">{template.description}</CardDescription>
											)}
										</div>
										<Badge variant="secondary">
											{t("settings.contracts.templates.versionBadge", "v{version}", {
												version: v?.versionNumber ?? template.versionCount,
											})}
										</Badge>
									</div>
								</CardHeader>
								<CardContent className="space-y-4">
									{v && (
										<dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
											<dt className="text-muted-foreground">
												{t("settings.contracts.fields.weeklyHours", "Weekly hours")}
											</dt>
											<dd className="font-medium tabular-nums">
												{formatContractMinutes(v.weeklyContractMinutes)}
											</dd>
											<dt className="text-muted-foreground">
												{t("settings.contracts.fields.workPolicy", "Work policy")}
											</dt>
											<dd className="font-medium">
												{v.workPolicyName ?? t("settings.contracts.values.none", "None")}
											</dd>
											<dt className="text-muted-foreground">
												{t("settings.contracts.fields.scheduleMode", "Schedule mode")}
											</dt>
											<dd className="font-medium">{labels.scheduleMode(v.scheduleMode)}</dd>
											<dt className="text-muted-foreground">
												{t("settings.contracts.fields.workModel", "Work model")}
											</dt>
											<dd className="font-medium">{labels.workModel(v.workModel)}</dd>
											<dt className="text-muted-foreground">
												{t("settings.contracts.fields.balanceMode", "Balance mode")}
											</dt>
											<dd className="font-medium">{labels.balanceMode(v.balanceMode)}</dd>
											<dt className="text-muted-foreground">
												{t("settings.contracts.fields.scheduleSource", "Schedule source")}
											</dt>
											<dd className="font-medium">{labels.scheduleSource(v.scheduleSource)}</dd>
										</dl>
									)}

									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											size="sm"
											variant="default"
											disabled={!v}
											onClick={() => setApplyTarget(template)}
										>
											<IconSend className="mr-1.5 size-4" aria-hidden="true" />
											{t("settings.contracts.templates.applyToEmployees", "Apply to employees")}
										</Button>
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={() => setEditorTarget({ mode: "version", template })}
										>
											<IconVersions className="mr-1.5 size-4" aria-hidden="true" />
											{t("settings.contracts.templates.publishNewVersion", "Publish new version")}
										</Button>
										<Button
											type="button"
											size="sm"
											variant="ghost"
											disabled={archiveMutation.isPending}
											onClick={() => archiveMutation.mutate(template.id)}
										>
											<IconArchive className="mr-1.5 size-4" aria-hidden="true" />
											{t("settings.contracts.templates.archive", "Archive")}
										</Button>
									</div>
								</CardContent>
							</Card>
						);
					})}
				</div>
			)}

			<ActionPanel
				open={editorTarget !== null}
				onOpenChange={(open) => {
					if (!open) setEditorTarget(null);
				}}
			>
				<ActionPanelContent size="wide">
					<ActionPanelHeader>
						<ActionPanelTitle>
							{editorTarget?.mode === "version"
								? t(
										"settings.contracts.templates.publishVersionTitle",
										"Publish new version of {name}",
										{ name: editorTarget.template.name },
									)
								: t("settings.contracts.templates.createTitle", "Create contract template")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.contracts.templates.editorDescription",
								"Versions are immutable snapshots. Existing employee contracts are never mutated when a new version is published.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody>
						{editorTarget && (
							<TemplateEditorForm
								key={editorTarget.mode === "version" ? editorTarget.template.id : "new"}
								target={editorTarget}
								policies={policiesQuery.data ?? []}
								onSaved={() => {
									setEditorTarget(null);
									void queryClient.invalidateQueries({
										queryKey: ["contracts", "templates", organizationId],
									});
								}}
								onCancel={() => setEditorTarget(null)}
							/>
						)}
					</ActionPanelBody>
				</ActionPanelContent>
			</ActionPanel>

			<ActionPanel
				open={applyTarget !== null}
				onOpenChange={(open) => {
					if (!open) setApplyTarget(null);
				}}
			>
				<ActionPanelContent size="wide">
					<ActionPanelHeader>
						<ActionPanelTitle>
							{applyTarget
								? t("settings.contracts.templates.applyTitle", "Apply {name} to employees", {
										name: applyTarget.name,
									})
								: t("settings.contracts.templates.applyToEmployees", "Apply to employees")}
						</ActionPanelTitle>
						<ActionPanelDescription>
							{t(
								"settings.contracts.templates.applyDescription",
								"Preview which employees will be updated and which personal divergences will be preserved before running the batch.",
							)}
						</ActionPanelDescription>
					</ActionPanelHeader>
					<ActionPanelBody>
						{applyTarget?.latestVersion && (
							<ApplyTemplatePanel
								organizationTimezone={organizationTimezone}
								template={applyTarget}
								teams={teamsQuery.data ?? []}
								onSubmitted={() => {
									setApplyTarget(null);
									void queryClient.invalidateQueries({
										queryKey: ["contracts", "batches", organizationId],
									});
								}}
								onCancel={() => setApplyTarget(null)}
							/>
						)}
					</ActionPanelBody>
				</ActionPanelContent>
			</ActionPanel>
		</div>
	);
}

function TemplateEditorForm({
	target,
	policies,
	onSaved,
	onCancel,
}: {
	target: { mode: "create" } | { mode: "version"; template: HydratedContractTemplateSummary };
	policies: readonly { id: string; name: string }[];
	onSaved: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const labels = useContractLabels();
	const existing = target.mode === "version" ? target.template : null;
	const latest = existing?.latestVersion ?? null;

	const saveMutation = useMutation({
		mutationFn: async (values: {
			name: string;
			description: string;
			workPolicyId: string;
			weeklyHours: string;
			scheduleMode: TemplateScheduleMode;
			customDays: CustomWorkDay[];
			workModel: WorkModel | "";
			presenceOverride: PresenceOverride;
			balanceMode: BalanceMode;
			scheduleSource: ScheduleSource;
			defaultContractType: ContractType | "";
			defaultHourlyRate: string;
			defaultCurrency: string;
			defaultEmploymentProfile: EmploymentProfile | "";
			defaultArbzgScope: ArbzgScope | "";
			defaultOnCallHoursKind: OnCallHoursKind | "";
			defaultOnCallWeeklyHours: string;
			defaultOnCallDailyMinutes: string;
		}) => {
			const shared = {
				workPolicyId: values.workPolicyId === NO_VALUE ? null : values.workPolicyId,
				weeklyContractMinutes: hoursInputToIntegerMinutes(values.weeklyHours),
				scheduleMode: values.scheduleMode,
				customDays: values.scheduleMode === "custom_days" ? values.customDays : null,
				workModel: (values.workModel || null) as WorkModel | null,
				presenceOverride: values.presenceOverride,
				balanceMode: values.balanceMode,
				scheduleSource: values.scheduleSource,
				defaultContractType: (values.defaultContractType || null) as ContractType | null,
				defaultHourlyRate:
					values.defaultContractType === "hourly" && values.defaultHourlyRate.trim() !== ""
						? Number(values.defaultHourlyRate)
						: null,
				defaultCurrency: values.defaultCurrency.trim() || null,
				defaultEmploymentProfile: (values.defaultEmploymentProfile ||
					null) as EmploymentProfile | null,
				defaultArbzgScope: (values.defaultArbzgScope || null) as ArbzgScope | null,
				defaultOnCallHoursKind:
					values.scheduleSource === "on_call"
						? ((values.defaultOnCallHoursKind || null) as OnCallHoursKind | null)
						: null,
				defaultOnCallWeeklyMinutes:
					values.scheduleSource === "on_call" && values.defaultOnCallHoursKind !== "unspecified"
						? hoursInputToIntegerMinutes(values.defaultOnCallWeeklyHours)
						: null,
				defaultOnCallDailyMinutes:
					values.scheduleSource === "on_call" && values.defaultOnCallDailyMinutes.trim() !== ""
						? Number.parseInt(values.defaultOnCallDailyMinutes, 10)
						: null,
			};

			if (target.mode === "version") {
				const result = await publishContractTemplateVersionAction({
					templateId: target.template.id,
					name: values.name.trim(),
					description: values.description.trim() || null,
					...shared,
				});
				if (!result.success) throw new Error(result.error || "Failed to publish template version");
				return result.data;
			}
			const result = await createContractTemplateAction({
				name: values.name.trim(),
				description: values.description.trim() || null,
				...shared,
			});
			if (!result.success) throw new Error(result.error || "Failed to create template");
			return result.data;
		},
		onSuccess: (data) => {
			toast.success(
				t("settings.contracts.templates.savedVersion", "Template version v{version} published", {
					version: data.versionNumber,
				}),
			);
			onSaved();
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.templates.saveFailed", "Could not save template"),
			);
		},
	});

	const form = useForm({
		defaultValues: {
			name: existing?.name ?? "",
			description: existing?.description ?? "",
			workPolicyId: latest?.workPolicyId ?? NO_VALUE,
			weeklyHours: integerMinutesToHoursInput(latest?.weeklyContractMinutes ?? 2400),
			scheduleMode: (latest?.scheduleMode ?? "policy") as TemplateScheduleMode,
			customDays:
				latest?.customDays && latest.customDays.length > 0
					? [...latest.customDays]
					: createDefaultCustomDays(2400),
			workModel: (latest?.workModel ?? "hybrid") as WorkModel | "",
			presenceOverride: (latest?.presenceOverride ?? "inherit") as PresenceOverride,
			balanceMode: (latest?.balanceMode ?? "tracked") as BalanceMode,
			scheduleSource: (latest?.scheduleSource ?? "policy") as ScheduleSource,
			defaultContractType: (latest?.defaultContractType ?? "fixed") as ContractType | "",
			defaultHourlyRate:
				latest?.defaultHourlyRate !== null && latest?.defaultHourlyRate !== undefined
					? String(latest.defaultHourlyRate)
					: "",
			defaultCurrency: latest?.defaultCurrency ?? "EUR",
			defaultEmploymentProfile: (latest?.defaultEmploymentProfile ?? "regular") as
				| EmploymentProfile
				| "",
			defaultArbzgScope: (latest?.defaultArbzgScope ?? "standard") as ArbzgScope | "",
			defaultOnCallHoursKind: (latest?.defaultOnCallHoursKind ?? "") as OnCallHoursKind | "",
			defaultOnCallWeeklyHours: integerMinutesToHoursInput(latest?.defaultOnCallWeeklyMinutes),
			defaultOnCallDailyMinutes:
				latest?.defaultOnCallDailyMinutes !== null &&
				latest?.defaultOnCallDailyMinutes !== undefined
					? String(latest.defaultOnCallDailyMinutes)
					: "",
		},
		onSubmit: async ({ value }) => {
			if (!value.name.trim()) {
				toast.error(t("settings.contracts.templates.nameRequired", "Template name is required."));
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
			await saveMutation.mutateAsync(value);
		},
	});

	const scheduleMode = useStore(form.store, (s) => s.values.scheduleMode);
	const scheduleSource = useStore(form.store, (s) => s.values.scheduleSource);
	const defaultContractType = useStore(form.store, (s) => s.values.defaultContractType);
	const defaultOnCallHoursKind = useStore(form.store, (s) => s.values.defaultOnCallHoursKind);

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
				<form.Field name="name">
					{(field) => (
						<div className="space-y-1.5 sm:col-span-2">
							<Label htmlFor="template-name">
								{t("settings.contracts.templates.name", "Template name")}
							</Label>
							<Input
								id="template-name"
								required
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								placeholder={t(
									"settings.contracts.templates.namePlaceholder",
									"e.g., Full-Time Office, Minijob Retail, Working Student",
								)}
							/>
						</div>
					)}
				</form.Field>
				<form.Field name="description">
					{(field) => (
						<div className="space-y-1.5 sm:col-span-2">
							<Label htmlFor="template-description">
								{t("settings.contracts.templates.description", "Description")}
							</Label>
							<Textarea
								id="template-description"
								rows={2}
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
							/>
						</div>
					)}
				</form.Field>
			</div>

			<div className="grid gap-4 sm:grid-cols-2">
				<form.Field name="workPolicyId">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="template-policy">
								{t("settings.contracts.fields.workPolicy", "Work policy")}
							</Label>
							<Select value={field.state.value} onValueChange={field.handleChange}>
								<SelectTrigger id="template-policy">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={NO_VALUE}>
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
				</form.Field>

				<form.Field name="weeklyHours">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="template-weekly-hours">
								{t("settings.contracts.fields.weeklyHours", "Weekly hours")}
							</Label>
							<Input
								id="template-weekly-hours"
								type="number"
								min={0}
								max={168}
								step={0.25}
								value={field.state.value}
								onChange={(e) => field.handleChange(e.target.value)}
								className="tabular-nums"
							/>
						</div>
					)}
				</form.Field>

				<form.Field name="scheduleMode">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="template-schedule-mode">
								{t("settings.contracts.fields.scheduleMode", "Schedule mode")}
							</Label>
							<Select
								value={field.state.value}
								onValueChange={(v) => field.handleChange(v as TemplateScheduleMode)}
							>
								<SelectTrigger id="template-schedule-mode">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
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
							<Label htmlFor="template-work-model">
								{t("settings.contracts.fields.workModel", "Work model")}
							</Label>
							<Select
								value={field.state.value || NO_VALUE}
								onValueChange={(v) => {
									const next = v === NO_VALUE ? "" : (v as WorkModel);
									field.handleChange(next);
									if (next === "remote") form.setFieldValue("presenceOverride", "exempt");
								}}
							>
								<SelectTrigger id="template-work-model">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value={NO_VALUE}>
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

				<form.Field name="balanceMode">
					{(field) => (
						<div className="space-y-1.5">
							<Label htmlFor="template-balance-mode">
								{t("settings.contracts.fields.balanceMode", "Balance mode")}
							</Label>
							<Select
								value={field.state.value}
								onValueChange={(v) => field.handleChange(v as BalanceMode)}
							>
								<SelectTrigger id="template-balance-mode">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
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
							<Label htmlFor="template-schedule-source">
								{t("settings.contracts.fields.scheduleSource", "Schedule source")}
							</Label>
							<Select
								value={field.state.value}
								onValueChange={(v) => field.handleChange(v as ScheduleSource)}
							>
								<SelectTrigger id="template-schedule-source">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
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

			{scheduleMode === "custom_days" && (
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
									"settings.contracts.templates.customDaysAria",
									"Contract template custom working days",
								)}
							/>
						</div>
					)}
				</form.Field>
			)}

			{/* Employee-owned prefills */}
			<div className="space-y-3 rounded-lg border p-4">
				<h4 className="font-medium text-sm">
					{t(
						"settings.contracts.templates.employeeOwnedPrefills",
						"Employee-owned prefills (stamped once on apply)",
					)}
				</h4>
				<div className="grid gap-4 sm:grid-cols-2">
					<form.Field name="defaultContractType">
						{(field) => (
							<div className="space-y-1.5">
								<Label htmlFor="template-contract-type">
									{t("settings.contracts.fields.contractType", "Contract type")}
								</Label>
								<Select
									value={field.state.value || NO_VALUE}
									onValueChange={(v) =>
										field.handleChange(v === NO_VALUE ? "" : (v as ContractType))
									}
								>
									<SelectTrigger id="template-contract-type">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={NO_VALUE}>
											{t("settings.contracts.values.notSet", "Not set")}
										</SelectItem>
										<SelectItem value="fixed">{labels.contractType("fixed")}</SelectItem>
										<SelectItem value="hourly">{labels.contractType("hourly")}</SelectItem>
									</SelectContent>
								</Select>
							</div>
						)}
					</form.Field>

					{defaultContractType === "hourly" && (
						<form.Field name="defaultHourlyRate">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor="template-hourly-rate">
										{t("settings.contracts.fields.hourlyRate", "Hourly rate")}
									</Label>
									<Input
										id="template-hourly-rate"
										type="number"
										min={0}
										step={0.01}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
										className="tabular-nums"
									/>
								</div>
							)}
						</form.Field>
					)}

					<form.Field name="defaultEmploymentProfile">
						{(field) => (
							<div className="space-y-1.5">
								<Label htmlFor="template-profile">
									{t("settings.contracts.fields.employmentProfile", "Employment profile")}
								</Label>
								<Select
									value={field.state.value || NO_VALUE}
									onValueChange={(v) =>
										field.handleChange(v === NO_VALUE ? "" : (v as EmploymentProfile))
									}
								>
									<SelectTrigger id="template-profile">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={NO_VALUE}>
											{t("settings.contracts.values.notSet", "Not set")}
										</SelectItem>
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

					<form.Field name="defaultArbzgScope">
						{(field) => (
							<div className="space-y-1.5">
								<Label htmlFor="template-arbzg">
									{t("settings.contracts.fields.arbzgScope", "ArbZG scope")}
								</Label>
								<Select
									value={field.state.value || NO_VALUE}
									onValueChange={(v) => field.handleChange(v === NO_VALUE ? "" : (v as ArbzgScope))}
								>
									<SelectTrigger id="template-arbzg" aria-describedby="template-arbzg-hint">
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										<SelectItem value={NO_VALUE}>
											{t("settings.contracts.values.notSet", "Not set")}
										</SelectItem>
										<SelectItem value="standard">{labels.arbzgScope("standard")}</SelectItem>
										<SelectItem value="executive_exempt">
											{labels.arbzgScope("executive_exempt")}
										</SelectItem>
									</SelectContent>
								</Select>
								<ExecutiveExemptNote id="template-arbzg-hint" />
							</div>
						)}
					</form.Field>
				</div>

				{scheduleSource === "on_call" && (
					<div className="grid gap-4 border-t pt-3 sm:grid-cols-3">
						<form.Field name="defaultOnCallHoursKind">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor="template-oncall-kind">
										{t("settings.contracts.onCall.kindLabel", "§ 12 TzBfG hours kind")}
									</Label>
									<Select
										value={field.state.value || NO_VALUE}
										onValueChange={(v) =>
											field.handleChange(v === NO_VALUE ? "" : (v as OnCallHoursKind))
										}
									>
										<SelectTrigger id="template-oncall-kind">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value={NO_VALUE}>
												{t("settings.contracts.values.notSet", "Not set")}
											</SelectItem>
											<SelectItem value="exact">{labels.onCallHoursKind("exact")}</SelectItem>
											<SelectItem value="minimum">{labels.onCallHoursKind("minimum")}</SelectItem>
											<SelectItem value="maximum">{labels.onCallHoursKind("maximum")}</SelectItem>
											<SelectItem value="unspecified">
												{labels.onCallHoursKind("unspecified")}
											</SelectItem>
										</SelectContent>
									</Select>
								</div>
							)}
						</form.Field>

						{defaultOnCallHoursKind && defaultOnCallHoursKind !== "unspecified" && (
							<form.Field name="defaultOnCallWeeklyHours">
								{(field) => (
									<div className="space-y-1.5">
										<Label htmlFor="template-oncall-weekly">
											{t("settings.contracts.onCall.weeklyHours", "Agreed weekly hours")}
										</Label>
										<Input
											id="template-oncall-weekly"
											type="number"
											min={0.5}
											max={168}
											step={0.5}
											value={field.state.value}
											onChange={(e) => field.handleChange(e.target.value)}
										/>
									</div>
								)}
							</form.Field>
						)}

						<form.Field name="defaultOnCallDailyMinutes">
							{(field) => (
								<div className="space-y-1.5">
									<Label htmlFor="template-oncall-daily">
										{t(
											"settings.contracts.onCall.dailyMinutes",
											"Per-call daily duration (min, optional)",
										)}
									</Label>
									<Input
										id="template-oncall-daily"
										type="number"
										min={1}
										max={1440}
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								</div>
							)}
						</form.Field>
					</div>
				)}
			</div>

			<div className="flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button type="submit" disabled={saveMutation.isPending}>
					{saveMutation.isPending && (
						<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
					)}
					{target.mode === "version"
						? t("settings.contracts.templates.publishVersionSubmit", "Publish version")
						: t("settings.contracts.templates.createSubmit", "Create template")}
				</Button>
			</div>
		</form>
	);
}

function ApplyTemplatePanel({
	organizationTimezone,
	template,
	teams,
	onSubmitted,
	onCancel,
}: {
	organizationTimezone: string;
	template: HydratedContractTemplateSummary;
	teams: readonly { id: string; name: string }[];
	onSubmitted: () => void;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const [effectiveFromDate, setEffectiveFromDate] = useState(() =>
		todayIsoDateInTimezone(organizationTimezone),
	);
	const [teamId, setTeamId] = useState<string>(NO_VALUE);
	const [overwritePersonalDivergences, setOverwritePersonalDivergences] = useState(false);
	const [preview, setPreview] = useState<PreviewBulkContractActionResult | null>(null);
	const [requestId, setRequestId] = useState<string | null>(null);
	const previewEpochRef = useRef(0);

	const clearPreview = () => {
		previewEpochRef.current += 1;
		setPreview(null);
		setRequestId(null);
	};

	const templateVersionId = template.latestVersion?.id ?? "";

	const previewMutation = useMutation({
		mutationFn: async () => {
			const epoch = previewEpochRef.current + 1;
			previewEpochRef.current = epoch;
			const result = await previewBulkContractActionAction({
				actionKind: "apply_template_version",
				templateVersionId,
				effectiveFromDate,
				overwritePersonalDivergences,
				target: teamId !== NO_VALUE ? { teamId } : {},
			});
			if (!result.success) throw new Error(result.error || "Failed to preview template apply");
			return { epoch, data: result.data };
		},
		onSuccess: ({ epoch, data }) => {
			if (previewEpochRef.current !== epoch) return;
			setPreview(data);
			setRequestId(globalThis.crypto.randomUUID());
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.templates.applyPreviewFailed", "Could not preview application"),
			);
		},
	});

	const submitMutation = useMutation({
		mutationFn: async () => {
			if (!preview || !preview.canSubmit) {
				throw new Error(
					t("settings.contracts.templates.applyPreviewFailed", "Could not preview application"),
				);
			}
			const activeRequestId = requestId ?? globalThis.crypto.randomUUID();
			if (!requestId) setRequestId(activeRequestId);
			const result = await submitBulkContractActionAction({
				actionKind: "apply_template_version",
				templateVersionId,
				effectiveFromDate,
				overwritePersonalDivergences,
				target: teamId !== NO_VALUE ? { teamId } : {},
				requestId: activeRequestId,
				confirmationFingerprint: preview.confirmationFingerprint,
			});
			if (!result.success) throw new Error(result.error || "Failed to apply template");
			return result.data;
		},
		onSuccess: (receipt) => {
			toast.success(
				t(
					"settings.contracts.templates.applySubmitted",
					"Template batch submitted ({count} employees, mode: {mode})",
					{ count: receipt.batch.totalItems, mode: receipt.executionMode },
				),
			);
			clearPreview();
			onSubmitted();
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.templates.applyFailed", "Could not apply template"),
			);
		},
	});

	return (
		<div className="space-y-4">
			<div className="grid gap-4 sm:grid-cols-2">
				<div className="space-y-1.5">
					<Label htmlFor="apply-template-date">
						{t("settings.contracts.defaults.effectiveFrom", "Effective from")}
					</Label>
					<Input
						id="apply-template-date"
						type="date"
						value={effectiveFromDate}
						onChange={(e) => {
							setEffectiveFromDate(e.target.value);
							clearPreview();
						}}
					/>
				</div>

				<div className="space-y-1.5">
					<Label htmlFor="apply-template-team">
						{t("settings.contracts.templates.targetTeam", "Target team (optional)")}
					</Label>
					<Select
						value={teamId}
						onValueChange={(v) => {
							setTeamId(v);
							clearPreview();
						}}
					>
						<SelectTrigger id="apply-template-team">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value={NO_VALUE}>
								{t("settings.contracts.bulk.allCurrentRoster", "All current-roster employees")}
							</SelectItem>
							{teams.map((tm) => (
								<SelectItem key={tm.id} value={tm.id}>
									{tm.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</div>
			</div>

			<div className="flex items-start gap-2">
				<Checkbox
					id="apply-overwrite-divergences"
					checked={overwritePersonalDivergences}
					onCheckedChange={(checked) => {
						setOverwritePersonalDivergences(checked === true);
						clearPreview();
					}}
				/>
				<Label htmlFor="apply-overwrite-divergences" className="text-sm leading-snug">
					{t(
						"settings.contracts.templates.overwriteDivergences",
						"Overwrite existing personal divergences (unchecked preserves bespoke employee overrides)",
					)}
				</Label>
			</div>

			{preview && (
				<Alert role="status">
					<AlertDescription className="space-y-2">
						<div className="flex flex-wrap gap-2 text-xs">
							<Badge variant="default">
								{t("settings.contracts.bulk.willUpdate", "{count} will update", {
									count: preview.affectedCount,
								})}
							</Badge>
							<Badge variant="secondary">
								{t("settings.contracts.bulk.skippedDivergence", "{count} preserved divergences", {
									count: preview.skippedDivergenceCount,
								})}
							</Badge>
							<Badge variant="outline">
								{t("settings.contracts.bulk.executionMode", "Mode: {mode}", {
									mode: preview.executionMode,
								})}
							</Badge>
							{preview.validationErrorCount > 0 && (
								<Badge variant="destructive">
									{t("settings.contracts.bulk.validationErrors", "{count} errors", {
										count: preview.validationErrorCount,
									})}
								</Badge>
							)}
						</div>
					</AlertDescription>
				</Alert>
			)}

			<div className="flex justify-end gap-2">
				<Button type="button" variant="outline" onClick={onCancel}>
					{t("common.cancel", "Cancel")}
				</Button>
				<Button
					type="button"
					variant="outline"
					disabled={previewMutation.isPending}
					onClick={() => previewMutation.mutate()}
				>
					{previewMutation.isPending ? (
						<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconEye className="mr-1.5 size-4" aria-hidden="true" />
					)}
					{t("settings.contracts.bulk.runPreview", "Run dry-run preview")}
				</Button>
				<Button
					type="button"
					disabled={!preview?.canSubmit || submitMutation.isPending}
					onClick={() => submitMutation.mutate()}
				>
					{submitMutation.isPending ? (
						<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
					) : (
						<IconCheck className="mr-1.5 size-4" aria-hidden="true" />
					)}
					{t("settings.contracts.templates.confirmApply", "Apply template")}
				</Button>
			</div>
		</div>
	);
}
