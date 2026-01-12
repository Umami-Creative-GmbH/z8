"use client";

import {
	IconAlertTriangle,
	IconCheck,
	IconClock,
	IconDatabase,
	IconLoader2,
	IconPlayerPlay,
	IconSettings,
	IconTrash,
	IconUsers,
} from "@tabler/icons-react";
import { useState, useTransition } from "react";
import {
	clearTimeDataAction,
	deleteNonAdminDataAction,
	generateDemoDataAction,
	generateDemoEmployeesAction,
} from "@/app/[locale]/(app)/settings/demo/actions";
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
import { Progress } from "../ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

interface DemoDataWizardProps {
	organizationId: string;
	employees: Array<{ id: string; name: string }>;
}

type WizardStep = "configure" | "generating" | "complete";
type GenerationPhase = "initializing" | "time-entries" | "work-periods" | "absences" | "complete";

const PHASE_MESSAGES: Record<GenerationPhase, string> = {
	initializing: "Initializing...",
	"time-entries": "Creating time entries with blockchain hashes...",
	"work-periods": "Generating work periods...",
	absences: "Creating absence records...",
	complete: "Generation complete!",
};

const PHASE_PROGRESS: Record<GenerationPhase, number> = {
	initializing: 10,
	"time-entries": 40,
	"work-periods": 70,
	absences: 90,
	complete: 100,
};

export function DemoDataWizard({ organizationId, employees }: DemoDataWizardProps) {
	const [step, setStep] = useState<WizardStep>("configure");
	const [phase, setPhase] = useState<GenerationPhase>("initializing");
	const [_isPending, startTransition] = useTransition();
	const [isClearing, startClearTransition] = useTransition();

	// Form state
	const [dateRangeType, setDateRangeType] = useState<"last30" | "last60" | "last90" | "thisYear">(
		"last30",
	);
	const [includeTimeEntries, setIncludeTimeEntries] = useState(true);
	const [includeAbsences, setIncludeAbsences] = useState(true);
	const [selectedEmployees, setSelectedEmployees] = useState<"all" | "selected">("all");

	// Results
	const [result, setResult] = useState<DemoDataResult | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [clearResult, setClearResult] = useState<ClearDataResult | null>(null);
	const [confirmText, setConfirmText] = useState("");

	// Employee generation state
	const [employeeCount, setEmployeeCount] = useState(5);
	const [includeManagersForEmployees, setIncludeManagersForEmployees] = useState(true);
	const [isGeneratingEmployees, startEmployeeTransition] = useTransition();
	const [employeeResult, setEmployeeResult] = useState<GenerateEmployeesResult | null>(null);
	const [employeeError, setEmployeeError] = useState<string | null>(null);

	// Delete non-admin state
	const [isDeletingNonAdmin, startDeleteNonAdminTransition] = useTransition();
	const [deleteNonAdminResult, setDeleteNonAdminResult] = useState<DeleteNonAdminResult | null>(
		null,
	);
	const [deleteNonAdminConfirmText, setDeleteNonAdminConfirmText] = useState("");

	const handleGenerate = () => {
		setStep("generating");
		setPhase("initializing");
		setError(null);

		startTransition(async () => {
			// Simulate phases for visual feedback
			await new Promise((r) => setTimeout(r, 500));
			setPhase("time-entries");

			await new Promise((r) => setTimeout(r, 300));
			setPhase("work-periods");

			await new Promise((r) => setTimeout(r, 200));
			setPhase("absences");

			// Actually generate the data
			const response = await generateDemoDataAction({
				organizationId,
				dateRangeType,
				includeTimeEntries,
				includeAbsences,
				employeeIds: selectedEmployees === "all" ? undefined : [],
			});

			if (!response.success) {
				setError(response.error);
				setStep("configure");
			} else {
				setResult(response.data);
				setPhase("complete");
				setStep("complete");
			}
		});
	};

	const handleClear = () => {
		startClearTransition(async () => {
			const response = await clearTimeDataAction(organizationId);
			if (!response.success) {
				setError(response.error);
			} else {
				setClearResult(response.data);
			}
			setConfirmText("");
		});
	};

	const handleReset = () => {
		setStep("configure");
		setPhase("initializing");
		setResult(null);
		setError(null);
	};

	const handleGenerateEmployees = () => {
		setEmployeeError(null);
		setEmployeeResult(null);

		startEmployeeTransition(async () => {
			const response = await generateDemoEmployeesAction({
				organizationId,
				count: employeeCount,
				includeManagers: includeManagersForEmployees,
			});

			if (!response.success) {
				setEmployeeError(response.error);
			} else {
				setEmployeeResult(response.data);
			}
		});
	};

	const handleDeleteNonAdmin = () => {
		startDeleteNonAdminTransition(async () => {
			const response = await deleteNonAdminDataAction(organizationId);
			if (!response.success) {
				setError(response.error);
			} else {
				setDeleteNonAdminResult(response.data);
			}
			setDeleteNonAdminConfirmText("");
		});
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
					{step === "configure" && (
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
								</div>
							</div>

							<div className="flex justify-end">
								<Button
									onClick={handleGenerate}
									disabled={!includeTimeEntries && !includeAbsences}
									className="gap-2"
								>
									<IconPlayerPlay className="size-4" />
									Generate Demo Data
								</Button>
							</div>
						</div>
					)}

					{step === "generating" && (
						<div className="space-y-6">
							{/* Step indicators */}
							<div className="flex items-center gap-4">
								<StepIndicator step={1} label="Configure" active={false} completed={true} />
								<div className="h-px flex-1 bg-primary" />
								<StepIndicator step={2} label="Generate" active={true} completed={false} />
								<div className="h-px flex-1 bg-border" />
								<StepIndicator step={3} label="Complete" active={false} completed={false} />
							</div>

							<div className="space-y-4 py-8">
								<div className="flex items-center justify-center gap-3">
									<IconLoader2 className="size-8 animate-spin text-primary" />
									<span className="text-lg font-medium">{PHASE_MESSAGES[phase]}</span>
								</div>

								<Progress value={PHASE_PROGRESS[phase]} className="h-2" />

								<div className="grid grid-cols-4 gap-2 text-center text-xs text-muted-foreground">
									<div className={cn(phase === "initializing" && "font-medium text-primary")}>
										Initializing
									</div>
									<div className={cn(phase === "time-entries" && "font-medium text-primary")}>
										Time Entries
									</div>
									<div className={cn(phase === "work-periods" && "font-medium text-primary")}>
										Work Periods
									</div>
									<div className={cn(phase === "absences" && "font-medium text-primary")}>
										Absences
									</div>
								</div>
							</div>
						</div>
					)}

					{step === "complete" && result && (
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

								<div className="grid gap-4 md:grid-cols-3">
									<ResultCard
										icon={<IconClock className="size-5" />}
										label="Time Entries"
										value={result.timeEntriesCreated}
									/>
									<ResultCard
										icon={<IconSettings className="size-5" />}
										label="Work Periods"
										value={result.workPeriodsCreated}
									/>
									<ResultCard
										icon={<IconUsers className="size-5" />}
										label="Absences"
										value={result.absencesCreated}
									/>
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
							<li>Project assignments</li>
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
					<div className="space-y-4">
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
								</ul>
							</div>
						)}

						<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
							<p className="text-sm text-muted-foreground">This action will permanently delete:</p>
							<ul className="mt-2 list-inside list-disc space-y-1 text-sm">
								<li>All time entries (clock-in/out records)</li>
								<li>All work periods</li>
								<li>All absence entries (vacation, sick, personal)</li>
								<li>All employee vacation allowance overrides (reset to org defaults)</li>
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
										This action cannot be undone. This will permanently delete all time-related data
										for this organization.
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

						{/* Divider */}
						<div className="my-6 border-t border-destructive/30" />

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
										<li>{deleteNonAdminResult.workPeriodsDeleted} work periods deleted</li>
										<li>{deleteNonAdminResult.absencesDeleted} absences deleted</li>
									</ul>
								</div>
							)}

							<div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
								<p className="text-sm text-muted-foreground">
									This action will permanently delete all non-admin employees and their data:
								</p>
								<ul className="mt-2 list-inside list-disc space-y-1 text-sm">
									<li>All non-admin employee records</li>
									<li>All associated user accounts (demo accounts only)</li>
									<li>All time entries and work periods</li>
									<li>All absence entries</li>
									<li>All manager assignments</li>
								</ul>
								<p className="mt-2 text-xs text-muted-foreground">
									Admin users and the current user are always preserved.
								</p>
							</div>

							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="destructive" className="gap-2">
										<IconUsers className="size-4" />
										Delete All Non-Admin Employees
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

function ResultCard({
	icon,
	label,
	value,
}: {
	icon: React.ReactNode;
	label: string;
	value: number;
}) {
	return (
		<div className="rounded-lg border bg-muted/30 p-4 text-center">
			<div className="mb-2 flex justify-center text-muted-foreground">{icon}</div>
			<p className="text-2xl font-bold">{value.toLocaleString()}</p>
			<p className="text-sm text-muted-foreground">{label}</p>
		</div>
	);
}
