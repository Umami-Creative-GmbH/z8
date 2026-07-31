"use client";

import {
	IconArrowLeft,
	IconArrowRight,
	IconCalendar,
	IconCheck,
	IconCircleCheck,
	IconDatabaseImport,
	IconExternalLink,
	IconKey,
	IconLink,
	IconLoader2,
	IconUserPlus,
	IconUsers,
	IconUserX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useLocale } from "next-intl";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { UserMappingEntry, UserMappingType } from "@/lib/clockodo/types";
import { useRouter } from "@/navigation";
import {
	CLOCKODO_DATE_RANGE_PRESETS,
	CLOCKODO_IMPORT_ENTITIES,
	type ClockodoImportController,
	type ClockodoWizardStep,
} from "./clockodo-import-controller";

export function ClockodoImportStepRenderer({
	controller,
}: {
	controller: ClockodoImportController;
}) {
	return (
		<div className="space-y-6">
			<ClockodoStepIndicator currentStep={controller.step} />
			{controller.step === "credentials" && (
				<ClockodoCredentialsStep controller={controller} />
			)}
			{controller.step === "preview" && controller.preview && (
				<ClockodoPreviewStep controller={controller} />
			)}
			{controller.step === "user-mapping" && (
				<ClockodoMappingStep controller={controller} />
			)}
			{controller.step === "selection" && (
				<ClockodoSelectionStep controller={controller} />
			)}
			{controller.step === "importing" && <ClockodoImportingStep />}
			{controller.step === "complete" && controller.reviewBatchId && (
				<ClockodoCompleteStep controller={controller} />
			)}
		</div>
	);
}

function ClockodoStepIndicator({
	currentStep,
}: {
	currentStep: ClockodoWizardStep;
}) {
	const { t } = useTranslate();
	const steps: { key: ClockodoWizardStep; label: string }[] = [
		{
			key: "credentials",
			label: t("settings.clockodoImport.step.credentials", "Credentials"),
		},
		{
			key: "preview",
			label: t("settings.clockodoImport.step.preview", "Preview"),
		},
		{
			key: "user-mapping",
			label: t("settings.clockodoImport.step.userMapping", "User Mapping"),
		},
		{
			key: "selection",
			label: t("settings.clockodoImport.step.selection", "Selection"),
		},
		{
			key: "importing",
			label: t("settings.clockodoImport.step.import", "Review"),
		},
		{
			key: "complete",
			label: t("settings.clockodoImport.step.complete", "Review Started"),
		},
	];
	const currentIndex = steps.findIndex((step) => step.key === currentStep);
	return (
		<div className="flex items-center justify-between">
			{steps.map((step, index) => (
				<div key={step.key} className="flex items-center">
					<div className="flex items-center gap-2">
						<div
							className={`flex size-8 items-center justify-center rounded-full text-xs font-medium ${index < currentIndex ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" : index === currentIndex ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}
						>
							{index < currentIndex ? (
								<IconCheck className="size-4" />
							) : (
								index + 1
							)}
						</div>
						<span
							className={`hidden text-sm sm:inline ${index === currentIndex ? "font-medium" : "text-muted-foreground"}`}
						>
							{step.label}
						</span>
					</div>
					{index < steps.length - 1 && (
						<div className="mx-2 h-px w-8 bg-border sm:w-12" />
					)}
				</div>
			))}
		</div>
	);
}

function ClockodoCredentialsStep({
	controller,
}: {
	controller: ClockodoImportController;
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconKey className="size-5" aria-hidden="true" />
					{t(
						"settings.clockodoImport.credentials.title",
						"Clockodo Credentials",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.clockodoImport.credentials.description",
						"Enter your Clockodo email and API key. You can find your API key in Clockodo under My Profile > API Key. Credentials are not stored.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="space-y-2">
					<Label htmlFor="clockodo-email">
						{t("settings.clockodoImport.credentials.email", "Clockodo Email")}
					</Label>
					<Input
						id="clockodo-email"
						type="email"
						value={controller.email}
						onChange={(event) => controller.setEmail(event.target.value)}
						placeholder="admin@company.com"
						disabled={controller.validateMutation.isPending}
						autoComplete="off"
					/>
				</div>
				<div className="space-y-2">
					<Label htmlFor="clockodo-apikey">
						{t("settings.clockodoImport.credentials.apiKey", "API Key")}
					</Label>
					<p className="text-xs text-muted-foreground">
						{t(
							"settings.clockodoImport.credentials.apiKeyHint",
							"You can find your API key in your Clockodo profile:",
						)}{" "}
						<a
							href="https://my.clockodo.com/de/users/editself/"
							target="_blank"
							rel="noopener noreferrer"
							className="text-primary underline underline-offset-2 hover:text-primary/80"
						>
							my.clockodo.com
							<IconExternalLink
								className="ml-0.5 inline size-3"
								aria-hidden="true"
							/>
						</a>
					</p>
					<Input
						id="clockodo-apikey"
						type="password"
						value={controller.apiKey}
						onChange={(event) => controller.setApiKey(event.target.value)}
						placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
						disabled={controller.validateMutation.isPending}
						autoComplete="off"
						spellCheck={false}
					/>
				</div>
				<div className="flex justify-end pt-2">
					<Button
						onClick={() => controller.validateMutation.mutate()}
						disabled={
							!controller.email.trim() ||
							!controller.apiKey.trim() ||
							controller.validateMutation.isPending
						}
					>
						{controller.validateMutation.isPending ? (
							<IconLoader2
								className="mr-2 size-4 animate-spin"
								aria-hidden="true"
							/>
						) : (
							<IconArrowRight className="mr-2 size-4" aria-hidden="true" />
						)}
						{t(
							"settings.clockodoImport.credentials.connect",
							"Connect & Preview",
						)}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function ClockodoPreviewStep({
	controller,
}: {
	controller: ClockodoImportController;
}) {
	const { t } = useTranslate();
	const preview = controller.preview;
	if (!preview) return null;
	const rows = [
		[
			"users",
			"Users / Employees",
			preview.users,
			controller.existingCounts?.employees ?? 0,
		],
		["teams", "Teams", preview.teams, controller.existingCounts?.teams ?? 0],
		[
			"services",
			"Services / Work Categories",
			preview.services,
			controller.existingCounts?.workCategories ?? 0,
		],
		[
			"entries",
			"Time Entries",
			preview.entries,
			controller.existingCounts?.workPeriods ?? 0,
		],
		[
			"absences",
			"Absences",
			preview.absences,
			controller.existingCounts?.absences ?? 0,
		],
		[
			"targetHours",
			"Target Hours / Work Policies",
			preview.targetHours,
			controller.existingCounts?.workPolicies ?? 0,
		],
		["holidayQuotas", "Holiday Quotas", preview.holidayQuotas, 0],
		[
			"nonBusinessDays",
			"Non-Business Days",
			preview.nonBusinessDays,
			controller.existingCounts?.holidays ?? 0,
		],
		[
			"surcharges",
			"Surcharges",
			preview.surcharges,
			controller.existingCounts?.surcharges ?? 0,
		],
	] as const;
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("settings.clockodoImport.preview.title", "Data Preview")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.clockodoImport.preview.description",
						"Here is a summary of the data found in your Clockodo account. Existing Z8 data is shown for comparison.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left">
								<th className="pb-2 font-medium">
									{t("settings.clockodoImport.preview.dataType", "Data Type")}
								</th>
								<th className="pb-2 text-right font-medium">
									{t(
										"settings.clockodoImport.preview.inClockodo",
										"In Clockodo",
									)}
								</th>
								<th className="pb-2 text-right font-medium">
									{t("settings.clockodoImport.preview.inZ8", "Already in Z8")}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{rows.map(([key, label, clockodo, z8]) => (
								<ClockodoPreviewRow
									key={key}
									label={t(`settings.clockodoImport.entity.${key}`, label)}
									clockodo={clockodo}
									z8={z8}
								/>
							))}
						</tbody>
					</table>
				</div>
				<div className="mt-4 flex justify-between">
					<Button
						variant="outline"
						onClick={() => controller.setStep("credentials")}
					>
						<IconArrowLeft className="mr-2 size-4" aria-hidden="true" />
						{t("common.back", "Back")}
					</Button>
					<Button
						onClick={() => controller.fetchUsersMutation.mutate()}
						disabled={controller.fetchUsersMutation.isPending}
					>
						{controller.fetchUsersMutation.isPending ? (
							<IconLoader2
								className="mr-2 size-4 animate-spin"
								aria-hidden="true"
							/>
						) : (
							<IconArrowRight className="mr-2 size-4" aria-hidden="true" />
						)}
						{t("settings.clockodoImport.preview.next", "Map Users")}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function ClockodoPreviewRow({
	label,
	clockodo,
	z8,
}: {
	label: string;
	clockodo: number;
	z8: number;
}) {
	return (
		<tr>
			<td className="py-2">{label}</td>
			<td className="py-2 text-right tabular-nums">
				{clockodo.toLocaleString()}
			</td>
			<td className="py-2 text-right tabular-nums text-muted-foreground">
				{z8.toLocaleString()}
			</td>
		</tr>
	);
}

function ClockodoMappingStep({
	controller,
}: {
	controller: ClockodoImportController;
}) {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconUsers className="size-5" aria-hidden="true" />
					{t("settings.clockodoImport.userMapping.title", "Map Users")}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.clockodoImport.userMapping.description",
						"Map Clockodo users to existing Z8 employees or choose to create new accounts. Users matched by email are auto-mapped.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<div className="flex items-center gap-3 rounded-lg border border-dashed p-3">
					<Switch
						id="only-import-mapped"
						checked={controller.onlyImportMapped}
						onCheckedChange={controller.setOnlyImportMapped}
					/>
					<Label
						htmlFor="only-import-mapped"
						className="cursor-pointer text-sm"
					>
						{t(
							"settings.clockodoImport.userMapping.onlyMapped",
							"Only scan mapped users (don't create new accounts for unmapped users)",
						)}
					</Label>
				</div>
				<div className="overflow-x-auto">
					<table className="w-full text-sm">
						<thead>
							<tr className="border-b text-left">
								<th className="pb-2 font-medium">
									{t(
										"settings.clockodoImport.userMapping.clockodoUser",
										"Clockodo User",
									)}
								</th>
								<th className="pb-2 font-medium">
									{t("settings.clockodoImport.userMapping.email", "Email")}
								</th>
								<th className="pb-2 font-medium">
									{t("settings.clockodoImport.userMapping.status", "Status")}
								</th>
								<th className="pb-2 font-medium">
									{t(
										"settings.clockodoImport.userMapping.mappedTo",
										"Mapped To",
									)}
								</th>
								<th className="pb-2 font-medium">
									{t("settings.clockodoImport.userMapping.action", "Action")}
								</th>
							</tr>
						</thead>
						<tbody className="divide-y">
							{controller.userMappings.map((mapping) => (
								<ClockodoMappingRow
									key={mapping.clockodoUserId}
									mapping={mapping}
									z8Employees={controller.z8Employees}
									onChangeMappingType={(type) =>
										controller.updateMappingType(mapping.clockodoUserId, type)
									}
									onChangeEmployee={(id) =>
										controller.updateMappingEmployee(mapping.clockodoUserId, id)
									}
								/>
							))}
						</tbody>
					</table>
				</div>
				<div className="flex items-center gap-4 text-xs text-muted-foreground">
					<span className="flex items-center gap-1">
						<IconLink
							className="size-3.5 text-emerald-500"
							aria-hidden="true"
						/>
						{t(
							"settings.clockodoImport.userMapping.autoMatched",
							"{count} auto-matched",
							{
								count: controller.userMappings.filter(
									(mapping) => mapping.mappingType === "auto_email",
								).length,
							},
						)}
					</span>
					<span className="flex items-center gap-1">
						<IconUserPlus
							className="size-3.5 text-blue-500"
							aria-hidden="true"
						/>
						{t(
							"settings.clockodoImport.userMapping.newEmployees",
							"{count} new",
							{
								count: controller.userMappings.filter(
									(mapping) => mapping.mappingType === "new_employee",
								).length,
							},
						)}
					</span>
					<span className="flex items-center gap-1">
						<IconUserX
							className="size-3.5 text-muted-foreground"
							aria-hidden="true"
						/>
						{t(
							"settings.clockodoImport.userMapping.skippedCount",
							"{count} skipped",
							{
								count: controller.userMappings.filter(
									(mapping) => mapping.mappingType === "skipped",
								).length,
							},
						)}
					</span>
				</div>
				<div className="flex justify-between pt-2">
					<Button
						variant="outline"
						onClick={() => controller.setStep("preview")}
					>
						<IconArrowLeft className="mr-2 size-4" aria-hidden="true" />
						{t("common.back", "Back")}
					</Button>
					<Button
						onClick={() => controller.saveMappingsMutation.mutate()}
						disabled={controller.saveMappingsMutation.isPending}
					>
						{controller.saveMappingsMutation.isPending ? (
							<IconLoader2
								className="mr-2 size-4 animate-spin"
								aria-hidden="true"
							/>
						) : (
							<IconArrowRight className="mr-2 size-4" aria-hidden="true" />
						)}
						{t("settings.clockodoImport.userMapping.continue", "Continue")}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function ClockodoMappingRow({
	mapping,
	z8Employees,
	onChangeMappingType,
	onChangeEmployee,
}: {
	mapping: UserMappingEntry;
	z8Employees: ClockodoImportController["z8Employees"];
	onChangeMappingType: (type: UserMappingType) => void;
	onChangeEmployee: (id: string) => void;
}) {
	const { t } = useTranslate();
	return (
		<tr>
			<td className="py-2 pr-3 font-medium">{mapping.clockodoUserName}</td>
			<td className="py-2 pr-3 text-muted-foreground">
				{mapping.clockodoUserEmail}
			</td>
			<td className="py-2 pr-3">
				<ClockodoMappingStatusBadge type={mapping.mappingType} />
			</td>
			<td className="py-2 pr-3">
				{mapping.mappingType === "manual" ||
				mapping.mappingType === "auto_email" ? (
					<span className="text-sm">{mapping.employeeName ?? "-"}</span>
				) : (
					<span className="text-sm text-muted-foreground">-</span>
				)}
			</td>
			<td className="py-2">
				<Select
					value={
						mapping.mappingType === "manual"
							? `manual:${mapping.employeeId}`
							: mapping.mappingType
					}
					onValueChange={(value) =>
						value.startsWith("manual:")
							? onChangeEmployee(value.slice(7))
							: onChangeMappingType(value as UserMappingType)
					}
				>
					<SelectTrigger size="sm" className="w-[180px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{mapping.mappingType === "auto_email" && (
							<SelectItem value="auto_email">
								{t(
									"settings.clockodoImport.mapping.autoMatched",
									"Auto-matched",
								)}
							</SelectItem>
						)}
						<SelectItem value="new_employee">
							{t("settings.clockodoImport.mapping.createNew", "Create new")}
						</SelectItem>
						<SelectItem value="skipped">
							{t("settings.clockodoImport.mapping.skip", "Skip")}
						</SelectItem>
						{z8Employees.map((employee) => (
							<SelectItem key={employee.id} value={`manual:${employee.id}`}>
								{employee.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</td>
		</tr>
	);
}

function ClockodoMappingStatusBadge({ type }: { type: UserMappingType }) {
	const { t } = useTranslate();
	const contents = {
		auto_email: [
			<IconLink key="icon" className="mr-1 size-3" aria-hidden="true" />,
			t("settings.clockodoImport.mappingStatus.auto", "Auto"),
		],
		manual: [
			<IconLink key="icon" className="mr-1 size-3" aria-hidden="true" />,
			t("settings.clockodoImport.mappingStatus.manual", "Manual"),
		],
		new_employee: [
			<IconUserPlus key="icon" className="mr-1 size-3" aria-hidden="true" />,
			t("settings.clockodoImport.mappingStatus.new", "New"),
		],
		skipped: [
			<IconUserX key="icon" className="mr-1 size-3" aria-hidden="true" />,
			t("settings.clockodoImport.mappingStatus.skip", "Skip"),
		],
	};
	const classes = {
		auto_email:
			"border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400",
		manual:
			"border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-400",
		new_employee:
			"border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-400",
		skipped: "text-muted-foreground",
	};
	return (
		<Badge variant="outline" className={classes[type]}>
			{contents[type]}
		</Badge>
	);
}

function ClockodoSelectionStep({
	controller,
}: {
	controller: ClockodoImportController;
}) {
	const { t } = useTranslate();
	const locale = useLocale();
	const formatter = Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeZone: "UTC",
	});
	const selections = controller.selections;
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t(
						"settings.clockodoImport.selection.title",
						"Select Data for Review",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.clockodoImport.selection.description",
						"Choose which data types to scan. Review is required before records are committed.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<Card className="border-dashed">
					<CardHeader className="pb-3">
						<CardTitle className="flex items-center gap-2 text-sm">
							<IconCalendar className="size-4" aria-hidden="true" />
							{t(
								"settings.clockodoImport.selection.dateRange",
								"Date range for time entries & absences",
							)}
						</CardTitle>
						<CardDescription className="text-xs">
							{t(
								"settings.clockodoImport.selection.dateRangeDescription",
								"This only affects time entries and absences. Other data (users, teams, etc.) is always scanned fully.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-3">
						<Select
							value={selections.dateRange.preset}
							onValueChange={(value) =>
								controller.updateDateRange(
									value as typeof selections.dateRange.preset,
								)
							}
						>
							<SelectTrigger>
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{CLOCKODO_DATE_RANGE_PRESETS.map((preset) => (
									<SelectItem key={preset.value} value={preset.value}>
										{t(
											`settings.clockodoImport.dateRange.${preset.value}`,
											preset.label,
										)}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
						{selections.dateRange.preset === "custom" && (
							<Popover>
								<PopoverTrigger asChild>
									<Button
										variant="outline"
										className="w-full justify-start text-left font-normal"
									>
										<IconCalendar className="mr-2 size-4" aria-hidden="true" />
										{selections.dateRange.startDate &&
										selections.dateRange.endDate
											? `${formatter.format(new Date(selections.dateRange.startDate))} – ${formatter.format(new Date(selections.dateRange.endDate))}`
											: t(
													"settings.clockodoImport.selection.selectDateRange",
													"Select date range",
												)}
									</Button>
								</PopoverTrigger>
								<PopoverContent className="w-auto p-0" align="start">
									<Calendar
										mode="range"
										selected={{
											from: selections.dateRange.startDate
												? new Date(selections.dateRange.startDate)
												: undefined,
											to: selections.dateRange.endDate
												? new Date(selections.dateRange.endDate)
												: undefined,
										}}
										onSelect={controller.updateCustomDateRange}
										numberOfMonths={2}
									/>
								</PopoverContent>
							</Popover>
						)}
					</CardContent>
				</Card>
				{CLOCKODO_IMPORT_ENTITIES.map((entity) => {
					const count = controller.preview?.[entity.key] ?? 0;
					const missingDeps =
						"dependsOn" in entity &&
						entity.dependsOn.some((dependency) => !selections[dependency]);
					return (
						<div
							key={entity.key}
							className="flex items-center justify-between rounded-lg border p-3"
						>
							<div className="flex items-center gap-3">
								<Checkbox
									id={`import-${entity.key}`}
									checked={selections[entity.key]}
									onCheckedChange={() =>
										controller.setSelections((current) => ({
											...current,
											[entity.key]: !current[entity.key],
										}))
									}
									disabled={count === 0}
								/>
								<div>
									<Label
										htmlFor={`import-${entity.key}`}
										className="cursor-pointer text-sm font-medium"
									>
										{t(
											`settings.clockodoImport.entity.${entity.key}`,
											entity.label,
										)}
									</Label>
									{missingDeps && selections[entity.key] && (
										<p className="text-xs text-amber-600 dark:text-amber-400">
											{t(
												"settings.clockodoImport.selection.dependencyWarning",
												"Dependencies will be scanned automatically",
											)}
										</p>
									)}
								</div>
							</div>
							<Badge variant="secondary" className="tabular-nums">
								{count}
							</Badge>
						</div>
					);
				})}
				<div className="flex justify-between pt-4">
					<Button
						variant="outline"
						onClick={() => controller.setStep("user-mapping")}
					>
						<IconArrowLeft className="mr-2 size-4" aria-hidden="true" />
						{t("common.back", "Back")}
					</Button>
					<Button
						onClick={() => {
							if (
								controller.isCustomDateRangeIncomplete ||
								controller.isUserScopedSelectionEmpty
							)
								return;
							controller.setStep("importing");
							controller.importMutation.mutate();
						}}
						disabled={
							!controller.hasSelectedEntities ||
							controller.isCustomDateRangeIncomplete ||
							controller.isUserScopedSelectionEmpty
						}
					>
						<IconDatabaseImport className="mr-2 size-4" aria-hidden="true" />
						{t(
							"settings.clockodoImport.selection.startImport",
							"Start Review Scan",
						)}
					</Button>
				</div>
				{controller.isCustomDateRangeIncomplete && (
					<p className="text-right text-sm text-destructive" aria-live="polite">
						{t(
							"settings.clockodoImport.selection.incompleteCustomDateRange",
							"Select both a start and end date before starting the scan.",
						)}
					</p>
				)}
				{controller.isUserScopedSelectionEmpty && (
					<p className="text-right text-sm text-destructive" aria-live="polite">
						{t(
							"settings.clockodoImport.selection.emptyUserScope",
							"Select at least one Clockodo user before starting the scan.",
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}

function ClockodoImportingStep() {
	const { t } = useTranslate();
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconLoader2 className="size-5 animate-spin" aria-hidden="true" />
					{t(
						"settings.clockodoImport.importing.title",
						"Starting Review Scan…",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.clockodoImport.importing.description",
						"Please do not close this page. The review scan is being queued and may take a while for large datasets.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="space-y-4">
					<Progress value={undefined} className="h-2" />
					<p className="text-center text-sm text-muted-foreground">
						{t(
							"settings.clockodoImport.importing.patience",
							"Fetching Clockodo data for review…",
						)}
					</p>
				</div>
			</CardContent>
		</Card>
	);
}

function ClockodoCompleteStep({
	controller,
}: {
	controller: ClockodoImportController;
}) {
	const { t } = useTranslate();
	const router = useRouter();
	const batchId = controller.reviewBatchId;
	if (!batchId) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<IconCircleCheck
						className="size-5 text-emerald-500"
						aria-hidden="true"
					/>
					{t(
						"settings.clockodoImport.complete.successTitle",
						"Import review scan started",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.clockodoImport.complete.description",
						"Review is required before Clockodo records are committed to production.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				<div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-300">
					{t(
						"settings.clockodoImport.complete.batch",
						"Review batch {batchId} is scanning.",
						{ batchId },
					)}
				</div>
				<div className="mt-6 flex justify-end">
					<Button onClick={() => router.push(`/settings/import/${batchId}`)}>
						<IconExternalLink className="mr-2 size-4" aria-hidden="true" />
						{t("settings.clockodoImport.complete.openReview", "Open review")}
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}
