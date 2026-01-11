"use client";

import {
	IconBuilding,
	IconCalendarEvent,
	IconLoader2,
	IconPlus,
	IconTrash,
	IconUser,
	IconUsers,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	deleteHolidayAssignment,
	getHolidayAssignments,
} from "@/app/[locale]/(app)/settings/holidays/actions";
import {
	deletePresetAssignment,
	getPresetAssignments,
} from "@/app/[locale]/(app)/settings/holidays/preset-actions";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { queryKeys } from "@/lib/query";

interface AssignmentManagerProps {
	organizationId: string;
	onAssignClick: (type: "organization" | "team" | "employee") => void;
	onHolidayAssignClick: (type: "organization" | "team" | "employee") => void;
}

interface PresetAssignmentData {
	id: string;
	presetId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	priority: number;
	effectiveFrom: Date | null;
	effectiveUntil: Date | null;
	isActive: boolean;
	createdAt: Date;
	preset: {
		id: string;
		name: string;
		color: string | null;
		countryCode: string | null;
		stateCode: string | null;
	};
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

interface HolidayAssignmentData {
	id: string;
	holidayId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	isActive: boolean;
	createdAt: Date;
	holiday: {
		id: string;
		name: string;
		description: string | null;
		startDate: Date;
		endDate: Date;
		recurrenceType: string;
	};
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

export function AssignmentManager({
	organizationId,
	onAssignClick,
	onHolidayAssignClick,
}: AssignmentManagerProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [selectedPresetAssignment, setSelectedPresetAssignment] =
		useState<PresetAssignmentData | null>(null);
	const [selectedHolidayAssignment, setSelectedHolidayAssignment] =
		useState<HolidayAssignmentData | null>(null);

	// Fetch preset assignments
	const {
		data: presetAssignments,
		isLoading: presetLoading,
		error: presetError,
	} = useQuery({
		queryKey: queryKeys.holidayPresetAssignments.list(organizationId),
		queryFn: async () => {
			const result = await getPresetAssignments(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch assignments");
			}
			return result.data as PresetAssignmentData[];
		},
	});

	// Fetch holiday assignments
	const {
		data: holidayAssignments,
		isLoading: holidayLoading,
		error: holidayError,
	} = useQuery({
		queryKey: queryKeys.holidayAssignments.list(organizationId),
		queryFn: async () => {
			const result = await getHolidayAssignments(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch holiday assignments");
			}
			return result.data as HolidayAssignmentData[];
		},
	});

	// Delete preset assignment mutation
	const deletePresetMutation = useMutation({
		mutationFn: (assignmentId: string) => deletePresetAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.holidays.assignments.deleted", "Assignment removed"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.holidayPresetAssignments.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedPresetAssignment(null);
			} else {
				toast.error(
					result.error ||
						t("settings.holidays.assignments.deleteFailed", "Failed to remove assignment"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.holidays.assignments.deleteFailed", "Failed to remove assignment"));
		},
	});

	// Delete holiday assignment mutation
	const deleteHolidayMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteHolidayAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.holidays.assignments.holidayDeleted", "Holiday assignment removed"),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.holidayAssignments.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedHolidayAssignment(null);
			} else {
				toast.error(
					result.error ||
						t(
							"settings.holidays.assignments.holidayDeleteFailed",
							"Failed to remove holiday assignment",
						),
				);
			}
		},
		onError: () => {
			toast.error(
				t(
					"settings.holidays.assignments.holidayDeleteFailed",
					"Failed to remove holiday assignment",
				),
			);
		},
	});

	const handleDeletePresetClick = (assignment: PresetAssignmentData) => {
		setSelectedPresetAssignment(assignment);
		setSelectedHolidayAssignment(null);
		setDeleteDialogOpen(true);
	};

	const handleDeleteHolidayClick = (assignment: HolidayAssignmentData) => {
		setSelectedHolidayAssignment(assignment);
		setSelectedPresetAssignment(null);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedPresetAssignment) {
			deletePresetMutation.mutate(selectedPresetAssignment.id);
		} else if (selectedHolidayAssignment) {
			deleteHolidayMutation.mutate(selectedHolidayAssignment.id);
		}
	};

	const isDeleting = deletePresetMutation.isPending || deleteHolidayMutation.isPending;

	// Group preset assignments by type
	const presets = presetAssignments || [];
	const orgPresetAssignment = presets.find((a) => a.assignmentType === "organization");
	const teamPresetAssignments = presets.filter((a) => a.assignmentType === "team");
	const employeePresetAssignments = presets.filter((a) => a.assignmentType === "employee");

	// Group holiday assignments by type
	const holidays = holidayAssignments || [];
	const orgHolidayAssignments = holidays.filter((a) => a.assignmentType === "organization");
	const teamHolidayAssignments = holidays.filter((a) => a.assignmentType === "team");
	const employeeHolidayAssignments = holidays.filter((a) => a.assignmentType === "employee");

	const isLoading = presetLoading || holidayLoading;
	const hasError = presetError || holidayError;

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

	if (hasError) {
		return (
			<Card>
				<CardContent className="py-8 text-center">
					<p className="text-destructive">
						{t("settings.holidays.assignments.loadError", "Failed to load assignments")}
					</p>
				</CardContent>
			</Card>
		);
	}

	const formatDateRange = (startDate: Date | string, endDate: Date | string) => {
		const start = new Date(startDate).toLocaleDateString("default", {
			month: "short",
			day: "numeric",
		});
		const end = new Date(endDate).toLocaleDateString("default", {
			month: "short",
			day: "numeric",
		});
		return start === end ? start : `${start} - ${end}`;
	};

	return (
		<>
			<div className="space-y-6">
				{/* Organization Level */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<IconBuilding className="h-5 w-5 text-muted-foreground" />
							<div>
								<CardTitle className="text-base">
									{t("settings.holidays.assignments.orgLevel", "Organization Level")}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.holidays.assignments.orgLevelDescription",
										"Default holidays applied to all employees unless overridden",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent className="space-y-4">
						{/* Preset Assignment */}
						<div>
							<div className="flex items-center justify-between mb-2">
								<h4 className="text-sm font-medium text-muted-foreground">
									{t("settings.holidays.assignments.presetSection", "Holiday Preset")}
								</h4>
								{!orgPresetAssignment && (
									<Button onClick={() => onAssignClick("organization")} size="sm" variant="outline">
										<IconPlus className="mr-2 h-4 w-4" />
										{t("settings.holidays.assignments.setDefault", "Set Default")}
									</Button>
								)}
							</div>
							{orgPresetAssignment ? (
								<div className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors">
									<div className="flex items-center gap-3">
										{orgPresetAssignment.preset.color && (
											<div
												className="w-3 h-3 rounded-full flex-shrink-0"
												style={{ backgroundColor: orgPresetAssignment.preset.color }}
											/>
										)}
										<div>
											<span className="font-medium">{orgPresetAssignment.preset.name}</span>
											{orgPresetAssignment.preset.countryCode && (
												<span className="text-sm text-muted-foreground ml-2">
													({orgPresetAssignment.preset.countryCode}
													{orgPresetAssignment.preset.stateCode &&
														`-${orgPresetAssignment.preset.stateCode}`}
													)
												</span>
											)}
										</div>
									</div>
									<Button
										variant="ghost"
										size="icon"
										className="h-8 w-8 text-muted-foreground hover:text-destructive"
										onClick={() => handleDeletePresetClick(orgPresetAssignment)}
									>
										<IconTrash className="h-4 w-4" />
									</Button>
								</div>
							) : (
								<p className="text-sm text-muted-foreground text-center py-2 border rounded-lg bg-muted/30">
									{t("settings.holidays.assignments.noOrgPreset", "No default preset set")}
								</p>
							)}
						</div>

						<Separator />

						{/* Custom Holiday Assignments */}
						<div>
							<div className="flex items-center justify-between mb-2">
								<h4 className="text-sm font-medium text-muted-foreground">
									{t("settings.holidays.assignments.customHolidays", "Custom Holidays")}
									{orgHolidayAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{orgHolidayAssignments.length}
										</Badge>
									)}
								</h4>
								<Button
									onClick={() => onHolidayAssignClick("organization")}
									size="sm"
									variant="outline"
								>
									<IconPlus className="mr-2 h-4 w-4" />
									{t("settings.holidays.assignments.addHoliday", "Add Holiday")}
								</Button>
							</div>
							{orgHolidayAssignments.length > 0 ? (
								<div className="space-y-2">
									{orgHolidayAssignments.map((assignment) => (
										<div
											key={assignment.id}
											className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
										>
											<div className="flex items-center gap-3">
												<IconCalendarEvent className="h-4 w-4 text-muted-foreground" />
												<div>
													<span className="font-medium">{assignment.holiday.name}</span>
													<span className="text-sm text-muted-foreground ml-2">
														(
														{formatDateRange(
															assignment.holiday.startDate,
															assignment.holiday.endDate,
														)}
														)
													</span>
												</div>
											</div>
											<Button
												variant="ghost"
												size="icon"
												className="h-8 w-8 text-muted-foreground hover:text-destructive"
												onClick={() => handleDeleteHolidayClick(assignment)}
											>
												<IconTrash className="h-4 w-4" />
											</Button>
										</div>
									))}
								</div>
							) : (
								<p className="text-sm text-muted-foreground text-center py-2 border rounded-lg bg-muted/30">
									{t(
										"settings.holidays.assignments.noOrgHolidays",
										"No custom holidays assigned to organization",
									)}
								</p>
							)}
						</div>
					</CardContent>
				</Card>

				{/* Team Level */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<IconUsers className="h-5 w-5 text-muted-foreground" />
							<div>
								<CardTitle className="text-base">
									{t("settings.holidays.assignments.teamLevel", "Team Level")}
									{(teamPresetAssignments.length > 0 || teamHolidayAssignments.length > 0) && (
										<Badge variant="secondary" className="ml-2">
											{teamPresetAssignments.length + teamHolidayAssignments.length}
										</Badge>
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.holidays.assignments.teamLevelDescription",
										"Override organization defaults for specific teams",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<Tabs defaultValue="presets" className="w-full">
							<TabsList className="grid w-full grid-cols-2">
								<TabsTrigger value="presets">
									{t("settings.holidays.assignments.presets", "Presets")}
									{teamPresetAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{teamPresetAssignments.length}
										</Badge>
									)}
								</TabsTrigger>
								<TabsTrigger value="holidays">
									{t("settings.holidays.assignments.holidays", "Custom Holidays")}
									{teamHolidayAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{teamHolidayAssignments.length}
										</Badge>
									)}
								</TabsTrigger>
							</TabsList>
							<TabsContent value="presets" className="mt-4">
								<div className="flex justify-end mb-2">
									<Button onClick={() => onAssignClick("team")} size="sm" variant="outline">
										<IconPlus className="mr-2 h-4 w-4" />
										{t("settings.holidays.assignments.assignTeam", "Assign Preset")}
									</Button>
								</div>
								{teamPresetAssignments.length > 0 ? (
									<div className="space-y-2">
										{teamPresetAssignments.map((assignment) => (
											<div
												key={assignment.id}
												className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
											>
												<div className="flex items-center gap-3">
													<IconUsers className="h-4 w-4 text-muted-foreground" />
													<div>
														<span className="font-medium">{assignment.team?.name}</span>
														<span className="text-muted-foreground mx-2">→</span>
														<span className="text-sm">
															{assignment.preset.name}
															{assignment.preset.color && (
																<span
																	className="inline-block w-2 h-2 rounded-full ml-2"
																	style={{ backgroundColor: assignment.preset.color }}
																/>
															)}
														</span>
													</div>
												</div>
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8 text-muted-foreground hover:text-destructive"
													onClick={() => handleDeletePresetClick(assignment)}
												>
													<IconTrash className="h-4 w-4" />
												</Button>
											</div>
										))}
									</div>
								) : (
									<p className="text-sm text-muted-foreground text-center py-4">
										{t("settings.holidays.assignments.noTeamPresets", "No team preset assignments")}
									</p>
								)}
							</TabsContent>
							<TabsContent value="holidays" className="mt-4">
								<div className="flex justify-end mb-2">
									<Button onClick={() => onHolidayAssignClick("team")} size="sm" variant="outline">
										<IconPlus className="mr-2 h-4 w-4" />
										{t("settings.holidays.assignments.assignHoliday", "Assign Holiday")}
									</Button>
								</div>
								{teamHolidayAssignments.length > 0 ? (
									<div className="space-y-2">
										{teamHolidayAssignments.map((assignment) => (
											<div
												key={assignment.id}
												className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
											>
												<div className="flex items-center gap-3">
													<IconUsers className="h-4 w-4 text-muted-foreground" />
													<div>
														<span className="font-medium">{assignment.team?.name}</span>
														<span className="text-muted-foreground mx-2">→</span>
														<span className="text-sm">
															{assignment.holiday.name}
															<span className="text-muted-foreground ml-1">
																(
																{formatDateRange(
																	assignment.holiday.startDate,
																	assignment.holiday.endDate,
																)}
																)
															</span>
														</span>
													</div>
												</div>
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8 text-muted-foreground hover:text-destructive"
													onClick={() => handleDeleteHolidayClick(assignment)}
												>
													<IconTrash className="h-4 w-4" />
												</Button>
											</div>
										))}
									</div>
								) : (
									<p className="text-sm text-muted-foreground text-center py-4">
										{t(
											"settings.holidays.assignments.noTeamHolidays",
											"No team holiday assignments",
										)}
									</p>
								)}
							</TabsContent>
						</Tabs>
					</CardContent>
				</Card>

				{/* Employee Level */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<IconUser className="h-5 w-5 text-muted-foreground" />
							<div>
								<CardTitle className="text-base">
									{t("settings.holidays.assignments.employeeLevel", "Employee Overrides")}
									{(employeePresetAssignments.length > 0 ||
										employeeHolidayAssignments.length > 0) && (
										<Badge variant="secondary" className="ml-2">
											{employeePresetAssignments.length + employeeHolidayAssignments.length}
										</Badge>
									)}
								</CardTitle>
								<CardDescription>
									{t(
										"settings.holidays.assignments.employeeLevelDescription",
										"Override team or organization defaults for specific employees",
									)}
								</CardDescription>
							</div>
						</div>
					</CardHeader>
					<CardContent>
						<Tabs defaultValue="presets" className="w-full">
							<TabsList className="grid w-full grid-cols-2">
								<TabsTrigger value="presets">
									{t("settings.holidays.assignments.presets", "Presets")}
									{employeePresetAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{employeePresetAssignments.length}
										</Badge>
									)}
								</TabsTrigger>
								<TabsTrigger value="holidays">
									{t("settings.holidays.assignments.holidays", "Custom Holidays")}
									{employeeHolidayAssignments.length > 0 && (
										<Badge variant="secondary" className="ml-2">
											{employeeHolidayAssignments.length}
										</Badge>
									)}
								</TabsTrigger>
							</TabsList>
							<TabsContent value="presets" className="mt-4">
								<div className="flex justify-end mb-2">
									<Button onClick={() => onAssignClick("employee")} size="sm" variant="outline">
										<IconPlus className="mr-2 h-4 w-4" />
										{t("settings.holidays.assignments.assignEmployee", "Assign Preset")}
									</Button>
								</div>
								{employeePresetAssignments.length > 0 ? (
									<div className="space-y-2">
										{employeePresetAssignments.map((assignment) => (
											<div
												key={assignment.id}
												className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
											>
												<div className="flex items-center gap-3">
													<IconUser className="h-4 w-4 text-muted-foreground" />
													<div>
														<span className="font-medium">
															{assignment.employee?.firstName} {assignment.employee?.lastName}
														</span>
														<span className="text-muted-foreground mx-2">→</span>
														<span className="text-sm">
															{assignment.preset.name}
															{assignment.preset.color && (
																<span
																	className="inline-block w-2 h-2 rounded-full ml-2"
																	style={{ backgroundColor: assignment.preset.color }}
																/>
															)}
														</span>
													</div>
												</div>
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8 text-muted-foreground hover:text-destructive"
													onClick={() => handleDeletePresetClick(assignment)}
												>
													<IconTrash className="h-4 w-4" />
												</Button>
											</div>
										))}
									</div>
								) : (
									<p className="text-sm text-muted-foreground text-center py-4">
										{t(
											"settings.holidays.assignments.noEmployeePresets",
											"No employee preset overrides",
										)}
									</p>
								)}
							</TabsContent>
							<TabsContent value="holidays" className="mt-4">
								<div className="flex justify-end mb-2">
									<Button
										onClick={() => onHolidayAssignClick("employee")}
										size="sm"
										variant="outline"
									>
										<IconPlus className="mr-2 h-4 w-4" />
										{t("settings.holidays.assignments.assignHoliday", "Assign Holiday")}
									</Button>
								</div>
								{employeeHolidayAssignments.length > 0 ? (
									<div className="space-y-2">
										{employeeHolidayAssignments.map((assignment) => (
											<div
												key={assignment.id}
												className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
											>
												<div className="flex items-center gap-3">
													<IconUser className="h-4 w-4 text-muted-foreground" />
													<div>
														<span className="font-medium">
															{assignment.employee?.firstName} {assignment.employee?.lastName}
														</span>
														<span className="text-muted-foreground mx-2">→</span>
														<span className="text-sm">
															{assignment.holiday.name}
															<span className="text-muted-foreground ml-1">
																(
																{formatDateRange(
																	assignment.holiday.startDate,
																	assignment.holiday.endDate,
																)}
																)
															</span>
														</span>
													</div>
												</div>
												<Button
													variant="ghost"
													size="icon"
													className="h-8 w-8 text-muted-foreground hover:text-destructive"
													onClick={() => handleDeleteHolidayClick(assignment)}
												>
													<IconTrash className="h-4 w-4" />
												</Button>
											</div>
										))}
									</div>
								) : (
									<p className="text-sm text-muted-foreground text-center py-4">
										{t(
											"settings.holidays.assignments.noEmployeeHolidays",
											"No employee holiday overrides",
										)}
									</p>
								)}
							</TabsContent>
						</Tabs>
					</CardContent>
				</Card>
			</div>

			{/* Delete Confirmation Dialog */}
			<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.holidays.assignments.deleteTitle", "Remove Assignment?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{selectedPresetAssignment && (
								<>
									{selectedPresetAssignment.assignmentType === "organization" &&
										t(
											"settings.holidays.assignments.deleteOrgDescription",
											"This will remove the organization default preset. Employees will only see custom holidays.",
										)}
									{selectedPresetAssignment.assignmentType === "team" &&
										t(
											"settings.holidays.assignments.deleteTeamDescription",
											'This will remove the preset from team "{team}". They will use the organization default.',
											{ team: selectedPresetAssignment.team?.name },
										)}
									{selectedPresetAssignment.assignmentType === "employee" &&
										t(
											"settings.holidays.assignments.deleteEmployeeDescription",
											'This will remove the override for "{name}". They will use their team or organization default.',
											{
												name: `${selectedPresetAssignment.employee?.firstName} ${selectedPresetAssignment.employee?.lastName}`,
											},
										)}
								</>
							)}
							{selectedHolidayAssignment &&
								t(
									"settings.holidays.assignments.deleteHolidayDescription",
									'This will remove the custom holiday "{holiday}" from this assignment.',
									{ holiday: selectedHolidayAssignment.holiday.name },
								)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleDeleteConfirm}
							disabled={isDeleting}
							className="bg-destructive hover:bg-destructive/90"
						>
							{isDeleting ? (
								<>
									<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
									{t("common.removing", "Removing...")}
								</>
							) : (
								t("common.remove", "Remove")
							)}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
