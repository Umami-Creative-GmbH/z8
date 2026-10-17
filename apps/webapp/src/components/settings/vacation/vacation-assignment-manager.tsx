"use client";

import {
	IconAlertTriangle,
	IconBuilding,
	IconCalendarDollar,
	IconCalendarX,
	IconChevronRight,
	IconLoader2,
	IconPlus,
	IconStar,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { Temporal } from "temporal-polyfill";
import {
	deleteVacationPolicyAssignment,
	getCompanyDefaultPolicies,
	getVacationPolicyAssignments,
} from "@/app/[locale]/(app)/settings/vacation/assignment-actions";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import { queryKeys } from "@/lib/query/keys";
import { getVacationAssignmentSectionVisibility } from "../policy-assignment-surface";
import { useVacationPolicyHistoryContext } from "./use-vacation-policy-history-context";
import type { VacationAssignmentType } from "./vacation-assignment-dialog";
import { VacationPolicyPreview } from "./vacation-policy-preview";

interface VacationAssignmentManagerProps {
	organizationId: string;
	allowedAssignmentTypes: readonly ("team" | "employee")[];
	onAssignClick: (type: VacationAssignmentType, targetId?: string) => void;
}

interface PolicyData {
	id: string;
	name: string;
	startDate: string;
	validUntil: string | null;
	isCompanyDefault: boolean;
	defaultAnnualDays: string;
	accrualType: string;
	allowCarryover: boolean;
	maxCarryoverDays: string | null;
}

interface VacationPolicyAssignmentData {
	id: string;
	policyId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	priority: number;
	effectiveFrom: Date | null;
	effectiveStartDate: string | null;
	effectiveEndDate: string | null;
	effectiveUntil: Date | null;
	isActive: boolean;
	createdAt: Date;
	policy: PolicyData;
	team: {
		id: string;
		name: string;
	} | null;
	employee: {
		id: string;
		firstName: string | null;
		lastName: string | null;
	} | null;
}

interface CompanyDefaultPolicies {
	current: PolicyData | null;
	next: PolicyData | null;
}

// Helper to format policy summary
const formatPolicySummary = (
	policy: PolicyData,
	t: ReturnType<typeof useTranslate>["t"],
) => {
	const parts = [
		`${policy.defaultAnnualDays} ${t("settings.vacation.days", "days")}`,
	];
	if (policy.allowCarryover) {
		parts.push(t("settings.vacation.carryover", "Carryover"));
	}
	return parts.join(", ");
};

// eslint-disable-next-line react-doctor/no-giant-component
export function VacationAssignmentManager({
	organizationId,
	allowedAssignmentTypes,
	onAssignClick,
}: VacationAssignmentManagerProps) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const formatDate = (date: string) =>
		Temporal.PlainDate.from(date).toLocaleString(locale, {
			year: "numeric",
			month: "short",
			day: "numeric",
		});
	const queryClient = useQueryClient();
	const historyContext = useVacationPolicyHistoryContext(organizationId);
	const [endDialogOpen, setEndDialogOpen] = useState(false);
	const [selectedAssignment, setSelectedAssignment] =
		useState<VacationPolicyAssignmentData | null>(null);

	// Fetch company default policies (current and next)
	const { data: companyDefaults, isLoading: defaultsLoading } = useQuery({
		queryKey: queryKeys.vacationPolicies.companyDefault(organizationId),
		queryFn: async () => {
			const result = await getCompanyDefaultPolicies(organizationId);
			if (!result.success) {
				throw new Error(
					result.error || "Failed to fetch company default policies",
				);
			}
			return result.data as CompanyDefaultPolicies;
		},
	});

	// Fetch policy assignments (for teams and employees)
	const {
		data: assignments,
		isLoading: assignmentsLoading,
		error,
	} = useQuery({
		queryKey: queryKeys.vacationPolicyAssignments.list(organizationId),
		queryFn: async () => {
			const result = await getVacationPolicyAssignments(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch assignments");
			}
			return result.data as VacationPolicyAssignmentData[];
		},
	});

	// Delete assignment mutation
	const endMutation = useMutation({
		mutationFn: ({ id, effectiveOn }: { id: string; effectiveOn: string }) =>
			deleteVacationPolicyAssignment(id, effectiveOn),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t(
						"settings.vacation.history.ended",
						"Policy assignment end date saved",
					),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.vacationPolicyAssignments.list(organizationId),
				});
				setEndDialogOpen(false);
				setSelectedAssignment(null);
			} else {
				toast.error(
					result.error ||
						t(
							"settings.vacation.history.endFailed",
							"Failed to end policy assignment",
						),
				);
			}
		},
		onError: () => {
			toast.error(
				t(
					"settings.vacation.history.endFailed",
					"Failed to end policy assignment",
				),
			);
		},
	});

	const endForm = useForm({
		defaultValues: { effectiveOn: "" },
		onSubmit: async ({ value }) => {
			if (selectedAssignment && historyContext.data)
				endMutation.mutate({
					id: selectedAssignment.id,
					effectiveOn:
						value.effectiveOn || minimumEndDate || historyContext.data.today,
				});
		},
	});
	const handleEndClick = (assignment: VacationPolicyAssignmentData) => {
		endForm.reset();
		setSelectedAssignment(assignment);
		setEndDialogOpen(true);
	};
	const selectedStart = selectedAssignment?.effectiveStartDate;
	const firstEndDate = selectedStart
		? Temporal.PlainDate.from(selectedStart).add({ days: 1 }).toString()
		: "2026-01-01";
	const minimumEndDate =
		historyContext.data &&
		firstEndDate &&
		firstEndDate > historyContext.data.today
			? firstEndDate
			: historyContext.data?.today;
	// Group assignments by type (filter out organization type - handled by isCompanyDefault)
	const policyAssignments = assignments || [];
	const organizationAssignments = policyAssignments.filter(
		(assignment) => assignment.assignmentType === "organization",
	);
	const teamAssignments = policyAssignments.filter(
		(a) => a.assignmentType === "team",
	);
	const employeeAssignments = policyAssignments.filter(
		(a) => a.assignmentType === "employee",
	);
	const canManageTeamAssignments = allowedAssignmentTypes.includes("team");
	const canManageEmployeeAssignments =
		allowedAssignmentTypes.includes("employee");
	const { showTeamSection, showEmployeeSection } =
		getVacationAssignmentSectionVisibility({
			canManageTeamAssignments,
			teamAssignmentsCount: teamAssignments.length,
			canManageEmployeeAssignments,
			employeeAssignmentsCount: employeeAssignments.length,
		});

	const isLoading = defaultsLoading || assignmentsLoading;

	if (isLoading) {
		return (
			<div className="space-y-6">
				{[1, 2, 3].map((i) => (
					<Card key={i}>
						<CardHeader>
							<Skeleton className="h-6 w-40" />
							<Skeleton className="h-4 w-64" />
						</CardHeader>
						<CardContent>
							<Skeleton className="h-16 w-full" />
						</CardContent>
					</Card>
				))}
			</div>
		);
	}

	if (error) {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<p className="text-destructive">
						{t(
							"settings.vacation.assignments.loadError",
							"Failed to load policy assignments",
						)}
					</p>
				</CardContent>
			</Card>
		);
	}

	return (
		<>
			<div className="space-y-6">
				{/* Info Banner */}
				<Card className="border-blue-200 bg-blue-50/50 dark:border-blue-900 dark:bg-blue-950/30">
					<CardContent className="py-4">
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.vacation.history.inheritanceInfo",
								"Policies apply in priority order: Employee, Team, Organization, then Company Default. Create assignments only when needed.",
							)}
						</p>
					</CardContent>
				</Card>

				<VacationPolicyPreview organizationId={organizationId} />
				<VacationOrganizationAssignments
					assignments={organizationAssignments}
					canManage={canManageTeamAssignments}
					today={historyContext.data?.today}
					onAssignClick={onAssignClick}
					onEnd={handleEndClick}
				/>
				{/* Company Default Level (Read-only) */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<IconBuilding className="size-5 text-muted-foreground" />
							<div className="flex-1">
								<CardTitle className="text-base flex items-center gap-2">
									{t(
										"settings.vacation.assignments.companyDefault",
										"Company Default",
									)}
									<Badge variant="default" className="bg-primary">
										<IconStar className="mr-1 size-3" />
										{t("settings.vacation.required", "Required")}
									</Badge>
								</CardTitle>
								<CardDescription>
									{t(
										"settings.vacation.assignments.companyDefaultDescription",
										"The default policy applied to all employees. Manage defaults in the Policies tab.",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{!companyDefaults?.current ? (
							<div className="flex items-center gap-3 p-4 rounded-lg border border-destructive/50 bg-destructive/10">
								<IconAlertTriangle className="size-5 text-destructive" />
								<div>
									<p className="font-medium text-destructive">
										{t(
											"settings.vacation.noDefaultPolicy",
											"No Company Default Policy",
										)}
									</p>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.vacation.noDefaultPolicyDescription",
											"Create a policy and mark it as Company Default in the Policies tab.",
										)}
									</p>
								</div>
							</div>
						) : (
							<>
								{/* Current Policy */}
								<div className="rounded-lg border p-4 bg-accent/30">
									<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
										<Badge variant="outline" className="text-xs">
											{t("settings.vacation.current", "Current")}
										</Badge>
										<span>
											{t("settings.vacation.since", "since")}{" "}
											{formatDate(companyDefaults.current.startDate)}
										</span>
									</div>
									<div className="flex items-center gap-3">
										<IconCalendarDollar className="size-4 text-primary" />
										<div>
											<span className="font-medium">
												{companyDefaults.current.name}
											</span>
											<span className="text-sm text-muted-foreground ml-2">
												({formatPolicySummary(companyDefaults.current, t)})
											</span>
										</div>
									</div>
								</div>

								{/* Next Policy (if scheduled) */}
								{companyDefaults.next && (
									<div className="rounded-lg border p-4 border-dashed">
										<div className="flex items-center gap-2 text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
											<Badge variant="secondary" className="text-xs">
												{t("settings.vacation.next", "Next")}
											</Badge>
											<IconChevronRight className="size-3" />
											<span>
												{t("settings.vacation.startingOn", "starting on")}{" "}
												{formatDate(companyDefaults.next.startDate)}
											</span>
										</div>
										<div className="flex items-center gap-3">
											<IconCalendarDollar className="size-4 text-muted-foreground" />
											<div>
												<span className="font-medium">
													{companyDefaults.next.name}
												</span>
												<span className="text-sm text-muted-foreground ml-2">
													({formatPolicySummary(companyDefaults.next, t)})
												</span>
											</div>
										</div>
									</div>
								)}
							</>
						)}
					</CardContent>
				</Card>

				{/* Team Level */}
				{showTeamSection ? (
					<Card>
						<CardHeader>
							<div className="flex items-center gap-2">
								<IconUsers className="size-5 text-muted-foreground" />
								<div className="flex-1">
									<CardTitle className="text-base">
										{t(
											"settings.vacation.assignments.teamLevel",
											"Team Overrides",
										)}
										{teamAssignments.length > 0 && (
											<Badge variant="secondary" className="ml-2">
												{teamAssignments.length}
											</Badge>
										)}
									</CardTitle>
									<CardDescription>
										{t(
											"settings.vacation.assignments.teamLevelDescription",
											"Override the company default for specific teams (e.g., different locations or schedules)",
										)}
									</CardDescription>
								</div>
							</div>
						</CardHeader>
						<CardContent>
							{canManageTeamAssignments ? (
								<div className="flex justify-end mb-4">
									<Button
										onClick={() => onAssignClick("team")}
										size="sm"
										variant="outline"
									>
										<IconPlus className="mr-2 size-4" />
										{t(
											"settings.vacation.assignments.assignTeam",
											"Assign to Team",
										)}
									</Button>
								</div>
							) : null}
							{teamAssignments.length > 0 ? (
								<div className="space-y-3">
									{teamAssignments.map((assignment) => (
										<div
											key={assignment.id}
											className="rounded-lg border p-4 hover:bg-accent/50 transition-colors"
										>
											<div className="flex items-center justify-between">
												<div className="flex items-center gap-3">
													<IconUsers className="size-4 text-muted-foreground" />
													<span className="font-medium">
														{assignment.team?.name}
													</span>
												</div>
												{canManageTeamAssignments ? (
													<div className="flex items-center gap-2">
														<Button
															type="button"
															size="sm"
															variant="outline"
															onClick={() =>
																onAssignClick(
																	"team",
																	assignment.teamId ?? undefined,
																)
															}
															aria-label={`${t("settings.vacation.history.replaceAction", "Replace assignment")}: ${assignment.team?.name ?? ""}`}
														>
															{t(
																"settings.vacation.history.replace",
																"Replace",
															)}
														</Button>
														<Button
															variant="ghost"
															size="icon"
															className="size-8 text-muted-foreground hover:text-destructive"
															onClick={() => handleEndClick(assignment)}
															disabled={
																!historyContext.data ||
																(!!assignment.effectiveEndDate &&
																	assignment.effectiveEndDate <=
																		historyContext.data.today)
															}
															aria-label={`${t("settings.vacation.history.endAction", "End assignment")}: ${assignment.team?.name ?? assignment.policy.name}`}
														>
															<IconCalendarX className="size-4" />
														</Button>
													</div>
												) : null}
											</div>
											<div className="mt-2 ml-7 space-y-1">
												<div className="flex items-center gap-2 text-sm">
													<Badge variant="outline" className="text-xs">
														{!assignment.effectiveStartDate
															? t(
																	"settings.vacation.history.legacyAssignment",
																	"Legacy",
																)
															: assignment.effectiveEndDate &&
																	historyContext.data &&
																	assignment.effectiveEndDate <=
																		historyContext.data.today
																? t(
																		"settings.vacation.history.endedStatus",
																		"Ended",
																	)
																: historyContext.data &&
																		assignment.effectiveStartDate >
																			historyContext.data.today
																	? t(
																			"settings.vacation.history.scheduledStatus",
																			"Scheduled",
																		)
																	: t("settings.vacation.current", "Current")}
													</Badge>
													<span className="text-muted-foreground">
														{assignment.policy.name},{" "}
														{assignment.policy.defaultAnnualDays}{" "}
														{t("settings.vacation.days", "days")}
													</span>
													<span className="text-xs text-muted-foreground">
														({t("settings.vacation.since", "since")}{" "}
														{assignment.effectiveStartDate
															? formatDate(assignment.effectiveStartDate)
															: t(
																	"settings.vacation.history.legacyStart",
																	"Legacy start",
																)}
														)
													</span>
												</div>
												{assignment.effectiveEndDate && (
													<div className="flex items-center gap-2 text-sm text-amber-600">
														<Badge
															variant="outline"
															className="text-xs border-amber-300"
														>
															{t("settings.vacation.history.ends", "Ends")}
														</Badge>
														<span>
															{formatDate(assignment.effectiveEndDate)} →{" "}
															{t(
																"settings.vacation.history.nextApplicablePolicy",
																"Next applicable policy",
															)}
														</span>
													</div>
												)}
											</div>
										</div>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground text-center py-4">
									{t(
										"settings.vacation.assignments.noTeamPolicies",
										"No team-specific policies. All teams use the company default.",
									)}
								</p>
							)}
						</CardContent>
					</Card>
				) : null}

				{/* Employee Level */}
				{showEmployeeSection ? (
					<Card>
						<CardHeader>
							<div className="flex items-center gap-2">
								<IconUser className="size-5 text-muted-foreground" />
								<div className="flex-1">
									<CardTitle className="text-base">
										{t(
											"settings.vacation.assignments.employeeLevel",
											"Employee Overrides",
										)}
										{employeeAssignments.length > 0 && (
											<Badge variant="secondary" className="ml-2">
												{employeeAssignments.length}
											</Badge>
										)}
									</CardTitle>
									<CardDescription>
										{t(
											"settings.vacation.assignments.employeeLevelDescription",
											"Override team or company defaults for specific employees (e.g., special contracts)",
										)}
									</CardDescription>
								</div>
							</div>
						</CardHeader>
						<CardContent>
							{canManageEmployeeAssignments ? (
								<div className="flex justify-end mb-4">
									<Button
										onClick={() => onAssignClick("employee")}
										size="sm"
										variant="outline"
									>
										<IconPlus className="mr-2 size-4" />
										{t(
											"settings.vacation.assignments.assignEmployee",
											"Assign to Employee",
										)}
									</Button>
								</div>
							) : null}
							{employeeAssignments.length > 0 ? (
								<div className="space-y-3">
									{employeeAssignments.map((assignment) => (
										<div
											key={assignment.id}
											className="rounded-lg border p-4 hover:bg-accent/50 transition-colors"
										>
											<div className="flex items-center justify-between">
												<div className="flex items-center gap-3">
													<IconUser className="size-4 text-muted-foreground" />
													<span className="font-medium">
														{assignment.employee?.firstName}{" "}
														{assignment.employee?.lastName}
													</span>
												</div>
												{canManageEmployeeAssignments ? (
													<div className="flex items-center gap-2">
														<Button
															type="button"
															size="sm"
															variant="outline"
															onClick={() =>
																onAssignClick(
																	"employee",
																	assignment.employeeId ?? undefined,
																)
															}
															aria-label={`${t("settings.vacation.history.replaceAction", "Replace assignment")}: ${assignment.employee?.firstName ?? ""} ${assignment.employee?.lastName ?? ""}`}
														>
															{t(
																"settings.vacation.history.replace",
																"Replace",
															)}
														</Button>
														<Button
															variant="ghost"
															size="icon"
															className="size-8 text-muted-foreground hover:text-destructive"
															onClick={() => handleEndClick(assignment)}
															disabled={
																!historyContext.data ||
																(!!assignment.effectiveEndDate &&
																	assignment.effectiveEndDate <=
																		historyContext.data.today)
															}
															aria-label={`${t("settings.vacation.history.endAction", "End assignment")}: ${assignment.employee?.firstName ?? ""} ${assignment.employee?.lastName ?? ""}`}
														>
															<IconCalendarX className="size-4" />
														</Button>
													</div>
												) : null}
											</div>
											<div className="mt-2 ml-7 space-y-1">
												<div className="flex items-center gap-2 text-sm">
													<Badge variant="outline" className="text-xs">
														{!assignment.effectiveStartDate
															? t(
																	"settings.vacation.history.legacyAssignment",
																	"Legacy",
																)
															: assignment.effectiveEndDate &&
																	historyContext.data &&
																	assignment.effectiveEndDate <=
																		historyContext.data.today
																? t(
																		"settings.vacation.history.endedStatus",
																		"Ended",
																	)
																: historyContext.data &&
																		assignment.effectiveStartDate >
																			historyContext.data.today
																	? t(
																			"settings.vacation.history.scheduledStatus",
																			"Scheduled",
																		)
																	: t("settings.vacation.current", "Current")}
													</Badge>
													<span className="text-muted-foreground">
														{assignment.policy.name},{" "}
														{assignment.policy.defaultAnnualDays}{" "}
														{t("settings.vacation.days", "days")}
													</span>
													<span className="text-xs text-muted-foreground">
														({t("settings.vacation.since", "since")}{" "}
														{assignment.effectiveStartDate
															? formatDate(assignment.effectiveStartDate)
															: t(
																	"settings.vacation.history.legacyStart",
																	"Legacy start",
																)}
														)
													</span>
												</div>
												{assignment.effectiveEndDate && (
													<div className="flex items-center gap-2 text-sm text-amber-600">
														<Badge
															variant="outline"
															className="text-xs border-amber-300"
														>
															{t("settings.vacation.history.ends", "Ends")}
														</Badge>
														<span>
															{formatDate(assignment.effectiveEndDate)} →{" "}
															{t(
																"settings.vacation.history.nextApplicablePolicy",
																"Next applicable policy",
															)}
														</span>
													</div>
												)}
											</div>
										</div>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground text-center py-4">
									{t(
										"settings.vacation.assignments.noEmployeePolicies",
										"No employee-specific policies. Employees use their team or company default.",
									)}
								</p>
							)}
						</CardContent>
					</Card>
				) : null}
			</div>

			<AlertDialog open={endDialogOpen} onOpenChange={setEndDialogOpen}>
				<AlertDialogContent>
					<form
						className="space-y-4"
						onSubmit={(event) => {
							event.preventDefault();
							void endForm.handleSubmit();
						}}
					>
						<AlertDialogHeader>
							<AlertDialogTitle>
								{t(
									"settings.vacation.history.endTitle",
									"End policy assignment",
								)}
							</AlertDialogTitle>
							<AlertDialogDescription>
								{t(
									"settings.vacation.history.endDescription",
									"Earlier history is preserved. From the end date, the employee or team uses the next applicable policy.",
								)}
							</AlertDialogDescription>
						</AlertDialogHeader>
						<endForm.Field name="effectiveOn">
							{(field) => (
								<TFormItem>
									<TFormLabel>
										{t("settings.vacation.history.endOn", "End assignment on")}
									</TFormLabel>
									<TFormControl>
										<Input
											type="date"
											name="effectiveOn"
											autoComplete="off"
											required
											min={minimumEndDate}
											value={field.state.value || minimumEndDate || ""}
											onChange={(event) =>
												field.handleChange(event.target.value)
											}
											onBlur={field.handleBlur}
										/>
									</TFormControl>
									<TFormDescription>
										{t(
											"settings.vacation.history.endExclusive",
											"The assignment no longer applies on this date.",
										)}
									</TFormDescription>
								</TFormItem>
							)}
						</endForm.Field>
						<AlertDialogFooter>
							<AlertDialogCancel disabled={endMutation.isPending}>
								{t("common.cancel", "Cancel")}
							</AlertDialogCancel>
							<Button
								type="submit"
								disabled={endMutation.isPending || !historyContext.data}
							>
								{endMutation.isPending ? (
									<IconLoader2 className="mr-2 size-4 animate-spin" />
								) : null}
								{t("settings.vacation.history.saveEnd", "Save end date")}
							</Button>
						</AlertDialogFooter>
					</form>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function VacationOrganizationAssignments({
	assignments,
	canManage,
	today,
	onAssignClick,
	onEnd,
}: {
	assignments: VacationPolicyAssignmentData[];
	canManage: boolean;
	today: string | undefined;
	onAssignClick: (type: VacationAssignmentType, targetId?: string) => void;
	onEnd: (assignment: VacationPolicyAssignmentData) => void;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	if (!canManage && !assignments.length) return null;
	const formatDate = (date: string) =>
		Temporal.PlainDate.from(date).toLocaleString(locale, {
			dateStyle: "medium",
		});
	return (
		<Card>
			<CardHeader>
				<CardTitle className="text-base">
					{t(
						"settings.vacation.history.organizationLevel",
						"Organization Assignments",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.vacation.history.organizationLevelDescription",
						"Organization assignments take precedence over the company default. Employee and team assignments still apply first.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-3">
				{canManage ? (
					<div className="flex justify-end">
						<Button
							size="sm"
							variant="outline"
							onClick={() => onAssignClick("organization")}
						>
							<IconPlus aria-hidden="true" className="mr-2 size-4" />
							{t(
								"settings.vacation.history.assignOrganization",
								"Assign Organization Policy",
							)}
						</Button>
					</div>
				) : null}
				{assignments.map((assignment) => (
					<div key={assignment.id} className="rounded-lg border p-4">
						<div className="flex flex-wrap items-center justify-between gap-3">
							<div className="min-w-0 space-y-1">
								<p className="break-words font-medium">
									{assignment.policy.name}
								</p>
								<p className="text-sm text-muted-foreground">
									{assignment.effectiveStartDate
										? formatDate(assignment.effectiveStartDate)
										: t(
												"settings.vacation.history.legacyStart",
												"Legacy start",
											)}{" "}
									→{" "}
									{assignment.effectiveEndDate
										? formatDate(assignment.effectiveEndDate)
										: t("settings.vacation.history.openEnd", "No end date")}
								</p>
								<Badge variant="outline">
									{assignment.effectiveEndDate &&
									today &&
									assignment.effectiveEndDate <= today
										? t("settings.vacation.history.endedStatus", "Ended")
										: assignment.effectiveStartDate &&
												today &&
												assignment.effectiveStartDate > today
											? t(
													"settings.vacation.history.scheduledStatus",
													"Scheduled",
												)
											: t("settings.vacation.current", "Current")}
								</Badge>
							</div>
							{canManage ? (
								<div className="flex gap-2">
									<Button
										size="sm"
										variant="outline"
										onClick={() => onAssignClick("organization")}
									>
										{t("settings.vacation.history.replace", "Replace")}
									</Button>
									<Button
										size="sm"
										variant="outline"
										disabled={
											!today ||
											(!!assignment.effectiveEndDate &&
												assignment.effectiveEndDate <= today)
										}
										onClick={() => onEnd(assignment)}
									>
										{t("settings.vacation.history.endAction", "End assignment")}
									</Button>
								</div>
							) : null}
						</div>
					</div>
				))}
				{!assignments.length ? (
					<p className="py-4 text-center text-sm text-muted-foreground">
						{t(
							"settings.vacation.history.noOrganizationAssignments",
							"No organization assignments. The company default applies.",
						)}
					</p>
				) : null}
			</CardContent>
		</Card>
	);
}
