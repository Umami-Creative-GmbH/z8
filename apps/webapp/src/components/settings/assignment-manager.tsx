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
	deleteHolidayCategoryAssignment,
	getHolidayAssignments,
	getHolidayCategoryAssignments,
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

const assignmentDateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const holidayDateFormatter = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
});

interface AssignmentManagerProps {
	organizationId: string;
	canManage: boolean;
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
		year: number | null;
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

interface HolidayCategoryAssignmentData {
	id: string;
	categoryId: string;
	assignmentType: "organization" | "team" | "employee";
	teamId: string | null;
	employeeId: string | null;
	isActive: boolean;
	createdAt: Date;
	category: {
		id: string;
		name: string;
		type: string;
		color: string | null;
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
	canManage,
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
	const [selectedHolidayCategoryAssignment, setSelectedHolidayCategoryAssignment] =
		useState<HolidayCategoryAssignmentData | null>(null);

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

	// Fetch holiday category assignments
	const {
		data: holidayCategoryAssignments,
		isLoading: holidayCategoryLoading,
		error: holidayCategoryError,
	} = useQuery({
		queryKey: queryKeys.holidayCategoryAssignments.list(organizationId),
		queryFn: async () => {
			const result = await getHolidayCategoryAssignments(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch holiday category assignments");
			}
			return result.data as HolidayCategoryAssignmentData[];
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

	// Delete holiday category assignment mutation
	const deleteHolidayCategoryMutation = useMutation({
		mutationFn: (assignmentId: string) => deleteHolidayCategoryAssignment(assignmentId),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.holidays.assignments.categoryDeleted", "Holiday category assignment removed"),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.holidayCategoryAssignments.list(organizationId),
				});
				setDeleteDialogOpen(false);
				setSelectedHolidayCategoryAssignment(null);
			} else {
				toast.error(
					result.error ||
						t(
							"settings.holidays.assignments.categoryDeleteFailed",
							"Failed to remove holiday category assignment",
						),
				);
			}
		},
		onError: () => {
			toast.error(
				t(
					"settings.holidays.assignments.categoryDeleteFailed",
					"Failed to remove holiday category assignment",
				),
			);
		},
	});

	const handleDeletePresetClick = (assignment: PresetAssignmentData) => {
		setSelectedPresetAssignment(assignment);
		setSelectedHolidayAssignment(null);
		setSelectedHolidayCategoryAssignment(null);
		setDeleteDialogOpen(true);
	};

	const handleDeleteHolidayClick = (assignment: HolidayAssignmentData) => {
		setSelectedHolidayAssignment(assignment);
		setSelectedPresetAssignment(null);
		setSelectedHolidayCategoryAssignment(null);
		setDeleteDialogOpen(true);
	};

	const handleDeleteHolidayCategoryClick = (assignment: HolidayCategoryAssignmentData) => {
		setSelectedHolidayCategoryAssignment(assignment);
		setSelectedHolidayAssignment(null);
		setSelectedPresetAssignment(null);
		setDeleteDialogOpen(true);
	};

	const handleDeleteConfirm = () => {
		if (selectedPresetAssignment) {
			deletePresetMutation.mutate(selectedPresetAssignment.id);
		} else if (selectedHolidayAssignment) {
			deleteHolidayMutation.mutate(selectedHolidayAssignment.id);
		} else if (selectedHolidayCategoryAssignment) {
			deleteHolidayCategoryMutation.mutate(selectedHolidayCategoryAssignment.id);
		}
	};

	const isDeleting =
		deletePresetMutation.isPending ||
		deleteHolidayMutation.isPending ||
		deleteHolidayCategoryMutation.isPending;

	// Group preset assignments by type
	const presets = presetAssignments || [];
	const orgPresetAssignments = presets.filter((a) => a.assignmentType === "organization");
	const teamPresetAssignments = presets.filter((a) => a.assignmentType === "team");
	const employeePresetAssignments = presets.filter((a) => a.assignmentType === "employee");
	function formatPresetYear(year: number | null) {
		return year ? t("settings.holidays.presets.yearValue", "Year {year}", { year }) : null;
	}

	function formatAssignmentRange(effectiveFrom: Date | null, effectiveUntil: Date | null) {
		if (!effectiveFrom && !effectiveUntil) {
			return t("settings.holidays.assignments.always", "Always");
		}
		const from = effectiveFrom
			? assignmentDateFormatter.format(effectiveFrom)
			: t("common.start", "Start");
		const until = effectiveUntil
			? assignmentDateFormatter.format(effectiveUntil)
			: t("common.openEnded", "Open ended");
		return t("settings.holidays.assignments.range", "{from} to {until}", { from, until });
	}

	// Group holiday assignments by type
	const holidays = holidayAssignments || [];
	const orgHolidayAssignments = holidays.filter((a) => a.assignmentType === "organization");
	const teamHolidayAssignments = holidays.filter((a) => a.assignmentType === "team");
	const employeeHolidayAssignments = holidays.filter((a) => a.assignmentType === "employee");
	const holidayCategories = holidayCategoryAssignments || [];
	const orgHolidayCategoryAssignments = holidayCategories.filter(
		(a) => a.assignmentType === "organization",
	);
	const teamHolidayCategoryAssignments = holidayCategories.filter(
		(a) => a.assignmentType === "team",
	);
	const employeeHolidayCategoryAssignments = holidayCategories.filter(
		(a) => a.assignmentType === "employee",
	);
	const orgCustomHolidayAssignmentCount =
		orgHolidayCategoryAssignments.length + orgHolidayAssignments.length;
	const teamCustomHolidayAssignmentCount =
		teamHolidayCategoryAssignments.length + teamHolidayAssignments.length;
	const employeeCustomHolidayAssignmentCount =
		employeeHolidayCategoryAssignments.length + employeeHolidayAssignments.length;

	const isLoading = presetLoading || holidayLoading || holidayCategoryLoading;
	const hasError = presetError || holidayError || holidayCategoryError;

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
		const start = holidayDateFormatter.format(new Date(startDate));
		const end = holidayDateFormatter.format(new Date(endDate));
		return start === end
			? start
			: t("settings.holidays.assignments.range", "{from} to {until}", {
					from: start,
					until: end,
				});
	};

	return (
		<>
			<div className="space-y-6">
				{/* Organization Level */}
				<Card>
					<CardHeader>
						<div className="flex items-center gap-2">
							<IconBuilding className="size-5 text-muted-foreground" />
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
								{canManage && (
									<Button onClick={() => onAssignClick("organization")} size="sm" variant="outline">
										<IconPlus className="mr-2 size-4" />
										{t("settings.holidays.assignments.setDefault", "Set Default")}
									</Button>
								)}
							</div>
							{orgPresetAssignments.length > 0 ? (
								<div className="space-y-2">
									{orgPresetAssignments.map((assignment) => (
										<div
											key={assignment.id}
											className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
										>
											<div className="flex items-center gap-3">
												{assignment.preset.color && (
													<div
														className="size-3 rounded-full flex-shrink-0"
														style={{ backgroundColor: assignment.preset.color }}
													/>
												)}
												<div>
													<span className="font-medium">{assignment.preset.name}</span>
													{formatPresetYear(assignment.preset.year) && (
														<Badge variant="outline" className="ml-2">
															{formatPresetYear(assignment.preset.year)}
														</Badge>
													)}
													{assignment.preset.countryCode && (
														<span className="text-sm text-muted-foreground ml-2">
															({assignment.preset.countryCode}
															{assignment.preset.stateCode && `-${assignment.preset.stateCode}`})
														</span>
													)}
													<p className="text-sm text-muted-foreground">
														{formatAssignmentRange(
															assignment.effectiveFrom,
															assignment.effectiveUntil,
														)}
													</p>
												</div>
											</div>
											{canManage ? (
												<Button
													variant="ghost"
													size="icon"
													className="size-8 text-muted-foreground hover:text-destructive"
													onClick={() => handleDeletePresetClick(assignment)}
													aria-label={t(
														"settings.holidays.assignments.removePresetAssignment",
														'Remove preset assignment for "{preset}"',
														{ preset: assignment.preset.name },
													)}
												>
													<IconTrash className="size-4" />
												</Button>
											) : null}
										</div>
									))}
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
									{orgCustomHolidayAssignmentCount > 0 && (
										<Badge variant="secondary" className="ml-2">
											{orgCustomHolidayAssignmentCount}
										</Badge>
									)}
								</h4>
								{canManage ? (
									<Button
										onClick={() => onHolidayAssignClick("organization")}
										size="sm"
										variant="outline"
									>
										<IconPlus className="mr-2 size-4" />
										{t("settings.holidays.assignments.addHolidayCategory", "Add Category")}
									</Button>
								) : null}
							</div>
							{orgCustomHolidayAssignmentCount > 0 ? (
								<div className="space-y-2">
									{orgHolidayCategoryAssignments.map((assignment) => (
										<div
											key={`category-${assignment.id}`}
											className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
										>
											<div className="flex items-center gap-3">
												{assignment.category.color ? (
													<span
														className="size-3 rounded-full flex-shrink-0"
														style={{ backgroundColor: assignment.category.color }}
													/>
												) : (
													<IconCalendarEvent className="size-4 text-muted-foreground" />
												)}
												<div>
													<span className="font-medium">{assignment.category.name}</span>
													<Badge variant="outline" className="ml-2">
														{t("settings.holidays.assignments.categoryBadge", "Category")}
													</Badge>
													<Badge variant="secondary" className="ml-2 capitalize">
														{assignment.category.type}
													</Badge>
												</div>
											</div>
											{canManage ? (
												<Button
													variant="ghost"
													size="icon"
													className="size-8 text-muted-foreground hover:text-destructive"
													onClick={() => handleDeleteHolidayCategoryClick(assignment)}
													aria-label={t(
														"settings.holidays.assignments.removeHolidayCategoryAssignment",
														'Remove holiday category assignment for "{category}"',
														{ category: assignment.category.name },
													)}
												>
													<IconTrash className="size-4" />
												</Button>
											) : null}
										</div>
									))}
									{orgHolidayAssignments.map((assignment) => (
										<div
											key={`holiday-${assignment.id}`}
											className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
										>
											<div className="flex items-center gap-3">
												<IconCalendarEvent className="size-4 text-muted-foreground" />
												<div>
													<span className="font-medium">{assignment.holiday.name}</span>
													<Badge variant="outline" className="ml-2">
														{t(
															"settings.holidays.assignments.singleHolidayBadge",
															"Single holiday",
														)}
													</Badge>
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
											{canManage ? (
												<Button
													variant="ghost"
													size="icon"
													className="size-8 text-muted-foreground hover:text-destructive"
													onClick={() => handleDeleteHolidayClick(assignment)}
													aria-label={t(
														"settings.holidays.assignments.removeHolidayAssignment",
														'Remove holiday assignment for "{holiday}"',
														{ holiday: assignment.holiday.name },
													)}
												>
													<IconTrash className="size-4" />
												</Button>
											) : null}
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
							<IconUsers className="size-5 text-muted-foreground" />
							<div>
								<CardTitle className="text-base">
									{t("settings.holidays.assignments.teamLevel", "Team Level")}
									{(teamPresetAssignments.length > 0 || teamCustomHolidayAssignmentCount > 0) && (
										<Badge variant="secondary" className="ml-2">
											{teamPresetAssignments.length + teamCustomHolidayAssignmentCount}
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
									{teamCustomHolidayAssignmentCount > 0 && (
										<Badge variant="secondary" className="ml-2">
											{teamCustomHolidayAssignmentCount}
										</Badge>
									)}
								</TabsTrigger>
							</TabsList>
							<TabsContent value="presets" className="mt-4">
								{canManage ? (
									<div className="flex justify-end mb-2">
										<Button onClick={() => onAssignClick("team")} size="sm" variant="outline">
											<IconPlus className="mr-2 size-4" />
											{t("settings.holidays.assignments.assignTeam", "Assign Preset")}
										</Button>
									</div>
								) : null}
								{teamPresetAssignments.length > 0 ? (
									<div className="space-y-2">
										{teamPresetAssignments.map((assignment) => (
											<div
												key={assignment.id}
												className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
											>
												<div className="flex items-center gap-3">
													<IconUsers className="size-4 text-muted-foreground" />
													<div>
														<span className="font-medium">{assignment.team?.name}</span>
														<span className="text-muted-foreground mx-2">→</span>
														<span className="text-sm">
															{assignment.preset.name}
															{formatPresetYear(assignment.preset.year) && (
																<Badge variant="outline" className="ml-2">
																	{formatPresetYear(assignment.preset.year)}
																</Badge>
															)}
															{assignment.preset.color && (
																<span
																	className="inline-block size-2 rounded-full ml-2"
																	style={{ backgroundColor: assignment.preset.color }}
																/>
															)}
														</span>
														<p className="text-sm text-muted-foreground">
															{formatAssignmentRange(
																assignment.effectiveFrom,
																assignment.effectiveUntil,
															)}
														</p>
													</div>
												</div>
												{canManage ? (
													<Button
														variant="ghost"
														size="icon"
														className="size-8 text-muted-foreground hover:text-destructive"
														onClick={() => handleDeletePresetClick(assignment)}
														aria-label={t(
															"settings.holidays.assignments.removeTeamPresetAssignment",
															'Remove preset assignment for team "{team}"',
															{ team: assignment.team?.name ?? "" },
														)}
													>
														<IconTrash className="size-4" />
													</Button>
												) : null}
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
								{canManage ? (
									<div className="flex justify-end mb-2">
										<Button
											onClick={() => onHolidayAssignClick("team")}
											size="sm"
											variant="outline"
										>
											<IconPlus className="mr-2 size-4" />
											{t("settings.holidays.assignments.assignCategory", "Assign Category")}
										</Button>
									</div>
								) : null}
								{teamCustomHolidayAssignmentCount > 0 ? (
									<div className="space-y-2">
										{teamHolidayCategoryAssignments.map((assignment) => (
											<div
												key={`category-${assignment.id}`}
												className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
											>
												<div className="flex items-center gap-3">
													<IconUsers className="size-4 text-muted-foreground" />
													<div>
														<span className="font-medium">{assignment.team?.name}</span>
														<span className="text-muted-foreground mx-2">→</span>
														<span className="text-sm">
															{assignment.category.color && (
																<span
																	className="inline-block size-2 rounded-full mr-2"
																	style={{ backgroundColor: assignment.category.color }}
																/>
															)}
															{assignment.category.name}
															<Badge variant="outline" className="ml-2">
																{t("settings.holidays.assignments.categoryBadge", "Category")}
															</Badge>
															<Badge variant="secondary" className="ml-2 capitalize">
																{assignment.category.type}
															</Badge>
														</span>
													</div>
												</div>
												{canManage ? (
													<Button
														variant="ghost"
														size="icon"
														className="size-8 text-muted-foreground hover:text-destructive"
														onClick={() => handleDeleteHolidayCategoryClick(assignment)}
														aria-label={t(
															"settings.holidays.assignments.removeTeamHolidayCategoryAssignment",
															'Remove holiday category assignment for team "{team}"',
															{ team: assignment.team?.name ?? "" },
														)}
													>
														<IconTrash className="size-4" />
													</Button>
												) : null}
											</div>
										))}
										{teamHolidayAssignments.map((assignment) => (
											<div
												key={`holiday-${assignment.id}`}
												className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
											>
												<div className="flex items-center gap-3">
													<IconUsers className="size-4 text-muted-foreground" />
													<div>
														<span className="font-medium">{assignment.team?.name}</span>
														<span className="text-muted-foreground mx-2">→</span>
														<span className="text-sm">
															{assignment.holiday.name}
															<Badge variant="outline" className="ml-2">
																{t(
																	"settings.holidays.assignments.singleHolidayBadge",
																	"Single holiday",
																)}
															</Badge>
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
												{canManage ? (
													<Button
														variant="ghost"
														size="icon"
														className="size-8 text-muted-foreground hover:text-destructive"
														onClick={() => handleDeleteHolidayClick(assignment)}
														aria-label={t(
															"settings.holidays.assignments.removeTeamHolidayAssignment",
															'Remove holiday assignment for team "{team}"',
															{ team: assignment.team?.name ?? "" },
														)}
													>
														<IconTrash className="size-4" />
													</Button>
												) : null}
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
							<IconUser className="size-5 text-muted-foreground" />
							<div>
								<CardTitle className="text-base">
									{t("settings.holidays.assignments.employeeLevel", "Employee Overrides")}
									{(employeePresetAssignments.length > 0 ||
										employeeCustomHolidayAssignmentCount > 0) && (
										<Badge variant="secondary" className="ml-2">
											{employeePresetAssignments.length + employeeCustomHolidayAssignmentCount}
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
									{employeeCustomHolidayAssignmentCount > 0 && (
										<Badge variant="secondary" className="ml-2">
											{employeeCustomHolidayAssignmentCount}
										</Badge>
									)}
								</TabsTrigger>
							</TabsList>
							<TabsContent value="presets" className="mt-4">
								{canManage ? (
									<div className="flex justify-end mb-2">
										<Button onClick={() => onAssignClick("employee")} size="sm" variant="outline">
											<IconPlus className="mr-2 size-4" />
											{t("settings.holidays.assignments.assignEmployee", "Assign Preset")}
										</Button>
									</div>
								) : null}
								{employeePresetAssignments.length > 0 ? (
									<div className="space-y-2">
										{employeePresetAssignments.map((assignment) => (
											<div
												key={assignment.id}
												className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
											>
												<div className="flex items-center gap-3">
													<IconUser className="size-4 text-muted-foreground" />
													<div>
														<span className="font-medium">
															{assignment.employee?.firstName} {assignment.employee?.lastName}
														</span>
														<span className="text-muted-foreground mx-2">→</span>
														<span className="text-sm">
															{assignment.preset.name}
															{formatPresetYear(assignment.preset.year) && (
																<Badge variant="outline" className="ml-2">
																	{formatPresetYear(assignment.preset.year)}
																</Badge>
															)}
															{assignment.preset.color && (
																<span
																	className="inline-block size-2 rounded-full ml-2"
																	style={{ backgroundColor: assignment.preset.color }}
																/>
															)}
														</span>
														<p className="text-sm text-muted-foreground">
															{formatAssignmentRange(
																assignment.effectiveFrom,
																assignment.effectiveUntil,
															)}
														</p>
													</div>
												</div>
												{canManage ? (
													<Button
														variant="ghost"
														size="icon"
														className="size-8 text-muted-foreground hover:text-destructive"
														onClick={() => handleDeletePresetClick(assignment)}
														aria-label={t(
															"settings.holidays.assignments.removeEmployeePresetAssignment",
															'Remove preset assignment for employee "{employee}"',
															{
																employee:
																	`${assignment.employee?.firstName ?? ""} ${assignment.employee?.lastName ?? ""}`.trim(),
															},
														)}
													>
														<IconTrash className="size-4" />
													</Button>
												) : null}
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
								{canManage ? (
									<div className="flex justify-end mb-2">
										<Button
											onClick={() => onHolidayAssignClick("employee")}
											size="sm"
											variant="outline"
										>
											<IconPlus className="mr-2 size-4" />
											{t("settings.holidays.assignments.assignCategory", "Assign Category")}
										</Button>
									</div>
								) : null}
								{employeeCustomHolidayAssignmentCount > 0 ? (
									<div className="space-y-2">
										{employeeHolidayCategoryAssignments.map((assignment) => (
											<div
												key={`category-${assignment.id}`}
												className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
											>
												<div className="flex items-center gap-3">
													<IconUser className="size-4 text-muted-foreground" />
													<div>
														<span className="font-medium">
															{assignment.employee?.firstName} {assignment.employee?.lastName}
														</span>
														<span className="text-muted-foreground mx-2">→</span>
														<span className="text-sm">
															{assignment.category.color && (
																<span
																	className="inline-block size-2 rounded-full mr-2"
																	style={{ backgroundColor: assignment.category.color }}
																/>
															)}
															{assignment.category.name}
															<Badge variant="outline" className="ml-2">
																{t("settings.holidays.assignments.categoryBadge", "Category")}
															</Badge>
															<Badge variant="secondary" className="ml-2 capitalize">
																{assignment.category.type}
															</Badge>
														</span>
													</div>
												</div>
												{canManage ? (
													<Button
														variant="ghost"
														size="icon"
														className="size-8 text-muted-foreground hover:text-destructive"
														onClick={() => handleDeleteHolidayCategoryClick(assignment)}
														aria-label={t(
															"settings.holidays.assignments.removeEmployeeHolidayCategoryAssignment",
															'Remove holiday category assignment for employee "{employee}"',
															{
																employee:
																	`${assignment.employee?.firstName ?? ""} ${assignment.employee?.lastName ?? ""}`.trim(),
															},
														)}
													>
														<IconTrash className="size-4" />
													</Button>
												) : null}
											</div>
										))}
										{employeeHolidayAssignments.map((assignment) => (
											<div
												key={`holiday-${assignment.id}`}
												className="flex items-center justify-between rounded-lg border p-3 hover:bg-accent/50 transition-colors"
											>
												<div className="flex items-center gap-3">
													<IconUser className="size-4 text-muted-foreground" />
													<div>
														<span className="font-medium">
															{assignment.employee?.firstName} {assignment.employee?.lastName}
														</span>
														<span className="text-muted-foreground mx-2">→</span>
														<span className="text-sm">
															{assignment.holiday.name}
															<Badge variant="outline" className="ml-2">
																{t(
																	"settings.holidays.assignments.singleHolidayBadge",
																	"Single holiday",
																)}
															</Badge>
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
												{canManage ? (
													<Button
														variant="ghost"
														size="icon"
														className="size-8 text-muted-foreground hover:text-destructive"
														onClick={() => handleDeleteHolidayClick(assignment)}
														aria-label={t(
															"settings.holidays.assignments.removeEmployeeHolidayAssignment",
															'Remove holiday assignment for employee "{employee}"',
															{
																employee:
																	`${assignment.employee?.firstName ?? ""} ${assignment.employee?.lastName ?? ""}`.trim(),
															},
														)}
													>
														<IconTrash className="size-4" />
													</Button>
												) : null}
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
							{selectedHolidayCategoryAssignment &&
								t(
									"settings.holidays.assignments.deleteHolidayCategoryDescription",
									'This will remove the custom holiday category "{category}" from this assignment.',
									{ category: selectedHolidayCategoryAssignment.category.name },
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
									<IconLoader2 className="mr-2 size-4 animate-spin" />
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
