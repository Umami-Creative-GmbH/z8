"use client";

import {
	IconAlertTriangle,
	IconArrowLeft,
	IconArrowRight,
	IconCalendar,
	IconCheck,
	IconCircleCheck,
	IconCircleX,
	IconDatabaseImport,
	IconExternalLink,
	IconKey,
	IconLink,
	IconLoader2,
	IconMinus,
	IconUserPlus,
	IconUsers,
	IconUserX,
} from "@tabler/icons-react";
import { useMutation } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import type { DateRange } from "react-day-picker";
import { toast } from "sonner";
import {
	type ExistingDataCounts,
	fetchClockodoUsers,
	fetchZ8Employees,
	getExistingDataCounts,
	importClockodoData,
	saveUserMappings,
	validateClockodoCredentials,
	type Z8EmployeeInfo,
} from "@/app/[locale]/(app)/settings/clockodo-import/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import type { ImportUserMapping } from "@/lib/clockodo/import-orchestrator";
import type {
	ClockodoDataPreview,
	DateRangePreset,
	ImportResult,
	ImportSelections,
	UserMappingEntry,
	UserMappingType,
} from "@/lib/clockodo/types";
import { useRouter } from "@/navigation";

type WizardStep =
	| "credentials"
	| "preview"
	| "user-mapping"
	| "selection"
	| "importing"
	| "complete";

interface ClockodoImportWizardProps {
	organizationId: string;
}

const IMPORT_ENTITIES = [
	{ key: "users", label: "Users / Employees", icon: "users" },
	{ key: "teams", label: "Teams", icon: "users-group" },
	{ key: "services", label: "Services / Work Categories", icon: "tag" },
	{
		key: "entries",
		label: "Time Entries / Work Periods",
		icon: "clock",
		dependsOn: ["users", "services"],
	},
	{ key: "absences", label: "Absences", icon: "calendar-off", dependsOn: ["users"] },
	{
		key: "targetHours",
		label: "Target Hours / Work Policies",
		icon: "clock-edit",
		dependsOn: ["users"],
	},
	{
		key: "holidayQuotas",
		label: "Holiday Quotas / Vacation Allowances",
		icon: "beach",
		dependsOn: ["users"],
	},
	{ key: "nonBusinessDays", label: "Non-Business Days / Holidays", icon: "calendar-event" },
	{ key: "surcharges", label: "Surcharges", icon: "percentage" },
] as const;

type EntityKey = (typeof IMPORT_ENTITIES)[number]["key"];

const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
	{ value: "all_data", label: "All data (last 10 years)" },
	{ value: "this_year", label: "This year" },
	{ value: "this_year_and_last", label: "This year + last year" },
	{ value: "last_6_months", label: "Last 6 months" },
	{ value: "last_12_months", label: "Last 12 months" },
	{ value: "custom", label: "Custom date range" },
];

export function ClockodoImportWizard({ organizationId }: ClockodoImportWizardProps) {
	const { t } = useTranslate();
	const router = useRouter();

	const entityLabel = (key: string, fallback: string) =>
		t(`settings.clockodoImport.entity.${key}`, fallback);

	const dateRangeLabel = (value: string, fallback: string) =>
		t(`settings.clockodoImport.dateRange.${value}`, fallback);

	// Wizard state
	const [step, setStep] = useState<WizardStep>("credentials");

	// Credentials
	const [email, setEmail] = useState("");
	const [apiKey, setApiKey] = useState("");

	// Preview data
	const [preview, setPreview] = useState<ClockodoDataPreview | null>(null);
	const [existingCounts, setExistingCounts] = useState<ExistingDataCounts | null>(null);

	// User mapping state
	const [z8Employees, setZ8Employees] = useState<Z8EmployeeInfo[]>([]);
	const [userMappings, setUserMappings] = useState<UserMappingEntry[]>([]);
	const [onlyImportMapped, setOnlyImportMapped] = useState(false);

	// Selections
	const [selections, setSelections] = useState<ImportSelections>({
		users: true,
		teams: true,
		services: true,
		entries: true,
		absences: true,
		targetHours: true,
		holidayQuotas: true,
		nonBusinessDays: true,
		surcharges: true,
		dateRange: { preset: "all_data", startDate: null, endDate: null },
	});

	// Results
	const [importResult, setImportResult] = useState<ImportResult | null>(null);

	// Mutations
	const validateMutation = useMutation({
		mutationFn: async () => {
			const [credResult, countsResult] = await Promise.all([
				validateClockodoCredentials(email, apiKey, organizationId),
				getExistingDataCounts(organizationId),
			]);
			return { credResult, countsResult };
		},
		onSuccess: ({ credResult, countsResult }) => {
			if (credResult.success) {
				setPreview(credResult.data);
				if (countsResult.success) {
					setExistingCounts(countsResult.data);
				}
				setStep("preview");
			} else {
				toast.error(credResult.error);
			}
		},
		onError: () => {
			toast.error(
				t("settings.clockodoImport.errors.connectionFailed", "Failed to connect to Clockodo"),
			);
		},
	});

	const fetchUsersMutation = useMutation({
		mutationFn: async () => {
			const [usersResult, employeesResult] = await Promise.all([
				fetchClockodoUsers(email, apiKey, organizationId),
				fetchZ8Employees(organizationId),
			]);
			return { usersResult, employeesResult };
		},
		onSuccess: ({ usersResult, employeesResult }) => {
			if (usersResult.success && employeesResult.success) {
				setZ8Employees(employeesResult.data);

				// Auto-match by email (case-insensitive)
				const employeeByEmail = new Map<string, Z8EmployeeInfo>();
				for (const emp of employeesResult.data) {
					employeeByEmail.set(emp.email.toLowerCase(), emp);
				}

				const mappings: UserMappingEntry[] = usersResult.data.map((cu) => {
					const matchedEmployee = employeeByEmail.get(cu.email.toLowerCase());
					if (matchedEmployee) {
						return {
							clockodoUserId: cu.id,
							clockodoUserName: cu.name,
							clockodoUserEmail: cu.email,
							mappingType: "auto_email" as UserMappingType,
							employeeId: matchedEmployee.id,
							userId: matchedEmployee.userId,
							employeeName: matchedEmployee.name,
						};
					}
					return {
						clockodoUserId: cu.id,
						clockodoUserName: cu.name,
						clockodoUserEmail: cu.email,
						mappingType: "new_employee" as UserMappingType,
						employeeId: null,
						userId: null,
						employeeName: null,
					};
				});

				setUserMappings(mappings);
				setStep("user-mapping");
			} else {
				toast.error(
					usersResult.success
						? (employeesResult as { error: string }).error
						: (usersResult as { error: string }).error,
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.clockodoImport.errors.fetchUsersFailed", "Failed to fetch user data"),
			);
		},
	});

	const saveMappingsMutation = useMutation({
		mutationFn: () => saveUserMappings(organizationId, userMappings),
		onSuccess: (result) => {
			if (result.success) {
				setStep("selection");
			} else {
				toast.error(result.error);
			}
		},
		onError: () => {
			toast.error(
				t("settings.clockodoImport.errors.saveMappingsFailed", "Failed to save user mappings"),
			);
		},
	});

	const importMutation = useMutation({
		mutationFn: () => {
			// Convert user mappings to serialized format for the server action
			const serializedMappings: ImportUserMapping[] = userMappings.map((m) => ({
				clockodoUserId: m.clockodoUserId,
				employeeId: m.employeeId,
				userId: m.userId,
				mappingType: m.mappingType,
			}));
			return importClockodoData(
				email,
				apiKey,
				organizationId,
				selections,
				serializedMappings,
				onlyImportMapped,
			);
		},
		onSuccess: (result) => {
			if (result.success) {
				setImportResult(result.data);
				setStep("complete");
			} else {
				toast.error(result.error);
			}
		},
		onError: () => {
			toast.error(t("settings.clockodoImport.errors.importFailed", "Import failed"));
		},
	});

	const toggleSelection = (key: EntityKey) => {
		setSelections((prev) => ({ ...prev, [key]: !prev[key] }));
	};

	// Check if a selection has unmet dependencies
	const hasMissingDeps = (entity: (typeof IMPORT_ENTITIES)[number]) => {
		if (!("dependsOn" in entity) || !entity.dependsOn) return false;
		return entity.dependsOn.some((dep) => !selections[dep as EntityKey]);
	};

	const updateMappingType = (clockodoUserId: number, mappingType: UserMappingType) => {
		setUserMappings((prev) =>
			prev.map((m) => {
				if (m.clockodoUserId !== clockodoUserId) return m;
				if (mappingType === "skipped" || mappingType === "new_employee") {
					return {
						...m,
						mappingType,
						employeeId: null,
						userId: null,
						employeeName: null,
					};
				}
				return { ...m, mappingType };
			}),
		);
	};

	const updateMappingEmployee = (clockodoUserId: number, employeeId: string) => {
		const emp = z8Employees.find((e) => e.id === employeeId);
		if (!emp) return;
		setUserMappings((prev) =>
			prev.map((m) =>
				m.clockodoUserId === clockodoUserId
					? {
							...m,
							mappingType: "manual" as UserMappingType,
							employeeId: emp.id,
							userId: emp.userId,
							employeeName: emp.name,
						}
					: m,
			),
		);
	};

	const updateDateRange = (preset: DateRangePreset) => {
		setSelections((prev) => ({
			...prev,
			dateRange: { preset, startDate: prev.dateRange.startDate, endDate: prev.dateRange.endDate },
		}));
	};

	const updateCustomDateRange = (range: DateRange | undefined) => {
		setSelections((prev) => ({
			...prev,
			dateRange: {
				preset: "custom" as DateRangePreset,
				startDate: range?.from?.toISOString() ?? null,
				endDate: range?.to?.toISOString() ?? null,
			},
		}));
	};

	return (
		<div className="space-y-6">
			{/* Step indicator */}
			<StepIndicator currentStep={step} />

			{/* Step 1: Credentials */}
			{step === "credentials" && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconKey className="h-5 w-5" aria-hidden="true" />
							{t("settings.clockodoImport.credentials.title", "Clockodo Credentials")}
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
								value={email}
								onChange={(e) => setEmail(e.target.value)}
								placeholder="admin@company.com"
								disabled={validateMutation.isPending}
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
									<IconExternalLink className="ml-0.5 inline h-3 w-3" aria-hidden="true" />
								</a>
							</p>
							<Input
								id="clockodo-apikey"
								type="password"
								value={apiKey}
								onChange={(e) => setApiKey(e.target.value)}
								placeholder="xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
								disabled={validateMutation.isPending}
								autoComplete="off"
								spellCheck={false}
							/>
						</div>
						<div className="flex justify-end pt-2">
							<Button
								onClick={() => validateMutation.mutate()}
								disabled={!email.trim() || !apiKey.trim() || validateMutation.isPending}
							>
								{validateMutation.isPending ? (
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
								) : (
									<IconArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />
								)}
								{t("settings.clockodoImport.credentials.connect", "Connect & Preview")}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Step 2: Preview */}
			{step === "preview" && preview && (
				<Card>
					<CardHeader>
						<CardTitle>{t("settings.clockodoImport.preview.title", "Data Preview")}</CardTitle>
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
											{t("settings.clockodoImport.preview.inClockodo", "In Clockodo")}
										</th>
										<th className="pb-2 text-right font-medium">
											{t("settings.clockodoImport.preview.inZ8", "Already in Z8")}
										</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									<PreviewRow
										label={t("settings.clockodoImport.entity.users", "Users / Employees")}
										clockodo={preview.users}
										z8={existingCounts?.employees ?? 0}
									/>
									<PreviewRow
										label={t("settings.clockodoImport.entity.teams", "Teams")}
										clockodo={preview.teams}
										z8={existingCounts?.teams ?? 0}
									/>
									<PreviewRow
										label={t(
											"settings.clockodoImport.entity.services",
											"Services / Work Categories",
										)}
										clockodo={preview.services}
										z8={existingCounts?.workCategories ?? 0}
									/>
									<PreviewRow
										label={t("settings.clockodoImport.entity.entries", "Time Entries")}
										clockodo={preview.entries}
										z8={existingCounts?.workPeriods ?? 0}
									/>
									<PreviewRow
										label={t("settings.clockodoImport.entity.absences", "Absences")}
										clockodo={preview.absences}
										z8={existingCounts?.absences ?? 0}
									/>
									<PreviewRow
										label={t(
											"settings.clockodoImport.entity.targetHours",
											"Target Hours / Work Policies",
										)}
										clockodo={preview.targetHours}
										z8={existingCounts?.workPolicies ?? 0}
									/>
									<PreviewRow
										label={t("settings.clockodoImport.entity.holidayQuotas", "Holiday Quotas")}
										clockodo={preview.holidayQuotas}
										z8={0}
									/>
									<PreviewRow
										label={t("settings.clockodoImport.entity.nonBusinessDays", "Non-Business Days")}
										clockodo={preview.nonBusinessDays}
										z8={existingCounts?.holidays ?? 0}
									/>
									<PreviewRow
										label={t("settings.clockodoImport.entity.surcharges", "Surcharges")}
										clockodo={preview.surcharges}
										z8={existingCounts?.surcharges ?? 0}
									/>
								</tbody>
							</table>
						</div>
						<div className="mt-4 flex justify-between">
							<Button variant="outline" onClick={() => setStep("credentials")}>
								<IconArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
								{t("common.back", "Back")}
							</Button>
							<Button
								onClick={() => fetchUsersMutation.mutate()}
								disabled={fetchUsersMutation.isPending}
							>
								{fetchUsersMutation.isPending ? (
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
								) : (
									<IconArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />
								)}
								{t("settings.clockodoImport.preview.next", "Map Users")}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Step 3: User Mapping */}
			{step === "user-mapping" && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconUsers className="h-5 w-5" aria-hidden="true" />
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
								checked={onlyImportMapped}
								onCheckedChange={setOnlyImportMapped}
							/>
							<Label htmlFor="only-import-mapped" className="cursor-pointer text-sm">
								{t(
									"settings.clockodoImport.userMapping.onlyMapped",
									"Only import mapped users (don't create new accounts for unmapped users)",
								)}
							</Label>
						</div>

						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b text-left">
										<th className="pb-2 font-medium">
											{t("settings.clockodoImport.userMapping.clockodoUser", "Clockodo User")}
										</th>
										<th className="pb-2 font-medium">
											{t("settings.clockodoImport.userMapping.email", "Email")}
										</th>
										<th className="pb-2 font-medium">
											{t("settings.clockodoImport.userMapping.status", "Status")}
										</th>
										<th className="pb-2 font-medium">
											{t("settings.clockodoImport.userMapping.mappedTo", "Mapped To")}
										</th>
										<th className="pb-2 font-medium">
											{t("settings.clockodoImport.userMapping.action", "Action")}
										</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									{userMappings.map((mapping) => (
										<UserMappingRow
											key={mapping.clockodoUserId}
											mapping={mapping}
											z8Employees={z8Employees}
											onChangeMappingType={(type) =>
												updateMappingType(mapping.clockodoUserId, type)
											}
											onChangeEmployee={(empId) =>
												updateMappingEmployee(mapping.clockodoUserId, empId)
											}
										/>
									))}
								</tbody>
							</table>
						</div>

						<div className="flex items-center gap-4 text-xs text-muted-foreground">
							<span className="flex items-center gap-1">
								<IconLink className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
								{t("settings.clockodoImport.userMapping.autoMatched", "{count} auto-matched", {
									count: userMappings.filter((m) => m.mappingType === "auto_email").length,
								})}
							</span>
							<span className="flex items-center gap-1">
								<IconUserPlus className="h-3.5 w-3.5 text-blue-500" aria-hidden="true" />
								{t("settings.clockodoImport.userMapping.newEmployees", "{count} new", {
									count: userMappings.filter((m) => m.mappingType === "new_employee").length,
								})}
							</span>
							<span className="flex items-center gap-1">
								<IconUserX className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
								{t("settings.clockodoImport.userMapping.skippedCount", "{count} skipped", {
									count: userMappings.filter((m) => m.mappingType === "skipped").length,
								})}
							</span>
						</div>

						<div className="flex justify-between pt-2">
							<Button variant="outline" onClick={() => setStep("preview")}>
								<IconArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
								{t("common.back", "Back")}
							</Button>
							<Button
								onClick={() => saveMappingsMutation.mutate()}
								disabled={saveMappingsMutation.isPending}
							>
								{saveMappingsMutation.isPending ? (
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
								) : (
									<IconArrowRight className="mr-2 h-4 w-4" aria-hidden="true" />
								)}
								{t("settings.clockodoImport.userMapping.continue", "Continue")}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Step 4: Selection */}
			{step === "selection" && (
				<Card>
					<CardHeader>
						<CardTitle>
							{t("settings.clockodoImport.selection.title", "Select Data to Import")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.clockodoImport.selection.description",
								"Choose which data types to import. Duplicates will be automatically skipped.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4">
						{/* Date range selector */}
						<Card className="border-dashed">
							<CardHeader className="pb-3">
								<CardTitle className="flex items-center gap-2 text-sm">
									<IconCalendar className="h-4 w-4" aria-hidden="true" />
									{t(
										"settings.clockodoImport.selection.dateRange",
										"Date range for time entries & absences",
									)}
								</CardTitle>
								<CardDescription className="text-xs">
									{t(
										"settings.clockodoImport.selection.dateRangeDescription",
										"This only affects time entries and absences. Other data (users, teams, etc.) is always imported fully.",
									)}
								</CardDescription>
							</CardHeader>
							<CardContent className="space-y-3">
								<Select
									value={selections.dateRange.preset}
									onValueChange={(val) => updateDateRange(val as DateRangePreset)}
								>
									<SelectTrigger>
										<SelectValue />
									</SelectTrigger>
									<SelectContent>
										{DATE_RANGE_PRESETS.map((preset) => (
											<SelectItem key={preset.value} value={preset.value}>
												{dateRangeLabel(preset.value, preset.label)}
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
												<IconCalendar className="mr-2 h-4 w-4" aria-hidden="true" />
												{selections.dateRange.startDate && selections.dateRange.endDate
													? `${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(selections.dateRange.startDate))} \u2013 ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(selections.dateRange.endDate))}`
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
												onSelect={updateCustomDateRange}
												numberOfMonths={2}
											/>
										</PopoverContent>
									</Popover>
								)}
							</CardContent>
						</Card>

						{/* Entity checkboxes */}
						{IMPORT_ENTITIES.map((entity) => {
							const missingDeps = hasMissingDeps(entity);
							const entityCount = preview?.[entity.key as keyof ClockodoDataPreview] ?? 0;

							return (
								<div
									key={entity.key}
									className="flex items-center justify-between rounded-lg border p-3"
								>
									<div className="flex items-center gap-3">
										<Checkbox
											id={`import-${entity.key}`}
											checked={selections[entity.key]}
											onCheckedChange={() => toggleSelection(entity.key)}
											disabled={entityCount === 0}
										/>
										<div>
											<Label
												htmlFor={`import-${entity.key}`}
												className="cursor-pointer text-sm font-medium"
											>
												{entityLabel(entity.key, entity.label)}
											</Label>
											{missingDeps && selections[entity.key] && (
												<p className="text-xs text-amber-600 dark:text-amber-400">
													{t(
														"settings.clockodoImport.selection.dependencyWarning",
														"Dependencies will be imported automatically",
													)}
												</p>
											)}
										</div>
									</div>
									<Badge variant="secondary" className="tabular-nums">
										{entityCount}
									</Badge>
								</div>
							);
						})}

						<div className="flex justify-between pt-4">
							<Button variant="outline" onClick={() => setStep("user-mapping")}>
								<IconArrowLeft className="mr-2 h-4 w-4" aria-hidden="true" />
								{t("common.back", "Back")}
							</Button>
							<Button
								onClick={() => {
									setStep("importing");
									importMutation.mutate();
								}}
								disabled={
									!Object.entries(selections).some(
										([key, val]) => key !== "dateRange" && val === true,
									)
								}
							>
								<IconDatabaseImport className="mr-2 h-4 w-4" aria-hidden="true" />
								{t("settings.clockodoImport.selection.startImport", "Start Import")}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Step 5: Importing */}
			{step === "importing" && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							<IconLoader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
							{t("settings.clockodoImport.importing.title", "Importing Data\u2026")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.clockodoImport.importing.description",
								"Please do not close this page. The import is running and may take a while for large datasets.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						<div className="space-y-4">
							<Progress value={undefined} className="h-2" />
							<p className="text-center text-sm text-muted-foreground">
								{t(
									"settings.clockodoImport.importing.patience",
									"Fetching and importing your data from Clockodo\u2026",
								)}
							</p>
						</div>
					</CardContent>
				</Card>
			)}

			{/* Step 6: Complete */}
			{step === "complete" && importResult && (
				<Card>
					<CardHeader>
						<CardTitle className="flex items-center gap-2">
							{importResult.status === "success" ? (
								<IconCircleCheck className="h-5 w-5 text-emerald-500" aria-hidden="true" />
							) : importResult.status === "partial" ? (
								<IconAlertTriangle className="h-5 w-5 text-amber-500" aria-hidden="true" />
							) : (
								<IconCircleX className="h-5 w-5 text-destructive" aria-hidden="true" />
							)}
							{importResult.status === "success"
								? t("settings.clockodoImport.complete.successTitle", "Import Complete")
								: importResult.status === "partial"
									? t("settings.clockodoImport.complete.partialTitle", "Import Partially Complete")
									: t("settings.clockodoImport.complete.failedTitle", "Import Failed")}
						</CardTitle>
						<CardDescription>
							{t("settings.clockodoImport.complete.duration", "Completed in {seconds}s", {
								seconds: Math.round(importResult.durationMs / 1000),
							})}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{importResult.errorMessage && (
							<div className="mb-4 rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
								{importResult.errorMessage}
							</div>
						)}

						<div className="overflow-x-auto">
							<table className="w-full text-sm">
								<thead>
									<tr className="border-b text-left">
										<th className="pb-2 font-medium">
											{t("settings.clockodoImport.complete.dataType", "Data Type")}
										</th>
										<th className="pb-2 text-right font-medium">
											{t("settings.clockodoImport.complete.imported", "Imported")}
										</th>
										<th className="pb-2 text-right font-medium">
											{t("settings.clockodoImport.complete.skipped", "Skipped")}
										</th>
										<th className="pb-2 text-right font-medium">
											{t("settings.clockodoImport.complete.errors", "Errors")}
										</th>
									</tr>
								</thead>
								<tbody className="divide-y">
									{IMPORT_ENTITIES.map((entity) => {
										const entityResult = importResult[entity.key as keyof ImportResult];
										if (
											!entityResult ||
											typeof entityResult !== "object" ||
											!("imported" in entityResult)
										)
											return null;
										if (!selections[entity.key]) return null;

										return (
											<ResultRow
												key={entity.key}
												label={entityLabel(entity.key, entity.label)}
												imported={entityResult.imported}
												skipped={entityResult.skipped}
												errors={entityResult.errors}
											/>
										);
									})}
								</tbody>
							</table>
						</div>

						{/* Error details */}
						{Object.entries(importResult)
							.filter(
								([_key, value]) =>
									typeof value === "object" && "errors" in value && value.errors.length > 0,
							)
							.map(([key, value]) => {
								const entityResult = value as { errors: string[] };
								const entity = IMPORT_ENTITIES.find((e) => e.key === key);
								return (
									<details key={key} className="mt-3">
										<summary className="cursor-pointer text-sm font-medium text-destructive">
											{entity ? entityLabel(entity.key, entity.label) : key}:{" "}
											{t("settings.clockodoImport.complete.errorCount", "{count} error(s)", {
												count: entityResult.errors.length,
											})}
										</summary>
										<ul className="mt-1 list-inside list-disc space-y-1 text-xs text-muted-foreground">
											{entityResult.errors.slice(0, 20).map((err, i) => (
												<li key={i}>{err}</li>
											))}
											{entityResult.errors.length > 20 && (
												<li>
													{t(
														"settings.clockodoImport.complete.moreErrors",
														"\u2026and {count} more",
														{
															count: entityResult.errors.length - 20,
														},
													)}
												</li>
											)}
										</ul>
									</details>
								);
							})}

						<div className="mt-6 flex justify-end">
							<Button onClick={() => router.push("/settings")}>
								<IconCheck className="mr-2 h-4 w-4" aria-hidden="true" />
								{t("settings.clockodoImport.complete.done", "Done")}
							</Button>
						</div>
					</CardContent>
				</Card>
			)}
		</div>
	);
}

// ============================================
// SUB-COMPONENTS
// ============================================

function StepIndicator({ currentStep }: { currentStep: WizardStep }) {
	const { t } = useTranslate();
	const steps: { key: WizardStep; label: string }[] = [
		{ key: "credentials", label: t("settings.clockodoImport.step.credentials", "Credentials") },
		{ key: "preview", label: t("settings.clockodoImport.step.preview", "Preview") },
		{ key: "user-mapping", label: t("settings.clockodoImport.step.userMapping", "User Mapping") },
		{ key: "selection", label: t("settings.clockodoImport.step.selection", "Selection") },
		{ key: "importing", label: t("settings.clockodoImport.step.import", "Import") },
		{ key: "complete", label: t("settings.clockodoImport.step.complete", "Complete") },
	];

	const currentIndex = steps.findIndex((s) => s.key === currentStep);

	return (
		<div className="flex items-center justify-between">
			{steps.map((s, i) => (
				<div key={s.key} className="flex items-center">
					<div className="flex items-center gap-2">
						<div
							className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-medium ${
								i < currentIndex
									? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
									: i === currentIndex
										? "bg-primary text-primary-foreground"
										: "bg-muted text-muted-foreground"
							}`}
						>
							{i < currentIndex ? <IconCheck className="h-4 w-4" /> : i + 1}
						</div>
						<span
							className={`hidden text-sm sm:inline ${
								i === currentIndex ? "font-medium" : "text-muted-foreground"
							}`}
						>
							{s.label}
						</span>
					</div>
					{i < steps.length - 1 && <div className="mx-2 h-px w-8 bg-border sm:w-12" />}
				</div>
			))}
		</div>
	);
}

function PreviewRow({ label, clockodo, z8 }: { label: string; clockodo: number; z8: number }) {
	return (
		<tr>
			<td className="py-2">{label}</td>
			<td className="py-2 text-right tabular-nums">{clockodo.toLocaleString()}</td>
			<td className="py-2 text-right tabular-nums text-muted-foreground">{z8.toLocaleString()}</td>
		</tr>
	);
}

function UserMappingRow({
	mapping,
	z8Employees,
	onChangeMappingType,
	onChangeEmployee,
}: {
	mapping: UserMappingEntry;
	z8Employees: Z8EmployeeInfo[];
	onChangeMappingType: (type: UserMappingType) => void;
	onChangeEmployee: (employeeId: string) => void;
}) {
	const { t } = useTranslate();
	return (
		<tr>
			<td className="py-2 pr-3 font-medium">{mapping.clockodoUserName}</td>
			<td className="py-2 pr-3 text-muted-foreground">{mapping.clockodoUserEmail}</td>
			<td className="py-2 pr-3">
				<MappingStatusBadge type={mapping.mappingType} />
			</td>
			<td className="py-2 pr-3">
				{mapping.mappingType === "manual" || mapping.mappingType === "auto_email" ? (
					<span className="text-sm">{mapping.employeeName ?? "-"}</span>
				) : (
					<span className="text-sm text-muted-foreground">-</span>
				)}
			</td>
			<td className="py-2">
				<Select
					value={
						mapping.mappingType === "manual" ? `manual:${mapping.employeeId}` : mapping.mappingType
					}
					onValueChange={(val) => {
						if (val.startsWith("manual:")) {
							onChangeEmployee(val.slice(7));
						} else {
							onChangeMappingType(val as UserMappingType);
						}
					}}
				>
					<SelectTrigger size="sm" className="w-[180px]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{mapping.mappingType === "auto_email" && (
							<SelectItem value="auto_email">
								{t("settings.clockodoImport.mapping.autoMatched", "Auto-matched")}
							</SelectItem>
						)}
						<SelectItem value="new_employee">
							{t("settings.clockodoImport.mapping.createNew", "Create new")}
						</SelectItem>
						<SelectItem value="skipped">
							{t("settings.clockodoImport.mapping.skip", "Skip")}
						</SelectItem>
						{z8Employees.map((emp) => (
							<SelectItem key={emp.id} value={`manual:${emp.id}`}>
								{emp.name}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</td>
		</tr>
	);
}

function MappingStatusBadge({ type }: { type: UserMappingType }) {
	const { t } = useTranslate();
	switch (type) {
		case "auto_email":
			return (
				<Badge
					variant="outline"
					className="border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-400"
				>
					<IconLink className="mr-1 h-3 w-3" aria-hidden="true" />
					{t("settings.clockodoImport.mappingStatus.auto", "Auto")}
				</Badge>
			);
		case "manual":
			return (
				<Badge
					variant="outline"
					className="border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-400"
				>
					<IconLink className="mr-1 h-3 w-3" aria-hidden="true" />
					{t("settings.clockodoImport.mappingStatus.manual", "Manual")}
				</Badge>
			);
		case "new_employee":
			return (
				<Badge
					variant="outline"
					className="border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-400"
				>
					<IconUserPlus className="mr-1 h-3 w-3" aria-hidden="true" />
					{t("settings.clockodoImport.mappingStatus.new", "New")}
				</Badge>
			);
		case "skipped":
			return (
				<Badge variant="outline" className="text-muted-foreground">
					<IconUserX className="mr-1 h-3 w-3" aria-hidden="true" />
					{t("settings.clockodoImport.mappingStatus.skip", "Skip")}
				</Badge>
			);
	}
}

function ResultRow({
	label,
	imported,
	skipped,
	errors,
}: {
	label: string;
	imported: number;
	skipped: number;
	errors: string[];
}) {
	return (
		<tr>
			<td className="py-2">{label}</td>
			<td className="py-2 text-right tabular-nums">
				{imported > 0 ? (
					<span className="text-emerald-600 dark:text-emerald-400">{imported}</span>
				) : (
					<IconMinus className="ml-auto h-4 w-4 text-muted-foreground" />
				)}
			</td>
			<td className="py-2 text-right tabular-nums text-muted-foreground">{skipped}</td>
			<td className="py-2 text-right tabular-nums">
				{errors.length > 0 ? (
					<span className="text-destructive">{errors.length}</span>
				) : (
					<IconMinus className="ml-auto h-4 w-4 text-muted-foreground" />
				)}
			</td>
		</tr>
	);
}
