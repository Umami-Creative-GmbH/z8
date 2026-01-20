"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import {
	createSetAssignment,
	getEmployeesForAssignment,
	getTeamsForAssignment,
	getWorkCategorySets,
} from "@/app/[locale]/(app)/settings/work-categories/actions";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { queryKeys } from "@/lib/query";

interface WorkCategoryAssignmentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	onSuccess: () => void;
}

interface CategorySetData {
	id: string;
	name: string;
	description: string | null;
	categoryCount: number;
}

interface TeamData {
	id: string;
	name: string;
}

interface EmployeeData {
	id: string;
	firstName: string | null;
	lastName: string | null;
}

export function WorkCategoryAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: WorkCategoryAssignmentDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();

	// Form state
	const [selectedSetId, setSelectedSetId] = useState<string>("");
	const [selectedTeamId, setSelectedTeamId] = useState<string>("");
	const [selectedEmployeeId, setSelectedEmployeeId] = useState<string>("");

	// Reset form when dialog opens/closes
	const handleOpenChange = (newOpen: boolean) => {
		if (!newOpen) {
			setSelectedSetId("");
			setSelectedTeamId("");
			setSelectedEmployeeId("");
		}
		onOpenChange(newOpen);
	};

	// Fetch category sets
	const { data: categorySets, isLoading: setsLoading } = useQuery({
		queryKey: queryKeys.workCategorySets.list(organizationId),
		queryFn: async () => {
			const result = await getWorkCategorySets(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch category sets");
			}
			return result.data as CategorySetData[];
		},
		enabled: open,
	});

	// Fetch teams (only for team assignments)
	const { data: teams, isLoading: teamsLoading } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: async () => {
			const result = await getTeamsForAssignment(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch teams");
			}
			return result.data as TeamData[];
		},
		enabled: open && assignmentType === "team",
	});

	// Fetch employees (only for employee assignments)
	const { data: employees, isLoading: employeesLoading } = useQuery({
		queryKey: ["employees-for-assignment", organizationId],
		queryFn: async () => {
			const result = await getEmployeesForAssignment(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch employees");
			}
			return result.data as EmployeeData[];
		},
		enabled: open && assignmentType === "employee",
	});

	// Create assignment mutation
	const createMutation = useMutation({
		mutationFn: () => {
			const teamId = assignmentType === "team" ? selectedTeamId : null;
			const employeeId = assignmentType === "employee" ? selectedEmployeeId : null;
			return createSetAssignment({
				organizationId,
				setId: selectedSetId,
				assignmentType,
				teamId,
				employeeId,
			});
		},
		onSuccess: (result) => {
			if (result.success) {
				toast.success(
					t("settings.workCategories.assignmentCreated", "Assignment created"),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.workCategorySetAssignments.list(organizationId),
				});
				handleOpenChange(false);
				onSuccess();
			} else {
				toast.error(
					result.error ||
						t(
							"settings.workCategories.assignmentCreateFailed",
							"Failed to create assignment",
						),
				);
			}
		},
		onError: () => {
			toast.error(
				t("settings.workCategories.assignmentCreateFailed", "Failed to create assignment"),
			);
		},
	});

	const handleSubmit = () => {
		createMutation.mutate();
	};

	const isLoading = setsLoading || teamsLoading || employeesLoading;

	// Validation
	const isValid =
		selectedSetId &&
		(assignmentType === "organization" ||
			(assignmentType === "team" && selectedTeamId) ||
			(assignmentType === "employee" && selectedEmployeeId));

	// Title based on assignment type
	const getTitle = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.workCategories.assignOrgTitle",
					"Set Organization Default",
				);
			case "team":
				return t("settings.workCategories.assignTeamTitle", "Assign to Team");
			case "employee":
				return t(
					"settings.workCategories.assignEmployeeTitle",
					"Assign to Employee",
				);
		}
	};

	const getDescription = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.workCategories.assignOrgDescription",
					"This category set will be the default for all employees",
				);
			case "team":
				return t(
					"settings.workCategories.assignTeamDescription",
					"Override the organization default for a specific team",
				);
			case "employee":
				return t(
					"settings.workCategories.assignEmployeeDescription",
					"Override the team or organization default for a specific employee",
				);
		}
	};

	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>{getTitle()}</DialogTitle>
					<DialogDescription>{getDescription()}</DialogDescription>
				</DialogHeader>

				<div className="space-y-4 py-4">
					{/* Category Set Selection */}
					<div className="space-y-2">
						<Label>
							{t("settings.workCategories.selectSet", "Category Set")}
						</Label>
						{setsLoading ? (
							<Skeleton className="h-10 w-full" />
						) : (
							<Select value={selectedSetId} onValueChange={setSelectedSetId}>
								<SelectTrigger>
									<SelectValue
										placeholder={t(
											"settings.workCategories.selectSetPlaceholder",
											"Select a category set",
										)}
									/>
								</SelectTrigger>
								<SelectContent>
									{categorySets?.map((set) => (
										<SelectItem key={set.id} value={set.id}>
											{set.name}
											{set.categoryCount > 0 && (
												<span className="text-muted-foreground ml-2">
													({set.categoryCount}{" "}
													{t("settings.workCategories.categories", "categories")})
												</span>
											)}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						)}
						{categorySets?.length === 0 && (
							<p className="text-sm text-muted-foreground">
								{t(
									"settings.workCategories.noSetsAvailable",
									"No category sets available. Create one first.",
								)}
							</p>
						)}
					</div>

					{/* Team Selection */}
					{assignmentType === "team" && (
						<div className="space-y-2">
							<Label>{t("settings.workCategories.selectTeam", "Team")}</Label>
							{teamsLoading ? (
								<Skeleton className="h-10 w-full" />
							) : (
								<Select value={selectedTeamId} onValueChange={setSelectedTeamId}>
									<SelectTrigger>
										<SelectValue
											placeholder={t(
												"settings.workCategories.selectTeamPlaceholder",
												"Select a team",
											)}
										/>
									</SelectTrigger>
									<SelectContent>
										{teams?.map((team) => (
											<SelectItem key={team.id} value={team.id}>
												{team.name}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
							{teams?.length === 0 && (
								<p className="text-sm text-muted-foreground">
									{t(
										"settings.workCategories.noTeamsAvailable",
										"No teams available.",
									)}
								</p>
							)}
						</div>
					)}

					{/* Employee Selection */}
					{assignmentType === "employee" && (
						<div className="space-y-2">
							<Label>
								{t("settings.workCategories.selectEmployee", "Employee")}
							</Label>
							{employeesLoading ? (
								<Skeleton className="h-10 w-full" />
							) : (
								<Select
									value={selectedEmployeeId}
									onValueChange={setSelectedEmployeeId}
								>
									<SelectTrigger>
										<SelectValue
											placeholder={t(
												"settings.workCategories.selectEmployeePlaceholder",
												"Select an employee",
											)}
										/>
									</SelectTrigger>
									<SelectContent>
										{employees?.map((emp) => (
											<SelectItem key={emp.id} value={emp.id}>
												{emp.firstName} {emp.lastName}
											</SelectItem>
										))}
									</SelectContent>
								</Select>
							)}
							{employees?.length === 0 && (
								<p className="text-sm text-muted-foreground">
									{t(
										"settings.workCategories.noEmployeesAvailable",
										"No employees available.",
									)}
								</p>
							)}
						</div>
					)}
				</div>

				<DialogFooter>
					<Button variant="outline" onClick={() => handleOpenChange(false)}>
						{t("common.cancel", "Cancel")}
					</Button>
					<Button
						onClick={handleSubmit}
						disabled={!isValid || createMutation.isPending}
					>
						{createMutation.isPending ? (
							<>
								<IconLoader2 className="mr-2 h-4 w-4 animate-spin" />
								{t("common.saving", "Saving...")}
							</>
						) : (
							t("common.assign", "Assign")
						)}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
