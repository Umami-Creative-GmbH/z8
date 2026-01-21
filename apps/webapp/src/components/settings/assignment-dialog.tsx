"use client";

import { IconLoader2 } from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
	createPresetAssignment,
	getHolidayPresets,
	getTeamsForAssignment,
} from "@/app/[locale]/(app)/settings/holidays/preset-actions";
import { EmployeeSingleSelect } from "@/components/employee-select";
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

interface AssignmentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	onSuccess: () => void;
}

interface PresetOption {
	id: string;
	name: string;
	color: string | null;
	countryCode: string | null;
	stateCode: string | null;
}

interface TeamOption {
	id: string;
	name: string;
}

export function AssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: AssignmentDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

	const form = useForm({
		defaultValues: {
			presetId: "",
			teamId: "",
			employeeId: "",
		},
		onSubmit: async ({ value }) => {
			// Validate target based on assignment type
			const errors: Record<string, string> = {};
			if (!value.presetId) {
				errors.presetId = "Please select a preset";
			}
			if (assignmentType === "team" && !value.teamId) {
				errors.teamId = "Please select a team";
			}
			if (assignmentType === "employee" && !value.employeeId) {
				errors.employeeId = "Please select an employee";
			}

			if (Object.keys(errors).length > 0) {
				setValidationErrors(errors);
				return;
			}

			setValidationErrors({});
			createMutation.mutate(value);
		},
	});

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			form.reset();
			setValidationErrors({});
		}
	}, [open, form]);

	// Fetch presets
	const { data: presets, isLoading: presetsLoading } = useQuery({
		queryKey: queryKeys.holidayPresets.list(organizationId),
		queryFn: async () => {
			const result = await getHolidayPresets(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch presets");
			}
			return result.data as PresetOption[];
		},
		enabled: open,
	});

	// Fetch teams (only for team assignment type)
	const { data: teams, isLoading: teamsLoading } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: async () => {
			const result = await getTeamsForAssignment(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch teams");
			}
			return result.data as TeamOption[];
		},
		enabled: open && assignmentType === "team",
	});

	// Create mutation
	const createMutation = useMutation({
		mutationFn: (values: { presetId: string; teamId: string; employeeId: string }) =>
			createPresetAssignment(organizationId, {
				presetId: values.presetId,
				assignmentType,
				teamId: assignmentType === "team" ? values.teamId : undefined,
				employeeId: assignmentType === "employee" ? values.employeeId : undefined,
				isActive: true,
			}),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.holidays.assignments.created", "Assignment created"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.holidayPresetAssignments.list(organizationId),
				});
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result.error ||
						t("settings.holidays.assignments.createFailed", "Failed to create assignment"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.holidays.assignments.createFailed", "Failed to create assignment"));
		},
	});

	const getDialogTitle = () => {
		switch (assignmentType) {
			case "organization":
				return t("settings.holidays.assignments.setOrgDefault", "Set Organization Default");
			case "team":
				return t("settings.holidays.assignments.assignToTeam", "Assign to Team");
			case "employee":
				return t("settings.holidays.assignments.assignToEmployee", "Assign to Employee");
		}
	};

	const getDialogDescription = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.holidays.assignments.orgDescription",
					"Select a holiday preset to be the default for all employees in the organization",
				);
			case "team":
				return t(
					"settings.holidays.assignments.teamDialogDescription",
					"Select a holiday preset and team to override the organization default",
				);
			case "employee":
				return t(
					"settings.holidays.assignments.employeeDialogDescription",
					"Select a holiday preset and employee to override team or organization defaults",
				);
		}
	};

	const isLoading = presetsLoading || teamsLoading;

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{getDialogTitle()}</DialogTitle>
					<DialogDescription>{getDialogDescription()}</DialogDescription>
				</DialogHeader>

				{isLoading ? (
					<div className="space-y-4 py-4">
						<Skeleton className="h-10 w-full" />
						{assignmentType !== "organization" && <Skeleton className="h-10 w-full" />}
					</div>
				) : (
					<form
						onSubmit={(e) => {
							e.preventDefault();
							form.handleSubmit();
						}}
						className="space-y-4"
					>
						{/* Preset Selection */}
						<form.Field name="presetId">
							{(field) => (
								<div className="space-y-2">
									<Label>{t("settings.holidays.assignments.preset", "Holiday Preset")}</Label>
									<Select value={field.state.value} onValueChange={field.handleChange}>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.holidays.assignments.selectPreset",
													"Select a preset",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											{presets?.map((preset) => (
												<SelectItem key={preset.id} value={preset.id}>
													<div className="flex items-center gap-2">
														{preset.color && (
															<div
																className="w-3 h-3 rounded-full"
																style={{ backgroundColor: preset.color }}
															/>
														)}
														<span>{preset.name}</span>
														{preset.countryCode && (
															<span className="text-muted-foreground">
																({preset.countryCode}
																{preset.stateCode && `-${preset.stateCode}`})
															</span>
														)}
													</div>
												</SelectItem>
											))}
										</SelectContent>
									</Select>
									<p className="text-sm text-muted-foreground">
										{t(
											"settings.holidays.assignments.presetDescription",
											"The holiday preset to assign",
										)}
									</p>
									{validationErrors.presetId && (
										<p className="text-sm text-destructive">{validationErrors.presetId}</p>
									)}
								</div>
							)}
						</form.Field>

						{/* Team Selection (for team assignment) */}
						{assignmentType === "team" && (
							<form.Field name="teamId">
								{(field) => (
									<div className="space-y-2">
										<Label>{t("settings.holidays.assignments.team", "Team")}</Label>
										<Select value={field.state.value} onValueChange={field.handleChange}>
											<SelectTrigger>
												<SelectValue
													placeholder={t(
														"settings.holidays.assignments.selectTeam",
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
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.holidays.assignments.teamDescription",
												"All employees in this team will use this preset",
											)}
										</p>
										{validationErrors.teamId && (
											<p className="text-sm text-destructive">{validationErrors.teamId}</p>
										)}
									</div>
								)}
							</form.Field>
						)}

						{/* Employee Selection (for employee assignment) */}
						{assignmentType === "employee" && (
							<form.Field name="employeeId">
								{(field) => (
									<div className="space-y-2">
										<EmployeeSingleSelect
											value={field.state.value || null}
											onChange={(val) => field.handleChange(val || "")}
											label={t("settings.holidays.assignments.employee", "Employee")}
											placeholder={t(
												"settings.holidays.assignments.selectEmployee",
												"Select an employee",
											)}
											error={validationErrors.employeeId}
										/>
										<p className="text-sm text-muted-foreground">
											{t(
												"settings.holidays.assignments.employeeDescription",
												"This employee will use this preset instead of team/organization defaults",
											)}
										</p>
									</div>
								)}
							</form.Field>
						)}

						<DialogFooter>
							<Button
								type="button"
								variant="outline"
								onClick={() => onOpenChange(false)}
								disabled={createMutation.isPending}
							>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button type="submit" disabled={createMutation.isPending}>
								{createMutation.isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
								{t("common.assign", "Assign")}
							</Button>
						</DialogFooter>
					</form>
				)}
			</DialogContent>
		</Dialog>
	);
}
