"use client";

import {
	IconAlertTriangle,
	IconBriefcase,
	IconCheck,
	IconCircle,
	IconClock,
	IconDatabase,
	IconLoader2,
	IconPlayerPlay,
	IconTrash,
	IconUserCheck,
	IconUsers,
	IconUsersGroup,
	IconX,
} from "@tabler/icons-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
	clearTimeDataAction,
	deleteNonAdminDataAction,
	generateAbsencesStepAction,
	generateDemoEmployeesAction,
	generateManagersStepAction,
	generateProjectsStepAction,
	generateTeamsStepAction,
	generateTimeEntriesStepAction,
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
			setError("No organization selected");
			return;
		}
		setError(null);
		setResult(null);

		// Build steps based on selected options
		const activeSteps: GenerationStep[] = [];

		if (includeTeams) {
			activeSteps.push({
				id: "teams",
				label: "Teams",
				description: "Creating teams and assigning employees",
				icon: <IconUsersGroup className="size-4" />,
				status: "pending",
			});
		}

		if (includeProjects) {
			activeSteps.push({
				id: "projects",
				label: "Projects",
				description: "Creating demo projects",
				icon: <IconBriefcase className="size-4" />,
				status: "pending",
			});
		}

		// Manager assignments are always created if we have employees
		activeSteps.push({
			id: "managers",
			label: "Manager Assignments",
			description: "Assigning employees to managers",
			icon: <IconUserCheck className="size-4" />,
			status: "pending",
		});

		if (includeTimeEntries) {
			activeSteps.push({
				id: "time-entries",
				label: "Time Entries",
				description: "Creating time entries with blockchain hashes",
				icon: <IconClock className="size-4" />,
				status: "pending",
			});
		}

		if (includeAbsences) {
			activeSteps.push({
				id: "absences",
				label: "Absences",
				description: "Creating absence records",
				icon: <IconUsers className="size-4" />,
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
		};

		const finalResult: DemoDataResult = {
			timeEntriesCreated: 0,
			workPeriodsCreated: 0,
			absencesCreated: 0,
			teamsCreated: 0,
			employeesAssignedToTeams: 0,
			projectsCreated: 0,
			managerAssignmentsCreated: 0,
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

		setIsGenerating(false);

		if (!hasError) {
			setResult(finalResult);
			setWizardStep("complete");
		} else {
			setError("Generation failed. See step details above.");
		}
	};

	const handleClear = async () => {
		if (!organizationId) {
			setError("No organization selected");
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
			setEmployeeError("No organization selected");
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
			setError("No organization selected");
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
						Generate Demo Data
					</CardTitle>
					<CardDescription>
						Create realistic sample data including time entries with breaks and absence records
					</CardDescription>
				</CardHeader>
				<CardContent>
					{wizardStep === "configure" && (
						<div className="space-y-6">
							{/* Step indicators */}
							<div className="flex items-center gap-4">
								<StepIndicator step={1} label="Configure" active={true} completed={false} />
								<div className="h-px flex-1 bg-border" />
								<StepIndicator step={2} label="Generate" active={false} completed={false} />
								<div className="h-px flex-1 bg-border" />
								<StepIndicator step={3} label="Complete" active={false} completed={false} />
							</div>

							{error && (
								<div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
									{error}
								</div>
							)}

							{/* Configuration Form */}
							<div className="grid gap-6 md:grid-cols-2">
								<div className="space-y-2">
									<Label htmlFor="dateRange">Date Range</Label>
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
											<SelectItem value="last30">Last 30 days</SelectItem>
											<SelectItem value="last60">Last 60 days</SelectItem>
											<SelectItem value="last90">Last 90 days</SelectItem>
											<SelectItem value="thisYear">This year</SelectItem>
										</SelectContent>
									</Select>
									<p className="text-xs text-muted-foreground">
										Time entries will be generated for weekdays within this range
									</p>
								</div>

								<div className="space-y-2">
									<Label htmlFor="employees">Employees</Label>
									<Select
										value={selectedEmployees}
										onValueChange={(v) => setSelectedEmployees(v as "all" | "selected")}
									>
										<SelectTrigger id="employees">
											<SelectValue />
										</SelectTrigger>
										<SelectContent>
											<SelectItem value="all">All employees ({employees.length})</SelectItem>
											<SelectItem value="selected" disabled>
												Select specific (coming soon)
											</SelectItem>
										</SelectContent>
									</Select>
								</div>
							</div>

							<div className="space-y-4">
								<Label>Data Types</Label>
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
												Time Entries
											</div>
											<p className="text-xs text-muted-foreground">
												Clock-in/out records with realistic breaks (morning session, lunch break,
												afternoon session)
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
												Absences
											</div>
											<p className="text-xs text-muted-foreground">
												Vacation requests, sick days, and personal time off with various approval
												statuses
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
												Teams
											</div>
											<p className="text-xs text-muted-foreground">
												Create department teams and randomly assign employees to them
											</p>
											{includeTeams && (
												<div className="mt-2 flex items-center gap-2">
													<Label htmlFor="teamCount" className="text-xs whitespace-nowrap">
														Number of teams:
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
												Projects
											</div>
											<p className="text-xs text-muted-foreground">
												Create demo projects with various statuses, budgets, and deadlines
											</p>
											{includeProjects && (
												<div className="mt-2 flex items-center gap-2">
													<Label htmlFor="projectCount" className="text-xs whitespace-nowrap">
														Number of projects:
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
								</div>
							</div>

							<div className="flex justify-end">
								<Button
									onClick={handleGenerate}
									disabled={
										!includeTimeEntries && !includeAbsences && !includeTeams && !includeProjects
									}
									className="gap-2"
								>
									<IconPlayerPlay className="size-4" />
									Generate Demo Data
								</Button>
							</div>
						</div>
					)}

					{wizardStep === "generating" && (
						<div className="space-y-6">
							{/* Step indicators */}
							<div className="flex items-center gap-4">
								<StepIndicator step={1} label="Configure" active={false} completed={true} />
								<div className="h-px flex-1 bg-primary" />
								<StepIndicator step={2} label="Generate" active={true} completed={false} />
								<div className="h-px flex-1 bg-border" />
								<StepIndicator step={3} label="Complete" active={false} completed={false} />
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
										Back to Configuration
									</Button>
								</div>
							)}
						</div>
					)}

					{wizardStep === "complete" && result && (
						<div className="space-y-6">
							{/* Step indicators */}
							<div className="flex items-center gap-4">
								<StepIndicator step={1} label="Configure" active={false} completed={true} />
								<div className="h-px flex-1 bg-primary" />
								<StepIndicator step={2} label="Generate" active={false} completed={true} />
								<div className="h-px flex-1 bg-primary" />
								<StepIndicator step={3} label="Complete" active={true} completed={true} />
							</div>

							<div className="space-y-6 py-4">
								<div className="flex items-center justify-center gap-3 text-green-600">
									<div className="flex size-12 items-center justify-center rounded-full bg-green-100">
										<IconCheck className="size-6" />
									</div>
								</div>
								<p className="text-center text-lg font-medium">Demo data generated successfully!</p>

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
										Generate More Data
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
						Generate Demo Employees
					</CardTitle>
					<CardDescription>
						Create fake employee accounts for testing. These accounts cannot log in.
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
									Employees generated successfully!
								</p>
								<ul className="mt-2 space-y-1 text-sm text-green-600 dark:text-green-500">
									<li>{employeeResult.usersCreated} user accounts created</li>
									<li>{employeeResult.employeesCreated} employees created</li>
									<li>{employeeResult.managersCreated} managers created</li>
								</ul>
							</div>
						)}

						<div className="grid gap-4 md:grid-cols-2">
							<div className="space-y-2">
								<Label htmlFor="employeeCount">Number of Employees</Label>
								<Input
									id="employeeCount"
									type="number"
									min={1}
									max={50}
									value={employeeCount}
									onChange={(e) => setEmployeeCount(parseInt(e.target.value, 10) || 5)}
								/>
								<p className="text-xs text-muted-foreground">Maximum 50 employees per batch</p>
							</div>

							<div className="space-y-2">
								<Label>Options</Label>
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
										<div className="text-sm font-medium">Include Managers</div>
										<p className="text-xs text-muted-foreground">
											20% will be assigned manager role
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
										Generating...
									</>
								) : (
									<>
										<IconUsers className="size-4" />
										Generate {employeeCount} Employee{employeeCount !== 1 ? "s" : ""}
									</>
								)}
							</Button>
						</div>
					</div>
				</CardContent>
			</Card>

			{/* Coming Soon Card */}
			<Card className="border-dashed">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-muted-foreground">
						<IconDatabase className="size-5" />
						More Data Coming Soon
					</CardTitle>
					<CardDescription>
						Additional demo data generators will be available in future updates
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="space-y-3 text-sm text-muted-foreground">
						<p>Planned generators:</p>
						<ul className="list-inside list-disc space-y-1">
							<li>Shift schedules</li>
							<li>Holiday calendars</li>
							<li>Overtime records</li>
						</ul>
					</div>
				</CardContent>
			</Card>

			{/* Danger Zone Card */}
			<Card className="border-destructive/50 lg:col-span-2">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 text-destructive">
						<IconAlertTriangle className="size-5" />
						Danger Zone
					</CardTitle>
					<CardDescription>
						Permanently delete all time-related data for this organization
					</CardDescription>
				</CardHeader>
				<CardContent>
					<div className="grid gap-6 md:grid-cols-2">
						{/* Clear Time Data Section */}
						<div className="space-y-4">
							<h3 className="font-medium text-destructive">Clear Time Data</h3>

							{clearResult && (
								<div className="rounded-lg border border-green-500/50 bg-green-50 p-4 dark:bg-green-950/20">
									<p className="font-medium text-green-700 dark:text-green-400">
										Data cleared successfully!
									</p>
									<ul className="mt-2 space-y-1 text-sm text-green-600 dark:text-green-500">
										<li>{clearResult.timeEntriesDeleted} time entries deleted</li>
										<li>{clearResult.workPeriodsDeleted} work periods deleted</li>
										<li>{clearResult.absencesDeleted} absences deleted</li>
										<li>{clearResult.vacationAllowancesReset} vacation allowances reset</li>
										<li>{clearResult.teamsDeleted} demo teams deleted</li>
										<li>{clearResult.projectsDeleted} demo projects deleted</li>
										<li>{clearResult.managerAssignmentsDeleted} manager assignments deleted</li>
									</ul>
								</div>
							)}

							<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
								<p className="text-sm text-muted-foreground">This will permanently delete:</p>
								<ul className="mt-2 list-inside list-disc space-y-1 text-sm">
									<li>All time entries and work periods</li>
									<li>All absence entries</li>
									<li>Vacation allowance overrides</li>
									<li>Demo teams, projects, and manager assignments</li>
								</ul>
							</div>

							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="destructive" className="gap-2">
										<IconTrash className="size-4" />
										Clear All Time Data
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
										<AlertDialogDescription>
											This action cannot be undone. This will permanently delete all time-related
											data for this organization.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<div className="py-4">
										<Label htmlFor="confirm">
											Type <span className="font-mono font-bold">DELETE</span> to confirm
										</Label>
										<Input
											id="confirm"
											value={confirmText}
											onChange={(e) => setConfirmText(e.target.value)}
											placeholder="Type DELETE"
											className="mt-2"
										/>
									</div>
									<AlertDialogFooter>
										<AlertDialogCancel onClick={() => setConfirmText("")}>Cancel</AlertDialogCancel>
										<AlertDialogAction
											onClick={handleClear}
											disabled={confirmText !== "DELETE" || isClearing}
											className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
										>
											{isClearing ? (
												<>
													<IconLoader2 className="mr-2 size-4 animate-spin" />
													Clearing...
												</>
											) : (
												"Clear All Data"
											)}
										</AlertDialogAction>
									</AlertDialogFooter>
								</AlertDialogContent>
							</AlertDialog>
						</div>

						{/* Delete Non-Admin Employees Section */}
						<div className="space-y-4">
							<h3 className="font-medium text-destructive">Delete Non-Admin Employees</h3>

							{deleteNonAdminResult && (
								<div className="rounded-lg border border-green-500/50 bg-green-50 p-4 dark:bg-green-950/20">
									<p className="font-medium text-green-700 dark:text-green-400">
										Non-admin data deleted successfully!
									</p>
									<ul className="mt-2 space-y-1 text-sm text-green-600 dark:text-green-500">
										<li>{deleteNonAdminResult.employeesDeleted} employees deleted</li>
										<li>{deleteNonAdminResult.usersDeleted} user accounts deleted</li>
										<li>{deleteNonAdminResult.membersDeleted} memberships deleted</li>
										<li>{deleteNonAdminResult.timeEntriesDeleted} time entries deleted</li>
										<li>{deleteNonAdminResult.absencesDeleted} absences deleted</li>
									</ul>
								</div>
							)}

							<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
								<p className="text-sm text-muted-foreground">This will permanently delete:</p>
								<ul className="mt-2 list-inside list-disc space-y-1 text-sm">
									<li>All non-admin employee records</li>
									<li>Demo user accounts only</li>
									<li>All their time entries and absences</li>
									<li>All manager assignments</li>
								</ul>
								<p className="mt-2 text-xs text-muted-foreground">
									Admin users are always preserved.
								</p>
							</div>

							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="destructive" className="gap-2">
										<IconUsers className="size-4" />
										Delete Non-Admin Employees
									</Button>
								</AlertDialogTrigger>
								<AlertDialogContent>
									<AlertDialogHeader>
										<AlertDialogTitle>Delete All Non-Admin Employees?</AlertDialogTitle>
										<AlertDialogDescription>
											This action cannot be undone. This will permanently delete all non-admin
											employees and their associated data. Admin users and your account will be
											preserved.
										</AlertDialogDescription>
									</AlertDialogHeader>
									<div className="py-4">
										<Label htmlFor="confirmNonAdmin">
											Type <span className="font-mono font-bold">DELETE</span> to confirm
										</Label>
										<Input
											id="confirmNonAdmin"
											value={deleteNonAdminConfirmText}
											onChange={(e) => setDeleteNonAdminConfirmText(e.target.value)}
											placeholder="Type DELETE"
											className="mt-2"
										/>
									</div>
									<AlertDialogFooter>
										<AlertDialogCancel onClick={() => setDeleteNonAdminConfirmText("")}>
											Cancel
										</AlertDialogCancel>
										<AlertDialogAction
											onClick={handleDeleteNonAdmin}
											disabled={deleteNonAdminConfirmText !== "DELETE" || isDeletingNonAdmin}
											className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
										>
											{isDeletingNonAdmin ? (
												<>
													<IconLoader2 className="mr-2 size-4 animate-spin" />
													Deleting...
												</>
											) : (
												"Delete Non-Admin Employees"
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
