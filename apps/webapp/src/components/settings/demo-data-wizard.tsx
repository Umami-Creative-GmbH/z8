"use client";

import {
	IconAlertTriangle,
	IconBriefcase,
	IconBuilding,
	IconCalendarEvent,
	IconCategory,
	IconCheck,
	IconCircle,
	IconClock,
	IconDatabase,
	IconLoader2,
	IconPlayerPlay,
	IconShieldCheck,
	IconTrash,
	IconUserCheck,
	IconUsers,
	IconUsersGroup,
	IconX,
} from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
	assignWorkCategoriesToPeriodsStepAction,
	clearTimeDataAction,
	deleteNonAdminDataAction,
	generateAbsencesStepAction,
	generateChangePoliciesStepAction,
	generateDemoEmployeesAction,
	generateLocationsStepAction,
	generateManagersStepAction,
	generateProjectsStepAction,
	generateShiftsStepAction,
	generateShiftTemplatesStepAction,
	generateTeamsStepAction,
	generateTimeEntriesStepAction,
	generateWorkCategoriesStepAction,
	type StepGenerationInput,
} from "@/app/[locale]/(app)/settings/demo/actions";
import { useOrganization } from "@/hooks/use-organization";
import type { DeleteNonAdminResult } from "@/lib/demo/delete-non-admin";
import type { ClearDataResult, DemoDataResult } from "@/lib/demo/demo-data.service";
import type { GenerateEmployeesResult } from "@/lib/demo/employee-generator";
import { cn } from "@/lib/utils";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "../ui/alert-dialog";
import { Button } from "../ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Checkbox } from "../ui/checkbox";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface DemoDataWizardProps {
	employees: Array<{ id: string; name: string }>;
}

type WizardStep = "configure" | "generating" | "complete";
type StepStatus = "pending" | "in-progress" | "complete" | "error";

interface GenerationStep {
	id: string;
	label: string;
	description: string;
	icon: React.ReactNode;
	status: StepStatus;
	result?: string;
	error?: string;
}

export function DemoDataWizard({ employees }: DemoDataWizardProps) {
	const { t } = useTranslate();
	const router = useRouter();
	const { organizationId } = useOrganization();
	const [wizardStep, setWizardStep] = useState<WizardStep>("configure");
	const [isGenerating, setIsGenerating] = useState(false);
	const [isClearing, setIsClearing] = useState(false);

	// Form state
	const [dateRangeType, setDateRangeType] = useState<"last30" | "last60" | "last90" | "thisYear">(
		"last30",
	);
	const [includeTimeEntries, setIncludeTimeEntries] = useState(true);
	const [includeAbsences, setIncludeAbsences] = useState(true);
	const [includeTeams, setIncludeTeams] = useState(false);
	const [teamCount, setTeamCount] = useState(4);
	const [includeProjects, setIncludeProjects] = useState(false);
	const [projectCount, setProjectCount] = useState(6);
	const [selectedEmployees, setSelectedEmployees] = useState<"all" | "selected">("all");

	// NEW: Location options
	const [includeLocations, setIncludeLocations] = useState(false);
	const [locationCount, setLocationCount] = useState(3);
	// NEW: Work category options
	const [includeWorkCategories, setIncludeWorkCategories] = useState(false);
	const [assignWorkCategoriesToPeriods, setAssignWorkCategoriesToPeriods] = useState(true);
	// NEW: Change policy options
	const [includeChangePolicies, setIncludeChangePolicies] = useState(false);
	// NEW: Shift scheduling options
	const [includeShifts, setIncludeShifts] = useState(false);

	// Generation steps state
	const [steps, setSteps] = useState<GenerationStep[]>([]);
	const [error, setError] = useState<string | null>(null);

	// Results
	const [result, setResult] = useState<DemoDataResult | null>(null);
	const [clearResult, setClearResult] = useState<ClearDataResult | null>(null);
	const [confirmText, setConfirmText] = useState("");

	// Employee generation state
	const [employeeCount, setEmployeeCount] = useState(5);
	const [includeManagersForEmployees, setIncludeManagersForEmployees] = useState(true);
	const [isGeneratingEmployees, setIsGeneratingEmployees] = useState(false);
	const [employeeResult, setEmployeeResult] = useState<GenerateEmployeesResult | null>(null);
	const [employeeError, setEmployeeError] = useState<string | null>(null);

	// Delete non-admin state
	const [isDeletingNonAdmin, setIsDeletingNonAdmin] = useState(false);
	const [deleteNonAdminResult, setDeleteNonAdminResult] = useState<DeleteNonAdminResult | null>(
		null,
	);
	const [deleteNonAdminConfirmText, setDeleteNonAdminConfirmText] = useState("");

	// Reset all state when organization changes
	const prevOrgIdRef = useRef<string | null>(organizationId);
	useEffect(() => {
		// Only reset if we have a valid new org (not initial null -> value transition)
		if (prevOrgIdRef.current !== null && prevOrgIdRef.current !== organizationId) {
			setWizardStep("configure");
			setSteps([]);
			setResult(null);
			setError(null);
			setClearResult(null);
			setConfirmText("");
			setEmployeeResult(null);
			setEmployeeError(null);
			setDeleteNonAdminResult(null);
			setDeleteNonAdminConfirmText("");
		}
		prevOrgIdRef.current = organizationId;
	}, [organizationId]);

	const updateStepStatus = (
		stepId: string,
		status: StepStatus,
		result?: string,
		error?: string,
	) => {
		setSteps((prev) => prev.map((s) => (s.id === stepId ? { ...s, status, result, error } : s)));
	};

	const handleGenerate = async () => {
		if (!organizationId) {
			setError(t("settings.demo.errors.noOrganization", "No organization selected"));
			return;
		}
		setError(null);
		setResult(null);

		// Build steps based on selected options
		const activeSteps: GenerationStep[] = [];

		if (includeTeams) {
			activeSteps.push({
				id: "teams",
				label: t("settings.demo.steps.teams.label", "Teams"),
				description: t("settings.demo.steps.teams.description", "Creating teams and assigning employees"),
				icon: <IconUsersGroup className="size-4" />,
				status: "pending",
			});
		}

		if (includeProjects) {
			activeSteps.push({
				id: "projects",
				label: t("settings.demo.steps.projects.label", "Projects"),
				description: t("settings.demo.steps.projects.description", "Creating sample projects"),
				icon: <IconBriefcase className="size-4" />,
				status: "pending",
			});
		}

		// Manager assignments are always created if we have employees
		activeSteps.push({
			id: "managers",
			label: t("settings.demo.steps.managers.label", "Manager Assignments"),
			description: t("settings.demo.steps.managers.description", "Assigning managers to employees"),
			icon: <IconUserCheck className="size-4" />,
			status: "pending",
		});

		if (includeTimeEntries) {
			activeSteps.push({
				id: "time-entries",
				label: t("settings.demo.steps.timeEntries.label", "Time Entries"),
				description: t("settings.demo.steps.timeEntries.description", "Creating time entries and work periods"),
				icon: <IconClock className="size-4" />,
				status: "pending",
			});
		}

		if (includeAbsences) {
			activeSteps.push({
				id: "absences",
				label: t("settings.demo.steps.absences.label", "Absences"),
				description: t("settings.demo.steps.absences.description", "Creating absence entries"),
				icon: <IconUsers className="size-4" />,
				status: "pending",
			});
		}

		// NEW: Location steps
		if (includeLocations) {
			activeSteps.push({
				id: "locations",
				label: t("settings.demo.steps.locations.label", "Locations"),
				description: t("settings.demo.steps.locations.description", "Creating locations and subareas"),
				icon: <IconBuilding className="size-4" />,
				status: "pending",
			});
		}

		// NEW: Work category steps
		if (includeWorkCategories) {
			activeSteps.push({
				id: "work-categories",
				label: t("settings.demo.steps.workCategories.label", "Work Categories"),
				description: t("settings.demo.steps.workCategories.description", "Creating work category sets and categories"),
				icon: <IconCategory className="size-4" />,
				status: "pending",
			});
		}

		// NEW: Change policy steps
		if (includeChangePolicies) {
			activeSteps.push({
				id: "change-policies",
				label: t("settings.demo.steps.changePolicies.label", "Change Policies"),
				description: t("settings.demo.steps.changePolicies.description", "Creating change policies"),
				icon: <IconShieldCheck className="size-4" />,
				status: "pending",
			});
		}

		// NEW: Shift scheduling steps (depends on locations)
		if (includeShifts && includeLocations) {
			activeSteps.push({
				id: "shift-templates",
				label: t("settings.demo.steps.shiftTemplates.label", "Shift Templates"),
				description: t("settings.demo.steps.shiftTemplates.description", "Creating shift templates"),
				icon: <IconCalendarEvent className="size-4" />,
				status: "pending",
			});
			activeSteps.push({
				id: "shifts",
				label: t("settings.demo.steps.shifts.label", "Shifts"),
				description: t("settings.demo.steps.shifts.description", "Creating shifts and requests"),
				icon: <IconCalendarEvent className="size-4" />,
				status: "pending",
			});
		}

		// NEW: Work category assignment to periods (depends on work categories + time entries)
		if (includeWorkCategories && includeTimeEntries && assignWorkCategoriesToPeriods) {
			activeSteps.push({
				id: "assign-categories",
				label: t("settings.demo.steps.assignCategories.label", "Assign Categories"),
				description: t("settings.demo.steps.assignCategories.description", "Assigning work categories to periods"),
				icon: <IconCategory className="size-4" />,
				status: "pending",
			});
		}

		setSteps(activeSteps);
		setWizardStep("generating");
		setIsGenerating(true);

		const input: StepGenerationInput = {
			organizationId,
			dateRangeType,
			teamCount: includeTeams ? teamCount : undefined,
			projectCount: includeProjects ? projectCount : undefined,
			employeeIds: selectedEmployees === "all" ? undefined : [],
			// NEW: Location options
			locationCount: includeLocations ? locationCount : undefined,
		};

		const finalResult: DemoDataResult = {
			timeEntriesCreated: 0,
			workPeriodsCreated: 0,
			absencesCreated: 0,
			teamsCreated: 0,
			employeesAssignedToTeams: 0,
			projectsCreated: 0,
			managerAssignmentsCreated: 0,
			// NEW: Location results
			locationsCreated: 0,
			subareasCreated: 0,
			locationSupervisorsAssigned: 0,
			// NEW: Work category results
			workCategorySetsCreated: 0,
			workCategoriesCreated: 0,
			workCategoryAssignmentsCreated: 0,
			workCategoriesAssignedToPeriods: 0,
			// NEW: Change policy results
			changePoliciesCreated: 0,
			changePolicyAssignmentsCreated: 0,
			// NEW: Shift scheduling results
			shiftTemplatesCreated: 0,
			shiftRecurrencesCreated: 0,
			shiftsCreated: 0,
			shiftRequestsCreated: 0,
		};

		let hasError = false;

		// Helper to execute a step
		const executeStep = async (
			stepId: string,
			action: () => Promise<{ success: boolean; data?: unknown; error?: string }>,
			onSuccess: (data: unknown) => { result: string; updates: Partial<DemoDataResult> },
		): Promise<boolean> => {
			updateStepStatus(stepId, "in-progress");
			try {
				const response = await action();
				if (!response.success) {
					updateStepStatus(stepId, "error", undefined, response.error);
					return false;
				}
				const { result, updates } = onSuccess(response.data);
				Object.assign(finalResult, updates);
				updateStepStatus(stepId, "complete", result);
				return true;
			} catch (_err) {
				updateStepStatus(stepId, "error", undefined, "Unexpected error occurred");
				return false;
			}
		};

		// Phase 1: Run teams and projects in parallel (independent)
		const phase1Steps = activeSteps.filter((s) => s.id === "teams" || s.id === "projects");
		if (phase1Steps.length > 0) {
			const phase1Results = await Promise.all(
				phase1Steps.map((step) => {
					if (step.id === "teams") {
						return executeStep(
							step.id,
							() => generateTeamsStepAction(input),
							(data) => {
								const d = data as { teamsCreated: number; employeesAssignedToTeams: number };
								return {
									result: `${d.teamsCreated} teams, ${d.employeesAssignedToTeams} assigned`,
									updates: {
										teamsCreated: d.teamsCreated,
										employeesAssignedToTeams: d.employeesAssignedToTeams,
									},
								};
							},
						);
					}
					return executeStep(
						step.id,
						() => generateProjectsStepAction(input),
						(data) => {
							const d = data as { projectsCreated: number };
							return {
								result: `${d.projectsCreated} projects`,
								updates: { projectsCreated: d.projectsCreated },
							};
						},
					);
				}),
			);
			if (phase1Results.some((r) => !r)) hasError = true;
		}

		// Phase 2: Manager assignments (depends on teams being set up)
		if (!hasError && activeSteps.some((s) => s.id === "managers")) {
			const success = await executeStep(
				"managers",
				() => generateManagersStepAction(input),
				(data) => {
					const d = data as { managerAssignmentsCreated: number };
					return {
						result: `${d.managerAssignmentsCreated} assignments`,
						updates: { managerAssignmentsCreated: d.managerAssignmentsCreated },
					};
				},
			);
			if (!success) hasError = true;
		}

		// Phase 3: Run time entries and absences in parallel (independent)
		if (!hasError) {
			const phase3Steps = activeSteps.filter((s) => s.id === "time-entries" || s.id === "absences");
			if (phase3Steps.length > 0) {
				const phase3Results = await Promise.all(
					phase3Steps.map((step) => {
						if (step.id === "time-entries") {
							return executeStep(
								step.id,
								() => generateTimeEntriesStepAction(input),
								(data) => {
									const d = data as { timeEntriesCreated: number; workPeriodsCreated: number };
									return {
										result: `${d.timeEntriesCreated} entries, ${d.workPeriodsCreated} periods`,
										updates: {
											timeEntriesCreated: d.timeEntriesCreated,
											workPeriodsCreated: d.workPeriodsCreated,
										},
									};
								},
							);
						}
						return executeStep(
							step.id,
							() => generateAbsencesStepAction(input),
							(data) => {
								const d = data as { absencesCreated: number };
								return {
									result: `${d.absencesCreated} absences`,
									updates: { absencesCreated: d.absencesCreated },
								};
							},
						);
					}),
				);
				if (phase3Results.some((r) => !r)) hasError = true;
			}
		}

		// Phase 4: Locations (independent, can run in parallel with work categories and change policies)
		if (!hasError) {
			const phase4Steps = activeSteps.filter(
				(s) => s.id === "locations" || s.id === "work-categories" || s.id === "change-policies",
			);
			if (phase4Steps.length > 0) {
				const phase4Results = await Promise.all(
					phase4Steps.map((step) => {
						if (step.id === "locations") {
							return executeStep(
								step.id,
								() => generateLocationsStepAction(input),
								(data) => {
									const d = data as {
										locationsCreated: number;
										subareasCreated: number;
										supervisorAssignmentsCreated: number;
									};
									return {
										result: `${d.locationsCreated} locations, ${d.subareasCreated} subareas`,
										updates: {
											locationsCreated: d.locationsCreated,
											subareasCreated: d.subareasCreated,
											locationSupervisorsAssigned: d.supervisorAssignmentsCreated,
										},
									};
								},
							);
						}
						if (step.id === "work-categories") {
							return executeStep(
								step.id,
								() => generateWorkCategoriesStepAction(input),
								(data) => {
									const d = data as {
										setsCreated: number;
										categoriesCreated: number;
										assignmentsCreated: number;
									};
									return {
										result: `${d.setsCreated} sets, ${d.categoriesCreated} categories`,
										updates: {
											workCategorySetsCreated: d.setsCreated,
											workCategoriesCreated: d.categoriesCreated,
											workCategoryAssignmentsCreated: d.assignmentsCreated,
										},
									};
								},
							);
						}
						return executeStep(
							step.id,
							() => generateChangePoliciesStepAction(input),
							(data) => {
								const d = data as { policiesCreated: number; assignmentsCreated: number };
								return {
									result: `${d.policiesCreated} policies`,
									updates: {
										changePoliciesCreated: d.policiesCreated,
										changePolicyAssignmentsCreated: d.assignmentsCreated,
									},
								};
							},
						);
					}),
				);
				if (phase4Results.some((r) => !r)) hasError = true;
			}
		}

		// Phase 5: Shift templates (depends on locations)
		if (!hasError && activeSteps.some((s) => s.id === "shift-templates")) {
			const success = await executeStep(
				"shift-templates",
				() => generateShiftTemplatesStepAction(input),
				(data) => {
					const d = data as { templatesCreated: number };
					return {
						result: `${d.templatesCreated} templates`,
						updates: { shiftTemplatesCreated: d.templatesCreated },
					};
				},
			);
			if (!success) hasError = true;
		}

		// Phase 6: Shifts (depends on shift templates)
		if (!hasError && activeSteps.some((s) => s.id === "shifts")) {
			const success = await executeStep(
				"shifts",
				() => generateShiftsStepAction(input),
				(data) => {
					const d = data as {
						recurrencesCreated: number;
						shiftsCreated: number;
						requestsCreated: number;
					};
					return {
						result: `${d.shiftsCreated} shifts, ${d.requestsCreated} requests`,
						updates: {
							shiftRecurrencesCreated: d.recurrencesCreated,
							shiftsCreated: d.shiftsCreated,
							shiftRequestsCreated: d.requestsCreated,
						},
					};
				},
			);
			if (!success) hasError = true;
		}

		// Phase 7: Assign work categories to periods (depends on work categories + time entries)
		if (!hasError && activeSteps.some((s) => s.id === "assign-categories")) {
			const success = await executeStep(
				"assign-categories",
				() => assignWorkCategoriesToPeriodsStepAction(input),
				(data) => {
					const d = data as { workCategoriesAssigned: number };
					return {
						result: `${d.workCategoriesAssigned} periods assigned`,
						updates: { workCategoriesAssignedToPeriods: d.workCategoriesAssigned },
					};
				},
			);
			if (!success) hasError = true;
		}

		setIsGenerating(false);

		if (!hasError) {
			setResult(finalResult);
			setWizardStep("complete");
		} else {
			setError(t("settings.demo.errors.generationFailed", "Generation failed. Please try again."));
		}
	};

	const handleClear = async () => {
		if (!organizationId) {
			setError(t("settings.demo.errors.noOrganization", "No organization selected"));
			return;
		}
		setIsClearing(true);
		const response = await clearTimeDataAction(organizationId);
		if (!response.success) {
			setError(response.error);
		} else {
			setClearResult(response.data);
		}
		setConfirmText("");
		setIsClearing(false);
	};

	const handleReset = () => {
		setWizardStep("configure");
		setSteps([]);
		setResult(null);
		setError(null);
	};

	const handleGenerateEmployees = async () => {
		if (!organizationId) {
			setEmployeeError(t("settings.demo.errors.noOrganization", "No organization selected"));
			return;
		}
		setEmployeeError(null);
		setEmployeeResult(null);
		setIsGeneratingEmployees(true);

		const response = await generateDemoEmployeesAction({
			organizationId,
			count: employeeCount,
			includeManagers: includeManagersForEmployees,
		});

		if (!response.success) {
			setEmployeeError(response.error);
		} else {
			setEmployeeResult(response.data);
			router.refresh();
		}
		setIsGeneratingEmployees(false);
	};

	const handleDeleteNonAdmin = async () => {
		if (!organizationId) {
			setError(t("settings.demo.errors.noOrganization", "No organization selected"));
			return;
		}
		setIsDeletingNonAdmin(true);
		const response = await deleteNonAdminDataAction(organizationId);
		if (!response.success) {
			setError(response.error);
		} else {
			setDeleteNonAdminResult(response.data);
			router.refresh();
		}
		setDeleteNonAdminConfirmText("");
		setIsDeletingNonAdmin(false);
	};

	return (
		<div className="grid gap-6 lg:grid-cols-2">
			{/* Generate Demo Data Card */}
			<Card className="lg:col-span-2">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconDatabase className="size-5" />
						{t("settings.demo.generateData.title", "Generate Demo Data")}
					</CardTitle>
					<CardDescription>
						{t("settings.demo.generateData.description", "Create realistic sample data for your organization")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{wizardStep === "configure" && (
						<div className="space-y-6">
							{/* Step indicators */}
							<div className="flex items-center gap-4">
								<StepIndicator step={1} label={t("settings.demo.wizard.configure", "Configure")} active={true} completed={false} />
								<div className="h-px flex-1 bg-border" />
								<StepIndicator step={2} label={t("settings.demo.wizard.generate", "Generate")} active={false} completed={false} />
								<div className="h-px flex-1 bg-border" />
								<StepIndicator step={3} label={t("settings.demo.wizard.complete", "Complete")} active={false} completed={false} />
							</div>

							{error && (
								<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
									{error}
								</div>
							)}

							{/* Configuration Form */}
							<div className="grid gap-6 md:grid-cols-2">
								<div className="space-y-2">
									<Label htmlFor="dateRange">{t("settings.demo.form.dateRange.label", "Date Range")}</Label>
									<Select
										value={dateRangeType}
										onValueChange={(v) =>
											setDateRangeType(v as "last30" | "last60" | "last90" | "thisYear")
										}
									>
										<SelectTrigger id="dateRange">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="last30">{t("settings.demo.form.dateRange.last30", "Last 30 days")}</SelectItem>
											<SelectItem value="last60">{t("settings.demo.form.dateRange.last60", "Last 60 days")}</SelectItem>
											<SelectItem value="last90">{t("settings.demo.form.dateRange.last90", "Last 90 days")}</SelectItem>
											<SelectItem value="thisYear">{t("settings.demo.form.dateRange.thisYear", "This year")}</SelectItem>
										</SelectContent>
									</Select>
									<p className="text-xs text-muted-foreground">
										{t("settings.demo.form.dateRange.hint", "Time range for generated data")}
									</p>
								</div>

								<div className="space-y-2">
									<Label htmlFor="employees">{t("settings.demo.form.employees.label", "Employees")}</Label>
									<Select
										value={selectedEmployees}
										onValueChange={(v) => setSelectedEmployees(v as "all" | "selected")}
									>
										<SelectTrigger id="employees">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="all">{t("settings.demo.form.employees.all", `All employees (${employees.length})`, { count: employees.length })}</SelectItem>
											<SelectItem value="selected" disabled>
												{t("settings.demo.form.employees.selectSpecific", "Select specific employees")}
											</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>

							<div className="space-y-4">
								<Label>{t("settings.demo.form.dataTypes.label", "Data Types")}</Label>
								<div className="grid gap-4 md:grid-cols-2">
									{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Checkbox handles keyboard interaction */}
									<div
										className={cn(
											"flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
											includeTimeEntries ? "border-primary bg-primary/5" : "hover:bg-muted/50",
										)}
										onClick={() => setIncludeTimeEntries(!includeTimeEntries)}
									>
										<Checkbox
											checked={includeTimeEntries}
											onCheckedChange={(v) => setIncludeTimeEntries(v === true)}
										/>
										<div className="space-y-1">
											<div className="flex items-center gap-2 font-medium">
												<IconClock className="size-4" />
												{t("settings.demo.form.dataTypes.timeEntries.title", "Time Entries")}
											</div>
											<p className="text-xs text-muted-foreground">
												{t("settings.demo.form.dataTypes.timeEntries.description", "Clock-in/out records and work periods")}
											</p>
										</div>
									</div>

									{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Checkbox handles keyboard interaction */}
									<div
										className={cn(
											"flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
											includeAbsences ? "border-primary bg-primary/5" : "hover:bg-muted/50",
										)}
										onClick={() => setIncludeAbsences(!includeAbsences)}
									>
										<Checkbox
											checked={includeAbsences}
											onCheckedChange={(v) => setIncludeAbsences(v === true)}
										/>
										<div className="space-y-1">
											<div className="flex items-center gap-2 font-medium">
												<IconUsers className="size-4" />
												{t("settings.demo.form.dataTypes.absences.title", "Absences")}
											</div>
											<p className="text-xs text-muted-foreground">
												{t("settings.demo.form.dataTypes.absences.description", "Vacation, sick leave, and other absences")}
											</p>
										</div>
									</div>

									{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Checkbox handles keyboard interaction */}
									<div
										className={cn(
											"flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
											includeTeams ? "border-primary bg-primary/5" : "hover:bg-muted/50",
										)}
										onClick={() => setIncludeTeams(!includeTeams)}
									>
										<Checkbox
											checked={includeTeams}
											onCheckedChange={(v) => setIncludeTeams(v === true)}
										/>
										<div className="flex-1 space-y-1">
											<div className="flex items-center gap-2 font-medium">
												<IconUsersGroup className="size-4" />
												{t("settings.demo.form.dataTypes.teams.title", "Teams")}
											</div>
											<p className="text-xs text-muted-foreground">
												{t("settings.demo.form.dataTypes.teams.description", "Create teams and assign employees")}
											</p>
											{includeTeams && (
												<div className="mt-2 flex items-center gap-2">
													<Label htmlFor="teamCount" className="text-xs whitespace-nowrap">
														{t("settings.demo.form.dataTypes.teams.countLabel", "Number of teams:")}
													</Label>
													<Input
														id="teamCount"
														type="number"
														min={1}
														max={10}
														value={teamCount}
														onChange={(e) => setTeamCount(parseInt(e.target.value, 10) || 4)}
														className="h-7 w-16 text-xs"
														onClick={(e) => e.stopPropagation()}
													/>
												</div>
											)}
										</div>
									</div>

									{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Checkbox handles keyboard interaction */}
									<div
										className={cn(
											"flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
											includeProjects ? "border-primary bg-primary/5" : "hover:bg-muted/50",
										)}
										onClick={() => setIncludeProjects(!includeProjects)}
									>
										<Checkbox
											checked={includeProjects}
											onCheckedChange={(v) => setIncludeProjects(v === true)}
										/>
										<div className="flex-1 space-y-1">
											<div className="flex items-center gap-2 font-medium">
												<IconBriefcase className="size-4" />
												{t("settings.demo.form.dataTypes.projects.title", "Projects")}
											</div>
											<p className="text-xs text-muted-foreground">
												{t("settings.demo.form.dataTypes.projects.description", "Sample projects for time tracking")}
											</p>
											{includeProjects && (
												<div className="mt-2 flex items-center gap-2">
													<Label htmlFor="projectCount" className="text-xs whitespace-nowrap">
														{t("settings.demo.form.dataTypes.projects.countLabel", "Number of projects:")}
													</Label>
													<Input
														id="projectCount"
														type="number"
														min={1}
														max={15}
														value={projectCount}
														onChange={(e) => setProjectCount(parseInt(e.target.value, 10) || 6)}
														className="h-7 w-16 text-xs"
														onClick={(e) => e.stopPropagation()}
													/>
												</div>
											)}
										</div>
									</div>

									{/* NEW: Locations checkbox */}
									{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Checkbox handles keyboard interaction */}
									<div
										className={cn(
											"flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
											includeLocations ? "border-primary bg-primary/5" : "hover:bg-muted/50",
										)}
										onClick={() => setIncludeLocations(!includeLocations)}
									>
										<Checkbox
											checked={includeLocations}
											onCheckedChange={(v) => setIncludeLocations(v === true)}
										/>
										<div className="flex-1 space-y-1">
											<div className="flex items-center gap-2 font-medium">
												<IconBuilding className="size-4" />
												{t("settings.demo.form.dataTypes.locations.title", "Locations")}
											</div>
											<p className="text-xs text-muted-foreground">
												{t("settings.demo.form.dataTypes.locations.description", "Work locations and subareas")}
											</p>
											{includeLocations && (
												<div className="mt-2 flex items-center gap-2">
													<Label htmlFor="locationCount" className="text-xs whitespace-nowrap">
														{t("settings.demo.form.dataTypes.locations.countLabel", "Number of locations:")}
													</Label>
													<Input
														id="locationCount"
														type="number"
														min={1}
														max={10}
														value={locationCount}
														onChange={(e) => setLocationCount(parseInt(e.target.value, 10) || 3)}
														className="h-7 w-16 text-xs"
														onClick={(e) => e.stopPropagation()}
													/>
												</div>
											)}
										</div>
									</div>

									{/* NEW: Work Categories checkbox */}
									{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Checkbox handles keyboard interaction */}
									<div
										className={cn(
											"flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
											includeWorkCategories ? "border-primary bg-primary/5" : "hover:bg-muted/50",
										)}
										onClick={() => setIncludeWorkCategories(!includeWorkCategories)}
									>
										<Checkbox
											checked={includeWorkCategories}
											onCheckedChange={(v) => setIncludeWorkCategories(v === true)}
										/>
										<div className="flex-1 space-y-1">
											<div className="flex items-center gap-2 font-medium">
												<IconCategory className="size-4" />
												{t("settings.demo.form.dataTypes.workCategories.title", "Work Categories")}
											</div>
											<p className="text-xs text-muted-foreground">
												{t("settings.demo.form.dataTypes.workCategories.description", "Category sets for work periods")}
											</p>
											{includeWorkCategories && includeTimeEntries && (
												<div
													className="mt-2 flex items-center gap-2"
													onClick={(e) => e.stopPropagation()}
												>
													<Checkbox
														id="assignCategories"
														checked={assignWorkCategoriesToPeriods}
														onCheckedChange={(v) => setAssignWorkCategoriesToPeriods(v === true)}
													/>
													<Label htmlFor="assignCategories" className="text-xs cursor-pointer">
														{t("settings.demo.form.dataTypes.workCategories.assignLabel", "Also assign to work periods")}
													</Label>
												</div>
											)}
										</div>
									</div>

									{/* NEW: Change Policies checkbox */}
									{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Checkbox handles keyboard interaction */}
									<div
										className={cn(
											"flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
											includeChangePolicies ? "border-primary bg-primary/5" : "hover:bg-muted/50",
										)}
										onClick={() => setIncludeChangePolicies(!includeChangePolicies)}
									>
										<Checkbox
											checked={includeChangePolicies}
											onCheckedChange={(v) => setIncludeChangePolicies(v === true)}
										/>
										<div className="space-y-1">
											<div className="flex items-center gap-2 font-medium">
												<IconShieldCheck className="size-4" />
												{t("settings.demo.form.dataTypes.changePolicies.title", "Change Policies")}
											</div>
											<p className="text-xs text-muted-foreground">
												{t("settings.demo.form.dataTypes.changePolicies.description", "Time entry change policies")}
											</p>
										</div>
									</div>

									{/* NEW: Shift Scheduling checkbox */}
									{/* biome-ignore lint/a11y/useKeyWithClickEvents lint/a11y/noStaticElementInteractions: Checkbox handles keyboard interaction */}
									<div
										className={cn(
											"flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
											includeShifts ? "border-primary bg-primary/5" : "hover:bg-muted/50",
											!includeLocations && "opacity-50",
										)}
										onClick={() => includeLocations && setIncludeShifts(!includeShifts)}
									>
										<Checkbox
											checked={includeShifts}
											disabled={!includeLocations}
											onCheckedChange={(v) => setIncludeShifts(v === true)}
										/>
										<div className="space-y-1">
											<div className="flex items-center gap-2 font-medium">
												<IconCalendarEvent className="size-4" />
												{t("settings.demo.form.dataTypes.shiftScheduling.title", "Shift Scheduling")}
											</div>
											<p className="text-xs text-muted-foreground">
												{t("settings.demo.form.dataTypes.shiftScheduling.description", "Shift templates and scheduled shifts")}
											</p>
											{!includeLocations && (
												<p className="text-xs text-amber-600 dark:text-amber-400">
													{t("settings.demo.form.dataTypes.shiftScheduling.requiresLocations", "Requires Locations to be enabled")}
												</p>
											)}
										</div>
									</div>
								</div>
							</div>

							<div className="flex justify-end">
								<Button
									onClick={handleGenerate}
									disabled={
										!includeTimeEntries &&
										!includeAbsences &&
										!includeTeams &&
										!includeProjects &&
										!includeLocations &&
										!includeWorkCategories &&
										!includeChangePolicies &&
										!includeShifts
									}
									className="gap-2"
								>
									<IconPlayerPlay className="size-4" />
									{t("settings.demo.generateData.button", "Generate Data")}
								</Button>
							</div>
						</div>
					)}

					{wizardStep === "generating" && (
						<div className="space-y-6">
							{/* Step indicators */}
							<div className="flex items-center gap-4">
								<StepIndicator step={1} label={t("settings.demo.wizard.configure", "Configure")} active={false} completed={true} />
								<div className="h-px flex-1 bg-primary" />
								<StepIndicator step={2} label={t("settings.demo.wizard.generate", "Generate")} active={true} completed={false} />
								<div className="h-px flex-1 bg-border" />
								<StepIndicator step={3} label={t("settings.demo.wizard.complete", "Complete")} active={false} completed={false} />
							</div>

							{error && (
								<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
									{error}
								</div>
							)}

							{/* Step-by-step progress */}
							<div className="space-y-3 py-4">
								{steps.map((step) => (
									<GenerationStepItem key={step.id} step={step} />
								))}
							</div>

							{!isGenerating && error && (
								<div className="flex justify-center gap-3">
									<Button variant="outline" onClick={handleReset}>
										{t("settings.demo.wizard.backToConfig", "Back to Configuration")}
									</Button>
								</div>
							)}
						</div>
					)}

					{wizardStep === "complete" && result && (
						<div className="space-y-6">
							{/* Step indicators */}
							<div className="flex items-center gap-4">
								<StepIndicator step={1} label={t("settings.demo.wizard.configure", "Configure")} active={false} completed={true} />
								<div className="h-px flex-1 bg-primary" />
								<StepIndicator step={2} label={t("settings.demo.wizard.generate", "Generate")} active={false} completed={true} />
								<div className="h-px flex-1 bg-primary" />
								<StepIndicator step={3} label={t("settings.demo.wizard.complete", "Complete")} active={true} completed={true} />
							</div>

							<div className="space-y-6 py-4">
								<div className="flex items-center justify-center gap-3 text-green-600">
									<div className="flex size-12 items-center justify-center rounded-full bg-green-100">
										<IconCheck className="size-6" />
									</div>
								</div>
								<p className="text-center text-lg font-medium">{t("settings.demo.results.success", "Demo data generated successfully!")}</p>

								{/* Show completed steps with results */}
								<div className="space-y-2">
									{steps.map((step) => (
										<div
											key={step.id}
											className="flex items-center gap-3 rounded-lg border bg-muted/30 p-3"
										>
											<div className="flex size-6 items-center justify-center rounded-full bg-green-100 text-green-600">
												<IconCheck className="size-4" />
											</div>
											<div className="flex-1">
												<span className="font-medium">{step.label}</span>
												{step.result && (
													<span className="ml-2 text-sm text-muted-foreground">
														— {step.result}
													</span>
												)}
											</div>
										</div>
									))}
								</div>

								<div className="flex justify-center">
									<Button variant="outline" onClick={handleReset}>
										{t("settings.demo.wizard.generateMore", "Generate More Data")}
									</Button>
								</div>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Generate Employees Card */}
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconUsers className="size-5" />
						{t("settings.demo.generateEmployees.title", "Generate Employees")}
					</CardTitle>
					<CardDescription>
						{t("settings.demo.generateEmployees.description", "Create demo employee accounts for testing")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						{employeeError && (
							<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
								{employeeError}
							</div>
						)}

						{employeeResult && (
							<div className="rounded-lg border border-green-500/50 bg-green-50 p-4 dark:bg-green-950/20">
								<p className="font-medium text-green-700 dark:text-green-400">
									{t("settings.demo.generateEmployees.successTitle", "Employees generated successfully!")}
								</p>
								<ul className="mt-2 space-y-1 text-sm text-green-600 dark:text-green-500">
									<li>{t("settings.demo.generateEmployees.usersCreated", `${employeeResult.usersCreated} users created`, { count: employeeResult.usersCreated })}</li>
									<li>{t("settings.demo.generateEmployees.employeesCreated", `${employeeResult.employeesCreated} employees created`, { count: employeeResult.employeesCreated })}</li>
									<li>{t("settings.demo.generateEmployees.managersCreated", `${employeeResult.managersCreated} manager assignments`, { count: employeeResult.managersCreated })}</li>
								</ul>
							</div>
						)}

						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="employeeCount">{t("settings.demo.generateEmployees.countLabel", "Number of Employees")}</Label>
								<Input
									id="employeeCount"
									type="number"
									min={1}
									max={50}
									value={employeeCount}
									onChange={(e) => setEmployeeCount(parseInt(e.target.value, 10) || 5)}
								/>
								<p className="text-xs text-muted-foreground">{t("settings.demo.generateEmployees.countHint", "Maximum 50 employees at a time")}</p>
							</div>

							<div className="space-y-2">
								<Label>{t("settings.demo.generateEmployees.options", "Options")}</Label>
								<div
									role="button"
									tabIndex={0}
									className={cn(
										"flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
										includeManagersForEmployees
											? "border-primary bg-primary/5"
											: "hover:bg-muted/50",
									)}
									onClick={() => setIncludeManagersForEmployees(!includeManagersForEmployees)}
									onKeyDown={(e) => {
										if (e.key === "Enter" || e.key === " ") {
											e.preventDefault();
											setIncludeManagersForEmployees(!includeManagersForEmployees);
										}
									}}
								>
									<Checkbox
										checked={includeManagersForEmployees}
										onCheckedChange={(v) => setIncludeManagersForEmployees(v === true)}
									/>
									<div className="space-y-1">
										<div className="text-sm font-medium">{t("settings.demo.generateEmployees.includeManagers", "Include Manager Assignments")}</div>
										<p className="text-xs text-muted-foreground">
											{t("settings.demo.generateEmployees.managersHint", "Randomly assign managers to new employees")}
										</p>
									</div>
								</div>
							</div>
						</div>

						<div className="flex justify-end">
							<Button
								onClick={handleGenerateEmployees}
								disabled={isGeneratingEmployees || employeeCount < 1}
								className="gap-2"
							>
								{isGeneratingEmployees ? (
									<>
										<IconLoader2 className="size-4 animate-spin" />
										{t("settings.demo.generateEmployees.generating", "Generating...")}
									</>
								) : (
									<>
										<IconUsers className="size-4" />
										{t("settings.demo.generateEmployees.button", `Generate ${employeeCount} Employees`, { count: employeeCount })}
									</>
								)}
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Feature Info Card */}
			<Card className="border-dashed">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-muted-foreground">
						<IconDatabase className="size-5" />
						{t("settings.demo.availableTypes.title", "Available Data Types")}
					</CardTitle>
					<CardDescription>
						{t("settings.demo.availableTypes.description", "Types of demo data you can generate")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-3 text-sm text-muted-foreground">
						<p>{t("settings.demo.availableTypes.supported", "Currently supported:")}</p>
						<ul className="list-inside list-disc space-y-1">
							<li>{t("settings.demo.availableTypes.timeEntries", "Time entries and work periods")}</li>
							<li>{t("settings.demo.availableTypes.absences", "Absences (vacation, sick leave)")}</li>
							<li>{t("settings.demo.availableTypes.teamsProjects", "Teams and projects")}</li>
							<li>{t("settings.demo.availableTypes.locations", "Locations and subareas")}</li>
							<li>{t("settings.demo.availableTypes.workCategories", "Work category sets")}</li>
							<li>{t("settings.demo.availableTypes.changePolicies", "Change policies")}</li>
							<li>{t("settings.demo.availableTypes.shifts", "Shift templates and shifts")}</li>
						</ul>
					</div>
				</CardContent>
			</Card>

			{/* Danger Zone Card */}
			<Card className="border-destructive/50 lg:col-span-2">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-destructive">
						<IconAlertTriangle className="size-5" />
						{t("settings.demo.dangerZone.title", "Danger Zone")}
					</CardTitle>
					<CardDescription>
						{t("settings.demo.dangerZone.description", "Destructive actions that cannot be undone")}
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-6 md:grid-cols-2">
						{/* Clear Time Data Section */}
						<div className="space-y-4">
							<h3 className="font-medium text-destructive">{t("settings.demo.dangerZone.clearData.title", "Clear Time Data")}</h3>

							{clearResult && (
								<div className="rounded-lg border border-green-500/50 bg-green-50 p-4 dark:bg-green-950/20">
									<p className="font-medium text-green-700 dark:text-green-400">
										{t("settings.demo.dangerZone.clearData.successTitle", "Data cleared successfully!")}
									</p>
									<ul className="mt-2 space-y-1 text-sm text-green-600 dark:text-green-500">
										<li>{t("settings.demo.dangerZone.clearData.timeEntriesDeleted", `${clearResult.timeEntriesDeleted} time entries deleted`, { count: clearResult.timeEntriesDeleted })}</li>
										<li>{t("settings.demo.dangerZone.clearData.workPeriodsDeleted", `${clearResult.workPeriodsDeleted} work periods deleted`, { count: clearResult.workPeriodsDeleted })}</li>
										<li>{t("settings.demo.dangerZone.clearData.absencesDeleted", `${clearResult.absencesDeleted} absences deleted`, { count: clearResult.absencesDeleted })}</li>
										<li>{t("settings.demo.dangerZone.clearData.vacationAllowancesReset", `${clearResult.vacationAllowancesReset} vacation allowances reset`, { count: clearResult.vacationAllowancesReset })}</li>
										<li>{t("settings.demo.dangerZone.clearData.teamsDeleted", `${clearResult.teamsDeleted} teams deleted`, { count: clearResult.teamsDeleted })}</li>
										<li>{t("settings.demo.dangerZone.clearData.projectsDeleted", `${clearResult.projectsDeleted} projects deleted`, { count: clearResult.projectsDeleted })}</li>
										<li>{t("settings.demo.dangerZone.clearData.managerAssignmentsDeleted", `${clearResult.managerAssignmentsDeleted} manager assignments deleted`, { count: clearResult.managerAssignmentsDeleted })}</li>
										{/* NEW: Display new cleanup results */}
										{clearResult.locationsDeleted > 0 && (
											<li>{t("settings.demo.dangerZone.clearData.locationsDeleted", `${clearResult.locationsDeleted} locations deleted`, { count: clearResult.locationsDeleted })}</li>
										)}
										{clearResult.subareasDeleted > 0 && (
											<li>{t("settings.demo.dangerZone.clearData.subareasDeleted", `${clearResult.subareasDeleted} subareas deleted`, { count: clearResult.subareasDeleted })}</li>
										)}
										{clearResult.workCategorySetsDeleted > 0 && (
											<li>{t("settings.demo.dangerZone.clearData.workCategorySetsDeleted", `${clearResult.workCategorySetsDeleted} work category sets deleted`, { count: clearResult.workCategorySetsDeleted })}</li>
										)}
										{clearResult.workCategoriesDeleted > 0 && (
											<li>{t("settings.demo.dangerZone.clearData.workCategoriesDeleted", `${clearResult.workCategoriesDeleted} work categories deleted`, { count: clearResult.workCategoriesDeleted })}</li>
										)}
										{clearResult.changePoliciesDeleted > 0 && (
											<li>{t("settings.demo.dangerZone.clearData.changePoliciesDeleted", `${clearResult.changePoliciesDeleted} change policies deleted`, { count: clearResult.changePoliciesDeleted })}</li>
										)}
										{clearResult.shiftTemplatesDeleted > 0 && (
											<li>{t("settings.demo.dangerZone.clearData.shiftTemplatesDeleted", `${clearResult.shiftTemplatesDeleted} shift templates deleted`, { count: clearResult.shiftTemplatesDeleted })}</li>
										)}
										{clearResult.shiftsDeleted > 0 && (
											<li>{t("settings.demo.dangerZone.clearData.shiftsDeleted", `${clearResult.shiftsDeleted} shifts deleted`, { count: clearResult.shiftsDeleted })}</li>
										)}
										{clearResult.shiftRequestsDeleted > 0 && (
											<li>{t("settings.demo.dangerZone.clearData.shiftRequestsDeleted", `${clearResult.shiftRequestsDeleted} shift requests deleted`, { count: clearResult.shiftRequestsDeleted })}</li>
										)}
									</ul>
								</div>
							)}

							<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
								<p className="text-sm text-muted-foreground">{t("settings.demo.dangerZone.clearData.willDelete", "This will permanently delete:")}</p>
								<ul className="mt-2 list-inside list-disc space-y-1 text-sm">
									<li>{t("settings.demo.dangerZone.clearData.items.timeEntries", "All time entries and work periods")}</li>
									<li>{t("settings.demo.dangerZone.clearData.items.absences", "All absence entries")}</li>
									<li>{t("settings.demo.dangerZone.clearData.items.vacationAllowances", "All vacation allowances")}</li>
									<li>{t("settings.demo.dangerZone.clearData.items.teamsProjects", "All teams and projects")}</li>
									<li>{t("settings.demo.dangerZone.clearData.items.locations", "All locations and subareas")}</li>
									<li>{t("settings.demo.dangerZone.clearData.items.workCategories", "All work categories")}</li>
									<li>{t("settings.demo.dangerZone.clearData.items.changePolicies", "All change policies")}</li>
									<li>{t("settings.demo.dangerZone.clearData.items.shifts", "All shift templates and shifts")}</li>
								</ul>
							</div>

							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="destructive" className="gap-2">
										<IconTrash className="size-4" />
										{t("settings.demo.dangerZone.clearData.button", "Clear All Data")}
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>{t("settings.demo.dangerZone.clearData.dialog.title", "Clear All Time Data?")}</AlertDialogTitle>
										<AlertDialogDescription>
											{t("settings.demo.dangerZone.clearData.dialog.description", "This action cannot be undone. All time entries, absences, teams, projects, and related data will be permanently deleted.")}
										</AlertDialogDescription>
									</AlertDialogHeader>
									<div className="py-4">
										<Label htmlFor="confirm">
											{t("settings.demo.dangerZone.typeDelete", "Type DELETE to confirm")}
										</Label>
										<Input
											id="confirm"
											value={confirmText}
											onChange={(e) => setConfirmText(e.target.value)}
											placeholder={t("settings.demo.dangerZone.typeDeletePlaceholder", "DELETE")}
											className="mt-2"
										/>
									</div>
									<AlertDialogFooter>
										<AlertDialogCancel onClick={() => setConfirmText("")}>{t("common.cancel", "Cancel")}</AlertDialogCancel>
										<AlertDialogAction
											onClick={handleClear}
											disabled={confirmText !== "DELETE" || isClearing}
											className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
										>
											{isClearing ? (
												<>
													<IconLoader2 className="mr-2 size-4 animate-spin" />
													{t("settings.demo.dangerZone.clearing", "Clearing...")}
												</>
											) : (
												t("settings.demo.dangerZone.clearData.dialog.confirm", "Clear All Data")
											)}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</div>

						{/* Delete Non-Admin Employees Section */}
						<div className="space-y-4">
							<h3 className="font-medium text-destructive">{t("settings.demo.dangerZone.deleteNonAdmin.title", "Delete Non-Admin Employees")}</h3>

							{deleteNonAdminResult && (
								<div className="rounded-lg border border-green-500/50 bg-green-50 p-4 dark:bg-green-950/20">
									<p className="font-medium text-green-700 dark:text-green-400">
										{t("settings.demo.dangerZone.deleteNonAdmin.successTitle", "Non-admin employees deleted successfully!")}
									</p>
									<ul className="mt-2 space-y-1 text-sm text-green-600 dark:text-green-500">
										<li>{t("settings.demo.dangerZone.deleteNonAdmin.employeesDeleted", `${deleteNonAdminResult.employeesDeleted} employees deleted`, { count: deleteNonAdminResult.employeesDeleted })}</li>
										<li>{t("settings.demo.dangerZone.deleteNonAdmin.usersDeleted", `${deleteNonAdminResult.usersDeleted} users deleted`, { count: deleteNonAdminResult.usersDeleted })}</li>
										<li>{t("settings.demo.dangerZone.deleteNonAdmin.membersDeleted", `${deleteNonAdminResult.membersDeleted} members deleted`, { count: deleteNonAdminResult.membersDeleted })}</li>
										<li>{t("settings.demo.dangerZone.deleteNonAdmin.timeEntriesDeleted", `${deleteNonAdminResult.timeEntriesDeleted} time entries deleted`, { count: deleteNonAdminResult.timeEntriesDeleted })}</li>
										<li>{t("settings.demo.dangerZone.deleteNonAdmin.absencesDeleted", `${deleteNonAdminResult.absencesDeleted} absences deleted`, { count: deleteNonAdminResult.absencesDeleted })}</li>
									</ul>
								</div>
							)}

							<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
								<p className="text-sm text-muted-foreground">{t("settings.demo.dangerZone.deleteNonAdmin.willDelete", "This will permanently delete:")}</p>
								<ul className="mt-2 list-inside list-disc space-y-1 text-sm">
									<li>{t("settings.demo.dangerZone.deleteNonAdmin.items.employees", "All non-admin employees")}</li>
									<li>{t("settings.demo.dangerZone.deleteNonAdmin.items.demoUsers", "All demo user accounts")}</li>
									<li>{t("settings.demo.dangerZone.deleteNonAdmin.items.timeEntries", "Their time entries and work periods")}</li>
									<li>{t("settings.demo.dangerZone.deleteNonAdmin.items.managerAssignments", "All manager assignments")}</li>
								</ul>
								<p className="mt-2 text-xs text-muted-foreground">
									{t("settings.demo.dangerZone.deleteNonAdmin.adminPreserved", "Admin accounts will be preserved")}
								</p>
							</div>

							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="destructive" className="gap-2">
										<IconUsers className="size-4" />
										{t("settings.demo.dangerZone.deleteNonAdmin.button", "Delete Non-Admin Employees")}
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>{t("settings.demo.dangerZone.deleteNonAdmin.dialog.title", "Delete Non-Admin Employees?")}</AlertDialogTitle>
										<AlertDialogDescription>
											{t("settings.demo.dangerZone.deleteNonAdmin.dialog.description", "This action cannot be undone. All non-admin employees and their associated data will be permanently deleted.")}
										</AlertDialogDescription>
									</AlertDialogHeader>
									<div className="py-4">
										<Label htmlFor="confirmNonAdmin">
											{t("settings.demo.dangerZone.typeDelete", "Type DELETE to confirm")}
										</Label>
										<Input
											id="confirmNonAdmin"
											value={deleteNonAdminConfirmText}
											onChange={(e) => setDeleteNonAdminConfirmText(e.target.value)}
											placeholder={t("settings.demo.dangerZone.typeDeletePlaceholder", "DELETE")}
											className="mt-2"
										/>
									</div>
									<AlertDialogFooter>
										<AlertDialogCancel onClick={() => setDeleteNonAdminConfirmText("")}>
											{t("common.cancel", "Cancel")}
										</AlertDialogCancel>
										<AlertDialogAction
											onClick={handleDeleteNonAdmin}
											disabled={deleteNonAdminConfirmText !== "DELETE" || isDeletingNonAdmin}
											className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
										>
											{isDeletingNonAdmin ? (
												<>
													<IconLoader2 className="mr-2 size-4 animate-spin" />
													{t("settings.demo.dangerZone.deleting", "Deleting...")}
												</>
											) : (
												t("settings.demo.dangerZone.deleteNonAdmin.dialog.confirm", "Delete Non-Admin Employees")
											)}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</div>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

function StepIndicator({
	step,
	label,
	active,
	completed,
}: {
	step: number;
	label: string;
	active: boolean;
	completed: boolean;
}) {
	return (
		<div className="flex flex-col items-center gap-1">
			<div
				className={cn(
					"flex size-8 items-center justify-center rounded-full text-sm font-medium transition-colors",
					completed
						? "bg-primary text-primary-foreground"
						: active
							? "border-2 border-primary bg-background text-primary"
							: "border-2 border-muted bg-background text-muted-foreground",
				)}
			>
				{completed ? <IconCheck className="size-4" /> : step}
			</div>
			<span
				className={cn(
					"text-xs",
					active || completed ? "font-medium text-foreground" : "text-muted-foreground",
				)}
			>
				{label}
			</span>
		</div>
	);
}

function GenerationStepItem({ step }: { step: GenerationStep }) {
	return (
		<div
			className={cn(
				"flex items-center gap-3 rounded-lg border p-3 transition-colors",
				step.status === "complete" && "border-green-500/50 bg-green-50/50 dark:bg-green-950/20",
				step.status === "error" && "border-destructive/50 bg-destructive/10",
				step.status === "in-progress" && "border-primary/50 bg-primary/5",
			)}
		>
			{/* Status indicator */}
			<div className="flex size-6 items-center justify-center">
				{step.status === "pending" && <IconCircle className="size-5 text-muted-foreground/50" />}
				{step.status === "in-progress" && (
					<IconLoader2 className="size-5 animate-spin text-primary" />
				)}
				{step.status === "complete" && (
					<div className="flex size-5 items-center justify-center rounded-full bg-green-500 text-white">
						<IconCheck className="size-3" />
					</div>
				)}
				{step.status === "error" && (
					<div className="flex size-5 items-center justify-center rounded-full bg-destructive text-white">
						<IconX className="size-3" />
					</div>
				)}
			</div>

			{/* Content */}
			<div className="flex-1 min-w-0">
				<div className="flex items-center gap-2">
					{step.icon}
					<span
						className={cn(
							"font-medium",
							step.status === "pending" && "text-muted-foreground",
							step.status === "complete" && "text-green-700 dark:text-green-400",
							step.status === "error" && "text-destructive",
						)}
					>
						{step.label}
					</span>
				</div>
				{step.status === "in-progress" && (
					<p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
				)}
				{step.status === "complete" && step.result && (
					<p className="text-xs text-green-600 dark:text-green-500 mt-0.5">{step.result}</p>
				)}
				{step.status === "error" && step.error && (
					<p className="text-xs text-destructive mt-0.5">{step.error}</p>
				)}
			</div>
		</div>
	);
}
