"use client";

import { useForm } from "@tanstack/react-form";
import { IconLoader2 } from "@tabler/icons-react";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { getWorkScheduleTemplates } from "@/app/[locale]/(app)/settings/work-schedules/actions";
import {
	bulkCreateWorkScheduleAssignments,
	createWorkScheduleAssignment,
	getEmployeesForAssignment,
	getTeamsForAssignment,
} from "@/app/[locale]/(app)/settings/work-schedules/assignment-actions";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { queryKeys } from "@/lib/query";

interface WorkScheduleAssignmentDialogProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	organizationId: string;
	assignmentType: "organization" | "team" | "employee";
	onSuccess: () => void;
}

const formSchema = z.object({
	templateId: z.string().min(1, "Please select a template"),
	teamId: z.string().nullable(),
	employeeId: z.string().nullable(),
});

type FormValues = z.infer<typeof formSchema>;

const cycleLabels: Record<string, string> = {
	daily: "Daily",
	weekly: "Weekly",
	biweekly: "Biweekly",
	monthly: "Monthly",
	yearly: "Yearly",
};

export function WorkScheduleAssignmentDialog({
	open,
	onOpenChange,
	organizationId,
	assignmentType,
	onSuccess,
}: WorkScheduleAssignmentDialogProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [bulkMode, setBulkMode] = useState(false);
	const [selectedTeamIds, setSelectedTeamIds] = useState<string[]>([]);
	const [selectedEmployeeIds, setSelectedEmployeeIds] = useState<string[]>([]);
	const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});

	const form = useForm<FormValues>({
		defaultValues: {
			templateId: "",
			teamId: null,
			employeeId: null,
		},
		onSubmit: async ({ value }) => {
			if (bulkMode) {
				if (assignmentType === "team" && selectedTeamIds.length === 0) {
					toast.error(t("settings.workSchedules.selectTeams", "Please select at least one team"));
					return;
				}
				if (assignmentType === "employee" && selectedEmployeeIds.length === 0) {
					toast.error(
						t("settings.workSchedules.selectEmployees", "Please select at least one employee"),
					);
					return;
				}

				bulkCreateMutation.mutate({
					templateId: value.templateId,
					teamIds: selectedTeamIds,
					employeeIds: selectedEmployeeIds,
				});
			} else {
				// Validate based on assignment type
				if (assignmentType === "team" && !value.teamId) {
					setValidationErrors({ teamId: "Please select a team" });
					return;
				}
				if (assignmentType === "employee" && !value.employeeId) {
					setValidationErrors({ employeeId: "Please select an employee" });
					return;
				}

				setValidationErrors({});
				createMutation.mutate(value);
			}
		},
	});

	// Reset form when dialog opens
	useEffect(() => {
		if (open) {
			form.reset();
			setBulkMode(false);
			setSelectedTeamIds([]);
			setSelectedEmployeeIds([]);
			setValidationErrors({});
		}
	}, [open, form]);

	// Fetch templates
	const { data: templates, isLoading: loadingTemplates } = useQuery({
		queryKey: queryKeys.workScheduleTemplates.list(organizationId),
		queryFn: async () => {
			const result = await getWorkScheduleTemplates(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch templates");
			}
			return result.data;
		},
		enabled: open,
	});

	// Fetch teams (only for team assignments)
	const { data: teams, isLoading: loadingTeams } = useQuery({
		queryKey: queryKeys.teams.list(organizationId),
		queryFn: async () => {
			const result = await getTeamsForAssignment(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch teams");
			}
			return result.data;
		},
		enabled: open && assignmentType === "team",
	});

	// Fetch employees (only for employee assignments)
	const { data: employees, isLoading: loadingEmployees } = useQuery({
		queryKey: queryKeys.employees.list(organizationId),
		queryFn: async () => {
			const result = await getEmployeesForAssignment(organizationId);
			if (!result.success) {
				throw new Error(result.error || "Failed to fetch employees");
			}
			return result.data;
		},
		enabled: open && assignmentType === "employee",
	});

	// Create single assignment mutation
	const createMutation = useMutation({
		mutationFn: (data: FormValues) =>
			createWorkScheduleAssignment(organizationId, {
				templateId: data.templateId,
				assignmentType,
				teamId: assignmentType === "team" ? data.teamId : null,
				employeeId: assignmentType === "employee" ? data.employeeId : null,
			}),
		onSuccess: (result) => {
			if (result.success) {
				toast.success(t("settings.workSchedules.assignmentCreated", "Schedule assigned"));
				queryClient.invalidateQueries({
					queryKey: queryKeys.workScheduleAssignments.list(organizationId),
				});
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result.error || t("settings.workSchedules.assignmentFailed", "Failed to assign schedule"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workSchedules.assignmentFailed", "Failed to assign schedule"));
		},
	});

	// Bulk create mutation
	const bulkCreateMutation = useMutation({
		mutationFn: (data: { templateId: string; teamIds?: string[]; employeeIds?: string[] }) =>
			bulkCreateWorkScheduleAssignments(organizationId, {
				templateId: data.templateId,
				assignmentType,
				teamIds: assignmentType === "team" ? data.teamIds : undefined,
				employeeIds: assignmentType === "employee" ? data.employeeIds : undefined,
			}),
		onSuccess: (result) => {
			if (result.success) {
				const count = result.data?.created || 0;
				toast.success(
					t("settings.workSchedules.bulkAssignmentCreated", "{count} schedules assigned", {
						count,
					}),
				);
				queryClient.invalidateQueries({
					queryKey: queryKeys.workScheduleAssignments.list(organizationId),
				});
				onSuccess();
				onOpenChange(false);
			} else {
				toast.error(
					result.error ||
						t("settings.workSchedules.bulkAssignmentFailed", "Failed to assign schedules"),
				);
			}
		},
		onError: () => {
			toast.error(t("settings.workSchedules.bulkAssignmentFailed", "Failed to assign schedules"));
		},
	});

	// Helper functions for bulk selection
	const toggleTeamSelection = (teamId: string) => {
		setSelectedTeamIds((prev) =>
			prev.includes(teamId) ? prev.filter((id) => id !== teamId) : [...prev, teamId],
		);
	};

	const toggleEmployeeSelection = (employeeId: string) => {
		setSelectedEmployeeIds((prev) =>
			prev.includes(employeeId) ? prev.filter((id) => id !== employeeId) : [...prev, employeeId],
		);
	};

	const selectAllTeams = () => {
		if (teams) {
			setSelectedTeamIds(teams.map((t) => t.id));
		}
	};

	const selectAllEmployees = () => {
		if (employees) {
			setSelectedEmployeeIds(employees.map((e) => e.id));
		}
	};

	const clearSelection = () => {
		setSelectedTeamIds([]);
		setSelectedEmployeeIds([]);
	};

	const getDialogTitle = () => {
		switch (assignmentType) {
			case "organization":
				return t("settings.workSchedules.assignOrg", "Set Organization Default");
			case "team":
				return t("settings.workSchedules.assignTeam", "Assign to Team");
			case "employee":
				return t("settings.workSchedules.assignEmployee", "Assign to Employee");
		}
	};

	const getDialogDescription = () => {
		switch (assignmentType) {
			case "organization":
				return t(
					"settings.workSchedules.assignOrgDescription",
					"Set the default work schedule for all employees in your organization.",
				);
			case "team":
				return t(
					"settings.workSchedules.assignTeamDescription",
					"Override the organization default for a specific team.",
				);
			case "employee":
				return t(
					"settings.workSchedules.assignEmployeeDescription",
					"Override the schedule for a specific employee.",
				);
		}
	};

	const formatTemplate = (template: (typeof templates)[number]) => {
		const hours =
			template.scheduleType === "simple"
				? template.hoursPerCycle
				: template.days
						.filter((d) => d.isWorkDay)
						.reduce((sum, d) => sum + parseFloat(d.hoursPerDay || "0"), 0)
						.toFixed(1);
		return `${template.name} (${hours}h/${cycleLabels[template.scheduleCycle]?.toLowerCase() || template.scheduleCycle})`;
	};

	const isLoading =
		loadingTemplates ||
		(assignmentType === "team" && loadingTeams) ||
		(assignmentType === "employee" && loadingEmployees);

	const isPending = createMutation.isPending || bulkCreateMutation.isPending;

	// Show bulk mode toggle only for team and employee assignments
	const canUseBulkMode = assignmentType === "team" || assignmentType === "employee";

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent>
				<DialogHeader>
					<DialogTitle>{getDialogTitle()}</DialogTitle>
					<DialogDescription>{getDialogDescription()}</DialogDescription>
				</DialogHeader>

				<form
					onSubmit={(e) => {
						e.preventDefault();
						form.handleSubmit();
					}}
					className="space-y-4"
				>
					<form.Field
						name="templateId"
						validators={{
							onChange: z.string().min(1, "Please select a template"),
						}}
					>
						{(field) => (
							<div className="space-y-2">
								<Label>{t("settings.workSchedules.template", "Template")}</Label>
								<Select onValueChange={field.handleChange} value={field.state.value}>
									<SelectTrigger>
										<SelectValue
											placeholder={t(
												"settings.workSchedules.selectTemplate",
												"Select a template",
											)}
										/>
									</SelectTrigger>
									<SelectContent>
										{loadingTemplates ? (
											<SelectItem value="" disabled>
												{t("common.loading", "Loading...")}
											</SelectItem>
										) : templates && templates.length > 0 ? (
											templates.map((template) => (
												<SelectItem key={template.id} value={template.id}>
													{formatTemplate(template)}
												</SelectItem>
											))
										) : (
											<SelectItem value="" disabled>
												{t(
													"settings.workSchedules.noTemplatesAvailable",
													"No templates available",
												)}
											</SelectItem>
										)}
									</SelectContent>
								</Select>
								<p className="text-sm text-muted-foreground">
									{t(
										"settings.workSchedules.templateDescription",
										"Choose the work schedule template to assign",
									)}
								</p>
								{field.state.meta.errors.length > 0 && (
									<p className="text-sm text-destructive">
									{typeof field.state.meta.errors[0] === "string"
										? field.state.meta.errors[0]
										: (field.state.meta.errors[0] as any)?.message}
								</p>
								)}
							</div>
						)}
					</form.Field>

						{/* Bulk Mode Toggle */}
						{canUseBulkMode && (
							<div className="flex items-center justify-between rounded-lg border p-3">
								<div className="space-y-0.5">
									<Label htmlFor="bulk-mode">
										{t("settings.workSchedules.bulkMode", "Bulk Assignment")}
									</Label>
									<p className="text-xs text-muted-foreground">
										{t(
											"settings.workSchedules.bulkModeDescription",
											"Assign to multiple {type}s at once",
											{ type: assignmentType },
										)}
									</p>
								</div>
								<Switch
									id="bulk-mode"
									checked={bulkMode}
									onCheckedChange={(checked) => {
										setBulkMode(checked);
										if (!checked) {
											clearSelection();
										}
									}}
								/>
							</div>
						)}

					{/* Single Team Selection */}
					{assignmentType === "team" && !bulkMode && (
						<form.Field name="teamId">
							{(field) => (
								<div className="space-y-2">
									<Label>{t("settings.workSchedules.team", "Team")}</Label>
									<Select onValueChange={field.handleChange} value={field.state.value || ""}>
										<SelectTrigger>
											<SelectValue
												placeholder={t("settings.workSchedules.selectTeam", "Select a team")}
											/>
										</SelectTrigger>
										<SelectContent>
											{loadingTeams ? (
												<SelectItem value="" disabled>
													{t("common.loading", "Loading...")}
												</SelectItem>
											) : teams && teams.length > 0 ? (
												teams.map((team) => (
													<SelectItem key={team.id} value={team.id}>
														{team.name}
													</SelectItem>
												))
											) : (
												<SelectItem value="" disabled>
													{t("settings.workSchedules.noTeamsAvailable", "No teams available")}
												</SelectItem>
											)}
										</SelectContent>
									</Select>
									{validationErrors.teamId && (
										<p className="text-sm text-destructive">{validationErrors.teamId}</p>
									)}
								</div>
							)}
						</form.Field>
					)}

						{/* Bulk Team Selection */}
						{assignmentType === "team" && bulkMode && (
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<Label>{t("settings.workSchedules.selectTeams", "Select Teams")}</Label>
									<div className="flex gap-2">
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={selectAllTeams}
											disabled={loadingTeams}
										>
											{t("common.selectAll", "Select All")}
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={clearSelection}
											disabled={selectedTeamIds.length === 0}
										>
											{t("common.clearSelection", "Clear")}
										</Button>
									</div>
								</div>
								<ScrollArea className="h-48 rounded-md border p-2">
									{loadingTeams ? (
										<div className="flex items-center justify-center h-full">
											<IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
										</div>
									) : teams && teams.length > 0 ? (
										<div className="space-y-2">
											{teams.map((team) => (
												<div key={team.id} className="flex items-center space-x-2">
													<Checkbox
														id={`team-${team.id}`}
														checked={selectedTeamIds.includes(team.id)}
														onCheckedChange={() => toggleTeamSelection(team.id)}
													/>
													<Label htmlFor={`team-${team.id}`} className="font-normal cursor-pointer">
														{team.name}
													</Label>
												</div>
											))}
										</div>
									) : (
										<p className="text-sm text-muted-foreground text-center py-4">
											{t("settings.workSchedules.noTeamsAvailable", "No teams available")}
										</p>
									)}
								</ScrollArea>
								<p className="text-xs text-muted-foreground">
									{t("settings.workSchedules.selectedCount", "{count} selected", {
										count: selectedTeamIds.length,
									})}
								</p>
							</div>
						)}

					{/* Single Employee Selection */}
					{assignmentType === "employee" && !bulkMode && (
						<form.Field name="employeeId">
							{(field) => (
								<div className="space-y-2">
									<Label>{t("settings.workSchedules.employee", "Employee")}</Label>
									<Select onValueChange={field.handleChange} value={field.state.value || ""}>
										<SelectTrigger>
											<SelectValue
												placeholder={t(
													"settings.workSchedules.selectEmployee",
													"Select an employee",
												)}
											/>
										</SelectTrigger>
										<SelectContent>
											{loadingEmployees ? (
												<SelectItem value="" disabled>
													{t("common.loading", "Loading...")}
												</SelectItem>
											) : employees && employees.length > 0 ? (
												employees.map((emp) => (
													<SelectItem key={emp.id} value={emp.id}>
														{`${emp.firstName || ""} ${emp.lastName || ""}`.trim() ||
															emp.employeeNumber ||
															"Unknown"}
													</SelectItem>
												))
											) : (
												<SelectItem value="" disabled>
													{t(
														"settings.workSchedules.noEmployeesAvailable",
														"No employees available",
													)}
												</SelectItem>
											)}
										</SelectContent>
									</Select>
									{validationErrors.employeeId && (
										<p className="text-sm text-destructive">{validationErrors.employeeId}</p>
									)}
								</div>
							)}
						</form.Field>
					)}

						{/* Bulk Employee Selection */}
						{assignmentType === "employee" && bulkMode && (
							<div className="space-y-2">
								<div className="flex items-center justify-between">
									<Label>{t("settings.workSchedules.selectEmployees", "Select Employees")}</Label>
									<div className="flex gap-2">
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={selectAllEmployees}
											disabled={loadingEmployees}
										>
											{t("common.selectAll", "Select All")}
										</Button>
										<Button
											type="button"
											variant="ghost"
											size="sm"
											onClick={clearSelection}
											disabled={selectedEmployeeIds.length === 0}
										>
											{t("common.clearSelection", "Clear")}
										</Button>
									</div>
								</div>
								<ScrollArea className="h-48 rounded-md border p-2">
									{loadingEmployees ? (
										<div className="flex items-center justify-center h-full">
											<IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
										</div>
									) : employees && employees.length > 0 ? (
										<div className="space-y-2">
											{employees.map((emp) => (
												<div key={emp.id} className="flex items-center space-x-2">
													<Checkbox
														id={`emp-${emp.id}`}
														checked={selectedEmployeeIds.includes(emp.id)}
														onCheckedChange={() => toggleEmployeeSelection(emp.id)}
													/>
													<Label htmlFor={`emp-${emp.id}`} className="font-normal cursor-pointer">
														{`${emp.firstName || ""} ${emp.lastName || ""}`.trim() ||
															emp.employeeNumber ||
															"Unknown"}
													</Label>
												</div>
											))}
										</div>
									) : (
										<p className="text-sm text-muted-foreground text-center py-4">
											{t("settings.workSchedules.noEmployeesAvailable", "No employees available")}
										</p>
									)}
								</ScrollArea>
								<p className="text-xs text-muted-foreground">
									{t("settings.workSchedules.selectedCount", "{count} selected", {
										count: selectedEmployeeIds.length,
									})}
								</p>
							</div>
						)}

						<DialogFooter>
							<Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
								{t("common.cancel", "Cancel")}
							</Button>
							<Button type="submit" disabled={isPending || isLoading}>
								{isPending && <IconLoader2 className="mr-2 h-4 w-4 animate-spin" />}
								{bulkMode
									? t("settings.workSchedules.assignSelected", "Assign to Selected")
									: t("settings.workSchedules.assign", "Assign")}
							</Button>
						</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	);
}
